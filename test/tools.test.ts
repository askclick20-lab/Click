import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { silentLogger } from "../src/core/logger.js";
import { USDC_MINT } from "../src/providers/solana/programs.js";
import { classifyIntent } from "../src/router/intent.js";
import { planTools } from "../src/router/tool-router.js";
import { explainSteps } from "../src/router/unified.js";
import { collectSources, normalizeUrl } from "../src/sources/collector.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { ToolRunner } from "../src/tools/runner.js";
import { fakeTool } from "./helpers.js";

const ctx = (q: string) => ({ query: q, entities: classifyIntent(q).entities, signal: new AbortController().signal });

describe("tool router", () => {
  it("calls no tools for questions that need no live data", () => {
    const registry = new ToolRegistry().register(fakeTool({ name: "exa", capability: "web.search" }));
    const plan = planTools(classifyIntent("Tell me a joke"), "Tell me a joke", registry, { maxSteps: 4 });
    assert.equal(plan.steps.length, 0);
    assert.equal(plan.unavailable.length, 0);
  });

  it("reports capabilities with no tool as unavailable", () => {
    const q = "What happened on Solana today?";
    const plan = planTools(classifyIntent(q), q, new ToolRegistry(), { maxSteps: 4 });
    assert.deepEqual(plan.unavailable.map((u) => u.capability).sort(), ["chain.data", "market.data", "news.feed"]);
    assert.match(plan.unavailable.find((u) => u.capability === "news.feed")?.reason ?? "", /fallback web\.search: no tool installed/);
  });

  it("orders candidates cheapest first and names missing keys", () => {
    const registry = new ToolRegistry()
      .register(fakeTool({ name: "paid", capability: "web.search", costTier: "paid" }))
      .register(fakeTool({ name: "free", capability: "web.search", costTier: "free" }))
      .register(fakeTool({ name: "rpc", capability: "chain.data", configured: false }));
    const q = "search for the latest Solana wallet activity";
    const plan = planTools(classifyIntent(q), q, registry, { maxSteps: 4 });
    const search = plan.steps.find((s) => s.capability === "web.search");
    assert.deepEqual(search?.candidates.map((c) => c.tool.name), ["free", "paid"]);
    assert.match(plan.unavailable.find((u) => u.capability === "chain.data")?.reason ?? "", /RPC_KEY/);
  });

  it("Analyze this token <mint> emits parallel chain.data ∥ market.data (phase 1)", () => {
    const registry = new ToolRegistry()
      .register(fakeTool({ name: "solana-chain", capability: "chain.data" }))
      .register(fakeTool({ name: "geckoterminal", capability: "market.data" }));
    const q = `Analyze this token ${USDC_MINT}`;
    const intent = classifyIntent(q);
    const plan = planTools(intent, q, registry, { maxSteps: 6 });
    const explained = explainSteps(plan.steps, intent);
    assert.deepEqual(explained.map((s) => s.capability).sort(), ["chain.data", "market.data"]);
    assert.ok(explained.every((s) => s.phase === 1));
    assert.ok(explained.every((s) => s.stage === "primary"));
  });

  it("skips (not unavailable) tools that cannot act on the request", () => {
    const registry = new ToolRegistry().register(fakeTool({ name: "jina", capability: "web.extract", needsUrl: true }));
    const q = "Summarize this article";
    const plan = planTools(classifyIntent(q), q, registry, { maxSteps: 4 });
    assert.equal(plan.steps.length, 0);
    assert.equal(plan.unavailable.length, 0);
  });
});

describe("tool runner", () => {
  it("falls back to the next tool and records both runs", async () => {
    const exa = fakeTool({ name: "exa", capability: "web.search", fail: "quota" });
    const tavily = fakeTool({ name: "tavily", capability: "web.search" });
    const registry = new ToolRegistry().register(exa).register(tavily);
    const q = "search for who founded Solana";
    const plan = planTools(classifyIntent(q), q, registry, { maxSteps: 4 });
    const { runs, outputs } = await new ToolRunner({ logger: silentLogger, defaultTimeoutMs: 1000 }).run(plan, ctx(q));
    assert.deepEqual(runs.map((r) => [r.tool, r.status]), [["exa", "error"], ["tavily", "ok"]]);
    assert.equal(outputs[0]?.tool, "tavily");
  });

  it("caches results when the tool allows it", async () => {
    const tool = fakeTool({ name: "exa", capability: "web.search", cacheTtlSeconds: 60 });
    const registry = new ToolRegistry().register(tool);
    const runner = new ToolRunner({ logger: silentLogger, defaultTimeoutMs: 1000 });
    const q = "search for Solana docs";
    const plan = planTools(classifyIntent(q), q, registry, { maxSteps: 4 });
    await runner.run(plan, ctx(q));
    const second = await runner.run(plan, ctx(q));
    assert.equal(tool.executions, 1);
    assert.equal(second.runs[0]?.cached, true);
  });
});

describe("sources", () => {
  it("normalizes URLs for de-duplication", () => {
    assert.equal(normalizeUrl("https://WWW.Example.com/a/?utm_source=x&b=2#frag"), "https://example.com/a?b=2");
    assert.equal(normalizeUrl("javascript:alert(1)"), undefined);
  });

  it("dedupes, numbers, and drops invalid URLs", () => {
    const { sources, duplicatesRemoved } = collectSources(
      [
        { provider: "exa", sources: [{ title: "A", url: "https://example.com/a?utm_source=x", type: "web", evidence: "search_result", relevance: 0.5 }] },
        {
          provider: "tavily",
          sources: [
            { title: "A (better)", url: "https://www.example.com/a", type: "web", evidence: "retrieved_content", content: "full text", relevance: 0.9 },
            { title: "Bad", url: "not a url", type: "web", evidence: "search_result" },
          ],
        },
      ],
      { maxContextChars: 10_000 },
    );
    assert.equal(sources.length, 2);
    assert.equal(duplicatesRemoved, 1);
    assert.deepEqual(sources[0]?.alsoFoundBy, ["exa"]);
    assert.equal(sources[0]?.id, 1);
    assert.equal(sources[0]?.title, "A (better)");
    assert.equal(sources[0]?.domain, "example.com");
    assert.equal(sources.find((s) => s.title === "Bad")?.url, undefined);
  });
});
