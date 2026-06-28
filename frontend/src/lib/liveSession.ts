import { Session } from "../types";

const SESSION_STATUS_RANK: Record<Session["status"], number> = {
  active: 0,
  incoming: 1,
  pending: 2,
  completed: 3,
  cancelled: 4,
  missed: 5,
};

/** Never downgrade an in-progress call (e.g. active → incoming from stale poller data). */
export function mergeLiveSession(prev: Session | null, next: Session | null): Session | null {
  if (!next) return prev;
  if (!prev || prev.id !== next.id) return next;

  const prevRank = SESSION_STATUS_RANK[prev.status] ?? 99;
  const nextRank = SESSION_STATUS_RANK[next.status] ?? 99;

  return {
    ...next,
    status:
      next.status === "active" || next.interpreterId
        ? "active"
        : prevRank <= nextRank
          ? prev.status
          : next.status,
    interpreterId: next.interpreterId || prev.interpreterId,
    interpreterName: next.interpreterName || prev.interpreterName,
    chatMessages: next.chatMessages?.length ? next.chatMessages : prev.chatMessages,
  };
}

export function isCallLive(session: Session | null | undefined): boolean {
  if (!session) return false;
  return session.status === "active" || Boolean(session.interpreterId);
}

/** Client should start WebRTC while ringing so the offer is ready when the interpreter accepts. */
export function shouldClientNegotiateWebRTC(session: Session | null | undefined): boolean {
  if (!session || session.serviceMode === "AI") return false;
  return session.status === "incoming" || isCallLive(session);
}

export function shouldInterpreterNegotiateWebRTC(session: Session | null | undefined): boolean {
  if (!session) return false;
  return isCallLive(session);
}

export function callPanelStatus(session: Session): Session["status"] {
  return isCallLive(session) ? "active" : session.status;
}
