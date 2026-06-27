from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs

from asgiref.sync import async_to_sync
from channels.generic.websocket import JsonWebsocketConsumer

from .models import Session, WebRTCSignal
from .services import call_state


def _group_name(prefix: str, value: str | None) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", value or "unknown")
    return f"{prefix}_{safe}"[:95]


class CallConsumer(JsonWebsocketConsumer):
    """Authoritative WebSocket transport for live calls and WebRTC signaling."""

    def connect(self):
        query = parse_qs(self.scope.get("query_string", b"").decode())
        self.user_id = (query.get("userId") or [""])[0]
        self.role = (query.get("role") or [""])[0]

        if self.role not in ("client", "interpreter", "admin") or not self.user_id:
            self.close(code=4400)
            return

        self.user_group = _group_name("user", self.user_id)
        async_to_sync(self.channel_layer.group_add)(self.user_group, self.channel_name)
        if self.role == "interpreter":
            async_to_sync(self.channel_layer.group_add)("role_interpreters", self.channel_name)
        self.accept()
        self.send_json({"type": "socket.ready", "userId": self.user_id, "role": self.role})

    def disconnect(self, close_code):
        if hasattr(self, "user_group"):
            async_to_sync(self.channel_layer.group_discard)(self.user_group, self.channel_name)
        if getattr(self, "role", None) == "interpreter":
            async_to_sync(self.channel_layer.group_discard)("role_interpreters", self.channel_name)

    def receive_json(self, content: dict[str, Any], **kwargs):
        message_type = content.get("type")
        payload = content.get("payload") or {}

        if message_type == "call.request":
            self._handle_call_request(payload)
        elif message_type == "call.accept":
            self._handle_call_accept(payload)
        elif message_type in ("call.decline", "call.cancel", "call.end"):
            self._handle_call_end(payload, message_type)
        elif message_type in ("webrtc.offer", "webrtc.answer", "webrtc.ice", "webrtc.hangup"):
            self._handle_webrtc_signal(message_type, payload)
        elif message_type == "ping":
            self.send_json({"type": "pong"})
        else:
            self.send_json({"type": "call.error", "error": "Unknown WebSocket event."})

    def call_message(self, event):
        self.send_json(event["payload"])

    def _send_group(self, group: str, payload: dict[str, Any]):
        async_to_sync(self.channel_layer.group_send)(group, {"type": "call.message", "payload": payload})

    def _send_user(self, user_id: str | None, payload: dict[str, Any]):
        if user_id:
            self._send_group(_group_name("user", user_id), payload)

    def _handle_call_request(self, payload: dict[str, Any]):
        data = {**payload, "clientId": payload.get("clientId") or self.user_id}
        result = call_state.request_call(data)
        if not result.ok:
            self.send_json({"type": "call.error", "error": result.error, "status": result.status, "session": result.session})
            return

        self._send_user(result.client_id, {"type": "call.created", "session": result.session})
        if result.event == "call.accepted":
            self._send_user(result.client_id, {"type": "call.accepted", "session": result.session})
            return

        ringing_payload = {"type": "call.ringing", "session": result.session}
        if result.target_interpreter_id:
            self._send_user(result.target_interpreter_id, ringing_payload)
        elif result.interpreter_ids:
            for interpreter_id in result.interpreter_ids:
                self._send_user(interpreter_id, ringing_payload)
            # Also notify every connected interpreter desk; UI filters by language pair.
            self._send_group("role_interpreters", ringing_payload)
        else:
            self._send_user(result.client_id, {"type": "call.error", "error": "No eligible interpreter is available."})

    def _handle_call_accept(self, payload: dict[str, Any]):
        session_id = payload.get("sessionId")
        result = call_state.accept_call(session_id, payload.get("interpreterId") or self.user_id, payload.get("interpreterName"))
        if not result.ok:
            self.send_json({"type": "call.error", "error": result.error, "status": result.status, "session": result.session})
            return

        accepted_payload = {"type": "call.accepted", "session": result.session}
        self._send_user(result.client_id, accepted_payload)
        self._send_user(result.target_interpreter_id, accepted_payload)

    def _handle_call_end(self, payload: dict[str, Any], message_type: str):
        session_id = payload.get("sessionId")
        reason = "completed" if message_type == "call.end" else "cancelled"
        result = call_state.end_call(session_id, self.user_id, reason=reason)
        if not result.ok:
            self.send_json({"type": "call.error", "error": result.error, "status": result.status})
            return

        ended_payload = {"type": "call.ended", "session": result.session}
        self._send_user(result.client_id, ended_payload)
        self._send_user(result.target_interpreter_id, ended_payload)

    def _handle_webrtc_signal(self, message_type: str, payload: dict[str, Any]):
        session_id = payload.get("sessionId")
        signal_payload = payload.get("payload")
        signal_type = message_type.split(".", 1)[1]
        if not session_id or signal_payload is None:
            self.send_json({"type": "call.error", "error": "Missing WebRTC sessionId or payload."})
            return

        try:
            session = Session.objects.select_related("client__profile", "interpreter__profile").get(pk=session_id)
        except Session.DoesNotExist:
            self.send_json({"type": "call.error", "error": "Session not found."})
            return

        sender_role = "interpreter" if self.role == "interpreter" else "client"
        if signal_type in ("offer", "answer"):
            WebRTCSignal.objects.filter(session=session, signal_type=signal_type, sender_role=sender_role).delete()
        signal = WebRTCSignal.objects.create(
            session=session,
            sender_role=sender_role,
            signal_type=signal_type,
            payload=signal_payload,
        )
        outbound = {
            "type": message_type,
            "sessionId": session_id,
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
            interpreter_id = session.interpreter.profile.external_id if session.interpreter and hasattr(session.interpreter, "profile") else None
            self._send_user(interpreter_id, outbound)
        else:
            client_id = session.client.profile.external_id if hasattr(session.client, "profile") else None
            self._send_user(client_id, outbound)
