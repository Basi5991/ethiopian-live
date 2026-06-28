from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.utils import timezone

from api.models import ChatMessage, Profile, Session, Transaction, WebRTCSignal
from api.services.interpreter_matching import can_interpreter_accept_session, interpreter_supports_language_pair
from api.utils import (
    get_contract_for_client,
    get_profile_by_external_id,
    get_wallet_balance,
    is_institutional_client,
    log_action,
    new_id,
    new_tx_id,
    resolve_client_profile,
    serialize_session,
)


LIVE_CLIENT_SESSION_STATUSES = ("incoming", "active", "pending")
TERMINAL_SESSION_STATUSES = ("cancelled", "completed", "missed")
STALE_INCOMING_SECONDS = 120
STALE_ACTIVE_SECONDS = 1800


def cleanup_stale_sessions(client_profile: Profile | None = None) -> int:
    """Drop abandoned call rows that block new dispatch on production."""
    now = timezone.now()
    incoming_cutoff = now - timedelta(seconds=STALE_INCOMING_SECONDS)
    active_cutoff = now - timedelta(seconds=STALE_ACTIVE_SECONDS)
    cancelled = 0

    cancelled += Session.objects.filter(status="incoming", created_at__lt=incoming_cutoff).update(status="cancelled")
    cancelled += Session.objects.filter(status="pending", created_at__lt=incoming_cutoff).update(status="cancelled")
    cancelled += Session.objects.filter(status="active", created_at__lt=active_cutoff).update(status="completed")

    if client_profile:
        cancelled += (
            Session.objects.filter(
                client=client_profile.user,
                status__in=LIVE_CLIENT_SESSION_STATUSES,
                created_at__lt=incoming_cutoff,
            ).update(status="cancelled")
        )

    return cancelled


@dataclass
class CallStateResult:
    ok: bool
    event: str | None = None
    session: dict[str, Any] | None = None
    error: str | None = None
    status: int = 200
    client_id: str | None = None
    interpreter_ids: list[str] = field(default_factory=list)
    target_interpreter_id: str | None = None


def _live_client_session(client_profile: Profile) -> Session | None:
    return (
        Session.objects.filter(client=client_profile.user, status__in=LIVE_CLIENT_SESSION_STATUSES)
        .prefetch_related("chat_messages")
        .select_related("client__profile", "interpreter__profile")
        .order_by("-created_at")
        .first()
    )


def _active_interpreter_session(interpreter_profile: Profile) -> Session | None:
    active_cutoff = timezone.now() - timedelta(seconds=STALE_ACTIVE_SECONDS)
    return (
        Session.objects.filter(
            interpreter=interpreter_profile.user,
            status="active",
            created_at__gte=active_cutoff,
        )
        .prefetch_related("chat_messages")
        .select_related("client__profile", "interpreter__profile")
        .order_by("-created_at")
        .first()
    )


def _eligible_interpreter_ids(language_from: str, language_to: str) -> list[str]:
    profiles = Profile.objects.filter(role="interpreter", status="active").select_related("user")
    return [
        profile.external_id
        for profile in profiles
        if interpreter_supports_language_pair(profile.languages, language_from, language_to)
        and not _active_interpreter_session(profile)
    ]


