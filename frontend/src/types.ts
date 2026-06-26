export interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "client" | "interpreter";
  status: "active" | "suspended" | "pending";
  languages?: string[];
  rating?: number;
  completedSessions?: number;
  hourlyRate?: number;
  avatar?: string;
  contractId?: string;
  organizationName?: string;
  isInstitutionPrimary?: boolean;
  provisionedPassword?: string;
}

export interface ChatMessage {
  id: string;
  senderRole: "client" | "interpreter" | "system";
  senderName: string;
  text: string;
  translatedText?: string;
  timestamp: string;
}

export interface Session {
  id: string;
  clientId: string;
  clientName: string;
  interpreterId?: string;
  interpreterName?: string;
  languageFrom: string;
  languageTo: string;
  serviceType: "medical" | "legal" | "business" | "general";
  serviceMode: "AI" | "Human" | "Both";
  status: "pending" | "incoming" | "active" | "completed" | "cancelled" | "missed";
  scheduledTime?: string; // "instant" or ISO date string
  cost: number;
  durationSeconds: number;
  chatMessages: ChatMessage[];
  transcript: string[];
  summary?: string;
  ratingByClient?: number;
  reviewByClient?: string;
  emergencyTriggered?: boolean;
}

export interface Transaction {
  id: string;
  userId: string;
  userName: string;
  type: "deposit" | "payment" | "payout" | "refund";
  amount: number;
  status: "completed" | "pending" | "failed";
  timestamp: string;
  reference: string;
}

export interface Slot {
  start: string;
  end: string;
  recurring: boolean;
}

export interface InterpreterAvailability {
  userId: string;
  day: string;
  slots: Slot[];
}

export interface AuditLog {
  id: string;
  timestamp: string;
  action: string;
  userRole: string;
  userName: string;
  status: "info" | "success" | "warning" | "danger";
}

export interface ContractDetails {
  contractId: string;
  organizationName: string;
  signedDate: string;
  expiryDate: string;
  slaLevel: string;
  billingCode: string;
  maxConcurrentSessions: number;
  status: "active" | "expired";
}

