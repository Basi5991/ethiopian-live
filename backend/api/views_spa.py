"""Serve the Vite-built React SPA from Django (production / Render)."""

from __future__ import annotations

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse
from django.views.static import serve


def spa_index(_request):
    index_path = settings.SPA_ROOT / "index.html"
    if not index_path.exists():
        return HttpResponse(
            "Frontend build missing. Run: cd frontend && npm run build:render",
            status=503,
            content_type="text/plain",
        )
    response = FileResponse(index_path.open("rb"), content_type="text/html")
    response["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response["Pragma"] = "no-cache"
    return response


def spa_asset(request, path: str):
    assets_root = settings.SPA_ROOT / "assets"
    if not assets_root.exists():
        raise Http404("Assets not built")
    return serve(request, path, document_root=assets_root)
