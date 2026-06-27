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
