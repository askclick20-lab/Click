import { Hono } from "hono";
import type { Env } from "../config/env.js";
import { rateLimitEnabled } from "../config/env.js";
import { fetchSimplePriceBook, type SimplePriceQuote } from "../providers/market/analysis.js";
import { TOKEN_PROGRAM_IDS, WRAPPED_SOL_MINT } from "../providers/solana/programs.js";
import { isSolanaAddress, validatePubkey } from "../solana/address.js";
import { formatLamports } from "../solana/address.js";
import type { ClientRateLimiter } from "../security/rate-limit.js";
import { analysisCtx, marketCtx, publicCache, type Discovery } from "./discovery.js";
import { clientKey, tooManyRequests, type AppVariables } from "./http-guards.js";
import { onchainUnavailable } from "./onchain-stub.js";

const PER_MINUTE = 20;

interface Holding {
  mint: string;
  amount: string;
  uiAmount: number;
  decimals: number;
  program: string;
  priceUsd?: number;
  valueUsd?: number;
  change24hPct?: number;
  priced: boolean;
  note?: string;
}

export function createPortfolio(env: Env, discovery: Discovery) {
  return {
    async get(wallet: string, signal: AbortSignal) {
      const ctx = analysisCtx(discovery, signal);
      const holdings: Holding[] = [];
      let solLamports: bigint | undefined;
      try {
        const bal = await ctx.rpc.getBalance(wallet, ctx.budget);
        solLamports = BigInt(bal);
      } catch {
        /* degrade */
      }
      if (solLamports !== undefined && solLamports > 0n) {
        holdings.push({
          mint: WRAPPED_SOL_MINT,
          amount: solLamports.toString(),
          uiAmount: Number(solLamports) / 1e9,
          decimals: 9,
          program: "native-sol",
          priced: false,
        });
      }
      for (const programId of TOKEN_PROGRAM_IDS) {
        try {
          const rows = await ctx.rpc.getTokenAccountsByOwner(wallet, programId, ctx.budget);
          for (const row of rows.value ?? []) {
            const parsed = (row as { account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string; decimals?: number; uiAmount?: number }; mint?: string } } } } }).account?.data?.parsed?.info;
            const amt = BigInt(parsed?.tokenAmount?.amount ?? "0");
            if (amt === 0n) continue;
            const mint = parsed?.mint;
            if (!mint || !isSolanaAddress(mint)) continue;
            const decimals = parsed?.tokenAmount?.decimals ?? 0;
            holdings.push({
              mint,
              amount: amt.toString(),
              uiAmount: parsed?.tokenAmount?.uiAmount ?? Number(amt) / 10 ** decimals,
              decimals,
              program: programId,
              priced: false,
            });
          }
        } catch {
          /* one program failing does not drop the other */
        }
      }

      const merged = new Map<string, Holding>();
      for (const h of holdings) {
        const prev = merged.get(h.mint);
        if (!prev) merged.set(h.mint, h);
        else {
          const amt = BigInt(prev.amount) + BigInt(h.amount);
          prev.amount = amt.toString();
          prev.uiAmount += h.uiAmount;
        }
      }
      holdings.length = 0;
      holdings.push(...merged.values());

      const cap = Math.min(discovery.env.PORTFOLIO_MAX_PRICED_TOKENS, 30);
      const toPrice = [...new Set(holdings.map((h) => h.mint))].slice(0, cap);
      let quotes = new Map<string, SimplePriceQuote>();
      let priceFetchedAt: string | undefined;
      if (discovery.env.MARKET_ENABLED && toPrice.length) {
        const mctx = marketCtx(discovery, signal, 2);
        quotes = await fetchSimplePriceBook(toPrice, mctx);
        priceFetchedAt = [...quotes.values()].find((q) => q.fetchedAt)?.fetchedAt;
      }

      let totalUsd = 0;
      let prevUsd = 0;
      let unpriced = 0;
      for (const h of holdings) {
        const q = quotes.get(h.mint);
        if (q?.priceUsd !== undefined) {
          h.priceUsd = q.priceUsd;
          h.change24hPct = q.change24hPct;
          h.valueUsd = h.uiAmount * q.priceUsd;
          h.priced = true;
          totalUsd += h.valueUsd;
          if (q.change24hPct !== undefined) {
            const prevPrice = q.priceUsd / (1 + q.change24hPct / 100);
            prevUsd += h.uiAmount * prevPrice;
          } else {
            prevUsd += h.valueUsd;
          }
        } else {
          unpriced++;
          h.note = "no price";
        }
      }
      holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
      const change24hUsd = prevUsd > 0 || totalUsd > 0 ? totalUsd - prevUsd : undefined;
      const change24hPct = prevUsd > 0 ? ((totalUsd - prevUsd) / prevUsd) * 100 : undefined;
      return {
        wallet,
        generatedAt: new Date(discovery.now()).toISOString(),
        fetchedAt: priceFetchedAt,
        sol: solLamports !== undefined ? formatLamports(solLamports) : undefined,
        totalUsd: round(totalUsd),
        change24hUsd: change24hUsd !== undefined ? round(change24hUsd) : undefined,
        change24hPct: change24hPct !== undefined ? round(change24hPct) : undefined,
        holdings: holdings.map((h) => ({
          ...h,
          valueUsd: h.valueUsd !== undefined ? round(h.valueUsd) : undefined,
        })),
        unpriced,
        pricedCap: cap,
        notices: [...ctx.notices],
      };
    },
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function portfolioRoutes(env: Env, limiter: ClientRateLimiter, discovery: Discovery): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  const portfolio = createPortfolio(env, discovery);
  app.get("/api/portfolio/:wallet", async (c) => {
    c.header("Cache-Control", "no-store");
    const check = validatePubkey(c.req.param("wallet").trim());
    if (!check.ok) return c.json({ error: { kind: "validation", message: "Invalid Solana wallet address." } }, 400);
    if (rateLimitEnabled(env)) {
      const verdict = limiter.take("discovery", clientKey(c, env), PER_MINUTE);
      if (!verdict.ok) return tooManyRequests(c, verdict.retryAfterMs);
    }
    if (!env.ONCHAIN_ENABLED) return onchainUnavailable(c, env);
    try {
      const body = await portfolio.get(check.address, c.req.raw.signal);
      c.header("Cache-Control", publicCache(30));
      return c.json(body);
    } catch {
      return c.json({ error: { kind: "upstream", message: "Portfolio could not be read." } }, 502);
    }
  });
  return app;
}
