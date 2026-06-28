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

const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/** Public TURN relay — required for many real-world NAT/firewall paths on HTTPS production. */
const PRODUCTION_TURN_SERVERS: RTCIceServer[] = [
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

const ICE_SERVERS: RTCConfiguration = {
  iceServers: import.meta.env.PROD ? [...STUN_SERVERS, ...PRODUCTION_TURN_SERVERS] : STUN_SERVERS,
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

/** Acquire video and audio — combined first, then split fallbacks. */
export async function acquireCallMedia(options: { preferVideo?: boolean } = {}): Promise<MediaStream> {
  const { preferVideo = true } = options;

  const attempts: MediaStreamConstraints[] = preferVideo
    ? [
        { audio: { echoCancellation: true, noiseSuppression: true }, video: true },
        { audio: { echoCancellation: true, noiseSuppression: true }, video: { width: { ideal: 640 }, height: { ideal: 480 } } },
        { audio: true, video: false },
      ]
    : [{ audio: { echoCancellation: true, noiseSuppression: true }, video: false }];

  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch {
      /* try next constraint set */
    }
  }

  if (preferVideo) {
    const stream = new MediaStream();
    const videoAttempts: MediaStreamConstraints[] = [
      { video: true, audio: false },
      { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
    ];
    for (const constraints of videoAttempts) {
      try {
        const videoOnly = await navigator.mediaDevices.getUserMedia(constraints);
        videoOnly.getVideoTracks().forEach((track) => stream.addTrack(track));
        break;
      } catch {
        /* try next */
      }
    }
    try {
      const audioOnly = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      audioOnly.getAudioTracks().forEach((track) => stream.addTrack(track));
    } catch {
      /* audio optional */
    }
    if (stream.getTracks().length > 0) return stream;
  }

  throw new Error("Could not access camera/microphone.");
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
  /** Fired once media path is up (answer applied or ICE connected). */
  onCallLive?: () => void;
}

function attachLocalStreamToPeerConnection(pc: RTCPeerConnection, stream: MediaStream) {
  for (const track of stream.getTracks()) {
    if (track.readyState !== "live") continue;
    const alreadyAttached = pc.getSenders().some((sender) => sender.track?.id === track.id);
    if (!alreadyAttached) {
      pc.addTrack(track, stream);
    }
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
      attachLocalStreamToPeerConnection(pc, stream);
      return true;
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
  onCallLive,
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
  const negotiatingRef = useRef(false);
  const sdpChainRef = useRef(Promise.resolve());
  const endedSessionsRef = useRef<Set<string>>(new Set());
  const onPeerHangupRef = useRef<((sessionId: string) => void) | undefined>(undefined);
  const onCallLiveRef = useRef<(() => void) | undefined>(undefined);
  const callLiveNotifiedRef = useRef(false);
  const handleRemoteSignalRef = useRef<(signal: WebRTCSignalMessage) => Promise<void>>(async () => {});
  const ingestRemoteSignalRef = useRef<(signal: WebRTCSignalMessage) => void>(() => {});

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
  onCallLiveRef.current = onCallLive;

  const notifyCallLive = useCallback(() => {
    if (callLiveNotifiedRef.current) return;
    callLiveNotifiedRef.current = true;
    onCallLiveRef.current?.();
  }, []);

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

  const enqueueSdpWork = useCallback((work: () => Promise<void>) => {
    sdpChainRef.current = sdpChainRef.current.then(work).catch((err) => {
      const message = err instanceof Error ? err.message : "WebRTC negotiation failed.";
      setMediaError(message);
    });
    return sdpChainRef.current;
  }, []);

  const acceptOfferAndAnswer = useCallback(
    async (pc: RTCPeerConnection, offer: RTCSessionDescriptionInit) => {
      if (negotiatingRef.current) return;
      if (pc.localDescription?.type === "answer") return;

      negotiatingRef.current = true;
      try {
        if (pc.signalingState === "have-local-offer") {
          await pc.setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit);
        }

        if (pc.signalingState === "stable") {
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
        }

        const stateBeforeAttach = pc.signalingState;
        if (stateBeforeAttach !== "have-remote-offer" && stateBeforeAttach !== "have-local-pranswer") {
          return;
        }

        const localStream = localStreamRef.current;
        if (localStream) {
          await tryAddVideoTrack(localStream, pc);
          attachLocalStreamToPeerConnection(pc, localStream);
        }

        await flushPendingIce(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc.localDescription) {
          postSignal("answer", pc.localDescription.toJSON());
        }
      } finally {
        negotiatingRef.current = false;
      }
    },
    [flushPendingIce, postSignal]
  );

  const attachRemoteTrack = useCallback(
    (track: MediaStreamTrack, inboundStream?: MediaStream) => {
      if (track.readyState === "ended") return;

      const localStream = localStreamRef.current;
      if (localStream?.getTracks().some((t) => t.id === track.id)) return;

      if (inboundStream) {
        remoteStreamRef.current = inboundStream;
      } else {
        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream();
        }
        const remote = remoteStreamRef.current;
        if (!remote.getTracks().some((t) => t.id === track.id)) {
          remote.addTrack(track);
        }
      }

      setRemoteReady(true);
      setVideoBindTick((n) => n + 1);
      bindVideoElements();
    },
    [bindVideoElements]
  );

  const syncRemoteReceivers = useCallback(
    (pc: RTCPeerConnection) => {
      for (const receiver of pc.getReceivers()) {
        if (receiver.track) {
          attachRemoteTrack(receiver.track);
        }
      }
    },
    [attachRemoteTrack]
  );

  const markMediaConnected = useCallback(
    (pc: RTCPeerConnection) => {
      syncRemoteReceivers(pc);
      bindVideoElements();
      if (
        pc.connectionState === "connected" ||
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        notifyCallLive();
      }
    },
    [syncRemoteReceivers, bindVideoElements, notifyCallLive]
  );

  const sendRenegotiationOffer = useCallback(
    async (pc: RTCPeerConnection) => {
      if (renegotiatingRef.current || isCallerRef.current) return;
      if (pc.signalingState !== "stable") return;
      if (!pc.remoteDescription) return;

      renegotiatingRef.current = true;
      try {
        const stream = localStreamRef.current;
        if (stream) {
          attachLocalStreamToPeerConnection(pc, stream);
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
    negotiatingRef.current = false;
    sdpChainRef.current = Promise.resolve();
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    pendingIceRef.current = [];
    pendingSignalsRef.current = [];
    processedIdsRef.current.clear();
    callLiveNotifiedRef.current = false;
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
        const offerSdp = signal.payload;

        await enqueueSdpWork(async () => {
          const activePc = pcRef.current;
          if (!activePc) return;

          try {
            if (isCallerRef.current) {
              if (activePc.signalingState === "stable") {
                await acceptOfferAndAnswer(activePc, offerSdp);
              } else if (activePc.signalingState === "have-local-offer") {
                await activePc.setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit);
                await acceptOfferAndAnswer(activePc, offerSdp);
              }
            } else {
              if (activePc.localDescription?.type === "answer") return;
              await acceptOfferAndAnswer(activePc, offerSdp);
            }
            setMediaError(null);
          } catch (err) {
            const message = err instanceof Error ? err.message : "WebRTC offer negotiation failed.";
            setMediaError(message);
          }
        });
      } else if (signal.signalType === "answer" && isCallerRef.current) {
        if (!hasSessionDescription(signal.payload)) return;
        const answerSdp = signal.payload;

        await enqueueSdpWork(async () => {
          const activePc = pcRef.current;
          if (!activePc) return;
          if (activePc.signalingState !== "have-local-offer") return;

          try {
            await activePc.setRemoteDescription(new RTCSessionDescription(answerSdp));
            markMediaConnected(activePc);
            await flushPendingIce(activePc);
            setRemoteReady(Boolean(remoteStreamRef.current?.getTracks().length));
            setVideoBindTick((n) => n + 1);
            void pollPeerSignalsRef.current?.();
            setMediaError(null);
          } catch (err) {
            const message = err instanceof Error ? err.message : "WebRTC answer negotiation failed.";
            setMediaError(message);
          }
        });
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
    [acceptOfferAndAnswer, enqueueSdpWork, flushPendingIce, teardownMedia, markMediaConnected]
  );

  const ingestRemoteSignal = useCallback(
    (signal: WebRTCSignalMessage) => {
      if (processedIdsRef.current.has(signal.id)) return;
      if (!pcRef.current) {
        pendingSignalsRef.current.push(signal);
        return;
      }
      processedIdsRef.current.add(signal.id);
      void handleRemoteSignalRef.current(signal).catch((err) => {
        const message = err instanceof Error ? err.message : "WebRTC negotiation failed.";
        setMediaError(message);
      });
    },
    []
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
        ingestRemoteSignalRef.current({
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
  }, []);

  ingestRemoteSignalRef.current = ingestRemoteSignal;
  handleRemoteSignalRef.current = handleRemoteSignal;
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
    });

    return unsubscribe;
  }, [enabled, sessionId, role]);

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
      ingestRemoteSignalRef.current(signal);
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

        pc.ontrack = (event) => {
          const inbound = event.streams?.[0];
          if (inbound) {
            attachRemoteTrack(event.track, inbound);
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
          if (pc.connectionState === "connected") {
            markMediaConnected(pc);
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
            markMediaConnected(pc);
          }
        };

        if (isCallerRef.current) {
          attachLocalStreamToPeerConnection(pc, stream);
          if (!stream.getVideoTracks().some((t) => t.readyState === "live")) {
            await tryAddVideoTrack(stream, pc);
          }
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
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
              activePc.signalingState === "stable" ||
              activePc.remoteDescription?.type === "answer"
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
          ingestRemoteSignalRef.current(signal);
        }

        stopPollTimer();
        const runBurstPoll = async () => {
          for (let i = 0; i < 16 && !cancelled && mountId === mountGenRef.current; i++) {
            await pollPeerSignalsRef.current?.();
            const pcState = pcRef.current?.connectionState;
            if (pcState === "connected" || pcState === "closed") break;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        };
        void runBurstPoll();
        pollTimerRef.current = setInterval(() => {
          void pollPeerSignalsRef.current?.();
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
    // Keep this effect tied to session lifecycle only — extra deps were tearing down mid-call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId]);

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
