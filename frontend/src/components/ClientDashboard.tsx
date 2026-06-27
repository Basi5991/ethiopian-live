import React, { useState, useEffect, useRef } from "react";
import { 
  CreditCard, Send, Clock, Shield, RefreshCw,
  PhoneCall, PhoneOff, Wifi, Star, Sparkle, Sparkles,
  Zap, Bot, ShieldCheck, CheckCircle2, LayoutGrid, ChevronDown,
  Camera, ArrowLeftRight, Globe2, Sun, LogOut
} from "lucide-react";
import { User, Session, Transaction, ContractDetails } from "../types";
import WebRTCCallPanel from "./WebRTCCallPanel";
import { acquireCallMedia } from "../hooks/useWebRTCCall";
import { apiUrl } from "../lib/apiUrl";
import { getCallSocket } from "../lib/callSocket";
import { callPanelStatus, isCallLive, mergeLiveSession } from "../lib/liveSession";
import { interpreterSupportsLanguagePair } from "../lib/interpreterMatching";

// Helper for playBeepTone
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
  } catch (e) {
    console.warn("AudioContext not supported or blocked by user gesture", e);
  }
};

const playRingTone = () => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc1.frequency.setValueAtTime(440, audioCtx.currentTime);
    osc2.frequency.setValueAtTime(480, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
    
    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc1.start();
    osc2.start();
    
    setTimeout(() => {
      osc1.stop();
      osc2.stop();
      audioCtx.close();
    }, 1200);
  } catch (e) {}
};

const INTERPRETER_EXT: Record<string, string> = {
  usr_int1: "0911",
  usr_int2: "0912",
  usr_int3: "0913",
  usr_int4: "0914",
  usr_int5: "0915",
  usr_int6: "0916",
};

const LIVE_CLIENT_STATUSES: Session["status"][] = ["active", "incoming", "pending"];
const LIVE_SESSION_PRIORITY: Record<string, number> = {
  active: 0,
  incoming: 1,
  pending: 2,
};

function ClientBannerSkyline() {
  return (
    <svg
      className="absolute bottom-0 right-0 w-[min(420px,55%)] h-[140px] pointer-events-none opacity-90"
      viewBox="0 0 1440 220"
      preserveAspectRatio="xMaxYMax slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="clientSkyFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#EAF2FF" stopOpacity="0" />
          <stop offset="100%" stopColor="#CFE0FF" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect width="1440" height="220" fill="url(#clientSkyFade)" />
      <path d="M0 170 Q360 130 720 155 T1440 140 L1440 220 L0 220 Z" fill="#D9E8FF" opacity="0.7" />
      <path d="M0 185 Q420 150 840 175 T1440 165 L1440 220 L0 220 Z" fill="#C5DAFF" opacity="0.85" />
      <g fill="#B8CFF5" opacity="0.9">
        <rect x="320" y="88" width="22" height="92" rx="3" />
        <rect x="350" y="102" width="16" height="78" rx="2" />
        <path d="M430 180 L445 55 L460 180 Z" />
        <rect x="520" y="105" width="28" height="75" rx="4" />
        <ellipse cx="640" cy="145" rx="38" ry="28" />
        <rect x="615" y="145" width="50" height="35" rx="4" />
        <rect x="720" y="100" width="24" height="80" rx="3" />
        <rect x="980" y="92" width="26" height="88" rx="3" />
      </g>
    </svg>
  );
}

interface ClientDashboardProps {
  users: User[];
  sessions: Session[];
  transactions: Transaction[];
  walletBalance: number;
  contractDetails: ContractDetails | null;
  contractsList: ContractDetails[];
  activeContractId: string;
  currentUser?: User | null;
  onActionComplete: () => void;
  theme?: string;
}

