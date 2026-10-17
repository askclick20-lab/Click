import { z } from "zod";
import { solanaCluster, type SolanaConfig } from "../../config/solana.js";
import type { Env } from "../../config/env.js";
import { toClickError } from "../../core/errors.js";
import type { SourceInput } from "../../sources/types.js";
import type { Tool, ToolResult } from "../../tools/types.js";
import {
  AnalysisContext,
  analyzeAddress,
  analyzeBlock,
  analyzeNetwork,
  analyzeTokenMint,
  analyzeTransaction,
  planOnchainQuery,
  type OnchainQuery,
  type Section,
} from "./analysis.js";
import { heliusClientFor, rpcClientFor } from "./client.js";
import type { HeliusClient } from "./helius.js";
import type { SolanaRpcClient } from "./rpc.js";
import { createAnalysisBudget } from "./types.js";

export const OnchainInputSchema = z.object({
  kind: z.enum(["transaction", "address", "token", "block", "network"]),
  txHashes: z.array(z.string().min(86).max(88)).max(10),
  addresses: z.array(z.string().min(32).max(44)).max(10),
  block: z.union([z.number().int().nonnegative(), z.literal("latest")]).optional(),
  explainTransaction: z.boolean(),
  invalid: z.array(z.object({ value: z.string().max(200), reason: z.string().max(300) })).max(10),
});

export const OnchainDataSchema = z.object({
  chain: z.object({ cluster: z.string(), explorer: z.string().optional(), rpc: z.enum(["public", "custom"]) }),
  kind: z.enum(["transaction", "address", "token", "block", "network"]),
  targets: z.array(z.string()),
  sections: z.array(z.object({ title: z.string(), url: z.string().optional() })),
  dataSources: z.object({
    rpc: z.enum(["ok", "unavailable"]),
    explorer: z.enum(["ok", "not configured"]).optional(),
    helius: z.enum(["ok", "unavailable", "not configured"]),
  }),
  requests: z.object({ rpc: z.number(), helius: z.number() }),
  invalid: z.array(z.object({ value: z.string(), reason: z.string() })),
});
export type OnchainData = z.infer<typeof OnchainDataSchema>;

export interface SolanaChainDeps {
  cluster?: SolanaConfig;
  rpc?: SolanaRpcClient;
  helius?: HeliusClient | null;
}

/**
 * Solana on-chain intelligence. The LLM never fetches chain facts: this tool
 * reads RPC (and optional Helius enrichment), normalizes into sourced sections.
 */
