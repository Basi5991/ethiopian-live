"""Seed demo users, sessions, and platform state for Terjuman.live."""

from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from api.models import (
    AppState,
    AuditLog,
    ChatMessage,
    ContractDetails,
    InterpreterAvailability,
    Profile,
    Session,
    Transaction,
)


DEMO_USERS = [
    {
        "external_id": "usr_admin1",
        "username": "usr_admin1",
        "email": "admin@elliot.live",
        "first_name": "Almaz",
        "last_name": "Kebede",
        "role": "admin",
        "avatar": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150",
    },
    {
        "external_id": "usr_client13",
        "username": "usr_client13",
        "email": "dawit@client.com",
        "first_name": "Dawit",
        "last_name": "Yohannes",
        "role": "client",
        "avatar": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150",
    },
    {
        "external_id": "usr_int1",
        "username": "usr_int1",
        "email": "bekele@oromo-interpret.com",
        "first_name": "Bekele",
        "last_name": "Megersa",
        "role": "interpreter",
        "languages": [
            {"language": "Afaan Oromo", "level": "Native"},
            {"language": "Afar", "level": "Conversational"},
            {"language": "Amharic", "level": "Fluent"},
            {"language": "English", "level": "Professional"},
        ],
        "rating": 4.9,
        "completed_sessions": 142,
        "hourly_rate": 45,
        "avatar": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150",
    },
    {
        "external_id": "usr_int2",
        "username": "usr_int2",
        "email": "haleema@somali-interpret.com",
        "first_name": "Haleema",
        "last_name": "Bashir",
        "role": "interpreter",
        "languages": [
            {"language": "Somali", "level": "Native"},
            {"language": "Amharic", "level": "Fluent"},
            {"language": "English", "level": "Conversational"},
        ],
        "rating": 4.8,
        "completed_sessions": 94,
        "hourly_rate": 40,
        "avatar": "https://images.unsplash.com/photo-1607746882042-944635dfe10e?w=150",
    },
    {
        "external_id": "usr_int3",
        "username": "usr_int3",
        "email": "yared@tigrinya-interpret.com",
        "first_name": "Yared",
        "last_name": "Girmay",
        "role": "interpreter",
        "languages": [
            {"language": "Tigrinya", "level": "Native"},
            {"language": "Amharic", "level": "Native"},
            {"language": "English", "level": "Fluent"},
        ],
        "rating": 4.7,
        "completed_sessions": 81,
        "hourly_rate": 35,
        "avatar": "https://images.unsplash.com/photo-1542909168-82c3e7fdca5c?w=150",
    },
    {
        "external_id": "usr_int4",
        "username": "usr_int4",
        "email": "selam@amharic-interpret.com",
        "first_name": "Selamawit",
        "last_name": "Tadesse",
        "role": "interpreter",
        "languages": [
            {"language": "Amharic", "level": "Native"},
            {"language": "English", "level": "Native"},
        ],
        "rating": 4.95,
        "completed_sessions": 310,
        "hourly_rate": 50,
        "avatar": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
    },
    {
        "external_id": "usr_int5",
        "username": "usr_int5",
        "email": "fatuma@somali-medical.et",
        "first_name": "Fatuma",
        "last_name": "Ali",
        "role": "interpreter",
        "languages": [
            {"language": "Somali", "level": "Native"},
            {"language": "Amharic", "level": "Conversational"},
            {"language": "English", "level": "Basic"},
        ],
        "rating": 4.6,
        "completed_sessions": 58,
        "hourly_rate": 32,
        "avatar": "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150",
    },
    {
        "external_id": "usr_int6",
        "username": "usr_int6",
        "email": "lemma@afar-interpret.et",
        "first_name": "Lemma",
        "last_name": "Hailu",
        "role": "interpreter",
        "languages": [
            {"language": "Afar", "level": "Native"},
            {"language": "Amharic", "level": "Conversational"},
            {"language": "Afaan Oromo", "level": "Basic"},
        ],
        "rating": 4.5,
        "completed_sessions": 47,
        "hourly_rate": 38,
        "avatar": "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150",
    },
]


