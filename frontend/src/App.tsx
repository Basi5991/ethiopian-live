import React, { useState, useEffect } from "react";
import { 
  Shield, Users, Activity, LogOut, LayoutDashboard, Globe, 
  Wallet, HelpCircle, Bell, RefreshCw, Layers, CheckCircle2, UserCheck,
  Sun, Moon
} from "lucide-react";
import { User, Session, Transaction, AuditLog, InterpreterAvailability, ContractDetails } from "./types";
import { mergeUsersWithLocal, registerInterpreter } from "./lib/interpreterRegistration";
import AdminDashboard from "./components/AdminDashboard";
import ClientDashboard from "./components/ClientDashboard";
import InterpreterDashboard from "./components/InterpreterDashboard";
import AuthenticationPage from "./components/AuthenticationPage";

const playBeepTone = (frequency: number, durationMs: number) => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
    osc.type = "sine";
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  } catch (err) {
    console.warn("Audio Context init error:", err);
  }
};

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("orzo_theme");
    return saved === "dark" ? "dark" : "light";
  });
  const [authenticatedUser, setAuthenticatedUser] = useState<User | null>(() => {
    const saved = localStorage.getItem("orzo_auth_user");
    return saved ? JSON.parse(saved) : null;
  });
  const [activeRole, setActiveRole] = useState<"admin" | "client" | "interpreter">("client");
  const [users, setUsers] = useState<User[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [availabilities, setAvailabilities] = useState<InterpreterAvailability[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [contractDetails, setContractDetails] = useState<ContractDetails | null>(null);
  const [contractsList, setContractsList] = useState<ContractDetails[]>([]);
  const [activeContractId, setActiveContractId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [aiEngineStatus, setAiEngineStatus] = useState(false);

  // Sync activeRole with authenticated user's role
  useEffect(() => {
    if (authenticatedUser) {
      setActiveRole(authenticatedUser.role);
    }
  }, [authenticatedUser]);

  // Auto update poller
  const fetchState = async () => {
    try {
      const res = await fetch("/api/init");
      const contentType = res.headers.get("content-type");
      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setUsers(mergeUsersWithLocal(data.users || []));
        setSessions(data.sessions || []);
        setTransactions(data.transactions || []);
        setAvailabilities(data.availabilities || []);
        setAuditLogs(data.auditLogs || []);
        setWalletBalance(data.clientWalletBalance || 0);
        setContractDetails(data.contractDetails || null);
        setContractsList(data.contractsList || []);
        setActiveContractId(data.activeContractId || "");
        setAiEngineStatus(data.aiAvailable || false);
      } else {
        console.warn("Poller sync: server returned non-JSON response or is starting up.");
      }
    } catch (err: any) {
      const isJsonError = err instanceof SyntaxError || (err.message && err.message.includes("is not valid JSON"));
      const isNetworkError = err.message && (
        err.message.toLowerCase().includes("fetch") || 
        err.message.toLowerCase().includes("network") || 
        err.message.toLowerCase().includes("load failed") ||
        err.message.toLowerCase().includes("failed to fetch")
      );
      if (isJsonError || isNetworkError) {
        console.warn("Poller sync: temporary network/server connection issue:", err.message);
      } else {
        console.error("Poller syncing failed:", err);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleLoginSuccess = (user: User, workspaceRole: User["role"]) => {
    const role = user.role === workspaceRole ? workspaceRole : user.role;
    const sessionUser = { ...user, role };
    localStorage.setItem("orzo_auth_user", JSON.stringify(sessionUser));
    setAuthenticatedUser(sessionUser);
    setActiveRole(role);
  };

  const handleRegisterInterpreter = async (
    payload: Parameters<typeof registerInterpreter>[0]
  ) => registerInterpreter(payload, users);

  const handleLogout = () => {
    playBeepTone(440, 150);
    localStorage.removeItem("orzo_auth_user");
    setAuthenticatedUser(null);
  };

  // Guard view with full authenticity block
  if (!authenticatedUser) {
    return (
      <AuthenticationPage 
        users={users} 
        onLoginSuccess={handleLoginSuccess} 
        theme={theme}
        onThemeToggle={() => {
          const newTheme = theme === "light" ? "dark" : "light";
          setTheme(newTheme);
          localStorage.setItem("orzo_theme", newTheme);
        }}
      />
    );
  }

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-all duration-300 theme-${theme} ${
      theme === "light" ? "bg-[#F3F4F6] text-slate-800" : "bg-[#0A0A0C] text-slate-200"
    }`}>
      
      {/* Top Main Navigation Header */}
      <header className={`sticky top-0 z-40 h-16 flex items-center justify-between px-6 border-b transition-all duration-300 ${
        theme === "light" 
          ? "bg-white/85 backdrop-blur-xl border-slate-200/60 text-slate-850 shadow-sm" 
          : "bg-[#0F0F12]/80 backdrop-blur-xl border-white/5 text-slate-200"
      }`}>
        
        {/* Left: Branding */}
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-base shadow-md ${
            activeRole === "client" ? "bg-[#2563EB]" :
            activeRole === "interpreter" ? "bg-interpreter-primary" :
            "bg-admin-primary"
          }`}>
            E
          </div>
          <div>
            <span className={`font-extrabold text-sm tracking-widest block uppercase ${
              theme === "light" ? "text-slate-800" : "text-white"
            }`}>ELLIOT</span>
            <span className={`text-[9px] font-bold block uppercase tracking-widest ${
              theme === "light" ? "text-slate-500" : "text-zinc-500"
            }`}>LIVE INTERPRETATION MARKETPLACE</span>
          </div>
        </div>

        {/* Middle: Sealed Workspace Context indicator (non-client roles) */}
        {activeRole !== "client" && (
          <div className={`hidden md:flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all ${
            theme === "light"
              ? "bg-slate-100 border border-slate-200 text-slate-700 shadow-sm"
              : "bg-zinc-950/70 border border-white/5 shadow-inner"
          }`}>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className={theme === "light" ? "text-slate-500 uppercase tracking-wider text-[10px]" : "text-slate-400 uppercase tracking-wider text-[10px]"}>SECURED SESSION:</span>
            <span className={`uppercase font-black tracking-widest text-[10px] ${
              activeRole === "interpreter" ? "text-emerald-500 font-extrabold" :
              "text-rose-500 font-extrabold"
            }`}>
              {activeRole === "interpreter" ? "Interpreter Desk Only" : "Governance Console Only"}
            </span>
          </div>
        )}

        {/* Right: User Information and Toggle / Lockout Buttons */}
        <div className="flex items-center gap-4">
          
          {/* Theme Switcher Button */}
          <button
            onClick={() => {
              const newTheme = theme === "light" ? "dark" : "light";
              setTheme(newTheme);
              localStorage.setItem("orzo_theme", newTheme);
            }}
            className={`p-1.5 px-3 rounded-xl border text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-sm ${
              theme === "light"
                ? "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200/80"
                : "bg-zinc-900 border-white/5 hover:bg-zinc-800 text-slate-300"
            }`}
            title="Toggle theme style"
          >
            {theme === "light" ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-500" />
                <span>White Theme</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-zinc-400" />
                <span>Black Theme</span>
              </>
            )}
          </button>
          
          {activeRole !== "client" && (
            <div className={`hidden lg:flex items-center gap-2 pr-4 text-xs font-mono border-r ${
              theme === "light" ? "border-slate-200 text-slate-600" : "border-white/5 text-slate-400"
            }`}>
              <span className={`w-2 h-2 rounded-full ${aiEngineStatus ? "bg-cyan-500 animate-pulse" : "bg-zinc-500"}`} />
              <span className="text-[9px] uppercase tracking-wider font-extrabold">Addis Cloud Link</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            {activeRole !== "client" && (
              <div className={`hidden sm:flex items-center gap-2 py-1 px-2.5 rounded-xl text-xs border ${
                theme === "light" 
                  ? "bg-slate-50 border-slate-200/80 text-slate-800" 
                  : "bg-white/[0.02] border border-white/5 text-slate-200"
              }`}>
                <img 
                  src={authenticatedUser.avatar || "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150"} 
                  className="w-6.5 h-6.5 rounded-full object-cover" 
                  alt="" 
                  referrerPolicy="no-referrer"
                />
                <div className="text-left font-sans">
                  <span className={`block font-extrabold text-[11px] leading-tight truncate max-w-[130px] ${theme === "light" ? "text-slate-800" : "text-white"}`}>{authenticatedUser.name}</span>
                  <span className={`block text-[8px] leading-tight uppercase font-black tracking-wider font-mono ${theme === "light" ? "text-slate-400" : "text-zinc-500"}`}>{authenticatedUser.role}</span>
                </div>
              </div>
            )}
            
            <button 
              onClick={handleLogout}
              className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-505 text-rose-500 border border-rose-500/20 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-sm"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>

      </header>

      {/* Main Core Container */}
      <div className="flex-1 flex max-w-[1700px] w-full mx-auto">
        
        {/* Compact Sidebar Drawer (hidden on client workspace — matches portal mockup) */}
        <aside className={`${activeRole === "client" ? "hidden" : "hidden lg:flex"} flex-col w-64 p-6 space-y-7 shrink-0 transition-all duration-300 border-r ${
          theme === "light" ? "bg-slate-50/50 border-slate-200/60" : "bg-[#0F0F12]/30 border-white/5"
        }`}>
          
          {/* Identity lock notice panel */}
          <div className="space-y-3">
            <span className={`text-[10px] font-bold uppercase tracking-widest block pb-1 border-b font-mono ${
              theme === "light" ? "text-slate-500 border-slate-200/60" : "text-slate-500 border-white/5"
            }`}>
              Secure Enclave Account
            </span>
            <div className={`p-4 rounded-2xl space-y-3.5 text-center border transition-all ${
              theme === "light" 
                ? "bg-white border-slate-200/60 shadow-[0_4px_20px_rgba(0,0,0,0.02)]" 
                : "bg-[#16161A] border-white/5 shadow-xl"
            }`}>
              <img 
                src={authenticatedUser.avatar || "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150"} 
                alt={authenticatedUser.name}
                className="w-16 h-16 rounded-full mx-auto object-cover border-2 border-white/5"
                referrerPolicy="no-referrer"
              />
              <div>
                <h4 className={`text-xs font-extrabold uppercase ${theme === "light" ? "text-slate-900" : "text-white"}`}>{authenticatedUser.name}</h4>
                <p className={`text-[10px] truncate mt-0.5 font-mono ${theme === "light" ? "text-slate-500" : "text-zinc-500"}`}>{authenticatedUser.email}</p>
              </div>
              
              <div className={`pt-2 border-t ${theme === "light" ? "border-slate-100" : "border-white/5"}`}>
                <span className={`inline-block px-2.5 py-1 text-[8px] uppercase font-mono font-black tracking-widest rounded ${
                  authenticatedUser.role === "client" ? "bg-blue-500/10 text-blue-500 border border-blue-500/10" :
                  authenticatedUser.role === "interpreter" ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/10" :
                  "bg-rose-500/10 text-rose-500 border border-rose-500/10"
                }`}>
                  {authenticatedUser.role} GATE OPEN
                </span>
                {authenticatedUser.languages && (
                  <div className="mt-2.5 flex flex-wrap justify-center gap-1">
                    {authenticatedUser.languages.map(lang => (
                      <span key={lang} className={`text-[8px] font-mono px-1.5 py-0.5 border rounded ${
                        theme === "light" 
                          ? "bg-slate-100 border-slate-200 text-slate-650" 
                          : "bg-zinc-900 border-white/5 text-slate-400"
                      }`}>
                        {lang}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Quick Details widgets depending on authenticated profile */}
          <div className="space-y-4 pt-1.5">
            <div className={`p-4 rounded-2xl border space-y-2 transition-all ${
              theme === "light" 
                ? "bg-white border-slate-200/60 shadow-[0_4px_20px_rgba(0,0,0,0.02)]" 
                : "bg-[#16161A] border-white/5 shadow-xl"
            }`}>
              <span className={`text-[10px] font-bold uppercase tracking-widest block font-mono ${theme === "light" ? "text-slate-550" : "text-slate-500"}`}>System Stats</span>
              <div className={`space-y-1.5 text-[11px] font-mono ${theme === "light" ? "text-slate-600" : "text-slate-400"}`}>
                <p className="flex justify-between">
                  <span>Active channels</span> 
                  <span className={`font-bold ${theme === "light" ? "text-slate-900" : "text-white"}`}>{sessions.filter(s => s.status === "active").length}</span>
                </p>
                <p className="flex justify-between">
                  <span>Interpreters</span> 
                  <span className={`font-bold ${theme === "light" ? "text-slate-900" : "text-white"}`}>{users.filter(u => u.role === "interpreter" && u.status === "active").length}</span>
                </p>
                {authenticatedUser.role === "client" && contractDetails && (
                  <>
                    <p className="flex justify-between">
                      <span>Contract Code</span> 
                      <span className={`font-mono font-bold text-[10px] ${theme === "light" ? "text-slate-800" : "text-zinc-350"}`}>{contractDetails.billingCode}</span>
                    </p>
                    <p className="flex justify-between">
                      <span>SLA Cover</span> 
                      <span className="text-blue-500 font-bold text-[9px] uppercase tracking-wider">{contractDetails.slaLevel.split(" ")[0]} SLA</span>
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1" />

          {/* Locked feedback note */}
          <div className={`p-3.5 rounded-xl border text-[10px] leading-relaxed font-sans text-center transition-all ${
            theme === "light" 
              ? "border-slate-200/60 bg-slate-100 text-slate-500" 
              : "border-white/5 bg-black/10 text-zinc-500"
          }`}>
            Signed into secure terminal. Access is restricted under Elliot enterprise policy. Click "Sign Out" above to change profiles.
          </div>

        </aside>

        {/* Content canvas */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto w-full">
          {loading ? (
            <div className="h-[60vh] flex flex-col items-center justify-center gap-3">
              <div className={`w-10 h-10 border-2 rounded-full animate-spin ${theme === "light" ? "border-slate-300 border-t-slate-600" : "border-slate-500 border-t-white"}`} />
              <p className={`text-xs font-mono ${theme === "light" ? "text-slate-550" : "text-slate-400"}`}>Loading telemetry vectors...</p>
            </div>
          ) : (
            <div className="w-full">
              {activeRole === "client" && (
                <ClientDashboard 
                  users={users}
                  sessions={sessions}
                  transactions={transactions}
                  walletBalance={walletBalance}
                  contractDetails={contractDetails}
                  contractsList={contractsList}
                  activeContractId={activeContractId}
                  onActionComplete={fetchState}
                  theme={theme}
                />
              )}
              {activeRole === "interpreter" && (
                <InterpreterDashboard 
                  users={users}
                  sessions={sessions}
                  transactions={transactions}
                  availabilities={availabilities}
                  onActionComplete={fetchState}
                  theme={theme}
                />
              )}
              {activeRole === "admin" && (
                <AdminDashboard 
                  users={users}
                  sessions={sessions}
                  transactions={transactions}
                  auditLogs={auditLogs}
                  contractDetails={contractDetails}
                  contractsList={contractsList}
                  activeContractId={activeContractId}
                  onActionComplete={fetchState}
                  onRegisterInterpreter={handleRegisterInterpreter}
                  theme={theme}
                />
              )}
            </div>
          )}
        </main>

      </div>

    </div>
  );
}
