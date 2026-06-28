import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { apiUrl } from "../lib/apiUrl";
import { getCallSocket, getCurrentUserIdForSocket } from "../lib/callSocket";

export type WebRTCRole = "client" | "interpreter";

export interface WebRTCSignalMessage {
  id: string;
  senderRole: WebRTCRole;
  signalType: "offer" | "answer" | "ice" | "hangup";
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit | Record<string, never>;
  createdAt: string;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

function hasSessionDescription(payload: unknown): payload is RTCSessionDescriptionInit {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "type" in payload &&
      "sdp" in payload
  );
}

function hasIceCandidate(payload: unknown): payload is RTCIceCandidateInit {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "candidate" in payload
  );
}

/** Acquire video and audio separately — works when a combined constraint fails (e.g. busy camera). */
export async function acquireCallMedia(options: { preferVideo?: boolean } = {}): Promise<MediaStream> {
  const { preferVideo = true } = options;
  const stream = new MediaStream();

  if (preferVideo) {
    const videoAttempts: MediaStreamConstraints[] = [
      { video: true, audio: false },
      { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: { width: { max: 320 }, height: { max: 240 } }, audio: false },
      { video: { facingMode: "user" }, audio: false },
    ];

    for (const constraints of videoAttempts) {
      try {
        const videoOnly = await navigator.mediaDevices.getUserMedia(constraints);
        videoOnly.getVideoTracks().forEach((track) => stream.addTrack(track));
        break;
      } catch {
        /* try next constraint */
      }
    }
  }

  try {
    const audioOnly = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    audioOnly.getAudioTracks().forEach((track) => stream.addTrack(track));
  } catch {
    /* audio optional if we already have video */
  }

  if (stream.getTracks().length === 0) {
    throw new Error("Could not access camera/microphone.");
  }

  return stream;
}

/** @deprecated Use acquireCallMedia — kept for imports that expect the old name. */
export async function acquireUserMedia(): Promise<MediaStream> {
  return acquireCallMedia({ preferVideo: true });
}

interface UseWebRTCCallOptions {
  sessionId: string | null;
  role: WebRTCRole;
  isCaller: boolean;
  enabled: boolean;
  initialStream?: MediaStream | null;
  onPeerHangup?: (sessionId: string) => void;
}

function getOrderedTransceiver(pc: RTCPeerConnection, kind: "audio" | "video"): RTCRtpTransceiver | null {
  const index = kind === "audio" ? 0 : 1;
  return pc.getTransceivers()[index] ?? null;
}

function getTransceiverSender(pc: RTCPeerConnection, kind: "audio" | "video"): RTCRtpSender | null {
  return getOrderedTransceiver(pc, kind)?.sender ?? null;
}

async function configureOrderedLocalMedia(pc: RTCPeerConnection, stream: MediaStream) {
  // Caller offer m-lines must stay audio first, then video.
  if (pc.getTransceivers().length === 0) {
    pc.addTransceiver("audio", { direction: "sendrecv" });
    pc.addTransceiver("video", { direction: "sendrecv" });
  }
  await attachLocalTracksToOfferTransceivers(pc, stream);
}

async function attachLocalTracksToOfferTransceivers(pc: RTCPeerConnection, stream: MediaStream) {
  const audioTrack = stream.getAudioTracks().find((track) => track.readyState === "live") || null;
  const videoTrack = stream.getVideoTracks().find((track) => track.readyState === "live") || null;
  const audioTransceiver = getOrderedTransceiver(pc, "audio");
  const videoTransceiver = getOrderedTransceiver(pc, "video");

  if (audioTransceiver) {
    audioTransceiver.direction = "sendrecv";
    await audioTransceiver.sender.replaceTrack(audioTrack);
  }
  if (videoTransceiver) {
    videoTransceiver.direction = "sendrecv";
    await videoTransceiver.sender.replaceTrack(videoTrack);
  }
}

