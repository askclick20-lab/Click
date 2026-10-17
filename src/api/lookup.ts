import { Hono } from "hono";
import type { Env } from "../config/env.js";
import { rateLimitEnabled } from "../config/env.js";
import { ClickError } from "../core/errors.js";
import { analyzeAddress, analyzeTokenMint, analyzeTransaction } from "../providers/solana/analysis.js";
import { classifyInput, validatePubkey, validateSignature } from "../solana/address.js";
import type { ClientRateLimiter } from "../security/rate-limit.js";
import { analysisCtx, publicCache, type Discovery } from "./discovery.js";
import { clientKey, tooManyRequests, type AppVariables } from "./http-guards.js";
import { onchainUnavailable } from "./onchain-stub.js";

const PER_MINUTE = 20;

export function lookupRoutes(env: Env, limiter: ClientRateLimiter, discovery: Discovery): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();

  app.get("/api/lookup/:id", async (c) => {
    c.header("Cache-Control", "no-store");
    const id = c.req.param("id").trim();
    const kind = classifyInput(id);
    if (kind === "unknown") {
      return c.json({ error: { kind: "validation", message: "Invalid Solana address or transaction signature." } }, 400);
    }
    if (rateLimitEnabled(env)) {
      const verdict = limiter.take("discovery", clientKey(c, env), PER_MINUTE);
      if (!verdict.ok) return tooManyRequests(c, verdict.retryAfterMs);
    }
    if (!env.ONCHAIN_ENABLED) return onchainUnavailable(c, env);
    try {
      const body = await runLookup(discovery, id, kind, c.req.raw.signal);
      c.header("Cache-Control", publicCache(15));
      return c.json(body);
    } catch (err) {
      if (err instanceof ClickError && err.kind === "not_found") {
        return c.json({ error: { kind: "not_found", message: "Transaction not found." } }, 404);
      }
      return c.json({ error: { kind: "upstream", message: "On-chain data could not be read." } }, 502);
    }
  });

  return app;
}

async function runLookup(d: Discovery, id: string, kind: "address" | "signature", signal: AbortSignal) {
  const ctx = analysisCtx(d, signal);
  if (kind === "signature") {
    const v = validateSignature(id);
    if (!v.ok) throw new ClickError("bad_request", "lookup", v.reason);
    const sections = await analyzeTransaction(v.address, ctx, false);
    return {
      kind: "signature" as const,
      id: v.address,
      generatedAt: new Date(d.now()).toISOString(),
      sections,
      notices: [...ctx.notices],
      dataSources: { rpc: ctx.rpcDown ? "unavailable" : "ok", helius: d.helius ? "ok" : "not configured" },
    };
  }
  const v = validatePubkey(id);
  if (!v.ok) throw new ClickError("bad_request", "lookup", v.reason);
  const info = await ctx.optionalRpc("account", () => ctx.rpc.getAccountInfo(v.address, ctx.budget));
  const parsedType = (info as { value?: { data?: { parsed?: { type?: string } }; owner?: string } } | undefined)?.value?.data?.parsed?.type;
  const sections = parsedType === "mint" ? await analyzeTokenMint(v.address, ctx) : await analyzeAddress(v.address, ctx);
  return {
    kind: "address" as const,
    id: v.address,
    generatedAt: new Date(d.now()).toISOString(),
    classification: parsedType === "mint" ? "token mint" : "account",
    sections,
    notices: [...ctx.notices],
    dataSources: { rpc: ctx.rpcDown ? "unavailable" : "ok", helius: d.helius ? "ok" : "not configured" },
  };
}
