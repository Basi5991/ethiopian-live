import { User } from "../types";

const LOCAL_INTERPRETERS_KEY = "orzo_local_interpreters";

export interface RegisterInterpreterPayload {
  name: string;
  email: string;
  password?: string;
  languages: string[];
  hourlyRate: number;
  avatar?: string;
  adminName?: string;
}

export interface RegisterInterpreterResult {
  ok: boolean;
  user?: User;
  temporaryPassword?: string | null;
  localOnly?: boolean;
  error?: string;
}

export function loadLocalInterpreters(): User[] {
  try {
    const raw = localStorage.getItem(LOCAL_INTERPRETERS_KEY);
    return raw ? (JSON.parse(raw) as User[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalInterpreters(list: User[]) {
  localStorage.setItem(LOCAL_INTERPRETERS_KEY, JSON.stringify(list));
}

export function mergeUsersWithLocal(serverUsers: User[]): User[] {
  const local = loadLocalInterpreters();
  const serverEmails = new Set(serverUsers.map((u) => u.email.trim().toLowerCase()));
  const merged = [...serverUsers];
  for (const user of local) {
    if (!serverEmails.has(user.email.trim().toLowerCase())) {
      merged.push(user);
    }
  }
  return merged;
}

const CREATE_ENDPOINTS = [
  "/api/users/interpreters/create",
  "/api/admin/register-interpreter",
];

async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function registerInterpreter(
  payload: RegisterInterpreterPayload,
  existingUsers: User[]
): Promise<RegisterInterpreterResult> {
  const body = JSON.stringify({
    name: payload.name.trim(),
    email: payload.email.trim(),
    password: payload.password?.trim() || "demo1234",
    languages: payload.languages,
    hourlyRate: payload.hourlyRate,
    avatar: payload.avatar?.trim() || undefined,
    adminName: payload.adminName || "Administrator",
  });

  for (const url of CREATE_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const data = await parseJsonResponse(res);
      if (res.ok && data.user) {
        const syncedEmail = payload.email.trim().toLowerCase();
        saveLocalInterpreters(
          loadLocalInterpreters().filter((u) => u.email.trim().toLowerCase() !== syncedEmail)
        );
        return {
          ok: true,
          user: data.user as User,
          temporaryPassword: (data.temporaryPassword as string | null | undefined) ?? null,
        };
      }
      if (typeof data.error === "string" && res.status !== 404) {
        return { ok: false, error: data.error };
      }
    } catch {
      /* try next endpoint */
    }
  }

  const emailLower = payload.email.trim().toLowerCase();
  const duplicate =
    existingUsers.some((u) => u.email.trim().toLowerCase() === emailLower) ||
    loadLocalInterpreters().some((u) => u.email.trim().toLowerCase() === emailLower);
  if (duplicate) {
    return { ok: false, error: "An account with this email already exists." };
  }

  const newUser: User = {
    id: `usr_int_${Date.now()}`,
    name: payload.name.trim(),
    email: payload.email.trim(),
    role: "interpreter",
    status: "active",
    languages: payload.languages,
    rating: 5,
    completedSessions: 0,
    hourlyRate: payload.hourlyRate,
    avatar: payload.avatar?.trim() || undefined,
  };

  saveLocalInterpreters([...loadLocalInterpreters(), newUser]);

  return {
    ok: true,
    user: newUser,
    temporaryPassword: payload.password?.trim() || "demo1234",
    localOnly: true,
  };
}
