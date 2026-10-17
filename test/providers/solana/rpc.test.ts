import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { ClickError } from "../../../src/core/errors.js";
import { MAINNET_BETA_GENESIS_HASH } from "../../../src/config/solana.js";
import { USDC_MINT, WRAPPED_SOL_MINT } from "../../../src/providers/solana/programs.js";
import { mapRpcError, redactRpcSecrets, SolanaRpcClient, type SolanaBudget } from "../../../src/providers/solana/rpc.js";
import { jsonResponse, mockFetch } from "../../helpers.js";

const PRIMARY = "https://rpc-primary.example.com";
const FALLBACK = "https://rpc-fallback.example.com";
const SECRET_RPC = `${PRIMARY}/?api-key=super_secret_value`;

const opts = {
  timeoutMs: 5000,
  retries: 2,
  stableTtlMs: 60_000,
  liveTtlMs: 1000,
  expectedGenesisHash: MAINNET_BETA_GENESIS_HASH,
};

function budget(max = 25): SolanaBudget {
  return { rpcCalls: 0, maxRpcCalls: max, signal: AbortSignal.timeout(30_000) };
}

function ok(id: unknown, result: unknown) {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}

function err(id: unknown, code: number, message: string) {
  return jsonResponse({ jsonrpc: "2.0", id, error: { code, message } });
}

function autoHandler(extra?: (method: string, params: unknown[]) => Response | undefined) {
  return (url: string, body: { method: string; params: unknown[]; id: unknown }) => {
    if (url !== PRIMARY && url !== FALLBACK && url !== SECRET_RPC) return new Response("not found", { status: 404 });
    const custom = extra?.(body.method, body.params);
    if (custom) return custom;
    const { method, id } = body;
    if (method === "getGenesisHash") return ok(id, MAINNET_BETA_GENESIS_HASH);
    if (method === "getSlot") return ok(id, 42);
    if (method === "getBlockHeight") return ok(id, 100);
    if (method === "getEpochInfo") return ok(id, { epoch: 1, slotIndex: 2, slotsInEpoch: 432000, absoluteSlot: 42 });
    if (method === "getRecentPerformanceSamples") return ok(id, [{ slot: 40, numTransactions: 100, samplePeriodSecs: 60 }]);
    if (method === "getBalance") return ok(id, { value: 1_000_000_000 });
    if (method === "getAccountInfo") return ok(id, { value: { lamports: 1, owner: "11111111111111111111111111111111", executable: false } });
    if (method === "getMultipleAccounts") return ok(id, { value: [null] });
    if (method === "getTransaction") return ok(id, { slot: 1 });
    if (method === "getSignaturesForAddress") return ok(id, [{ signature: "sig", slot: 1 }]);
    if (method === "getSignatureStatuses") return ok(id, { value: [null] });
    if (method === "getBlock") return ok(id, { blockhash: "abc", previousBlockhash: "def" });
    if (method === "getTokenSupply") return ok(id, { value: { amount: "1000", decimals: 9, uiAmount: 0.000001 } });
    if (method === "getTokenLargestAccounts") return ok(id, { value: [{ address: WRAPPED_SOL_MINT, amount: "1" }] });
    if (method === "getTokenAccountsByOwner") return ok(id, { value: [{ pubkey: "ata", account: {} }] });
    return err(id, -32601, `Method ${method} not found`);
  };
}

