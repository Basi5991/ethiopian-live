from django.db import migrations, models

import api.models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0004_profile_provisioned_password"),
    ]

    operations = [
        migrations.AlterField(
            model_name="webrtcsignal",
            name="id",
            field=models.CharField(
                default=api.models.new_webrtc_signal_id,
                max_length=64,
                primary_key=True,
                serialize=False,
            ),
        ),
    ]