export default function ClientDashboard({ 
  users, 
  sessions, 
  transactions, 
  walletBalance, 
  contractDetails, 
  contractsList = [],
  activeContractId,
  currentUser: currentUserProp,
  onActionComplete,
  theme = "dark"
}: ClientDashboardProps) {

  // Retrieve authenticated user from localStorage or prop
  const currentUser = currentUserProp || (() => {
    try {
      const saved = localStorage.getItem("orzo_auth_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  })();

  const isInstitutionalClient = Boolean(currentUser?.contractId);
  const clientId = currentUser?.id || "usr_client13";
  const callSocket = React.useMemo(() => getCallSocket(clientId, "client"), [clientId]);

  // Dashboard Slider Section Switcher
  const [dashboardSlide, setDashboardSlide] = useState<"terminal" | "ai" | "billing">("terminal");

  // Primary Dispatch State
  const [langFrom, setLangFrom] = useState("Amharic");
  const [langTo, setLangTo] = useState("English");
  const [serviceType, setServiceType] = useState<"medical" | "legal" | "business" | "general">("medical");
  const [serviceMode, setServiceMode] = useState<"AI" | "Human" | "Both">("Both");
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("2026-06-25");
  const [scheduledTimeStr, setScheduledTimeStr] = useState("14:00");
  const [scheduledDuration, setScheduledDuration] = useState(30);
  const [wizardError, setWizardError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Elliot AI Language Assistant State
  const [aiInputText, setAiInputText] = useState("");
  const [aiMessages, setAiMessages] = useState<Array<{
    id: string;
    sender: "user" | "ai" | "system";
    text: string;
    translation?: string;
    phrases?: Array<{ phrase: string; meaning: string; phonetic: string }>;
    timestamp: string;
  }>>([
    {
      id: "ai_init",
      sender: "ai",
      text: "Selam! I am Elliot AI, your language assistance intelligence. Paste diagnostic guidelines, request custom clinical glossary sheets, or draft real-time amharic communications here.",
      timestamp: new Date().toLocaleTimeString()
    }
  ]);
  const [aiLoading, setAiLoading] = useState(false);

  // Traditional Translation sandbox (simplified & visual overlay)
  const [translatorInput, setTranslatorInput] = useState("");
  const [translatorResult, setTranslatorResult] = useState<any>(null);
  const [translatingState, setTranslatingState] = useState(false);

  // Active Session & Feedback
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [callMediaStream, setCallMediaStream] = useState<MediaStream | null>(null);
  const [dismissedSessionId, setDismissedSessionId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [isTranslatingMsg, setIsTranslatingMsg] = useState(false);
  const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);
  
  // Rating & review state
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [ratingSession, setRatingSession] = useState<Session | null>(null);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const promptedRatingSessionIds = useRef<Set<string>>(new Set());
  const ratingWatcherInitialized = useRef(false);

  // Smart Match Engine Recommendation Recommendation
  const [smartMatching, setSmartMatching] = useState(false);
  const [smartMatchResult, setSmartMatchResult] = useState<{ recommendedInterpreterId?: string; reasoning?: string } | null>(null);

  // Wallet and SLA expansion accordions
  const [walletAccordionOpen, setWalletAccordionOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("1000");
  const [depositSuccess, setDepositSuccess] = useState(false);

  const [contractAccordionOpen, setContractAccordionOpen] = useState(false);
  const [extendingDays, setExtendingDays] = useState("180");
  const [extBillingCode, setExtBillingCode] = useState("");
  const [contractExtendingSuccess, setContractExtendingSuccess] = useState(false);

  // Speed Dial States
  const [dialCode, setDialCode] = useState("");
  const [rightActiveTab, setRightActiveTab] = useState<"ai" | "manual">("ai");
  const [showSimulateOptions, setShowSimulateOptions] = useState(false);

  const ethiopianLanguages = ["Amharic", "Afaan Oromo", "Tigrinya", "Somali", "English", "Afar"];
  const liveClientSession = React.useMemo(() => {
    return sessions
      .filter(
        (session) =>
          session.clientId === clientId &&
          LIVE_CLIENT_STATUSES.includes(session.status) &&
          session.id !== dismissedSessionId
      )
      .sort((a, b) => {
        const priorityDelta = (LIVE_SESSION_PRIORITY[a.status] ?? 99) - (LIVE_SESSION_PRIORITY[b.status] ?? 99);
        if (priorityDelta !== 0) return priorityDelta;
        return b.id.localeCompare(a.id);
      })[0] || null;
  }, [sessions, clientId, dismissedSessionId]);
  const blockingSession =
    activeSession && LIVE_CLIENT_STATUSES.includes(activeSession.status) && activeSession.id !== dismissedSessionId
      ? activeSession
      : liveClientSession;
  const hasOverlappingCall = Boolean(blockingSession);

  useEffect(() => {
    return callSocket.subscribe((message) => {
      if (message.type === "call.created" || message.type === "call.ringing" || message.type === "call.accepted") {
        setDismissedSessionId(null);
        setActiveSession((prev) =>
          mergeLiveSession(prev, message.type === "call.accepted" ? { ...message.session, status: "active" } : message.session)
        );
        setIsSubmitting(false);
        onActionComplete();
      } else if (message.type === "call.ended") {
        setDismissedSessionId(message.session.id);
        setActiveSession((prev) => (prev?.id === message.session.id ? null : prev));
        clearCallMedia();
        onActionComplete();
      } else if (message.type === "call.error") {
        setWizardError(message.error);
        setIsSubmitting(false);
        if (message.session) {
          setActiveSession(message.session);
        }
      }
    });
  }, [callSocket, onActionComplete]);

  const clearCallMedia = () => {
    setCallMediaStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
  };

  const openRatingPopup = (session: Session) => {
    setRatingSession(session);
    setRating(session.ratingByClient ?? 5);
    setReviewText(session.reviewByClient ?? "");
    setFeedbackSuccess(false);
  };

  const closeRatingPopup = () => {
    setRatingSession(null);
    setFeedbackSuccess(false);
    setReviewText("");
    setRating(5);
  };

  // Watch sessions for active patient context
  useEffect(() => {
    if (liveClientSession) {
      setActiveSession((prev) => mergeLiveSession(prev, liveClientSession));
      return;
    }

    setActiveSession((prev) => {
      if (!prev || prev.id === dismissedSessionId) return null;
      const match = sessions.find((s) => s.id === prev.id);
      if (!match && LIVE_CLIENT_STATUSES.includes(prev.status)) return prev;
      if (!match) return null;
      if (["cancelled", "completed", "missed"].includes(match.status)) return null;
      if (LIVE_CLIENT_STATUSES.includes(match.status)) return mergeLiveSession(prev, match);
      return prev;
    });
  }, [sessions, dismissedSessionId, liveClientSession]);

  useEffect(() => {
    const completedSessions = sessions.filter(
      (session) => session.clientId === clientId && session.status === "completed"
    );

    if (!ratingWatcherInitialized.current) {
      if (sessions.length === 0) return;
      completedSessions.forEach((session) => promptedRatingSessionIds.current.add(session.id));
      ratingWatcherInitialized.current = true;
      return;
    }

    const newlyCompleted = completedSessions.find(
      (session) => !promptedRatingSessionIds.current.has(session.id)
    );

    if (newlyCompleted) {
      promptedRatingSessionIds.current.add(newlyCompleted.id);
      if (activeSession?.id === newlyCompleted.id) {
        setActiveSession(null);
      }
      openRatingPopup(newlyCompleted);
    }
  }, [sessions, clientId, activeSession?.id]);

  // Outgoing Dialing Ringer Loop
  useEffect(() => {
    let intervalId: any;
    if (activeSession && activeSession.status === "incoming") {
      playRingTone();
      intervalId = setInterval(playRingTone, 4000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeSession?.status, activeSession?.id]);

  useEffect(() => {
    if (activeSession?.status !== "incoming") return;
    const refreshId = window.setInterval(() => {
      onActionComplete();
    }, 1000);
    return () => window.clearInterval(refreshId);
  }, [activeSession?.status, activeSession?.id, onActionComplete]);

  useEffect(() => {
    if (contractDetails) {
      setExtBillingCode(contractDetails.billingCode);
    }
  }, [contractDetails]);

  // Unified Estimated Cost Calculator
  const getEstimatedCost = () => {
    let ratePerMinute = 1.5; // AI base rate in ETB
    if (serviceMode === "Human") ratePerMinute = 35.0;
    if (serviceMode === "Both") ratePerMinute = 40.0;
    if (serviceType === "medical") ratePerMinute *= 1.2;
    if (serviceType === "legal") ratePerMinute *= 1.35;
    
    const minutes = isScheduled ? scheduledDuration : 10;
    return Math.round(ratePerMinute * minutes);
  };

  // Switch workspace SLA contract context
  const handleSelectContract = async (contractId: string) => {
    try {
      const res = await fetch("/api/contract/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId })
      });
      if (res.ok) {
        onActionComplete();
        playBeepTone(880, 100);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Connect / Dispatch action
  const handleConnectRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setWizardError("");

    if (hasOverlappingCall) {
      setWizardError("You already have a call in progress. End or cancel the current call before starting another one.");
      return;
    }

    setIsSubmitting(true);

    const cost = getEstimatedCost();
    if (contractDetails?.status === "expired") {
      setWizardError("Corporate SLA has expired. Please extend contract details below.");
      setIsSubmitting(false);
      return;
    }

    try {
      const scheduledTimeValue = isScheduled ? `${scheduledDate}T${scheduledTimeStr}:00` : "instant";
      let stream: MediaStream | null = null;
      if (!isScheduled && serviceMode !== "AI") {
        try {
          stream = await acquireCallMedia({ preferVideo: true });
          setCallMediaStream(stream);
        } catch (err) {
          console.error("Media access failed on connect:", err);
        }
      }

      callSocket.send("call.request", {
        languageFrom: langFrom,
        languageTo: langTo,
        serviceType,
        serviceMode,
        scheduledTime: scheduledTimeValue,
        cost,
        clientId,
      });
      playBeepTone(980, 150);
      if (isScheduled) {
        alert("Success: Language specialist reserved for booked clinical allocation!");
      }
    } catch (err) {
      setWizardError("Network request timed out. Please check Addis Cloud link status.");
      clearCallMedia();
    }
  };

  // Handle direct extension dialing from keypad code
  const handleDirectDialExt = async (interpreterId: string) => {
    setWizardError("");
    if (hasOverlappingCall) {
      setWizardError("You already have a call in progress. End or cancel the current call before dialing another interpreter.");
      return;
    }

    const targetInt = users.find(u => u.id === interpreterId);
    if (!targetInt) return;

    const cost = Math.round((targetInt.hourlyRate || 35) * 1.2 * 10);
    if (contractDetails?.status === "expired") {
      setWizardError("Corporate SLA is expired. Standard dialing is locked.");
      return;
    }

    try {
      playBeepTone(697, 80);
      setTimeout(() => playBeepTone(1209, 80), 90);

      let stream: MediaStream | null = null;
      try {
        stream = await acquireCallMedia({ preferVideo: true });
        setCallMediaStream(stream);
      } catch (err) {
        console.error("Media access failed on dial:", err);
      }

      callSocket.send("call.request", {
        interpreterId,
        languageFrom: langFrom,
        languageTo: langTo,
        serviceType,
        serviceMode: "Both",
        scheduledTime: "instant",
        cost,
        clientId,
      });
    } catch (err) {
      setWizardError("Network connection failed.");
      clearCallMedia();
    }
  };

  const handleKeypadCodeSubmit = () => {
    if (!dialCode.trim()) return;
    let targetId = "";
    if (dialCode === "0911" || dialCode === "142") targetId = "usr_int1"; // Bekele Megersa
    else if (dialCode === "0912") targetId = "usr_int2"; // Haleema Bashir
    else if (dialCode === "0913") targetId = "usr_int3"; // Yared Girmay
    else if (dialCode === "0914" || dialCode === "310") targetId = "usr_int4"; // Selamawit Tadesse
    else if (dialCode === "0915") targetId = "usr_int5"; // Fatuma Ali
    else if (dialCode === "0916") targetId = "usr_int6"; // Lemma Hailu
    else {
      const found = users.find(u => u.role === "interpreter" && u.name.toLowerCase().includes(dialCode.toLowerCase()));
      if (found) targetId = found.id;
    }

    if (targetId) {
      handleDirectDialExt(targetId);
      setDialCode("");
    } else {
      setWizardError(`Invalid extension extension code "${dialCode}". Dial 0911, 0912, 0913, 0914, 0915, or 0916.`);
      playBeepTone(150, 400); // Fail buzzer
    }
  };

  // Send message on active video audio call
  const handleSendLiveMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !activeSession) return;

    const textMsg = chatInput;
    setChatInput("");
    setIsTranslatingMsg(true);

    try {
      const transRes = await fetch("/api/gemini/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textMsg,
          fromLang: activeSession.languageFrom,
          toLang: activeSession.languageTo
        })
      });

      const transData = await transRes.json();
      const translated = transData.translatedText || "";

      await fetch(apiUrl(`/api/sessions/${activeSession.id}/chat`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderRole: "client",
          senderName: "Clinic Desk (You)",
          text: textMsg,
          translatedText: translated
        })
      });

      onActionComplete();
      playBeepTone(600, 80);
    } catch (err) {
      console.error(err);
    } finally {
      setIsTranslatingMsg(false);
    }
  };

  // AI Speech captions simulation
  const triggerAICaptions = async (context: string) => {
    if (!activeSession) return;
    setIsGeneratingCaptions(true);

    try {
      const res = await fetch("/api/gemini/speech-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioSampleType: context,
          targetLanguage: activeSession.languageTo
        })
      });

      const data = await res.json();
      if (data.captions && Array.isArray(data.captions)) {
        for (const line of data.captions) {
          await new Promise(resolve => setTimeout(resolve, 1400));
          await fetch(apiUrl(`/api/sessions/${activeSession.id}/chat`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              senderRole: "system",
              senderName: "AI Captions",
              text: line
            })
          });
          onActionComplete();
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingCaptions(false);
    }
  };

  // Ratings submit
  const handleRatingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sessionToRate = ratingSession || activeSession;
    if (!sessionToRate) return;

    setIsSubmittingRating(true);
    try {
      const res = await fetch(apiUrl(`/api/sessions/${sessionToRate.id}/complete`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          review: reviewText,
          transcript: sessionToRate.chatMessages.map(m => `[${m.senderName}]: ${m.text}`),
          summary: `Clinical user verified interpretation complete. Rating: ${rating} Stars.`
        })
      });

      if (res.ok) {
        const data = await res.json();
        const updatedSession = data.session || data;
        promptedRatingSessionIds.current.add(updatedSession.id || sessionToRate.id);
        setFeedbackSuccess(true);
        setTimeout(() => {
          closeRatingPopup();
          setActiveSession(null);
        }, 3000);
        onActionComplete();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmittingRating(false);
    }
  };

  const endSessionLocally = () => {
    setActiveSession(null);
    clearCallMedia();
  };

  const completeSessionAndOpenRating = async (session: Session) => {
    setDismissedSessionId(session.id);
    setActiveSession(null);
    clearCallMedia();

    try {
      const res = await fetch(apiUrl(`/api/sessions/${session.id}/complete`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: session.chatMessages.map(m => `[${m.senderName}]: ${m.text}`),
          summary: "Client ended secure interpretation call. Awaiting post-call feedback.",
        })
      });

      if (res.ok) {
        const data = await res.json();
        const completedSession = data.session || { ...session, status: "completed" as const };
        callSocket.send("call.end", { sessionId: session.id });
        promptedRatingSessionIds.current.add(completedSession.id);
        openRatingPopup(completedSession);
        onActionComplete();
        playBeepTone(880, 120);
        return;
      }
    } catch (err) {
      console.error(err);
    }

    openRatingPopup({ ...session, status: "completed" });
  };

  // Cancel call or refund
  const handleCancelCall = async () => {
    if (!activeSession) return;
    if (activeSession.status === "active") {
      await completeSessionAndOpenRating(activeSession);
      return;
    }

    const sessionId = activeSession.id;
    setDismissedSessionId(sessionId);
    setActiveSession(null);
    clearCallMedia();
    try {
      callSocket.send("call.cancel", { sessionId });
      onActionComplete();
      playBeepTone(280, 200);
    } catch (e) {
      console.error(e);
    }
  };

  // Intelligent interpreter match recommendation using Gemini
  const handleSmartMatchFetch = async () => {
    setSmartMatching(true);
    setSmartMatchResult(null);
    try {
      const res = await fetch("/api/gemini/smart-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientLang: langFrom,
          serviceType: serviceType,
          urgency: isScheduled ? "scheduled" : "immediate"
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSmartMatchResult(data);
        playBeepTone(1050, 100);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSmartMatching(false);
    }
  };

  // Quick translate sandbox submit
  const handleQuickTranslateSubmit = async () => {
    if (!translatorInput.trim()) return;
    setTranslatingState(true);
    setTranslatorResult(null);

    try {
      const res = await fetch("/api/orzo/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: translatorInput,
          fromLang: langFrom,
          toLang: langTo
        })
      });
      if (res.ok) {
        const data = await res.json();
        setTranslatorResult(data);
        playBeepTone(880, 80);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setTranslatingState(false);
    }
  };

  // Chat with Elliot assistant
  const handleAiChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInputText.trim()) return;

    const userMessage = {
      id: `m_${Date.now()}`,
      sender: "user" as const,
      text: aiInputText,
      timestamp: new Date().toLocaleTimeString()
    };

    setAiMessages(prev => [...prev, userMessage]);
    const sendText = aiInputText;
    setAiInputText("");
    setAiLoading(true);
    playBeepTone(440, 60);

    try {
      const res = await fetch("/api/orzo/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: sendText,
          userId: clientId,
          context: {
            activeTab: "client_simple_workspace",
            walletBalance: isInstitutionalClient ? undefined : walletBalance,
            selectedLanguages: `${langFrom} to ${langTo}`,
            serviceType,
            organizationName: currentUser?.organizationName,
          }
        })
      });

      if (res.ok) {
        const data = await res.json();
        setAiMessages(prev => [...prev, {
          id: `ai_${Date.now()}`,
          sender: "ai" as const,
          text: data.replyText,
          translation: data.data?.translation,
          phrases: data.data?.phrases,
          timestamp: new Date().toLocaleTimeString()
        }]);

        // Auto fills scheduled parameters if AI mentions scheduling parameter blocks
        if (data.action === "schedule" && data.data) {
          if (data.data.language) setLangFrom(data.data.language);
          if (data.data.sector) setServiceType(data.data.sector);
          if (data.data.date) setScheduledDate(data.data.date);
          if (data.data.time) setScheduledTimeStr(data.data.time);
          setIsScheduled(true);
        }

        setTimeout(() => {
          playBeepTone(784, 80);
          setTimeout(() => playBeepTone(1046, 80), 80);
        }, 120);

      } else {
        throw new Error();
      }
    } catch (err) {
      setAiMessages(prev => [...prev, {
        id: `err_${Date.now()}`,
        sender: "system" as const,
        text: "Addis Neural Link offline. Standby standard manual guidelines fallback.",
        timestamp: new Date().toLocaleTimeString()
      }]);
    } finally {
      setAiLoading(false);
    }
  };

  // Deposit Submit trigger
  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isInstitutionalClient) return;
    const amount = Number(depositAmount);
    if (isNaN(amount) || amount <= 0) return;

    try {
      const res = await fetch("/api/wallet/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, clientId })
      });
      if (res.ok) {
        setDepositSuccess(true);
        setTimeout(() => setDepositSuccess(false), 3000);
        onActionComplete();
        playBeepTone(880, 150);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // SLA extension Submit
  const handleExtendContractSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/contract/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days: Number(extendingDays),
          billingCode: extBillingCode
        })
      });
      if (res.ok) {
        setContractExtendingSuccess(true);
        setTimeout(() => setContractExtendingSuccess(false), 3000);
        onActionComplete();
        playBeepTone(880, 150);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const matchCandidates = users
    .filter((u): u is User => u.role === "interpreter")
    .filter((u) => interpreterSupportsLanguagePair(u.languages, langFrom, langTo));

  const contractDaysValid = contractDetails
    ? Math.max(0, Math.ceil((new Date(contractDetails.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const contextOrgName = contractDetails?.organizationName || currentUser?.organizationName || "Ethiopian Ministry of Health";
  const cardSurface = theme === "light" ? "bg-white border-slate-200 shadow-sm" : "bg-[#16161A]/80 border-white/5";
  const inputSurface = theme === "light"
    ? "bg-slate-50 border-slate-200 text-slate-800"
    : "bg-zinc-950/60 border-white/5 text-white";

  return (
    <div className="animate-fade-in font-sans w-full">
      <div className="relative mx-auto w-full max-w-[680px] min-h-[min(880px,100svh)] overflow-hidden rounded-[1.6rem] sm:rounded-[2.25rem] border border-cyan-100/60 bg-[radial-gradient(circle_at_82%_18%,rgba(182,232,255,0.92),transparent_28%),linear-gradient(180deg,#bfe6fb_0%,#1786c5_42%,#00699a_100%)] p-3 sm:p-5 md:p-7 shadow-[0_30px_80px_rgba(6,56,93,0.35)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_60%_44%,rgba(255,255,255,0.45),transparent_12%),radial-gradient(circle_at_88%_50%,rgba(255,255,255,0.55),transparent_10%),linear-gradient(135deg,transparent_0%,rgba(255,255,255,0.18)_48%,transparent_55%)]" />
        <div className="pointer-events-none absolute -left-24 bottom-16 h-80 w-[760px] rotate-[-12deg] opacity-50">
          <div className="h-full w-full rounded-full border-t border-white/45 blur-[1px]" />
          <div className="-mt-64 h-full w-full rounded-full border-t border-cyan-100/60 blur-[1px]" />
          <div className="-mt-56 h-full w-full rounded-full border-t border-blue-100/45 blur-[1px]" />
        </div>
        <div className="pointer-events-none absolute bottom-10 right-8 h-10 w-10 rotate-45 rounded-[12px] bg-white/50 blur-[0.2px]" />

      {/* Screenshot-style ORZO header */}
      <div className="relative z-10 -mx-3 -mt-3 sm:-mx-5 sm:-mt-5 md:-mx-7 md:-mt-7 px-3 sm:px-5 md:px-7 py-3 sm:py-3.5 bg-white/55 backdrop-blur-xl border-b border-white/55 shadow-[0_10px_25px_rgba(30,92,132,0.14)]">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 sm:h-12 sm:w-12 shrink-0 rounded-full bg-[radial-gradient(circle_at_30%_25%,#ffffff,#aab5c5_48%,#566173)] shadow-[inset_0_2px_4px_rgba(255,255,255,0.9),0_5px_10px_rgba(15,23,42,0.32)] flex items-center justify-center text-[9px] sm:text-[11px] font-black text-slate-800">
              ORZO
            </div>
            <div className="leading-none">
              <p className="text-[clamp(1.15rem,5vw,1.65rem)] font-black tracking-tight text-slate-950">ORZO</p>
              <p className="text-[clamp(1rem,4.4vw,1.55rem)] font-black tracking-tight text-slate-950">Live Interpretation</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-3">
            <button
              type="button"
              className="h-12 md:h-14 rounded-2xl border border-white/70 bg-white/50 px-4 md:px-5 text-[11px] md:text-sm font-black text-slate-800 shadow-[inset_0_1px_2px_rgba(255,255,255,0.9),0_7px_16px_rgba(15,23,42,0.22)]"
            >
              <span className="inline-flex items-center gap-2">
                <Sun className="h-5 w-5 text-amber-400" />
                WHITE<br />THEME
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem("orzo_auth_user");
                window.location.reload();
              }}
              className="h-12 md:h-14 rounded-2xl border border-white/70 bg-white/60 px-4 md:px-5 text-[11px] md:text-sm font-black text-slate-950 shadow-[inset_0_1px_2px_rgba(255,255,255,0.9),0_7px_16px_rgba(15,23,42,0.28)]"
            >
              <span className="inline-flex items-center gap-2">
                <LogOut className="h-5 w-5" />
                SIGN<br />OUT
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto mt-3 mb-6 sm:mb-9 h-12 sm:h-16 max-w-[540px] rounded-b-[1.4rem] sm:rounded-b-[1.8rem] border-x border-b border-white/35 bg-white/15 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
        <div className="absolute left-4 sm:left-7 top-2 rounded-2xl border border-emerald-100/60 bg-emerald-100/80 px-4 sm:px-6 py-1.5 sm:py-2 text-[clamp(0.78rem,2.5vw,1rem)] font-black text-emerald-900 shadow-[0_8px_18px_rgba(15,118,110,0.18)]">
          <span className="inline-flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {contractDetails?.status === "expired" ? "Expired" : `${contractDaysValid ?? 12} Days Valid`}
          </span>
        </div>
      </div>

      {/* Reference-style user navigation */}
      <div className="relative z-10 mx-auto grid max-w-[540px] grid-cols-3 gap-2.5 sm:gap-4 md:gap-5">
        <button
          type="button"
          onClick={() => { setDashboardSlide("terminal"); playBeepTone(400, 50); }}
          className={`h-[86px] sm:h-[104px] md:h-[118px] rounded-[1rem] sm:rounded-[1.35rem] px-2.5 sm:px-3.5 md:px-4 py-3 sm:py-4 text-left transition-all cursor-pointer border shadow-[inset_0_2px_3px_rgba(255,255,255,0.95),inset_0_-12px_25px_rgba(15,23,42,0.08),0_12px_22px_rgba(8,50,88,0.34)] ${
            dashboardSlide === "terminal"
              ? "bg-gradient-to-br from-white via-slate-100 to-slate-300 text-slate-950 border-white"
              : "bg-gradient-to-br from-white/70 via-slate-100/70 to-slate-400/60 text-slate-950 border-white/65 hover:from-white"
          }`}
        >
          <span className="flex h-full flex-col items-start justify-center gap-1.5 sm:gap-2 text-[clamp(0.88rem,3.4vw,1.5rem)] font-black leading-tight">
            <Zap className="w-5 h-5 sm:w-7 sm:h-7 md:w-8 md:h-8 text-slate-700" />
            <span>Dispatch</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => { setDashboardSlide("ai"); playBeepTone(420, 50); }}
          className={`h-[86px] sm:h-[104px] md:h-[118px] rounded-[1rem] sm:rounded-[1.35rem] px-2.5 sm:px-3.5 md:px-4 py-3 sm:py-4 text-left transition-all cursor-pointer border shadow-[inset_0_2px_3px_rgba(255,255,255,0.95),inset_0_-12px_25px_rgba(15,23,42,0.08),0_12px_22px_rgba(8,50,88,0.34)] ${
            dashboardSlide === "ai"
              ? "bg-gradient-to-br from-white via-slate-100 to-slate-300 text-slate-950 border-white"
              : "bg-gradient-to-br from-white/70 via-slate-100/70 to-slate-400/60 text-slate-950 border-white/65 hover:from-white"
          }`}
        >
          <span className="flex h-full flex-col items-start justify-center gap-1.5 sm:gap-2 text-[clamp(0.88rem,3.4vw,1.5rem)] font-black leading-tight">
            <Bot className="w-5 h-5 sm:w-7 sm:h-7 md:w-8 md:h-8 text-slate-700" />
            <span>AI Hub</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => { setDashboardSlide("billing"); playBeepTone(440, 50); }}
          className={`h-[86px] sm:h-[104px] md:h-[118px] rounded-[1rem] sm:rounded-[1.35rem] px-2.5 sm:px-3.5 md:px-4 py-3 sm:py-4 text-left transition-all cursor-pointer border shadow-[inset_0_2px_3px_rgba(255,255,255,0.95),inset_0_-12px_25px_rgba(15,23,42,0.08),0_12px_22px_rgba(8,50,88,0.34)] ${
            dashboardSlide === "billing"
              ? "bg-gradient-to-br from-white via-slate-100 to-slate-300 text-slate-950 border-white"
              : "bg-gradient-to-br from-white/70 via-slate-100/70 to-slate-400/60 text-slate-950 border-white/65 hover:from-white"
          }`}
        >
          <span className="flex h-full flex-col items-start justify-center gap-1.5 sm:gap-2 text-[clamp(0.78rem,3vw,1.35rem)] font-black leading-tight">
            <Camera className="w-5 h-5 sm:w-7 sm:h-7 md:w-8 md:h-8 text-slate-700" />
            <span>Camera to Scan</span>
          </span>
        </button>
      </div>

      {/* Main Responsive Grid Layout */}
      <div className="relative z-10 mx-auto mt-6 grid max-w-[540px] grid-cols-12 gap-5">

        {/* Outer full-width Video session focus when session is active, so client stays focused */}
        {activeSession && (
          <div className="col-span-12">
            <div className={`p-1.5 rounded-3xl border transition-all duration-300 shadow-2xl overflow-hidden ${
              theme === "light" ? "bg-white border-slate-200" : "bg-zinc-900/90 border-white/5"
            }`}>
              <div className="grid grid-cols-12 gap-6">
                
                {/* WebRTC video call */}
                <div className="col-span-12 lg:col-span-7 flex flex-col">
                  {activeSession.serviceMode !== "AI" ? (
                    <div key={activeSession.id}>
                    <WebRTCCallPanel
                      sessionId={activeSession.id}
                      role="client"
                      isCaller
                      enabled={isCallLive(activeSession)}
                      initialStream={callMediaStream}
                      status={callPanelStatus(activeSession)}
                      peerName={activeSession.interpreterName || "Interpreter"}
                      languageLabel={`${activeSession.languageFrom} ⇆ ${activeSession.languageTo}`}
                      localLabel="You: Clinic Desk"
                      remoteLabel={`Active: ${activeSession.interpreterName || "Interpreter"}`}
                      onEndCall={handleCancelCall}
                      onPeerHangup={(sessionId) => {
                        const completedCandidate =
                          activeSession?.id === sessionId
                            ? activeSession
                            : sessions.find((session) => session.id === sessionId);
                        if (completedCandidate?.status === "active") {
                          completeSessionAndOpenRating(completedCandidate);
                        } else {
                          setDismissedSessionId(sessionId);
                          endSessionLocally();
                        }
                      }}
                    />
                    </div>
                  ) : (
                  <div className="bg-black rounded-2xl relative aspect-video overflow-hidden shadow-inner flex flex-col justify-between p-4">
                    <div className="flex justify-between items-center z-10 w-full">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-black/60 backdrop-blur rounded-xl text-[10px] text-white font-extrabold font-mono uppercase border border-white/5">
                        <Wifi className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                        AI Interpreter Line
                      </span>
                    </div>
                    <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                      ORZO AI Neural Interpreter active
                    </div>
                    <div className="flex gap-2 justify-center z-10 w-full">
                      <button
                        onClick={handleCancelCall}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl flex items-center gap-1.5 transition active:scale-95"
                      >
                        <PhoneOff className="w-4 h-4" />
                        End Call
                      </button>
                    </div>
                  </div>
                  )}
                </div>

                {/* Right chat logs / real-time transcription feed and feedback submit */}
                <div className={`col-span-12 lg:col-span-5 flex flex-col h-[350px] lg:h-auto border-t lg:border-t-0 p-4 border-slate-200/50`}>
                  
                  {activeSession.status === "active" ? (
                    <div className="flex-1 flex flex-col justify-between h-full">
                      
                      {/* Active conversation title with automatic rating layout if requested */}
                      <div className="border-b border-white/5 pb-2">
                        <span className="text-[9px] font-mono text-slate-400 uppercase font-black">
                          Real-Time Bilingual Transcript Stream
                        </span>
                      </div>

                      {/* Msg feed area */}
                      <div className="flex-1 overflow-y-auto py-3 space-y-2 text-xs max-h-[220px]">
                        {activeSession.chatMessages?.length === 0 ? (
                          <div className="h-full flex items-center justify-center text-slate-500 text-center font-mono text-[10px]">
                            Waiting for diagnostic dialogue feed...
                          </div>
                        ) : (
                          activeSession.chatMessages?.map((m, index) => (
                            <div key={index} className="p-2.5 rounded-xl bg-white/5 border border-white/5 space-y-1">
                              <div className="flex justify-between items-center">
                                <span className="font-extrabold text-[9px] text-blue-400 capitalize">{m.senderName}</span>
                                <span className="text-[8px] text-slate-500 font-mono">{m.senderRole}</span>
                              </div>
                              <p className={`text-xs ${theme === "light" ? "text-slate-800" : "text-white"}`}>{m.text}</p>
                              {m.translatedText && (
                                <p className="text-xs text-indigo-400 italic bg-indigo-505/10 bg-indigo-500/5 px-2 py-0.5 rounded border border-indigo-500/10 font-mono">
                                  Transl: {m.translatedText}
                                </p>
                              )}
                            </div>
                          ))
                        )}
                      </div>

                      {/* Send dynamic speech message */}
                      <form onSubmit={handleSendLiveMessage} className="mt-2 flex gap-2">
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Type clinical inquiry for live translation..."
                          className="flex-1 bg-zinc-950/60 border border-white/5 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500"
                        />
                        <button
                          type="submit"
                          disabled={isTranslatingMsg}
                          className="p-2 bg-[#0A66C2] hover:bg-blue-600 text-white rounded-xl active:scale-95 transition"
                        >
                          {isTranslatingMsg ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                      </form>

                    </div>
                  ) : activeSession.status === "pending" || activeSession.status === "active_review" ? (
                    
                    /* Rating & post session recap */
                    <form onSubmit={handleRatingSubmit} className="space-y-3 p-2 text-center">
                      <div className="mx-auto w-12 h-12 rounded-full bg-teal-500/10 flex items-center justify-center border border-teal-500/20 text-teal-400 text-xl">
                        ✓
                      </div>
                      <div>
                        <h4 className={`text-xs font-extrabold text-white uppercase`}>Session Complete</h4>
                        <p className={`text-[10px] text-slate-400`}>Please rate your remote linguistic specialist feedback to help maintain Elliot SLA targets.</p>
                      </div>

                      <div className="flex justify-center gap-1 pt-1">
                        {[1,2,3,4,5].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => { setRating(s); playBeepTone(500 + s * 100, 80); }}
                            className="p-1"
                          >
                            <Star className={`w-6 h-6 ${s <= rating ? "fill-amber-400 text-amber-400" : "text-slate-500"}`} />
                          </button>
                        ))}
                      </div>

                      <textarea
                        value={reviewText}
                        onChange={(e) => setReviewText(e.target.value)}
                        placeholder="Optional remarks (e.g. excellent medical translation fluency)..."
                        rows={2}
                        className="w-full bg-zinc-950/60 text-xs text-white p-2.5 rounded-lg border border-white/5 placeholder-slate-500 focus:outline-none"
                      />

                      {feedbackSuccess && (
                        <div className="text-[10px] text-emerald-500 bg-emerald-500/10 py-1.5 rounded font-bold">
                          ✓ Review committed! Balance hold released.
                        </div>
                      )}

                      <button
                        type="submit"
                        className="w-full py-2 bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer font-sans"
                      >
                        Submit Feedback and Complete Secure Line
                      </button>
                    </form>
                  ) : (
                    <div className="h-full flex flex-col justify-center items-center text-center p-6 text-slate-500">
                      <HelpIcon className="w-8 h-8 opacity-30 animate-pulse" />
                      <p className="text-xs font-bold uppercase tracking-wider mt-2">Active Call Telemetry Area</p>
                      <p className="text-[10px] max-w-xs mt-1">Start an on-demand translation link or dial an extension code on the left column to launch diagnostic connection.</p>
                    </div>
                  )}

                </div>

              </div>
            </div>
          </div>
        )}

        {/* Dispatch workspace */}
        {dashboardSlide === "terminal" && (
          <div className="col-span-12 space-y-5 animate-fade-in">

          <div className={`relative overflow-hidden rounded-[1.5rem] sm:rounded-[2rem] border p-4 sm:p-6 md:p-8 ${
            theme === "light"
              ? "bg-white/35 border-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_24px_60px_rgba(15,70,120,0.22)] backdrop-blur-2xl"
              : "bg-slate-900/50 border-white/10 shadow-2xl backdrop-blur-2xl"
          }`}>
            <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-cyan-300/30 blur-3xl" />
            <div className="pointer-events-none absolute -left-16 bottom-0 h-40 w-40 rounded-full bg-blue-500/20 blur-3xl" />

            <form onSubmit={handleConnectRequest} className="relative space-y-4 sm:space-y-5 md:space-y-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className={`inline-flex items-center gap-2 text-[clamp(1rem,4vw,1.25rem)] font-black tracking-tight ${
                  theme === "light" ? "text-slate-800 drop-shadow-sm" : "text-white"
                }`}>
                  <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400 fill-amber-300" />
                  Quick Connection Channel
                </h3>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 sm:px-3 py-1 text-[10px] sm:text-xs font-black border ${
                  contractDetails?.status === "expired"
                    ? "bg-rose-100/80 text-rose-700 border-rose-200"
                    : "bg-emerald-100/80 text-emerald-700 border-emerald-200"
                }`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {contractDetails?.status === "expired" ? "Expired" : "Verified"}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3.5 md:gap-5 items-end">
                <div className="space-y-2">
                  <label className={`text-[clamp(0.72rem,2.4vw,0.9rem)] font-black ${theme === "light" ? "text-slate-700" : "text-slate-200"}`}>
                    From Language
                  </label>
                  <div className="relative">
                    <Globe2 className="absolute left-3.5 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-emerald-600" />
                    <select
                      value={langFrom}
                      onChange={(e) => { setLangFrom(e.target.value); playBeepTone(400, 80); }}
                      className={`w-full appearance-none rounded-xl sm:rounded-2xl border py-3 sm:py-4 pl-10 sm:pl-12 pr-10 sm:pr-11 text-[clamp(0.98rem,4vw,1.125rem)] font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_24px_rgba(15,23,42,0.14)] focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer ${
                        theme === "light" ? "bg-white/80 border-white/80 text-slate-900" : "bg-white/10 border-white/10 text-white"
                      }`}
                    >
                      {ethiopianLanguages.map(l => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3.5 sm:right-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-500 pointer-events-none" />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setLangFrom(langTo);
                    setLangTo(langFrom);
                    playBeepTone(460, 80);
                  }}
                  className={`mb-1 mx-auto md:mx-0 h-10 w-10 sm:h-12 sm:w-12 rounded-full border flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_22px_rgba(15,23,42,0.16)] ${
                    theme === "light" ? "bg-white/75 border-white/80 text-slate-700" : "bg-white/10 border-white/10 text-white"
                  }`}
                  aria-label="Swap languages"
                >
                  <ArrowLeftRight className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                <div className="space-y-2">
                  <label className={`text-[clamp(0.72rem,2.4vw,0.9rem)] font-black ${theme === "light" ? "text-slate-700" : "text-slate-200"}`}>
                    To Language
                  </label>
                  <div className="relative">
                    <Globe2 className="absolute left-3.5 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                    <select
                      value={langTo}
                      onChange={(e) => { setLangTo(e.target.value); playBeepTone(420, 80); }}
                      className={`w-full appearance-none rounded-xl sm:rounded-2xl border py-3 sm:py-4 pl-10 sm:pl-12 pr-10 sm:pr-11 text-[clamp(0.98rem,4vw,1.125rem)] font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_24px_rgba(15,23,42,0.14)] focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer ${
                        theme === "light" ? "bg-white/80 border-white/80 text-slate-900" : "bg-white/10 border-white/10 text-white"
                      }`}
                    >
                      {ethiopianLanguages.filter(l => l !== langFrom).map(l => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3.5 sm:right-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-500 pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                <div className="space-y-2">
                  <label className={`text-[clamp(0.72rem,2.4vw,0.9rem)] font-black ${theme === "light" ? "text-slate-700" : "text-slate-200"}`}>
                    Specialty
                  </label>
                  <div className="relative">
                    <select
                      value={serviceType}
                      onChange={(e) => { setServiceType(e.target.value as typeof serviceType); playBeepTone(520, 100); }}
                      className={`w-full appearance-none rounded-xl sm:rounded-2xl border px-4 sm:px-5 py-3 sm:py-4 pr-10 sm:pr-12 text-[clamp(0.98rem,4vw,1.125rem)] font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_24px_rgba(15,23,42,0.14)] focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer ${
                        theme === "light" ? "bg-white/80 border-white/80 text-slate-900" : "bg-white/10 border-white/10 text-white"
                      }`}
                    >
                      <option value="medical">Medicine</option>
                      <option value="legal">Legal</option>
                      <option value="business">Business</option>
                      <option value="general">General</option>
                    </select>
                    <ChevronDown className="absolute right-3.5 sm:right-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-500 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className={`text-[clamp(0.72rem,2.4vw,0.9rem)] font-black ${theme === "light" ? "text-slate-700" : "text-slate-200"}`}>
                    Connection Mode
                  </label>
                  <div className="relative">
                    <Zap className="absolute left-3.5 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
                    <select
                      value={serviceMode}
                      onChange={(e) => { setServiceMode(e.target.value as typeof serviceMode); playBeepTone(550, 80); }}
                      className={`w-full appearance-none rounded-xl sm:rounded-2xl border py-3 sm:py-4 pl-10 sm:pl-12 pr-10 sm:pr-12 text-[clamp(0.98rem,4vw,1.125rem)] font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_24px_rgba(15,23,42,0.14)] focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer ${
                        theme === "light" ? "bg-white/80 border-white/80 text-slate-900" : "bg-white/10 border-white/10 text-white"
                      }`}
                    >
                      <option value="Both">Hybrid</option>
                      <option value="Human">Human</option>
                      <option value="AI">AI</option>
                    </select>
                    <ChevronDown className="absolute right-3.5 sm:right-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-slate-500 pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className={`flex items-center gap-2.5 sm:gap-3 rounded-xl sm:rounded-2xl border px-3 sm:px-4 py-3 sm:py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_10px_24px_rgba(15,23,42,0.12)] ${
                theme === "light" ? "bg-white/65 border-white/70 text-slate-800" : "bg-white/10 border-white/10 text-white"
              }`}>
                <ShieldCheck className="w-6 h-6 sm:w-8 sm:h-8 shrink-0 text-slate-500" />
                <p className="flex-1 text-[clamp(0.82rem,3vw,1rem)] font-semibold leading-snug">
                  Retainer Billing: <span className="font-black">{getEstimatedCost()} ETB</span>{" "}
                  <span className={theme === "light" ? "text-slate-500" : "text-slate-300"}>
                    ({isInstitutionalClient ? "Verified" : "Wallet Hold"})
                  </span>
                </p>
                <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 text-indigo-500" />
              </div>

              <div className={`rounded-xl sm:rounded-2xl border p-2.5 sm:p-3 ${theme === "light" ? "bg-white/40 border-white/60" : "bg-white/5 border-white/10"}`}>
                <button
                  type="button"
                  onClick={() => setIsScheduled(!isScheduled)}
                  className={`w-full flex items-center justify-between gap-3 text-[clamp(0.75rem,2.8vw,0.9rem)] font-bold ${theme === "light" ? "text-slate-700" : "text-slate-300"}`}
                >
                  <span>{isScheduled ? "Scheduled channel" : "Instant channel"}</span>
                  <span className="text-[clamp(0.68rem,2.4vw,0.75rem)] font-semibold text-blue-600">
                    {isScheduled ? "Switch to instant" : "Schedule for later"}
                  </span>
                </button>
                {isScheduled && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                    <input
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      className={`rounded-xl border px-3 py-2 text-sm ${inputSurface}`}
                    />
                    <input
                      type="time"
                      value={scheduledTimeStr}
                      onChange={(e) => setScheduledTimeStr(e.target.value)}
                      className={`rounded-xl border px-3 py-2 text-sm ${inputSurface}`}
                    />
                    <select
                      value={scheduledDuration}
                      onChange={(e) => setScheduledDuration(Number(e.target.value))}
                      className={`rounded-xl border px-3 py-2 text-sm ${inputSurface}`}
                    >
                      <option value={15}>15 min</option>
                      <option value={30}>30 min</option>
                      <option value={45}>45 min</option>
                      <option value={60}>60 min</option>
                    </select>
                  </div>
                )}
              </div>

              {wizardError && (
                <div className="p-3 rounded-xl bg-rose-50 text-rose-600 text-xs border border-rose-200">
                  {wizardError}
                </div>
              )}

              {hasOverlappingCall && (
                <div className="p-3 rounded-xl bg-blue-50 text-blue-700 text-xs border border-blue-200 font-semibold">
                  Current call is {blockingSession?.status === "active" ? "active" : "waiting for an interpreter"}. End or cancel it before starting another call.
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || hasOverlappingCall}
                className="w-full rounded-xl sm:rounded-2xl bg-gradient-to-r from-[#0B66D8] to-[#0757BF] hover:from-blue-600 hover:to-blue-700 text-white py-4 sm:py-5 px-3 sm:px-4 transition active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed shadow-[0_18px_35px_rgba(37,99,235,0.35)] cursor-pointer border border-blue-300/30"
              >
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2 text-[clamp(0.95rem,3.5vw,1rem)] font-black">
                    <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                    Connecting Channel...
                  </span>
                ) : (
                  <span className="inline-flex items-center justify-center gap-2 text-[clamp(1rem,4vw,1.125rem)] font-black">
                    <Zap className="w-4 h-4 sm:w-5 sm:h-5 fill-white/20" />
                    {hasOverlappingCall ? "Call Already In Progress" : isScheduled ? "Schedule Translation Call" : "Start Translation Call"}
                  </span>
                )}
              </button>
            </form>
          </div>

          <div className={`rounded-2xl border p-5 ${cardSurface}`}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h4 className={`text-sm font-black ${theme === "light" ? "text-slate-900" : "text-white"}`}>
                  Quick Call Interpreters
                </h4>
                <p className="text-xs text-slate-500">Matching your selected language pair.</p>
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <input
                  type="text"
                  value={dialCode}
                  onChange={(e) => setDialCode(e.target.value)}
                  placeholder="Ext code"
                  className={`w-28 border rounded-xl px-3 py-2 text-xs focus:outline-none ${inputSurface}`}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleKeypadCodeSubmit(); } }}
                />
                <button
                  type="button"
                  onClick={handleKeypadCodeSubmit}
                  disabled={hasOverlappingCall}
                  className="rounded-xl bg-slate-900 text-white px-3 py-2 text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Dial
                </button>
              </div>
            </div>

            {matchCandidates.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {matchCandidates.map((interpreter) => {
                  const ext = INTERPRETER_EXT[interpreter.id] || "----";
                  return (
                    <div
                      key={interpreter.id}
                      className={`rounded-2xl border p-4 flex items-center gap-3 ${
                        theme === "light" ? "border-slate-100 bg-slate-50/70" : "border-white/5 bg-white/[0.02]"
                      }`}
                    >
                      <img
                        src={interpreter.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${interpreter.name}`}
                        alt={interpreter.name}
                        className="w-12 h-12 rounded-full object-cover border border-white shadow-sm"
                        referrerPolicy="no-referrer"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-black truncate ${theme === "light" ? "text-slate-900" : "text-white"}`}>
                          {interpreter.name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Ext {ext} · Rating {interpreter.rating?.toFixed(1) || "5.0"}
                        </p>
                        <p className="text-[11px] text-blue-500 font-semibold">
                          {langFrom} to {langTo}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDirectDialExt(interpreter.id)}
                        disabled={hasOverlappingCall}
                        className="rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 text-xs font-black transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {hasOverlappingCall ? "Busy" : "Call"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={`rounded-2xl border p-4 text-sm ${theme === "light" ? "border-slate-100 bg-slate-50 text-slate-500" : "border-white/5 bg-zinc-950/30 text-slate-400"}`}>
                No direct-call interpreter matches this exact pair yet. Use Start Call Now to broadcast the request.
              </div>
            )}
          </div>

        </div>
        )}

        {/* Column 2: Simple & Intelligent Dual-Tab Interface */}
        {dashboardSlide === "ai" && (
          <div className="col-span-12 space-y-4 animate-fade-in">

          {/* Tab Selection Row */}
          <div className={`p-1 rounded-xl border flex items-center gap-1 ${
            theme === "light" ? "bg-slate-100 border-slate-200" : "bg-black/40 border-white/5"
          }`}>
            <button
              type="button"
              onClick={() => { setRightActiveTab("ai"); playBeepTone(440, 60); }}
              className={`flex-1 py-2 text-center text-[9.5px] sm:text-[10.5px] font-extrabold uppercase rounded-lg transition-all duration-150 cursor-pointer ${
                rightActiveTab === "ai"
                  ? "bg-purple-600 text-white shadow-md shadow-purple-500/10"
                  : theme === "light" ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              🤖 Elliot AI Assistant
            </button>
            <button
              type="button"
              onClick={() => { setRightActiveTab("manual"); playBeepTone(460, 60); }}
              className={`flex-1 py-2 text-center text-[9.5px] sm:text-[10.5px] font-extrabold uppercase rounded-lg transition-all duration-150 cursor-pointer ${
                rightActiveTab === "manual"
                  ? "bg-[#0A66C2] text-white shadow-md shadow-blue-500/10"
                  : theme === "light" ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              💡 Translation Desk & Queue
            </button>
          </div>

          {rightActiveTab === "ai" ? (
            /* Elliot AI Assistant: fully visible inline chatbot tool */
            <div className={`p-5 rounded-2xl border flex flex-col h-[380px] transition-all duration-300 shadow-xl ${
              theme === "light" ? "bg-white border-slate-200" : "bg-zinc-900/40 border-white/5 backdrop-blur-md"
            }`}>
              
              <div className="flex justify-between items-center border-b border-slate-200/40 pb-2.5 shrink-0">
                <div className="flex items-center gap-2">
                  <Sparkle className="w-4 h-4 text-purple-500 animate-pulse" />
                  <span className={`text-[11px] font-black uppercase tracking-wider ${theme === "light" ? "text-slate-800" : "text-white"}`}>
                    Elliot Translation Brain
                  </span>
                </div>
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto py-3 space-y-3">
                {aiMessages.map((msg) => (
                  <div key={msg.id} className={`flex flex-col space-y-1.5 max-w-[85%] ${
                    msg.sender === "user" ? "ml-auto items-end" : "mr-auto items-start"
                  }`}>
                    <span className="text-[8px] text-slate-500 font-mono tracking-wide">{msg.timestamp}</span>
                    <div className={`p-3 rounded-2xl text-[11.5px] leading-relaxed relative ${
                      msg.sender === "user"
                        ? "bg-[#0A66C2] text-white rounded-tr-none"
                        : "bg-[#16161A] border border-white/5 text-slate-300 rounded-tl-none"
                    }`}>
                      {msg.text}
                      
                      {msg.translation && (
                        <div className="mt-2.5 pt-2 border-t border-white/10 text-indigo-400 italic">
                          Amharic: "{msg.translation}"
                        </div>
                      )}

                      {msg.phrases && (
                        <div className="mt-2 text-[10px] space-y-1 bg-black/40 p-2 rounded-lg border border-white/5 font-mono text-zinc-400 text-left">
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block pb-0.5">Clinical Terminology Card</span>
                          {msg.phrases.map((p, idx) => (
                            <div key={idx} className="border-b border-white/5 last:border-0 pb-1 pt-1">
                              <span className="text-purple-400 font-bold">{p.phrase}</span> - {p.meaning} <span className="text-[8px] text-slate-500 italic">({p.phonetic})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                {aiLoading && (
                  <div className="mr-auto flex items-center gap-2 max-w-[85%]">
                    <div className="px-3.5 py-2.5 bg-[#16161A] border border-white/5 rounded-2xl rounded-tl-none text-[11px] text-zinc-500 font-mono flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Querying Amharic translation base...
                    </div>
                  </div>
                )}
              </div>

              {/* Input formulation area */}
              <form onSubmit={handleAiChatSubmit} className="mt-2 flex gap-2 shrink-0">
                <input
                  type="text"
                  value={aiInputText}
                  onChange={(e) => setAiInputText(e.target.value)}
                  placeholder="Ask Elliot AI for translations or guidelines..."
                  className={`flex-1 border rounded-xl px-3 py-2 text-xs focus:outline-none ${
                    theme === "light"
                      ? "bg-slate-50 border-slate-200 text-slate-800"
                      : "bg-zinc-950/60 border-white/5 text-white placeholder-slate-500"
                  }`}
                />
                <button
                  type="submit"
                  disabled={aiLoading}
                  className="p-2 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 text-white rounded-xl active:scale-95 transition"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>

            </div>
          ) : (
            <div className="space-y-4">
              {/* Quick Traditional Pocket Translator */}
              <div className={`p-4 rounded-2xl border ${
                theme === "light" ? "bg-white border-slate-200" : "bg-black/10 border-white/5"
              } space-y-3`}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-400 uppercase font-black uppercase tracking-wider block">
                    Quick Translation pocket
                  </span>
                  <span className="text-[8px] px-2 py-0.5 bg-blue-500/10 text-blue-500 font-mono font-bold rounded">
                    From {langFrom} ⇄ {langTo}
                  </span>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={translatorInput}
                    onChange={(e) => setTranslatorInput(e.target.value)}
                    placeholder="e.g. Please take this pill twice a day"
                    className={`flex-1 border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none ${
                      theme === "light"
                        ? "bg-slate-50 border-slate-200 text-slate-800"
                        : "bg-zinc-950/60 border-white/5 text-white"
                    }`}
                    onKeyDown={(e) => { if (e.key === "Enter") handleQuickTranslateSubmit(); }}
                  />
                  <button
                    type="button"
                    onClick={handleQuickTranslateSubmit}
                    disabled={translatingState}
                    className="px-3 py-1.5 bg-[#0A66C2] hover:bg-blue-600 font-bold uppercase rounded-lg text-[10px] text-white cursor-pointer"
                  >
                    {translatingState ? "..." : "Translate"}
                  </button>
                </div>

                {translatorResult && (
                  <div className="p-2.5 rounded-lg bg-indigo-500/5 px-2.5 py-2 border border-indigo-500/10 text-xs text-slate-300 font-mono animate-scale-up space-y-1">
                    <p className="font-extrabold text-[10px] text-indigo-400">Translated result:</p>
                    <p className={`text-xs ${theme === "light" ? "text-slate-800" : "text-white"}`}>{translatorResult.translatedText}</p>
                    <p className="text-[8px] text-slate-500">Dialect match: {translatorResult.dialect} | Conf: {(translatorResult.confidence * 100).toFixed(0)}%</p>
                  </div>
                )}
              </div>

              {/* Micro Past Sessions History List */}
              <div className={`p-4 rounded-xl border ${
                theme === "light" ? "bg-white border-slate-200" : "bg-zinc-900/10 border-white/5"
              } space-y-3`}>
                <span className="text-[10px] font-mono text-slate-400 uppercase font-black tracking-widest block">
                  Recent Clinical Session Queue
                </span>
                <div className="space-y-2">
                  {sessions.filter(s => s.clientId === clientId).slice(0, 3).map((sess) => (
                    <div key={sess.id} className={`p-3 border rounded-xl flex items-center justify-between text-xs ${
                      theme === "light" ? "bg-slate-50 border-slate-200" : "bg-zinc-950/40 border-white/5"
                    }`}>
                      <div className="flex items-center gap-2.5">
                        <span className="p-1 px-1.5 rounded bg-blue-500/5 text-blue-500 font-mono text-[9px] font-bold">
                          {sess.languageFrom} ⇆ {sess.languageTo}
                        </span>
                        <div>
                          <span className={`block font-bold uppercase text-[10.5px] tracking-tight ${
                            theme === "light" ? "text-slate-800" : "text-white"
                          }`}>{sess.serviceType} Call</span>
                          <span className="text-[8px] text-slate-500 block">Date: {sess.scheduledTime && sess.scheduledTime !== "instant" ? new Date(sess.scheduledTime).toLocaleDateString() : "Instant Call"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {sess.status === "completed" && (
                          <button
                            type="button"
                            onClick={() => openRatingPopup(sess)}
                            className="px-2 py-0.5 rounded text-[8px] uppercase font-mono font-black border border-amber-500/20 text-amber-400 bg-amber-500/10 hover:bg-amber-500/15"
                          >
                            {sess.ratingByClient ? "Change Rating" : "Rate"}
                          </button>
                        )}
                        <span className={`px-2 py-0.5 rounded text-[8px] uppercase font-mono font-black border ${
                          sess.status === "completed" ? "bg-[#15803D]/10 text-[#15803D] border-[#15803D]/20" :
                          sess.status === "active" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 animate-pulse" :
                          "bg-zinc-800 text-slate-400 border-zinc-700"
                        }`}>
                          {sess.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>
        )}

      </div>

      {/* Accordion Corporate Finance & SLA Administration Deck */}
      {dashboardSlide === "billing" && (
        <div className="space-y-4 animate-fade-in w-full">
          <div className={`border rounded-2xl overflow-hidden transition-all duration-300 ${
            theme === "light" ? "bg-white border-slate-200" : "bg-[#16161A]/80 border-white/5"
          }`}>
            <div className={`w-full py-4 px-6 flex items-center justify-between text-xs font-black uppercase tracking-wider font-mono border-b ${
              theme === "light" ? "text-slate-800 border-slate-200 bg-slate-50" : "text-slate-250 text-slate-200 border-white/5 bg-black/40"
            }`}>
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-blue-500 animate-pulse" />
                <span>SLA Billing & Contract Administration Desk</span>
              </div>
              <span className="text-[9px] bg-emerald-500/10 text-emerald-400 font-mono font-bold px-2 py-0.5 rounded border border-emerald-500/25">Billing Connected</span>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left Column: Escrow Deposit (hidden for institutional offline billing) */}
              {!isInstitutionalClient ? (
              <div className="space-y-4">
                <h3 className={`text-xs font-bold uppercase tracking-wider ${theme === "light" ? "text-slate-700" : "text-white"}`}>
                  💳 Escrow Wallet & CBE Deposit
                </h3>
                <p className="text-xs text-slate-400">
                  Fund non-SLA on-demand connection credits with Chapa/CBE simulated gateway. Automatic instant refund on cancellation.
                </p>

                <form onSubmit={handleDepositSubmit} className="flex gap-3 max-w-md pt-1">
                  <div className={`flex-1 flex max-w-sm border rounded-xl items-center px-3.5 gap-2 focus-within:ring-1 focus-within:ring-emerald-500 ${
                    theme === "light" 
                      ? "bg-slate-50 border-slate-200 text-slate-800" 
                      : "bg-zinc-950/60 border-white/5 text-white"
                  }`}>
                    <span className="text-xs font-mono font-bold text-slate-400">ETB</span>
                    <input
                      type="number"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="1000"
                      className={`flex-1 bg-transparent py-2.5 text-xs focus:outline-none border-0 outline-none ${
                        theme === "light" ? "text-slate-900 placeholder-slate-400" : "text-white placeholder-slate-500"
                      }`}
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition duration-150 cursor-pointer active:scale-95"
                  >
                    Deposit
                  </button>
                </form>

                {depositSuccess && (
                  <div className="p-3 text-emerald-500 text-[10.5px] rounded bg-emerald-500/10 border border-emerald-500/20 font-bold max-w-md font-mono">
                    ✓ CBE Escrow Deposit Synced! Current: {(walletBalance + Number(depositAmount)).toFixed(2)} ETB
                  </div>
                )}
              </div>
              ) : (
              <div className="space-y-4">
                <h3 className={`text-xs font-bold uppercase tracking-wider ${theme === "light" ? "text-slate-700" : "text-white"}`}>
                  🏛️ Institutional Offline Billing
                </h3>
                <p className="text-xs text-slate-400">
                  Your organization is billed offline under the active SLA contract ({contextOrgName}). Session access is governed by contract validity — no in-app wallet top-up is required.
                </p>
                {currentUser?.isInstitutionPrimary && (
                  <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
                    Primary org account
                  </p>
                )}
              </div>
              )}

              {/* Right Column: Contract Extension */}
              {contractDetails && (
                <div className="space-y-4">
                  <h3 className={`text-xs font-bold uppercase tracking-wider ${theme === "light" ? "text-slate-700" : "text-white"}`}>
                    ⚖️ SLA Contract Extension
                  </h3>
                  <p className="text-xs text-slate-400">
                    Instantly renew corporate SLA contract periods or override expired statuses via administrative billing flags.
                  </p>

                  <form onSubmit={handleExtendContractSubmit} className="space-y-4 pt-1">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 uppercase font-bold font-mono">Period</label>
                        <select
                          value={extendingDays}
                          onChange={(e) => setExtendingDays(e.target.value)}
                          className={`w-full text-xs p-2.5 rounded-xl border focus:outline-none cursor-pointer ${
                            theme === "light" 
                              ? "bg-slate-50 border-slate-200 text-slate-800" 
                              : "bg-zinc-950/60 border-white/5 text-white"
                          }`}
                        >
                          <option value="30" className={theme === "light" ? "" : "bg-[#111115] text-white"}>30 Days</option>
                          <option value="90" className={theme === "light" ? "" : "bg-[#111115] text-white"}>90 Days</option>
                          <option value="180" className={theme === "light" ? "" : "bg-[#111115] text-white"}>180 Days</option>
                          <option value="365" className={theme === "light" ? "" : "bg-[#111115] text-white"}>365 Days</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-400 uppercase font-bold font-mono">Admin Billing Code</label>
                        <input
                          type="text"
                          value={extBillingCode}
                          onChange={(e) => setExtBillingCode(e.target.value)}
                          className={`w-full text-xs p-2.5 rounded-xl border focus:outline-none ${
                            theme === "light" 
                              ? "bg-slate-50 border-slate-200 text-slate-800" 
                              : "bg-zinc-950/60 border-white/5 text-white"
                          }`}
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition cursor-pointer active:scale-95"
                    >
                      Confirm Extension
                    </button>
                  </form>

                  {contractExtendingSuccess && (
                    <div className="p-3 text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 text-[10.5px] rounded font-bold font-mono">
                      ✓ SLA Contract updated!
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {ratingSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm">
          <form
            onSubmit={handleRatingSubmit}
            className={`w-full max-w-md rounded-3xl border p-6 shadow-2xl space-y-5 ${
              theme === "light"
                ? "bg-white border-slate-200 text-slate-900"
                : "bg-[#16161A] border-white/10 text-white"
            }`}
          >
            <div className="text-center space-y-2">
              <div className="mx-auto w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                <Star className="w-7 h-7 fill-amber-400 text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest">
                  Rate Your Interpreter
                </h3>
                <p className={`text-xs mt-1 ${theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
                  You can update this feedback after each call. Previous ratings are pre-filled when available.
                </p>
              </div>
            </div>

            <div className={`rounded-2xl border p-3 text-xs ${
              theme === "light" ? "bg-slate-50 border-slate-200" : "bg-zinc-950/50 border-white/5"
            }`}>
              <span className="text-[9px] uppercase tracking-widest font-black text-slate-500 block">
                Completed Session
              </span>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="font-bold truncate">
                  {ratingSession.interpreterName || "Interpreter"}
                </span>
                <span className="font-mono text-[10px] text-blue-400 whitespace-nowrap">
                  {ratingSession.languageFrom} ⇆ {ratingSession.languageTo}
                </span>
              </div>
            </div>

            <div className="flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => {
                    setRating(star);
                    playBeepTone(500 + star * 100, 80);
                  }}
                  className="p-1.5 rounded-xl hover:bg-amber-500/10 transition"
                  aria-label={`Rate ${star} star${star === 1 ? "" : "s"}`}
                >
                  <Star className={`w-8 h-8 ${star <= rating ? "fill-amber-400 text-amber-400" : "text-slate-500"}`} />
                </button>
              ))}
            </div>

            <textarea
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="Optional note about fluency, clarity, or professionalism..."
              rows={4}
              className={`w-full rounded-2xl border p-3 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                theme === "light"
                  ? "bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400"
                  : "bg-zinc-950/60 border-white/10 text-white placeholder-slate-500"
              }`}
            />

            {feedbackSuccess && (
              <div className="text-xs text-emerald-500 bg-emerald-500/10 py-2 rounded-xl font-bold text-center">
                Review saved. Thank you for helping maintain interpreter quality.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={closeRatingPopup}
                className={`py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border ${
                  theme === "light"
                    ? "border-slate-200 text-slate-600 hover:bg-slate-50"
                    : "border-white/10 text-slate-300 hover:bg-white/5"
                }`}
              >
                Skip For Now
              </button>
              <button
                type="submit"
                disabled={isSubmittingRating}
                className="py-2.5 bg-gradient-to-r from-amber-500 to-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold uppercase tracking-wider"
              >
                {isSubmittingRating ? "Saving..." : "Save Rating"}
              </button>
            </div>
          </form>
        </div>
      )}

      </div>
    </div>
  );
}

// Simple placeholder icon
function HelpIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
