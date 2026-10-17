import { z } from "zod";
import { cacheKey, TtlCache } from "../../cache/ttl-cache.js";
import { ClickError, toClickError } from "../../core/errors.js";
import { httpRequest } from "../../core/http.js";

const SOURCE = "rpc";

export interface SolanaBudget {
  rpcCalls: number;
  maxRpcCalls: number;
  signal: AbortSignal;
}

export interface SolanaRpcOptions {
  timeoutMs: number;
  retries: number;
  stableTtlMs: number;
  liveTtlMs: number;
  expectedGenesisHash: string;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/** Strip RPC URLs and api-key query values from text that may be shown or logged. */
export function redactRpcSecrets(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[rpc]")
    .replace(/api[_-]?key=[^&\s"'<>]+/gi, "api-key=[redacted]");
}

const zGenesis = z.string().min(1);
const zSlot = z.number().int().nonnegative();
const zU64 = z.union([z.number(), z.string()]);
const zBalance = z.object({ value: zU64 });
const zAccountInfo = z
  .object({
    value: z
      .object({
        lamports: z.number(),
        owner: z.string(),
        executable: z.boolean(),
        rentEpoch: z.number().optional(),
        data: z.union([z.tuple([z.string(), z.string()]), z.object({ program: z.string(), parsed: z.unknown(), space: z.number() })]).optional(),
      })
      .nullable(),
  })
  .passthrough();
const zAccountValue = z
  .object({
    lamports: z.number(),
    owner: z.string(),
    executable: z.boolean(),
    rentEpoch: z.number().optional(),
    data: z.union([z.tuple([z.string(), z.string()]), z.object({ program: z.string(), parsed: z.unknown(), space: z.number() })]).optional(),
  })
  .nullable();
const zMultipleAccounts = z.object({ value: z.array(zAccountValue) });
const zEpochInfo = z
  .object({
    epoch: z.number(),
    slotIndex: z.number(),
    slotsInEpoch: z.number(),
    absoluteSlot: z.number(),
    blockHeight: z.number().optional(),
    transactionCount: z.number().optional(),
  })
  .passthrough();
const zPerfSample = z.array(
  z.object({ slot: z.number(), numTransactions: z.number(), numSlots: z.number().optional(), samplePeriodSecs: z.number() }).passthrough(),
);
const zTx = z.unknown().nullable();
const zSigStatus = z.object({
  value: z.array(
    z
      .object({
        slot: z.number().optional(),
        confirmations: z.number().nullable().optional(),
        err: z.unknown().nullable().optional(),
        confirmationStatus: z.string().optional(),
      })
      .nullable(),
  ),
});
const zSigsForAddr = z.array(
  z.object({ signature: z.string(), slot: z.number(), err: z.unknown().nullable().optional(), memo: z.string().nullable().optional() }).passthrough(),
);
const zBlock = z.unknown().nullable();
const zTokenSupply = z.object({ value: z.object({ amount: z.string(), decimals: z.number(), uiAmount: z.number().nullable().optional() }) });
const zTokenLargest = z.object({ value: z.array(z.object({ address: z.string(), amount: z.string(), decimals: z.number().optional() }).passthrough()) });
const zTokenAccounts = z.object({ value: z.array(z.object({ pubkey: z.string(), account: z.unknown() }).passthrough()) });

function parseZod<T>(schema: z.ZodType<T>, method: string, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new ClickError("invalid_output", SOURCE, `Malformed RPC response to ${method}`);
  return r.data;
}

/**
 * Solana JSON-RPC 2.0 client: failover, genesis verification per endpoint, caching,
 * in-flight deduplication, bounded retries, and errors that never include RPC URLs.
 */
export class SolanaRpcClient {
  private nextId = 1;
  private readonly verifiedGenesis = new Set<string>();
  private readonly pausedUrls = new Set<string>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly urls: string[],
    private readonly opts: SolanaRpcOptions,
    private readonly cache = new TtlCache<unknown>(2000),
  ) {}

  async getGenesisHash(budget: SolanaBudget): Promise<string> {
    return this.call("getGenesisHash", [], budget, this.opts.stableTtlMs, zGenesis);
  }

  async getSlot(budget: SolanaBudget, commitment = "confirmed"): Promise<number> {
    return this.call("getSlot", [{ commitment }], budget, this.opts.liveTtlMs, zSlot);
  }

  async getBlockHeight(budget: SolanaBudget, commitment = "confirmed"): Promise<number> {
    return this.call("getBlockHeight", [{ commitment }], budget, this.opts.liveTtlMs, zSlot);
  }

  async getEpochInfo(budget: SolanaBudget, commitment = "finalized") {
    return this.call("getEpochInfo", [{ commitment }], budget, this.opts.liveTtlMs, zEpochInfo);
  }

  async getRecentPerformanceSamples(budget: SolanaBudget, limit = 5) {
    const bounded = Math.max(1, Math.min(720, limit));
    return this.call("getRecentPerformanceSamples", [bounded], budget, this.opts.liveTtlMs, zPerfSample);
  }

  async getBalance(address: string, budget: SolanaBudget, commitment = "confirmed"): Promise<number> {
    const raw = await this.call("getBalance", [address, { commitment }], budget, this.opts.liveTtlMs, zBalance);
    return typeof raw.value === "string" ? Number(raw.value) : raw.value;
  }

  async getAccountInfo(address: string, budget: SolanaBudget, commitment = "finalized") {
    return this.call("getAccountInfo", [address, { encoding: "jsonParsed", commitment }], budget, this.opts.stableTtlMs, zAccountInfo);
  }

  async getMultipleAccounts(addresses: string[], budget: SolanaBudget, commitment = "finalized") {
    return this.call("getMultipleAccounts", [addresses, { encoding: "jsonParsed", commitment }], budget, this.opts.stableTtlMs, zMultipleAccounts);
  }

  async getTransaction(signature: string, budget: SolanaBudget, commitment = "confirmed") {
    return this.call(
      "getTransaction",
      [signature, { encoding: "jsonParsed", commitment, maxSupportedTransactionVersion: 2 }],
      budget,
      this.opts.stableTtlMs,
      zTx,
    );
  }

  async getSignaturesForAddress(address: string, budget: SolanaBudget, opts: { limit?: number; before?: string; until?: string } = {}) {
    const limit = Math.max(1, Math.min(1000, opts.limit ?? 25));
    const config: Record<string, unknown> = { limit };
    if (opts.before) config.before = opts.before;
    if (opts.until) config.until = opts.until;
    return this.call("getSignaturesForAddress", [address, config], budget, this.opts.liveTtlMs, zSigsForAddr);
  }

  async getSignatureStatuses(signatures: string[], budget: SolanaBudget, searchTransactionHistory = false) {
    return this.call("getSignatureStatuses", [signatures, { searchTransactionHistory }], budget, this.opts.liveTtlMs, zSigStatus);
  }

  async getBlock(slot: number, budget: SolanaBudget, commitment = "finalized") {
    return this.call(
      "getBlock",
      [slot, { encoding: "jsonParsed", commitment, transactionDetails: "signatures", rewards: false, maxSupportedTransactionVersion: 2 }],
      budget,
      this.opts.stableTtlMs,
      zBlock,
    );
  }

  async getTokenSupply(mint: string, budget: SolanaBudget, commitment = "finalized") {
    return this.call("getTokenSupply", [mint, { commitment }], budget, this.opts.stableTtlMs, zTokenSupply);
  }

  async getTokenLargestAccounts(mint: string, budget: SolanaBudget, commitment = "finalized") {
    return this.call("getTokenLargestAccounts", [mint, { commitment }], budget, this.opts.stableTtlMs, zTokenLargest);
  }

  async getTokenAccountsByOwner(owner: string, programId: string, budget: SolanaBudget, commitment = "finalized") {
    return this.call(
      "getTokenAccountsByOwner",
      [owner, { programId }, { encoding: "jsonParsed", commitment }],
      budget,
      this.opts.stableTtlMs,
      zTokenAccounts,
    );
  }

  async getParsedTokenAccountsByOwner(owner: string, programId: string, budget: SolanaBudget, commitment = "finalized") {
    return this.getTokenAccountsByOwner(owner, programId, budget, commitment);
  }

  private async call<T>(
    method: string,
    params: unknown[],
    budget: SolanaBudget,
    ttlMs: number,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const key = cacheKey("solana-rpc", method, params);
    if (ttlMs > 0) {
      const hit = this.cache.get(key);
      if (hit !== undefined) return schema.parse(hit);
    }
    const pending = this.inflight.get(key);
    if (pending) return schema.parse(await pending);

    const run = this.execute(method, params, budget, ttlMs, key).then((raw) => schema.parse(raw));
    this.inflight.set(key, run);
    try {
      return await run;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async execute(method: string, params: unknown[], budget: SolanaBudget, ttlMs: number, key: string): Promise<unknown> {
    if (budget.rpcCalls >= budget.maxRpcCalls) {
      throw new ClickError("budget", SOURCE, `On-chain request limit for this question (${budget.maxRpcCalls} RPC calls) reached`);
    }
    budget.rpcCalls++;

    const activeUrls = this.urls.filter((u) => !this.pausedUrls.has(u));
    if (!activeUrls.length) {
      throw new ClickError("not_configured", SOURCE, "No Solana RPC endpoints are available (all paused or missing)");
    }

    let lastError: ClickError | undefined;
    for (const url of activeUrls) {
      try {
        await this.ensureGenesis(url, budget, method);
      } catch (err) {
        const e = toClickError(err, SOURCE);
        lastError = e;
        if (e.kind === "bad_request") throw e;
        continue;
      }

      for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
        try {
          const result = await this.send(url, method, params, budget.signal);
          if (method === "getGenesisHash") this.markGenesisVerified(url, result);
          if (ttlMs > 0 && result !== null) this.cache.set(key, result, ttlMs);
          return result;
        } catch (err) {
          const e = toClickError(err, SOURCE);
          lastError = e;
          if (e.kind === "auth" || e.kind === "quota") {
            this.pausedUrls.add(url);
            break;
          }
          const retryable = e.kind === "rate_limit" || e.kind === "timeout" || e.kind === "network" || e.kind === "upstream";
          if (!retryable || attempt === this.opts.retries || budget.signal.aborted) break;
          if (e.retryAfterMs !== undefined && e.retryAfterMs > 2000) break;
          const backoff = e.retryAfterMs ?? Math.min(2000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
          await sleep(backoff, budget.signal);
        }
      }
    }
    throw lastError ?? new ClickError("upstream", SOURCE, "Solana RPC request failed");
  }

  private async ensureGenesis(url: string, budget: SolanaBudget, method: string): Promise<void> {
    if (this.verifiedGenesis.has(url)) return;
    if (method === "getGenesisHash") return;
    if (budget.rpcCalls >= budget.maxRpcCalls) {
      throw new ClickError("budget", SOURCE, `On-chain request limit for this question (${budget.maxRpcCalls} RPC calls) reached`);
    }
    budget.rpcCalls++;
    const hash = await this.send(url, "getGenesisHash", [], budget.signal);
    this.markGenesisVerified(url, hash);
  }

  private markGenesisVerified(url: string, hash: unknown): void {
    const parsed = zGenesis.safeParse(hash);
    if (!parsed.success) throw new ClickError("invalid_output", SOURCE, "Malformed RPC response to getGenesisHash");
    if (parsed.data !== this.opts.expectedGenesisHash) {
      throw new ClickError(
        "bad_request",
        SOURCE,
        `Solana RPC cluster mismatch: expected genesis ${this.opts.expectedGenesisHash} but the endpoint returned ${parsed.data}. Check SOLANA_NETWORK, SOLANA_RPC_URL, and SOLANA_GENESIS_HASH.`,
      );
    }
    this.verifiedGenesis.add(url);
  }

  private async send(url: string, method: string, params: unknown[], signal: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    let res: Response;
    try {
      res = await httpRequest(url, {
        source: SOURCE,
        body: { jsonrpc: "2.0", id, method, params },
        timeoutMs: this.opts.timeoutMs,
        signal,
        mapError: (status, body, headers) => {
          const safeBody = redactRpcSecrets(body.slice(0, 200));
          if (status === 429) {
            const ra = Number(headers.get("retry-after"));
            return new ClickError("rate_limit", SOURCE, "The Solana RPC endpoint is rate-limiting requests (429)", {
              status,
              ...(Number.isFinite(ra) && ra > 0 ? { retryAfterMs: ra * 1000 } : {}),
            });
          }
          if (status === 401 || status === 403) {
            return new ClickError("auth", SOURCE, `The Solana RPC endpoint rejected the request (${status}) — check SOLANA_RPC_URL credentials`, { status });
          }
          if (status === 402 || status === 432 || status === 433) {
            return new ClickError("quota", SOURCE, `Solana RPC quota exceeded (${status}): ${safeBody}`, { status });
          }
          if (status >= 500) return new ClickError("upstream", SOURCE, `The Solana RPC endpoint returned ${status}`, { status });
          return new ClickError("bad_request", SOURCE, `The Solana RPC endpoint returned ${status}: ${safeBody}`, { status });
        },
      });
    } catch (err) {
      const e = toClickError(err, SOURCE);
      throw new ClickError(e.kind, SOURCE, redactRpcSecrets(e.message), { cause: err, status: e.status, retryAfterMs: e.retryAfterMs });
    }

    let json: JsonRpcResponse;
    try {
      json = (await res.json()) as JsonRpcResponse;
    } catch {
      throw new ClickError("invalid_output", SOURCE, `Malformed RPC response to ${method} (not JSON)`);
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new ClickError("invalid_output", SOURCE, `Malformed RPC response to ${method}`);
    }
    if (json.error) throw mapRpcError(method, json.error);
    if (!("result" in json)) throw new ClickError("invalid_output", SOURCE, `Malformed RPC response to ${method} (no result)`);
    return json.result;
  }
}

export function mapRpcError(method: string, err: { code?: number; message?: string }): ClickError {
  const msg = redactRpcSecrets(String(err.message ?? "unknown error").slice(0, 200));
  if (err.code === -32009 || /ledger|pruned|missing.*block|slot was skipped/i.test(msg)) {
    return new ClickError("not_found", SOURCE, `Ledger data unavailable (pruned or not retained): ${msg}`);
  }
  if (err.code === -32005 || err.code === 429 || /rate|limit exceeded|too many/i.test(msg)) {
    return new ClickError("rate_limit", SOURCE, `RPC rate limit: ${msg}`);
  }
  if (err.code === -32601 || /method not (found|supported)|does not exist|unsupported/i.test(msg)) {
    return new ClickError("bad_request", SOURCE, `The RPC endpoint does not support ${method}`);
  }
  if (err.code === -32602 || err.code === -32600) {
    return new ClickError("bad_request", SOURCE, `Invalid RPC request (${method}): ${msg}`);
  }
  return new ClickError("upstream", SOURCE, `RPC error (${method}): ${msg}`);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ClickError("aborted", SOURCE, "Aborted"));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new ClickError("aborted", SOURCE, "Aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
