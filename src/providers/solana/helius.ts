import { ClickError } from "../../core/errors.js";
import { httpRequest } from "../../core/http.js";
import { redactRpcSecrets } from "./rpc.js";
import type { AnalysisBudget } from "./types.js";

const SOURCE = "helius";

export interface HeliusClient {
  getAsset(mint: string, budget: AnalysisBudget): Promise<HeliusAsset | undefined>;
  /** Enhanced transaction parse (credit-heavy). */
  parseTransaction(signature: string, budget: AnalysisBudget): Promise<HeliusParsedTx | undefined>;
}

export interface HeliusAsset {
  id: string;
  mutable?: boolean;
  authorities?: { address?: string; scopes?: string[] }[];
  /** `json_uri` / off-chain metadata links are ignored — never fetched. */
  content?: { metadata?: { name?: string; symbol?: string; description?: string }; json_uri?: string };
}

export interface HeliusParsedTx {
  description?: string;
  type?: string;
  source?: string;
  fee?: number;
  feePayer?: string;
}

export function createHeliusClient(apiKey: string, opts: { timeoutMs: number; cluster: "mainnet-beta" | "devnet" }): HeliusClient {
  const rpcBase =
    opts.cluster === "devnet" ? `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}` : `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
  const apiBase = `https://api.helius.xyz/v0`;

  async function charge(budget: AnalysisBudget): Promise<void> {
    if (budget.heliusCalls >= budget.maxHeliusCalls) {
      throw new ClickError("budget", SOURCE, "Helius enrichment limit for this question reached");
    }
    budget.heliusCalls++;
  }

  return {
    async getAsset(mint, budget) {
      await charge(budget);
      try {
        const res = await httpRequest(rpcBase, {
          source: SOURCE,
          body: { jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: mint } },
          timeoutMs: opts.timeoutMs,
          signal: budget.signal,
          mapError: (status, body) =>
            new ClickError(status === 429 ? "rate_limit" : status === 401 || status === 403 ? "auth" : "upstream", SOURCE, redactRpcSecrets(`Helius getAsset failed (${status}): ${body.slice(0, 120)}`), { status }),
        });
        const json = (await res.json()) as { result?: HeliusAsset; error?: { message?: string } };
        if (json.error) return undefined;
        return json.result;
      } catch {
        return undefined;
      }
    },

    async parseTransaction(signature, budget) {
      await charge(budget);
      try {
        const url = `${apiBase}/transactions/?api-key=${encodeURIComponent(apiKey)}`;
        const res = await httpRequest(url, {
          source: SOURCE,
          method: "POST",
          body: [signature],
          timeoutMs: opts.timeoutMs,
          signal: budget.signal,
          mapError: (status, body) =>
            new ClickError(status === 429 ? "rate_limit" : status === 401 || status === 403 ? "auth" : "upstream", SOURCE, redactRpcSecrets(`Helius transaction parse failed (${status}): ${body.slice(0, 120)}`), { status }),
        });
        const rows = (await res.json()) as HeliusParsedTx[];
        return Array.isArray(rows) ? rows[0] : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
