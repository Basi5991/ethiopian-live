from django.contrib import admin
from django.urls import include, path, re_path

from api.views_spa import spa_asset, spa_index

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("api.urls")),
    re_path(r"^assets/(?P<path>.*)$", spa_asset),
    re_path(r"^(?!api/|admin/|static/).*$", spa_index),
]