export function createSolanaChainTool(env: Env, deps: SolanaChainDeps = {}): Tool<OnchainQuery, OnchainData> {
  const cluster = deps.cluster ?? solanaCluster(env);
  const rpcOpts = {
    timeoutMs: env.ONCHAIN_RPC_TIMEOUT_MS,
    retries: env.ONCHAIN_RPC_RETRIES,
    stableTtlMs: env.ONCHAIN_CACHE_TTL_SECONDS * 1000,
    liveTtlMs: env.ONCHAIN_LIVE_TTL_SECONDS * 1000,
    expectedGenesisHash: cluster.genesisHash,
  };
  const rpc = deps.rpc ?? rpcClientFor(env);
  const helius = deps.helius === null ? undefined : (deps.helius ?? heliusClientFor(env));

  return {
    name: "solana-chain",
    description: "Solana on-chain data: transactions, accounts, token mints, slots/blocks, and network status.",
    capabilities: ["chain.data"],
    inputSchema: OnchainInputSchema,
    outputSchema: OnchainDataSchema,
    auth: { envKeys: ["SOLANA_RPC_URL", "ONCHAIN_ENABLED"] },
    rateLimit: { requestsPerMinute: 30 },
    dailyLimit: env.ONCHAIN_DAILY_REQUEST_LIMIT,
    costTier: "free",
    priority: 1,
    cacheTtlSeconds: env.ONCHAIN_LIVE_TTL_SECONDS,
    timeoutMs: env.ONCHAIN_TIMEOUT_MS,
    isConfigured: () => env.ONCHAIN_ENABLED && cluster.rpcUrls.length > 0,
    planInput: (ctx) => (ctx.intents.includes("onchain") ? planOnchainQuery(ctx.query, ctx.entities, env.ONCHAIN_MAX_ADDRESSES) : null),

    async execute(q, { signal }): Promise<ToolResult<OnchainData>> {
      const budget = createAnalysisBudget(signal, env);
      const ctx = new AnalysisContext(cluster, rpc, helius, budget, {
        maxTransactions: env.ONCHAIN_MAX_TRANSACTIONS,
        maxLogLines: Math.min(20, env.ONCHAIN_MAX_LOG_RESULTS),
        maxTokenAccounts: 25,
      });

      const sections: Section[] = [];
      try {
        await rpc.getSlot(budget);
      } catch (err) {
        const e = toClickError(err, "rpc");
        if (e.kind === "aborted" || /cluster mismatch/i.test(e.message)) throw e;
        ctx.rpcDown = e.kind;
        ctx.notices.add(`Solana RPC is unavailable (${e.kind}); chain.data may be incomplete.`);
      }

      if (q.invalid.length) {
        sections.push({
          title: "Input validation",
          content: q.invalid.map((i) => `- ${i.reason}. It was not queried.`).join("\n"),
          relevance: 1,
        });
      }

      if (q.kind === "transaction") {
        for (const sig of q.txHashes) sections.push(...(await analyzeTransaction(sig, ctx, q.explainTransaction)));
      } else if (q.kind === "address") {
        for (const a of q.addresses) sections.push(...(await analyzeAddress(a, ctx)));
      } else if (q.kind === "token") {
        for (const a of q.addresses) sections.push(...(await analyzeTokenMint(a, ctx)));
      } else if (q.kind === "block") {
        sections.push(...(await analyzeBlock(q.block ?? "latest", ctx)));
      } else if (!q.invalid.length || q.kind === "network") {
        sections.push(...(await analyzeNetwork(ctx)));
      }

      const usedUrls = new Set<string>();
      const flags = [...ctx.flags];
      const sources: SourceInput[] = sections.map((s) => ({
        title: s.title,
        ...(s.url && !usedUrls.has(s.url) && usedUrls.add(s.url) ? { url: s.url } : {}),
        type: "onchain",
        evidence: "live_data",
        family: "onchain",
        content: s.content,
        snippet: s.content.split("\n").slice(0, 2).join(" · ").slice(0, 300),
        relevance: s.relevance,
        ...(flags.length ? { securityFlags: flags } : {}),
      }));

      const heliusUsed = budget.heliusCalls > 0;
      return {
        data: {
          chain: {
            cluster: cluster.cluster,
            ...(cluster.explorerBase ? { explorer: cluster.explorerBase } : {}),
            rpc: cluster.publicRpc ? "public" : "custom",
          },
          kind: q.kind,
          targets:
            q.kind === "transaction"
              ? q.txHashes
              : q.kind === "address" || q.kind === "token"
                ? q.addresses
                : q.kind === "block"
                  ? [String(q.block ?? "latest")]
                  : [],
          sections: sections.map((s) => ({ title: s.title, ...(s.url ? { url: s.url } : {}) })),
          dataSources: {
            rpc: ctx.rpcDown ? "unavailable" : "ok",
            explorer: cluster.explorerBase ? "ok" : "not configured",
            helius: !helius ? "not configured" : heliusUsed ? "ok" : "unavailable",
          },
          requests: { rpc: budget.rpcCalls, helius: budget.heliusCalls },
          invalid: q.invalid,
        },
        sources,
        notices: [...ctx.notices],
        citableUrls: [...ctx.citable],
      };
    },
  };
}
