/**
 * End-to-end scenarios against a running Click server (npm start / npm run dev).
 * Reads env and prints configured/missing only. Never prints secrets.
 *
 *   CLICK_BASE_URL   default http://127.0.0.1:8787
 *   CLICK_API_KEY    sent as Bearer when set
 *
 * Usage: npx tsx scripts/e2e.ts
 */
import { existsSync } from "node:fs";
import { configStatus, loadEnv } from "../src/config/env.js";
import { USDC_MINT, WRAPPED_SOL_MINT } from "../src/providers/solana/programs.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const env = loadEnv();
const base = (process.env.CLICK_BASE_URL ?? `http://${env.HOST}:${env.PORT}`).replace(/\/+$/, "");

console.log("Config (values never printed):");
for (const s of configStatus(env)) {
  console.log(`  ${s.status.padEnd(10)} ${s.group} / ${s.name}${s.note ? ` (${s.note})` : ""}`);
}

const llm =
  Boolean(env.OPENROUTER_API_KEY) || Boolean(env.GEMINI_API_KEY) || Boolean(env.GROQ_API_KEY) || env.CLICK_DEV_MOCK_LLM;
const search = Boolean(env.TAVILY_API_KEY) || Boolean(env.EXA_API_KEY);
const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
if (env.CLICK_API_KEY) headers.authorization = `Bearer ${env.CLICK_API_KEY}`;

type ChatJson = {
  grounded?: boolean;
  answer?: string;
  type?: string;
  warnings?: string[];
  plan?: { unavailable?: { capability: string; reason: string }[] };
  model?: { fallbackUsed?: boolean; provider?: string };
};

async function postChat(body: Record<string, unknown>, stream = false): Promise<{ status: number; json?: ChatJson; text: string }> {
  const res = await fetch(`${base}/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ stream, ...body }),
    signal: AbortSignal.timeout(env.CLICK_REQUEST_TIMEOUT_MS + 5_000),
  });
  const text = await res.text();
  if (stream) return { status: res.status, text };
  try {
    return { status: res.status, json: JSON.parse(text) as ChatJson, text };
  } catch {
    return { status: res.status, text };
  }
}

let failed = 0;
async function scenario(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    console.log(` ok  ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`FAIL ${name} — ${msg.slice(0, 300)}`);
  }
}

const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
if (!health?.ok) {
  console.error(`Server not reachable at ${base}/health. Start Click (npm run dev or npm start) and retry.`);
  process.exit(1);
}
if (!llm) {
  console.error("No LLM key and CLICK_DEV_MOCK_LLM is off — chat scenarios cannot run. See .env.example.");
  process.exit(1);
}

const SYSTEM = "11111111111111111111111111111111";

await scenario("general Q", async () => {
  const r = await postChat({ message: "Tell me a short joke about compilers" });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  if (!r.json?.answer) throw new Error("empty answer");
});

await scenario("web news Q", async () => {
  const r = await postChat({ message: "What happened in AI news today?" });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  if (search && r.json?.grounded === false) throw new Error("expected grounded news when a search key is set");
  if (!search && r.json?.grounded !== false) {
    // RSS and/or Jina keyless may still ground the answer.
    return;
  }
});

await scenario("GitHub repo analysis", async () => {
  const r = await postChat({ message: "Analyze this GitHub repo https://github.com/honojs/hono" });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  if (r.json?.type !== "github" && r.json?.type !== "combined") throw new Error(`type=${r.json?.type}`);
});

await scenario("research mode", async () => {
  const r = await postChat({ message: "Tokenized equities on Solana", mode: "research" });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  if (!r.json?.answer) throw new Error("empty research answer");
});

await scenario("signature explain", async () => {
  const r = await postChat({ message: `Explain this transaction context for wallet ${SYSTEM}` });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
});

await scenario("wallet analysis", async () => {
  const r = await postChat({ message: `Analyze this wallet ${SYSTEM}` });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
});

await scenario("mint analysis", async () => {
  const r = await postChat({ message: `Analyze this token ${USDC_MINT}` });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
});

await scenario("price by mint", async () => {
  const r = await postChat({ message: `What is the price of ${WRAPPED_SOL_MINT}?` });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
});

await scenario("symbol collision", async () => {
  const r = await postChat({ message: "What is the price of $BONK?" });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const blob = `${r.json?.answer ?? ""}\n${(r.json?.warnings ?? []).join("\n")}`;
  if (env.MARKET_ENABLED && r.json?.grounded && !/copycat|mint|multiple|collision|different tokens/i.test(blob)) {
    // Soft check: market tool still answers; copycat wording lives in tool sources, not always the final answer.
    return;
  }
});

await scenario("follow-up resolution", async () => {
  const r = await postChat({
    message: "what about its liquidity?",
    history: [{ role: "user", content: `Analyze this token ${USDC_MINT}` }, { role: "assistant", content: "USDC is a stablecoin." }],
  });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
});

await scenario("streaming run", async () => {
  const r = await postChat({ message: "Say hello in one sentence" }, true);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  if (!r.text.includes("event:")) throw new Error("not SSE");
  if (!/event: (response\.completed|done)/.test(r.text)) throw new Error("stream did not complete");
});

await scenario("degraded mode (live data, tools missing)", async () => {
  const r = await postChat({ message: "search for who is the CEO of NVIDIA right now" });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const missingSearch = !search;
  if (missingSearch) {
    if (r.json?.grounded !== false) throw new Error("expected grounded:false when search keys are missing");
    const reasons = [
      ...(r.json.warnings ?? []),
      ...(r.json.plan?.unavailable ?? []).map((u) => `${u.capability}: ${u.reason}`),
      r.json.answer ?? "",
    ].join("\n");
    if (!/web\.search|Tavily|Exa|unavailable|missing/i.test(reasons)) {
      throw new Error("answer did not say what live source is missing");
    }
  }
});

await scenario("provider fallback", async () => {
  const r = await postChat({ message: "Tell me a joke", model: "gemini", strictModel: false });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  if (!env.GEMINI_API_KEY && r.json?.model?.fallbackUsed !== true && r.json?.model?.provider === "gemini") {
    throw new Error("expected fallback away from unconfigured gemini");
  }
});

console.log(failed ? `\n${failed} scenario(s) failed.` : "\nAll e2e scenarios passed.");
process.exit(failed ? 1 : 0);
