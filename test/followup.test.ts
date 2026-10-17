import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyIntent, inheritFollowUpContext, inheritOnchainContext, contextTurn } from "../src/router/intent.js";
import { ChatRequestSchema } from "../src/types/api.js";
import { createApp } from "../src/app.js";
import { createContainer } from "../src/container.js";
import { silentLogger } from "../src/core/logger.js";
import { ProviderRegistry } from "../src/providers/llm/registry.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { FakeProvider, testEnv } from "./helpers.js";
import { base58Encode } from "../src/solana/base58.js";
import { USDC_MINT } from "../src/providers/solana/programs.js";

const SIG = base58Encode(new Uint8Array(64).fill(11));
const WALLET = base58Encode(new Uint8Array(32).fill(82));

function intent(message: string, history: { role?: string; content: string }[]) {
  const base = classifyIntent(message);
  return inheritFollowUpContext(inheritOnchainContext(base, message, history), message, history);
}

describe("Solana follow-up resolution", () => {
  it("inherits a mint for liquidity follow-ups", () => {
    const next = intent("what about its liquidity?", [{ role: "user", content: `Analyze this token ${USDC_MINT}` }]);
    assert.deepEqual(next.entities.addresses, [USDC_MINT]);
    assert.ok(next.intents.includes("market"));
  });

  it("inherits a wallet for 'analyze this wallet'", () => {
    const next = intent("Analyze this wallet.", [{ role: "user", content: `Look at ${WALLET}` }]);
    assert.deepEqual(next.entities.addresses, [WALLET]);
    assert.ok(next.intents.includes("onchain"));
  });

  it("inherits a signature for 'explain this transaction'", () => {
    const next = intent("Explain this transaction.", [{ role: "user", content: `sig ${SIG}` }]);
    assert.deepEqual(next.entities.txHashes, [SIG]);
  });

  it("does not lowercase Solana pubkeys when inheriting", () => {
    const next = intent("what about its liquidity?", [{ role: "user", content: `token ${USDC_MINT}` }]);
    assert.equal(next.entities.addresses[0], USDC_MINT);
    assert.notEqual(next.entities.addresses[0], USDC_MINT.toLowerCase());
  });

  it("reads client-supplied context.entities.signatures", () => {
    const ctx = contextTurn({ signatures: [SIG], addresses: [USDC_MINT] });
    assert.ok(ctx);
    const via = inheritFollowUpContext(classifyIntent("explain it"), "explain it", [ctx]);
    assert.ok(via.entities.txHashes.includes(SIG) || via.entities.addresses.includes(USDC_MINT));
  });

  it("ChatRequest context.entities.signatures validates 64-byte base58", () => {
    const ok = ChatRequestSchema.parse({
      message: "explain it",
      context: { entities: { signatures: [SIG], addresses: [USDC_MINT] } },
    });
    assert.deepEqual(ok.context?.entities?.signatures, [SIG]);
    assert.throws(() => ChatRequestSchema.parse({ message: "x", context: { entities: { signatures: ["not-a-sig"] } } }));
  });

  it("HTTP follow-up with history reuses the mint", async () => {
    const providers = new ProviderRegistry().register(new FakeProvider("groq"));
    const app = createApp(createContainer(testEnv(), { logger: silentLogger, providers, tools: new ToolRegistry() }));
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "what about its liquidity?",
        history: [{ role: "user", content: `Analyze this token ${USDC_MINT}` }],
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { plan: { entities: { addresses: string[] } } };
    assert.ok(body.plan.entities.addresses.includes(USDC_MINT));
  });

  it("does not inherit when the new message names its own mint", () => {
    const other = base58Encode(new Uint8Array(32).fill(99));
    const next = intent(`price of ${other}`, [{ role: "user", content: `Analyze this token ${USDC_MINT}` }]);
    assert.deepEqual(next.entities.addresses, [other]);
    assert.ok(!next.entities.addresses.includes(USDC_MINT));
  });
});
