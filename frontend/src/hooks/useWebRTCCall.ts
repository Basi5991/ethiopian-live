import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
      pc.addTrack(videoTrack, stream);
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
}: UseWebRTCCallOptions) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const processedIdsRef = useRef<Set<string>>(new Set());
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  const postSignal = useCallback(async (signalType: WebRTCSignalMessage["signalType"], payload: unknown) => {
    const sid = sessionIdRef.current;
    if (!sid) return false;
    const res = await fetch(`/api/webrtc/${sid}/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderRole: roleRef.current, signalType, payload }),
    });
    return res.ok;
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

  const attachRemoteTrack = useCallback(
    (track: MediaStreamTrack) => {
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
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        await postSignal("offer", offer);
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
    processedIdsRef.current.clear();
    setLocalReady(false);
    setRemoteReady(false);
    setPlaybackBlocked(false);
    setConnectionState("closed");
  }, [stopPollTimer]);

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
        if (pc.signalingState === "stable") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit));
          await flushPendingIce(pc);
          const answer = await pc.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
          await pc.setLocalDescription(answer);
          await postSignal("answer", answer);
        } else if (pc.signalingState === "have-local-offer" && isCallerRef.current) {
          // Roll back our offer and accept the remote one (glare handling)
          await pc.setRemoteDescription(new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit));
          await flushPendingIce(pc);
          const answer = await pc.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
          await pc.setLocalDescription(answer);
          await postSignal("answer", answer);
        }
      } else if (signal.signalType === "answer" && isCallerRef.current) {
        if (pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit));
          await flushPendingIce(pc);
        }
      } else if (signal.signalType === "ice") {
        const candidate = signal.payload as RTCIceCandidateInit;
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
    [flushPendingIce, postSignal, teardownMedia]
  );

  const pollSignalsRef = useRef<() => Promise<void>>(async () => {});

  pollSignalsRef.current = async () => {
    const sid = sessionIdRef.current;
    if (!sid || !pcRef.current) return;
    const peer = roleRef.current === "client" ? "interpreter" : "client";

    try {
      const res = await fetch(`/api/webrtc/${sid}/signals?peer=${peer}`);
      if (!res.ok) return;
      const data = await res.json();
      const signals: WebRTCSignalMessage[] = data.signals || [];

      for (const signal of signals) {
        if (processedIdsRef.current.has(signal.id)) continue;
        processedIdsRef.current.add(signal.id);
        await handleRemoteSignal(signal);
      }
    } catch {
      /* retry on next poll */
    }
  };

  const clearServerSignals = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    fetch(`/api/webrtc/${sid}/signals/clear`, { method: "DELETE" }).catch(() => {});
  }, []);

  const endCall = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) {
      endedSessionsRef.current.add(sid);
    }
    await postSignal("hangup", {});
    clearServerSignals();
    teardownMedia();
  }, [postSignal, clearServerSignals, teardownMedia]);

  useEffect(() => {
    if (!enabled || !sessionId) {
      return;
    }

    if (endedSessionsRef.current.has(sessionId)) {
      return;
    }

    const mountId = ++mountGenRef.current;
    let cancelled = false;

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
        setMediaError(null);
        setVideoBindTick((n) => n + 1);

        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (event) => {
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
          if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
            setRemoteReady(true);
            setVideoBindTick((n) => n + 1);
          }
        };

        // Callee: ensure video is attached before answering the client's offer
        if (!isCallerRef.current) {
          const addedVideo = await tryAddVideoTrack(stream, pc);
          if (addedVideo) {
            setVideoBindTick((n) => n + 1);
            bindVideoElements();
          }
        }

        if (isCallerRef.current) {
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          });
          await pc.setLocalDescription(offer);
          await postSignal("offer", offer);
        }

        await pollSignalsRef.current();
        stopPollTimer();
        pollTimerRef.current = setInterval(() => {
          void pollSignalsRef.current();
        }, 400);

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
    resumeRemoteMedia,
    endCall,
  };
}
