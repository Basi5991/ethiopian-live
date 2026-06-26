import React from "react";
import { PhoneCall, PhoneOff, Wifi, RefreshCw } from "lucide-react";
import { useWebRTCCall, WebRTCRole } from "../hooks/useWebRTCCall";

interface WebRTCCallPanelProps {
  sessionId: string;
  role: WebRTCRole;
  isCaller: boolean;
  enabled: boolean;
  initialStream?: MediaStream | null;
  status: "incoming" | "active" | "pending" | "completed" | "cancelled" | "missed";
  peerName: string;
  languageLabel?: string;
  localLabel: string;
  remoteLabel: string;
  onEndCall: () => void | Promise<void>;
  onPeerHangup?: (sessionId: string) => void;
}

export default function WebRTCCallPanel({
  sessionId,
  role,
  isCaller,
  enabled,
  initialStream = null,
  status,
  peerName,
  languageLabel,
  localLabel,
  remoteLabel,
  onEndCall,
  onPeerHangup,
}: WebRTCCallPanelProps) {
  const [isEnding, setIsEnding] = React.useState(false);
  const {
    localVideoRef,
    remoteVideoRef,
    connectionState,
    mediaError,
    localReady,
    remoteReady,
    endCall,
  } = useWebRTCCall({ sessionId, role, isCaller, enabled, initialStream, onPeerHangup });

  const handleEnd = async () => {
    if (isEnding) return;
    setIsEnding(true);
    try {
      await endCall();
      await onEndCall();
    } finally {
      setIsEnding(false);
    }
  };

  const isConnected =
    connectionState === "connected" ||
    connectionState === "connecting" ||
    remoteReady;
  const isRinging = status === "incoming" && isCaller;
  const isWaitingForPeer = !isCaller && status === "active" && !isConnected;

  return (
    <div className="bg-black rounded-2xl relative aspect-video overflow-hidden shadow-inner flex flex-col p-4">
      <div className="flex justify-between items-center z-10 w-full shrink-0">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-black/60 backdrop-blur rounded-xl text-[10px] text-white font-bold uppercase border border-white/5">
          {isConnected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
              Live WebRTC
            </>
          ) : (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              {isRinging ? "Calling…" : isWaitingForPeer ? "Joining channel…" : "Connecting…"}
            </>
          )}
        </span>
        {languageLabel && (
          <span className="text-[10px] text-slate-400 bg-black/50 px-2.5 py-1 rounded-xl border border-white/5 font-mono">
            {languageLabel}
          </span>
        )}
      </div>

      <div className="flex-1 grid grid-cols-2 gap-3 items-center py-3 min-h-0 relative">
        <div className="relative bg-zinc-900/80 rounded-xl aspect-[4/3] overflow-hidden border border-white/5 h-full max-h-full">
          <span className="absolute bottom-2 left-2 z-10 text-[9px] bg-black/60 px-2 py-0.5 rounded text-slate-300">
            {localLabel}
          </span>
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          {!localReady && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs bg-zinc-950/80">
              Starting camera…
            </div>
          )}
        </div>

        <div className="relative bg-zinc-900/80 rounded-xl aspect-[4/3] overflow-hidden border border-white/5 h-full max-h-full">
          <span className="absolute bottom-2 left-2 z-10 text-[9px] bg-black/60 px-2 py-0.5 rounded text-emerald-400">
            {remoteLabel}
          </span>
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
          {!remoteReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 text-xs gap-2 bg-black/50">
              <RefreshCw className="w-5 h-5 animate-spin opacity-60" />
              <span>{peerName}</span>
            </div>
          )}
        </div>

        {isRinging && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm text-center px-6">
            <div className="w-16 h-16 rounded-full bg-zinc-900 border-2 border-blue-500 flex items-center justify-center mb-3">
              <PhoneCall className="w-7 h-7 text-blue-500 animate-bounce" />
            </div>
            <h3 className="text-sm font-bold text-white">Calling {peerName}</h3>
            <p className="text-xs text-slate-400 mt-1">Waiting for interpreter to accept…</p>
          </div>
        )}
      </div>

      {mediaError && (
        <p className="text-[10px] text-amber-400 text-center z-10 px-2 shrink-0">{mediaError}</p>
      )}

      <div className="flex gap-2 justify-center z-10 w-full shrink-0 pt-1">
        <button
          type="button"
          disabled={isEnding}
          onClick={() => void handleEnd()}
          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold uppercase rounded-xl flex items-center gap-1.5"
        >
          <PhoneOff className="w-4 h-4" />
          {isEnding ? "Ending…" : isRinging ? "Cancel" : "End Call"}
        </button>
      </div>
    </div>
  );
}
