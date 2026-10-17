/**
 * On Vercel, serverless functions live under `/api/*`.
 * Top-level Hono routes (`/chat`, `/health`, `/models`) are rewritten to `/api/chat` etc.;
 * discovery routes (`/api/pulse`, `/api/lookup`, …) already match and must keep their prefix.
 */
const TOP_LEVEL = new Set(["chat", "health", "models"]);

export function withOriginalPath(request: Request): Request {
  const url = new URL(request.url);
  const passed = url.searchParams.get("__clickPath");
  if (passed !== null) {
    url.pathname = passed.startsWith("/") ? passed : `/${passed}`;
    url.searchParams.delete("__clickPath");
    return new Request(url, request);
  }

  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts[0] === "api" && parts[1] && TOP_LEVEL.has(parts[1])) {
    url.pathname = "/" + parts.slice(1).join("/");
    return new Request(url, request);
  }
  return request;
}
