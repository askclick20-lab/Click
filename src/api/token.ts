import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../config/env.js";
import { rateLimitEnabled } from "../config/env.js";
import { validatePubkey } from "../solana/address.js";
import type { ClientRateLimiter } from "../security/rate-limit.js";
import { loadRadarBundle, loadTokenMarket, publicCache, SAFETY_DISCLAIMER, type Discovery } from "./discovery.js";
import { clientKey, tooManyRequests, type AppVariables } from "./http-guards.js";
import { onchainUnavailable } from "./onchain-stub.js";
import { readSafety, type SafetyReport } from "./safety.js";

const PER_MINUTE = 20;

export function tokenRoutes(env: Env, limiter: ClientRateLimiter, discovery: Discovery): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  const gated = (c: Context<{ Variables: AppVariables }>) => {
    if (!rateLimitEnabled(env)) return undefined;
    const verdict = limiter.take("discovery", clientKey(c, env), PER_MINUTE);
    if (!verdict.ok) return tooManyRequests(c, verdict.retryAfterMs);
    return undefined;
  };

  app.get("/api/token/:mint/safety", async (c) => {
    c.header("Cache-Control", "no-store");
    const check = validatePubkey(c.req.param("mint").trim());
    if (!check.ok) return c.json({ error: { kind: "validation", message: "Invalid token mint address." } }, 400);
    const limited = gated(c);
    if (limited) return limited;
    if (!env.ONCHAIN_ENABLED) return onchainUnavailable(c, env);
    const report = await readSafety(discovery, check.address, c.req.raw.signal);
    c.header("Cache-Control", publicCache(30));
    return c.json(report);
  });

  app.get("/api/compare", async (c) => {
    c.header("Cache-Control", "no-store");
    const a = validatePubkey((c.req.query("a") ?? "").trim());
    const b = validatePubkey((c.req.query("b") ?? "").trim());
    if (!a.ok || !b.ok) return c.json({ error: { kind: "validation", message: "Query params a and b must be valid Solana mints." } }, 400);
    const limited = gated(c);
    if (limited) return limited;
    const [left, right] = await Promise.all([side(discovery, a.address, c.req.raw.signal), side(discovery, b.address, c.req.raw.signal)]);
    c.header("Cache-Control", publicCache(30));
    return c.json({
      generatedAt: new Date(discovery.now()).toISOString(),
      a: left,
      b: right,
      disclaimer: SAFETY_DISCLAIMER,
    });
  });

  app.get("/api/radar", async (c) => {
    const limited = gated(c);
    if (limited) return limited;
    if (!env.MARKET_ENABLED) return c.json({ error: { kind: "unavailable", message: "Market data is turned off." } }, 503);
    const bundle = await loadRadarBundle(discovery, c.req.raw.signal);
    c.header("Cache-Control", publicCache(env.MARKET_TRENDING_TTL));
    return c.json({
      generatedAt: bundle.generatedAt,
      fetchedAt: bundle.fetchedAt,
      trending: bundle.trending,
      fresh: bundle.fresh,
      ok: bundle.ok,
      ...(bundle.stale ? { stale: bundle.stale } : {}),
    });
  });

  app.get("/api/launches", async (c) => {
    const limited = gated(c);
    if (limited) return limited;
    if (!env.MARKET_ENABLED) return c.json({ error: { kind: "unavailable", message: "Market data is turned off." } }, 503);
    const bundle = await loadRadarBundle(discovery, c.req.raw.signal);
    const launches = [];
    for (const row of bundle.fresh.slice(0, env.DISCOVERY_MAX_LAUNCHES)) {
      const mint = row.token?.address;
      let safety: SafetyReport | { unavailable: true; reason: string } = { unavailable: true, reason: "no mint on pool row" };
      if (mint && env.ONCHAIN_ENABLED) {
        try {
          safety = await readSafety(discovery, mint, c.req.raw.signal, { rows: [row] });
        } catch {
          safety = { unavailable: true, reason: "safety read failed" };
        }
      } else if (!env.ONCHAIN_ENABLED) {
        safety = { unavailable: true, reason: "on-chain data is turned off" };
      }
      launches.push({ pool: row, safety, disclaimer: SAFETY_DISCLAIMER });
    }
    c.header("Cache-Control", publicCache(env.MARKET_TRENDING_TTL));
    return c.json({ generatedAt: bundle.generatedAt, fetchedAt: bundle.fetchedAt, launches, ok: bundle.ok });
  });

  return app;
}

async function side(d: Discovery, mint: string, signal: AbortSignal) {
  const [market, safety] = await Promise.all([
    loadTokenMarket(d, mint, signal).catch((err) => ({ token: undefined, pools: [], notices: [String(err)], fetchedAt: undefined })),
    d.env.ONCHAIN_ENABLED
      ? readSafety(d, mint, signal).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
  const liq = market.pools.reduce((s, p) => s + (p.liquidityUsd ?? 0), 0);
  const holders = safety?.signals.find((s) => s.id === "holder_concentration");
  return {
    mint,
    token: market.token
      ? { address: market.token.address, name: market.token.name, symbol: market.token.symbol, priceUsd: market.token.priceUsd, liquidityUsd: market.token.liquidityUsd ?? liq }
      : { address: mint },
    liquidityUsd: liq || market.token?.liquidityUsd,
    pools: market.pools.map((p) => ({ address: p.address, name: p.name, dex: p.dex, liquidityUsd: p.liquidityUsd, volume24hUsd: p.volumeUsd.h24 })),
    holders: holders?.value ?? null,
    safety: safety ?? { unavailable: true, reason: "on-chain safety not available" },
    notices: market.notices,
    fetchedAt: market.fetchedAt,
  };
}
