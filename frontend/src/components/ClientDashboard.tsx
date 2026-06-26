import React, { useState, useEffect } from "react";
import { 
  CreditCard, Send, Clock, Shield, RefreshCw,
  PhoneCall, PhoneOff, Wifi, Star, Sparkle, Sparkles,
  Zap, Bot, ShieldCheck, CheckCircle2, LayoutGrid, ChevronDown
} from "lucide-react";
import { User, Session, Transaction, ContractDetails } from "../types";
import WebRTCCallPanel from "./WebRTCCallPanel";
import { acquireCallMedia } from "../hooks/useWebRTCCall";
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
};

const MATCH_CANDIDATE_IDS = ["usr_int1", "usr_int4"];

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

  const clearCallMedia = () => {
    setCallMediaStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
  };

  // Watch sessions for active patient context
  useEffect(() => {
    const live = sessions.find(
      (s) =>
        s.clientId === clientId &&
        ["active", "incoming", "pending"].includes(s.status) &&
        s.id !== dismissedSessionId
    );
    if (live) {
      setActiveSession(live);
      return;
    }

    setActiveSession((prev) => {
      if (!prev || prev.id === dismissedSessionId) return null;
      const match = sessions.find((s) => s.id === prev.id);
      if (!match) return null;
      if (["cancelled", "completed", "missed"].includes(match.status)) return null;
      return prev;
    });
  }, [sessions, clientId, dismissedSessionId]);

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

      const res = await fetch("/api/sessions/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          languageFrom: langFrom,
          languageTo: langTo,
          serviceType,
          serviceMode,
          scheduledTime: scheduledTimeValue,
          cost,
          clientId,
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setDismissedSessionId(null);
          setActiveSession(data.session);
        }
        onActionComplete();
        playBeepTone(980, 150);
        if (isScheduled) {
          alert("Success: Language specialist reserved for booked clinical allocation!");
        }
      } else {
        const errorData = await res.json();
        setWizardError(errorData.error || "System failed to establish connection line.");
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
          setCallMediaStream(null);
        }
      }
    } catch (err) {
      setWizardError("Network request timed out. Please check Addis Cloud link status.");
      clearCallMedia();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle direct extension dialing from keypad code
  const handleDirectDialExt = async (interpreterId: string) => {
    setWizardError("");
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

      const res = await fetch("/api/calls/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interpreterId,
          languageFrom: langFrom,
          languageTo: langTo,
          serviceType,
          serviceMode: "Both",
          cost,
          clientId,
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setDismissedSessionId(null);
          setActiveSession(data.session);
        }
        onActionComplete();
      } else {
        const errData = await res.json();
        setWizardError(errData.error || "Connection refused.");
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
          setCallMediaStream(null);
        }
      }
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
    else {
      const found = users.find(u => u.role === "interpreter" && u.name.toLowerCase().includes(dialCode.toLowerCase()));
      if (found) targetId = found.id;
    }

    if (targetId) {
      handleDirectDialExt(targetId);
      setDialCode("");
    } else {
      setWizardError(`Invalid extension extension code "${dialCode}". Dial 0911, 0912, 0913 or 0914.`);
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

      await fetch(`/api/sessions/${activeSession.id}/chat`, {
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
          await fetch(`/api/sessions/${activeSession.id}/chat`, {
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
    if (!activeSession) return;

    try {
      const res = await fetch(`/api/sessions/${activeSession.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          review: reviewText,
          transcript: activeSession.chatMessages.map(m => `[${m.senderName}]: ${m.text}`),
          summary: `Clinical user verified interpretation complete. Rating: ${rating} Stars.`
        })
      });

      if (res.ok) {
        setFeedbackSuccess(true);
        setTimeout(() => {
          setFeedbackSuccess(false);
          setActiveSession(null);
          setReviewText("");
        }, 3000);
        onActionComplete();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const endSessionLocally = () => {
    setActiveSession(null);
    clearCallMedia();
  };

  // Cancel call or refund
  const handleCancelCall = async () => {
    if (!activeSession) return;
    const sessionId = activeSession.id;
    setDismissedSessionId(sessionId);
    setActiveSession(null);
    clearCallMedia();
    try {
      await fetch(`/api/sessions/${sessionId}/reject`, { method: "POST" });
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

  const matchCandidates = MATCH_CANDIDATE_IDS
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is User => Boolean(u))
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
    <div className="space-y-4 animate-fade-in font-sans max-w-5xl mx-auto w-full">
      
      {/* Welcome banner */}
      <div className={`relative overflow-hidden rounded-2xl border p-6 sm:p-7 ${
        theme === "light"
          ? "bg-gradient-to-br from-[#eef4ff] via-[#f4f8ff] to-white border-blue-100/80"
          : "bg-gradient-to-br from-blue-950/30 to-indigo-950/20 border-white/5"
      }`}>
        <ClientBannerSkyline />
        <div className="relative z-10 max-w-[62%] space-y-3">
          <h2 className={`text-xl sm:text-2xl font-bold tracking-tight ${theme === "light" ? "text-slate-900" : "text-white"}`}>
            👋 Selam, {currentUser?.name || "Client Partner"}!
          </h2>
          <p className={`text-sm leading-relaxed ${theme === "light" ? "text-slate-600" : "text-slate-400"}`}>
            Welcome to your dedicated Elliot translation portal. Instantly dispatch real-time translators, schedule clinical sessions, or interact with our smart language assistant.
          </p>
          <div className={`flex flex-wrap items-center gap-4 pt-1 text-xs ${theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Addis Ababa UTC+3
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              {contextOrgName} Portal
            </span>
          </div>
        </div>
      </div>

      {/* Context status bar */}
      <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border px-5 py-3.5 ${cardSurface}`}>
        <div className={`text-sm ${theme === "light" ? "text-slate-700" : "text-slate-300"}`}>
          Context:{" "}
          <span className={`font-bold ${theme === "light" ? "text-[#0B1F4D]" : "text-white"}`}>
            {contextOrgName} ({contractDetails?.status === "expired" ? "Expired" : "Active"})
          </span>
        </div>
        {contractDetails ? (
          <span className={`inline-flex items-center gap-1.5 self-start sm:self-auto px-3 py-1 rounded-full text-xs font-semibold border ${
            contractDetails.status === "expired"
              ? "bg-rose-50 text-rose-600 border-rose-200"
              : "bg-emerald-50 text-emerald-700 border-emerald-200"
          }`}>
            <CheckCircle2 className="w-3.5 h-3.5" />
            {contractDetails.status === "expired" ? "Expired" : `${contractDaysValid} Days Valid`}
          </span>
        ) : !isInstitutionalClient ? (
          <span className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {walletBalance.toFixed(0)} ETB Balance
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Offline Invoicing
          </span>
        )}
      </div>

      {/* Navigation tab cards */}
      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => { setDashboardSlide("terminal"); playBeepTone(400, 50); }}
          className={`rounded-xl border p-4 text-left transition-all cursor-pointer ${
            dashboardSlide === "terminal"
              ? "border-blue-200 bg-blue-50/80 ring-1 ring-blue-200"
              : `${cardSurface} hover:border-blue-100`
          }`}
        >
          <Zap className={`w-5 h-5 mb-2 ${dashboardSlide === "terminal" ? "text-blue-600" : "text-blue-500"}`} />
          <span className={`block text-sm font-bold ${dashboardSlide === "terminal" ? "text-blue-700" : theme === "light" ? "text-slate-700" : "text-slate-300"}`}>
            Dispatch
          </span>
        </button>
        <button
          type="button"
          onClick={() => { setDashboardSlide("ai"); playBeepTone(420, 50); }}
          className={`rounded-xl border p-4 text-left transition-all cursor-pointer ${
            dashboardSlide === "ai"
              ? "border-purple-200 bg-purple-50/80 ring-1 ring-purple-200"
              : `${cardSurface} hover:border-purple-100`
          }`}
        >
          <Bot className={`w-5 h-5 mb-2 ${dashboardSlide === "ai" ? "text-purple-600" : "text-purple-500"}`} />
          <span className={`block text-sm font-bold ${dashboardSlide === "ai" ? "text-purple-700" : theme === "light" ? "text-slate-700" : "text-slate-300"}`}>
            AI Hub
          </span>
        </button>
        <button
          type="button"
          onClick={() => { setDashboardSlide("billing"); playBeepTone(440, 50); }}
          className={`rounded-xl border p-4 text-left transition-all cursor-pointer ${
            dashboardSlide === "billing"
              ? "border-emerald-200 bg-emerald-50/80 ring-1 ring-emerald-200"
              : `${cardSurface} hover:border-emerald-100`
          }`}
        >
          <CreditCard className={`w-5 h-5 mb-2 ${dashboardSlide === "billing" ? "text-emerald-600" : "text-emerald-500"}`} />
          <span className={`block text-sm font-bold ${dashboardSlide === "billing" ? "text-emerald-700" : theme === "light" ? "text-slate-700" : "text-slate-300"}`}>
            Billing & SLA
          </span>
        </button>
      </div>

      {/* Main Responsive Grid Layout */}
      <div className="grid grid-cols-12 gap-5">

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
                      enabled={activeSession.status === "incoming" || activeSession.status === "active"}
                      initialStream={callMediaStream}
                      status={activeSession.status}
                      peerName={activeSession.interpreterName || "Interpreter"}
                      languageLabel={`${activeSession.languageFrom} ⇆ ${activeSession.languageTo}`}
                      localLabel="You: Clinic Desk"
                      remoteLabel={`Active: ${activeSession.interpreterName || "Interpreter"}`}
                      onEndCall={handleCancelCall}
                      onPeerHangup={(sessionId) => {
                        setDismissedSessionId(sessionId);
                        endSessionLocally();
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

          <div className={`rounded-2xl border p-6 ${cardSurface}`}>
            <h3 className={`text-base font-bold mb-5 ${theme === "light" ? "text-slate-900" : "text-white"}`}>
              ⚡ Quick Connection Channel
            </h3>

            <form onSubmit={handleConnectRequest} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={`text-xs font-semibold ${theme === "light" ? "text-slate-600" : "text-slate-400"}`}>
                    From Language
                  </label>
                  <div className="relative">
                    <select
                      value={langFrom}
                      onChange={(e) => { setLangFrom(e.target.value); playBeepTone(400, 80); }}
                      className={`w-full appearance-none border rounded-xl px-3 py-2.5 pr-9 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer ${inputSurface}`}
                    >
                      {ethiopianLanguages.map(l => (
                        <option key={l} value={l}>{l === "Amharic" ? "🇪🇹 Amharic" : l}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className={`text-xs font-semibold ${theme === "light" ? "text-slate-600" : "text-slate-400"}`}>
                    To Language
                  </label>
                  <div className="relative">
                    <select
                      value={langTo}
                      onChange={(e) => { setLangTo(e.target.value); playBeepTone(420, 80); }}
                      className={`w-full appearance-none border rounded-xl px-3 py-2.5 pr-9 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer ${inputSurface}`}
                    >
                      {ethiopianLanguages.filter(l => l !== langFrom).map(l => (
                        <option key={l} value={l}>{l === "English" ? "EN English" : l}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className={`text-xs font-semibold ${theme === "light" ? "text-slate-600" : "text-slate-400"}`}>
                    Specialty Classification
                  </label>
                  <div className="relative">
                    <select
                      value={serviceType}
                      onChange={(e) => { setServiceType(e.target.value as typeof serviceType); playBeepTone(520, 100); }}
                      className={`w-full appearance-none border rounded-xl px-3 py-2.5 pr-9 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer ${inputSurface}`}
                    >
                      <option value="medical">🏥 Medicine (Clinics)</option>
                      <option value="legal">⚖️ Courts (Legal codes)</option>
                      <option value="business">💼 Commerce (SME deals)</option>
                      <option value="general">🌐 General (Standard)</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className={`text-xs font-semibold ${theme === "light" ? "text-slate-600" : "text-slate-400"}`}>
                    Connection Mode
                  </label>
                  <div className="relative">
                    <select
                      value={serviceMode}
                      onChange={(e) => { setServiceMode(e.target.value as typeof serviceMode); playBeepTone(550, 80); }}
                      className={`w-full appearance-none border rounded-xl px-3 py-2.5 pr-9 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer ${inputSurface}`}
                    >
                      <option value="AI">🤖 Neural AI (1.5 ETB)</option>
                      <option value="Human">📞 Specialist (35 ETB)</option>
                      <option value="Both">⚡ Hybrid (40 ETB)</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600/80">Retainer Billing Hold</p>
                  <p className="text-sm font-bold text-slate-800">
                    {getEstimatedCost()} ETB <span className="font-normal text-slate-500">(SLA Coverage Verified)</span>
                  </p>
                </div>
                <ShieldCheck className="w-6 h-6 text-blue-600 shrink-0" />
              </div>

              {wizardError && (
                <div className="p-3 rounded-xl bg-rose-50 text-rose-600 text-xs border border-rose-200">
                  {wizardError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl bg-[#2563EB] hover:bg-blue-600 text-white py-4 px-4 transition active:scale-[0.99] disabled:opacity-70 shadow-lg shadow-blue-500/20 cursor-pointer"
              >
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2 text-sm font-bold">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Connecting...
                  </span>
                ) : (
                  <>
                    <span className="block text-base font-bold">⚡ Start Translation Call</span>
                    <span className="block text-xs font-normal opacity-90 mt-0.5">Immediate Connect</span>
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Match Candidate */}
            <div className={`rounded-2xl border p-5 ${cardSurface}`}>
              <h4 className={`text-sm font-bold mb-4 ${theme === "light" ? "text-slate-900" : "text-white"}`}>
                Match Candidate
              </h4>
              <div className="space-y-3">
                {matchCandidates.map((interpreter) => {
                  const ext = INTERPRETER_EXT[interpreter.id] || "----";
                  const firstName = interpreter.name.split(" ")[0];
                  return (
                    <div
                      key={interpreter.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                        theme === "light" ? "border-slate-100 bg-slate-50/50" : "border-white/5 bg-white/[0.02]"
                      }`}
                    >
                      <img
                        src={interpreter.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${interpreter.name}`}
                        alt={interpreter.name}
                        className="w-10 h-10 rounded-full object-cover border border-white shadow-sm"
                        referrerPolicy="no-referrer"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-bold truncate ${theme === "light" ? "text-slate-900" : "text-white"}`}>
                          {firstName} ({ext})
                        </p>
                        <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Available
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDirectDialExt(interpreter.id)}
                        className="w-10 h-10 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-500/25 transition active:scale-95 cursor-pointer"
                        title={`Call ${interpreter.name}`}
                      >
                        <PhoneCall className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Direct Ext Speed-Dial */}
            <div className={`rounded-2xl border p-5 ${cardSurface}`}>
              <h4 className={`text-sm font-bold mb-4 ${theme === "light" ? "text-slate-900" : "text-white"}`}>
                Direct Ext Speed-Dial
              </h4>
              <div className="space-y-3">
                <label className={`text-xs font-semibold ${theme === "light" ? "text-slate-600" : "text-slate-400"}`}>
                  Ext Code
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={dialCode}
                    onChange={(e) => setDialCode(e.target.value)}
                    placeholder="Enter Extension Code"
                    className={`w-full border rounded-xl px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${inputSurface}`}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleKeypadCodeSubmit(); } }}
                  />
                  <LayoutGrid className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                </div>
                <button
                  type="button"
                  onClick={handleKeypadCodeSubmit}
                  className="w-full rounded-xl bg-[#2563EB] hover:bg-blue-600 text-white py-3 text-sm font-bold flex items-center justify-center gap-2 transition active:scale-[0.99] cursor-pointer"
                >
                  <PhoneCall className="w-4 h-4" />
                  Dial
                </button>
              </div>
            </div>
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
                      <span className={`px-2 py-0.5 rounded text-[8px] uppercase font-mono font-black border ${
                        sess.status === "completed" ? "bg-[#15803D]/10 text-[#15803D] border-[#15803D]/20" :
                        sess.status === "active" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 animate-pulse" :
                        "bg-zinc-800 text-slate-400 border-zinc-700"
                      }`}>
                        {sess.status}
                      </span>
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
