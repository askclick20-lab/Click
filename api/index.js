// Vercel function: non-static paths rewrite here (see vercel.json).
// Built app lives in dist/ (npm run build). hono/vercel import is required for Vercel's Hono builder.
import { handle } from "hono/vercel";
import { app } from "../dist/vercel.js";

export default handle(app);
