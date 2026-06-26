from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0002_webrtcsignal"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="contract",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="client_profiles",
                to="api.contractdetails",
            ),
        ),
        migrations.AddField(
            model_name="profile",
            name="is_institution_primary",
            field=models.BooleanField(default=False),
        ),
        migrations.AddIndex(
            model_name="profile",
            index=models.Index(fields=["contract", "role"], name="api_profile_contract_role_idx"),
        ),
    ]
