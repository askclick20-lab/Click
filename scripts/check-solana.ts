/**
 * Live Solana + GeckoTerminal sanity check.
 * Prints configured/missing/default/disabled only — never RPC URLs, keys, or hashes from env.
 *
 * Usage: npx tsx scripts/check-solana.ts
 */
import { existsSync } from "node:fs";
import { configStatus, loadEnv } from "../src/config/env.js";
import { geckoClientFor } from "../src/providers/market/client.js";
import { rpcClientFor } from "../src/providers/solana/client.js";
import { WRAPPED_SOL_MINT } from "../src/providers/solana/programs.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const env = loadEnv();

console.log("Config (values never printed):");
for (const s of configStatus(env).filter((r) => r.group.startsWith("chain") || r.group.startsWith("market") || r.group.startsWith("llm"))) {
  console.log(`  ${s.status.padEnd(10)} ${s.name}${s.note ? ` (${s.note})` : ""}`);
}

const signal = AbortSignal.timeout(30_000);
const rpcBudget = { signal, rpcCalls: 0, maxRpcCalls: 12 };
const rpc = rpcClientFor(env);
let failed = 0;

async function step(name: string, run: () => Promise<string>): Promise<void> {
  try {
    const detail = await run();
    console.log(` ok  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`FAIL ${name} — ${msg.slice(0, 200)}`);
  }
}

await step("getGenesisHash", async () => {
  const hash = await rpc.getGenesisHash(rpcBudget);
  return `len=${hash.length}`;
});
await step("getSlot", async () => {
  const slot = await rpc.getSlot(rpcBudget);
  return `slot=${slot}`;
});
await step("getTokenSupply wSOL", async () => {
  const supply = await rpc.getTokenSupply(WRAPPED_SOL_MINT, rpcBudget);
  const amount = supply.value?.amount ?? "?";
  return `amount=${amount}`;
});
await step("signature lookup", async () => {
  const sigs = await rpc.getSignaturesForAddress(WRAPPED_SOL_MINT, rpcBudget, { limit: 1 });
  const sig = sigs[0]?.signature;
  if (!sig) return "no recent signature on wSOL mint";
  const status = await rpc.getSignatureStatuses([sig], rpcBudget, true);
  const n = Array.isArray(status?.value) ? status.value.length : 0;
  return `statuses=${n}`;
});

const gecko = geckoClientFor(env);
const marketBudget = { signal, calls: 0, maxCalls: 6 };
const net = env.GECKOTERMINAL_NETWORK;
await step("GeckoTerminal token (wSOL)", async () => {
  const r = await gecko.get(`/networks/${net}/tokens/${WRAPPED_SOL_MINT}`, "meta", marketBudget);
  return r ? `stale=${Boolean(r.stale)}` : "404 (no token resource)";
});
await step("GeckoTerminal trending", async () => {
  const r = await gecko.get<{ data?: unknown[] }>(`/networks/${net}/trending_pools`, "trending", marketBudget);
  const n = Array.isArray(r?.body.data) ? r.body.data.length : 0;
  return r ? `pools=${n}` : "404";
});

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll Solana live checks passed.");
process.exit(failed ? 1 : 0);
