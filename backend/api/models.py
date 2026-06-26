import uuid

from django.contrib.auth.models import User
from django.db import models


class Profile(models.Model):
    ROLE_CHOICES = [
        ("admin", "Admin"),
        ("client", "Client"),
        ("interpreter", "Interpreter"),
    ]
    STATUS_CHOICES = [
        ("active", "Active"),
        ("suspended", "Suspended"),
        ("pending", "Pending"),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    external_id = models.CharField(max_length=64, unique=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    languages = models.JSONField(default=list, blank=True)
    rating = models.FloatField(default=5.0)
    completed_sessions = models.IntegerField(default=0)
    hourly_rate = models.DecimalField(max_digits=8, decimal_places=2, default=40.0)
    avatar = models.URLField(blank=True, default="")
    wallet_balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    def __str__(self):
        return f"{self.external_id} ({self.role})"


class AppState(models.Model):
    """Singleton row for global platform state."""

    client_wallet_balance = models.DecimalField(max_digits=12, decimal_places=2, default=2450.0)
    active_contract_id = models.CharField(max_length=128, blank=True, default="")

    class Meta:
        verbose_name_plural = "App state"

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class ContractDetails(models.Model):
    STATUS_CHOICES = [
        ("active", "Active"),
        ("expired", "Expired"),
    ]

    contract_id = models.CharField(max_length=128, primary_key=True)
    organization_name = models.CharField(max_length=255)
    signed_date = models.DateTimeField()
    expiry_date = models.DateTimeField()
    sla_level = models.CharField(max_length=255)
    billing_code = models.CharField(max_length=128)
    max_concurrent_sessions = models.IntegerField(default=5)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")

    def refresh_status(self):
        from django.utils import timezone

        expired = self.expiry_date < timezone.now()
        self.status = "expired" if expired else "active"
        return self.status


class Session(models.Model):
    SERVICE_TYPE_CHOICES = [
        ("medical", "Medical"),
        ("legal", "Legal"),
        ("business", "Business"),
        ("general", "General"),
    ]
    SERVICE_MODE_CHOICES = [
        ("AI", "AI"),
        ("Human", "Human"),
        ("Both", "Both"),
    ]
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("incoming", "Incoming"),
        ("active", "Active"),
        ("completed", "Completed"),
        ("cancelled", "Cancelled"),
        ("missed", "Missed"),
    ]

    id = models.CharField(max_length=64, primary_key=True)
    client = models.ForeignKey(User, on_delete=models.CASCADE, related_name="client_sessions")
    client_name = models.CharField(max_length=255)
    interpreter = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="interpreter_sessions"
    )
    interpreter_name = models.CharField(max_length=255, blank=True, default="")
    language_from = models.CharField(max_length=64)
    language_to = models.CharField(max_length=64)
    service_type = models.CharField(max_length=20, choices=SERVICE_TYPE_CHOICES, default="general")
    service_mode = models.CharField(max_length=10, choices=SERVICE_MODE_CHOICES, default="Human")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    scheduled_time = models.CharField(max_length=64, blank=True, default="instant")
    cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    duration_seconds = models.IntegerField(default=0)
    transcript = models.JSONField(default=list, blank=True)
    summary = models.TextField(blank=True, default="")
    rating_by_client = models.IntegerField(null=True, blank=True)
    review_by_client = models.TextField(blank=True, default="")
    emergency_triggered = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class ChatMessage(models.Model):
    SENDER_ROLE_CHOICES = [
        ("client", "Client"),
        ("interpreter", "Interpreter"),
        ("system", "System"),
    ]

    id = models.CharField(max_length=64, primary_key=True, default="")
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="chat_messages")
    sender_role = models.CharField(max_length=20, choices=SENDER_ROLE_CHOICES)
    sender_name = models.CharField(max_length=255)
    text = models.TextField()
    translated_text = models.TextField(blank=True, default="")
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["timestamp"]

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = f"msg_{uuid.uuid4().hex[:12]}"
        super().save(*args, **kwargs)


class Transaction(models.Model):
    TYPE_CHOICES = [
        ("deposit", "Deposit"),
        ("payment", "Payment"),
        ("payout", "Payout"),
        ("refund", "Refund"),
    ]
    STATUS_CHOICES = [
        ("completed", "Completed"),
        ("pending", "Pending"),
        ("failed", "Failed"),
    ]

    id = models.CharField(max_length=64, primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="transactions")
    user_name = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="completed")
    timestamp = models.DateTimeField(auto_now_add=True)
    reference = models.CharField(max_length=128)

    class Meta:
        ordering = ["-timestamp"]


class InterpreterAvailability(models.Model):
    interpreter = models.ForeignKey(User, on_delete=models.CASCADE, related_name="availabilities")
    day = models.CharField(max_length=20)
    slots = models.JSONField(default=list)

    class Meta:
        unique_together = ("interpreter", "day")
        verbose_name_plural = "Interpreter availabilities"


class WebRTCSignal(models.Model):
    SIGNAL_TYPE_CHOICES = [
        ("offer", "Offer"),
        ("answer", "Answer"),
        ("ice", "ICE Candidate"),
        ("hangup", "Hangup"),
    ]
    SENDER_ROLE_CHOICES = [
        ("client", "Client"),
        ("interpreter", "Interpreter"),
    ]

    id = models.CharField(max_length=64, primary_key=True, default="")
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="webrtc_signals")
    sender_role = models.CharField(max_length=20, choices=SENDER_ROLE_CHOICES)
    signal_type = models.CharField(max_length=20, choices=SIGNAL_TYPE_CHOICES)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = f"sig_{uuid.uuid4().hex[:12]}"
        super().save(*args, **kwargs)


class AuditLog(models.Model):
    STATUS_CHOICES = [
        ("info", "Info"),
        ("success", "Success"),
        ("warning", "Warning"),
        ("danger", "Danger"),
    ]

    id = models.CharField(max_length=64, primary_key=True)
    timestamp = models.DateTimeField(auto_now_add=True)
    action = models.CharField(max_length=512)
    user_role = models.CharField(max_length=64)
    user_name = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="info")

    class Meta:
        ordering = ["-timestamp"]
