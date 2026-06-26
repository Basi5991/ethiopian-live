import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Google GenAI
const geminiApiKey = process.env.GEMINI_API_KEY || "";
let ai: GoogleGenAI | null = null;
if (geminiApiKey) {
  ai = new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// ============================================
// MOCK DATABASE & IN-MEMORY STATE SYSTEM
// ============================================

interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "client" | "interpreter";
  status: "active" | "suspended" | "pending";
  languages?: string[];
  languageProficiencies?: { language: string; level: string }[];
  rating?: number;
  completedSessions?: number;
  hourlyRate?: number;
  avatar?: string;
  contractId?: string;
  organizationName?: string;
  isInstitutionPrimary?: boolean;
  provisionedPassword?: string;
}

interface Session {
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
  scheduledTime?: string; // ISO string or "instant"
  cost: number;
  durationSeconds: number;
  chatMessages: ChatMessage[];
  transcript: string[];
  summary?: string;
  ratingByClient?: number;
  reviewByClient?: string;
  emergencyTriggered?: boolean;
}

interface ChatMessage {
  id: string;
  senderRole: "client" | "interpreter" | "system";
  senderName: string;
  text: string;
  translatedText?: string;
  timestamp: string;
}

interface Transaction {
  id: string;
  userId: string;
  userName: string;
  type: "deposit" | "payment" | "payout" | "refund";
  amount: number;
  status: "completed" | "pending" | "failed";
  timestamp: string;
  reference: string;
}

interface InterpreterAvailability {
  userId: string;
  day: string; // "Monday", etc.
  slots: { start: string; end: string; recurring: boolean }[];
}

interface AuditLog {
  id: string;
  timestamp: string;
  action: string;
  userRole: string;
  userName: string;
  status: "info" | "success" | "warning" | "danger";
}

interface ContractDetails {
  contractId: string;
  organizationName: string;
  signedDate: string;
  expiryDate: string;
  slaLevel: string;
  billingCode: string;
  maxConcurrentSessions: number;
  status: "active" | "expired";
}

function normalizeInterpreterLanguages(
  languages: Array<string | { language: string; level?: string }> | undefined
): string[] {
  if (!languages?.length) return [];
  return languages
    .map((item) => (typeof item === "string" ? item : item.language))
    .filter(Boolean);
}

function interpreterSupportsLanguagePair(
  user: User | undefined,
  languageFrom: string,
  languageTo: string
): boolean {
  if (!user || user.role !== "interpreter") return false;
  const languages = normalizeInterpreterLanguages(user.languages);
  return languages.includes(languageFrom) && languages.includes(languageTo);
}