describe("providers/solana/rpc", () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("redacts RPC URLs and api-key query values", () => {
    const text = `failed ${SECRET_RPC} and api-key=abc123`;
    const out = redactRpcSecrets(text);
    assert.ok(!out.includes("super_secret"));
    assert.ok(!out.includes("api-key=abc123"));
    assert.match(out, /api-key=\[redacted\]/);
  });

  it("maps pruned ledger errors to not_found", () => {
    const e = mapRpcError("getTransaction", { code: -32009, message: "Block not available for slot" });
    assert.equal(e.kind, "not_found");
    assert.match(e.message, /pruned|unavailable/i);
  });

  it("retries on rate limit then succeeds", async () => {
    let slotCalls = 0;
    const { restore: r } = mockFetch((url, body) => {
      if (body.method === "getGenesisHash") return ok(body.id, MAINNET_BETA_GENESIS_HASH);
      if (body.method === "getSlot") {
        slotCalls++;
        if (slotCalls === 1) return new Response("slow", { status: 429, headers: { "retry-after": "0" } });
        return ok(body.id, 99);
      }
      return err(body.id, -32601, "nope");
    });
    restore = r;
    const client = new SolanaRpcClient([PRIMARY], opts);
    const slot = await client.getSlot(budget());
    assert.equal(slot, 99);
    assert.ok(slotCalls >= 2);
  });

  it("fails over to fallback RPC", async () => {
    const { restore: r, calls } = mockFetch((url, body) => {
      if (url === PRIMARY) return new Response("down", { status: 503 });
      return autoHandler()(url, body);
    });
    restore = r;
    const client = new SolanaRpcClient([PRIMARY, FALLBACK], opts);
    const slot = await client.getSlot(budget());
    assert.equal(slot, 42);
    assert.ok(calls.some((c) => c.url === FALLBACK && c.body.method === "getSlot"));
  });

  it("hard-stops on genesis hash mismatch", async () => {
    const { restore: r } = mockFetch((_url, body) => {
      if (body.method === "getGenesisHash") return ok(body.id, "wrong-genesis-hash");
      return ok(body.id, 1);
    });
    restore = r;
    const client = new SolanaRpcClient([PRIMARY], opts);
    await assert.rejects(() => client.getSlot(budget()), (e: ClickError) => e.kind === "bad_request" && /cluster mismatch/i.test(e.message));
  });

  it("caches stable slot reads", async () => {
    let slotCalls = 0;
    const { restore: r, calls } = mockFetch((url, body) => {
      if (body.method === "getSlot") slotCalls++;
      return autoHandler()(url, body);
    });
    restore = r;
    const client = new SolanaRpcClient([PRIMARY], opts);
    const b = budget();
    assert.equal(await client.getSlot(b), 42);
    assert.equal(await client.getSlot(b), 42);
    assert.equal(slotCalls, 1);
    assert.ok(calls.filter((c) => c.body.method === "getGenesisHash").length === 1);
  });

  it("deduplicates concurrent identical calls", async () => {
    let slotCalls = 0;
    const { restore: r } = mockFetch((url, body) => {
      if (body.method === "getSlot") slotCalls++;
      return autoHandler()(url, body);
    });
    restore = r;
    const client = new SolanaRpcClient([PRIMARY], { ...opts, liveTtlMs: 0 });
    const b = budget();
    const [a, bSlot] = await Promise.all([client.getSlot(b), client.getSlot(b)]);
    assert.equal(a, bSlot);
    assert.equal(slotCalls, 1);
  });

  it("enforces per-question RPC call cap", async () => {
    const { restore: r } = mockFetch((url, body) => autoHandler()(url, body));
    restore = r;
    const client = new SolanaRpcClient([PRIMARY], { ...opts, liveTtlMs: 0, stableTtlMs: 0 });
    const b = budget(3);
    await client.getSlot(b);
    await client.getBalance(WRAPPED_SOL_MINT, b);
    await assert.rejects(() => client.getEpochInfo(b), (e: ClickError) => e.kind === "budget");
  });

  it("never leaks secret RPC URL in HTTP error text", async () => {
    const { restore: r } = mockFetch(() => new Response("down", { status: 503 }));
    restore = r;
    const client = new SolanaRpcClient([SECRET_RPC], opts);
    await assert.rejects(() => client.getSlot(budget()), (e: ClickError) => {
      assert.ok(!e.message.includes("super_secret"));
      assert.ok(!e.message.includes("api-key="));
      return true;
    });
  });

  const methods: { name: string; run: (c: SolanaRpcClient, b: SolanaBudget) => Promise<unknown>; failCode: number }[] = [
    { name: "getGenesisHash", run: (c, b) => c.getGenesisHash(b), failCode: -32601 },
    { name: "getSlot", run: (c, b) => c.getSlot(b), failCode: -32005 },
    { name: "getBlockHeight", run: (c, b) => c.getBlockHeight(b), failCode: -32005 },
    { name: "getEpochInfo", run: (c, b) => c.getEpochInfo(b), failCode: -32602 },
    { name: "getRecentPerformanceSamples", run: (c, b) => c.getRecentPerformanceSamples(b, 3), failCode: -32602 },
    { name: "getBalance", run: (c, b) => c.getBalance(WRAPPED_SOL_MINT, b), failCode: -32602 },
    { name: "getAccountInfo", run: (c, b) => c.getAccountInfo(WRAPPED_SOL_MINT, b), failCode: -32602 },
    { name: "getMultipleAccounts", run: (c, b) => c.getMultipleAccounts([WRAPPED_SOL_MINT], b), failCode: -32602 },
    { name: "getTransaction", run: (c, b) => c.getTransaction("5".repeat(87), b), failCode: -32009 },
    { name: "getSignaturesForAddress", run: (c, b) => c.getSignaturesForAddress(USDC_MINT, b), failCode: -32602 },
    { name: "getSignatureStatuses", run: (c, b) => c.getSignatureStatuses(["5".repeat(87)], b), failCode: -32602 },
    { name: "getBlock", run: (c, b) => c.getBlock(1, b), failCode: -32009 },
    { name: "getTokenSupply", run: (c, b) => c.getTokenSupply(USDC_MINT, b), failCode: -32602 },
    { name: "getTokenLargestAccounts", run: (c, b) => c.getTokenLargestAccounts(USDC_MINT, b), failCode: -32602 },
    {
      name: "getTokenAccountsByOwner",
      run: (c, b) => c.getTokenAccountsByOwner(WRAPPED_SOL_MINT, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", b),
      failCode: -32602,
    },
  ];

  for (const { name, run, failCode } of methods) {
    it(`${name} succeeds against mocked RPC`, async () => {
      const { restore: r } = mockFetch((url, body) => autoHandler()(url, body));
      restore = r;
      const client = new SolanaRpcClient([PRIMARY], opts);
      const result = await run(client, budget());
      assert.ok(result !== undefined);
    });

    it(`${name} maps RPC failure`, async () => {
      const { restore: r } = mockFetch((url, body) =>
        autoHandler((method, _params) => (method === name ? err(body.id, failCode, `fail ${name}`) : undefined))(url, body),
      );
      restore = r;
      const client = new SolanaRpcClient([PRIMARY], opts);
      await assert.rejects(() => run(client, budget()), (e: ClickError) => {
        if (failCode === -32005) return e.kind === "rate_limit";
        if (failCode === -32009) return e.kind === "not_found";
        if (failCode === -32601 || failCode === -32602) return e.kind === "bad_request";
        return true;
      });
    });
  }
});
