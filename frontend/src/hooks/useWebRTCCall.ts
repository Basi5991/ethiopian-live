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
  ],
};

function hasSessionDescription(payload: unknown): payload is RTCSessionDescriptionInit {
  return Boolean(payload && typeof payload === "object" && "type" in payload && "sdp" in payload);
}

function hasIceCandidate(payload: unknown): payload is RTCIceCandidateInit {
  return Boolean(payload && typeof payload === "object" && "candidate" in payload);
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
      /* try next */
    }
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
  onCallLive?: () => void;
}

function attachLocalTracks(pc: RTCPeerConnection, stream: MediaStream) {
  for (const track of stream.getTracks()) {
    if (track.readyState !== "live") continue;
    const attached = pc.getSenders().some((sender) => sender.track?.id === track.id);
    if (!attached) {
      pc.addTrack(track, stream);
    }
  }
}

function hasLocalSenders(pc: RTCPeerConnection): boolean {
  return pc.getSenders().some((sender) => sender.track && sender.track.readyState === "live");
}

function mergeRemoteTrack(existing: MediaStream | null, track: MediaStreamTrack): MediaStream {
  const stream = existing ?? new MediaStream();
  if (!stream.getTracks().some((t) => t.id === track.id)) {
    stream.addTrack(track);
  }
  return stream;
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
  const mountGenRef = useRef(0);
  const ownsLocalStreamRef = useRef(false);
  const endedSessionsRef = useRef<Set<string>>(new Set());
  const sdpChainRef = useRef(Promise.resolve());
  const callLiveNotifiedRef = useRef(false);
  const localMediaReadyRef = useRef<{
    promise: Promise<void>;
    resolve: () => void;
  } | null>(null);

  const onPeerHangupRef = useRef(onPeerHangup);
  const onCallLiveRef = useRef(onCallLive);
  const bindVideoElementsRef = useRef<() => void>(() => {});
  const pollPeerSignalsRef = useRef<(() => Promise<void>) | null>(null);
  const handleSignalRef = useRef<(signal: WebRTCSignalMessage) => Promise<void>>(async () => {});

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

  bindVideoElementsRef.current = bindVideoElements;

  useLayoutEffect(() => {
    bindVideoElements();
  });

  const notifyCallLive = useCallback(() => {
    if (callLiveNotifiedRef.current) return;
    callLiveNotifiedRef.current = true;
    onCallLiveRef.current?.();
  }, []);

  const setRemoteStream = useCallback((stream: MediaStream) => {
    remoteStreamRef.current = stream;
    setRemoteReady(true);
    setVideoBindTick((n) => n + 1);
    bindVideoElementsRef.current();
  }, []);

  const postSignal = useCallback((signalType: WebRTCSignalMessage["signalType"], payload: unknown) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const senderRole = roleRef.current;
    const socket = getCallSocket(getCurrentUserIdForSocket(senderRole), senderRole);
    socket.send(`webrtc.${signalType}`, { sessionId: sid, payload: (payload as Record<string, unknown>) || {} });

    void fetch(apiUrl(`/api/webrtc/${sid}/signal`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderRole, signalType, payload: payload ?? {} }),
    }).catch(() => {});
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

  const enqueueSdp = useCallback((work: () => Promise<void>) => {
    sdpChainRef.current = sdpChainRef.current.then(work).catch((err) => {
      const message = err instanceof Error ? err.message : "WebRTC negotiation failed.";
      setMediaError(message);
    });
  }, []);

  const applyAnswerAsCaller = useCallback(
    async (pc: RTCPeerConnection, answer: RTCSessionDescriptionInit) => {
      if (pc.signalingState !== "have-local-offer") return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await flushPendingIce(pc);
      bindVideoElementsRef.current();
      notifyCallLive();
    },
    [flushPendingIce, notifyCallLive]
  );

  const sendCalleeRenegotiationOffer = useCallback(
    async (pc: RTCPeerConnection) => {
      if (isCallerRef.current || hasLocalSenders(pc)) return;

      await localMediaReadyRef.current?.promise;
      const localStream = localStreamRef.current;
      if (!localStream) return;

      attachLocalTracks(pc, localStream);
      if (!hasLocalSenders(pc)) return;

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (pc.localDescription) {
          postSignal("offer", pc.localDescription.toJSON());
        }
      } catch {
        /* retry when media arrives */
      }
    },
    [postSignal]
  );

  const applyRenegotiationOffer = useCallback(
    async (pc: RTCPeerConnection, offer: RTCSessionDescriptionInit) => {
      if (pc.remoteDescription?.sdp === offer.sdp) return;

      if (pc.signalingState === "have-local-offer") {
        await pc.setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit);
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await flushPendingIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (pc.localDescription) {
        postSignal("answer", pc.localDescription.toJSON());
      }
    },
    [flushPendingIce, postSignal]
  );

  const applyOfferAsCallee = useCallback(
    async (pc: RTCPeerConnection, offer: RTCSessionDescriptionInit) => {
      if (pc.localDescription?.type === "answer") return;

      const remoteSdp = pc.remoteDescription?.sdp;
      if (remoteSdp && remoteSdp === offer.sdp) return;

      if (pc.signalingState === "have-local-offer") {
        await pc.setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit);
      }

      if (pc.signalingState === "stable") {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
      }

      if (pc.signalingState !== "have-remote-offer" && pc.signalingState !== "have-local-pranswer") {
        return;
      }

      await localMediaReadyRef.current?.promise;

      const localStream = localStreamRef.current;
      if (localStream) {
        attachLocalTracks(pc, localStream);
      }

      await flushPendingIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (pc.localDescription) {
        postSignal("answer", pc.localDescription.toJSON());
      }

      if (!hasLocalSenders(pc)) {
        void sendCalleeRenegotiationOffer(pc);
      }
    },
    [flushPendingIce, postSignal, sendCalleeRenegotiationOffer]
  );

  const handleSignal = useCallback(
    async (signal: WebRTCSignalMessage) => {
      const pc = pcRef.current;
      if (!pc) return;

      if (signal.signalType === "offer" && hasSessionDescription(signal.payload)) {
        if (isCallerRef.current) {
          if (pc.remoteDescription?.type === "answer") {
            enqueueSdp(() => applyRenegotiationOffer(pc, signal.payload));
          }
          return;
        }
        enqueueSdp(() => applyOfferAsCallee(pc, signal.payload));
        return;
      }

      if (signal.signalType === "answer" && isCallerRef.current && hasSessionDescription(signal.payload)) {
        enqueueSdp(() => applyAnswerAsCaller(pc, signal.payload));
        return;
      }

      if (signal.signalType === "ice" && hasIceCandidate(signal.payload)) {
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
        return;
      }

      if (signal.signalType === "hangup") {
        const sid = sessionIdRef.current;
        if (sid) endedSessionsRef.current.add(sid);
        pc.close();
        pcRef.current = null;
        onPeerHangupRef.current?.(sid || "");
      }
    },
    [applyAnswerAsCaller, applyOfferAsCallee, applyRenegotiationOffer, enqueueSdp]
  );

  handleSignalRef.current = handleSignal;

  const ingestSignal = useCallback((signal: WebRTCSignalMessage) => {
    if (processedIdsRef.current.has(signal.id)) return;
    if (!pcRef.current) {
      pendingSignalsRef.current.push(signal);
      return;
    }
    processedIdsRef.current.add(signal.id);
    void handleSignalRef.current(signal).catch(() => {
      processedIdsRef.current.delete(signal.id);
    });
  }, []);

  const pollPeerSignals = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || endedSessionsRef.current.has(sid)) return;

    const peerRole = roleRef.current === "client" ? "interpreter" : "client";
    try {
      const res = await fetch(apiUrl(`/api/webrtc/${sid}/signals?peer=${peerRole}`));
      if (!res.ok) return;
      const data = (await res.json()) as { signals?: WebRTCSignalMessage[] };
      for (const raw of data.signals || []) {
        ingestSignal({
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
  }, [ingestSignal]);

  pollPeerSignalsRef.current = pollPeerSignals;

  const stopTimers = useCallback(() => {
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
    stopTimers();
    pcRef.current?.close();
    pcRef.current = null;
    if (ownsLocalStreamRef.current) {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    }
    localStreamRef.current = null;
    ownsLocalStreamRef.current = false;
    remoteStreamRef.current = null;
    pendingIceRef.current = [];
    pendingSignalsRef.current = [];
    processedIdsRef.current.clear();
    callLiveNotifiedRef.current = false;
    localMediaReadyRef.current = null;
    sdpChainRef.current = Promise.resolve();
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setLocalReady(false);
    setRemoteReady(false);
    setPlaybackBlocked(false);
    setIsMuted(false);
    setConnectionState("closed");
  }, [stopTimers]);

  const endCall = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) endedSessionsRef.current.add(sid);
    postSignal("hangup", {});
    teardownMedia();
  }, [postSignal, teardownMedia]);

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

  useEffect(() => {
    if (!enabled || !sessionId) return;
    const socket = getCallSocket(getCurrentUserIdForSocket(role), role);
    return socket.subscribe((message) => {
      if (message.type !== "call.accepted") return;
      if (!("session" in message) || message.session?.id !== sessionId) return;
      void pollPeerSignalsRef.current?.();
    });
  }, [enabled, sessionId, role]);

  useEffect(() => {
    if (!enabled || !sessionId || endedSessionsRef.current.has(sessionId)) return;

    const mountId = ++mountGenRef.current;
    let cancelled = false;

    const socket = getCallSocket(getCurrentUserIdForSocket(role), role);
    const unsubscribe = socket.subscribe((message) => {
      if (!message.type.startsWith("webrtc.")) return;
      if (!("sessionId" in message) || message.sessionId !== sessionIdRef.current) return;
      if (!("senderRole" in message) || message.senderRole === roleRef.current) return;

      ingestSignal({
        id: message.signal?.id || `${message.type}_${Date.now()}`,
        senderRole: message.senderRole,
        signalType: message.type.replace("webrtc.", "") as WebRTCSignalMessage["signalType"],
        payload: message.signal?.payload || message.payload || {},
        createdAt: message.signal?.createdAt || new Date().toISOString(),
      });
    });

    const mediaGate = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    })();
    localMediaReadyRef.current = mediaGate;

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
          if (ownsLocalStreamRef.current) stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStreamRef.current = stream;
        mediaGate.resolve();
        setLocalReady(true);
        setIsMuted(false);
        setMediaError(null);
        setVideoBindTick((n) => n + 1);

        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;

        pc.ontrack = (event) => {
          let stream = remoteStreamRef.current ?? event.streams[0] ?? new MediaStream();
          stream = mergeRemoteTrack(stream, event.track);
          if (event.streams[0]) {
            for (const track of event.streams[0].getTracks()) {
              stream = mergeRemoteTrack(stream, track);
            }
          }
          setRemoteStream(stream);
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            postSignal("ice", event.candidate.toJSON());
          }
        };

        pc.onconnectionstatechange = () => {
          setConnectionState(pc.connectionState);
          if (pc.connectionState === "connected") {
            bindVideoElementsRef.current();
            notifyCallLive();
          }
        };

        if (isCallerRef.current) {
          attachLocalTracks(pc, stream);
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
            if (activePc.remoteDescription?.type === "answer" || activePc.connectionState === "connected") {
              if (offerRepublishTimerRef.current) {
                clearInterval(offerRepublishTimerRef.current);
                offerRepublishTimerRef.current = null;
              }
              return;
            }
            if (activePc.localDescription?.type === "offer") {
              postSignal("offer", activePc.localDescription.toJSON());
            }
          }, 2000);
        }

        for (const signal of pendingSignalsRef.current) {
          ingestSignal(signal);
        }
        pendingSignalsRef.current = [];

        pollTimerRef.current = setInterval(() => {
          void pollPeerSignalsRef.current?.();
        }, 500);

        void pollPeerSignalsRef.current?.();
      } catch (err) {
        mediaGate.resolve();
        if (cancelled || mountId !== mountGenRef.current) return;
        setMediaError(err instanceof Error ? err.message : "Could not access camera/microphone.");
      }
    };

    void start();

    return () => {
      cancelled = true;
      unsubscribe();
      if (mountId === mountGenRef.current) teardownMedia();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId]);

  useEffect(() => {
    bindVideoElements();
  }, [localReady, remoteReady, bindVideoElements]);

  useEffect(() => {
    const pc = pcRef.current;
    if (!enabled || !sessionId || !pc || !initialStream) return;
    if (localStreamRef.current === initialStream) {
      attachLocalTracks(pc, initialStream);
      void sendCalleeRenegotiationOffer(pc);
      return;
    }
    localStreamRef.current = initialStream;
    ownsLocalStreamRef.current = false;
    setLocalReady(true);
    attachLocalTracks(pc, initialStream);
    bindVideoElementsRef.current();
    void sendCalleeRenegotiationOffer(pc);
  }, [enabled, initialStream, sendCalleeRenegotiationOffer, sessionId]);

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