async function tryAddVideoTrack(stream: MediaStream, pc: RTCPeerConnection): Promise<boolean> {
  if (stream.getVideoTracks().some((t) => t.readyState === "live")) return false;

  const attempts: MediaStreamConstraints[] = [
    { video: true, audio: false },
    { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
    { video: { width: { max: 320 }, height: { max: 240 } }, audio: false },
  ];

  for (const constraints of attempts) {
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia(constraints);
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) continue;
      stream.addTrack(videoTrack);
      const videoSender = getTransceiverSender(pc, "video");
      if (videoSender) {
        await videoSender.replaceTrack(videoTrack);
      }
      return Boolean(videoSender);
    } catch {
      /* try next */
    }
  }

  return false;
}

export function useWebRTCCall({
  sessionId,
  role,
  isCaller,
  enabled,
  initialStream = null,
  onPeerHangup,
}: UseWebRTCCallOptions) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const processedIdsRef = useRef<Set<string>>(new Set());
  const pendingSignalsRef = useRef<WebRTCSignalMessage[]>([]);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const offerRepublishTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollPeerSignalsRef = useRef<(() => Promise<void>) | null>(null);
  const signalSocketRef = useRef<ReturnType<typeof getCallSocket> | null>(null);
  const mountGenRef = useRef(0);
  const ownsLocalStreamRef = useRef(false);
  const renegotiatingRef = useRef(false);
  const endedSessionsRef = useRef<Set<string>>(new Set());
  const onPeerHangupRef = useRef<((sessionId: string) => void) | undefined>(undefined);

  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>("new");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [localReady, setLocalReady] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [, setVideoBindTick] = useState(0);

  const sessionIdRef = useRef(sessionId);
  const roleRef = useRef(role);
  const isCallerRef = useRef(isCaller);
  const initialStreamRef = useRef(initialStream);

  sessionIdRef.current = sessionId;
  roleRef.current = role;
  isCallerRef.current = isCaller;
  initialStreamRef.current = initialStream;
  onPeerHangupRef.current = onPeerHangup;

  const bindVideoElements = useCallback(() => {
    const localStream = localStreamRef.current;
    const remoteStream = remoteStreamRef.current;

    if (localVideoRef.current && localStream) {
      if (localVideoRef.current.srcObject !== localStream) {
        localVideoRef.current.srcObject = localStream;
      }
      localVideoRef.current.muted = true;
      void localVideoRef.current.play().catch(() => {});
    }

    if (remoteVideoRef.current && remoteStream) {
      if (remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      remoteVideoRef.current.muted = false;
      void remoteVideoRef.current
        .play()
        .then(() => setPlaybackBlocked(false))
        .catch(() => setPlaybackBlocked(true));
    }
  }, []);

  useLayoutEffect(() => {
    bindVideoElements();
  });

  const postSignal = useCallback((signalType: WebRTCSignalMessage["signalType"], payload: unknown) => {
    const sid = sessionIdRef.current;
    if (!sid) return false;
    const role = roleRef.current;
    const socket =
      signalSocketRef.current ||
      getCallSocket(getCurrentUserIdForSocket(role), role);
    signalSocketRef.current = socket;
    socket.send(`webrtc.${signalType}`, { sessionId: sid, payload: (payload as Record<string, unknown>) || {} });

    void fetch(apiUrl(`/api/webrtc/${sid}/signal`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderRole: role,
        signalType,
        payload: payload ?? {},
      }),
    }).catch(() => {
      /* HTTP poll fallback on peer will pick up persisted signals */
    });
    return true;
  }, []);

  const flushPendingIce = useCallback(async (pc: RTCPeerConnection) => {
    if (!pc.remoteDescription) return;
    const pending = [...pendingIceRef.current];
    pendingIceRef.current = [];
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        /* ignore stale candidates */
      }
    }
  }, []);

  const acceptOfferAndAnswer = useCallback(
    async (pc: RTCPeerConnection, offer: RTCSessionDescriptionInit) => {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const localStream = localStreamRef.current;
      if (localStream) {
        await tryAddVideoTrack(localStream, pc);
        await attachLocalTracksToOfferTransceivers(pc, localStream);
      }
      await flushPendingIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (pc.localDescription) {
        postSignal("answer", pc.localDescription.toJSON());
      }
    },
    [flushPendingIce, postSignal]
  );

  const attachRemoteTrack = useCallback(
    (track: MediaStreamTrack) => {
      if (track.readyState === "ended") return;
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }
      const remote = remoteStreamRef.current;
      if (!remote.getTracks().some((t) => t.id === track.id)) {
        remote.addTrack(track);
      }
      setRemoteReady(true);
      setVideoBindTick((n) => n + 1);
      bindVideoElements();
    },
    [bindVideoElements]
  );

  const sendRenegotiationOffer = useCallback(
    async (pc: RTCPeerConnection) => {
      if (renegotiatingRef.current || isCallerRef.current) return;
      renegotiatingRef.current = true;
      try {
        const stream = localStreamRef.current;
        if (stream) {
          await attachLocalTracksToOfferTransceivers(pc, stream);
        }
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (pc.localDescription) {
          postSignal("offer", pc.localDescription.toJSON());
        }
      } catch {
        /* retry on next poll cycle */
      } finally {
        renegotiatingRef.current = false;
      }
    },
    [postSignal]
  );

  const stopPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (offerRepublishTimerRef.current) {
      clearInterval(offerRepublishTimerRef.current);
      offerRepublishTimerRef.current = null;
    }
  }, []);

  const teardownMedia = useCallback(() => {
    stopPollTimer();
    pcRef.current?.close();
    pcRef.current = null;
    if (ownsLocalStreamRef.current) {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    }
    localStreamRef.current = null;
    ownsLocalStreamRef.current = false;
    remoteStreamRef.current = null;
    renegotiatingRef.current = false;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    pendingIceRef.current = [];
    pendingSignalsRef.current = [];
    processedIdsRef.current.clear();
    setLocalReady(false);
    setRemoteReady(false);
    setPlaybackBlocked(false);
    setIsMuted(false);
    setConnectionState("closed");
  }, [stopPollTimer]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    setIsMuted((prev) => {
      const nextMuted = !prev;
      audioTracks.forEach((track) => {
        track.enabled = !nextMuted;
      });
      return nextMuted;
    });
  }, []);

  const resumeRemoteMedia = useCallback(async () => {
    try {
      await remoteVideoRef.current?.play();
      setPlaybackBlocked(false);
    } catch {
      setPlaybackBlocked(true);
    }
  }, []);

  const handleRemoteSignal = useCallback(
    async (signal: WebRTCSignalMessage) => {
      const pc = pcRef.current;
      if (!pc) return;

      if (signal.signalType === "offer") {
        if (!hasSessionDescription(signal.payload)) return;

        try {
          if (pc.signalingState === "stable") {
            await acceptOfferAndAnswer(pc, signal.payload);
          } else if (pc.signalingState === "have-local-offer" && isCallerRef.current) {
            // Roll back our offer and accept the remote one (glare handling)
            await pc.setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit);
            await acceptOfferAndAnswer(pc, signal.payload);
          }
          setMediaError(null);
        } catch (err) {
          const message = err instanceof Error ? err.message : "WebRTC offer negotiation failed.";
          setMediaError(message);
        }
      } else if (signal.signalType === "answer" && isCallerRef.current) {
        if (pc.signalingState !== "have-local-offer" || !hasSessionDescription(signal.payload)) {
          return;
        }
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
          await flushPendingIce(pc);
          setRemoteReady(Boolean(remoteStreamRef.current?.getTracks().length));
          setVideoBindTick((n) => n + 1);
          bindVideoElements();
          void pollPeerSignalsRef.current?.();
          setMediaError(null);
        } catch (err) {
          const message = err instanceof Error ? err.message : "WebRTC answer negotiation failed.";
          setMediaError(message);
        }
      } else if (signal.signalType === "ice") {
        if (!hasIceCandidate(signal.payload)) return;
        const candidate = signal.payload;
        if (!pc.remoteDescription) {
          pendingIceRef.current.push(candidate);
          return;
        }
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          pendingIceRef.current.push(candidate);
        }
      } else if (signal.signalType === "hangup") {
        const sid = sessionIdRef.current;
        if (sid) {
          endedSessionsRef.current.add(sid);
        }
        teardownMedia();
        onPeerHangupRef.current?.(sid || "");
      }
    },
    [acceptOfferAndAnswer, flushPendingIce, teardownMedia, bindVideoElements]
  );

  const ingestRemoteSignal = useCallback(
    (signal: WebRTCSignalMessage) => {
      if (processedIdsRef.current.has(signal.id)) return;
      if (!pcRef.current) {
        pendingSignalsRef.current.push(signal);
        return;
      }
      processedIdsRef.current.add(signal.id);
      void handleRemoteSignal(signal).catch((err) => {
        const message = err instanceof Error ? err.message : "WebRTC negotiation failed.";
        setMediaError(message);
      });
    },
    [handleRemoteSignal]
  );

  const pollPeerSignals = useCallback(async () => {
    const sid = sessionIdRef.current;
    const role = roleRef.current;
    if (!sid || endedSessionsRef.current.has(sid)) return;

    const peerRole = role === "client" ? "interpreter" : "client";
    try {
      const res = await fetch(apiUrl(`/api/webrtc/${sid}/signals?peer=${peerRole}`));
      if (!res.ok) return;
      const data = (await res.json()) as { signals?: WebRTCSignalMessage[] };
      for (const raw of data.signals || []) {
        ingestRemoteSignal({
          id: raw.id,
          senderRole: raw.senderRole,
          signalType: raw.signalType,
          payload: raw.payload || {},
          createdAt: raw.createdAt || new Date().toISOString(),
        });
      }
    } catch {
      /* retry on next poll */
    }
  }, [ingestRemoteSignal]);

  pollPeerSignalsRef.current = pollPeerSignals;

  const endCall = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) {
      endedSessionsRef.current.add(sid);
    }
    postSignal("hangup", {});
    teardownMedia();
  }, [postSignal, teardownMedia]);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const socket = getCallSocket(getCurrentUserIdForSocket(role), role);
    const unsubscribe = socket.subscribe((message) => {
      if (message.type !== "call.accepted") return;
      if (!("session" in message) || message.session?.id !== sessionId) return;

      void pollPeerSignalsRef.current?.();
      const pc = pcRef.current;
      if (isCallerRef.current && pc?.localDescription?.type === "offer") {
        postSignal("offer", pc.localDescription.toJSON());
      }
    });

    return unsubscribe;
  }, [enabled, sessionId, role, postSignal]);

  useEffect(() => {
    if (!enabled || !sessionId) {
      return;
    }

    if (endedSessionsRef.current.has(sessionId)) {
      return;
    }

    const mountId = ++mountGenRef.current;
    let cancelled = false;
    const socket = getCallSocket(getCurrentUserIdForSocket(role), role);
    signalSocketRef.current = socket;
    const unsubscribe = socket.subscribe((message) => {
      if (!message.type.startsWith("webrtc.")) return;
      if (!("sessionId" in message) || message.sessionId !== sessionIdRef.current) return;
      if (!("senderRole" in message) || message.senderRole === roleRef.current) return;

      const signalType = message.type.replace("webrtc.", "") as WebRTCSignalMessage["signalType"];
      const signal: WebRTCSignalMessage = {
        id: message.signal?.id || `${message.type}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        senderRole: message.senderRole,
        signalType,
        payload: message.signal?.payload || message.payload || {},
        createdAt: message.signal?.createdAt || new Date().toISOString(),
      };
      ingestRemoteSignal(signal);
    });

    const start = async () => {
      try {
        let stream = initialStreamRef.current;
        if (stream) {
          ownsLocalStreamRef.current = false;
        } else {
          stream = await acquireCallMedia({ preferVideo: true });
          ownsLocalStreamRef.current = true;
        }

        if (cancelled || mountId !== mountGenRef.current) {
          if (ownsLocalStreamRef.current) {
            stream.getTracks().forEach((t) => t.stop());
          }
          return;
        }

        localStreamRef.current = stream;
        setLocalReady(true);
        setIsMuted(false);
        setMediaError(null);
        setVideoBindTick((n) => n + 1);

        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;
        await configureOrderedLocalMedia(pc, stream);

        pc.ontrack = (event) => {
          if (event.streams?.[0]) {
            for (const track of event.streams[0].getTracks()) {
              attachRemoteTrack(track);
            }
            return;
          }
          attachRemoteTrack(event.track);
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            void postSignal("ice", event.candidate.toJSON());
          }
        };

        pc.onconnectionstatechange = () => {
          setConnectionState(pc.connectionState);
        };

        pc.oniceconnectionstatechange = () => {
          if (
            pc.iceConnectionState === "connected" ||
            pc.iceConnectionState === "completed"
          ) {
            if (remoteStreamRef.current?.getTracks().length) {
              setRemoteReady(true);
              setVideoBindTick((n) => n + 1);
              bindVideoElements();
            }
          }
        };

        if (isCallerRef.current) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (pc.localDescription) {
            postSignal("offer", pc.localDescription.toJSON());
          }

          offerRepublishTimerRef.current = setInterval(() => {
            const activePc = pcRef.current;
            const sid = sessionIdRef.current;
            if (!activePc || !sid || endedSessionsRef.current.has(sid)) {
              if (offerRepublishTimerRef.current) {
                clearInterval(offerRepublishTimerRef.current);
                offerRepublishTimerRef.current = null;
              }
              return;
            }
            if (
              activePc.connectionState === "connected" ||
              activePc.connectionState === "closed" ||
              activePc.signalingState === "stable"
            ) {
              if (offerRepublishTimerRef.current) {
                clearInterval(offerRepublishTimerRef.current);
                offerRepublishTimerRef.current = null;
              }
              return;
            }
            if (activePc.localDescription?.type === "offer") {
              postSignal("offer", activePc.localDescription.toJSON());
            }
          }, 1000);
        }

        const pendingSignals = [...pendingSignalsRef.current];
        pendingSignalsRef.current = [];
        for (const signal of pendingSignals) {
          ingestRemoteSignal(signal);
        }

        stopPollTimer();
        const runBurstPoll = async () => {
          for (let i = 0; i < 16 && !cancelled && mountId === mountGenRef.current; i++) {
            await pollPeerSignals();
            const pcState = pcRef.current?.connectionState;
            if (pcState === "connected" || pcState === "closed") break;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        };
        void runBurstPoll();
        pollTimerRef.current = setInterval(() => {
          void pollPeerSignals();
        }, 500);

        // Callee: if video was unavailable at answer time, renegotiate once camera frees up
        if (!isCallerRef.current && stream.getVideoTracks().length === 0) {
          const retryVideo = async () => {
            for (let i = 0; i < 8 && !cancelled && mountId === mountGenRef.current; i++) {
              if (endedSessionsRef.current.has(sessionIdRef.current || "")) return;
              await new Promise((r) => setTimeout(r, 1500));
              if (endedSessionsRef.current.has(sessionIdRef.current || "")) return;
              const added = await tryAddVideoTrack(stream, pc);
              if (added) {
                setLocalReady(true);
                setVideoBindTick((n) => n + 1);
                bindVideoElements();
                await sendRenegotiationOffer(pc);
                break;
              }
            }
          };
          void retryVideo();
        }
      } catch (err) {
        if (cancelled || mountId !== mountGenRef.current) return;
        const message = err instanceof Error ? err.message : "Could not access camera/microphone.";
        setMediaError(message);
      }
    };

    void start();

    return () => {
      cancelled = true;
      unsubscribe();
      if (mountId === mountGenRef.current) {
        teardownMedia();
      }
    };
  }, [
    enabled,
    sessionId,
    postSignal,
    bindVideoElements,
    attachRemoteTrack,
    sendRenegotiationOffer,
    teardownMedia,
    stopPollTimer,
    pollPeerSignals,
    ingestRemoteSignal,
    handleRemoteSignal,
  ]);

  useEffect(() => {
    bindVideoElements();
  }, [localReady, remoteReady, bindVideoElements]);

  return {
    localVideoRef,
    remoteVideoRef,
    connectionState,
    mediaError,
    localReady,
    remoteReady,
    playbackBlocked,
    isMuted,
    toggleMute,
    resumeRemoteMedia,
    endCall,
  };
}
