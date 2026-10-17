import { Hono } from "hono";
import type { Env } from "../config/env.js";
import { rateLimitEnabled } from "../config/env.js";
import { solanaCluster } from "../config/solana.js";
import { explorerLinks } from "../providers/solana/explorer.js";
import type { Logger } from "../core/logger.js";
import { parsePool, type JsonApiResource, type PoolFacts } from "../providers/market/analysis.js";
import type { ClientRateLimiter } from "../security/rate-limit.js";
import { analysisCtx, cachedGet, createDiscovery, geckoGet, marketCtx, pulseHeadlines, publicCache, type Discovery } from "./discovery.js";
import { clientKey, tooManyRequests, type AppVariables } from "./http-guards.js";

const PER_MINUTE = 30;
export const PULSE_TTL_MS = 60_000;

export interface PulseSnapshot {
  generatedAt: string;
  chain: {
    ok: boolean;
    cluster?: string;
    slot?: number;
    estimatedTps?: number;
    explorerUrl?: string;
    fetchedAt?: string;
  };
  market: {
    ok: boolean;
    fetchedAt?: string;
    minLiquidityUsd: number;
    pools: {
      address: string;
      name?: string;
      dex?: string;
      priceUsd?: number;
      liquidityUsd?: number;
      volume24hUsd?: number;
      change24hPct?: number;
    }[];
  };
  news: { ok: boolean; headlines: { title: string; url: string; source: string; publishedAt?: string; fetchedAt: string }[] };
}

export function createPulse(env: Env, logger: Logger, opts: { now?: () => number; discovery?: Discovery } = {}) {
  const d = opts.discovery ?? createDiscovery(env, logger, { now: opts.now });
  return {
    get: (signal = new AbortController().signal) =>
      cachedGet(d.pulseCache as { at: number; inflight?: Promise<PulseSnapshot>; value?: PulseSnapshot }, PULSE_TTL_MS, d.now, () => loadPulse(d, signal)),
  };
}

async function loadPulse(d: Discovery, signal: AbortSignal): Promise<PulseSnapshot> {
  const generatedAt = new Date(d.now()).toISOString();
  const [chain, market, news] = await Promise.all([
    loadChain(d, signal),
    loadPools(d, signal),
    pulseHeadlines(d, signal),
  ]);
  return { generatedAt, chain, market, news: { ok: news.ok, headlines: news.items } };
}

async function loadChain(d: Discovery, signal: AbortSignal): Promise<PulseSnapshot["chain"]> {
  if (!d.env.ONCHAIN_ENABLED) return { ok: false };
  const ctx = analysisCtx(d, signal);
  try {
    const [slot, perf] = await Promise.all([
      ctx.rpc.getSlot(ctx.budget),
      ctx.rpc.getRecentPerformanceSamples(ctx.budget, 5).catch(() => undefined),
    ]);
    let estimatedTps: number | undefined;
    if (perf?.length) {
      const sample = perf[0]!;
      const secs = sample.samplePeriodSecs || 60;
      estimatedTps = Number((sample.numTransactions / secs).toFixed(2));
    }
    const cluster = solanaCluster(d.env);
    const explorerUrl = explorerLinks(cluster).block(slot);
    return {
      ok: true,
      cluster: cluster.cluster,
      slot,
      estimatedTps,
      ...(explorerUrl ? { explorerUrl } : {}),
      fetchedAt: new Date(d.now()).toISOString(),
    };
  } catch {
    return { ok: false };
  }
}

async function loadPools(d: Discovery, signal: AbortSignal): Promise<PulseSnapshot["market"]> {
  const min = d.env.MARKET_MIN_LIQUIDITY_USD;
  if (!d.env.MARKET_ENABLED) return { ok: false, minLiquidityUsd: min, pools: [] };
  const ctx = marketCtx(d, signal, 2);
  const net = encodeURIComponent(d.env.GECKOTERMINAL_NETWORK);
  const r = await geckoGet<{ data?: JsonApiResource[] }>(d, `/networks/${net}/pools`, "pools", ctx);
  const pools = (r?.body.data ?? [])
    .map((p) => parsePool(p, ctx.v, d.env.GECKOTERMINAL_NETWORK))
    .filter((p): p is PoolFacts => !!p && (p.liquidityUsd ?? 0) >= min)
    .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
    .slice(0, 8)
    .map((p) => ({
      address: p.address,
      name: p.name,
      dex: p.dex,
      ...(p.basePriceUsd !== undefined ? { priceUsd: p.basePriceUsd } : {}),
      liquidityUsd: p.liquidityUsd,
      volume24hUsd: p.volumeUsd.h24,
      change24hPct: p.priceChangePct.h24,
    }));
  return {
    ok: Boolean(r),
    fetchedAt: r ? new Date(r.fetchedAt).toISOString() : undefined,
    minLiquidityUsd: min,
    pools,
  };
}

export function pulseRoutes(env: Env, limiter: ClientRateLimiter, discovery: Discovery): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  const pulse = createPulse(env, discovery.logger, { discovery, now: discovery.now });
  app.get("/api/pulse", async (c) => {
    if (rateLimitEnabled(env)) {
      const verdict = limiter.take("discovery", clientKey(c, env), PER_MINUTE);
      if (!verdict.ok) return tooManyRequests(c, verdict.retryAfterMs);
    }
    const snap = await pulse.get(c.req.raw.signal);
    c.header("Cache-Control", publicCache(60));
    return c.json(snap);
  });
  return app;
}