def request_call(data: dict[str, Any]) -> CallStateResult:
    client_id = data.get("clientId")
    client_profile, client_error = resolve_client_profile(client_id)
    if client_error or not client_profile:
        return CallStateResult(False, error=client_error or "No client profile configured.", status=400)

    cleanup_stale_sessions(client_profile)

    contract = get_contract_for_client(client_profile)
    if not contract or contract.status == "expired":
        return CallStateResult(False, error="Access Denied: Your corporate SLA Contract duration has expired.", status=400)

    existing = _live_client_session(client_profile)
    if existing:
        return CallStateResult(
            False,
            error="You already have a call in progress. End or cancel the current call before starting another one.",
            status=409,
            session=serialize_session(existing),
            client_id=client_profile.external_id,
        )

    language_from = data.get("languageFrom") or "Amharic"
    language_to = data.get("languageTo") or "English"
    service_type = data.get("serviceType") or "general"
    service_mode = data.get("serviceMode") or "Human"
    scheduled_time = data.get("scheduledTime") or "instant"
    cost = Decimal(str(data.get("cost") or 0))
    interpreter_id = data.get("interpreterId")

    target_profile = get_profile_by_external_id(interpreter_id) if interpreter_id else None
    if target_profile and not interpreter_supports_language_pair(target_profile.languages, language_from, language_to):
        return CallStateResult(
            False,
            error=f"Interpreter {target_profile.user.get_full_name()} is not registered for {language_from} ⇆ {language_to}.",
            status=400,
        )
    if target_profile and _active_interpreter_session(target_profile):
        return CallStateResult(False, error=f"Interpreter {target_profile.user.get_full_name()} is already on a call.", status=409)

    is_ai_only = service_mode == "AI"
    is_instant = scheduled_time == "instant"
    eligible_interpreter_ids: list[str] = []
    if not is_ai_only and is_instant and not target_profile:
        eligible_interpreter_ids = _eligible_interpreter_ids(language_from, language_to)
        if not eligible_interpreter_ids:
            return CallStateResult(False, error="No eligible interpreter is available for this language pair right now.", status=409)

    if is_ai_only:
        interp_user = None
        interp_name = "ORZO AI Neural Interpreter"
        session_status = "active" if is_instant else "pending"
    elif target_profile:
        interp_user = target_profile.user
        interp_name = target_profile.user.get_full_name()
        session_status = "incoming"
    elif is_instant:
        interp_user = None
        interp_name = ""
        session_status = "incoming"
    else:
        matched = next(
            (
                profile
                for profile in Profile.objects.filter(role="interpreter", status="active").select_related("user")
                if interpreter_supports_language_pair(profile.languages, language_from, language_to)
            ),
            None,
        )
        interp_user = matched.user if matched else None
        interp_name = matched.user.get_full_name() if matched else ""
        session_status = "pending"

    session = Session.objects.create(
        id=new_id("sess_call" if target_profile else "sess"),
        client=client_profile.user,
        client_name=client_profile.user.get_full_name() or client_profile.user.username,
        interpreter=interp_user,
        interpreter_name=interp_name,
        language_from=language_from,
        language_to=language_to,
        service_type=service_type,
        service_mode=service_mode,
        status=session_status,
        scheduled_time=scheduled_time,
        cost=cost,
    )

    ChatMessage.objects.create(
        session=session,
        sender_role="system",
        sender_name="System",
        text=(
            "ORZO AI Active Interpreter Line Connected."
            if is_ai_only
            else f"Session initiated. Budget allocated: {cost} ETB"
        ),
    )

    if cost > 0 and not is_institutional_client(client_profile):
        Transaction.objects.create(
            id=new_tx_id("tx_call"),
            user=client_profile.user,
            user_name=client_profile.user.get_full_name(),
            type="payment",
            amount=cost,
            status="completed",
            reference=f"RESERVE-{session.id}",
        )

    session_data = serialize_session(Session.objects.prefetch_related("chat_messages").get(pk=session.pk))
    interpreter_ids = []
    target_interpreter_id = target_profile.external_id if target_profile else None
    if session_status == "incoming":
        interpreter_ids = [target_interpreter_id] if target_interpreter_id else eligible_interpreter_ids

    log_action(
        f"WebSocket call requested ({language_from} <-> {language_to}) via {service_mode}.",
        "client",
        client_profile.user.get_full_name(),
    )

    return CallStateResult(
        True,
        event="call.accepted" if session_status == "active" else "call.ringing",
        session=session_data,
        client_id=client_profile.external_id,
        interpreter_ids=[i for i in interpreter_ids if i],
        target_interpreter_id=target_interpreter_id,
    )


def accept_call(session_id: str, interpreter_id: str | None, interpreter_name: str | None = None) -> CallStateResult:
    if not interpreter_id:
        return CallStateResult(False, error="A valid interpreter account is required to accept this call.", status=400)

    with transaction.atomic():
        try:
            session = (
                Session.objects.select_for_update()
                .select_related("client__profile", "interpreter__profile")
                .get(pk=session_id)
            )
        except Session.DoesNotExist:
            return CallStateResult(False, error="Session not found.", status=404)

        if session.status != "incoming":
            return CallStateResult(False, error="This session is no longer available to accept.", status=409)

        profile = get_profile_by_external_id(interpreter_id)
        if not profile or profile.role != "interpreter":
            return CallStateResult(False, error="A valid interpreter account is required to accept this call.", status=400)

        if _active_interpreter_session(profile):
            return CallStateResult(False, error="You already have an active call.", status=409)

        if not can_interpreter_accept_session(session, profile):
            return CallStateResult(
                False,
                error=f"You are not registered for the {session.language_from} ⇆ {session.language_to} language pair.",
                status=403,
            )

        session.interpreter = profile.user
        session.interpreter_name = interpreter_name or profile.user.get_full_name()
        session.status = "active"
        session.save()

        Session.objects.filter(client=session.client, status__in=LIVE_CLIENT_SESSION_STATUSES).exclude(pk=session.pk).update(
            status="cancelled"
        )

        ChatMessage.objects.create(
            session=session,
            sender_role="system",
            sender_name="System",
            text=f"Interpreter {session.interpreter_name} accepted the session. Video line open.",
        )

    session = Session.objects.prefetch_related("chat_messages").select_related("client__profile", "interpreter__profile").get(
        pk=session_id
    )
    session_data = serialize_session(session)
    log_action(f"Session {session_id} accepted by interpreter {session.interpreter_name}", "interpreter", session.interpreter_name, "success")
    return CallStateResult(
        True,
        event="call.accepted",
        session=session_data,
        client_id=session_data.get("clientId"),
        target_interpreter_id=interpreter_id,
    )


def end_call(session_id: str, actor_id: str | None = None, reason: str = "ended") -> CallStateResult:
    try:
        session = Session.objects.prefetch_related("chat_messages").select_related("client__profile", "interpreter__profile").get(
            pk=session_id
        )
    except Session.DoesNotExist:
        return CallStateResult(False, error="Session not found.", status=404)

    if session.status not in TERMINAL_SESSION_STATUSES:
        session.status = "completed" if reason == "completed" else "cancelled"
        session.save(update_fields=["status"])
        ChatMessage.objects.create(
            session=session,
            sender_role="system",
            sender_name="System",
            text="Call ended.",
        )
    WebRTCSignal.objects.filter(session=session).delete()

    session = Session.objects.prefetch_related("chat_messages").select_related("client__profile", "interpreter__profile").get(
        pk=session_id
    )
    session_data = serialize_session(session)
    return CallStateResult(
        True,
        event="call.ended",
        session=session_data,
        client_id=session_data.get("clientId"),
        target_interpreter_id=session_data.get("interpreterId") or actor_id,
    )
