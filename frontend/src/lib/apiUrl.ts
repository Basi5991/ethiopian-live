export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const explicitBase = import.meta.env.VITE_BACKEND_API_URL || import.meta.env.VITE_BACKEND_URL;

  if (explicitBase) {
    return `${String(explicitBase).replace(/\/$/, "")}${normalizedPath}`;
  }

  // Same-origin relative URLs in dev (via Vite proxy) avoid CORS failures on WebRTC POST.
  return normalizedPath;
}
