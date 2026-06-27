from urllib.parse import urlparse

from channels.security.websocket import OriginValidator, WebsocketDenier
from django.conf import settings
from django.http.request import validate_host


class ProxyAwareOriginValidator:
    """
    Validate WebSocket Origin against ALLOWED_HOSTS, but fall back to the
    Host header when Origin is missing (common behind Render/Cloudflare).
    """

    def __init__(self, application):
        self.application = application
        self.origin_validator = OriginValidator(application, settings.ALLOWED_HOSTS)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "websocket":
            raise ValueError("ProxyAwareOriginValidator only supports WebSocket connections")

        parsed_origin = None
        host_header = ""
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"origin":
                try:
                    parsed_origin = urlparse(header_value.decode("latin1"))
                except UnicodeDecodeError:
                    parsed_origin = None
            elif header_name == b"host":
                host_header = header_value.decode("latin1").split(":")[0]

        if parsed_origin is not None and parsed_origin.hostname:
            return await self.origin_validator(scope, receive, send)

        if host_header and validate_host(host_header, settings.ALLOWED_HOSTS):
            return await self.application(scope, receive, send)

        denier = WebsocketDenier()
        return await denier(scope, receive, send)
