import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Users, Activity, DollarSign, Shield, ShieldAlert, FileText, Download, 
  Search, Eye, Ban, CheckCircle, Sliders, RefreshCw, AlertTriangle, AlertCircle, UserPlus
} from "lucide-react";
import { User, Session, Transaction, AuditLog, ContractDetails } from "../types";
import { RegisterInterpreterPayload, RegisterInterpreterResult } from "../lib/interpreterRegistration";
import { RegisterClientPayload, RegisterClientResult } from "../lib/clientRegistration";
import { formatLanguageProficiencies } from "../lib/interpreterMatching";

// Simple audio feedback helper
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

interface AdminDashboardProps {
  users: User[];
  sessions: Session[];
  transactions: Transaction[];
  auditLogs: AuditLog[];
  contractDetails: ContractDetails | null;
  contractsList: ContractDetails[];
  activeContractId: string;
  onActionComplete: () => void;
  onRegisterInterpreter: (payload: RegisterInterpreterPayload) => Promise<RegisterInterpreterResult>;
  onRegisterInstitutionClient: (payload: RegisterClientPayload) => Promise<RegisterClientResult>;
  theme?: string;
}

export default function AdminDashboard({ 
  users, 
  sessions, 
  transactions, 
  auditLogs, 
  contractDetails, 
  contractsList = [],
  activeContractId,
  onActionComplete,
  onRegisterInterpreter,
  onRegisterInstitutionClient,
  theme = "dark"
}: AdminDashboardProps) {
  // Retrieve authenticated user from localStorage
  const currentUser = (() => {
    try {
      const saved = localStorage.getItem("orzo_auth_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  })();

  // Dashboard Slider Section Switcher
  const [dashboardSlide, setDashboardSlide] = useState<"analytics" | "compliance" | "sla">("analytics");

  // Search and Filter State
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedSessionForLogs, setSelectedSessionForLogs] = useState<Session | null>(null);

  // Corporate Contract SLA States
  const [adminOrg, setAdminOrg] = useState(contractDetails?.organizationName || "Ethiopian Ministry of Health");
  const [adminSla, setAdminSla] = useState(contractDetails?.slaLevel || "Tier-1 Healthcare Gold SLA");
  const [adminCode, setAdminCode] = useState(contractDetails?.billingCode || "EMH-ADDIS-8898");
  const [adminSaveSuccess, setAdminSaveSuccess] = useState(false);

  // Create Corporate Client SLA States
  const [newOrgName, setNewOrgName] = useState("");
  const [newSlaLevel, setNewSlaLevel] = useState("Tier-1 Corporate Gold SLA");
  const [newDuration, setNewDuration] = useState("monthly"); // monthly, quarterly, half-year, yearly
  const [newBillingCode, setNewBillingCode] = useState("");
  const [newConcurrentSessions, setNewConcurrentSessions] = useState("5");
  const [newContractSuccess, setNewContractSuccess] = useState(false);
  const [newContractError, setNewContractError] = useState("");

  const ETHIOPIAN_LANGUAGES = ["Amharic", "Afaan Oromo", "Tigrinya", "Somali", "English", "Afar"];

  const [newInterpreterName, setNewInterpreterName] = useState("");
  const [newInterpreterEmail, setNewInterpreterEmail] = useState("");
  const [newInterpreterPassword, setNewInterpreterPassword] = useState("demo1234");
  const [newInterpreterLanguages, setNewInterpreterLanguages] = useState<string[]>([]);
  const [newInterpreterHourlyRate, setNewInterpreterHourlyRate] = useState("40");
  const [newInterpreterAvatar, setNewInterpreterAvatar] = useState("");
  const [newInterpreterSuccess, setNewInterpreterSuccess] = useState("");
  const [newInterpreterError, setNewInterpreterError] = useState("");
  const [isCreatingInterpreter, setIsCreatingInterpreter] = useState(false);

  const [newClientName, setNewClientName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientPassword, setNewClientPassword] = useState("demo1234");
  const [newClientContractId, setNewClientContractId] = useState(
    () => contractsList[0]?.contractId || activeContractId || ""
  );
  const [newClientIsPrimary, setNewClientIsPrimary] = useState(true);
  const [newClientStatus, setNewClientStatus] = useState<"active" | "pending" | "suspended">("active");
  const [newClientSuccess, setNewClientSuccess] = useState("");
  const [newClientError, setNewClientError] = useState("");
  const [isCreatingClient, setIsCreatingClient] = useState(false);

  // Sync state if backend updates
  React.useEffect(() => {
    if (contractDetails) {
      setAdminOrg(contractDetails.organizationName);
      setAdminSla(contractDetails.slaLevel);
      setAdminCode(contractDetails.billingCode);
    }
  }, [contractDetails]);

  React.useEffect(() => {
    if (!newClientContractId && contractsList.length > 0) {
      setNewClientContractId(activeContractId || contractsList[0].contractId);
    }
  }, [contractsList, activeContractId, newClientContractId]);

  const handleAdminContractSubmit = async (daysDelta: number) => {
    try {
      const res = await fetch("/api/contract/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days: daysDelta,
          organizationName: adminOrg,
          slaLevel: adminSla,
          billingCode: adminCode
        })
      });
      if (res.ok) {
        setAdminSaveSuccess(true);
        setTimeout(() => setAdminSaveSuccess(false), 3000);
        onActionComplete();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelectContract = async (contractId: string) => {
    try {
      const res = await fetch("/api/contract/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId })
      });
      if (res.ok) {
        onActionComplete();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateContractSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewContractError("");
    setNewContractSuccess(false);

    if (!newOrgName.trim()) {
      setNewContractError("Organization Name is required");
      return;
    }

    try {
      const res = await fetch("/api/contract/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName: newOrgName,
          slaLevel: newSlaLevel,
          duration: newDuration,
          maxConcurrentSessions: Number(newConcurrentSessions),
          billingCode: newBillingCode.trim() || undefined
        })
      });

      if (res.ok) {
        setNewContractSuccess(true);
        setNewOrgName("");
        setNewBillingCode("");
        setTimeout(() => setNewContractSuccess(false), 4000);
        onActionComplete();
      } else {
        const data = await res.json();
        setNewContractError(data.error || "Failed to register contract");
      }
    } catch (err) {
      console.error(err);
      setNewContractError("Error reaching corporate registry server");
    }
  };

  // Stats Calculations
  const totalUsers = users.length;
  const activeSessionsCount = sessions.filter(s => s.status === "active").length;
  const totalRevenue = transactions
    .filter(t => t.type === "deposit" && t.status === "completed")
    .reduce((sum, t) => sum + t.amount, 0);
  
  const platformCommissions = transactions
    .filter(t => t.type === "payment" && t.status === "completed")
    .reduce((sum, t) => sum + t.amount * 0.15, 0); // 15% platform fee

  // Filter Users
  const filteredUsers = users.filter(user => {
    const matchesSearch = user.name.toLowerCase().includes(userSearch.toLowerCase()) || 
                          user.email.toLowerCase().includes(userSearch.toLowerCase()) || 
                          user.id.toLowerCase().includes(userSearch.toLowerCase());
    const matchesRole = roleFilter === "all" || user.role === roleFilter;
    const matchesStatus = statusFilter === "all" || user.status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });

  // Action helpers
  const handleToggleUserStatus = async (id: string, currentStatus: string) => {
    const nextStatus = currentStatus === "active" ? "suspended" : "active";
    try {
      const res = await fetch(`/api/users/${id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
      });
      if (res.ok) {
        onActionComplete();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const toggleInterpreterLanguage = (language: string) => {
    setNewInterpreterLanguages((prev) =>
      prev.includes(language) ? prev.filter((l) => l !== language) : [...prev, language]
    );
  };

  const handleCreateInterpreterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewInterpreterError("");
    setNewInterpreterSuccess("");

    if (!newInterpreterName.trim()) {
      setNewInterpreterError("Full name is required.");
      return;
    }
    if (!newInterpreterEmail.trim()) {
      setNewInterpreterError("Email address is required.");
      return;
    }
    if (newInterpreterLanguages.length === 0) {
      setNewInterpreterError("Select at least one accredited language.");
      return;
    }

    setIsCreatingInterpreter(true);
    try {
      const result = await onRegisterInterpreter({
        name: newInterpreterName.trim(),
        email: newInterpreterEmail.trim(),
        password: newInterpreterPassword.trim() || "demo1234",
        languages: newInterpreterLanguages,
        hourlyRate: Number(newInterpreterHourlyRate) || 40,
        avatar: newInterpreterAvatar.trim() || undefined,
        adminName: currentUser?.name || "Administrator",
      });

      if (result.ok && result.user) {
        playBeepTone(880, 120);
        setNewInterpreterSuccess(
          `Interpreter ${result.user.name} registered successfully.${
            result.temporaryPassword ? ` Login password: ${result.temporaryPassword}` : ""
          }${result.localOnly ? " (Saved locally until dev server is restarted on port 3000.)" : ""}`
        );
        setNewInterpreterName("");
        setNewInterpreterEmail("");
        setNewInterpreterPassword("demo1234");
        setNewInterpreterLanguages([]);
        setNewInterpreterHourlyRate("40");
        setNewInterpreterAvatar("");
        setRoleFilter("interpreter");
        onActionComplete();
      } else {
        setNewInterpreterError(result.error || "Failed to register interpreter.");
      }
    } catch (err) {
      console.error(err);
      setNewInterpreterError("Registration failed unexpectedly. Please try again.");
    } finally {
      setIsCreatingInterpreter(false);
    }
  };

  const handleCreateClientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewClientError("");
    setNewClientSuccess("");

    if (!newClientName.trim()) {
      setNewClientError("Full name is required.");
      return;
    }
    if (!newClientEmail.trim()) {
      setNewClientError("Email address is required.");
      return;
    }
    if (!newClientContractId) {
      setNewClientError("Select an institution contract.");
      return;
    }

    setIsCreatingClient(true);
    try {
      const result = await onRegisterInstitutionClient({
        name: newClientName.trim(),
        email: newClientEmail.trim(),
        password: newClientPassword.trim() || "demo1234",
        contractId: newClientContractId,
        isInstitutionPrimary: newClientIsPrimary,
        status: newClientStatus,
        adminName: currentUser?.name || "Administrator",
      });

      if (result.ok && result.user) {
        playBeepTone(880, 120);
        setNewClientSuccess(
          `Institution client ${result.user.name} registered successfully.${
            result.temporaryPassword ? ` Login password: ${result.temporaryPassword}` : ""
          }${result.localOnly ? " (Saved locally until dev server is restarted on port 3000.)" : ""}`
        );
        setNewClientName("");
        setNewClientEmail("");
        setNewClientPassword("demo1234");
        setRoleFilter("client");
        onActionComplete();
      } else {
        setNewClientError(result.error || "Failed to register institution client.");
      }
    } catch (err) {
      console.error(err);
      setNewClientError("Registration failed unexpectedly. Please try again.");
    } finally {
      setIsCreatingClient(false);
    }
  };

  const handleUpdateHourlyRate = async (id: string, rate: number) => {
    try {
      const res = await fetch(`/api/users/${id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hourlyRate: rate })
      });
      if (res.ok) {
        onActionComplete();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleEmergencyIntervene = async (sessionId: string) => {
    if (!confirm("Are you sure you want to trigger an emergency override on this live session? This will force-disconnect WebRTC and AI translations to protect customer security.")) {
      return;
    }
    try {
      const res = await fetch(`/api/sessions/${sessionId}/intervene`, {
        method: "POST"
      });
      if (res.ok) {
        onActionComplete();
        setSelectedSessionForLogs(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Convert state for CSV export
  const exportUsersCSV = () => {
    const headers = "ID,Name,Email,Role,Status,Password,Completed Sessions,Hourly Rate\n";
    const rows = users.map(u =>
      `"${u.id}","${u.name}","${u.email}","${u.role}","${u.status}","${u.provisionedPassword || "demo1234"}",${u.completedSessions || 0},${u.hourlyRate || 0}`
    ).join("\n");
    
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.setAttribute("href", url);
    a.setAttribute("download", `elliot_users_export_${new Date().toISOString().slice(0,10)}.csv`);
    a.click();
  };

  return (
    <div id="admin-dashboard-container" className="space-y-8 animate-fade-in font-sans">
      
      {/* Dynamic Welcoming Card Banner */}
      <div className={`p-6 rounded-2xl border relative overflow-hidden transition-all duration-300 ${
        theme === "light" 
          ? "bg-gradient-to-r from-rose-50 to-orange-50/50 border-rose-100 shadow-sm text-slate-800" 
          : "bg-gradient-to-r from-rose-950/20 to-orange-950/20 border-white/5 backdrop-blur-xl text-slate-200"
      }`}>
        <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 dark:bg-rose-400/5 rounded-full blur-2xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl">👑</span>
              <h2 className={`text-lg sm:text-xl font-bold tracking-tight ${
                theme === "light" ? "text-slate-900" : "text-white"
              }`}>
                Selam, {currentUser?.name || "Administrator"}!
              </h2>
            </div>
            <p className={`text-xs ${theme === "light" ? "text-slate-600" : "text-slate-400"} max-w-xl leading-relaxed`}>
              Welcome back to your governance console. Monitor active communication slots, review high-fidelity audit trail logs, configure enterprise corporate SLAs, and dispatch financial payouts.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center">
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-slate-400 px-2.5 py-1 rounded bg-black/15 border border-white/5 whitespace-nowrap">
              Governance Node Active
            </span>
          </div>
        </div>
      </div>
      
      {/* Welcome & System State */}
      <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-5 ${
        theme === "light" ? "border-slate-200" : "border-white/5"
      }`}>
        <div>
          <h1 className={`text-xl font-semibold tracking-tight font-sans ${
            theme === "light" ? "text-slate-900" : "text-white"
          }`}>
            Admin Governance Console
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time compliance monitoring, security dispatch, and automated financial settlements across Ethiopia.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Signaling Core Online
          </span>
          <button 
            id="admin-refresh-btn"
            onClick={onActionComplete}
            className={`p-1.5 px-3 rounded-xl border text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
              theme === "light" 
                ? "bg-white border-slate-200 hover:bg-slate-50 text-slate-700" 
                : "bg-zinc-900 border-white/5 hover:bg-zinc-800 text-slate-300"
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Sync State
          </button>
        </div>
      </div>

      {/* Interactive Slider Section Switcher to prevent elongated scrolling */}
      <div className="flex items-center justify-center pt-2 pb-1">
        <div className={`p-1 rounded-2xl border flex items-center gap-1.5 w-full max-w-xl relative ${
          theme === "light" ? "bg-slate-200/60 border-slate-300/40" : "bg-[#16161A]/80 border-white/5"
        }`}>
          <button
            type="button"
            onClick={() => { setDashboardSlide("analytics"); playBeepTone(400, 50); }}
            className={`flex-1 py-2.5 text-center text-xs font-bold uppercase rounded-xl transition-all duration-300 relative z-10 flex items-center justify-center gap-2 cursor-pointer ${
              dashboardSlide === "analytics"
                ? "bg-purple-600 text-white shadow-lg shadow-purple-500/20"
                : theme === "light" ? "text-slate-600 hover:text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>📊 Analytics</span>
          </button>
          <button
            type="button"
            onClick={() => { setDashboardSlide("compliance"); playBeepTone(420, 50); }}
            className={`flex-1 py-2.5 text-center text-xs font-bold uppercase rounded-xl transition-all duration-300 relative z-10 flex items-center justify-center gap-2 cursor-pointer ${
              dashboardSlide === "compliance"
                ? "bg-[#0A66C2] text-white shadow-lg shadow-blue-500/20"
                : theme === "light" ? "text-slate-600 hover:text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>🛡️ Compliance</span>
          </button>
          <button
            type="button"
            onClick={() => { setDashboardSlide("sla"); playBeepTone(440, 50); }}
            className={`flex-1 py-2.5 text-center text-xs font-bold uppercase rounded-xl transition-all duration-300 relative z-10 flex items-center justify-center gap-2 cursor-pointer ${
              dashboardSlide === "sla"
                ? "bg-emerald-600 text-white shadow-lg shadow-emerald-500/20"
                : theme === "light" ? "text-slate-600 hover:text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>⚖️ SLAs</span>
          </button>
        </div>
      </div>

      {/* Slide 1: General Analytics & Audit */}
      {dashboardSlide === "analytics" && (
        <div className="space-y-8 animate-fade-in">

          {/* KPI Overviews */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        <div className="bg-[#16161A] p-5 rounded-2xl border border-white/5 flex items-center gap-4 shadow-xl">
          <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 block uppercase tracking-widest">Registered Accounts</span>
            <span className="font-mono text-2xl font-bold text-white mt-1 block">{totalUsers}</span>
          </div>
        </div>

        <div className="bg-[#16161A] p-5 rounded-2xl border border-white/5 flex items-center gap-4 shadow-xl">
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 block uppercase tracking-widest">Active Call Rooms</span>
            <span className="font-mono text-2xl font-bold text-white mt-1 block">{activeSessionsCount}</span>
          </div>
        </div>

        <div className="bg-[#16161A] p-5 rounded-2xl border border-white/5 flex items-center gap-4 shadow-xl">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 block uppercase tracking-widest">Total Top-ups (Chapa)</span>
            <span className="font-mono text-2xl font-bold text-white mt-1 block">{totalRevenue.toLocaleString()} <span className="text-[10px] text-emerald-400">ETB</span></span>
          </div>
        </div>

        <div className="bg-[#16161A] p-5 rounded-2xl border border-white/5 flex items-center gap-4 shadow-xl">
          <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 block uppercase tracking-widest">15% Commission Revenue</span>
            <span className="font-mono text-2xl font-bold text-white mt-1 block">{platformCommissions.toLocaleString()} <span className="text-[10px] text-purple-400">ETB</span></span>
          </div>
        </div>
      </div>

      {/* Analytical Charts and Audit Summary (Bento-grid styled) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Interactive SVG Chart for Platform performance */}
        <div className="bg-[#16161A] p-5 rounded-2xl border border-white/5 lg:col-span-2 shadow-2xl">
          <div className="flex justify-between items-center mb-5">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Revenue Realization Overview</h3>
              <p className="text-xs text-slate-500 mt-1">Monthly collection loads vs disbursed commission yields.</p>
            </div>
            <div className="flex gap-4 text-xs font-medium font-sans">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Inflow</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Outflow</span>
            </div>
          </div>

          {/* Pure SVG Custom Bar Chart */}
          <div className="h-44 w-full flex items-end">
            <svg viewBox="0 0 500 150" className="w-full h-full">
              {/* Guidelines */}
              <line x1="0" y1="20" x2="500" y2="20" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="4" />
              <line x1="0" y1="70" x2="500" y2="70" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="4" />
              <line x1="0" y1="120" x2="500" y2="120" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="4" />
              
              {/* March */}
              <rect x="50" y="50" width="20" height="90" rx="4" fill="#3B82F6" className="hover:opacity-80 transition-opacity cursor-pointer" />
              <rect x="75" y="80" width="10" height="60" rx="2" fill="#10B981" />
              <text x="62" y="148" textAnchor="middle" className="text-[10px] fill-slate-500 font-mono">March</text>
              
              {/* April */}
              <rect x="150" y="30" width="20" height="110" rx="4" fill="#3B82F6" className="hover:opacity-80 transition-opacity cursor-pointer" />
              <rect x="175" y="65" width="10" height="75" rx="2" fill="#10B981" />
              <text x="162" y="148" textAnchor="middle" className="text-[10px] fill-slate-500 font-mono">April</text>
              
              {/* May */}
              <rect x="250" y="20" width="20" height="120" rx="4" fill="#3B82F6" className="hover:opacity-80 transition-opacity cursor-pointer" />
              <rect x="275" y="45" width="10" height="95" rx="2" fill="#10B981" />
              <text x="262" y="148" textAnchor="middle" className="text-[10px] fill-slate-500 font-mono">May</text>
              
              {/* June (Current status) */}
              <rect x="350" y="10" width="20" height="130" rx="4" fill="#60A5FA" className="hover:opacity-80 transition-opacity cursor-pointer animate-pulse" />
              <rect x="375" y="30" width="10" height="110" rx="2" fill="#34D399" />
              <text x="362" y="148" textAnchor="middle" className="text-[10px] fill-slate-300 font-bold font-mono">June</text>
            </svg>
          </div>
          <div className="border-t border-white/5 pt-3.5 flex justify-between text-[11px] text-slate-500 font-mono">
            <span>Peak Month capacity: 8,400 sessions</span>
            <span>Est. CAGR: +24.5%</span>
          </div>
        </div>

        {/* Security Audit Log Stream */}
        <div className="bg-[#16161A] p-5 rounded-2xl border border-white/5 flex flex-col h-64 lg:h-auto shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 animate-pulse">
              <ShieldAlert className="w-4 h-4 text-purple-400" />
              Active Audit Stream
            </h3>
            <span className="text-[9px] font-mono text-zinc-500 bg-black/60 px-2 py-0.5 rounded leading-none">Tail -f logs</span>
          </div>

          <div className="overflow-y-auto space-y-3 mt-3.5 flex-1 px-1 py-1">
            {auditLogs.slice(0, 10).map(log => {
              let tagColor = "border-white/5 bg-zinc-900/60 text-slate-400";
              if (log.status === "success") tagColor = "bg-emerald-500/10 text-emerald-405 border-emerald-500/20";
              if (log.status === "warning") tagColor = "bg-amber-500/10 text-amber-400 border-amber-500/20";
              if (log.status === "danger") tagColor = "bg-red-500/10 text-red-400 border-red-500/20";

              return (
                <div key={log.id} className="text-xs p-3 rounded-xl border border-white/5 flex flex-col gap-1 bg-black/10 hover:border-white/10 transition-colors">
                  <div className="flex justify-between items-center">
                    <span className="font-sans font-semibold text-slate-200">{log.action}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${tagColor}`}>
                      {log.userRole}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
                    <span>User: {log.userName}</span>
                    <span>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      </div>
      )}

      {/* Slide 3: Corporate SLA Agreements */}
      {dashboardSlide === "sla" && (
        <div className="space-y-8 animate-fade-in">
          {/* Corporate SLA Agreement Governance panel */}
          <div className="bg-[#16161A] border border-white/5 rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
              <FileText className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                Client Organization SLA Agreement Lifecycle Manager
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Control administrative client seat allocations, corporate billing indexes, and scheduled expiration duration.</p>
            </div>
          </div>
          <span className="text-[10px] bg-blue-900/40 text-blue-400 font-mono font-bold px-2.5 py-1 rounded border border-blue-800/10 uppercase tracking-widest">
            SLA Control Board
          </span>
        </div>

        {adminSaveSuccess && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-lg animate-scale-up">
            ✓ Corporate Agreement parameters updated on live service memory. Local terminals synchronized.
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 pt-2">
          
          {/* Active Contract & Selector Panel */}
          <div className="xl:col-span-3 bg-black/30 border border-white/5 p-4 rounded-xl space-y-4">
            <div>
              <span className="text-[10px] text-zinc-500 font-mono font-bold uppercase tracking-widest block mb-2">Live Workspaces</span>
              {contractsList && contractsList.length > 0 ? (
                <div className="space-y-1.5 max-h-[175px] overflow-y-auto pr-1">
                  {contractsList.map((c) => {
                    const isSelected = c.contractId === activeContractId;
                    return (
                      <button
                        key={c.contractId}
                        type="button"
                        onClick={() => handleSelectContract(c.contractId)}
                        className={`w-full text-left p-2 rounded-lg border text-xs transition-all ${
                          isSelected 
                            ? "bg-blue-500/15 border-blue-500/40 text-blue-300" 
                            : "bg-zinc-900/45 border-white/5 hover:border-white/15 text-slate-400"
                        }`}
                      >
                        <div className="font-bold flex justify-between items-center">
                          <span className="truncate">{c.organizationName}</span>
                          <span className={`text-[8px] font-mono px-1 rounded uppercase ${
                            c.status === "expired" ? "bg-rose-900/40 text-rose-300" : "bg-emerald-900/40 text-emerald-300"
                          }`}>
                            {c.status}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-slate-500 mt-0.5 flex justify-between">
                          <span>{c.slaLevel.split(" ")[0]} SLA</span>
                          <span>{Math.max(0, Math.ceil((new Date(c.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))}d Left</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500 italic">No workspaces registered.</p>
              )}
            </div>

            <div className="border-t border-white/5 pt-3.5 space-y-3">
              <span className="text-[10px] text-zinc-500 font-mono font-bold uppercase tracking-widest block">Active Metadata</span>
              {contractDetails ? (
                <div className="space-y-2.5 text-xs">
                  <div>
                    <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">ORGANIZATION NAME</span>
                    <span className="text-white font-bold">{contractDetails.organizationName}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">CONTRACT ID</span>
                      <span className="text-zinc-300 font-mono font-bold text-[10px] block truncate">{contractDetails.contractId}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">SLA CODE</span>
                      <span className="text-blue-400 font-bold font-mono text-[10px] block truncate">{contractDetails.billingCode}</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">EXPIRATION</span>
                    <span className="text-amber-400 font-bold font-mono text-xs">
                      {new Date(contractDetails.expiryDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      <span className="text-[10px] text-zinc-500 font-normal block font-sans">
                        ({Math.max(0, Math.ceil((new Date(contractDetails.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))} days remaining)
                      </span>
                    </span>
                  </div>
                </div>
              ) : (
                <span className="text-slate-500 text-[11px] italic">No active contract selected.</span>
              )}
            </div>
          </div>

          {/* Current SLA Administration Form */}
          <div className="xl:col-span-5 space-y-4 bg-zinc-900/10 border border-white/5 p-4 rounded-xl">
            <span className="text-[10px] text-zinc-500 font-mono font-bold uppercase tracking-widest block">Active Contract Parameters</span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[9px] uppercase text-zinc-450 font-bold block text-zinc-400">Organization Name Title</label>
                <input 
                  type="text"
                  value={adminOrg}
                  onChange={(e) => setAdminOrg(e.target.value)}
                  className="w-full bg-zinc-900 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500 font-semibold"
                />
              </div>
              
              <div className="space-y-1">
                <label className="text-[9px] uppercase text-zinc-450 font-bold block text-zinc-400">Coverage Level SLA Tag</label>
                <input 
                  type="text"
                  value={adminSla}
                  onChange={(e) => setAdminSla(e.target.value)}
                  className="w-full bg-zinc-900 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1 md:col-span-2">
                <label className="text-[9px] uppercase text-zinc-450 font-bold block text-zinc-400">Billing Reference Index Code</label>
                <input 
                  type="text"
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  className="w-full bg-zinc-900 border border-white/10 rounded-lg p-2 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="bg-black/40 p-3 border border-white/5 rounded-lg space-y-2">
              <span className="text-[9px] text-zinc-400 font-mono font-bold uppercase tracking-widest block text-amber-500/90">Extend or Adjust Expiration Term</span>
              <p className="text-[10px] text-slate-400 leading-relaxed">Instantly add duration offsets to the active SLA period to test system state restrictions:</p>
              
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleAdminContractSubmit(30)}
                  className="p-2 rounded bg-zinc-900 border border-white/5 hover:border-blue-500 text-[11px] text-blue-400 hover:text-white transition truncate text-center font-bold cursor-pointer"
                >
                  ➕ Extend 30 Days
                </button>
                <button
                  type="button"
                  onClick={() => handleAdminContractSubmit(180)}
                  className="p-2 rounded bg-zinc-900 border border-white/5 hover:border-blue-500 text-[11px] text-indigo-400 hover:text-white transition truncate text-center font-bold cursor-pointer"
                >
                  ➕ Extend 180 Days
                </button>
                <button
                  type="button"
                  onClick={() => handleAdminContractSubmit(365)}
                  className="p-2 rounded bg-zinc-900 border border-white/5 hover:border-blue-500 text-[11px] text-emerald-400 hover:text-white transition truncate text-center font-bold cursor-pointer"
                >
                  ➕ Extend 1 Year
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Simulate immediate expiration for SLA validation?")) {
                      if (contractDetails) {
                        const daysOffset = Math.ceil((new Date(contractDetails.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) + 2;
                        handleAdminContractSubmit(-daysOffset);
                      }
                    }
                  }}
                  className="p-2 rounded bg-rose-950/20 border border-rose-500/20 hover:bg-rose-900/40 hover:border-rose-500 text-[11px] text-rose-300 hover:text-white transition truncate text-center font-bold cursor-pointer"
                >
                  🛑 Force Expired State
                </button>
              </div>
            </div>
          </div>

          {/* New Corporate Client SLA Agreement Registry Form */}
          <form onSubmit={handleCreateContractSubmit} className="xl:col-span-4 bg-black/40 border border-dashed border-white/10 p-4 rounded-xl space-y-3">
            <span className="text-[10px] text-zinc-500 font-mono font-bold uppercase tracking-widest block text-blue-400">Register New Org client Contract</span>
            
            {newContractSuccess && (
              <div className="p-2 bg-emerald-500/15 border border-emerald-500/20 text-emerald-450 text-[10px] rounded-md font-sans text-emerald-400">
                ✓ Client contract cataloged and activated.
              </div>
            )}
            
            {newContractError && (
              <div className="p-2 bg-rose-500/15 border border-rose-500/20 text-rose-400 text-[10px] rounded-md font-sans">
                ⚠️ {newContractError}
              </div>
            )}

            <div className="space-y-2.5 text-xs text-slate-300">
              <div className="space-y-0.5">
                <label className="text-[9px] uppercase font-bold text-zinc-400">Organization / Client Name</label>
                <input 
                  type="text"
                  placeholder="Ethiopian Airlines, Safaricom etc."
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  className="w-full bg-zinc-900/90 border border-white/10 rounded p-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <label className="text-[9px] uppercase font-bold text-zinc-400">SLA Support Badge</label>
                  <select
                    value={newSlaLevel}
                    onChange={(e) => setNewSlaLevel(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/10 rounded p-2 text-xs text-white focus:ring-0 focus:outline-none"
                  >
                    <option value="Tier-1 Enterprise Gold SLA">Tier-1 Gold SLA</option>
                    <option value="Tier-2 Financial Silver SLA">Tier-2 Silver SLA</option>
                    <option value="Tier-3 Academic Bronze SLA">Tier-3 Bronze SLA</option>
                    <option value="Custom Special Contract SLA">Custom SLA</option>
                  </select>
                </div>

                <div className="space-y-0.5">
                  <label className="text-[9px] uppercase font-bold text-zinc-400">Contract Term Duration</label>
                  <select
                    value={newDuration}
                    onChange={(e) => setNewDuration(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/10 rounded p-2 text-xs text-white focus:ring-0 focus:outline-none font-bold"
                  >
                    <option value="monthly">Monthly (30 Days)</option>
                    <option value="quarterly">Quarterly (90 Days)</option>
                    <option value="half-year">Half-Year (180 Days)</option>
                    <option value="yearly">Yearly (365 Days)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <label className="text-[9px] uppercase font-bold text-zinc-400">Concurrent Channels</label>
                  <input 
                    type="number"
                    min="1"
                    max="50"
                    value={newConcurrentSessions}
                    onChange={(e) => setNewConcurrentSessions(e.target.value)}
                    className="w-full bg-zinc-900/90 border border-white/10 rounded p-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>

                <div className="space-y-0.5">
                  <label className="text-[9px] uppercase font-bold text-zinc-400">Custom Billing Code</label>
                  <input 
                    type="text"
                    placeholder="Auto Generated"
                    value={newBillingCode}
                    onChange={(e) => setNewBillingCode(e.target.value)}
                    className="w-full bg-zinc-900/90 border border-white/10 rounded p-2 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white p-2.5 rounded text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer mt-1"
              >
                📝 Register Client Contract
              </button>
            </div>
          </form>

        </div>

        </div>
        </div>
      )}

      {/* Slide 1 Addition: Live Rooms Interception Dashboard */}
      {dashboardSlide === "analytics" && (
        <div className="space-y-8 animate-fade-in">
          {/* Operational Active Sessions Monitor Queue */}
          <div id="admin-active-sessions" className="bg-[#16161A] p-5 rounded-2xl border border-white/5 shadow-2xl">
        <div className="flex items-center gap-2 mb-4 border-b border-white/5 pb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping" />
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Live Room Interception Dashboard
          </h2>
          <span className="text-[10px] bg-zinc-900 border border-white/5 font-mono px-2 py-0.5 text-zinc-400 rounded-sm">
            {sessions.filter(s => s.status === "active").length} ongoing channels
          </span>
        </div>

        {sessions.filter(s => ["active", "incoming", "pending"].includes(s.status)).length === 0 ? (
          <div className="text-center py-8 border border-dashed border-white/5 bg-black/10 rounded-xl text-slate-450 text-xs">
            No live room broadcasts at this exact moment. Launch client session requests to see them update instantly here.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sessions.filter(s => ["active", "incoming", "pending"].includes(s.status)).map(session => (
              <div 
                key={session.id} 
                className={`p-4 rounded-xl border transition-all ${
                  session.status === "active" ? "border-amber-400/20 bg-amber-400/5" : "border-white/5 bg-black/10"
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-md uppercase font-mono">
                      ID: {session.id}
                    </span>
                    <h4 className="text-xs font-semibold text-white mt-1.5 font-sans">
                      {session.languageFrom} ⇆ {session.languageTo}
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5 capitalize">
                      Context: {session.serviceType} • Mode: {session.serviceMode}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-350">
                      Cost: {session.cost} ETB
                    </span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded border uppercase ${
                      session.status === "active" ? "bg-amber-500/10 text-amber-405 border-amber-500/20" : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                    }`}>
                      {session.status}
                    </span>
                  </div>
                </div>

                <div className="mt-3.5 pt-3.5 border-t border-white/5 flex flex-col gap-1 text-[11px] text-slate-400 leading-relaxed font-sans">
                  <span>Client: <span className="text-slate-200 font-mono">{session.clientName}</span></span>
                  {session.interpreterName ? (
                    <span>Interpreter: <span className="text-slate-200 font-mono">{session.interpreterName}</span></span>
                  ) : (
                    <span className="text-amber-500 font-bold animate-pulse">Awaiting matching interpreter pickup...</span>
                  )}
                </div>

                <div className="mt-4 flex gap-2 justify-end">
                  <button 
                    onClick={() => setSelectedSessionForLogs(session)}
                    className="px-3 h-8 text-[11px] bg-zinc-900 border border-white/5 hover:bg-zinc-850 text-slate-200 font-medium rounded-lg flex items-center gap-1 transition-colors"
                  >
                    <Eye className="w-3 h-3 text-cyan-400" />
                    Inspect Log
                  </button>
                  {session.status === "active" && (
                    <button 
                      onClick={() => handleEmergencyIntervene(session.id)}
                      className="px-3 h-8 text-[11px] bg-red-650 hover:bg-red-700 text-white font-medium rounded-lg flex items-center gap-1 transition-colors"
                    >
                      <Ban className="w-3 h-3" />
                      Intervene
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
      )}

      {/* Inspect Log Dialog modal */}
      {selectedSessionForLogs && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-[#16161A] rounded-2xl shadow-2xl border border-white/10 max-w-lg w-full p-6 animate-scale-up">
            <div className="flex justify-between items-start pb-4 border-b border-white/5">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-500" />
                  Signal Intercept Matrix: {selectedSessionForLogs.id}
                </h3>
                <p className="text-[11px] text-slate-500 mt-1">
                  Compliance review window. Decrypting audio channel feed securely.
                </p>
              </div>
              <button 
                onClick={() => setSelectedSessionForLogs(null)}
                className="text-slate-450 hover:text-white text-xl"
              >
                &times;
              </button>
            </div>

            <div className="h-56 overflow-y-auto block p-4 bg-black/50 text-slate-300 font-mono text-xs rounded-xl my-4 space-y-3.5 border border-white/5">
              <span className="text-amber-450 text-[10px] block border-b border-white/5 pb-1 flex justify-between uppercase font-black tracking-wider text-amber-400">
                <span>[DECRYPTED AUDIO INTERCEPT WAVE]</span>
                <span>STATE: {selectedSessionForLogs.status}</span>
              </span>
              {selectedSessionForLogs.chatMessages.map((msg, idx) => (
                <div key={idx} className="border-l-2 border-emerald-500 pl-3 leading-relaxed py-0.5">
                  <span className="text-slate-500 text-[10px]">[{msg.senderRole.toUpperCase()}] {msg.senderName}:</span>
                  <p className="text-white">{msg.text}</p>
                  {msg.translatedText && <p className="text-cyan-405 text-cyan-400">↳ Auto translate: {msg.translatedText}</p>}
                </div>
              ))}
              {selectedSessionForLogs.transcript.length > 0 && (
                <div className="pt-2.5 border-t border-white/5 text-[11px] space-y-1">
                  <span className="text-teal-450 font-bold block text-teal-405">[VOICE SIGNAL EXTRACT:]</span>
                  {selectedSessionForLogs.transcript.map((line, idx) => (
                    <p key={idx} className="text-slate-400">{line}</p>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-between items-center bg-black/30 p-3 rounded-xl border border-white/5 mt-4">
              {selectedSessionForLogs.status === "active" ? (
                <button 
                  onClick={() => handleEmergencyIntervene(selectedSessionForLogs.id)}
                  className="px-4 py-2 bg-red-650 hover:bg-red-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                >
                  <Ban className="w-3.5 h-3.5" /> Force Disconnect
                </button>
              ) : (
                <span className="text-xs text-amber-500 font-medium">
                  Session locked. No active override.
                </span>
              )}
              <button 
                onClick={() => setSelectedSessionForLogs(null)}
                className="px-4 h-9 bg-zinc-900 border border-white/5 hover:bg-zinc-800 text-slate-300 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors"
              >
                Close Compliance
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slide 2: Compliance Account Directory */}
      {dashboardSlide === "compliance" && (
        <div className="space-y-8 animate-fade-in">

          {/* Register New Interpreter */}
          <form
            id="admin-add-interpreter"
            onSubmit={handleCreateInterpreterSubmit}
            className="bg-[#16161A] border border-white/5 rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="p-5 border-b border-white/5 bg-black/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-blue-400" />
                  Register New Interpreter
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Add accredited language specialists to the dispatch pool. They can log in immediately with the credentials you set.
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {newInterpreterSuccess && (
                <div className="p-3 bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl">
                  ✓ {newInterpreterSuccess}
                </div>
              )}
              {newInterpreterError && (
                <div className="p-3 bg-rose-500/15 border border-rose-500/20 text-rose-400 text-xs rounded-xl">
                  ⚠️ {newInterpreterError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-zinc-400">Full Name</label>
                  <input
                    type="text"
                    placeholder="Abebe Kebede"
                    value={newInterpreterName}
                    onChange={(e) => setNewInterpreterName(e.target.value)}
                    className="w-full bg-zinc-900/90 border border-white/10 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-zinc-400">Email</label>
                  <input
                    type="email"
                    placeholder="interpreter@example.com"
                    value={newInterpreterEmail}
                    onChange={(e) => setNewInterpreterEmail(e.target.value)}
                    className="w-full bg-zinc-900/90 border border-white/10 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-zinc-400">Initial Password</label>
                  <input
                    type="text"
                    value={newInterpreterPassword}
                    onChange={(e) => setNewInterpreterPassword(e.target.value)}
                    className="w-full bg-zinc-900/90 border border-white/10 rounded-lg p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-zinc-400">Hourly Payout (ETB)</label>
                  <input
                    type="number"
                    min="1"
                    value={newInterpreterHourlyRate}
                    onChange={(e) => setNewInterpreterHourlyRate(e.target.value)}
                    className="w-full bg-zinc-900/90 border border-white/10 rounded-lg p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[9px] uppercase font-bold text-zinc-400 block">Accredited Languages</label>
                <div className="flex flex-wrap gap-2">
                  {ETHIOPIAN_LANGUAGES.map((lang) => {
                    const selected = newInterpreterLanguages.includes(lang);
                    return (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => toggleInterpreterLanguage(lang)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                          selected
                            ? "bg-blue-600/20 border-blue-500/40 text-blue-300"
                            : "bg-zinc-900 border-white/10 text-slate-400 hover:border-white/20"
                        }`}
                      >
                        {lang}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-zinc-400">Avatar URL (optional)</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={newInterpreterAvatar}
                  onChange={(e) => setNewInterpreterAvatar(e.target.value)}
                  className="w-full bg-zinc-900/90 border border-white/10 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <button
                type="submit"
                disabled={isCreatingInterpreter}
                className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                {isCreatingInterpreter ? "Registering..." : "Add Interpreter to Pool"}
              </button>
            </div>
          </form>

          {/* Register Institution Client */}
          <form
            id="admin-add-institution-client"
            onSubmit={handleCreateClientSubmit}
            className="bg-[#16161A] border border-white/5 rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="p-5 border-b border-white/5 bg-black/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-emerald-400" />
                  Register Institution Client
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Provision primary org logins and staff sub-accounts linked to an active SLA contract.
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {newClientSuccess && (
                <div className="p-3 bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl">
                  ✓ {newClientSuccess}
                </div>
              )}
              {newClientError && (
                <div className="p-3 bg-rose-500/15 border border-rose-500/20 text-rose-400 text-xs rounded-xl">
                  ⚠️ {newClientError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-zinc-400">Institution Contract</label>
                  <select
                    value={newClientContractId}
                    onChange={(e) => setNewClientContractId(e.target.value)}
                    className="w-full bg-zinc-900/90 border border-white/10 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    {contractsList.map((c) => (
                      <option key={c.contractId} value={c.contractId}>
                        {c.organizationName} ({c.status})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-zinc-400">Full Name</label>
                  <input
                    type="text"
                    placeholder="Dawit Yohannes"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    className="w-full bg-zinc-900/90 border border-white/10 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-zinc-400">Email</label>
                  <input
                    type="email"
                    placeholder="desk@moh.gov.et"
                    value={newClientEmail}
                    onChange={(e) => setNewClientEmail(e.target.value)}
                    className="w-full bg-zinc-900/90 border border-white/10 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-bold text-zinc-400">Initial Password</label>
                  <input
                    type="text"
                    value={newClientPassword}
                    onChange={(e) => setNewClientPassword(e.target.value)}
                    className="w-full bg-zinc-900/90 border border-white/10 rounded-lg p-2.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newClientIsPrimary}
                    onChange={(e) => setNewClientIsPrimary(e.target.checked)}
                    className="rounded border-white/20"
                  />
                  Primary org account (one per institution)
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-[9px] uppercase font-bold text-zinc-400">Status</label>
                  <select
                    value={newClientStatus}
                    onChange={(e) => setNewClientStatus(e.target.value as "active" | "pending" | "suspended")}
                    className="bg-zinc-900/90 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isCreatingClient}
                className="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                {isCreatingClient ? "Registering..." : "Add Institution Client"}
              </button>
            </div>
          </form>

          {/* Main Users Management Data Grid (Complete Admin Table) */}
          <div id="admin-user-management" className="bg-[#16161A] border border-white/5 rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Table Controls */}
        <div className="p-5 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-black/10">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-450">Role-Based Account Authority Matrix</h3>
            <p className="text-xs text-slate-500 mt-1">Audit interpreter hourly rates, completed counts, and suspension flags.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            
            {/* Search Input */}
            <div className="relative flex-1 md:flex-initial">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
              <input 
                type="text"
                placeholder="Search Client ID/Name..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="pl-9 pr-4 py-1.5 bg-zinc-900 border border-white/10 rounded-xl text-xs text-white placeholder-zinc-550 w-full focus:outline-none focus:border-blue-500 font-sans"
              />
            </div>

            {/* Role Filter */}
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="bg-zinc-900 border border-white/10 rounded-xl text-xs text-slate-350 p-2 focus:outline-none"
            >
              <option value="all">Every Role</option>
              <option value="admin">Administrators</option>
              <option value="client">Clients</option>
              <option value="interpreter">Interpreters</option>
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-zinc-900 border border-white/10 rounded-xl text-xs text-slate-350 p-2 focus:outline-none"
            >
              <option value="all">Every Status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>

            {/* CSV export */}
            <button
              onClick={exportUsersCSV}
              className="px-3 py-2 rounded-xl border border-white/5 bg-zinc-900 hover:bg-zinc-800 text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export UTF-8
            </button>
          </div>
        </div>

        {/* Responsive Table UI */}
        <div className="overflow-x-auto">
          <table id="admin-users-table" className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 text-[10px] font-bold text-slate-500 uppercase bg-black/5 tracking-wider">
                <th className="p-4">Identities</th>
                <th className="p-4">Login Password</th>
                <th className="p-4">Role / Authority</th>
                <th className="p-4">Institution</th>
                <th className="p-4">Accredited Languages</th>
                <th className="p-4">Hourly Payout</th>
                <th className="p-4">Performance Index</th>
                <th className="p-4 text-right pr-6">Compliance Mode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-xs text-slate-300 font-sans">
              {filteredUsers.map(user => (
                <tr key={user.id} className="hover:bg-white/5 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <img 
                        src={user.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${user.name}`} 
                        alt="Avatar" 
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-8 h-8 rounded-full border border-white/10 bg-zinc-900"
                      />
                      <div>
                        <span className="font-semibold text-white block font-sans">{user.name}</span>
                        <span className="text-[10px] text-zinc-500 font-mono">{user.email}</span>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <code className="text-[11px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded">
                      {user.provisionedPassword || "demo1234"}
                    </code>
                  </td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[9px] uppercase font-black border tracking-wider ${
                      user.role === "admin" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                      user.role === "interpreter" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                      "bg-zinc-800 text-slate-405 border-white/10 text-slate-300"
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="p-4 text-[11px] text-slate-400">
                    {user.role === "client" && user.organizationName ? (
                      <div>
                        <span className="text-slate-200 block">{user.organizationName}</span>
                        {user.isInstitutionPrimary && (
                          <span className="text-[9px] uppercase text-emerald-400 font-bold">Primary</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-zinc-550">—</span>
                    )}
                  </td>
                  <td className="p-4 font-mono text-[11px] text-slate-400">
                    {user.role === "interpreter"
                      ? formatLanguageProficiencies(user.languages, user.languageProficiencies)
                      : "—"}
                  </td>
                  <td className="p-4">
                    {user.role === "interpreter" ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          value={user.hourlyRate || 30}
                          onChange={(e) => handleUpdateHourlyRate(user.id, Number(e.target.value))}
                          className="w-14 bg-zinc-900 border border-white/10 rounded p-1 text-slate-200 font-mono text-center text-xs focus:outline-none"
                        />
                        <span className="text-[10px] text-slate-550 uppercase font-bold">ETB/hr</span>
                      </div>
                    ) : (
                      <span className="text-zinc-550">—</span>
                    )}
                  </td>
                  <td className="p-4 font-mono">
                    {user.role === "interpreter" ? (
                      <div className="flex flex-col">
                        <span className="font-semibold text-amber-400 block">★ {user.rating}</span>
                        <span className="text-[10px] text-slate-500 font-sans">{user.completedSessions} completed sessions</span>
                      </div>
                    ) : (
                      <span className="text-zinc-550">—</span>
                    )}
                  </td>
                  <td className="p-4 text-right pr-6">
                    <div className="flex items-center justify-end gap-3.5">
                      <span className={`font-black uppercase text-[9px] tracking-widest ${
                        user.status === "active" ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {user.status}
                      </span>
                      <button
                        onClick={() => handleToggleUserStatus(user.id, user.status)}
                        className={`p-1 py-1 px-3.5 text-[10px] border rounded-xl leading-none ${
                          user.status === "active" 
                            ? "border-red-500/20 text-red-400 hover:bg-red-500/5 bg-red-500/5" 
                            : "border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/5 bg-emerald-500/5"
                        } font-bold uppercase tracking-wider transition-colors`}
                      >
                        {user.status === "active" ? "Suspend" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredUsers.length === 0 && (
          <div className="text-center py-10 text-slate-500 text-sm">
            No registers matched that criteria. Adjust searching input filters.
          </div>
        )}
      </div>
        </div>
      )}

    </div>
  );
}
