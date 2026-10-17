import type { Env } from "../config/env.js";
import { loadFeeds } from "../config/feeds.js";
import { explorerLinks, solanaCluster } from "../config/solana.js";
import { toClickError } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import { geckoClientFor } from "../providers/market/client.js";
import {
  parsePool,
  parseToken,
  Validator,
  type JsonApiResource,
  type MarketContext,
  type PoolFacts,
  type TokenFacts,
} from "../providers/market/analysis.js";
import type { GeckoTerminalClient, MarketBudget } from "../providers/market/geckoterminal.js";
import { NewsStore } from "../providers/news/store.js";
import { AnalysisContext } from "../providers/solana/analysis.js";
import { heliusClientFor, rpcClientFor } from "../providers/solana/client.js";
import type { HeliusClient } from "../providers/solana/helius.js";
import type { SolanaRpcClient } from "../providers/solana/rpc.js";
import { createAnalysisBudget } from "../providers/solana/types.js";

export const SAFETY_DISCLAIMER = "These are data points, not a rating. New tokens are high risk. Not financial advice.";

const BONDING_CURVE_DEX = /pump-?fun|moonshot|letsbonk|launchlab|raydium-launch|boop|meteora-dbc|virtuals/i;

export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }
  private release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

export interface Cached<T> {
  at: number;
  inflight?: Promise<T>;
  value?: T;
}

export function cachedGet<T>(slot: Cached<T>, ttlMs: number, now: () => number, load: () => Promise<T>): Promise<T> {
  const t = now();
  if (slot.value !== undefined && t - slot.at < ttlMs) return Promise.resolve(slot.value);
  if (slot.inflight) return slot.inflight;
  slot.inflight = load()
    .then((value) => {
      slot.value = value;
      slot.at = now();
      return value;
    })
    .finally(() => {
      slot.inflight = undefined;
    });
  return slot.inflight;
}

export interface Discovery {
  env: Env;
  logger: Logger;
  now: () => number;
  gecko: GeckoTerminalClient;
  rpc: SolanaRpcClient;
  helius?: HeliusClient;
  news: NewsStore;
  safetyGate: Semaphore;
  pulseCache: Cached<unknown>;
  radarCache: Cached<RadarBundle>;
  safetyCache: Map<string, { at: number; value: unknown }>;
}

export function createDiscovery(env: Env, logger: Logger, opts: { now?: () => number } = {}): Discovery {
  return {
    env,
    logger,
    now: opts.now ?? (() => Date.now()),
    gecko: geckoClientFor(env),
    rpc: rpcClientFor(env),
    helius: heliusClientFor(env),
    news: new NewsStore(env),
    safetyGate: new Semaphore(Math.max(1, env.DISCOVERY_SAFETY_CONCURRENCY)),
    pulseCache: { at: 0 },
    radarCache: { at: 0 },
    safetyCache: new Map(),
  };
}

export function analysisCtx(d: Discovery, signal: AbortSignal): AnalysisContext {
  const cluster = solanaCluster(d.env);
  return new AnalysisContext(cluster, d.rpc, d.helius, createAnalysisBudget(signal, d.env), {
    maxTransactions: d.env.ONCHAIN_MAX_TRANSACTIONS,
    maxLogLines: Math.min(20, d.env.ONCHAIN_MAX_LOG_RESULTS),
    maxTokenAccounts: 40,
  });
}

export function marketCtx(d: Discovery, signal: AbortSignal, maxCalls = 8): MarketContext {
  const cluster = solanaCluster(d.env);
  const links = explorerLinks(cluster);
  return {
    client: d.gecko,
    network: d.env.GECKOTERMINAL_NETWORK,
    budget: { signal, calls: 0, maxCalls } satisfies MarketBudget,
    limits: {
      maxPools: d.env.MARKET_MAX_POOLS,
      maxTrades: d.env.MARKET_MAX_TRADES,
      ohlcvDays: d.env.MARKET_OHLCV_DAYS,
      minLiquidityUsd: d.env.MARKET_MIN_LIQUIDITY_USD,
      radarMinLiquidityUsd: d.env.MARKET_RADAR_MIN_LIQUIDITY_USD,
    },
    v: new Validator(),
    notices: new Set(),
    txLink: (h) => links.tx(h),
    citable: new Set(),
    freshness: {},
    results: { tokens: [], pools: [], candles: 0, trades: 0 },
  };
}

