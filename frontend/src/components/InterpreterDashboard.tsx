import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Calendar, Check, Power, Briefcase, FileText, AlertTriangle, 
  Clock, TrendingUp, Download, ArrowUpRight, DollarSign, Sliders, Play, Ban, Sparkles, Send,
  Phone, PhoneCall, PhoneOff, Smartphone, Mic, MicOff, VideoOff, Volume2, ShieldAlert, Wifi,
  User as UserIcon, Languages, X, Loader2
} from "lucide-react";
import { User, Session, Transaction, InterpreterAvailability, Slot } from "../types";
import WebRTCCallPanel from "./WebRTCCallPanel";
import { acquireCallMedia } from "../hooks/useWebRTCCall";
import { apiUrl } from "../lib/apiUrl";
import { getCallSocket } from "../lib/callSocket";
import { callPanelStatus, mergeLiveSession, shouldInterpreterNegotiateWebRTC } from "../lib/liveSession";
import {
  formatLanguageProficiencies,
  findIncomingSessionForInterpreter,
  isDirectDialSession,
  isIncomingCallForInterpreter,
} from "../lib/interpreterMatching";

let incomingRingAudioContext: AudioContext | null = null;

const unlockIncomingCallAudio = async () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return false;

    incomingRingAudioContext = incomingRingAudioContext || new AudioContextClass();
    if (incomingRingAudioContext.state === "suspended") {
      await incomingRingAudioContext.resume();
    }
    return incomingRingAudioContext.state === "running";
  } catch {
    return false;
  }
};

// Dynamic Incoming Call ring signaler
const playIncomingCallBeep = async () => {
  try {
    const audioCtx = incomingRingAudioContext || new (window.AudioContext || (window as any).webkitAudioContext)();
    incomingRingAudioContext = audioCtx;
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc1.frequency.setValueAtTime(853, audioCtx.currentTime);
    osc2.frequency.setValueAtTime(960, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.04, audioCtx.currentTime); // gentle
    
    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc1.start();
    osc2.start();
    
    setTimeout(() => {
      osc1.stop();
      osc2.stop();
    }, 800);
  } catch (e) {}
};

const playBeepTone = (frequency: number, durationMs: number) => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime); // gentle volume
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      audioCtx.close();
    }, durationMs);
  } catch (e) {}
};

interface InterpreterDashboardProps {
  users: User[];
  sessions: Session[];
  transactions: Transaction[];
  availabilities: InterpreterAvailability[];
  onActionComplete: () => void;
  theme?: string;
}

interface IncomingCallCardProps {
  session: Session;
  interpreterId: string;
  isAccepting: boolean;
  acceptPhase: "idle" | "media" | "connecting";
  countdown: number;
  ringAudioReady: boolean;
  acceptError: string;
  interpreterLanguages: string[];
  languageProficiencies?: User["languageProficiencies"];
  theme: string;
  onAccept: (sessionId: string) => void;
  onDecline: (sessionId: string) => void;
  onEnableRing: () => void;
}

