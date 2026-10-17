import { Hono } from "hono";
import { createApp } from "./app.js";
import { loadEnv, productionProblems } from "./config/env.js";
import { createContainer } from "./container.js";
import { withOriginalPath } from "./vercel-path.js";

/**
 * Vercel entry: the same app as src/index.ts, as a fetch handler (no Node server, no .env file — settings
 * come from the project's environment variables). Static files are served by Vercel itself (vercel.json).
 */
function boot() {
  try {
    const env = loadEnv();
    const problems = productionProblems(env);
    if (problems.length) throw new Error(`Refusing to start in production: ${problems.join("; ")}`);
    return createApp(createContainer(env));
  } catch (err) {
    console.error(err);
    const fallback = new Hono();
    fallback.all("*", (c) =>
      c.json({ error: { kind: "internal", message: "Click is misconfigured on this host. Check Vercel environment variables." } }, 500),
    );
    return fallback;
  }
}

export const app = boot();
export { withOriginalPath };

export function vercelFetch(request: Request): Promise<Response> | Response {
  return app.fetch(withOriginalPath(request));
}
