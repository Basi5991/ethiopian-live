from django.contrib import admin

from .models import (
    AppState,
    AuditLog,
    ChatMessage,
    ContractDetails,
    InterpreterAvailability,
    Profile,
    Session,
    Transaction,
)

admin.site.register(Profile)
admin.site.register(AppState)
admin.site.register(ContractDetails)
admin.site.register(Session)
admin.site.register(ChatMessage)
admin.site.register(Transaction)
admin.site.register(InterpreterAvailability)
admin.site.register(AuditLog)
