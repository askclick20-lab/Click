import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MAINNET_BETA_GENESIS_HASH } from "../../../src/config/solana.js";
import { createContainer } from "../../../src/container.js";
import { silentLogger } from "../../../src/core/logger.js";
import { planOnchainQuery, type OnchainQuery } from "../../../src/providers/solana/analysis.js";
import { createSolanaChainTool } from "../../../src/providers/solana/tool.js";
import { WRAPPED_SOL_MINT } from "../../../src/providers/solana/programs.js";
import { base58Encode } from "../../../src/providers/solana/base58.js";
import { ProviderRegistry } from "../../../src/providers/llm/registry.js";
import { classifyIntent } from "../../../src/router/intent.js";
import { ToolRunner } from "../../../src/tools/runner.js";
import { ChatRequestSchema } from "../../../src/types/api.js";
import { FakeProvider, jsonResponse, mockFetch, testEnv } from "../../helpers.js";

const RPC = "https://rpc.solana-test.example.com";
const WALLET = base58Encode(new Uint8Array(32).fill(161));
const SIG = base58Encode(new Uint8Array(64).fill(2));

function rpcOk(id: unknown, result: unknown) {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}

function solanaHandler(overrides: Record<string, (params: unknown[]) => unknown> = {}) {
  return (body: { method: string; params: unknown[]; id: unknown }) => {
    const { method, params, id } = body;
    if (overrides[method]) return rpcOk(id, overrides[method](params));
    switch (method) {
      case "getGenesisHash":
        return rpcOk(id, MAINNET_BETA_GENESIS_HASH);
      case "getSlot":
        return rpcOk(id, 250_000_000);
      case "getBlockHeight":
        return rpcOk(id, 240_000_000);
      case "getEpochInfo":
        return rpcOk(id, { epoch: 400, slotIndex: 1000, slotsInEpoch: 432000, absoluteSlot: 250_000_000 });
      case "getRecentPerformanceSamples":
        return rpcOk(id, [{ slot: 249_999_000, numTransactions: 6000, samplePeriodSecs: 60 }]);
      case "getBalance":
        return rpcOk(id, { value: 2_000_000_000 });
      case "getAccountInfo":
        return rpcOk(id, {
          value: {
            lamports: 1,
            owner: "11111111111111111111111111111111",
            executable: false,
            data: { program: "system", parsed: { type: "account", info: {} }, space: 0 },
          },
        });
      case "getTokenAccountsByOwner":
        return rpcOk(id, { value: [] });
      case "getSignaturesForAddress":
        return rpcOk(id, [{ signature: SIG, slot: 249_000_000, err: null }]);
      case "getTransaction":
        return rpcOk(id, {
          slot: 249_000_001,
          blockTime: 1_700_000_000,
          meta: {
            err: null,
            fee: 5000,
            preBalances: [1_000_000_000, 0],
            postBalances: [999_995_000, 0],
            preTokenBalances: [],
            postTokenBalances: [],
            logMessages: ["Program log: test"],
            computeUnitsConsumed: 1200,
          },
          transaction: {
            signatures: [SIG],
            message: {
              accountKeys: [{ pubkey: WALLET, signer: true, writable: true }],
              instructions: [{ programId: "11111111111111111111111111111111", accounts: [], data: "" }],
            },
          },
        });
      case "getBlock":
        return rpcOk(id, { blockTime: 1_700_000_000, signatures: [SIG] });
      case "getTokenSupply":
        return rpcOk(id, { value: { amount: "1000000000", decimals: 9, uiAmount: 1 } });
      case "getTokenLargestAccounts":
        return rpcOk(id, { value: [{ address: WALLET, amount: "500000000", decimals: 9 }] });
      default:
        return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32601, message: `no ${method}` } });
    }
  };
}

let net: ReturnType<typeof mockFetch> | undefined;
afterEach(() => net?.restore());

function env(overrides: Record<string, string> = {}) {
  return testEnv({
    ONCHAIN_ENABLED: "true",
    ONCHAIN_RPC_RETRIES: "0",
    SOLANA_RPC_URL: RPC,
    ...overrides,
  });
}

async function runTool(q: OnchainQuery) {
  net = mockFetch((url, body) => (url === RPC ? solanaHandler()(body) : jsonResponse({ error: "bad url" }, 500)));
  const tool = createSolanaChainTool(env());
  return tool.execute(q, { query: "", entities: classifyIntent("").entities, signal: AbortSignal.timeout(30_000) });
}