export async function geckoGet<T>(
  d: Discovery,
  path: string,
  ttl: "live" | "pools" | "meta" | "trending",
  ctx: MarketContext,
): Promise<{ body: T; fetchedAt: number; url: string; stale?: { reason: string } } | null | undefined> {
  if (!d.env.MARKET_ENABLED) return undefined;
  try {
    return await ctx.client.get<T>(path, ttl, ctx.budget);
  } catch (err) {
    const e = toClickError(err, "tool:geckoterminal");
    if (e.kind === "aborted") throw e;
    ctx.notices.add(`GeckoTerminal ${e.kind}`);
    return undefined;
  }
}

export interface RadarPoolRow {
  address: string;
  name?: string;
  dex?: string;
  createdAt?: string;
  liquidityUsd?: number;
  volume24hUsd?: number;
  change24hPct?: number;
  ageMs?: number;
  buys?: number;
  sells?: number;
  token?: { address: string; symbol?: string; name?: string; launchpad?: TokenFacts["launchpad"] };
  launchpadDex: boolean;
}

export interface RadarBundle {
  generatedAt: string;
  fetchedAt: string;
  trending: RadarPoolRow[];
  fresh: RadarPoolRow[];
  ok: boolean;
  stale?: string;
}

function toRow(p: PoolFacts, tokens: Map<string, TokenFacts>, now: number): RadarPoolRow {
  const token = (p.baseToken && tokens.get(p.baseToken)) || (p.quoteToken && tokens.get(p.quoteToken)) || undefined;
  const created = p.createdAt ? Date.parse(p.createdAt) : NaN;
  return {
    address: p.address,
    name: p.name,
    dex: p.dex,
    createdAt: p.createdAt,
    liquidityUsd: p.liquidityUsd,
    volume24hUsd: p.volumeUsd.h24,
    change24hPct: p.priceChangePct.h24,
    ageMs: Number.isFinite(created) ? Math.max(0, now - created) : undefined,
    buys: p.txns.h24?.buys,
    sells: p.txns.h24?.sells,
    ...(token ? { token: { address: token.address, symbol: token.symbol, name: token.name, launchpad: token.launchpad } } : {}),
    launchpadDex: BONDING_CURVE_DEX.test(p.dex ?? ""),
  };
}

export async function loadRadarBundle(d: Discovery, signal: AbortSignal): Promise<RadarBundle> {
  return cachedGet(d.radarCache, d.env.MARKET_TRENDING_TTL * 1000, d.now, async () => {
    const ctx = marketCtx(d, signal, 4);
    const net = encodeURIComponent(d.env.GECKOTERMINAL_NETWORK);
    const [trending, fresh] = await Promise.all([
      geckoGet<{ data?: JsonApiResource[]; included?: JsonApiResource[] }>(d, `/networks/${net}/trending_pools?include=base_token`, "trending", ctx),
      geckoGet<{ data?: JsonApiResource[]; included?: JsonApiResource[] }>(d, `/networks/${net}/new_pools?include=base_token`, "trending", ctx),
    ]);
    const tokens = new Map<string, TokenFacts>();
    for (const inc of [...(trending?.body.included ?? []), ...(fresh?.body.included ?? [])]) {
      if (inc.type !== "token") continue;
      const t = parseToken(inc, ctx.v, d.env.GECKOTERMINAL_NETWORK);
      if (t) tokens.set(t.address, t);
    }
    const parseList = (body?: JsonApiResource[], minLiq = 0) =>
      (body ?? [])
        .map((r) => parsePool(r, ctx.v, d.env.GECKOTERMINAL_NETWORK))
        .filter((p): p is PoolFacts => !!p && (p.liquidityUsd ?? 0) >= minLiq)
        .map((p) => toRow(p, tokens, d.now()));
    const fetchedAt = new Date(Math.min(trending?.fetchedAt ?? d.now(), fresh?.fetchedAt ?? d.now())).toISOString();
    const stale = trending?.stale?.reason ?? fresh?.stale?.reason;
    return {
      generatedAt: new Date(d.now()).toISOString(),
      fetchedAt,
      trending: parseList(trending?.body.data, d.env.MARKET_RADAR_MIN_LIQUIDITY_USD).slice(0, d.env.MARKET_MAX_POOLS * 2),
      fresh: parseList(fresh?.body.data, 0).slice(0, d.env.DISCOVERY_MAX_LAUNCHES),
      ok: Boolean(trending || fresh),
      ...(stale ? { stale } : {}),
    };
  });
}

