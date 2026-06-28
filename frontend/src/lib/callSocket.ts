import { Session } from "../types";

export type CallSocketRole = "client" | "interpreter" | "admin";

export type CallSocketMessage =
  | { type: "socket.ready"; userId: string; role: CallSocketRole }
  | { type: "call.created"; session: Session }
  | { type: "call.ringing"; session: Session }
  | { type: "call.accepted"; session: Session }
  | { type: "call.ended"; session: Session }
  | { type: "call.error"; error: string; status?: number; session?: Session }
  | {
      type: "webrtc.offer" | "webrtc.answer" | "webrtc.ice" | "webrtc.hangup";
      sessionId: string;
      senderRole: "client" | "interpreter";
      payload: RTCSessionDescriptionInit | RTCIceCandidateInit | Record<string, never>;
      signal?: {
        id: string;
        senderRole: "client" | "interpreter";
        signalType: "offer" | "answer" | "ice" | "hangup";
        payload: RTCSessionDescriptionInit | RTCIceCandidateInit | Record<string, never>;
        createdAt: string;
      };
    }
  | { type: "pong" };

type Listener = (message: CallSocketMessage) => void;

function resolveCallSocketUrl(userId: string, role: CallSocketRole): string {
  const explicitUrl = import.meta.env.VITE_CALL_WS_URL || import.meta.env.VITE_BACKEND_WS_URL;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = `userId=${encodeURIComponent(userId)}&role=${encodeURIComponent(role)}`;

  if (explicitUrl) {
    const base = String(explicitUrl)
      .replace(/^http:\/\//, "ws://")
      .replace(/^https:\/\//, "wss://")
      .replace("://localhost:8000", "://127.0.0.1:8000")
      .replace(/\/$/, "");
    return `${base}/ws/calls/?${params}`;
  }

  const host = window.location.hostname;
  const port = window.location.port;
  const isFrontendDevHost = (host === "localhost" || host === "127.0.0.1") && (port === "3000" || port === "5173");
  const socketHost = isFrontendDevHost ? "127.0.0.1:8000" : window.location.host;
  return `${protocol}//${socketHost}/ws/calls/?${params}`;
}

class CallSocketClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private sendQueue: unknown[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private manuallyClosed = false;

  constructor(private readonly userId: string, private readonly role: CallSocketRole) {}

  connect() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.manuallyClosed = false;

    this.socket = new WebSocket(resolveCallSocketUrl(this.userId, this.role));

    this.socket.onopen = () => {
      this.flushQueue();
      this.startHeartbeat();
    };

    this.socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as CallSocketMessage;
        this.listeners.forEach((listener) => listener(message));
      } catch (err) {
        console.warn("Ignoring malformed call socket message", err);
      }
    };

    this.socket.onclose = () => {
      this.stopHeartbeat();
      if (!this.manuallyClosed) this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      this.socket?.close();
    };
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    this.connect();
    // Do not replay recent call lifecycle events: stale call.ringing replays
    // were re-opening the accept popup after a call had already been accepted.
    return () => {
      this.listeners.delete(listener);
    };
  }

  send(type: string, payload: Record<string, unknown> = {}) {
    const message = { type, payload };
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      this.sendQueue.push(message);
      this.connect();
    }
  }

  close() {
    this.manuallyClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  private flushQueue() {
    const queued = [...this.sendQueue];
    this.sendQueue = [];
    queued.forEach((message) => this.socket?.send(JSON.stringify(message)));
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1000);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.send("ping"), 25000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

const sockets = new Map<string, CallSocketClient>();

export function getCallSocket(userId: string, role: CallSocketRole): CallSocketClient {
  const key = `${role}:${userId}`;
  let socket = sockets.get(key);
  if (!socket) {
    socket = new CallSocketClient(userId, role);
    sockets.set(key, socket);
  }
  return socket;
}

export function getCurrentUserIdForSocket(role: "client" | "interpreter"): string {
  try {
    const saved = localStorage.getItem("orzo_auth_user");
    const user = saved ? JSON.parse(saved) : null;
    if (user?.id) return user.id;
  } catch {
    /* fallback below */
  }
  return role === "client" ? "usr_client13" : "usr_int1";
}
