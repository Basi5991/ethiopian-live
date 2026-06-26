"""Language-pair routing for interpreter dispatch and session acceptance."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..models import Profile, Session


def interpreter_speaks_language(languages: list | None, language: str) -> bool:
    if not languages or not language:
        return False
    return language in languages


def interpreter_supports_language_pair(
    languages: list | None,
    language_from: str,
    language_to: str,
) -> bool:
    """Interpreter must speak both sides of the requested pair."""
    if not languages:
        return False
    return interpreter_speaks_language(languages, language_from) and interpreter_speaks_language(
        languages, language_to
    )


def is_incoming_call_for_interpreter(
    session: Session,
    interpreter_external_id: str,
    interpreter_languages: list | None,
) -> bool:
    if session.status != "incoming":
        return False

    if session.interpreter_id:
        profile = getattr(session.interpreter, "profile", None)
        assigned_id = profile.external_id if profile else None
        return assigned_id == interpreter_external_id

    if session.scheduled_time != "instant":
        return False

    return interpreter_supports_language_pair(
        interpreter_languages,
        session.language_from,
        session.language_to,
    )


def can_interpreter_accept_session(session: Session, profile: Profile) -> bool:
    if session.status != "incoming":
        return False

    if profile.role != "interpreter" or profile.status != "active":
        return False

    if session.interpreter_id:
        assigned = getattr(session.interpreter, "profile", None)
        if assigned and assigned.external_id != profile.external_id:
            return False

    return interpreter_supports_language_pair(
        profile.languages,
        session.language_from,
        session.language_to,
    )
