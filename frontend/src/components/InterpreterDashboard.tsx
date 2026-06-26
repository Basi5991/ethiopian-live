import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Calendar, Check, Power, Briefcase, FileText, AlertTriangle, 
  Clock, TrendingUp, Download, ArrowUpRight, DollarSign, Sliders, Play, Ban, Sparkles, Send,
  Phone, PhoneCall, PhoneOff, Smartphone, Mic, MicOff, VideoOff, Volume2, ShieldAlert, Wifi
} from "lucide-react";
import { User, Session, Transaction, InterpreterAvailability, Slot } from "../types";
import WebRTCCallPanel from "./WebRTCCallPanel";
import { acquireCallMedia } from "../hooks/useWebRTCCall";
import {
  findIncomingSessionForInterpreter,
  isDirectDialSession,
} from "../lib/interpreterMatching";

// Dynamic Incoming Call ring signaler
const playIncomingCallBeep = () => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
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
      audioCtx.close();
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

export default function InterpreterDashboard({ 
  users, 
  sessions, 
  transactions, 
  availabilities, 
  onActionComplete,
  theme = "dark"
}: InterpreterDashboardProps) {
  // Retrieve authenticated user from localStorage
  const currentUser = (() => {
    try {
      const saved = localStorage.getItem("orzo_auth_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  })();

  // Current logged in interpreter
  const interpreterId = currentUser?.id || "usr_int1";
  const currentInterpreter = users.find(u => u.id === interpreterId) || users.find(u => u.role === "interpreter") || users[2];
  const interpreterLanguages = currentUser?.languages ?? currentInterpreter?.languages ?? [];

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
  const [acceptError, setAcceptError] = useState("");

  // Ring for any language-qualified incoming call (broadcast or direct dial)
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    if (incomingRequest && onlineStatus === "active") {
      playIncomingCallBeep();
      intervalId = setInterval(playIncomingCallBeep, 3500);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [incomingRequest?.id, onlineStatus]);

  const clearCallMedia = () => {
    setCallMediaStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
  };

  const endSessionLocally = () => {
    setActiveSession(null);
    clearCallMedia();
  };

  // Track state changes & live triggers
  useEffect(() => {
    // 1. Locate active session — keep optimistic accept until server confirms or call ends
    setActiveSession((prev) => {
      if (prev?.id === dismissedSessionId) return null;

      const currentActive = sessions.find(
        (s) => s.interpreterId === interpreterId && s.status === "active" && s.id !== dismissedSessionId
      );
      if (currentActive) {
        if (prev?.id === currentActive.id && prev.status === currentActive.status) return prev;
        return currentActive;
      }

      if (prev?.status === "active") {
        const match = sessions.find((s) => s.id === prev.id);
        if (!match) return prev;
        if (["cancelled", "completed", "missed"].includes(match.status)) return null;
        if (match.status === "active") return match;
        return prev;
      }

      return null;
    });

    // 2. Incoming calls — language-matched broadcast or direct dial only
    const incomingCall = findIncomingSessionForInterpreter(
      sessions,
      interpreterId,
      interpreterLanguages,
      dismissedSessionId
    );

    setIncomingRequest((prev) => {
      if (isAccepting) return prev;
      const activeId = activeSession?.status === "active" ? activeSession.id : null;
      if (activeId && incomingCall?.id === activeId) return null;
      if (activeSession?.status === "active") return null;
      if (incomingCall && onlineStatus === "active") return incomingCall;
      return null;
    });
  }, [sessions, onlineStatus, interpreterId, interpreterLanguages, dismissedSessionId, activeSession, isAccepting]);

  // Countdown simulation for incoming matching alert popup
  useEffect(() => {
    let interval: any;
    if (incomingRequest) {
      interval = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            return 60;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setCountdown(60);
    }
    return () => clearInterval(interval);
  }, [incomingRequest]);

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

  // Accept — hit API immediately; grab camera in parallel so the button never feels stuck
  const handleAcceptRequest = async (sessionId: string) => {
    if (isAccepting) return;
    setIsAccepting(true);
    setAcceptError("");

    const callSnapshot = incomingRequest?.id === sessionId ? incomingRequest : null;
    setIncomingRequest(null);
    if (callSnapshot) {
      setDismissedSessionId(null);
      setActiveSession({
        ...callSnapshot,
        status: "active",
        interpreterId,
        interpreterName: currentInterpreter?.name,
      });
    }

    let stream: MediaStream | null = null;
    try {
      const [res, mediaStream] = await Promise.all([
        fetch(`/api/sessions/${sessionId}/accept`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            interpreterId,
            interpreterName: currentInterpreter?.name,
          }),
        }),
        acquireCallMedia({ preferVideo: true }).catch(() => null),
      ]);

      stream = mediaStream;
      if (stream) {
        setCallMediaStream(stream);
      }

      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setDismissedSessionId(null);
          setActiveSession(data.session);
        }
        onActionComplete();
      } else {
        const errData = await res.json().catch(() => ({}));
        setAcceptError(errData.error || "Could not accept this call.");
        setActiveSession(null);
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
        }
        setCallMediaStream(null);
        if (callSnapshot) {
          setIncomingRequest(callSnapshot);
        }
      }
    } catch (err) {
      setActiveSession(null);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setCallMediaStream(null);
      if (callSnapshot) {
        setIncomingRequest(callSnapshot);
      }
      console.error(err);
    } finally {
      setIsAccepting(false);
    }
  };

  // Reject and close matching popup
  const handleDeclineRequest = async (sessionId: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}/reject`, { method: "POST" });
    } catch (e) {
      console.error(e);
    }
    setIncomingRequest(null);
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
      await fetch(`/api/sessions/${activeSession.id}/chat`, {
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
                Selam, {currentUser?.name || "Linguistic Expert"}!
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

      {/* Global incoming call alert — visible on any tab */}
      {incomingRequest && !activeSession && (
        isDirectDialSession(incomingRequest, interpreterId) ? (
          <div className="col-span-12 p-6 rounded-2xl border-2 border-emerald-500 bg-emerald-950/25 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl shadow-emerald-500/5">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center animate-bounce shrink-0 text-emerald-400">
                <PhoneCall className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-[9px] font-black uppercase tracking-widest">
                  Incoming WebRTC Call
                </span>
                <h4 className="text-base font-extrabold text-white">
                  {incomingRequest.clientName}
                </h4>
                <p className="text-xs text-slate-300">
                  {incomingRequest.languageFrom} ⇆ {incomingRequest.languageTo} • {incomingRequest.serviceType}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={isAccepting}
                onClick={() => void handleAcceptRequest(incomingRequest.id)}
                className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-black text-xs uppercase rounded-xl text-white flex items-center gap-2"
              >
                <Phone className="w-4 h-4" /> {isAccepting ? "Connecting…" : "Accept Call"}
              </button>
              <button
                type="button"
                disabled={isAccepting}
                onClick={() => void handleDeclineRequest(incomingRequest.id)}
                className="px-4 py-3 text-red-400 hover:bg-red-600 hover:text-white border border-red-500/25 font-bold text-xs uppercase rounded-xl"
              >
                Decline
              </button>
            </div>
          </div>
        ) : (
          <div className="col-span-12 p-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-amber-500">Broadcast call available</span>
              <p className="text-sm font-bold">{incomingRequest.languageFrom} ⇆ {incomingRequest.languageTo}</p>
              <p className="text-[10px] text-amber-300/80">
                Matched to your languages: {interpreterLanguages.join(", ")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-amber-400 font-mono">{countdown}s</span>
              <button
                type="button"
                disabled={isAccepting}
                onClick={() => void handleAcceptRequest(incomingRequest.id)}
                className="px-4 py-2 bg-emerald-600 disabled:opacity-50 font-bold text-xs uppercase rounded-lg text-white"
              >
                {isAccepting ? "Connecting…" : "Accept"}
              </button>
              <button
                type="button"
                disabled={isAccepting}
                onClick={() => void handleDeclineRequest(incomingRequest.id)}
                className="px-3 py-2 bg-white/5 text-xs text-slate-400 rounded-lg"
              >
                Pass
              </button>
            </div>
          </div>
        )
      )}

      {acceptError && (
        <div className="col-span-12 px-4 py-2 rounded-xl bg-red-950/40 border border-red-500/30 text-red-300 text-xs">
          {acceptError}
        </div>
      )}

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
        <div className="col-span-12 lg:col-span-8 space-y-6 animate-fade-in">

        {/* Live session active monitor screen */}
        {activeSession ? (
          <div className="space-y-6">
            
            {/* WebRTC live call */}
            <div key={activeSession.id}>
            <WebRTCCallPanel
              sessionId={activeSession.id}
              role="interpreter"
              isCaller={false}
              enabled
              initialStream={callMediaStream}
              status={activeSession.status === "active" ? "active" : "incoming"}
              peerName={activeSession.clientName}
              languageLabel={`${activeSession.languageFrom} ⇆ ${activeSession.languageTo}`}
              localLabel={`You: ${currentInterpreter.name}`}
              remoteLabel={`Client: ${activeSession.clientName}`}
              onEndCall={async () => {
                if (!activeSession) return;
                const sessionId = activeSession.id;
                setDismissedSessionId(sessionId);
                setActiveSession(null);
                clearCallMedia();
                try {
                  await fetch(`/api/sessions/${sessionId}/reject`, { method: "POST" });
                } catch (e) {
                  console.error(e);
                }
                onActionComplete();
              }}
              onPeerHangup={(sessionId) => {
                setDismissedSessionId(sessionId);
                endSessionLocally();
              }}
            />
            </div>

            {/* Quick Session attributes ledger */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#16161A] p-4 rounded-xl border border-white/5 text-xs">
                <p className="text-[10px] font-bold text-slate-500 uppercase">Context Objective</p>
                <p className="text-white font-sans mt-1 capitalize">{activeSession.serviceType} Level translation</p>
              </div>
              <div className="bg-[#16161A] p-4 rounded-xl border border-white/5 text-xs">
                <p className="text-[10px] font-bold text-slate-500 uppercase">Est. Projected Earnings (85%)</p>
                <p className="text-emerald-400 font-mono mt-1 text-base font-bold">{(activeSession.cost * 0.85).toFixed(2)} ETB</p>
              </div>
            </div>

          </div>
        ) : (
          
          /* Scheduling grid layout */
          <div className="space-y-6">
            
            {/* Live Incoming unclaimed Alert Popup Banner */}
            {incomingRequest && (
              isDirectDialSession(incomingRequest, interpreterId) ? (
                // Direct VIP calling flashbox with high visual rhythm
                <div className="p-6 rounded-2xl border-2 border-emerald-500 bg-emerald-950/25 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-scale-up shadow-2xl shadow-emerald-500/5">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center animate-bounce shrink-0 shadow-lg shadow-emerald-500/10 text-emerald-400">
                      <PhoneCall className="w-7 h-7 text-emerald-400" />
                    </div>
                    <div className="space-y-1">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-405 border border-emerald-500/30 text-[9px] font-black uppercase tracking-widest leading-none">
                        📞 Premium Speed Dial Line
                      </span>
                      <h4 className="text-base font-extrabold text-white uppercase tracking-tight">
                        Direct Caller: {incomingRequest.clientName}
                      </h4>
                      <p className="text-xs text-slate-300">
                        Language Pair: <span className="font-bold text-slate-100">{incomingRequest.languageFrom} ⇆ {incomingRequest.languageTo}</span> • Domain: <span className="capitalize">{incomingRequest.serviceType} Case</span>
                      </p>
                      <div className="pt-0.5 flex items-center gap-2 text-[10px] text-emerald-400 font-mono font-bold uppercase tracking-wider">
                        <span>Fee Allocated: {(incomingRequest.cost * 0.85).toFixed(2)} ETB</span>
                        <span>•</span>
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" /> Connection Standby</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 w-full md:w-auto justify-end pt-2 md:pt-0 shrink-0">
                    <button
                      type="button"
                      disabled={isAccepting}
                      onClick={() => void handleAcceptRequest(incomingRequest.id)}
                      className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-black text-xs uppercase tracking-wider rounded-xl text-white flex items-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer active:scale-95 transition-transform duration-100"
                    >
                      <Phone className="w-4 h-4" /> {isAccepting ? "Connecting…" : "Connect Line"}
                    </button>
                    <button
                      type="button"
                      disabled={isAccepting}
                      onClick={() => void handleDeclineRequest(incomingRequest.id)}
                      className="px-4 py-3 bg-red-650/10 text-red-400 hover:text-white hover:bg-red-600 border border-red-500/25 hover:border-red-500 font-extrabold text-xs uppercase rounded-xl cursor-pointer active:scale-95 transition-transform duration-100"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ) : (
                // Standard general-broadcast matching panel
                <div className="p-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-scale-up">
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[10px] font-bold uppercase tracking-widest leading-none border border-amber-500/25">
                      ⚠️ Immediate matching broadcast available
                    </span>
                    <p className="text-xs font-bold text-slate-200 mt-1">
                      Route requested: {incomingRequest.languageFrom} ⇆ {incomingRequest.languageTo}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Category: <span className="capitalize">{incomingRequest.serviceType}</span> • Fee: {(incomingRequest.cost * 0.85).toFixed(2)} ETB commission
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-center font-mono text-slate-400 text-xs bg-black/40 border border-white/5 px-2 py-1.5 rounded">
                      Expires in: <span className="text-amber-400 font-bold">{countdown}s</span>
                    </div>
                    <button
                      type="button"
                      disabled={isAccepting}
                      onClick={() => void handleAcceptRequest(incomingRequest.id)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 font-bold text-xs uppercase tracking-wider rounded-lg text-white"
                    >
                      {isAccepting ? "Connecting…" : "Accept Room Target"}
                    </button>
                    <button
                      type="button"
                      disabled={isAccepting}
                      onClick={() => void handleDeclineRequest(incomingRequest.id)}
                      className="px-3 py-2 bg-white/5 hover:bg-white/10 text-xs text-slate-400 rounded-lg"
                    >
                      Pass
                    </button>
                  </div>
                </div>
              )
            )}

            {/* Shift Scheduler Manager */}
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

      {/* Sidebar Utilities Grid: Live room comments, Withdraw Earnings summary */}
      {dashboardSlide === "dispatch" && activeSession && (
        <div className="col-span-12 lg:col-span-4 space-y-6 animate-fade-in">

          {/* Live Translation feed block if is in active room */}
          <div className="bg-[#16161A] border border-white/5 rounded-2xl flex flex-col h-[350px] overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-[#0F0F12]">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Linguistic Feed Translation
              </h2>
              <span className="bg-emerald-500/20 text-emerald-400 text-[10px] px-2 py-0.5 rounded font-bold uppercase">
                Active Desk
              </span>
            </div>

            {/* Chat list */}
            <div id="interpreter-chat-feed" className="flex-1 p-4 overflow-y-auto space-y-4">
              {activeSession.chatMessages.map((msg, index) => {
                const isYou = msg.senderRole === "interpreter";
                const isSystem = msg.senderRole === "system";

                if (isSystem) {
                  return (
                    <div key={index} className="space-y-1 block text-center py-1 border-y border-white/5 bg-zinc-900/20">
                      <p className="text-[10px] text-slate-500 font-bold uppercase">{msg.senderName}</p>
                      <p className="text-[11px] text-slate-400 italic">
                        {msg.text}
                      </p>
                    </div>
                  );
                }

                return (
                  <div key={index} className="space-y-1">
                    <p className={`text-[10px] font-bold uppercase ${isYou ? "text-emerald-500" : "text-blue-500"}`}>
                      {msg.senderName}
                    </p>
                    <div className={`p-3 rounded-lg text-xs leading-relaxed ${
                      isYou ? "bg-white/5 text-slate-200" : "bg-blue-500/5 border-l-2 border-blue-500 text-slate-200"
                    }`}>
                      <p>{msg.text}</p>
                      {msg.translatedText && (
                        <p className="text-cyan-400 text-[11px] mt-1 italic border-t border-white/5 pt-1">
                          ↳ Translate output: {msg.translatedText}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}

              {isTranslating && (
                <p className="text-[10px] text-cyan-400 font-mono italic animate-pulse">
                  Translating linguistic query...
                </p>
              )}
            </div>

            {/* Input area */}
            <form onSubmit={handleSendMessage} className="p-3 bg-black/30 border-t border-white/5">
              <div className="relative">
                <input 
                  type="text" 
                  placeholder={isTranslating ? "Translating..." : "Type text turn to translate..."}
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

    </div>
  );
}
