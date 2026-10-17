import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyIntent, extractEntities, inheritFollowUpContext } from "../src/router/intent.js";
import { ChatRequestSchema } from "../src/types/api.js";
import { base58Encode } from "../src/solana/base58.js";
import { TOKEN_PROGRAM_ID } from "../src/solana/constants.js";
import { USDC_MINT } from "../src/providers/solana/programs.js";

describe("intent classifier", () => {
  const cases: [string, string, string[]][] = [
    ["What happened on Solana today?", "onchain", ["onchain", "market", "news"]],
    ["Analyze this GitHub repo https://github.com/honojs/hono", "github", ["github"]],
    ["Deep research this company: Anthropic", "research", ["research"]],
    ["What is this website about? https://example.com/about", "web_extract", ["web_extract"]],
    ["What's the price and liquidity of $HOOD?", "market", ["market"]],
    ["Summarize the following paragraph: lorem ipsum", "summarize", ["summarize"]],
    ["Why does my TypeScript function throw an exception?", "coding", ["coding"]],
    ["Tell me a joke", "general", ["general"]],
  ];

  for (const [text, primary, mustInclude] of cases) {
    it(`"${text}" → ${primary}`, () => {
      const result = classifyIntent(text);
      assert.equal(result.primary, primary, `got ${result.intents.join(",")} (${result.signals.join("; ")})`);
      for (const i of mustInclude) assert.ok(result.intents.includes(i as never), `missing ${i}: ${result.intents}`);
    });
  }

  it("does not add coding for GitHub questions", () => {
    assert.ok(!classifyIntent("Explain the code in github.com/a/b").intents.includes("coding"));
  });

  it("research mode forces research", () => {
    assert.equal(classifyIntent("tokenized assets", { forceResearch: true }).primary, "research");
  });
});

describe("entity extraction", () => {
  it("distinguishes signatures from pubkeys", () => {
    const sig = base58Encode(new Uint8Array(64).fill(3));
    const e = extractEntities(`look at ${sig} from ${TOKEN_PROGRAM_ID}`);
    assert.deepEqual(e.txHashes, [sig]);
    assert.deepEqual(e.addresses, [TOKEN_PROGRAM_ID]);
  });

  it("parses GitHub repos and strips trailing punctuation from URLs", () => {
    const e = extractEntities("see https://github.com/owner/repo.git, and https://x.com/page.");
    assert.deepEqual(e.githubRepos, [{ owner: "owner", repo: "repo" }]);
    assert.ok(e.urls.includes("https://x.com/page"));
  });

  it("does not treat a sentence of base58-looking words as addresses", () => {
    const fake = base58Encode(new Uint8Array(31).fill(7));
    const e = extractEntities(`Please remember pancake banana karma among traders today ${fake}`);
    assert.deepEqual(e.addresses, []);
    assert.deepEqual(e.txHashes, []);
  });

  it("finds a real mint and a real signature", () => {
    const sig = base58Encode(new Uint8Array(64).fill(3));
    const e = extractEntities(`mint ${USDC_MINT} signed ${sig}`);
    assert.deepEqual(e.addresses, [USDC_MINT]);
    assert.deepEqual(e.txHashes, [sig]);
  });

  it("inherits a mint for 'what about its liquidity?'", () => {
    const history = [{ role: "user" as const, content: `Analyze this token ${USDC_MINT}` }];
    const intent = classifyIntent("what about its liquidity?");
    const next = inheritFollowUpContext(intent, "what about its liquidity?", history);
    assert.deepEqual(next.entities.addresses, [USDC_MINT]);
    assert.ok(next.intents.includes("market"));
  });

  it("ChatRequest context.entities is Zod-validated as Solana pubkeys/signatures", () => {
    const sig = base58Encode(new Uint8Array(64).fill(3));
    const ok = ChatRequestSchema.parse({
      message: "what about its liquidity?",
      context: { entities: { addresses: [USDC_MINT], signatures: [sig], tickers: ["USDC"] } },
    });
    assert.deepEqual(ok.context?.entities?.addresses, [USDC_MINT]);
    assert.deepEqual(ok.context?.entities?.signatures, [sig]);
    assert.throws(() =>
      ChatRequestSchema.parse({
        message: "hi",
        context: { entities: { addresses: ["RememberPancakeBananaKarmaTraders"] } },
      }),
    );
  });
});
