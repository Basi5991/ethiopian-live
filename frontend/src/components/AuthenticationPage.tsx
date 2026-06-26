import React, { useState } from "react";
import { Mail, Lock, AlertCircle, CheckCircle2 } from "lucide-react";
import { User } from "../types";

interface AuthenticationPageProps {
  users: User[];
  onLoginSuccess: (user: User, workspaceRole: User["role"]) => void;
  theme?: string;
  onThemeToggle?: () => void;
}

const EMAIL_EXAMPLE = "dawit@client.com";

const WORKSPACE_LABELS: Record<"client" | "interpreter" | "admin", string> = {
  client: "Client Workspace",
  interpreter: "Interpreter Desk",
  admin: "Governance Console",
};

const DEFAULT_DEMO_USERS: User[] = [
  { id: "usr_client13", name: "Dawit Yohannes", email: "dawit@client.com", role: "client", status: "active", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150" },
  { id: "usr_int1", name: "Bekele Megersa", email: "bekele@oromo-interpret.com", role: "interpreter", status: "active", languages: ["Afaan Oromo", "Amharic", "English"], rating: 4.9, completedSessions: 142, hourlyRate: 45, avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150" },
  { id: "usr_int4", name: "Selamawit Tadesse", email: "selam@amharic-interpret.com", role: "interpreter", status: "active", languages: ["Amharic", "English"], rating: 4.95, completedSessions: 310, hourlyRate: 50, avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150" },
  { id: "usr_admin1", name: "Almaz Kebede", email: "admin@elliot.live", role: "admin", status: "active", avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150" }
];

function PortalLogo() {
  return (
    <svg width="52" height="44" viewBox="0 0 52 44" fill="none" aria-hidden="true">
      <path
        d="M8 8C8 3.58 11.58 0 16 0H28C32.42 0 36 3.58 36 8V20C36 24.42 32.42 28 28 28H16C11.58 28 8 24.42 8 20V8Z"
        fill="#1D61E1"
      />
      <path
        d="M16 16C16 11.58 19.58 8 24 8H36C40.42 8 44 11.58 44 16V28C44 32.42 40.42 36 36 36H24C19.58 36 16 32.42 16 28V16Z"
        fill="#0B1F4D"
        fillOpacity="0.92"
      />
      <circle cx="20" cy="14" r="2.5" fill="white" />
      <circle cx="34" cy="30" r="2.5" fill="white" />
    </svg>
  );
}

function SkylineIllustration() {
  return (
    <svg
      className="portal-auth-skyline"
      viewBox="0 0 1440 220"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="skyFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#EAF2FF" stopOpacity="0" />
          <stop offset="100%" stopColor="#CFE0FF" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect width="1440" height="220" fill="url(#skyFade)" />
      <path
        d="M0 170 Q360 130 720 155 T1440 140 L1440 220 L0 220 Z"
        fill="#D9E8FF"
        opacity="0.7"
      />
      <path
        d="M0 185 Q420 150 840 175 T1440 165 L1440 220 L0 220 Z"
        fill="#C5DAFF"
        opacity="0.85"
      />
      <g fill="#B8CFF5" opacity="0.9">
        <rect x="180" y="95" width="18" height="85" rx="2" />
        <rect x="205" y="110" width="14" height="70" rx="2" />
        <rect x="225" y="118" width="12" height="62" rx="2" />
        <rect x="320" y="88" width="22" height="92" rx="3" />
        <rect x="350" y="102" width="16" height="78" rx="2" />
        <path d="M430 180 L445 55 L460 180 Z" />
        <rect x="520" y="105" width="28" height="75" rx="4" />
        <rect x="555" y="115" width="20" height="65" rx="3" />
        <ellipse cx="640" cy="145" rx="38" ry="28" />
        <rect x="615" y="145" width="50" height="35" rx="4" />
        <rect x="720" y="100" width="24" height="80" rx="3" />
        <rect x="750" y="112" width="18" height="68" rx="2" />
        <rect x="860" y="108" width="20" height="72" rx="2" />
        <rect x="890" y="118" width="16" height="62" rx="2" />
        <rect x="980" y="92" width="26" height="88" rx="3" />
        <rect x="1015" y="108" width="18" height="72" rx="2" />
        <rect x="1120" y="115" width="22" height="65" rx="2" />
        <rect x="1150" y="125" width="16" height="55" rx="2" />
      </g>
      <g fill="#94B8E8" opacity="0.55">
        <path d="M120 48 Q125 42 130 48 L128 54 Q124 56 120 54 Z" />
        <path d="M260 62 Q265 56 270 62 L268 68 Q264 70 260 68 Z" />
        <path d="M780 38 Q785 32 790 38 L788 44 Q784 46 780 44 Z" />
        <path d="M1040 52 Q1045 46 1050 52 L1048 58 Q1044 60 1040 58 Z" />
      </g>
    </svg>
  );
}

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
  } catch {
    /* ignore audio errors */
  }
};

export default function AuthenticationPage({ users, onLoginSuccess }: AuthenticationPageProps) {
  const [email, setEmail] = useState(EMAIL_EXAMPLE);
  const [password, setPassword] = useState("demo1234");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const activeUsersList = users?.length > 0 ? users : DEFAULT_DEMO_USERS;

  const authenticateUser = async (
    loginEmail: string
  ): Promise<{ user: User | null; error?: string }> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim(), password }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.user) return { user: data.user as User };
        if (data.error) return { user: null, error: data.error as string };
      }
    } catch {
      /* fall back below */
    }

    const emailLower = loginEmail.trim().toLowerCase();
    const mergedUsers = [
      ...activeUsersList,
      ...DEFAULT_DEMO_USERS.filter(
        (demo) => !activeUsersList.some((u) => u.email.toLowerCase() === demo.email.toLowerCase())
      ),
    ];
    const matchedUser = mergedUsers.find((u) => u.email.trim().toLowerCase() === emailLower);
    if (!matchedUser) return { user: null };
    if (matchedUser.status === "suspended") {
      return { user: null, error: "This account has been temporarily suspended." };
    }
    const passwordOk = !password || password === "demo1234" || password === "••••••••";
    if (!passwordOk) {
      return { user: null, error: "Invalid email or authorization pin." };
    }
    return { user: matchedUser };
  };

  const handleFormLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    setSuccessMsg("");

    if (!email.trim()) {
      setErrorMessage("Please supply a valid Ethiopian service desk email address.");
      playBeepTone(150, 300);
      return;
    }

    setIsLoading(true);
    const result = await authenticateUser(email.trim());

    if (result.user) {
      setSuccessMsg(`Welcome, ${result.user.name}! Opening ${WORKSPACE_LABELS[result.user.role]}...`);
      playBeepTone(880, 100);
      setTimeout(() => {
        onLoginSuccess(result.user!, result.user!.role);
        setIsLoading(false);
      }, 500);
      return;
    }

    setErrorMessage(result.error || "No account found for that email. Check your address and try again.");
    playBeepTone(150, 400);
    setIsLoading(false);
  };

  return (
    <div className="portal-auth-page min-h-screen relative flex flex-col items-center justify-center px-4 py-10 overflow-hidden">
      <div className="portal-auth-bg" />

      <div className="relative z-10 w-full max-w-[640px] flex flex-col items-center">
        <div className="flex items-center gap-3 mb-4">
          <PortalLogo />
          <h1 className="text-[2rem] leading-none font-bold tracking-[0.12em] text-[#0B1F4D] uppercase">
            Portal Access
          </h1>
        </div>

        <p className="text-center text-[#334155] text-[15px] leading-relaxed max-w-[560px] mb-8 px-2">
          Authenticating Ethiopia&apos;s leading language translation marketplace for clinical desks,
          courtroom chambers, and independent translators.
        </p>

        <div className="w-full max-w-[560px] flex items-center gap-4 mb-8">
          <div className="flex-1 h-px bg-[#CBD5E1]" />
          <div className="w-11 h-11 rounded-full bg-[#1D61E1] flex items-center justify-center shadow-md shadow-blue-500/20">
            <Lock className="w-5 h-5 text-white" strokeWidth={2.2} />
          </div>
          <div className="flex-1 h-px bg-[#CBD5E1]" />
        </div>

        <div
          id="orzo-login-card"
          className="w-full max-w-[560px] bg-white rounded-[28px] border border-[#E2E8F0] shadow-[0_20px_50px_rgba(15,23,42,0.08)] px-8 sm:px-10 py-9"
        >
          {errorMessage && (
            <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{errorMessage}</p>
            </div>
          )}

          {successMsg && (
            <div className="mb-5 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{successMsg}</p>
            </div>
          )}

          <form onSubmit={handleFormLogin} className="space-y-6">
            <div>
              <label className="block text-[15px] font-semibold text-[#0B1F4D] mb-3">
                Worksite Email Address
                <span className="font-normal text-[#64748B]"> — e.g. {EMAIL_EXAMPLE}</span>
              </label>
              <div className="flex items-stretch rounded-2xl border border-[#CBD5E1] overflow-hidden bg-white focus-within:border-[#1D61E1] focus-within:ring-2 focus-within:ring-[#1D61E1]/15 transition-all">
                <div className="w-14 shrink-0 flex items-center justify-center bg-[#EEF4FF] border-r border-[#CBD5E1]">
                  <Mail className="w-5 h-5 text-[#1D61E1]" strokeWidth={2} />
                </div>
                <input
                  type="email"
                  name="email"
                  autoComplete="off"
                  placeholder={EMAIL_EXAMPLE}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1 px-4 py-3.5 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] outline-none bg-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-[15px] font-semibold text-[#0B1F4D] mb-3">
                Authorization Pin Code
              </label>
              <div className="flex items-stretch rounded-2xl border border-[#CBD5E1] overflow-hidden bg-white focus-within:border-[#1D61E1] focus-within:ring-2 focus-within:ring-[#1D61E1]/15 transition-all">
                <div className="w-14 shrink-0 flex items-center justify-center bg-[#EEF4FF] border-r border-[#CBD5E1]">
                  <Lock className="w-5 h-5 text-[#1D61E1]" strokeWidth={2} />
                </div>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex-1 px-4 py-3.5 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] outline-none bg-transparent tracking-widest"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 rounded-2xl bg-[#1D61E1] hover:bg-[#1854C7] text-white text-[15px] font-bold flex items-center justify-center gap-2.5 shadow-lg shadow-blue-500/25 transition-all disabled:opacity-60 cursor-pointer"
            >
              {isLoading ? (
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Lock className="w-4 h-4" strokeWidth={2.2} />
                  Unlock Secured Client Workspace
                </>
              )}
            </button>
          </form>
        </div>
      </div>

      <div className="portal-auth-skyline-wrap pointer-events-none">
        <SkylineIllustration />
      </div>
    </div>
  );
}
