/**
 * Catch-all rewrites land on `/api/index`. Restore the browser path so `/chat`, `/health`, `/api/pulse`, …
 * still match Hono routes (Vercel may otherwise deliver the rewritten destination path).
 */
export function withOriginalPath(request: Request): Request {
  const url = new URL(request.url);
  const passed = url.searchParams.get("__clickPath");
  if (passed !== null) {
    url.pathname = passed.startsWith("/") ? passed : `/${passed}`;
    url.searchParams.delete("__clickPath");
    return new Request(url, request);
  }
  if (url.pathname === "/api/index" || url.pathname === "/api/index/") {
    const raw = request.headers.get("x-forwarded-uri") ?? request.headers.get("x-url") ?? "";
    const forwarded = raw.split("?")[0];
    if (forwarded && forwarded !== "/api/index" && forwarded !== "/api/index/") {
      url.pathname = forwarded.startsWith("/") ? forwarded : `/${forwarded}`;
      return new Request(url, request);
    }
  }
  return request;
}