export async function loadTokenMarket(d: Discovery, mint: string, signal: AbortSignal): Promise<{ token?: TokenFacts; pools: PoolFacts[]; fetchedAt?: string; notices: string[] }> {
  const ctx = marketCtx(d, signal, 4);
  const net = encodeURIComponent(d.env.GECKOTERMINAL_NETWORK);
  const token = await geckoGet<{ data?: JsonApiResource; included?: JsonApiResource[] }>(d, `/networks/${net}/tokens/${mint}?include=top_pools`, "live", ctx);
  const t = token?.body.data ? parseToken(token.body.data, ctx.v, d.env.GECKOTERMINAL_NETWORK) : undefined;
  let pools = (token?.body.included ?? []).filter((r) => r.type === "pool").map((r) => parsePool(r, ctx.v, d.env.GECKOTERMINAL_NETWORK)).filter((p): p is PoolFacts => Boolean(p));
  if (t && !pools.length) {
    const list = await geckoGet<{ data?: JsonApiResource[] }>(d, `/networks/${net}/tokens/${mint}/pools`, "pools", ctx);
    pools = (list?.body.data ?? []).map((r) => parsePool(r, ctx.v, d.env.GECKOTERMINAL_NETWORK)).filter((p): p is PoolFacts => Boolean(p));
  }
  pools.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  return { token: t, pools: pools.slice(0, d.env.MARKET_MAX_POOLS), fetchedAt: token ? new Date(token.fetchedAt).toISOString() : undefined, notices: [...ctx.notices] };
}

export function isBondingCurveDex(dex?: string): boolean {
  return BONDING_CURVE_DEX.test(dex ?? "");
}

export async function pulseHeadlines(d: Discovery, signal: AbortSignal): Promise<{ ok: boolean; items: { title: string; url: string; source: string; publishedAt?: string; fetchedAt: string }[] }> {
  if (!d.env.RSS_ENABLED) return { ok: false, items: [] };
  const { feeds } = loadFeeds(d.env);
  const enabled = feeds.filter((f) => f.enabled).slice(0, d.env.RSS_MAX_FEEDS_PER_REQUEST);
  if (!enabled.length) return { ok: false, items: [] };
  try {
    const { articles } = await d.news.collect(enabled, signal, d.now());
    const items = [...articles]
      .sort((a, b) => Date.parse(b.publishedAt ?? b.retrievedAt) - Date.parse(a.publishedAt ?? a.retrievedAt))
      .slice(0, 6)
      .map((a) => ({ title: a.title, url: a.url, source: a.source, publishedAt: a.publishedAt, fetchedAt: a.retrievedAt }));
    return { ok: items.length > 0, items };
  } catch (err) {
    const e = toClickError(err, "rss");
    if (e.kind === "aborted") throw e;
    return { ok: false, items: [] };
  }
}

export function publicCache(seconds: number): string {
  return `public, max-age=15, s-maxage=${seconds}`;
}

