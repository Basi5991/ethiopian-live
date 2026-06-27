"""Push call events to connected WebSocket clients."""

from __future__ import annotations

import re
from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def user_group_name(user_id: str | None) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", user_id or "unknown")
    return f"user_{safe}"[:95]


def broadcast_to_user(user_id: str | None, payload: dict[str, Any]) -> None:
    if not user_id:
        return
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        user_group_name(user_id),
        {"type": "call.message", "payload": payload},
    )


def broadcast_to_interpreters(payload: dict[str, Any]) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        "role_interpreters",
        {"type": "call.message", "payload": payload},
    )


def notify_call_accepted(
    session: dict[str, Any],
    client_id: str | None,
    interpreter_id: str | None,
) -> None:
    payload = {"type": "call.accepted", "session": session}
    broadcast_to_user(client_id, payload)
    broadcast_to_user(interpreter_id, payload)


def broadcast_webrtc_signal(session, signal, sender_role: str) -> None:
    """Mirror CallConsumer WebRTC fan-out for REST-posted signals."""
    outbound = {
        "type": f"webrtc.{signal.signal_type}",
        "sessionId": session.id,
        "senderRole": sender_role,
        "signal": {
            "id": signal.id,
            "senderRole": signal.sender_role,
            "signalType": signal.signal_type,
            "payload": signal.payload,
            "createdAt": signal.created_at.isoformat(),
        },
        "payload": signal.payload,
    }
    if sender_role == "client":
        interpreter_id = None
        if session.interpreter and hasattr(session.interpreter, "profile"):
            interpreter_id = session.interpreter.profile.external_id
        broadcast_to_user(interpreter_id, outbound)
    else:
        client_id = session.client.profile.external_id if hasattr(session.client, "profile") else None
        broadcast_to_user(client_id, outbound)