describe("solana chain tool workflows", () => {
  it("plans transaction vs network intents", () => {
    const tx = planOnchainQuery(`Explain tx ${SIG}`, classifyIntent(`Explain tx ${SIG}`).entities, 3);
    assert.equal(tx.kind, "transaction");
    assert.equal(tx.explainTransaction, true);
    const net = planOnchainQuery("What's happening on Solana right now?", classifyIntent("What's happening on Solana right now?").entities, 3);
    assert.equal(net.kind, "network");
  });

  it("transaction workflow returns cited section and dataSources", async () => {
    const res = await runTool({
      kind: "transaction",
      txHashes: [SIG],
      addresses: [],
      explainTransaction: false,
      invalid: [],
    });
    assert.equal(res.data.kind, "transaction");
    assert.equal(res.data.dataSources.rpc, "ok");
    assert.equal(res.data.dataSources.helius, "not configured");
    assert.ok(res.sources[0]?.url?.includes("/tx/"));
    assert.match(res.sources[0]?.content ?? "", /Status: success/);
  });

  it("wallet workflow classifies account", async () => {
    const res = await runTool({ kind: "address", txHashes: [], addresses: [WALLET], explainTransaction: false, invalid: [] });
    assert.match(res.sources[0]?.content ?? "", /Classification: system wallet/);
    assert.match(res.sources[0]?.content ?? "", /RPC cannot provide/);
  });

  it("token mint workflow for wSOL without Helius", async () => {
    net = mockFetch((url, body) => {
      if (url !== RPC) return jsonResponse({}, 500);
      const h = solanaHandler({
        getAccountInfo: () => ({
          value: {
            lamports: 1,
            owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            executable: false,
            data: { program: "spl-token", parsed: { type: "mint", info: { decimals: 9, mintAuthority: null, freezeAuthority: null } }, space: 82 },
          },
        }),
      });
      return h(body);
    });
    const tool = createSolanaChainTool(env());
    const res = await tool.execute(
      { kind: "token", txHashes: [], addresses: [WRAPPED_SOL_MINT], explainTransaction: false, invalid: [] },
      { query: "", entities: classifyIntent("").entities, signal: AbortSignal.timeout(30_000) },
    );
    assert.match(res.sources[0]?.content ?? "", /without a DAS key/);
    assert.equal(res.data.dataSources.helius, "not configured");
  });

  it("slot workflow", async () => {
    const res = await runTool({ kind: "block", txHashes: [], addresses: [], block: 249_000_001, explainTransaction: false, invalid: [] });
    assert.match(res.sources[0]?.title ?? "", /Slot/);
  });

  it("network overview workflow", async () => {
    const res = await runTool({ kind: "network", txHashes: [], addresses: [], explainTransaction: false, invalid: [] });
    assert.match(res.sources[0]?.content ?? "", /Estimated TPS/);
    assert.match(res.sources[0]?.content ?? "", /no chain scanning/);
  });

  it("invalid input is reported without RPC query for bad token", async () => {
    let rpcHits = 0;
    net = mockFetch((url, body) => {
      if (url === RPC) rpcHits++;
      return solanaHandler()(body);
    });
    const tool = createSolanaChainTool(env());
    const res = await tool.execute(
      {
        kind: "address",
        txHashes: [],
        addresses: [],
        explainTransaction: false,
        invalid: [{ value: "not-a-valid-address", reason: "not valid base58" }],
      },
      { query: "", entities: classifyIntent("").entities, signal: AbortSignal.timeout(30_000) },
    );
    assert.ok(res.sources.some((s) => s.title === "Input validation"));
    const methods = net!.calls.filter((c) => c.url === RPC).map((c) => c.body?.method);
    assert.ok(!methods.includes("getAccountInfo"));
    assert.ok(rpcHits <= 3, "no address workflow RPC beyond bootstrap");
  });
});

describe("engine integration (solana chain tool)", () => {
  it("grounds on-chain questions when RPC is configured", async () => {
    net = mockFetch((url, body) => (url === RPC ? solanaHandler()(body) : jsonResponse({}, 500)));
    const groq = new FakeProvider("groq");
    const container = createContainer(env(), { logger: silentLogger, providers: new ProviderRegistry().register(groq) });
    const res = await container.engine.ask(ChatRequestSchema.parse({ message: "What's happening on Solana?" }), new AbortController().signal);
    assert.equal(res.type, "onchain");
    assert.ok(res.sources.some((s) => s.type === "onchain"));
    const chainPayload = res.data["chain.data"]?.[0]?.data as OnchainDataShape;
    assert.equal(chainPayload?.dataSources?.rpc, "ok");
    assert.ok(res.grounded);
  });
});

interface OnchainDataShape {
  dataSources?: { rpc?: string };
}