class Command(BaseCommand):
    help = "Seed demo data for Terjuman.live"

    def add_arguments(self, parser):
        parser.add_argument(
            "--flush",
            action="store_true",
            help="Delete existing API data before seeding",
        )

    def handle(self, *args, **options):
        if options["flush"]:
            ChatMessage.objects.all().delete()
            Session.objects.all().delete()
            Transaction.objects.all().delete()
            InterpreterAvailability.objects.all().delete()
            AuditLog.objects.all().delete()
            ContractDetails.objects.all().delete()
            Profile.objects.all().delete()
            User.objects.filter(is_superuser=False).delete()
            self.stdout.write("Existing demo data cleared.")

        profiles = {}
        for item in DEMO_USERS:
            user, _ = User.objects.get_or_create(
                username=item["username"],
                defaults={
                    "email": item["email"],
                    "first_name": item["first_name"],
                    "last_name": item["last_name"],
                },
            )
            user.email = item["email"]
            user.first_name = item["first_name"]
            user.last_name = item["last_name"]
            user.set_password("demo1234")
            user.save()

            profile, _ = Profile.objects.update_or_create(
                user=user,
                defaults={
                    "external_id": item["external_id"],
                    "role": item["role"],
                    "status": "active",
                    "languages": item.get("languages", []),
                    "rating": item.get("rating", 5.0),
                    "completed_sessions": item.get("completed_sessions", 0),
                    "hourly_rate": item.get("hourly_rate", 40),
                    "avatar": item.get("avatar", ""),
                    "provisioned_password": "demo1234",
                },
            )
            if item["role"] == "interpreter":
                profile.languages = item.get("languages", [])
                profile.rating = item.get("rating", profile.rating)
                profile.completed_sessions = item.get("completed_sessions", profile.completed_sessions)
                profile.hourly_rate = item.get("hourly_rate", profile.hourly_rate)
                profile.avatar = item.get("avatar", profile.avatar)
                profile.provisioned_password = profile.provisioned_password or "demo1234"
                profile.save()
            profiles[item["external_id"]] = profile

        now = timezone.now()
        contracts = [
            ContractDetails(
                contract_id="ELLIOT-CON-MOH-2026",
                organization_name="Ethiopian Ministry of Health",
                signed_date=now - timedelta(days=30),
                expiry_date=now + timedelta(days=12),
                sla_level="Tier-1 Healthcare Gold SLA",
                billing_code="EMH-ADDIS-8898",
                max_concurrent_sessions=5,
                status="active",
            ),
            ContractDetails(
                contract_id="ELLIOT-CON-CBE-2026",
                organization_name="Commercial Bank of Ethiopia",
                signed_date=now - timedelta(days=5),
                expiry_date=now + timedelta(days=180),
                sla_level="Financial Core Tier-1 Gold",
                billing_code="CBE-DISPATCH-9922",
                max_concurrent_sessions=8,
                status="active",
            ),
            ContractDetails(
                contract_id="ELLIOT-CON-AAU-2026",
                organization_name="Addis Ababa University",
                signed_date=now - timedelta(days=15),
                expiry_date=now + timedelta(days=90),
                sla_level="Academic Silver SLA",
                billing_code="AAU-LANG-OFFICE",
                max_concurrent_sessions=3,
                status="active",
            ),
        ]
        for contract in contracts:
            ContractDetails.objects.update_or_create(
                contract_id=contract.contract_id,
                defaults={
                    "organization_name": contract.organization_name,
                    "signed_date": contract.signed_date,
                    "expiry_date": contract.expiry_date,
                    "sla_level": contract.sla_level,
                    "billing_code": contract.billing_code,
                    "max_concurrent_sessions": contract.max_concurrent_sessions,
                    "status": contract.status,
                },
            )

        moh_contract = ContractDetails.objects.get(contract_id="ELLIOT-CON-MOH-2026")
        moh_client = profiles["usr_client13"]
        moh_client.contract = moh_contract
        moh_client.is_institution_primary = True
        moh_client.save(update_fields=["contract", "is_institution_primary"])

        state = AppState.get()
        state.client_wallet_balance = 2450.0
        state.active_contract_id = "ELLIOT-CON-MOH-2026"
        state.save()

        client = profiles["usr_client13"].user
        interpreter = profiles["usr_int1"].user

        session, created = Session.objects.update_or_create(
            id="sess_1024",
            defaults={
                "client": client,
                "client_name": "Dawit Yohannes",
                "interpreter": interpreter,
                "interpreter_name": "Bekele Megersa",
                "language_from": "Amharic",
                "language_to": "Afaan Oromo",
                "service_type": "medical",
                "service_mode": "Both",
                "status": "completed",
                "scheduled_time": "2026-06-12T10:00:00Z",
                "cost": 22.5,
                "duration_seconds": 1800,
                "transcript": [
                    "Patient: ራስ ምታቴ በጣም ከባድ ነው። (My headache is very severe.)",
                    "Interpreter: Mata-bowbiin koo baay'ee cimaadha.",
                    "Doctor: How long has the patient had this fever?",
                ],
                "summary": "Medical consultation translation regarding severe headache and high body temperature.",
                "rating_by_client": 5,
                "review_by_client": "Amazing communication! Saved us during the consultation.",
            },
        )

        if created or not session.chat_messages.exists():
            ChatMessage.objects.filter(session=session).delete()
            ChatMessage.objects.bulk_create(
                [
                    ChatMessage(
                        id="msg_1",
                        session=session,
                        sender_role="system",
                        sender_name="System",
                        text="Session started. High quality audio ready.",
                    ),
                    ChatMessage(
                        id="msg_2",
                        session=session,
                        sender_role="client",
                        sender_name="Dawit Yohannes",
                        text="We need translations for clinical symptom reviews.",
                    ),
                    ChatMessage(
                        id="msg_3",
                        session=session,
                        sender_role="interpreter",
                        sender_name="Bekele Megersa",
                        text="Ready to assist the patient in Amharic and Afaan Oromo.",
                    ),
                ]
            )

        Transaction.objects.update_or_create(
            id="tx_ch99221",
            defaults={
                "user": client,
                "user_name": "Dawit Yohannes",
                "type": "deposit",
                "amount": 1500,
                "status": "completed",
                "reference": "CHP-MOCK-99221",
            },
        )
        Transaction.objects.update_or_create(
            id="tx_ch99222",
            defaults={
                "user": client,
                "user_name": "Dawit Yohannes",
                "type": "payment",
                "amount": 45,
                "status": "completed",
                "reference": "SESS-1024-PAY",
            },
        )
        Transaction.objects.update_or_create(
            id="tx_ch99223",
            defaults={
                "user": interpreter,
                "user_name": "Bekele Megersa",
                "type": "payout",
                "amount": 38.25,
                "status": "completed",
                "reference": "PAYOUT-INT1-930",
            },
        )

        availabilities = [
            ("usr_int1", "Monday", [{"start": "08:00", "end": "12:00", "recurring": True}, {"start": "14:00", "end": "18:00", "recurring": True}]),
            ("usr_int1", "Wednesday", [{"start": "09:00", "end": "17:00", "recurring": True}]),
            ("usr_int2", "Tuesday", [{"start": "10:00", "end": "16:00", "recurring": False}]),
            ("usr_int2", "Thursday", [{"start": "09:00", "end": "15:00", "recurring": True}]),
            ("usr_int3", "Thursday", [{"start": "08:30", "end": "12:30", "recurring": True}]),
            ("usr_int3", "Friday", [{"start": "13:00", "end": "17:00", "recurring": True}]),
            ("usr_int4", "Monday", [{"start": "07:00", "end": "11:00", "recurring": True}]),
            ("usr_int4", "Wednesday", [{"start": "07:00", "end": "11:00", "recurring": True}]),
            ("usr_int5", "Saturday", [{"start": "08:00", "end": "14:00", "recurring": True}]),
            ("usr_int6", "Wednesday", [{"start": "06:00", "end": "12:00", "recurring": True}]),
        ]
        for external_id, day, slots in availabilities:
            InterpreterAvailability.objects.update_or_create(
                interpreter=profiles[external_id].user,
                day=day,
                defaults={"slots": slots},
            )

        if not AuditLog.objects.exists():
            AuditLog.objects.bulk_create(
                [
                    AuditLog(
                        id="log_1",
                        action="Admin System Booted",
                        user_role="admin",
                        user_name="Almaz Kebede",
                        status="info",
                    ),
                    AuditLog(
                        id="log_2",
                        action="Client Balance Top-up (1500 ETB)",
                        user_role="client",
                        user_name="Dawit Yohannes",
                        status="success",
                    ),
                    AuditLog(
                        id="log_3",
                        action="Interpreter Selamawit Tadesse went Online",
                        user_role="interpreter",
                        user_name="Selamawit Tadesse",
                        status="info",
                    ),
                ]
            )

        self.stdout.write(self.style.SUCCESS("Demo data seeded successfully."))
