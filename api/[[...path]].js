// Vercel catch-all for /api/*. Compiled app is copied to api/_dist by `npm run vercel-build`.
export const maxDuration = 60;
export const runtime = "nodejs";

async function handle(request) {
  try {
    const { vercelFetch } = await import("./_dist/vercel.js");
    return await vercelFetch(request);
  } catch (err) {
    console.error("click boot", err);
    return new Response(JSON.stringify({ error: { kind: "internal", message: "Click server failed to load." } }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

export default handle;
export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
