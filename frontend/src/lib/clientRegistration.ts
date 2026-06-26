import { User } from "../types";

const LOCAL_CLIENTS_KEY = "orzo_local_clients";

export interface RegisterClientPayload {
  name: string;
  email: string;
  password?: string;
  contractId: string;
  isInstitutionPrimary: boolean;
  status?: "active" | "pending" | "suspended";
  adminName?: string;
}

export interface RegisterClientResult {
  ok: boolean;
  user?: User;
  temporaryPassword?: string | null;
  localOnly?: boolean;
  error?: string;
}

export function loadLocalClients(): User[] {
  try {
    const raw = localStorage.getItem(LOCAL_CLIENTS_KEY);
    return raw ? (JSON.parse(raw) as User[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalClients(list: User[]) {
  localStorage.setItem(LOCAL_CLIENTS_KEY, JSON.stringify(list));
}

export function mergeUsersWithLocalClients(serverUsers: User[]): User[] {
  const local = loadLocalClients();
  const serverEmails = new Set(serverUsers.map((u) => u.email.trim().toLowerCase()));
  const merged = [...serverUsers];
  for (const user of local) {
    if (!serverEmails.has(user.email.trim().toLowerCase())) {
      merged.push(user);
    }
  }
  return merged;
}

const CREATE_ENDPOINTS = ["/api/users/clients/create"];

async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function registerInstitutionClient(
  payload: RegisterClientPayload,
  existingUsers: User[],
  contractsList: { contractId: string; organizationName: string; status: string }[]
): Promise<RegisterClientResult> {
  const body = JSON.stringify({
    name: payload.name.trim(),
    email: payload.email.trim(),
    password: payload.password?.trim() || "demo1234",
    contractId: payload.contractId,
    isInstitutionPrimary: payload.isInstitutionPrimary,
    status: payload.status || "active",
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
        saveLocalClients(
          loadLocalClients().filter((u) => u.email.trim().toLowerCase() !== syncedEmail)
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
    loadLocalClients().some((u) => u.email.trim().toLowerCase() === emailLower);
  if (duplicate) {
    return { ok: false, error: "An account with this email already exists." };
  }

  const contract = contractsList.find((c) => c.contractId === payload.contractId);
  if (!contract) {
    return { ok: false, error: "Institution contract not found." };
  }
  if (contract.status === "expired") {
    return { ok: false, error: "Cannot create client for an expired institution contract." };
  }

  if (payload.isInstitutionPrimary) {
    const existingPrimary = [...existingUsers, ...loadLocalClients()].some(
      (u) =>
        u.role === "client" &&
        u.contractId === payload.contractId &&
        u.isInstitutionPrimary
    );
    if (existingPrimary) {
      return { ok: false, error: "A primary org account already exists for this institution." };
    }
  }

  const newUser: User = {
    id: `usr_client_${Date.now()}`,
    name: payload.name.trim(),
    email: payload.email.trim(),
    role: "client",
    status: payload.status || "active",
    contractId: payload.contractId,
    organizationName: contract.organizationName,
    isInstitutionPrimary: payload.isInstitutionPrimary,
    provisionedPassword: payload.password?.trim() || "demo1234",
  };

  saveLocalClients([...loadLocalClients(), newUser]);

  return {
    ok: true,
    user: newUser,
    temporaryPassword: payload.password?.trim() || "demo1234",
    localOnly: true,
  };
}
