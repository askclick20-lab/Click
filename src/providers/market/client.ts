import type { Env } from "../../config/env.js";
import { GeckoTerminalClient } from "./geckoterminal.js";

const clients = new WeakMap<Env, GeckoTerminalClient>();

/** One GeckoTerminal client per process Env so the 25/min budget is shared across chat and discovery. */
export function geckoClientFor(env: Env): GeckoTerminalClient {
  let client = clients.get(env);
  if (!client) {
    client = new GeckoTerminalClient({
      baseUrl: env.GECKOTERMINAL_API_URL.replace(/\/+$/, ""),
      timeoutMs: env.GECKOTERMINAL_TIMEOUT_MS,
      retries: env.GECKOTERMINAL_RETRIES,
      ratePerMinute: env.GECKOTERMINAL_RATE_LIMIT_PER_MINUTE,
      ttlSeconds: { live: env.MARKET_CACHE_TTL, pools: env.POOL_CACHE_TTL, meta: env.TOKEN_METADATA_CACHE_TTL, trending: env.MARKET_TRENDING_TTL },
      staleMaxSeconds: env.MARKET_STALE_MAX_SECONDS,
    });
    clients.set(env, client);
  }
  return client;
}
