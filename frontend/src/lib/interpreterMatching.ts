import { Session } from "../types";

/** Interpreter must list the language in their profile. */
export function interpreterSpeaksLanguage(
  languages: string[] | undefined,
  language: string
): boolean {
  if (!languages?.length || !language) return false;
  return languages.includes(language);
}

/** Interpreter must speak both sides of the requested pair. */
export function interpreterSupportsLanguagePair(
  languages: string[] | undefined,
  languageFrom: string,
  languageTo: string
): boolean {
  if (!languages?.length) return false;
  return (
    interpreterSpeaksLanguage(languages, languageFrom) &&
    interpreterSpeaksLanguage(languages, languageTo)
  );
}

/** Whether an incoming session should ring on this interpreter's desk. */
export function isIncomingCallForInterpreter(
  session: Pick<Session, "status" | "interpreterId" | "scheduledTime" | "languageFrom" | "languageTo">,
  interpreterId: string,
  interpreterLanguages: string[] | undefined
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
  interpreterLanguages: string[] | undefined,
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
