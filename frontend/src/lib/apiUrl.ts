export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const explicitBase = import.meta.env.VITE_BACKEND_API_URL || import.meta.env.VITE_BACKEND_URL;

  if (explicitBase) {
    return `${String(explicitBase).replace(/\/$/, "")}${normalizedPath}`;
  }

  const host = window.location.hostname;
  const port = window.location.port;
  const isFrontendDevHost = (host === "localhost" || host === "127.0.0.1") && (port === "3000" || port === "5173");

  if (
    isFrontendDevHost &&
    (normalizedPath.startsWith("/api/init") || normalizedPath.startsWith("/api/sessions/"))
  ) {
    return `http://127.0.0.1:8000${normalizedPath}`;
  }

  return normalizedPath;
}
