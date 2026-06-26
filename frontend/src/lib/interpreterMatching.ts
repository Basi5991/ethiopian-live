import { LanguageProficiency, Session } from "../types";

type LanguageEntry = string | LanguageProficiency | Record<string, unknown>;

/** Return flat language names from string or {language, level} entries. */
export function normalizeInterpreterLanguages(
  languages: LanguageEntry[] | undefined
): string[] {
  if (!languages?.length) return [];
  const codes: string[] = [];
  for (const item of languages) {
    if (typeof item === "string" && item.trim()) {
      codes.push(item.trim());
    } else if (item && typeof item === "object") {
      const lang = String(
        (item as LanguageProficiency).language ||
          (item as Record<string, unknown>).name ||
          ""
      ).trim();
      if (lang) codes.push(lang);
    }
  }
  return codes;
}

export function formatLanguageProficiencies(
  languages: LanguageEntry[] | undefined,
  proficiencies?: LanguageProficiency[]
): string {
  if (proficiencies?.length) {
    return proficiencies.map((p) => `${p.language} (${p.level})`).join(", ");
  }
  return normalizeInterpreterLanguages(languages).join(", ");
}

/** Interpreter must list the language in their profile. */
export function interpreterSpeaksLanguage(
  languages: LanguageEntry[] | undefined,
  language: string
): boolean {
  if (!language) return false;
  return normalizeInterpreterLanguages(languages).includes(language);
}

/** Interpreter must speak both sides of the requested pair. */
export function interpreterSupportsLanguagePair(
  languages: LanguageEntry[] | undefined,
  languageFrom: string,
  languageTo: string
): boolean {
  return (
    interpreterSpeaksLanguage(languages, languageFrom) &&
    interpreterSpeaksLanguage(languages, languageTo)
  );
}

/** Whether an incoming session should ring on this interpreter's desk. */
export function isIncomingCallForInterpreter(
  session: Pick<Session, "status" | "interpreterId" | "scheduledTime" | "languageFrom" | "languageTo">,
  interpreterId: string,
  interpreterLanguages: LanguageEntry[] | undefined
): boolean {
  if (session.status !== "incoming") return false;

  if (session.interpreterId) {
    return session.interpreterId === interpreterId;
  }

  if (session.scheduledTime !== "instant") return false;

  return interpreterSupportsLanguagePair(
    interpreterLanguages,
    session.languageFrom,
    session.languageTo
  );
}

/** First broadcast or direct-dial call this interpreter is eligible to accept. */
export function findIncomingSessionForInterpreter(
  sessions: Session[],
  interpreterId: string,
  interpreterLanguages: LanguageEntry[] | undefined,
  dismissedSessionId?: string | null
): Session | undefined {
  return sessions.find(
    (session) =>
      session.id !== dismissedSessionId &&
      isIncomingCallForInterpreter(session, interpreterId, interpreterLanguages)
  );
}

export function isDirectDialSession(session: Pick<Session, "interpreterId">, interpreterId: string): boolean {
  return Boolean(session.interpreterId && session.interpreterId === interpreterId);
}
