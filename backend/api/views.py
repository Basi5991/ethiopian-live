"""REST API views for Terjuman.live frontend."""

from __future__ import annotations

import random
from decimal import Decimal

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    AppState,
    AuditLog,
    ChatMessage,
    ContractDetails,
    InterpreterAvailability,
    Profile,
    Session,
    Transaction,
    WebRTCSignal,
)
from .services import gemini
from .services.interpreter_matching import can_interpreter_accept_session
from .utils import (
    check_and_get_contract,
    get_contract_for_client,
    get_default_client_profile,
    get_profile_by_external_id,
    get_wallet_balance,
    is_institutional_client,
    log_action,
    normalize_interpreter_languages,
    new_id,
    new_log_id,
    new_tx_id,
    resolve_client_profile,
    serialize_audit_log,
    serialize_availability,
    serialize_chat_message,
    serialize_contract,
    serialize_session,
    serialize_transaction,
    serialize_user,
    set_wallet_balance,
)


DEMO_PASSWORDS = {"demo1234", "••••••••", "********"}


class AuthLoginView(APIView):
    def post(self, request):
        email = (request.data.get("email") or "").strip()
        password = request.data.get("password") or ""
        role = request.data.get("role")

        if not email:
            return Response(
                {"error": "Please supply a valid email address."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.filter(email__iexact=email).select_related("profile", "profile__contract").first()
        if not user or not hasattr(user, "profile"):
            return Response(
                {"error": "Invalid email or authorization pin."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        profile = user.profile
        password_ok = user.check_password(password) or password in DEMO_PASSWORDS
        if not password_ok:
            auth_user = authenticate(username=user.username, password=password)
            password_ok = auth_user is not None or password in DEMO_PASSWORDS

        if not password_ok:
            return Response(
                {"error": "Invalid email or authorization pin."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if role and profile.role != role:
            return Response(
                {
                    "error": (
                        f"Access denied: This credential belongs to a registered "
                        f"{profile.role} workspace, not the currently chosen security gate."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if profile.status == "suspended":
            return Response(
                {"error": "This account has been temporarily suspended."},
                status=status.HTTP_403_FORBIDDEN,
            )

        log_action(
            f"User {user.get_full_name()} authenticated via email login",
            profile.role,
            user.get_full_name(),
            "success",
        )

        return Response({"success": True, "user": serialize_user(profile)})


class InitView(APIView):
    def get(self, request):
        client_id = request.query_params.get("clientId")
        contract = None
        if client_id:
            profile = get_profile_by_external_id(client_id)
            if profile and profile.contract_id:
                contract = get_contract_for_client(profile)

        if not contract:
            contract = check_and_get_contract()

        profiles = Profile.objects.select_related("user", "contract").all()
        return Response(
            {
                "users": [serialize_user(p) for p in profiles],
                "sessions": [serialize_session(s) for s in Session.objects.prefetch_related("chat_messages").all()],
                "transactions": [serialize_transaction(t) for t in Transaction.objects.select_related("user__profile").all()],
                "availabilities": [
                    serialize_availability(a)
                    for a in InterpreterAvailability.objects.select_related("interpreter__profile").all()
                ],
                "auditLogs": [serialize_audit_log(l) for l in AuditLog.objects.all()[:50]],
                "clientWalletBalance": get_wallet_balance(),
                "contractDetails": serialize_contract(contract) if contract else None,
                "contractsList": [serialize_contract(c) for c in ContractDetails.objects.all()],
                "activeContractId": AppState.get().active_contract_id,
                "aiAvailable": gemini.is_ai_available(),
            }
        )


class SessionsListView(APIView):
    def get(self, request):
        sessions = Session.objects.prefetch_related("chat_messages").all()
        return Response([serialize_session(s) for s in sessions])


class SessionRequestView(APIView):
    def post(self, request):
        client_id = request.data.get("clientId")
        client_profile, client_error = resolve_client_profile(client_id)
        if client_error:
            return Response({"error": client_error}, status=status.HTTP_400_BAD_REQUEST)

        contract = get_contract_for_client(client_profile)
        if not contract or contract.status == "expired":
            return Response(
                {"error": "Access Denied: Your corporate SLA Contract duration has expired."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        language_from = request.data.get("languageFrom", "Amharic")
        language_to = request.data.get("languageTo", "English")
        service_type = request.data.get("serviceType", "general")
        service_mode = request.data.get("serviceMode", "Human")
        scheduled_time = request.data.get("scheduledTime", "instant")
        cost = Decimal(str(request.data.get("cost", 0)))

        if not client_profile:
            return Response({"error": "No client profile configured."}, status=status.HTTP_400_BAD_REQUEST)

        matched = next(
            (
                p
                for p in Profile.objects.filter(role="interpreter", status="active").select_related("user")
                if language_from in normalize_interpreter_languages(p.languages)
            ),
            None,
        )
        is_ai_only = service_mode == "AI"

        if is_ai_only:
            interp_name = "ORZO AI Neural Interpreter"
            interp_user = None
            session_status = "active" if scheduled_time == "instant" else "pending"
        elif scheduled_time == "instant":
            # Open broadcast — first interpreter to accept claims the session
            interp_user = None
            interp_name = ""
            session_status = "incoming"
        else:
            interp_user = matched.user if matched else None
            interp_name = matched.user.get_full_name() if matched else ""
            session_status = "pending"

        session = Session.objects.create(
            id=new_id("sess"),
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

        init_text = (
            "ORZO AI Active Interpreter Line Connected."
            if is_ai_only
            else f"Session initiated. Budget allocated: {cost} ETB"
        )
        ChatMessage.objects.create(
            id=f"msg_init_{random.randint(1000, 9999)}",
            session=session,
            sender_role="system",
            sender_name="System",
            text=init_text,
        )

        if cost > 0 and not is_institutional_client(client_profile):
            Transaction.objects.create(
                id=new_tx_id("tx_pay"),
                user=client_profile.user,
                user_name=client_profile.user.get_full_name(),
                type="payment",
                amount=cost,
                status="completed",
                reference=f"RESERVE-{session.id}",
            )

        log_action(
            f"New interpretation session requested ({language_from} <-> {language_to}) via {service_mode}.",
            "client",
            client_profile.user.get_full_name(),
        )

        return Response({"success": True, "session": serialize_session(session), "balance": get_wallet_balance()})


class CallDialView(APIView):
    def post(self, request):
        client_id = request.data.get("clientId")
        client_profile, client_error = resolve_client_profile(client_id)
        if client_error:
            return Response({"error": client_error}, status=status.HTTP_400_BAD_REQUEST)

        contract = get_contract_for_client(client_profile)
        if not contract or contract.status == "expired":
            return Response(
                {"error": "Access Denied: Your corporate SLA Contract duration has expired."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        interpreter_id = request.data.get("interpreterId")
        language_from = request.data.get("languageFrom", "Amharic")
        language_to = request.data.get("languageTo", "English")
        service_type = request.data.get("serviceType", "medical")
        service_mode = request.data.get("serviceMode", "Both")
        cost = Decimal(str(request.data.get("cost", 350)))

        if not client_profile:
            return Response({"error": "No client profile configured."}, status=status.HTTP_400_BAD_REQUEST)

        target = get_profile_by_external_id(interpreter_id) if interpreter_id else None

        session = Session.objects.create(
            id=new_id("sess_call"),
            client=client_profile.user,
            client_name=client_profile.user.get_full_name(),
            interpreter=target.user if target else None,
            interpreter_name=target.user.get_full_name() if target else "Direct Dial Specialist",
            language_from=language_from,
            language_to=language_to,
            service_type=service_type,
            service_mode=service_mode,
            status="incoming",
            scheduled_time="instant",
            cost=cost,
        )

        ChatMessage.objects.create(
            id=f"msg_init_{random.randint(1000, 9999)}",
            session=session,
            sender_role="system",
            sender_name="System",
            text=f"Direct speed-dial calling established. Pinging {session.interpreter_name}...",
        )

        if not is_institutional_client(client_profile):
            Transaction.objects.create(
                id=new_tx_id("tx_dial"),
                user=client_profile.user,
                user_name=client_profile.user.get_full_name(),
                type="payment",
                amount=cost,
                status="completed",
                reference=f"RESERVE-{session.id}",
            )

        log_action(
            f"Direct ring call initiated to: {session.interpreter_name} ({language_from} ⇆ {language_to}).",
            "client",
            client_profile.user.get_full_name(),
        )

        return Response({"session": serialize_session(session), "balance": get_wallet_balance()})


class SessionAcceptView(APIView):
    def post(self, request, session_id):
        try:
            session = Session.objects.prefetch_related("chat_messages").select_related(
                "interpreter__profile"
            ).get(pk=session_id)
        except Session.DoesNotExist:
            return Response({"error": "Session not found"}, status=status.HTTP_404_NOT_FOUND)

        if session.status != "incoming":
            return Response(
                {"error": "This session is no longer available to accept."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        interpreter_id = request.data.get("interpreterId")
        interpreter_name = request.data.get("interpreterName")
        profile = get_profile_by_external_id(interpreter_id) if interpreter_id else None

        if not profile or profile.role != "interpreter":
            return Response(
                {"error": "A valid interpreter account is required to accept this call."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not can_interpreter_accept_session(session, profile):
            return Response(
                {
                    "error": (
                        f"You are not registered for the {session.language_from} ⇆ "
                        f"{session.language_to} language pair."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        session.interpreter = profile.user
        session.interpreter_name = interpreter_name or profile.user.get_full_name()
        session.status = "active"
        session.save()

        WebRTCSignal.objects.filter(session=session).delete()

        ChatMessage.objects.create(
            session=session,
            sender_role="system",
            sender_name="System",
            text=f"Interpreter {session.interpreter_name} accepted the session. Video line open.",
        )

        log_action(
            f"Session {session_id} accepted by interpreter {session.interpreter_name}",
            "interpreter",
            session.interpreter_name,
            "success",
        )

        return Response({"success": True, "session": serialize_session(session)})


class SessionRejectView(APIView):
    def post(self, request, session_id):
        try:
            session = Session.objects.prefetch_related("chat_messages").get(pk=session_id)
        except Session.DoesNotExist:
            return Response({"error": "Session not found"}, status=status.HTTP_404_NOT_FOUND)

        session.status = "cancelled"
        session.save()

        WebRTCSignal.objects.filter(session=session).delete()

        client_profile = getattr(session.client, "profile", None) or get_default_client_profile()
        balance = get_wallet_balance()
        if client_profile and not is_institutional_client(client_profile):
            balance = get_wallet_balance() + float(session.cost)
            set_wallet_balance(balance)

            Transaction.objects.create(
                id=new_tx_id("tx_ref"),
                user=client_profile.user,
                user_name=client_profile.user.get_full_name(),
                type="refund",
                amount=session.cost,
                status="completed",
                reference=f"REFUND-{session.id}",
            )

        ChatMessage.objects.create(
            session=session,
            sender_role="system",
            sender_name="System",
            text="Call declined or cancelled by party. Reserved funds refunded.",
        )

        log_action(
            f"Call session {session_id} rejected. Retainer of {session.cost} ETB refunded.",
            "system",
            "Processor",
            "warning",
        )

        return Response({"success": True, "session": serialize_session(session), "balance": balance})


class SessionChatView(APIView):
    def post(self, request, session_id):
        try:
            session = Session.objects.prefetch_related("chat_messages").get(pk=session_id)
        except Session.DoesNotExist:
            return Response({"error": "Session not found"}, status=status.HTTP_404_NOT_FOUND)

        sender_role = request.data.get("senderRole", "client")
        sender_name = request.data.get("senderName", "User")
        text = request.data.get("text", "")
        translated_text = request.data.get("translatedText", "")

        if not translated_text and session.service_mode in ("AI", "Both"):
            translated_text = gemini.translate_text(
                text,
                session.language_from,
                session.language_to,
                context=session.service_type,
            )

        message = ChatMessage.objects.create(
            session=session,
            sender_role=sender_role,
            sender_name=sender_name,
            text=text,
            translated_text=translated_text,
        )

        session.transcript = (session.transcript or []) + [
            f"{sender_name}: {text} ({translated_text})" if translated_text else f"{sender_name}: {text}"
        ]
        session.save(update_fields=["transcript"])

        if session.service_mode == "AI" and sender_role == "client":
            reply = gemini.ai_interpreter_reply(text, session.language_from, session.language_to, translated_text)
            ai_msg = ChatMessage.objects.create(
                session=session,
                sender_role="interpreter",
                sender_name="ORZO AI Interpreter",
                text=reply.get("replyText", ""),
                translated_text=reply.get("replyTranslation", ""),
            )
            session.transcript.append(
                f"ORZO AI Interpreter: {ai_msg.text} ({ai_msg.translated_text})"
            )
            session.save(update_fields=["transcript"])

        return Response(
            {
                "success": True,
                "message": serialize_chat_message(message),
                "session": serialize_session(session),
            }
        )


class SessionCompleteView(APIView):
    def post(self, request, session_id):
        try:
            session = Session.objects.select_related("interpreter__profile", "client__profile").prefetch_related(
                "chat_messages"
            ).get(pk=session_id)
        except Session.DoesNotExist:
            return Response({"error": "Session not found"}, status=status.HTTP_404_NOT_FOUND)

        duration = request.data.get("durationSeconds")
        rating = request.data.get("rating")
        review = request.data.get("review", "")
        transcript = request.data.get("transcript")
        summary = request.data.get("summary", "")

        was_completed = session.status == "completed"
        session.status = "completed"
        session.duration_seconds = int(duration) if duration else max(session.duration_seconds, 400)
        if rating is not None:
            session.rating_by_client = int(rating)
        if "review" in request.data:
            session.review_by_client = review
        if transcript:
            session.transcript = transcript
        if summary:
            session.summary = summary
        elif session.transcript:
            summary_data = gemini.summarize_session_transcript(session.transcript)
            session.summary = summary_data.get("summary", "")

        hourly_rate = Decimal("40")
        if session.interpreter and hasattr(session.interpreter, "profile"):
            hourly_rate = session.interpreter.profile.hourly_rate
            if not was_completed:
                session.interpreter.profile.completed_sessions += 1
                session.interpreter.profile.save(update_fields=["completed_sessions"])

        hours = Decimal(session.duration_seconds) / Decimal(3600)
        computed_cost = float((hours * hourly_rate).quantize(Decimal("0.01")))
        if session.cost == 0:
            session.cost = Decimal(str(computed_cost))

        session.save()

        client_profile = getattr(session.client, "profile", None) or get_default_client_profile()
        balance = get_wallet_balance()
        if not was_completed and client_profile and not is_institutional_client(client_profile):
            balance = get_wallet_balance() - float(session.cost)
            set_wallet_balance(max(balance, 0))

            Transaction.objects.create(
                id=new_tx_id("tx_pay"),
                user=client_profile.user,
                user_name=client_profile.user.get_full_name(),
                type="payment",
                amount=session.cost,
                status="completed",
                reference=f"SESS-{session.id}-PAY",
            )

        if not was_completed and session.interpreter and hasattr(session.interpreter, "profile"):
            payout_amount = (session.cost * Decimal("0.85")).quantize(Decimal("0.01"))
            Transaction.objects.create(
                id=new_tx_id("tx"),
                user=session.interpreter,
                user_name=session.interpreter_name,
                type="payout",
                amount=payout_amount,
                status="completed",
                reference=f"REVENUE-{session.id}",
            )
            log_action(
                f"Payout credited to {session.interpreter_name} for session {session.id}.",
                "system",
                "Processor",
                "success",
            )

        log_action(
            f"Session {session.id} marked completed.",
            "client",
            session.client_name,
            "success",
        )

        return Response(
            {
                "success": True,
                "session": serialize_session(session),
                "clientWalletBalance": get_wallet_balance(),
            }
        )


class SessionInterveneView(APIView):
    def post(self, request, session_id):
        try:
            session = Session.objects.prefetch_related("chat_messages").get(pk=session_id)
        except Session.DoesNotExist:
            return Response({"error": "Session not found"}, status=status.HTTP_404_NOT_FOUND)

        session.status = "cancelled"
        session.emergency_triggered = True
        session.save()

        ChatMessage.objects.create(
            session=session,
            sender_role="system",
            sender_name="System",
            text="⚠️ Emergency Intervention: Session disconnected by Admin safety override.",
        )

        log_action(
            f"Admin intervened in session {session_id} and force terminated connection",
            "admin",
            "Almaz Kebede",
            "danger",
        )

        return Response({"success": True, "session": serialize_session(session)})


class WalletDepositView(APIView):
    def post(self, request):
        client_id = request.data.get("clientId")
        client_profile, client_error = resolve_client_profile(client_id)
        if client_error:
            return Response({"error": client_error}, status=status.HTTP_400_BAD_REQUEST)
        if client_profile and is_institutional_client(client_profile):
            return Response(
                {"error": "Institutional accounts use offline billing. Wallet top-up is not available."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        amount = request.data.get("amount")
        reference = request.data.get("reference")
        try:
            parsed = Decimal(str(amount))
        except Exception:
            return Response({"error": "Invalid deposit amount"}, status=status.HTTP_400_BAD_REQUEST)

        if parsed <= 0:
            return Response({"error": "Invalid deposit amount"}, status=status.HTTP_400_BAD_REQUEST)

        balance = get_wallet_balance() + float(parsed)
        set_wallet_balance(balance)

        if not client_profile:
            client_profile = get_default_client_profile()
        ref = reference or f"CHP-{random.randint(100000, 999999)}"
        txn = Transaction.objects.create(
            id=new_tx_id("tx_dep"),
            user=client_profile.user,
            user_name=client_profile.user.get_full_name(),
            type="deposit",
            amount=parsed,
            status="completed",
            reference=ref,
        )

        log_action(
            f"Wallet deposit completed. Amount: {parsed} ETB",
            "client",
            client_profile.user.get_full_name(),
            "success",
        )

        return Response(
            {
                "success": True,
                "amount": float(parsed),
                "balance": balance,
                "transaction": serialize_transaction(txn),
            }
        )


class WalletPayoutView(APIView):
    def post(self, request):
        user_id = request.data.get("userId") or request.data.get("interpreterId")
        amount = request.data.get("amount", 0)
        profile = get_profile_by_external_id(user_id) if user_id else None

        if not profile:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            parsed = Decimal(str(amount))
        except Exception:
            parsed = Decimal("0")

        txn = Transaction.objects.create(
            id=new_tx_id("tx"),
            user=profile.user,
            user_name=profile.user.get_full_name(),
            type="payout",
            amount=parsed,
            status="pending",
            reference=f"PAY-{random.randint(100000, 999999)}",
        )

        log_action(
            f"Payout request of {parsed} ETB created for {profile.user.get_full_name()}",
            "interpreter",
            profile.user.get_full_name(),
            "warning",
        )

        return Response({"success": True, "amount": float(parsed), "transaction": serialize_transaction(txn)})


class ContractCreateView(APIView):
    def post(self, request):
        organization_name = request.data.get("organizationName", "").strip()
        if not organization_name:
            return Response({"error": "Organization Name is required"}, status=status.HTTP_400_BAD_REQUEST)

        duration = request.data.get("duration", "monthly")
        duration_days = request.data.get("durationDays")
        if duration_days is not None:
            days = int(duration_days)
        elif duration == "quarterly":
            days = 90
        elif duration == "half-year":
            days = 180
        elif duration == "yearly":
            days = 365
        else:
            days = 30

        code_safe = "".join(c if c.isalnum() else "-" for c in organization_name)[:8].upper()
        contract_id = f"ELLIOT-CON-{code_safe}-{random.randint(1000, 9999)}"
        now = timezone.now()

        contract = ContractDetails.objects.create(
            contract_id=contract_id,
            organization_name=organization_name,
            signed_date=now,
            expiry_date=now + timezone.timedelta(days=days),
            sla_level=request.data.get("slaLevel", "Tier-1 Gold SLA"),
            billing_code=request.data.get("billingCode") or f"{code_safe}-{random.randint(100, 999)}",
            max_concurrent_sessions=int(request.data.get("maxConcurrentSessions", 5)),
            status="active",
        )

        state = AppState.get()
        state.active_contract_id = contract_id
        state.save(update_fields=["active_contract_id"])

        log_action(
            f"New SLA Contract created for {organization_name}",
            "admin",
            "Almaz Kebede",
            "success",
        )

        return Response(
            {
                "success": True,
                "contract": serialize_contract(contract),
                "contractDetails": serialize_contract(contract),
                "contractsList": [serialize_contract(c) for c in ContractDetails.objects.all()],
                "activeContractId": contract_id,
            }
        )


class ContractSelectView(APIView):
    def post(self, request):
        contract_id = request.data.get("contractId")
        if not contract_id:
            return Response({"error": "contractId is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            contract = ContractDetails.objects.get(contract_id=contract_id)
        except ContractDetails.DoesNotExist:
            return Response({"error": "SLA Contract not found"}, status=status.HTTP_404_NOT_FOUND)

        state = AppState.get()
        state.active_contract_id = contract_id
        state.save(update_fields=["active_contract_id"])

        contract.refresh_status()
        contract.save(update_fields=["status"])

        log_action(
            f"Active corporate account switched to {contract.organization_name}",
            "client",
            "Dawit Yohannes",
        )

        return Response(
            {
                "success": True,
                "activeContractId": contract_id,
                "contract": serialize_contract(contract),
                "contractDetails": serialize_contract(contract),
                "contractsList": [serialize_contract(c) for c in ContractDetails.objects.all()],
            }
        )


class ContractExtendView(APIView):
    def post(self, request):
        contract_id = request.data.get("contractId") or AppState.get().active_contract_id
        try:
            contract = ContractDetails.objects.get(contract_id=contract_id)
        except ContractDetails.DoesNotExist:
            return Response({"error": "SLA Contract not found"}, status=status.HTTP_404_NOT_FOUND)

        days = request.data.get("days", 30)
        try:
            parsed_days = int(days)
        except (TypeError, ValueError):
            parsed_days = 30

        if parsed_days != 0:
            contract.expiry_date = contract.expiry_date + timezone.timedelta(days=parsed_days)

        if request.data.get("billingCode"):
            contract.billing_code = request.data["billingCode"]
        if request.data.get("organizationName"):
            contract.organization_name = request.data["organizationName"]
        if request.data.get("slaLevel"):
            contract.sla_level = request.data["slaLevel"]

        contract.refresh_status()
        contract.save()

        log_action(
            f"SLA Contract for {contract.organization_name} updated. Status: {contract.status.upper()}",
            "admin",
            "Almaz Kebede",
            "success",
        )

        return Response(
            {
                "success": True,
                "contract": serialize_contract(contract),
                "contractDetails": serialize_contract(contract),
                "contractsList": [serialize_contract(c) for c in ContractDetails.objects.all()],
            }
        )


class UserUpdateView(APIView):
    def post(self, request, user_id):
        profile = get_profile_by_external_id(user_id)
        if not profile:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        if "status" in request.data:
            profile.status = request.data["status"]
        if "hourlyRate" in request.data:
            profile.hourly_rate = Decimal(str(request.data["hourlyRate"]))
        if "languages" in request.data:
            profile.languages = request.data["languages"]
        if "name" in request.data:
            parts = request.data["name"].split(" ", 1)
            profile.user.first_name = parts[0]
            profile.user.last_name = parts[1] if len(parts) > 1 else ""
            profile.user.save()

        profile.save()
        log_action(
            f"User metadata modified for: {profile.user.get_full_name()}",
            "admin",
            "Almaz Kebede",
            "warning",
        )

        return Response({"success": True, "user": serialize_user(profile)})


class InterpreterCreateView(APIView):
    """Admin-only endpoint to register a new interpreter account."""

    def post(self, request):
        name = (request.data.get("name") or "").strip()
        email = (request.data.get("email") or "").strip()
        password = request.data.get("password") or "demo1234"
        languages = request.data.get("languages") or []
        hourly_rate = request.data.get("hourlyRate", 40)
        avatar = (request.data.get("avatar") or "").strip()
        account_status = request.data.get("status") or "active"

        if not name:
            return Response({"error": "Interpreter name is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not email:
            return Response({"error": "Email address is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not languages or not isinstance(languages, list):
            return Response(
                {"error": "Select at least one accredited language."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(email__iexact=email).exists():
            return Response({"error": "An account with this email already exists."}, status=status.HTTP_409_CONFLICT)

        try:
            parsed_rate = Decimal(str(hourly_rate))
        except (TypeError, ValueError):
            parsed_rate = Decimal("40")

        if account_status not in ("active", "pending", "suspended"):
            account_status = "active"

        external_id = new_id("usr_int")
        while Profile.objects.filter(external_id=external_id).exists():
            external_id = new_id("usr_int")

        parts = name.split(" ", 1)
        user = User.objects.create_user(
            username=external_id,
            email=email,
            password=password,
            first_name=parts[0],
            last_name=parts[1] if len(parts) > 1 else "",
        )

        profile = Profile.objects.create(
            user=user,
            external_id=external_id,
            role="interpreter",
            status=account_status,
            languages=[lang for lang in languages if isinstance(lang, str) and lang.strip()],
            hourly_rate=parsed_rate,
            avatar=avatar,
            provisioned_password=password,
        )

        admin_name = (request.data.get("adminName") or "Administrator").strip()
        log_action(
            f"New interpreter registered: {user.get_full_name()} ({', '.join(profile.languages)})",
            "admin",
            admin_name,
            "success",
        )

        return Response(
            {
                "success": True,
                "user": serialize_user(profile),
                "temporaryPassword": password if password == "demo1234" else None,
            },
            status=status.HTTP_201_CREATED,
        )


class ClientCreateView(APIView):
    """Admin-only endpoint to register an institution primary or staff client account."""

    def post(self, request):
        name = (request.data.get("name") or "").strip()
        email = (request.data.get("email") or "").strip()
        password = request.data.get("password") or "demo1234"
        contract_id = (request.data.get("contractId") or "").strip()
        is_primary = bool(request.data.get("isInstitutionPrimary"))
        account_status = request.data.get("status") or "active"

        if not name:
            return Response({"error": "Client name is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not email:
            return Response({"error": "Email address is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not contract_id:
            return Response({"error": "Institution contract is required."}, status=status.HTTP_400_BAD_REQUEST)

        contract = ContractDetails.objects.filter(contract_id=contract_id).first()
        if not contract:
            return Response({"error": "Institution contract not found."}, status=status.HTTP_404_NOT_FOUND)

        contract.refresh_status()
        contract.save(update_fields=["status"])
        if contract.status == "expired":
            return Response(
                {"error": "Cannot create client for an expired institution contract."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if is_primary and Profile.objects.filter(
            contract=contract, role="client", is_institution_primary=True
        ).exists():
            return Response(
                {"error": "A primary org account already exists for this institution."},
                status=status.HTTP_409_CONFLICT,
            )

        if User.objects.filter(email__iexact=email).exists():
            return Response({"error": "An account with this email already exists."}, status=status.HTTP_409_CONFLICT)

        if account_status not in ("active", "pending", "suspended"):
            account_status = "active"

        external_id = new_id("usr_client")
        while Profile.objects.filter(external_id=external_id).exists():
            external_id = new_id("usr_client")

        parts = name.split(" ", 1)
        user = User.objects.create_user(
            username=external_id,
            email=email,
            password=password,
            first_name=parts[0],
            last_name=parts[1] if len(parts) > 1 else "",
        )

        profile = Profile.objects.create(
            user=user,
            external_id=external_id,
            role="client",
            status=account_status,
            contract=contract,
            is_institution_primary=is_primary,
            provisioned_password=password,
        )

        admin_name = (request.data.get("adminName") or "Administrator").strip()
        account_label = "primary org" if is_primary else "staff"
        log_action(
            f"New institution {account_label} client registered: {user.get_full_name()} ({contract.organization_name})",
            "admin",
            admin_name,
            "success",
        )

        profile = Profile.objects.select_related("user", "contract").get(pk=profile.pk)
        return Response(
            {
                "success": True,
                "user": serialize_user(profile),
                "temporaryPassword": password if password == "demo1234" else None,
            },
            status=status.HTTP_201_CREATED,
        )


class InstitutionClientsListView(APIView):
    """Admin-only listing of client accounts under one institution contract."""

    def get(self, request, contract_id):
        contract = ContractDetails.objects.filter(contract_id=contract_id).first()
        if not contract:
            return Response({"error": "Contract not found"}, status=status.HTTP_404_NOT_FOUND)

        profiles = Profile.objects.filter(contract=contract, role="client").select_related("user", "contract")
        return Response({"clients": [serialize_user(p) for p in profiles]})


class SchedulerUpdateView(APIView):
    def post(self, request):
        user_id = request.data.get("userId")
        day = request.data.get("day")
        slots = request.data.get("slots", [])

        profile = get_profile_by_external_id(user_id)
        if not profile:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        avail, _ = InterpreterAvailability.objects.update_or_create(
            interpreter=profile.user,
            day=day,
            defaults={"slots": slots},
        )

        return Response(
            {
                "success": True,
                "availabilities": [
                    serialize_availability(a)
                    for a in InterpreterAvailability.objects.select_related("interpreter__profile").all()
                ],
            }
        )


class GeminiTranslateView(APIView):
    def post(self, request):
        text = request.data.get("text")
        from_lang = request.data.get("fromLang") or request.data.get("fromLanguage")
        to_lang = request.data.get("toLang") or request.data.get("toLanguage")
        context = request.data.get("context", "")

        if not text or not from_lang or not to_lang:
            return Response({"error": "Missing required translate parameters."}, status=status.HTTP_400_BAD_REQUEST)

        translated = gemini.translate_text(text, from_lang, to_lang, context)
        return Response({"translated": translated, "translatedText": translated})


class GeminiSpeechCaptionView(APIView):
    def post(self, request):
        service_type = request.data.get("serviceType") or request.data.get("audioSampleType", "general")
        from_lang = request.data.get("languageFrom", "English")
        to_lang = request.data.get("languageTo") or request.data.get("targetLanguage", "Amharic")

        captions = gemini.get_speech_caption(from_lang, to_lang, service_type)
        if len(captions) == 1:
            return Response({"caption": captions[0], "captions": captions})
        return Response({"captions": captions})


class GeminiSessionSummaryView(APIView):
    def post(self, request):
        transcript = request.data.get("transcript", [])
        if not transcript:
            return Response({"error": "No transcript provided."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(gemini.summarize_session_transcript(transcript))


class GeminiSmartMatchView(APIView):
    def post(self, request):
        language_from = request.data.get("languageFrom") or request.data.get("clientLang", "Amharic")
        language_to = request.data.get("languageTo", "English")
        service_type = request.data.get("serviceType", "general")
        urgency = request.data.get("urgency", "immediate")
        sla_level = request.data.get("slaLevel", "")

        profiles = [serialize_user(p) for p in Profile.objects.select_related("user").filter(role="interpreter")]
        result = gemini.smart_match_interpreter(
            language_from,
            language_to,
            profiles,
            service_type=service_type,
            urgency=urgency,
            sla_level=sla_level,
        )

        matched_id = result.get("recommendedInterpreterId", "")
        matched_profile = get_profile_by_external_id(matched_id) if matched_id else None
        payload = dict(result)
        if matched_profile:
            payload["matchedInterpreter"] = serialize_user(matched_profile)
        return Response(payload)


class OrzoTranslateView(APIView):
    def post(self, request):
        text = request.data.get("text")
        from_lang = request.data.get("fromLang")
        to_lang = request.data.get("toLang")
        if not text or not from_lang or not to_lang:
            return Response({"error": "Missing required parameters."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(gemini.orzo_translate(text, from_lang, to_lang))


class OrzoChatView(APIView):
    def post(self, request):
        message = request.data.get("message")
        if not message:
            return Response({"error": "No message parameter provided"}, status=status.HTTP_400_BAD_REQUEST)
        context = request.data.get("context")
        return Response(gemini.orzo_chat(message, context))


class WebRTCSignalPostView(APIView):
    """Store SDP offers/answers and ICE candidates for peer connection setup."""

    def post(self, request, session_id):
        try:
            session = Session.objects.get(pk=session_id)
        except Session.DoesNotExist:
            return Response({"error": "Session not found"}, status=status.HTTP_404_NOT_FOUND)

        sender_role = request.data.get("senderRole")
        signal_type = request.data.get("signalType")
        payload = request.data.get("payload")

        if sender_role not in ("client", "interpreter"):
            return Response({"error": "Invalid senderRole."}, status=status.HTTP_400_BAD_REQUEST)
        if signal_type not in ("offer", "answer", "ice", "hangup"):
            return Response({"error": "Invalid signalType."}, status=status.HTTP_400_BAD_REQUEST)
        if payload is None:
            return Response({"error": "Missing payload."}, status=status.HTTP_400_BAD_REQUEST)

        if signal_type == "offer":
            WebRTCSignal.objects.filter(session=session, signal_type="offer").delete()
        elif signal_type == "answer":
            WebRTCSignal.objects.filter(
                session=session, signal_type="answer", sender_role=sender_role
            ).delete()

        signal = WebRTCSignal.objects.create(
            session=session,
            sender_role=sender_role,
            signal_type=signal_type,
            payload=payload,
        )

        return Response(
            {
                "success": True,
                "signal": {
                    "id": signal.id,
                    "senderRole": signal.sender_role,
                    "signalType": signal.signal_type,
                    "payload": signal.payload,
                    "createdAt": signal.created_at.isoformat(),
                },
            }
        )


class WebRTCSignalPollView(APIView):
    """Poll signaling messages from the remote peer."""

    def get(self, request, session_id):
        try:
            Session.objects.get(pk=session_id)
        except Session.DoesNotExist:
            return Response({"error": "Session not found"}, status=status.HTTP_404_NOT_FOUND)

        peer = request.query_params.get("peer")
        since = request.query_params.get("since", "")

        if peer not in ("client", "interpreter"):
            return Response({"error": "Query param 'peer' must be client or interpreter."}, status=status.HTTP_400_BAD_REQUEST)

        qs = WebRTCSignal.objects.filter(session_id=session_id, sender_role=peer)
        if since:
            try:
                since_dt = timezone.datetime.fromisoformat(since.replace("Z", "+00:00"))
                if timezone.is_naive(since_dt):
                    since_dt = timezone.make_aware(since_dt)
                qs = qs.filter(created_at__gt=since_dt)
            except ValueError:
                pass

        signals = [
            {
                "id": s.id,
                "senderRole": s.sender_role,
                "signalType": s.signal_type,
                "payload": s.payload,
                "createdAt": s.created_at.isoformat(),
            }
            for s in qs.order_by("created_at")[:100]
        ]

        return Response({"signals": signals})


class WebRTCSignalClearView(APIView):
    def delete(self, request, session_id):
        WebRTCSignal.objects.filter(session_id=session_id).delete()
        return Response({"success": True})
