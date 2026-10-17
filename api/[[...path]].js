// Vercel catch-all: /api/pulse, /api/lookup, … and rewrites of /chat, /health, /models.
import { vercelFetch } from "../dist/vercel.js";

export const maxDuration = 300;
export const runtime = "nodejs";

export default vercelFetch;
export const GET = vercelFetch;
export const HEAD = vercelFetch;
export const POST = vercelFetch;
export const PUT = vercelFetch;
export const PATCH = vercelFetch;
export const DELETE = vercelFetch;
export const OPTIONS = vercelFetch;