// Initial Data Population
let users: User[] = [
  { id: "usr_admin1", name: "Almaz Kebede", email: "admin@elliot.live", role: "admin", status: "active", avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150", provisionedPassword: "demo1234" },
  {
    id: "usr_client13",
    name: "Dawit Yohannes",
    email: "dawit@client.com",
    role: "client",
    status: "active",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150",
    contractId: "ELLIOT-CON-MOH-2026",
    organizationName: "Ethiopian Ministry of Health",
    isInstitutionPrimary: true,
    provisionedPassword: "demo1234",
  },
  {
    id: "usr_int1",
    name: "Bekele Megersa",
    email: "bekele@oromo-interpret.com",
    role: "interpreter",
    status: "active",
    languages: ["Afaan Oromo", "Afar", "Amharic", "English"],
    languageProficiencies: [
      { language: "Afaan Oromo", level: "Native" },
      { language: "Afar", level: "Conversational" },
      { language: "Amharic", level: "Fluent" },
      { language: "English", level: "Professional" },
    ],
    rating: 4.9,
    completedSessions: 142,
    hourlyRate: 45,
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150",
    provisionedPassword: "demo1234",
  },
  {
    id: "usr_int2",
    name: "Haleema Bashir",
    email: "haleema@somali-interpret.com",
    role: "interpreter",
    status: "active",
    languages: ["Somali", "Amharic", "English"],
    languageProficiencies: [
      { language: "Somali", level: "Native" },
      { language: "Amharic", level: "Fluent" },
      { language: "English", level: "Conversational" },
    ],
    rating: 4.8,
    completedSessions: 94,
    hourlyRate: 40,
    avatar: "https://images.unsplash.com/photo-1607746882042-944635dfe10e?w=150",
    provisionedPassword: "demo1234",
  },
  {
    id: "usr_int3",
    name: "Yared Girmay",
    email: "yared@tigrinya-interpret.com",
    role: "interpreter",
    status: "active",
    languages: ["Tigrinya", "Amharic", "English"],
    languageProficiencies: [
      { language: "Tigrinya", level: "Native" },
      { language: "Amharic", level: "Native" },
      { language: "English", level: "Fluent" },
    ],
    rating: 4.7,
    completedSessions: 81,
    hourlyRate: 35,
    avatar: "https://images.unsplash.com/photo-1542909168-82c3e7fdca5c?w=150",
    provisionedPassword: "demo1234",
  },
  {
    id: "usr_int4",
    name: "Selamawit Tadesse",
    email: "selam@amharic-interpret.com",
    role: "interpreter",
    status: "active",
    languages: ["Amharic", "English"],
    languageProficiencies: [
      { language: "Amharic", level: "Native" },
      { language: "English", level: "Native" },
    ],
    rating: 4.95,
    completedSessions: 310,
    hourlyRate: 50,
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
    provisionedPassword: "demo1234",
  },
  {
    id: "usr_int5",
    name: "Fatuma Ali",
    email: "fatuma@somali-medical.et",
    role: "interpreter",
    status: "active",
    languages: ["Somali", "Amharic", "English"],
    languageProficiencies: [
      { language: "Somali", level: "Native" },
      { language: "Amharic", level: "Conversational" },
      { language: "English", level: "Basic" },
    ],
    rating: 4.6,
    completedSessions: 58,
    hourlyRate: 32,
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150",
    provisionedPassword: "demo1234",
  },
  {
    id: "usr_int6",
    name: "Lemma Hailu",
    email: "lemma@afar-interpret.et",
    role: "interpreter",
    status: "active",
    languages: ["Afar", "Amharic", "Afaan Oromo"],
    languageProficiencies: [
      { language: "Afar", level: "Native" },
      { language: "Amharic", level: "Conversational" },
      { language: "Afaan Oromo", level: "Basic" },
    ],
    rating: 4.5,
    completedSessions: 47,
    hourlyRate: 38,
    avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150",
    provisionedPassword: "demo1234",
  },
];

let sessions: Session[] = [
  {
    id: "sess_1024",
    clientId: "usr_client1",
    clientName: "Dawit Yohannes",
    interpreterId: "usr_int1",
    interpreterName: "Bekele Megersa",
    languageFrom: "Amharic",
    languageTo: "Afaan Oromo",
    serviceType: "medical",
    serviceMode: "Both",
    status: "completed",
    scheduledTime: "2026-06-12T10:00:00Z",
    cost: 22.5,
    durationSeconds: 1800,
    chatMessages: [
      { id: "msg_1", senderRole: "system", senderName: "System", text: "Session started. High quality audio ready.", timestamp: "2026-06-12T10:00:00Z" },
      { id: "msg_2", senderRole: "client", senderName: "Dawit Yohannes", text: "We need translations for clinical symptom reviews.", timestamp: "2026-06-12T10:02:10Z" },
      { id: "msg_3", senderRole: "interpreter", senderName: "Bekele Megersa", text: "Ready to assist the patient in Amharic and Afaan Oromo.", timestamp: "2026-06-12T10:03:00Z" }
    ],
    transcript: [
      "Patient: ራስ ምታቴ በጣም ከባድ ነው። (My headache is very severe.)",
      "Interpreter: Mata-bowbiin koo baay'ee cimaadha.",
      "Doctor: How long has the patient had this fever?",
      "Interpreter: Dhukkubsataan kun hoo'ina qaamaa kana hammam gubbaa qaba?",
      "Patient: ከሶስት ቀን ጀምሮ ትኩሳት ነበረኝ።",
      "Interpreter: Fedhiin sun guyyoota sadii dura eegale."
    ],
    summary: "Medical consultation translation regarding severe headache and high body temperature persisting for 3 days. Assisted in medical triage from Amharic to Afaan Oromo with 4.9 rating precision.",
    ratingByClient: 5,
    reviewByClient: "Amazing communication! Saved us during the consultation."
  }
];

let transactions: Transaction[] = [
  { id: "tx_ch99221", userId: "usr_client13", userName: "Dawit Yohannes", type: "deposit", amount: 1500, status: "completed", timestamp: "2026-06-13T10:15:00Z", reference: "CHP-MOCK-99221" },
  { id: "tx_ch99222", userId: "usr_client13", userName: "Dawit Yohannes", type: "payment", amount: 45, status: "completed", timestamp: "2026-06-13T12:00:00Z", reference: "SESS-1024-PAY" },
  { id: "tx_ch99223", userId: "usr_int1", userName: "Bekele Megersa", type: "payout", amount: 38.25, status: "completed", timestamp: "2026-06-13T14:30:00Z", reference: "PAYOUT-INT1-930" }
];

let availabilities: InterpreterAvailability[] = [
  {
    userId: "usr_int1",
    day: "Monday",
    slots: [
      { start: "08:00", end: "12:00", recurring: true },
      { start: "14:00", end: "18:00", recurring: true }
    ]
  },
  {
    userId: "usr_int1",
    day: "Wednesday",
    slots: [{ start: "09:00", end: "17:00", recurring: true }]
  },
  {
    userId: "usr_int2",
    day: "Tuesday",
    slots: [{ start: "10:00", end: "16:00", recurring: false }]
  }
];

let auditLogs: AuditLog[] = [
  { id: "log_1", timestamp: new Date(Date.now() - 3600000).toISOString(), action: "Admin System Booted", userRole: "admin", userName: "Almaz Kebede", status: "info" },
  { id: "log_2", timestamp: new Date(Date.now() - 1800000).toISOString(), action: "Client Balance Top-up (1500 ETB)", userRole: "client", userName: "Dawit Yohannes", status: "success" },
  { id: "log_3", timestamp: new Date(Date.now() - 600000).toISOString(), action: "Interpreter Selamawit Tadesse went Online", userRole: "interpreter", userName: "Selamawit Tadesse", status: "info" }
];

// Active client parameters
let clientWalletBalance = 2450.0; // Simulated wallet balance in ETB

let contractsList: ContractDetails[] = [
  {
    contractId: "ELLIOT-CON-MOH-2026",
    organizationName: "Ethiopian Ministry of Health",
    signedDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    expiryDate: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(), // Expires in 12 days (Countdowns live!)
    slaLevel: "Tier-1 Healthcare Gold SLA",
    billingCode: "EMH-ADDIS-8898",
    maxConcurrentSessions: 5,
    status: "active"
  },
  {
    contractId: "ELLIOT-CON-CBE-2026",
    organizationName: "Commercial Bank of Ethiopia",
    signedDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    expiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(), // Expires in 6 months
    slaLevel: "Financial Core Tier-1 Gold",
    billingCode: "CBE-DISPATCH-9922",
    maxConcurrentSessions: 8,
    status: "active"
  },
  {
    contractId: "ELLIOT-CON-AAU-2026",
    organizationName: "Addis Ababa University",
    signedDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // Expires in 3 months
    slaLevel: "Academic Silver SLA",
    billingCode: "AAU-LANG-OFFICE",
    maxConcurrentSessions: 3,
    status: "active"
  }
];

let activeContractId = "ELLIOT-CON-MOH-2026";

function checkAndGetContract(): ContractDetails {
  let contract = contractsList.find(c => c.contractId === activeContractId);
  if (!contract && contractsList.length > 0) {
    contract = contractsList[0];
    activeContractId = contract.contractId;
  }
  if (contract) {
    const expired = new Date(contract.expiryDate).getTime() < Date.now();
    contract.status = expired ? "expired" : "active";
    return contract;
  }
  return {
    contractId: "ELLIOT-FALLBACK",
    organizationName: "Emergency Guest Access",
    signedDate: new Date().toISOString(),
    expiryDate: new Date(Date.now() + 3600000).toISOString(),
    slaLevel: "Guest Trial",
    billingCode: "GUEST-TRIAL",
    maxConcurrentSessions: 1,
    status: "active"
  };
}

function getUserById(userId: string | undefined): User | undefined {
  return userId ? users.find((u) => u.id === userId) : undefined;
}

function isInstitutionalClient(user: User | undefined): boolean {
  return Boolean(user?.role === "client" && user.contractId);
}

function refreshContractStatus(contract: ContractDetails): ContractDetails {
  const expired = new Date(contract.expiryDate).getTime() < Date.now();
  contract.status = expired ? "expired" : "active";
  return contract;
}

function getContractForClient(client: User | undefined): ContractDetails {
  if (client?.contractId) {
    const contract = contractsList.find((c) => c.contractId === client.contractId);
    if (contract) {
      return refreshContractStatus(contract);
    }
  }
  return checkAndGetContract();
}

function resolveClientProfile(clientId: string | undefined): { client: User | undefined; error?: string } {
  if (clientId) {
    const client = getUserById(clientId);
    if (!client) {
      return { client: undefined, error: "Client account not found." };
    }
    if (client.role !== "client") {
      return { client: undefined, error: "Invalid client account." };
    }
    if (client.status !== "active") {
      return { client: undefined, error: "This client account is not active." };
    }
    if (client.contractId) {
      const contract = getContractForClient(client);
      if (contract.status === "expired") {
        return {
          client: undefined,
          error: "Access Denied: Your corporate SLA Contract duration has expired.",
        };
      }
    }
    return { client };
  }

  const fallback = users.find((u) => u.role === "client" && u.status === "active");
  if (!fallback) {
    return { client: undefined, error: "No client profile configured." };
  }
  return { client: fallback };
}

// Helper to push audit logs
function logAction(action: string, userRole: string, userName: string, status: "info" | "success" | "warning" | "danger" = "info") {
  auditLogs.unshift({
    id: `log_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    action,
    userRole,
    userName,
    status
  });
}

// ============================================
// GEMINI API UTILITIES & ENDPOINTS
// ============================================

// Translation service using server-side Gemini
app.post("/api/gemini/translate", async (req, res) => {
  const { text, fromLang, toLang } = req.body;
  
  if (!text || !fromLang || !toLang) {
    return res.status(400).json({ error: "Missing required translate parameters." });
  }

  // Handle case where Gemini API is not configured with standard fallback
  if (!ai) {
    console.log("Gemini API key not found. Providing realistic simulated local translation.");
    const mockTranslations: Record<string, string> = {
      "how are you?": "እንዴት ነህ? (Amharic) / Akkam jirta? (Oromo)",
      "thank you": "አመሰግናለሁ (Amharic) / Galatoomi (Oromo)",
      "severe headache": "ከባድ ራስ ምታት (Amharic) / Mata-bowbii cimaa (Oromo)",
      "where does it hurt?": "የት ነው የሚሰማህ? (Amharic) / Eessa si dhukkuba? (Oromo)",
      "legal representation": "ህጋዊ ውክልና (Amharic) / Bakka bu'iinsa seeraa (Oromo)",
    };
    
    const key = text.toLowerCase().trim();
    const fallback = `[Mock Translate: "${text}" from ${fromLang} to ${toLang}]`;
    return res.json({ translatedText: mockTranslations[key] || fallback });
  }

  try {
    const prompt = `Translate the following text strictly from ${fromLang} to ${toLang}. Output only the translated text, with no preamble, explanations, or quotes. Keep cultural idioms relevant to Ethiopia if appropriate.
Text: "${text}"`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        temperature: 0.2,
      }
    });

    const translatedText = response.text?.trim() || `[Translation error: No content output]`;
    res.json({ translatedText });
  } catch (error: any) {
    console.error("Gemini Translation Error:", error);
    res.status(500).json({ error: "Translation failed: " + error.message, fallback: `[Simulated: ${text} to ${toLang}]` });
  }
});

// ORZO AI Advanced Ethiopian Language Translation & Dialect analysis endpoint
app.post("/api/orzo/translate", async (req, res) => {
  const { text, fromLang, toLang } = req.body;

  if (!text || !fromLang || !toLang) {
    return res.status(400).json({ error: "Missing required parameters." });
  }

  if (!ai) {
    // Elegant fallbacks for local mock preview state
    const simulatedAnswers: Record<string, any> = {
      Amharic_English: {
        translatedText: "How are you doing today? Is everything okay with you?",
        dialect: "Shewa (Addis Ababa) Urban Accent",
        confidence: 98.4,
        insights: "Uses polite third-person plural greeting structures typical in Central Ethiopian highlands.",
        phoneticGuide: "Indet neh / Indet nesh (m/f)"
      },
      English_Amharic: {
        translatedText: "ከባድ ራስ ምታት አለብኝ፤ እባክዎ ይርዱኝ።",
        dialect: "Standard Literary Amharic",
        confidence: 96.5,
        insights: "Proper grammatical conjugation for urgent medical request.",
        phoneticGuide: "Kebad ras-mitat alebign; ibakwo yirdun"
      },
      Oromo_English: {
        translatedText: "I have been suffering from a severe headache for three days.",
        dialect: "Bale & Hararghe Regional Afaan Oromo Dialect",
        confidence: 97.2,
        insights: "Vocabulary 'mata-bowbii' accurately refers to deep cranial tension syndromes.",
        phoneticGuide: "Mata-bowbii koo guyyaa sadiif na rakkise"
      }
    };

    const key = `${fromLang}_${toLang}`;
    const keyAlt = `${toLang}_${fromLang}`;
    const result = simulatedAnswers[key] || simulatedAnswers[keyAlt] || {
      translatedText: `[ORZO AI translation of "${text}" from ${fromLang} to ${toLang}]`,
      dialect: "Ethiopian Regional Dialect (Standard)",
      confidence: 95.0,
      insights: "Excellent fluency in regional linguistic structures.",
      phoneticGuide: "Pronunciation guidance simulated based on phonetic dictionaries."
    };

    return res.json(result);
  }

  try {
    const prompt = `You are ORZO AI, a high-fidelity Advanced Ethiopian Language Translation Engine.
Analyze and translate this text from ${fromLang} to ${toLang}:
"${text}"

Return a JSON with the following structure:
{
  "translatedText": "highly professional translated text",
  "dialect": "Estimated regional dialect or accent of the source text, e.g. Shewa Amharic, Hararghe Oromo, Mekelle Tigrinya, Hargeise Somali, Benishangul-Gumuz",
  "confidence": 98.2,
  "insights": "Linguistic analysis, dialect breakdown, cultural nuances, or specialized medical/legal/general term highlights",
  "phoneticGuide": "Readable pronunciation phonetic guide for the text in the source language"
}
Output only the raw JSON code, with no wrapper markdown tags. Use valid JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        temperature: 0.3,
        responseMimeType: "application/json"
      }
    });

    const parsed = JSON.parse(response.text?.trim() || "{}");
    res.json(parsed);
  } catch (error: any) {
    console.error("ORZO AI Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Speech Captioning & Transcription Generator
app.post("/api/gemini/speech-caption", async (req, res) => {
  const { audioSampleType, targetLanguage } = req.body; // e.g., "doctor", "court", "business"

  if (!ai) {
    // Return stunning realistic local Ethiopian dialogues
    const mockCaptions: Record<string, string[]> = {
      medical: [
        "Patient: ካለፈው ሳምንት ጀምሮ ትንፋሽ ያጥረኛል፣ ሳልም አለብኝ።",
        "AI Interpreter (Oromo): Torban darbe irraa kaasee hafura na cirraha, qufaas qaba.",
        "Doctor: This strongly suggests standard respiratory infection. Let me check your lungs.",
        "AI Interpreter (Amharic): ይህ በከፍተኛ ሁኔታ የአየር መንገድ ኢንፌክሽንን ያሳያል። ሳንባዎን ልመርምር።",
        "Patient: መድሃኒቶች አሉኝ፣ ግን ምንም አልረዱኝም።",
        "AI Interpreter (English): I have medications, but they didn't help at all."
      ],
      legal: [
        "Judge: ክሱ የቀረበው በዋስትና መብት ጥሰት ላይ ነው።",
        "AI Interpreter (Oromo): Himanni kun kan dhiyaate mirga qabeenya eebbamuu irratti.",
        "Attorney: We urge the court to release my client on a standard 10,000 Birr bail.",
        "AI Interpreter (Amharic): ፍርድ ቤቱ ደንበኛዬን በ10,000 ብር መደበኛ ዋስትና እንዲፈታው እንጠይቃለን።",
        "Defendant: ህጉን አላፈረስኩም፣ ንፁህ ነኝ።",
        "AI Interpreter (English): I did not break the law, I am innocent."
      ],
      general: [
        "Client: ወደ ሸገር የምሄደው በየትኛው አውቶብስ ነው?",
        "AI Interpreter (Oromo): Babur kamtu gara Shegarii deema?",
        "Local Advisor: Take the fast city express from Meskel Square directly.",
        "AI Interpreter (Amharic): ከመስቀል አደባባይ ፈጣኑን የከተማ ኤክስፕረስ በቀጥታ ይውሰዱ።"
      ]
    };
    const dataset = mockCaptions[audioSampleType as keyof typeof mockCaptions] || mockCaptions.general;
    return res.json({ captions: dataset });
  }

  try {
    const prompt = `Generate a realistic transcripts conversation logs of an active live interpretation session in Ethiopia. The context is ${audioSampleType}. It should feature dialogue snippets between a Client speaking Amharic or Afaan Oromo, an English Speaking Professional, and the translated outputs. Format it as an array of dialogue strings, strictly in JSON format. Generate 6 turns of dialogue. Output only a valid JSON array of strings.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    try {
      const data = JSON.parse(response.text?.trim() || "[]");
      res.json({ captions: data });
    } catch {
      res.json({ captions: [response.text?.trim() || "Failed to generate format"] });
    }
  } catch (error: any) {
    console.error("Gemini Speech Caption Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Summarize and analyze session quality (Sentiment Analysis)
app.post("/api/gemini/session-summary", async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || transcript.length === 0) {
    return res.status(400).json({ error: "No transcript provided to analyze." });
  }

  if (!ai) {
    return res.json({
      summary: "This session successfully addressed clinical medical issues. The AI/Human interpreter provided accurate definitions for symptoms. General sentiment of customer is friendly and optimistic. Total time spent 12 minutes.",
      sentiment: "Highly Positive",
      insights: "Excellent fluency in medical Amharic syntax. The speaker appreciated prompt transition times."
    });
  }

  try {
    const prompt = `Analyze this live interpretation conversation transcript:
"${transcript.join("\n")}"

Return a JSON with the following structure:
{
  "summary": "Short 2 sentence description",
  "sentiment": "Positive / Neutral / Negative",
  "insights": "Critique or key takeaways of the translation accuracy (Ethiopian languages accuracy)"
}
Output only the JSON code.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const body = JSON.parse(response.text?.trim() || "{}");
    res.json(body);
  } catch (error: any) {
    console.error("Gemini summary error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Smart Machine Learning Interpreter Matching Algorithm
app.post("/api/gemini/smart-match", async (req, res) => {
  const { clientLang, serviceType, urgency } = req.body;

  if (!ai) {
    // Select the best live interpreter from local data
    const matched = users.filter((u) => u.role === "interpreter" && normalizeInterpreterLanguages(u.languages).includes(clientLang));
    const selected = matched[0] || users[2];
    return res.json({
      recommendedInterpreterId: selected.id,
      reasoning: `Matches exact language profile '${clientLang}' for context: '${serviceType}'. Selected with 98% prediction rate based on rating ${selected.rating} and ${selected.completedSessions} completed sessions.`
    });
  }

  try {
    const list = users.filter(u => u.role === "interpreter");
    const prompt = `Given a client needing:
- Target Language Pair: ${clientLang} <-> English
- Service Type requirement: ${serviceType}
- Urgency: ${urgency}

And this list of available interpreters in Ethiopia:
${JSON.stringify(list)}

Determine the absolute best interpreter using an allocation score algorithm. Return a standard JSON:
{
  "recommendedInterpreterId": "selected user ID from list",
  "reasoning": "Clear professional reasoning for why they match the ${serviceType} request."
}
Output only raw JSON code.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const result = JSON.parse(response.text?.trim() || "{}");
    res.json(result);
  } catch (error: any) {
    console.error("Gemini smart match error:", error);
    res.status(500).json({ error: error.message });
  }
});


// ============================================
// REST API FOR READ/WRITE DASHBOARD DATA
// ============================================

// Get initial catalog details
app.get("/api/init", (req, res) => {
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
  const { client } = resolveClientProfile(clientId);
  const contractDetails = client ? getContractForClient(client) : checkAndGetContract();

  res.json({
    users,
    sessions,
    transactions,
    availabilities,
    auditLogs,
    clientWalletBalance,
    contractDetails,
    contractsList: contractsList.map((c) => refreshContractStatus({ ...c })),
    activeContractId,
    aiAvailable: !!ai
  });
});

const DEMO_PASSWORDS = new Set(["demo1234", "••••••••", "********"]);

app.post("/api/auth/login", (req, res) => {
  const email = (req.body.email || "").trim();
  const password = req.body.password || "";

  if (!email) {
    return res.status(400).json({ error: "Please supply a valid email address." });
  }

  const user = users.find((u) => u.email.trim().toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({
      error: "No account found for that email. Check your address and try again.",
    });
  }

  if (user.status === "suspended") {
    return res.status(403).json({ error: "This account has been temporarily suspended." });
  }

  const passwordOk = !password || DEMO_PASSWORDS.has(password);
  if (!passwordOk) {
    return res.status(401).json({ error: "Invalid email or authorization pin." });
  }

  logAction(
    `User ${user.name} authenticated via email login`,
    user.role,
    user.name,
    "success"
  );

  res.json({ success: true, user });
});

function handleInterpreterCreate(req: import("express").Request, res: import("express").Response) {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim();
  const password = req.body.password || "demo1234";
  const languages = req.body.languages || [];
  const hourlyRate = Number(req.body.hourlyRate) || 40;
  const avatar = (req.body.avatar || "").trim();
  const accountStatus = req.body.status || "active";
  const adminName = (req.body.adminName || "Administrator").trim();

  if (!name) {
    return res.status(400).json({ error: "Interpreter name is required." });
  }
  if (!email) {
    return res.status(400).json({ error: "Email address is required." });
  }
  if (!Array.isArray(languages) || languages.length === 0) {
    return res.status(400).json({ error: "Select at least one accredited language." });
  }
  if (users.some((u) => u.email.trim().toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const newUser: User = {
    id: `usr_int_${Math.floor(1000 + Math.random() * 9000)}`,
    name,
    email,
    role: "interpreter",
    status: accountStatus === "suspended" || accountStatus === "pending" ? accountStatus : "active",
    languages: languages.filter((lang: unknown) => typeof lang === "string" && lang.trim()),
    rating: 5,
    completedSessions: 0,
    hourlyRate,
    avatar: avatar || undefined,
    provisionedPassword: password,
  };

  users.push(newUser);
  logAction(
    `New interpreter registered: ${newUser.name} (${newUser.languages?.join(", ")})`,
    "admin",
    adminName,
    "success"
  );

  res.status(201).json({
    success: true,
    user: newUser,
    temporaryPassword: password === "demo1234" ? "demo1234" : null,
  });
}

app.post("/api/users/interpreters/create", handleInterpreterCreate);
app.post("/api/admin/register-interpreter", handleInterpreterCreate);

function handleClientCreate(req: import("express").Request, res: import("express").Response) {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim();
  const password = req.body.password || "demo1234";
  const contractId = (req.body.contractId || "").trim();
  const isPrimary = Boolean(req.body.isInstitutionPrimary);
  const accountStatus = req.body.status || "active";
  const adminName = (req.body.adminName || "Administrator").trim();

  if (!name) {
    return res.status(400).json({ error: "Client name is required." });
  }
  if (!email) {
    return res.status(400).json({ error: "Email address is required." });
  }
  if (!contractId) {
    return res.status(400).json({ error: "Institution contract is required." });
  }

  const contract = contractsList.find((c) => c.contractId === contractId);
  if (!contract) {
    return res.status(404).json({ error: "Institution contract not found." });
  }
  refreshContractStatus(contract);
  if (contract.status === "expired") {
    return res.status(400).json({ error: "Cannot create client for an expired institution contract." });
  }

  if (isPrimary && users.some(
    (u) => u.role === "client" && u.contractId === contractId && u.isInstitutionPrimary
  )) {
    return res.status(409).json({ error: "A primary org account already exists for this institution." });
  }

  if (users.some((u) => u.email.trim().toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const newUser: User = {
    id: `usr_client_${Math.floor(1000 + Math.random() * 9000)}`,
    name,
    email,
    role: "client",
    status: accountStatus === "suspended" || accountStatus === "pending" ? accountStatus : "active",
    contractId,
    organizationName: contract.organizationName,
    isInstitutionPrimary: isPrimary,
    provisionedPassword: password,
  };

  users.push(newUser);
  const accountLabel = isPrimary ? "primary org" : "staff";
  logAction(
    `New institution ${accountLabel} client registered: ${newUser.name} (${contract.organizationName})`,
    "admin",
    adminName,
    "success"
  );

  res.status(201).json({
    success: true,
    user: newUser,
    temporaryPassword: password === "demo1234" ? "demo1234" : null,
  });
}

app.post("/api/users/clients/create", handleClientCreate);

app.get("/api/institutions/:contractId/clients", (req, res) => {
  const contract = contractsList.find((c) => c.contractId === req.params.contractId);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found" });
  }
  const clients = users.filter((u) => u.role === "client" && u.contractId === contract.contractId);
  res.json({ clients });
});

// Update client wallet balance
app.post("/api/wallet/deposit", (req, res) => {
  const { amount, clientId } = req.body;
  const { client, error } = resolveClientProfile(clientId);
  if (error) {
    return res.status(400).json({ error });
  }
  if (isInstitutionalClient(client)) {
    return res.status(400).json({
      error: "Institutional accounts use offline billing. Wallet top-up is not available.",
    });
  }

  const parsed = Number(amount);
  if (isNaN(parsed) || parsed <= 0) {
    return res.status(400).json({ error: "Invalid deposit amount" });
  }

  clientWalletBalance += parsed;
  const reference = `CHP-${Math.floor(100000 + Math.random() * 900000)}`;
  
  const txn: Transaction = {
    id: `tx_dep_${Math.random().toString(36).substr(2, 9)}`,
    userId: client?.id || "usr_client13",
    userName: client?.name || "Client",
    type: "deposit",
    amount: parsed,
    status: "completed",
    timestamp: new Date().toISOString(),
    reference
  };
  transactions.unshift(txn);
  
  logAction(`Wallet deposit completed successfully via Chapa. Amount: ${parsed} ETB`, "client", client?.name || "Client", "success");
  
  res.json({ balance: clientWalletBalance, transaction: txn });
});

// Post a withdrawal request (Interpreter)
app.post("/api/wallet/payout", (req, res) => {
  const { userId, amount, bankAccount, bankName } = req.body;
  const parsed = Number(amount);
  
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const txn: Transaction = {
    id: `tx_${Math.random().toString(36).substr(2, 9)}`,
    userId,
    userName: user.name,
    type: "payout",
    amount: parsed,
    status: "pending",
    timestamp: new Date().toISOString(),
    reference: `PAY-${Math.floor(100000 + Math.random() * 900000)}`
  };
  transactions.unshift(txn);

  logAction(`payout request of ${parsed} ETB created for ${user.name}`, "interpreter", user.name, "warning");
  res.json({ success: true, transaction: txn });
});

// Update/Extend corporate contract details supporting multi-contract structures
app.post("/api/contract/extend", (req, res) => {
  const { contractId, days, billingCode, organizationName, slaLevel } = req.body;
  const targetId = contractId || activeContractId;
  const contract = contractsList.find(c => c.contractId === targetId);
  
  if (!contract) {
    return res.status(404).json({ error: "SLA Contract not found" });
  }

  if (days !== undefined) {
    const parsedDays = Number(days);
    if (!isNaN(parsedDays) && parsedDays !== 0) {
      // Allow positive values for extensions, or negative to test expiration!
      const currentExpiry = new Date(contract.expiryDate);
      currentExpiry.setDate(currentExpiry.getDate() + parsedDays);
      contract.expiryDate = currentExpiry.toISOString();
    }
  }

  if (billingCode) {
    contract.billingCode = billingCode;
  }
  if (organizationName) {
    contract.organizationName = organizationName;
  }
  if (slaLevel) {
    contract.slaLevel = slaLevel;
  }

  // Auto-validate status based on expiration
  const expired = new Date(contract.expiryDate).getTime() < Date.now();
  contract.status = expired ? "expired" : "active";

  logAction(`Corporate SLA Contract for ${contract.organizationName} updated/renewed. Status: ${contract.status.toUpperCase()}`, "admin", "Almaz Kebede", "success");

  res.json({ success: true, contractDetails: contract, contractsList });
});

// Create new corporate SLA contract with a monthly, quarterly, half-year or yearly term
app.post("/api/contract/create", (req, res) => {
  const { organizationName, slaLevel, duration, maxConcurrentSessions, billingCode } = req.body;
  if (!organizationName) {
    return res.status(400).json({ error: "Organization Name is required" });
  }

  let days = 30;
  if (duration === "monthly") days = 30;
  else if (duration === "quarterly") days = 90;
  else if (duration === "half-year") days = 180;
  else if (duration === "yearly") days = 365;

  const codeSafe = organizationName.trim().replace(/[^a-zA-Z0-9]/g, "-").slice(0, 8).toUpperCase();
  const generatedId = `ELLIOT-CON-${codeSafe}-${Math.floor(1000 + Math.random() * 9000)}`;

  const newContract: ContractDetails = {
    contractId: generatedId,
    organizationName: organizationName.trim(),
    signedDate: new Date().toISOString(),
    expiryDate: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
    slaLevel: slaLevel || "Tier-1 Gold SLA",
    billingCode: billingCode || `${codeSafe}-${Math.floor(100 + Math.random() * 900)}`,
    maxConcurrentSessions: Number(maxConcurrentSessions) || 5,
    status: "active"
  };

  contractsList.push(newContract);
  activeContractId = generatedId; // Auto-activate the newly created institution contract

  logAction(`New SLA Contract created for ${newContract.organizationName} with duration ${duration}`, "admin", "Almaz Kebede", "success");

  res.json({ success: true, contractDetails: newContract, contractsList, activeContractId });
});

// Select current active corporate account context
app.post("/api/contract/select", (req, res) => {
  const { contractId } = req.body;
  if (!contractId) {
    return res.status(400).json({ error: "contractId is required" });
  }

  const contract = contractsList.find(c => c.contractId === contractId);
  if (!contract) {
    return res.status(404).json({ error: "SLA Contract not found" });
  }

  activeContractId = contractId;
  const expired = new Date(contract.expiryDate).getTime() < Date.now();
  contract.status = expired ? "expired" : "active";

  logAction(`Active corporate account context switched to ${contract.organizationName}`, "client", "Dawit Yohannes", "info");

  res.json({ success: true, contractDetails: contract, contractsList, activeContractId });
});

// Join, Accept, Intervene, Cancel sessions
app.get("/api/sessions", (req, res) => {
  res.json(sessions);
});

// Post a direct speed-dial calling request to a specific interpreter
app.post("/api/calls/dial", (req, res) => {
  const { interpreterId, languageFrom, languageTo, serviceType, serviceMode, cost, clientId } = req.body;

  const { client, error } = resolveClientProfile(clientId);
  if (error) {
    return res.status(400).json({ error });
  }

  const contract = getContractForClient(client);
  if (contract.status === "expired") {
    return res.status(400).json({ error: "Access Denied: Your corporate SLA Contract duration has expired. Please contact your administrative manager." });
  }

  const parsedCost = Number(cost) || 350;
  const targetInt = users.find(u => u.id === interpreterId);
  if (targetInt && !interpreterSupportsLanguagePair(targetInt, languageFrom || "Amharic", languageTo || "English")) {
    return res.status(400).json({
      error: `Interpreter ${targetInt.name} is not registered for ${languageFrom} ⇆ ${languageTo}.`,
    });
  }

  const newSession: Session = {
    id: `sess_call_${Math.floor(1000 + Math.random() * 9000)}`,
    clientId: client!.id,
    clientName: client!.name,
    interpreterId: interpreterId,
    interpreterName: targetInt?.name || "Direct Dial Specialist",
    languageFrom: languageFrom || "Amharic",
    languageTo: languageTo || "English",
    serviceType: serviceType || "medical",
    serviceMode: serviceMode || "Both",
    status: "incoming",
    scheduledTime: "instant",
    cost: parsedCost,
    durationSeconds: 0,
    chatMessages: [
      { id: "msg_init", senderRole: "system", senderName: "System", text: `Direct speed-dial calling established. Pinging ${targetInt?.name || 'specialist'} over secure dynamic channel...`, timestamp: new Date().toISOString() }
    ],
    transcript: []
  };

  sessions.unshift(newSession);

  if (!isInstitutionalClient(client)) {
    const txn: Transaction = {
      id: `tx_dial_${Math.random().toString(36).substr(2, 9)}`,
      userId: client!.id,
      userName: client!.name,
      type: "payment",
      amount: parsedCost,
      status: "completed",
      timestamp: new Date().toISOString(),
      reference: `RESERVE-${newSession.id}`
    };
    transactions.unshift(txn);
  }

  logAction(`Direct ring call initiated to: ${newSession.interpreterName} (${newSession.languageFrom} ⇆ ${newSession.languageTo}). Hold: ${parsedCost} ETB`, "client", client!.name, "info");

  res.json({ session: newSession, balance: clientWalletBalance });
});

// Reject or Cancel an incoming direct call room session
app.post("/api/sessions/:id/reject", (req, res) => {
  const { id } = req.params;
  const session = sessions.find(s => s.id === id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  session.status = "cancelled";

  const sessionClient = getUserById(session.clientId);
  let balance = clientWalletBalance;
  if (!isInstitutionalClient(sessionClient)) {
    clientWalletBalance += session.cost;
    balance = clientWalletBalance;

    const refundTxn: Transaction = {
      id: `tx_ref_${Math.random().toString(36).substr(2, 9)}`,
      userId: sessionClient?.id || session.clientId,
      userName: sessionClient?.name || session.clientName,
      type: "refund",
      amount: session.cost,
      status: "completed",
      timestamp: new Date().toISOString(),
      reference: `REFUND-${session.id}`
    };
    transactions.unshift(refundTxn);
  }

  session.chatMessages.push({
    id: `msg_reject_${Date.now()}`,
    senderRole: "system",
    senderName: "System",
    text: "Call declined or cancelled by party. Reserved funds refunded.",
    timestamp: new Date().toISOString()
  });

  logAction(`Call session ${id} was rejected/ended. Retainer of ${session.cost} ETB refunded to ${session.clientName}.`, "system", "Processor", "warning");
  res.json({ session, balance });
});

// Post an active session request (Immediate or Scheduled)
app.post("/api/sessions/request", (req, res) => {
  const { languageFrom, languageTo, serviceType, serviceMode, scheduledTime, cost, clientId } = req.body;

  const { client, error } = resolveClientProfile(clientId);
  if (error) {
    return res.status(400).json({ error });
  }

  const contract = getContractForClient(client);
  if (contract.status === "expired") {
    return res.status(400).json({ error: "Access Denied: Your corporate SLA Contract duration has expired. Please contact an Administrator to extend validity." });
  }

  // Under active corporate SLA contract, billing processed post-service
  const parsedCost = Number(cost) || 0;

  // Find a matching interpreter for scheduled requests; instant calls broadcast until accepted.
  const matchedInt = users.find((u) => interpreterSupportsLanguagePair(u, languageFrom, languageTo));
  
  const isAIOnly = serviceMode === "AI";
  const isInstant = scheduledTime === "instant";
  const newSession: Session = {
    id: `sess_${Math.floor(1000 + Math.random() * 9000)}`,
    clientId: client!.id,
    clientName: client!.name,
    interpreterId: isAIOnly ? "usr_orzo_ai" : isInstant ? undefined : matchedInt?.id,
    interpreterName: isAIOnly ? "ORZO AI Neural Interpreter" : isInstant ? "" : matchedInt?.name,
    languageFrom,
    languageTo,
    serviceType,
    serviceMode,
    status: isAIOnly ? (isInstant ? "active" : "pending") : (isInstant ? "incoming" : "pending"),
    scheduledTime,
    cost,
    durationSeconds: 0,
    chatMessages: [
      { id: "msg_init", senderRole: "system", senderName: "System", text: isAIOnly ? "ORZO AI Active Interpreter Line Connected. Ready for Voice & Text translation." : `Session initiated. Budget allocated: ${cost} ETB`, timestamp: new Date().toISOString() }
    ],
    transcript: []
  };

  sessions.unshift(newSession);

  if (parsedCost > 0 && !isInstitutionalClient(client)) {
    const txn: Transaction = {
      id: `tx_pay_${Math.random().toString(36).substr(2, 9)}`,
      userId: client!.id,
      userName: client!.name,
      type: "payment",
      amount: cost,
      status: "completed",
      timestamp: new Date().toISOString(),
      reference: `RESERVE-${newSession.id}`
    };
    transactions.unshift(txn);
  }

  logAction(`New interpretation session requested (${languageFrom} <-> ${languageTo}) via ${serviceMode} mode. Cost: ${cost} ETB`, "client", client!.name, "info");

  res.json({ session: newSession, balance: clientWalletBalance });
});

// Accept session (Interpreter)
app.post("/api/sessions/:id/accept", (req, res) => {
  const { id } = req.params;
  const { interpreterId } = req.body;

  const session = sessions.find(s => s.id === id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const interpreter = users.find(u => u.id === interpreterId);
  if (!interpreter) return res.status(404).json({ error: "Interpreter not found" });
  if (!interpreterSupportsLanguagePair(interpreter, session.languageFrom, session.languageTo)) {
    return res.status(403).json({
      error: `You are not registered for the ${session.languageFrom} ⇆ ${session.languageTo} language pair.`,
    });
  }

  session.status = "active";
  session.interpreterId = interpreter.id;
  session.interpreterName = interpreter.name;
  session.chatMessages.push({
    id: `msg_${Date.now()}`,
    senderRole: "system",
    senderName: "System",
    text: `Interpreter ${interpreter.name} accepted the session. Video line open.`,
    timestamp: new Date().toISOString()
  });

  logAction(`Session ${id} accepted by interpreter ${interpreter.name}`, "interpreter", interpreter.name, "success");
  res.json({ success: true, session });
});

// Update chat in session (supports real-time client side polling/fetching)
app.post("/api/sessions/:id/chat", async (req, res) => {
  const { id } = req.params;
  const { senderRole, senderName, text, translatedText } = req.body;

  const session = sessions.find(s => s.id === id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const msgId = `msg_${Math.random().toString(36).substr(2, 9)}`;
  const message: ChatMessage = {
    id: msgId,
    senderRole,
    senderName,
    text,
    translatedText,
    timestamp: new Date().toISOString()
  };

  session.chatMessages.push(message);
  
  // Simultaneously append dialog line to the transcript
  session.transcript.push(`${senderName}: ${text} ${translatedText ? `(${translatedText})` : ""}`);

  // Auto-respond if running in "AI Only" mode
  if (session.serviceMode === "AI" && senderRole === "client") {
    try {
      const froml = session.languageFrom;
      const tol = session.languageTo;
      let replyText = "";
      let replyTranslation = "";

      if (ai) {
        const prompt = `You are "ORZO AI", a professional high-fidelity Neural AI Interpreter inside a live translation session.
The client and interpreter are translating between "${froml}" and "${tol}".
The client just said/sent this message: "${text}" ${translatedText ? `(Linguistic Translation/Context: "${translatedText}")` : ""}.

As a highly professional, real-time virtual AI interpreter, provide a helpful response.
- If the client sent an [Audio Stream] containing local phrases, translate it elegantly and provide a brief phonetic guide in brackets.
- If the client is chatting with you textually, respond in a friendly, conversational, and highly helpful interpreter persona.
Return a JSON with the following structure:
{
  "replyText": "your main response text in the target language (e.g. English, or local language)",
  "replyTranslation": "the translated version of your response in the alternate language, or phonetic details/linguistic nuances of the client's original quote"
}
Output only the raw JSON code, with no wrapper markdown tags. Use valid JSON.`;

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            temperature: 0.3,
            responseMimeType: "application/json"
          }
        });

        const parsed = JSON.parse(response.text?.trim() || "{}");
        replyText = parsed.replyText || "Linguistic connection confirmed. Processing speech patterns.";
        replyTranslation = parsed.replyTranslation || "";
      } else {
        // High quality fallback simulations if Gemini API is not configured yet
        const textLower = text.toLowerCase();
        if (textLower.includes("hello") || textLower.includes("ሰላም") || textLower.includes("hi") || textLower.includes("እንደምን")) {
          replyText = `Selam! I am ORZO AI, your dedicated Neural Interpreter. I am ready to translate your text or voice stream.`;
          replyTranslation = `እንደምን ኖት! እኔ የኦርዞ አርቴፊሻል ኢንተለጀንስ የትርጉም አገልግሎት ነኝ። ለመተርጎም ዝግጁ ነኝ።`;
        } else if (textLower.includes("headache") || textLower.includes("ራስ ምታት") || textLower.includes("በሽታ")) {
          replyText = "Linguistic Analysis: Patient states severe cranial distress/headache. (ICD-10 R51.9)";
          replyTranslation = "Amharic Clinical translation: 'ለሦስት ቀናት የሚቆይ ከባድ የራስ ምታት ሕመም አጋጥሞኛል።'";
        } else if (textLower.includes("thank") || textLower.includes("አመሰግናለሁ")) {
          replyText = "You are welcome. Your Chapa Escrow remains secure. Let me know if you need any other phrases analyzed.";
          replyTranslation = "እባክዎን፤ ተጨማሪ ትርጉም ካስፈለግዎት ለመርዳት ዝግጁ ነኝ።";
        } else {
          replyText = `ORZO AI Neural Response: Translated successfully between ${froml} and ${tol}.`;
          replyTranslation = `[Simulated Output]: "Processed semantic structure of your phrase cleanly into ${tol} with 98.6% dialect confidence."`;
        }
      }

      const aiMsg: ChatMessage = {
        id: `msg_ai_${Date.now()}`,
        senderRole: "interpreter",
        senderName: "ORZO AI Interpreter",
        text: replyText,
        translatedText: replyTranslation,
        timestamp: new Date().toISOString()
      };

      session.chatMessages.push(aiMsg);
      session.transcript.push(`ORZO AI Interpreter: ${replyText} (${replyTranslation})`);
    } catch (err) {
      console.error("AI Interpreter auto-response failed:", err);
    }
  }

  res.json(message);
});

// Finish session
app.post("/api/sessions/:id/complete", (req, res) => {
  const { id } = req.params;
  const { rating, review, transcript, summary } = req.body;

  const session = sessions.find(s => s.id === id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const wasCompleted = session.status === "completed";
  session.status = "completed";
  if (!wasCompleted) {
    session.durationSeconds = Math.floor(400 + Math.random() * 800); // Simulated elapsed time
  }
  if (rating !== undefined) session.ratingByClient = rating;
  if ("review" in req.body) session.reviewByClient = review;
  if (transcript) session.transcript = transcript;
  if (summary) session.summary = summary;

  // Add earnings to interpreter completed count and payout logic
  if (!wasCompleted && session.interpreterId) {
    const interpreter = users.find(u => u.id === session.interpreterId);
    if (interpreter) {
      interpreter.completedSessions = (interpreter.completedSessions || 0) + 1;
      // Add transaction payout
      const intEarningsRate = session.cost * 0.85; // 15% Platform commission
      const interpPayout: Transaction = {
        id: `tx_${Math.random().toString(36).substr(2, 9)}`,
        userId: interpreter.id,
        userName: interpreter.name,
        type: "payment", // credit payment
        amount: Number(intEarningsRate.toFixed(2)),
        status: "completed",
        timestamp: new Date().toISOString(),
        reference: `REVENUE-${session.id}`
      };
      transactions.unshift(interpPayout);
      logAction(`payout credited to ${interpreter.name} for completed session ${session.id}. Amount: ${interpPayout.amount} ETB`, "system", "Processor", "success");
    }
  }

  logAction(`Session ${session.id} marked completed by user feedback`, "client", "Dawit Yohannes", "success");
  res.json(session);
});

// Emergency interventions / Admin tools
app.post("/api/sessions/:id/intervene", (req, res) => {
  const { id } = req.params;
  const session = sessions.find(s => s.id === id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  session.status = "cancelled";
  session.emergencyTriggered = true;
  session.chatMessages.push({
    id: `msg_em_${Date.now()}`,
    senderRole: "system",
    senderName: "System",
    text: "⚠️ Emergency Intervention: Session disconnected by Admin safety override.",
    timestamp: new Date().toISOString()
  });

  logAction(`Safety alert! Admin intervened in session ${session.id} and force terminated connection`, "admin", "Almaz Kebede", "danger");
  res.json(session);
});

// Update user details (Admin)
app.post("/api/users/:id/update", (req, res) => {
  const { id } = req.params;
  const { status, hourlyRate, name } = req.body;

  const user = users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: "User not found" });

  if (status) user.status = status;
  if (hourlyRate) user.hourlyRate = Number(hourlyRate);
  if (name) user.name = name;

  logAction(`User status metadata modified for: ${user.name} (${user.role})`, "admin", "Almaz Kebede", "warning");
  res.json(user);
});

// Update availability (Interpreter)
app.post("/api/scheduler/update", (req, res) => {
  const { userId, day, slots } = req.body;
  
  let userAvail = availabilities.find(a => a.userId === userId && a.day === day);
  if (userAvail) {
    userAvail.slots = slots;
  } else {
    availabilities.push({ userId, day, slots });
  }

  res.json({ success: true, availabilities });
});

// Orzo AI Interactive Assistant Chat & Action routing endpoint
app.post("/api/orzo/chat", async (req, res) => {
  const { message, userId, context } = req.body;
  if (!message) {
    return res.status(400).json({ error: "No message parameter provided" });
  }

  try {
    let replyText = "";
    let action: "schedule" | "phrase" | "summary" | "chat" = "chat";
    let data: any = {};

    if (ai) {
      const prompt = `You are "Orzo AI", an advanced, friendly purple conversational intelligence assistant for the live Ethiopian interpretation platform.
You support clients with booking schedules, language phrase assistance (Amharic, Afaan Oromo, Tigrinya, Somali, Sidama, Wolaytta), and session summarization.
Maintain a supportive, clear, high-contrast human-like interpreter persona.
Strictly observe: ONLY help with interpretation, phrase translation, scheduling, or sessions. DO NOT give medical or legal advice.

Analyze the user's message: "${message}".
Current context metadata: ${JSON.stringify(context || {})}

Based on the message:
1. If they want to book or schedule a session (e.g. "book Oromo interpreter for medical Thursday at 2pm" or similar time/duration setup):
   - Set action to "schedule".
   - Put language, sector, date, time, and estimated duration in the "data" object.
   - Acknowledge with a warm reply.
2. If they need phrase translation help/phrase assist (e.g. "how do you say headache in Somali" or "help me translate chest pain"):
   - Set action to "phrase".
   - Provide a brief translation and add an array "phrases" inside "data" containing 5 helpful clinical/legal phrases related to their query.
   - For each phrase, provide phonetic transcription guide and English translation. (Form: "phrase", "phonetic", "meaning")
3. If they ask to summarize a session (e.g. "summarize my last session"):
   - Set action to "summary".
   - Populate summary data.
4. Otherwise, handle as a helpful friendly conversation. Set action to "chat".

Return ONLY a raw JSON with the following schema, with no markdown tags:
{
  "replyText": "your friendly response text highlighting actions taken",
  "action": "schedule" | "phrase" | "summary" | "chat",
  "data": { ...any metadata parsed like scheduler parameters, list of 5 phrases with transliteration phonetic guides, etc. }
}`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          temperature: 0.3,
          responseMimeType: "application/json"
        }
      });

      const parsed = JSON.parse(response.text?.trim() || "{}");
      replyText = parsed.replyText || "Connection with Orzo AI confirmed.";
      action = parsed.action || "chat";
      data = parsed.data || {};
    } else {
      // High-quality fallback mock interpreter logic
      const textLower = message.toLowerCase();
      if (textLower.includes("book") || textLower.includes("schedule") || textLower.includes("tomorrow") || textLower.includes("thursday")) {
        action = "schedule";
        replyText = "Let me configure a booking slot match for you. I have pre-filled the scheduling system with an Oromo medical interpreter on the schedule workspace.";
        data = {
          language: "Oromo",
          sector: "medical",
          date: "2026-06-18",
          time: "14:00",
          duration: 30
        };
      } else if (textLower.includes("pain") || textLower.includes("headache") || textLower.includes("say") || textLower.includes("cough") || textLower.includes("translate")) {
        action = "phrase";
        replyText = "Here are 5 emergency medical phrases for immediate support with translation and phonetic pronunciation:";
        data = {
          phrases: [
            { phrase: "ራስ ምታት (Ras mitat)", meaning: "Patient states severe cranial stress/headache", phonetic: "Raas muh-taat" },
            { phrase: "ደረት ቁስለት (Deret kusilet)", meaning: "Severe chest discomfort or acute pain", phonetic: "Deh-ret koos-let" },
            { phrase: "ትንፋሽ ማጠር (Tinfash matar)", meaning: "Patient is experiencing shortness of breath", phonetic: "Tuhn-faash mah-tar" },
            { phrase: "ትኩሳት (Tikusat)", meaning: "Systemic high clinical fever", phonetic: "Tee-koo-saat" },
            { phrase: "ሆድ ቁርጠት (Hod kurtet)", meaning: "Severe emergency stomach abdominal pain", phonetic: "Hohd koor-tet" }
          ]
        };
      } else if (textLower.includes("summary") || textLower.includes("summarize") || textLower.includes("last session")) {
        action = "summary";
        replyText = "Here is the structured health summary generated by our Whisper transcription and Orzo AI systems for your last appointment:";
        data = {
          chief_complaint: "Progressive thoracic chest tightness radiating to left shoulder.",
          key_instructions: "Urgent administrative referral to Black Lion Cardiovascular Clinic. Administer low-dose enteric acetylsalicylic acid.",
          follow_up_needed: true,
          language_pair: "en-am",
          duration_minutes: 12
        };
      } else {
        replyText = "Hello! I am ORZO AI, your dedicated language-access agent. Ask me to translate clinical phrases, summarize your recorded voice sessions, or match/book certified translators!";
        action = "chat";
      }
    }

    res.json({ replyText, action, data });
  } catch (err: any) {
    console.error("Orzo Chat handler error:", err);
    res.status(550).json({ replyText: "Apologies, processing speech vectors failed. Please try again.", action: "chat", data: {} });
  }
});



// Return JSON (not HTML) for unknown API routes — avoids silent fetch/json failures in the UI
app.use("/api", (req, res) => {
  res.status(404).json({
    error: `API endpoint not found (${req.method} ${req.originalUrl}). Restart the dev server with "npm run dev".`,
  });
});

// ============================================
// VITE INTEGRATION FOR FULL-STACK DEPLOYMENT
// ============================================

const startServer = async () => {
  if (process.env.NODE_ENV !== "production") {
    // Integrate Vite as a middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development server live in middlewareMode.");
  } else {
    // Production static content delivery
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Ethiopian Interpretation Platform server running at http://localhost:${PORT}`);
    console.log("Interpreter registration: POST /api/users/interpreters/create");
    console.log("Institution client registration: POST /api/users/clients/create");
  });
};

startServer().catch((err) => {
  console.error("Failed to bootstrap server connection:", err);
});