function IncomingCallCard({
  session,
  interpreterId,
  isAccepting,
  acceptPhase,
  countdown,
  ringAudioReady,
  acceptError,
  interpreterLanguages,
  languageProficiencies,
  theme,
  onAccept,
  onDecline,
  onEnableRing,
}: IncomingCallCardProps) {
  const isDirect = isDirectDialSession(session, interpreterId);
  const commission = (session.cost * 0.85).toFixed(2);
  const surface =
    theme === "light"
      ? "bg-white border-slate-200 text-slate-900 shadow-2xl"
      : "bg-[#121218] border-white/10 text-white shadow-2xl shadow-black/40";
  const borderClass = isDirect ? "border-emerald-500/40" : "border-amber-500/40";
  const topBarClass = isDirect
    ? "bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-600"
    : "bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 12 }}
      className={`relative w-full max-w-xl rounded-3xl border-2 overflow-hidden ${borderClass} ${surface}`}
    >
      <div className={`absolute inset-x-0 top-0 h-1 ${topBarClass}`} />

      <div className="p-6 sm:p-7 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                isDirect
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
              }`}
            >
              <span className={`w-2 h-2 rounded-full animate-pulse ${isDirect ? "bg-emerald-400" : "bg-amber-400"}`} />
              {isDirect ? "Direct call" : "Broadcast match"}
            </span>
            {!isDirect && (
              <span className="text-[10px] font-mono text-amber-400/90 bg-black/30 px-2 py-1 rounded-lg border border-white/5">
                {countdown}s
              </span>
            )}
          </div>
          {!isAccepting && (
            <button
              type="button"
              onClick={() => onDecline(session.id)}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
              aria-label="Dismiss call"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div
            className={`relative w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem] rounded-2xl flex items-center justify-center shrink-0 ${
              isDirect
                ? "bg-emerald-500/10 border-2 border-emerald-500/30"
                : "bg-amber-500/10 border-2 border-amber-500/30"
            }`}
          >
            <UserIcon className={`w-8 h-8 ${isDirect ? "text-emerald-400" : "text-amber-400"}`} />
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 border-2 border-[#121218] animate-ping" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Incoming client</p>
            <h3 className="text-xl sm:text-2xl font-black truncate">{session.clientName || "Client"}</h3>
            <p className="text-xs text-slate-400 mt-0.5 capitalize">{session.serviceType} interpretation</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className={`rounded-2xl border p-3 ${theme === "light" ? "bg-slate-50 border-slate-200" : "bg-white/[0.03] border-white/5"}`}>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-slate-500 mb-1">
              <Languages className="w-3.5 h-3.5" />
              Language pair
            </div>
            <p className="text-sm font-bold">
              {session.languageFrom} ⇆ {session.languageTo}
            </p>
          </div>
          <div className={`rounded-2xl border p-3 ${theme === "light" ? "bg-slate-50 border-slate-200" : "bg-white/[0.03] border-white/5"}`}>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-slate-500 mb-1">
              <DollarSign className="w-3.5 h-3.5" />
              Your earnings
            </div>
            <p className="text-sm font-bold text-emerald-400 font-mono">{commission} ETB</p>
          </div>
        </div>

        {!isDirect && (
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Matched to your profile:{" "}
            <span className="text-slate-300">
              {formatLanguageProficiencies(interpreterLanguages, languageProficiencies)}
            </span>
          </p>
        )}

        {acceptError && (
          <div className="px-3 py-2 rounded-xl bg-red-950/40 border border-red-500/30 text-red-300 text-xs">
            {acceptError}
          </div>
        )}

        {!ringAudioReady && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-blue-950/30 border border-blue-500/25 text-blue-100 text-xs">
            <span>Ring sound is muted until you enable audio.</span>
            <button
              type="button"
              onClick={onEnableRing}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase shrink-0"
            >
              Enable sound
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            disabled={isAccepting}
            onClick={() => onAccept(session.id)}
            className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 font-black text-sm uppercase rounded-2xl text-white flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition active:scale-[0.98]"
          >
            {isAccepting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {acceptPhase === "media" ? "Starting camera…" : "Joining call…"}
              </>
            ) : (
              <>
                <Phone className="w-4 h-4" />
                Accept call
              </>
            )}
          </button>
          <button
            type="button"
            disabled={isAccepting}
            onClick={() => onDecline(session.id)}
            className={`w-full py-3.5 px-4 font-bold text-sm uppercase rounded-2xl flex items-center justify-center gap-2 transition active:scale-[0.98] disabled:opacity-50 ${
              theme === "light"
                ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                : "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
            }`}
          >
            <PhoneOff className="w-4 h-4" />
            Decline
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function InterpreterDashboard({ 
  users, 
  sessions, 
  transactions, 
  availabilities, 
  onActionComplete,
  theme = "dark"
}: InterpreterDashboardProps) {
  // Retrieve authenticated user from localStorage
  const savedUser = (() => {
    try {
      const saved = localStorage.getItem("orzo_auth_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  })();

  // Current logged in interpreter — hydrate from /api/init so languages are always present.
  const currentInterpreter = React.useMemo(() => {
    if (savedUser?.role === "interpreter") {
      const hydrated = users.find((u) => u.id === savedUser.id);
      return hydrated ? { ...savedUser, ...hydrated } : savedUser;
    }
    return users.find((u) => u.role === "interpreter") || users[2];
  }, [savedUser, users]);
  const interpreterId = currentInterpreter?.id || "usr_int1";
  const interpreterLanguages =
    currentInterpreter?.languages ??
    currentInterpreter?.languageProficiencies?.map((entry) => entry.language) ??
    [];
  const callSocket = React.useMemo(() => getCallSocket(interpreterId, "interpreter"), [interpreterId]);

  // Dashboard Slider Section Switcher
  const [dashboardSlide, setDashboardSlide] = useState<"dispatch" | "earnings">("dispatch");

  // Scheduler slot templates
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const [selectedDay, setSelectedDay] = useState("Monday");
  const [startHour, setStartHour] = useState("09:00");
  const [endHour, setEndHour] = useState("17:00");
  const [recurringSlot, setRecurringSlot] = useState(true);

  // Status state
  const [onlineStatus, setOnlineStatus] = useState<"active" | "offline" | "busy">("active");

  // Withdrawal payload
  const [payoutAmount, setPayoutAmount] = useState("500");
  const [bankAccount, setBankAccount] = useState("100084772134");
  const [bankName, setBankName] = useState("Commercial Bank of Ethiopia (CBE)");
  const [payoutSuccess, setPayoutSuccess] = useState(false);
  const [payoutError, setPayoutError] = useState("");

  // Live session chat
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [callMediaStream, setCallMediaStream] = useState<MediaStream | null>(null);
  const [dismissedSessionId, setDismissedSessionId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);

  // Active incoming requests that could be accepted
  const [incomingRequest, setIncomingRequest] = useState<Session | null>(null);
  const [countdown, setCountdown] = useState(60);
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptPhase, setAcceptPhase] = useState<"idle" | "media" | "connecting">("idle");
  const [acceptError, setAcceptError] = useState("");
  const [ringAudioReady, setRingAudioReady] = useState(false);
  const acceptedSessionIds = useRef<Set<string>>(new Set());
  const endedSessionIds = useRef<Set<string>>(new Set());
  const ringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [callLockSessionId, setCallLockSessionId] = useState<string | null>(null);
  const activeSessionRef = useRef<Session | null>(null);
  const incomingRequestRef = useRef<Session | null>(null);
  const callLockSessionIdRef = useRef<string | null>(null);
  const onlineStatusRef = useRef(onlineStatus);
  const onActionCompleteRef = useRef(onActionComplete);

  activeSessionRef.current = activeSession;
  incomingRequestRef.current = incomingRequest;
  callLockSessionIdRef.current = callLockSessionId;
  onlineStatusRef.current = onlineStatus;
  onActionCompleteRef.current = onActionComplete;
  const stopIncomingRing = () => {
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
  };
  const visibleIncomingRequest =
    incomingRequest &&
    !isAccepting &&
    !activeSession &&
    !callLockSessionId &&
    !acceptedSessionIds.current.has(incomingRequest.id) &&
    !endedSessionIds.current.has(incomingRequest.id)
      ? incomingRequest
      : null;

  useEffect(() => {
    const unlock = () => {
      void unlockIncomingCallAudio().then(setRingAudioReady);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const clearCallMedia = () => {
    setCallMediaStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
  };

  const markSessionEnded = useCallback((sessionId: string) => {
    endedSessionIds.current.add(sessionId);
    setDismissedSessionId(sessionId);
    acceptedSessionIds.current.delete(sessionId);
    setCallLockSessionId(null);
    setActiveSession(null);
    setIncomingRequest(null);
    stopIncomingRing();
    clearCallMedia();
  }, []);

  useEffect(() => {
    return callSocket.subscribe((message) => {
      if (message.type === "call.ringing") {
        const session = message.session;
        if (session.status !== "incoming") return;
        if (endedSessionIds.current.has(session.id)) return;
        if (acceptedSessionIds.current.has(session.id)) return;
        if (callLockSessionIdRef.current === session.id) return;
        if (
          session.interpreterId &&
          session.interpreterId !== interpreterId
        ) {
          return;
        }
        if (
          !isIncomingCallForInterpreter(session, interpreterId, interpreterLanguages)
        ) {
          return;
        }
        if (
          onlineStatusRef.current === "active" &&
          !activeSessionRef.current &&
          !callLockSessionIdRef.current
        ) {
          setIncomingRequest(session);
        }
      } else if (message.type === "call.accepted") {
        if (endedSessionIds.current.has(message.session.id)) return;
        const assignedInterpreterId = message.session.interpreterId;
        if (assignedInterpreterId === interpreterId) {
          acceptedSessionIds.current.add(message.session.id);
          setCallLockSessionId(message.session.id);
          stopIncomingRing();
          setIncomingRequest(null);
          setActiveSession((prev) => mergeLiveSession(prev, { ...message.session, status: "active" }));
          onActionCompleteRef.current();
        } else if (incomingRequestRef.current?.id === message.session.id) {
          setIncomingRequest(null);
          stopIncomingRing();
        }
        setIsAccepting(false);
      } else if (message.type === "call.ended") {
        endedSessionIds.current.add(message.session.id);
        if (
          activeSessionRef.current?.id === message.session.id ||
          incomingRequestRef.current?.id === message.session.id ||
          callLockSessionIdRef.current === message.session.id
        ) {
          markSessionEnded(message.session.id);
          onActionCompleteRef.current();
        }
      } else if (message.type === "call.error") {
        if (activeSessionRef.current?.status === "active") return;
        setAcceptError(message.error);
        setIsAccepting(false);
        setCallLockSessionId(null);
      }
    });
  }, [callSocket, interpreterId, interpreterLanguages, markSessionEnded]);

  // Ring for any language-qualified incoming call (broadcast or direct dial)
  useEffect(() => {
    stopIncomingRing();
    if (visibleIncomingRequest && onlineStatus === "active") {
      void playIncomingCallBeep().then(() => setRingAudioReady(incomingRingAudioContext?.state === "running"));
      ringIntervalRef.current = setInterval(() => void playIncomingCallBeep(), 3500);
    }
    return stopIncomingRing;
  }, [visibleIncomingRequest?.id, onlineStatus]);

  // Track state changes & live triggers
  useEffect(() => {
    const currentActive = sessions.find(
      (s) =>
        s.interpreterId === interpreterId &&
        s.status === "active" &&
        s.id !== dismissedSessionId &&
        !endedSessionIds.current.has(s.id)
    );

    // 1. Locate active session — keep optimistic accept until server confirms or call ends
    setActiveSession((prev) => {
      if (prev?.id === dismissedSessionId || endedSessionIds.current.has(prev?.id || "")) return null;

      if (currentActive) {
        setCallLockSessionId(currentActive.id);
        if (prev?.id === currentActive.id && prev.status === currentActive.status) return prev;
        return currentActive;
      }

      if (prev?.status === "active") {
        if (endedSessionIds.current.has(prev.id)) {
          setCallLockSessionId(null);
          return null;
        }
        const match = sessions.find((s) => s.id === prev.id);
        if (!match) return prev;
        if (["cancelled", "completed", "missed"].includes(match.status)) {
          endedSessionIds.current.add(prev.id);
          setCallLockSessionId(null);
          acceptedSessionIds.current.delete(prev.id);
          return null;
        }
        if (match.status === "active") return mergeLiveSession(prev, match);
        return prev;
      }

      if (callLockSessionId) {
        const locked =
          currentActive ||
          sessions.find((session) => session.id === callLockSessionId) ||
          null;
        if (locked) {
          return mergeLiveSession(prev, { ...locked, status: "active", interpreterId });
        }
      }

      return null;
    });

    const nextIncoming = findIncomingSessionForInterpreter(
      sessions,
      interpreterId,
      interpreterLanguages,
      dismissedSessionId
    );

    setIncomingRequest((prev) => {
      if (prev && (acceptedSessionIds.current.has(prev.id) || endedSessionIds.current.has(prev.id))) return null;
      if (isAccepting) return null;
      if (callLockSessionId) return null;
      if (currentActive || activeSession?.status === "active") return null;
      if (
        nextIncoming &&
        (acceptedSessionIds.current.has(nextIncoming.id) ||
          endedSessionIds.current.has(nextIncoming.id) ||
          callLockSessionId === nextIncoming.id)
      ) {
        return null;
      }
      if (nextIncoming && endedSessionIds.current.has(nextIncoming.id)) return prev;
      return prev || nextIncoming || null;
    });
  }, [sessions, onlineStatus, interpreterId, interpreterLanguages, dismissedSessionId, activeSession, isAccepting, callLockSessionId]);

  // Countdown for broadcast incoming calls — reset when a new call arrives
  useEffect(() => {
    if (visibleIncomingRequest) {
      setCountdown(60);
    }
  }, [visibleIncomingRequest?.id]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (visibleIncomingRequest) {
      interval = setInterval(() => {
        setCountdown((prev) => (prev <= 1 ? 60 : prev - 1));
      }, 1000);
    } else {
      setCountdown(60);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [visibleIncomingRequest]);

  // Status updater
  const handleStatusUpdate = async (next: "active" | "offline" | "busy") => {
    setOnlineStatus(next);
    try {
      const res = await fetch(`/api/users/${interpreterId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next === "active" ? "active" : "suspended" }) // Suspended or similar key
      });
      if (res.ok) {
        onActionComplete();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Add slots scheduler
  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    const dayAvail = availabilities.find(a => a.userId === interpreterId && a.day === selectedDay);
    const updatedSlots = dayAvail ? [...dayAvail.slots] : [];
    
    // Add slot
    updatedSlots.push({
      start: startHour,
      end: endHour,
      recurring: recurringSlot
    });

    try {
      const res = await fetch("/api/scheduler/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: interpreterId,
          day: selectedDay,
          slots: updatedSlots
        })
      });
      if (res.ok) {
        onActionComplete();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Delete slot from schedule
  const handleDeleteSlot = async (day: string, indexToDelete: number) => {
    const dayAvail = availabilities.find(a => a.userId === interpreterId && a.day === day);
    if (!dayAvail) return;

    const updatedSlots = dayAvail.slots.filter((_, idx) => idx !== indexToDelete);

    try {
      const res = await fetch("/api/scheduler/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: interpreterId,
          day,
          slots: updatedSlots
        })
      });
      if (res.ok) {
        onActionComplete();
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!visibleIncomingRequest) {
      if (!activeSessionRef.current) {
        setCallMediaStream((prev) => {
          prev?.getTracks().forEach((track) => track.stop());
          return null;
        });
      }
      return;
    }

    let cancelled = false;
    void acquireCallMedia({ preferVideo: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        setCallMediaStream((prev) => {
          prev?.getTracks().forEach((track) => track.stop());
          return stream;
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [visibleIncomingRequest?.id]);

  // Accept — notify server immediately; camera runs in parallel
  const handleAcceptRequest = async (sessionId: string) => {
    if (isAccepting) return;
    setIsAccepting(true);
    setAcceptPhase("connecting");
    setAcceptError("");

    const callSnapshot = incomingRequest?.id === sessionId ? incomingRequest : null;
    acceptedSessionIds.current.add(sessionId);
    setCallLockSessionId(sessionId);
    stopIncomingRing();
    setIncomingRequest(null);
    if (callSnapshot) {
      setDismissedSessionId(null);
      setActiveSession({
        ...callSnapshot,
        status: "active",
        interpreterId,
        interpreterName: currentInterpreter?.name,
      });
    } else {
      const knownSession = sessions.find((session) => session.id === sessionId);
      if (knownSession) {
        setActiveSession({
          ...knownSession,
          status: "active",
          interpreterId,
          interpreterName: currentInterpreter?.name,
        });
      }
    }

    const mediaPromise = callMediaStream
      ? Promise.resolve(callMediaStream)
      : acquireCallMedia({ preferVideo: true }).catch(() => null);

    try {
      const acceptPromise = fetch(apiUrl(`/api/sessions/${sessionId}/accept`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interpreterId,
          interpreterName: currentInterpreter?.name,
        }),
      });

      const [res, stream] = await Promise.all([acceptPromise, mediaPromise]);
      if (stream) {
        setCallMediaStream(stream);
      }

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.session) {
        acceptedSessionIds.current.add(sessionId);
        setCallLockSessionId(sessionId);
        setActiveSession((prev) => mergeLiveSession(prev, { ...data.session, status: "active" }));
        setIncomingRequest(null);
        onActionComplete();
      } else if (res.ok) {
        acceptedSessionIds.current.add(sessionId);
        setCallLockSessionId(sessionId);
        setIncomingRequest(null);
        onActionComplete();
      } else if (res.status === 409) {
        acceptedSessionIds.current.add(sessionId);
        setCallLockSessionId(sessionId);
        setIncomingRequest(null);
        if (data.session) {
          setActiveSession((prev) => mergeLiveSession(prev, { ...data.session, status: "active" }));
        }
        onActionComplete();
      } else if (!res.ok && data.error) {
        throw new Error(String(data.error));
      }
    } catch (err) {
      setActiveSession(null);
      setCallLockSessionId(null);
      acceptedSessionIds.current.delete(sessionId);
      setCallMediaStream((prev) => {
        prev?.getTracks().forEach((t) => t.stop());
        return null;
      });
      if (callSnapshot) {
        setIncomingRequest(callSnapshot);
      }
      setAcceptError(err instanceof Error ? err.message : "Could not accept call.");
      console.error(err);
    } finally {
      setAcceptPhase("idle");
      setIsAccepting(false);
    }
  };

  // Reject and close matching popup
  const handleDeclineRequest = async (sessionId: string) => {
    setAcceptError("");
    clearCallMedia();
    try {
      callSocket.send("call.decline", { sessionId });
    } catch (e) {
      console.error(e);
    }
    setIncomingRequest(null);
    stopIncomingRing();
    onActionComplete();
  };

  // Chat message submit inside Room
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !activeSession) return;

    const messageText = chatInput;
    setChatInput("");
    setIsTranslating(true);

    try {
      // 1. Fetch translation via server Gemini
      const transRes = await fetch("/api/gemini/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: messageText,
          fromLang: activeSession.languageTo,
          toLang: activeSession.languageFrom
        })
      });

      const transData = await transRes.json();
      const translated = transData.translatedText || "";

      // 2. Commit chat line to the live store
      await fetch(apiUrl(`/api/sessions/${activeSession.id}/chat`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderRole: "interpreter",
          senderName: currentInterpreter.name,
          text: messageText,
          translatedText: translated
        })
      });

      onActionComplete();
    } catch (err) {
      console.error(err);
    } finally {
      setIsTranslating(false);
    }
  };

  // Withdraw payout request (Chapa/Stripe)
  const handlePayoutFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayoutError("");
    const parsed = Number(payoutAmount);
    
    if (isNaN(parsed) || parsed <= 0) {
      setPayoutError("Specify amount above 0.");
      return;
    }

    try {
      const res = await fetch("/api/wallet/payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: interpreterId,
          amount: parsed,
          bankAccount,
          bankName
        })
      });

      if (res.ok) {
        setPayoutSuccess(true);
        setTimeout(() => setPayoutSuccess(false), 4000);
        onActionComplete();
      } else {
        const errorData = await res.json();
        setPayoutError(errorData.error || "Payout processing failed.");
      }
    } catch (err) {
      setPayoutError("Network connection timeout.");
    }
  };

  // Earnings aggregation
  const interpreterEarningsSum = transactions
    .filter(t => t.userId === interpreterId && t.status === "completed")
    .reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="grid grid-cols-12 gap-6 animate-fade-in font-sans">
      
      {/* Dynamic Welcoming Card Banner */}
      <div className={`col-span-12 p-6 rounded-2xl border relative overflow-hidden transition-all duration-300 ${
        theme === "light" 
          ? "bg-gradient-to-r from-emerald-50 to-teal-50/50 border-emerald-100 shadow-sm text-slate-800" 
          : "bg-gradient-to-r from-emerald-950/20 to-teal-950/20 border-white/5 backdrop-blur-xl text-slate-200"
      }`}>
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 dark:bg-emerald-400/5 rounded-full blur-2xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl">👋</span>
              <h2 className={`text-lg sm:text-xl font-bold tracking-tight ${
                theme === "light" ? "text-slate-900" : "text-white"
              }`}>
                Selam, {currentInterpreter?.name || "Linguistic Expert"}!
              </h2>
            </div>
            <p className={`text-xs ${theme === "light" ? "text-slate-600" : "text-slate-400"} max-w-xl leading-relaxed`}>
              Welcome back to your active translation desk. Keep your status set to "Online" to receive immediate connection dispatches, update your scheduled calendar slots, and review your earnings.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center">
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-slate-400 px-2.5 py-1 rounded bg-black/15 border border-white/5 whitespace-nowrap">
              Addis Ababa UTC+3
            </span>
          </div>
        </div>
      </div>
      
      {/* Top Header Panel */}
      <div className={`col-span-12 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4 ${
        theme === "light" ? "border-slate-200" : "border-white/5"
      }`}>
        <div>
          <h1 className={`text-xl font-semibold tracking-tight ${
            theme === "light" ? "text-slate-900" : "text-white"
          }`}>Interpreter Desk</h1>
          <p className="text-xs text-slate-400 mt-0.5">Control translation availability, track live sessions, and initiate withdrawals.</p>
        </div>
        
        {/* State Indicators */}
        <div className="flex flex-wrap items-center gap-3">
          <div className={`border p-1 px-1.5 rounded-lg flex items-center gap-2 ${
            theme === "light" ? "bg-slate-50 border-slate-200" : "bg-zinc-900 border-white/5"
          }`}>
            {[
              { id: "active", label: "Online", cl: "bg-emerald-500" },
              { id: "busy", label: "Busy", cl: "bg-amber-500" },
              { id: "offline", label: "Offline", cl: "bg-slate-500" }
            ].map(item => (
              <button
                key={item.id}
                onClick={() => handleStatusUpdate(item.id as any)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold uppercase rounded transition cursor-pointer ${
                  onlineStatus === item.id 
                    ? theme === "light"
                      ? "bg-white text-slate-800 border border-slate-200 shadow-sm"
                      : "bg-[#16161A] text-white border border-white/10" 
                    : theme === "light"
                      ? "text-slate-500 hover:text-slate-800"
                      : "text-slate-550 hover:text-slate-300"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${item.cl} ${onlineStatus === item.id ? "animate-pulse" : ""}`} />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Interactive Slider Section Switcher to prevent elongated scrolling */}
      <div className="col-span-12 flex items-center justify-center pt-2 pb-1">
        <div className={`p-1 rounded-2xl border flex items-center gap-1.5 w-full max-w-md relative ${
          theme === "light" ? "bg-slate-200/60 border-slate-300/40" : "bg-[#16161A]/80 border-white/5"
        }`}>
          <button
            type="button"
            onClick={() => { setDashboardSlide("dispatch"); playBeepTone(400, 50); }}
            className={`flex-1 py-2 text-center text-xs font-bold uppercase rounded-xl transition-all duration-300 relative z-10 flex items-center justify-center gap-2 cursor-pointer ${
              dashboardSlide === "dispatch"
                ? "bg-emerald-600 text-white shadow-lg shadow-emerald-500/20"
                : theme === "light" ? "text-slate-600 hover:text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            <Phone className="w-3.5 h-3.5" />
            <span>📞 Dispatch Desk</span>
          </button>
          <button
            type="button"
            onClick={() => { setDashboardSlide("earnings"); playBeepTone(440, 50); }}
            className={`flex-1 py-2 text-center text-xs font-bold uppercase rounded-xl transition-all duration-300 relative z-10 flex items-center justify-center gap-2 cursor-pointer ${
              dashboardSlide === "earnings"
                ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                : theme === "light" ? "text-slate-600 hover:text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>💳 Revenue Ledger</span>
          </button>
        </div>
      </div>

      {/* Main Core Elements grid */}
      {dashboardSlide === "dispatch" && (
        <div className={`${activeSession ? "col-span-12" : "col-span-12 lg:col-span-8"} space-y-6 animate-fade-in`}>

        {activeSession ? (
          <div className="space-y-5">
            <div
              className={`rounded-2xl border p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 ${
                theme === "light" ? "bg-white border-slate-200 shadow-sm" : "bg-[#16161A] border-white/5"
              }`}
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
                  <UserIcon className="w-6 h-6 text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      Live session
                    </span>
                    {isAccepting && (
                      <span className="text-[10px] text-amber-400 inline-flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {acceptPhase === "media" ? "Starting camera…" : "Connecting to client…"}
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg sm:text-xl font-black truncate">{activeSession.clientName}</h3>
                  <p className="text-xs text-slate-400">
                    {activeSession.languageFrom} ⇆ {activeSession.languageTo} •{" "}
                    <span className="capitalize">{activeSession.serviceType}</span>
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] uppercase text-slate-500 font-bold">Your earnings</p>
                <p className="text-xl font-black text-emerald-400 font-mono">
                  {(activeSession.cost * 0.85).toFixed(2)} ETB
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
              <div className="xl:col-span-8">
                <div key={activeSession.id}>
                  <WebRTCCallPanel
                    sessionId={activeSession.id}
                    role="interpreter"
                    isCaller={false}
                    wide
                    enabled={shouldInterpreterNegotiateWebRTC(activeSession)}
                    initialStream={callMediaStream}
                    status={callPanelStatus(activeSession)}
                    peerName={activeSession.clientName}
                    languageLabel={`${activeSession.languageFrom} ⇆ ${activeSession.languageTo}`}
                    localLabel={`You: ${currentInterpreter.name}`}
                    remoteLabel={`Client: ${activeSession.clientName}`}
                    onEndCall={async () => {
                      if (!activeSession) return;
                      const sessionId = activeSession.id;
                      markSessionEnded(sessionId);
                      try {
                        callSocket.send("call.end", { sessionId });
                      } catch (e) {
                        console.error(e);
                      }
                      onActionComplete();
                    }}
                    onPeerHangup={(sessionId) => {
                      markSessionEnded(sessionId);
                    }}
                  />
                </div>
              </div>

              <div className="xl:col-span-4">
                <div className="bg-[#16161A] border border-white/5 rounded-2xl flex flex-col h-[380px] xl:h-full xl:min-h-[420px] overflow-hidden shadow-xl">
                  <div className="p-4 border-b border-white/5 flex items-center justify-between bg-[#0F0F12]">
                    <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                      Session transcript
                    </h2>
                    <span className="bg-emerald-500/20 text-emerald-400 text-[10px] px-2 py-0.5 rounded font-bold uppercase">
                      Live
                    </span>
                  </div>

                  <div id="interpreter-chat-feed" className="flex-1 p-4 overflow-y-auto space-y-4">
                    {activeSession.chatMessages.map((msg, index) => {
                      const isYou = msg.senderRole === "interpreter";
                      const isSystem = msg.senderRole === "system";

                      if (isSystem) {
                        return (
                          <div
                            key={index}
                            className="space-y-1 block text-center py-1 border-y border-white/5 bg-zinc-900/20"
                          >
                            <p className="text-[10px] text-slate-500 font-bold uppercase">{msg.senderName}</p>
                            <p className="text-[11px] text-slate-400 italic">{msg.text}</p>
                          </div>
                        );
                      }

                      return (
                        <div key={index} className="space-y-1">
                          <p
                            className={`text-[10px] font-bold uppercase ${
                              isYou ? "text-emerald-500" : "text-blue-500"
                            }`}
                          >
                            {msg.senderName}
                          </p>
                          <div
                            className={`p-3 rounded-lg text-xs leading-relaxed ${
                              isYou
                                ? "bg-white/5 text-slate-200"
                                : "bg-blue-500/5 border-l-2 border-blue-500 text-slate-200"
                            }`}
                          >
                            <p>{msg.text}</p>
                            {msg.translatedText && (
                              <p className="text-cyan-400 text-[11px] mt-1 italic border-t border-white/5 pt-1">
                                ↳ {msg.translatedText}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {isTranslating && (
                      <p className="text-[10px] text-cyan-400 font-mono italic animate-pulse">
                        Translating…
                      </p>
                    )}
                  </div>

                  <form onSubmit={handleSendMessage} className="p-3 bg-black/30 border-t border-white/5">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder={isTranslating ? "Translating…" : "Type a message to translate…"}
                        value={chatInput}
                        disabled={isTranslating}
                        onChange={(e) => setChatInput(e.target.value)}
                        className="w-full bg-zinc-900 border border-white/10 rounded-lg pl-4 pr-10 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                      />
                      <button
                        type="submit"
                        className="absolute right-2 top-2 p-1 hover:bg-zinc-800 text-slate-400 rounded-md"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        ) : (

          /* Scheduling grid layout */
          <div className="space-y-6">
            {onlineStatus === "active" && (
              <div
                className={`rounded-2xl border border-dashed p-5 sm:p-6 text-center ${
                  theme === "light"
                    ? "border-emerald-200 bg-emerald-50/80"
                    : "border-emerald-500/25 bg-emerald-500/5"
                }`}
              >
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                  <PhoneCall className="w-6 h-6 text-emerald-400" />
                </div>
                <p className={`text-sm font-bold ${theme === "light" ? "text-slate-800" : "text-slate-200"}`}>
                  Ready for incoming calls
                </p>
                <p className={`text-xs mt-1 max-w-md mx-auto ${theme === "light" ? "text-slate-600" : "text-slate-500"}`}>
                  New requests open in a popup with client details, language pair, and earnings. Accept or decline from there.
                </p>
              </div>
            )}

            <div className="bg-[#16161A] border border-white/5 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center justify-between pb-4 border-b border-white/5">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Shift Availability Scheduler</h3>
                  <p className="text-xs text-slate-500 mt-1">Configure active hours to allow clients to schedule appointments directly.</p>
                </div>
                <Calendar className="w-5 h-5 text-blue-500" />
              </div>

              {/* Form to submit slot */}
              <form onSubmit={handleAddSlot} className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4 items-end text-xs">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-zinc-500 font-bold font-sans">Day Of Week</label>
                  <select 
                    value={selectedDay} 
                    onChange={(e) => setSelectedDay(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/10 text-slate-200 p-2.5 rounded-lg focus:outline-none"
                  >
                    {weekdays.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-zinc-500 font-bold">Start Hour</label>
                  <input 
                    type="text" 
                    value={startHour} 
                    onChange={(e) => setStartHour(e.target.value)}
                    placeholder="09:00"
                    className="w-full bg-zinc-900 border border-white/10 text-slate-200 p-2.5 rounded-lg focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-zinc-500 font-bold">End Hour</label>
                  <input 
                    type="text" 
                    value={endHour} 
                    onChange={(e) => setEndHour(e.target.value)}
                    placeholder="17:00"
                    className="w-full bg-zinc-900 border border-white/10 text-slate-200 p-2.5 rounded-lg focus:outline-none"
                  />
                </div>

                <button 
                  type="submit" 
                  className="w-full h-[40px] bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors"
                >
                  Publish Slot
                </button>
              </form>

              {/* Render configured schedules matrices */}
              <div className="space-y-2 mt-6">
                <label className="text-[10px] uppercase text-zinc-500 font-bold font-sans block mb-3">Live Active Slots Grid</label>
                {availabilities.filter(a => a.userId === interpreterId).length === 0 ? (
                  <p className="text-slate-500 text-xs italic">No configured availability. Publish slot parameters above.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {availabilities.filter(a => a.userId === interpreterId).map(avail => (
                      <div key={avail.day} className="p-3 bg-zinc-900/40 rounded-lg border border-white/10 flex flex-col gap-2">
                        <div className="flex justify-between items-center text-xs border-b border-white/5 pb-1">
                          <span className="font-sans font-bold text-white">{avail.day}</span>
                          <span className="text-[10px] text-indigo-400 font-mono">Active</span>
                        </div>
                        <div className="space-y-1.5 uppercase font-mono text-[10px] text-slate-300">
                          {avail.slots.map((sl, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-black/20 p-1.5 px-2 rounded">
                              <span>⏱️ {sl.start} - {sl.end}</span>
                              <button 
                                onClick={() => handleDeleteSlot(avail.day, idx)}
                                className="text-red-400 font-bold text-[13px] hover:text-red-600 px-1 ml-2"
                              >
                                &times;
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Visual Shift Heatmap blocks */}
              <div className="mt-6 pt-5 border-t border-white/5 space-y-3">
                <span className="text-[10px] uppercase text-zinc-500 font-bold block">Interactive Weekly Block Load Tracker</span>
                <div className="grid grid-cols-7 gap-1.5 bg-black/40 p-3 rounded-xl border border-white/5">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, dIdx) => {
                    const fullDayName = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][dIdx];
                    const activeAvail = availabilities.find(a => a.userId === interpreterId && a.day === fullDayName);
                    
                    return (
                      <div key={day} className="flex flex-col items-center gap-1.5">
                        <span className="text-[9px] text-slate-500 uppercase font-bold">{day}</span>
                        {/* Morning, Afternoon, Evening Blocks */}
                        {["08:00-12:00", "12:00-16:00", "16:00-20:00"].map((timeBlock, tbIdx) => {
                          // Check if any active user slots overlap this block
                          let active = false;
                          if (activeAvail) {
                            active = activeAvail.slots.some(sl => {
                              const sh = parseInt(sl.start.split(":")[0]);
                              if (tbIdx === 0 && sh < 12) return true;
                              if (tbIdx === 1 && sh >= 12 && sh < 16) return true;
                              if (tbIdx === 2 && sh >= 16) return true;
                              return false;
                            });
                          }
                          return (
                            <div
                              key={timeBlock}
                              style={{ contentVisibility: "auto" }}
                              title={`${fullDayName} ${timeBlock} is ${active ? "Configured Active" : "Unbooked/Offline"}`}
                              className={`w-full aspect-square rounded transition-all ${
                                active 
                                  ? "bg-emerald-500/20 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.2)]" 
                                  : "bg-zinc-900 border border-white/5"
                              }`}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-4 justify-center text-[9px] text-slate-500 uppercase font-mono">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active Coverage Slot</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-zinc-800" /> Unbooked Block</span>
                </div>
              </div>
            </div>

          </div>
        )}

      </div>
      )}

      {/* Slide 2: Revenue & Earnings Ledger */}
      {dashboardSlide === "earnings" && (
        <div className="col-span-12 lg:col-span-8 lg:col-start-2 xl:col-span-6 xl:col-start-4 space-y-6 animate-fade-in">

          {/* Withdrawal payout requests panel */}
          <div className="bg-[#16161A] p-5 rounded-2xl border border-white/5 space-y-4 shadow-xl">
          <div className="flex justify-between items-center border-b border-white/5 pb-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Withdrawal Disbursement</h3>
            <span className="text-emerald-400 text-xs font-mono font-bold bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10">
              {currentInterpreter.completedSessions} sessions
            </span>
          </div>

          <p className="text-xs text-slate-400">
            Submit withdrawal balance payouts directly to your Ethiopian bank accounts. CBE, Telebirr and Awash supported.
          </p>

          {payoutSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-lg flex items-center gap-2 animate-scale-up">
              <Check className="w-4 h-4" /> Withdrawal pending authorization. Complete in 24 hours.
            </div>
          )}

          {payoutError && (
            <div className="p-3 bg-red-400/10 border border-red-400/20 text-red-400 text-xs rounded-lg">
              {payoutError}
            </div>
          )}

          <form onSubmit={handlePayoutFetch} className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="text-[10px] uppercase text-zinc-500 font-bold block">payout volume (ETB)</label>
              <input 
                type="number"
                placeholder="Amount, e.g. 500"
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
                className="w-full bg-zinc-900 border border-white/10 text-slate-200 p-2.5 rounded-lg font-mono focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-zinc-500 font-bold block">Bank Entity name</label>
              <input 
                type="text"
                placeholder="Commercial Bank of Ethiopia (CBE)"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="w-full bg-zinc-900 border border-white/10 text-slate-200 p-2.5 rounded-lg focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-zinc-500 font-bold block">Account card Identifiers</label>
              <input 
                type="text"
                placeholder="100084772134"
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
                className="w-full bg-zinc-900 border border-white/10 text-slate-200 p-2.5 rounded-lg font-mono focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <button
              type="submit"
              className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors"
            >
              Request Withdrawal Payout
            </button>
          </form>

          {/* Real-time Ethiopian CBE & Telebirr Fee Deductions Estimator */}
          <div className="bg-black/40 border border-white/5 rounded-xl p-4 mt-4 space-y-3 font-mono text-[11px] animate-scale-up">
            <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wide flex items-center gap-1.5 font-sans">
              ⚖️ CBE & Telebirr Net Payout Estimator & Tax Ledgers
            </span>
            
            <div className="flex justify-between">
              <span className="text-slate-500">Gross Payout Request:</span>
              <span className="text-white font-bold">{parseFloat(payoutAmount) || 0} ETB</span>
            </div>

            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-slate-500">CBE Flat Clearance Fee (1.5%):</span>
              <span className="text-red-400 font-bold">-{((parseFloat(payoutAmount) || 0) * 0.015).toFixed(2)} ETB</span>
            </div>

            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-slate-500">WHT Ethiopian Tax rate (2.0%):</span>
              <span className="text-red-400 font-bold">-{((parseFloat(payoutAmount) || 0) * 0.02).toFixed(2)} ETB</span>
            </div>

            <div className="flex justify-between text-[11px] pt-1 leading-none">
              <span className="text-emerald-400 font-bold font-sans">Net Disbursed Amount:</span>
              <span className="text-emerald-400 font-bold">
                {Math.max(0, (parseFloat(payoutAmount) || 0) * 0.965).toFixed(2)} ETB
              </span>
            </div>
          </div>
        </div>

        {/* Ledger logs */}
        <div className="bg-[#16161A] p-5 rounded-2xl border border-white/5 space-y-3 h-52 overflow-y-auto shadow-xl">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 border-b border-white/5 pb-2 flex justify-between">
            <span>Disbursement Statements</span>
            <span className="text-[10px] text-slate-500 font-mono">Synced</span>
          </h3>

          <div className="space-y-3 text-xs">
            {transactions.filter(t => t.userId === interpreterId).slice(0, 5).map(txn => (
              <div key={txn.id} className="flex justify-between items-start border-b border-white/5 pb-2 last:border-0 text-xs">
                <div>
                  <span className="font-sans font-bold text-white block capitalize">{txn.type === "payment" ? "Session Credit" : "Bank Payout"}</span>
                  <span className="text-[10px] text-slate-500 font-mono uppercase font-black">{txn.reference}</span>
                </div>
                <div className="text-right">
                  <span className={`font-mono font-bold ${txn.type === "payment" ? "text-emerald-400" : "text-amber-400"}`}>
                    {txn.type === "payment" ? "+" : "-"}{txn.amount} ETB
                  </span>
                  <span className="text-[10px] text-slate-500 block uppercase font-mono font-bold mt-0.5">
                    {txn.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
      )}

      <AnimatePresence>
        {visibleIncomingRequest && (
          <motion.div
            key="incoming-call-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-sm"
          >
            <IncomingCallCard
              session={visibleIncomingRequest}
              interpreterId={interpreterId}
              isAccepting={isAccepting}
              acceptPhase={acceptPhase}
              countdown={countdown}
              ringAudioReady={ringAudioReady}
              acceptError={acceptError}
              interpreterLanguages={interpreterLanguages}
              languageProficiencies={currentInterpreter?.languageProficiencies}
              theme={theme}
              onAccept={(sessionId) => void handleAcceptRequest(sessionId)}
              onDecline={(sessionId) => void handleDeclineRequest(sessionId)}
              onEnableRing={() => {
                void unlockIncomingCallAudio().then((ready) => {
                  setRingAudioReady(ready);
                  if (ready) void playIncomingCallBeep();
                });
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
