from django.db import migrations, models


def backfill_demo_passwords(apps, schema_editor):
    Profile = apps.get_model("api", "Profile")
    Profile.objects.filter(provisioned_password="").update(provisioned_password="demo1234")


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0003_profile_institution_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="provisioned_password",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
        migrations.RunPython(backfill_demo_passwords, migrations.RunPython.noop),
    ]
