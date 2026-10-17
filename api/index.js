// Vercel Node function (framework detection is off — see vercel.json "framework": null).
// Static files come from web/; unmatched routes rewrite here after `npm run build` emits dist/.
import { app } from "../dist/vercel.js";

const handle = (request) => app.fetch(request);

export default handle;
export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
