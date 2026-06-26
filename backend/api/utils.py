"""Shared helpers for API layer."""

from __future__ import annotations

import random
import uuid
from decimal import Decimal

from django.utils import timezone

from .models import AppState, AuditLog, ContractDetails, Profile


def new_id(prefix: str) -> str:
    return f"{prefix}_{random.randint(1000, 9999)}"


def new_tx_id(prefix: str = "tx") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def new_log_id() -> str:
    return f"log_{uuid.uuid4().hex[:9]}"


def log_action(action: str, user_role: str, user_name: str, status: str = "info") -> AuditLog:
    return AuditLog.objects.create(
        id=new_log_id(),
        action=action,
        user_role=user_role,
        user_name=user_name,
        status=status,
    )


def get_profile_by_external_id(external_id: str) -> Profile | None:
    try:
        return Profile.objects.select_related("user", "contract").get(external_id=external_id)
    except Profile.DoesNotExist:
        return None


def get_default_client_profile() -> Profile | None:
    return (
        Profile.objects.filter(role="client", status="active")
        .select_related("user", "contract")
        .first()
    )


def is_institutional_client(profile: Profile) -> bool:
    return profile.role == "client" and profile.contract_id is not None


def get_contract_for_client(profile: Profile) -> ContractDetails | None:
    if profile.contract_id:
        contract = profile.contract
        if contract:
            contract.refresh_status()
            contract.save(update_fields=["status"])
        return contract
    return check_and_get_contract()


def resolve_client_profile(client_id: str | None) -> tuple[Profile | None, str | None]:
    if client_id:
        profile = get_profile_by_external_id(client_id)
        if not profile:
            return None, "Client account not found."
        if profile.role != "client":
            return None, "Invalid client account."
        if profile.status != "active":
            return None, "This client account is not active."
        if profile.contract_id:
            contract = profile.contract
            if not contract:
                return None, "Institution contract not found."
            contract.refresh_status()
            contract.save(update_fields=["status"])
            if contract.status == "expired":
                return None, "Access Denied: Your corporate SLA Contract duration has expired."
        return profile, None

    profile = get_default_client_profile()
    if not profile:
        return None, "No client profile configured."
    return profile, None


def serialize_user(profile: Profile) -> dict:
    user = profile.user
    data = {
        "id": profile.external_id,
        "name": user.get_full_name() or user.username,
        "email": user.email,
        "role": profile.role,
        "status": profile.status,
    }
    if profile.role == "interpreter":
        data["languages"] = profile.languages or []
        data["rating"] = float(profile.rating)
        data["completedSessions"] = profile.completed_sessions
        data["hourlyRate"] = float(profile.hourly_rate)
    if profile.avatar:
        data["avatar"] = profile.avatar
    if profile.contract_id and profile.contract:
        data["contractId"] = profile.contract.contract_id
        data["organizationName"] = profile.contract.organization_name
        data["isInstitutionPrimary"] = profile.is_institution_primary
    data["provisionedPassword"] = profile.provisioned_password or "demo1234"
    return data


def serialize_chat_message(msg) -> dict:
    data = {
        "id": msg.id,
        "senderRole": msg.sender_role,
        "senderName": msg.sender_name,
        "text": msg.text,
        "timestamp": msg.timestamp.isoformat().replace("+00:00", "Z"),
    }
    if msg.translated_text:
        data["translatedText"] = msg.translated_text
    return data


def serialize_session(session) -> dict:
    data = {
        "id": session.id,
        "clientId": session.client.profile.external_id if hasattr(session.client, "profile") else "",
        "clientName": session.client_name,
        "languageFrom": session.language_from,
        "languageTo": session.language_to,
        "serviceType": session.service_type,
        "serviceMode": session.service_mode,
        "status": session.status,
        "scheduledTime": session.scheduled_time,
        "cost": float(session.cost),
        "durationSeconds": session.duration_seconds,
        "chatMessages": [serialize_chat_message(m) for m in session.chat_messages.all()],
        "transcript": session.transcript or [],
    }
    if session.interpreter and hasattr(session.interpreter, "profile"):
        data["interpreterId"] = session.interpreter.profile.external_id
    if session.interpreter_name:
        data["interpreterName"] = session.interpreter_name
    if session.summary:
        data["summary"] = session.summary
    if session.rating_by_client is not None:
        data["ratingByClient"] = session.rating_by_client
    if session.review_by_client:
        data["reviewByClient"] = session.review_by_client
    if session.emergency_triggered:
        data["emergencyTriggered"] = True
    return data


def serialize_transaction(txn) -> dict:
    profile = getattr(txn.user, "profile", None)
    return {
        "id": txn.id,
        "userId": profile.external_id if profile else str(txn.user_id),
        "userName": txn.user_name,
        "type": txn.type,
        "amount": float(txn.amount),
        "status": txn.status,
        "timestamp": txn.timestamp.isoformat().replace("+00:00", "Z"),
        "reference": txn.reference,
    }


def serialize_availability(avail) -> dict:
    return {
        "userId": avail.interpreter.profile.external_id,
        "day": avail.day,
        "slots": avail.slots or [],
    }


def serialize_audit_log(log) -> dict:
    return {
        "id": log.id,
        "timestamp": log.timestamp.isoformat().replace("+00:00", "Z"),
        "action": log.action,
        "userRole": log.user_role,
        "userName": log.user_name,
        "status": log.status,
    }


def serialize_contract(contract: ContractDetails) -> dict:
    contract.refresh_status()
    contract.save(update_fields=["status"])
    return {
        "contractId": contract.contract_id,
        "organizationName": contract.organization_name,
        "signedDate": contract.signed_date.isoformat().replace("+00:00", "Z"),
        "expiryDate": contract.expiry_date.isoformat().replace("+00:00", "Z"),
        "slaLevel": contract.sla_level,
        "billingCode": contract.billing_code,
        "maxConcurrentSessions": contract.max_concurrent_sessions,
        "status": contract.status,
    }


def check_and_get_contract() -> ContractDetails | None:
    state = AppState.get()
    contract = None
    if state.active_contract_id:
        contract = ContractDetails.objects.filter(contract_id=state.active_contract_id).first()
    if not contract:
        contract = ContractDetails.objects.first()
        if contract:
            state.active_contract_id = contract.contract_id
            state.save(update_fields=["active_contract_id"])
    if contract:
        contract.refresh_status()
        contract.save(update_fields=["status"])
    return contract


def get_wallet_balance() -> float:
    state = AppState.get()
    return float(state.client_wallet_balance)


def set_wallet_balance(amount: Decimal | float) -> float:
    state = AppState.get()
    state.client_wallet_balance = Decimal(str(amount))
    state.save(update_fields=["client_wallet_balance"])
    return float(state.client_wallet_balance)
