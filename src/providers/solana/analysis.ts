import type { SolanaConfig } from "../../config/solana.js";
import { toClickError, ClickError } from "../../core/errors.js";
import type { Entities } from "../../router/intent.js";
import { sanitizeUntrusted } from "../../security/untrusted.js";
import { formatLamports, shortAddress } from "../../solana/address.js";
import { explorerLinks } from "./explorer.js";
import type { HeliusClient } from "./helius.js";
import { labelProgramId, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, USDC_MINT, WRAPPED_SOL_MINT, knownPrograms } from "./programs.js";
import { SolanaRpcClient } from "./rpc.js";
import { classifyInput, isSignature, isSolanaAddress, validatePubkey, validateSignature } from "./validate.js";
import type { AnalysisBudget, OnchainLimits } from "./types.js";

export type OnchainKind = "transaction" | "address" | "token" | "block" | "network";

export interface OnchainQuery {
  kind: OnchainKind;
  txHashes: string[];
  addresses: string[];
  block?: number | "latest";
  /** When true, Helius enhanced parse may run (explicit explain-transaction questions). */
  explainTransaction: boolean;
  invalid: { value: string; reason: string }[];
}

const BASE58_CANDIDATE = /\b[1-9A-HJ-NP-Za-km-z]{26,90}\b/g;
const KNOWN_MINTS = new Set(knownPrograms().filter((p) => p.kind === "mint").map((p) => p.id));

export function planOnchainQuery(question: string, entities: Entities, maxTargets: number): OnchainQuery {
  const invalid: OnchainQuery["invalid"] = [];
  const addresses: string[] = [];
  const txHashes: string[] = [];

  for (const m of question.matchAll(BASE58_CANDIDATE)) {
    const token = m[0]!;
    const kind = classifyInput(token);
    if (kind === "signature") {
      const v = validateSignature(token);
      if (v.ok) txHashes.push(v.address);
      else invalid.push({ value: token, reason: v.reason });
    } else if (kind === "address") {
      const v = validatePubkey(token);
      if (v.ok) addresses.push(v.address);
      else invalid.push({ value: token, reason: v.reason });
    } else {
      invalid.push({ value: token, reason: "not a valid Solana address or transaction signature" });
    }
  }
  for (const h of entities.txHashes) {
    const v = validateSignature(h);
    if (v.ok && !txHashes.includes(v.address)) txHashes.push(v.address);
  }
  for (const a of entities.addresses) {
    const v = validatePubkey(a);
    if (v.ok && !addresses.includes(v.address)) addresses.push(v.address);
  }

  const slotMatch = /\b(?:slot|block)\s*(?:#|number\s*)?(\d{1,12})\b/i.exec(question);
  const block =
    slotMatch ? Number(slotMatch[1]) : /\b(latest|last|current|newest)\s+(?:slot|block)\b/i.test(question) ? ("latest" as const) : undefined;

  const explainTransaction = /\bexplain\b.{0,40}\b(transaction|tx)\b/i.test(question);
  const tokenFocus = /\b(mint|token|supply|holders?|decimals|freeze|authority)\b/i.test(question);

  let kind: OnchainKind = "network";
  if (txHashes.length) kind = "transaction";
  else if (block !== undefined) kind = "block";
  else if (addresses.length) {
    const mintLike = addresses.some((a) => KNOWN_MINTS.has(a) || tokenFocus);
    kind = mintLike || (addresses.length === 1 && tokenFocus) ? "token" : "address";
  } else if (/\b(solana|network|chain|tps|epoch|slot height|block height|performance)\b/i.test(question)) kind = "network";

  return {
    kind,
    txHashes: [...new Set(txHashes)].slice(0, maxTargets),
    addresses: [...new Set(addresses)].slice(0, maxTargets),
    ...(block !== undefined ? { block } : {}),
    explainTransaction,
    invalid: invalid.slice(0, 10),
  };
}

export interface Section {
  title: string;
  url?: string;
  content: string;
  relevance: number;
}

export class AnalysisContext {
  readonly notices = new Set<string>();
  readonly citable = new Set<string>();
  readonly flags = new Set<string>();
  readonly links;
  rpcDown?: string;

  constructor(
    readonly cluster: SolanaConfig,
    readonly rpc: SolanaRpcClient,
    readonly helius: HeliusClient | undefined,
    readonly budget: AnalysisBudget,
    readonly limits: OnchainLimits,
  ) {
    this.links = explorerLinks(cluster);
  }

  link(kind: "tx" | "account" | "token" | "block", id: string | number): string | undefined {
    const url =
      kind === "tx"
        ? this.links.tx(String(id))
        : kind === "account"
          ? this.links.account(String(id))
          : kind === "token"
            ? this.links.token(String(id))
            : this.links.block(id);
    if (url) this.citable.add(url);
    return url;
  }

  clean(text: string): string {
    const { text: out, flags } = sanitizeUntrusted(text, { mode: "text" });
    if (flags.length) {
      for (const f of flags) this.flags.add(f);
      this.notices.add(`Possible prompt injection: instruction-like text was removed from token name/symbol/memo (${[...this.flags].join(", ")}).`);
    }
    return out.slice(0, 500);
  }

  async optionalRpc<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (this.rpcDown) return undefined;
    try {
      return await fn();
    } catch (err) {
      const e = toClickError(err, "rpc");
      if (e.kind === "aborted") throw e;
      if (/cluster mismatch/i.test(e.message)) throw e;
      if (e.kind === "not_found") return undefined;
      this.notices.add(`Could not read ${what} from RPC (${e.kind}).`);
      return undefined;
    }
  }
}

export async function analyzeTransaction(signature: string, ctx: AnalysisContext, explain: boolean): Promise<Section[]> {
  const url = ctx.link("tx", signature);
  const tx = await ctx.optionalRpc(`transaction ${shortAddress(signature)}`, () =>
    ctx.rpc.getTransaction(signature, ctx.budget, ctx.cluster.liveCommitment),
  );
  if (!tx) {
    return [
      {
        title: `Transaction ${shortAddress(signature)}`,
        ...(url ? { url } : {}),
        content: "Not found at this commitment or pruned from this RPC's ledger.",
        relevance: 0.9,
      },
    ];
  }

  const meta = (tx as { meta?: Record<string, unknown> }).meta ?? {};
  const err = meta.err;
  const fee = Number(meta.fee ?? 0);
  const slot = (tx as { slot?: number }).slot;
  const blockTime = (tx as { blockTime?: number | null }).blockTime;
  const logs = Array.isArray(meta.logMessages) ? meta.logMessages.slice(0, ctx.limits.maxLogLines) : [];
  const cu = meta.computeUnitsConsumed;

  let heliusNote = "";
  if (explain && ctx.helius) {
    const parsed = await ctx.helius.parseTransaction(signature, ctx.budget).catch(() => undefined);
    if (parsed?.description) heliusNote = `\nHelius summary: ${ctx.clean(parsed.description)}`;
    else if (explain) ctx.notices.add("Helius enhanced transaction parse unavailable; using RPC fields only.");
  }

  const message = (tx as { transaction?: { message?: { accountKeys?: unknown[]; instructions?: unknown[] } } }).transaction?.message;
  const keys = Array.isArray(message?.accountKeys) ? message!.accountKeys : [];
  const signers = keys
    .filter((k) => typeof k === "object" && k && (k as { signer?: boolean }).signer)
    .map((k) => (typeof k === "string" ? k : (k as { pubkey?: string }).pubkey))
    .filter((x): x is string => Boolean(x));

  const byProgram = new Map<string, number>();
  for (const ix of message?.instructions ?? []) {
    const pid = typeof ix === "object" && ix ? String((ix as { programId?: string }).programId ?? "unknown") : "unknown";
    byProgram.set(pid, (byProgram.get(pid) ?? 0) + 1);
  }
  const programLines = [...byProgram.entries()].map(([id, n]) => `- ${labelProgramId(id) ?? `unknown program ${id}`}: ${n} instruction(s)`);

  const tokenLines = formatTokenDeltas(meta);
  const solLines = formatSolDeltas(meta, keys);

  const body = [
    `Status: ${err ? `failed (${JSON.stringify(err)})` : "success"}`,
    `Slot: ${slot ?? "unknown"}`,
    blockTime ? `Block time (UTC): ${new Date(blockTime * 1000).toISOString()}` : "Block time: unavailable",
    `Commitment: ${ctx.cluster.liveCommitment}`,
    `Fee: ${formatLamports(BigInt(fee))} SOL`,
    cu !== undefined ? `Compute units: ${cu}` : undefined,
    signers.length ? `Signers: ${signers.map(shortAddress).join(", ")}` : undefined,
    programLines.length ? `Programs:\n${programLines.join("\n")}` : undefined,
    solLines.length ? `SOL balance changes:\n${solLines.join("\n")}` : undefined,
    tokenLines.length ? `SPL token balance changes:\n${tokenLines.join("\n")}` : undefined,
    logs.length ? `Logs (top ${logs.length}):\n${logs.map((l) => `- ${ctx.clean(String(l))}`).join("\n")}` : undefined,
    heliusNote,
  ]
    .filter(Boolean)
    .join("\n");

  return [{ title: `Transaction ${shortAddress(signature)}`, ...(url ? { url } : {}), content: body, relevance: 1 }];
}

function formatSolDeltas(meta: Record<string, unknown>, keys: unknown[]): string[] {
  const pre = meta.preBalances as number[] | undefined;
  const post = meta.postBalances as number[] | undefined;
  if (!Array.isArray(pre) || !Array.isArray(post)) return [];
  const out: string[] = [];
  for (let i = 0; i < Math.min(pre.length, post.length, keys.length); i++) {
    const delta = post[i]! - pre[i]!;
    if (!delta) continue;
    const pk = typeof keys[i] === "string" ? keys[i] : (keys[i] as { pubkey?: string })?.pubkey;
    if (typeof pk !== "string" || !isSolanaAddress(pk)) continue;
    out.push(`- ${shortAddress(pk)}: ${delta > 0 ? "+" : ""}${formatLamports(BigInt(delta))} SOL`);
  }
  return out.slice(0, 20);
}

function formatTokenDeltas(meta: Record<string, unknown>): string[] {
  const pre = (meta.preTokenBalances as { owner?: string; mint?: string; uiTokenAmount?: { amount?: string; decimals?: number } }[]) ?? [];
  const post = (meta.postTokenBalances as { owner?: string; mint?: string; uiTokenAmount?: { amount?: string; decimals?: number } }[]) ?? [];
  const map = new Map<string, { owner: string; mint: string; pre: bigint; post: bigint; decimals: number }>();
  const ingest = (rows: typeof pre, field: "pre" | "post") => {
    for (const r of rows) {
      if (!r.owner || !r.mint || !isSolanaAddress(r.owner) || !isSolanaAddress(r.mint)) continue;
      const key = `${r.owner}:${r.mint}`;
      const amt = BigInt(r.uiTokenAmount?.amount ?? "0");
      const dec = r.uiTokenAmount?.decimals ?? 0;
      const cur = map.get(key) ?? { owner: r.owner, mint: r.mint, pre: 0n, post: 0n, decimals: dec };
      cur[field] = amt;
      map.set(key, cur);
    }
  };
  ingest(pre, "pre");
  ingest(post, "post");
  const lines: string[] = [];
  for (const v of map.values()) {
    const delta = v.post - v.pre;
    if (delta === 0n) continue;
    const sym = v.mint === USDC_MINT ? "USDC" : v.mint === WRAPPED_SOL_MINT ? "wSOL" : shortAddress(v.mint);
    lines.push(`- ${shortAddress(v.owner)} / ${sym}: ${delta > 0n ? "+" : ""}${formatTokenAmount(delta, v.decimals)}`);
  }
  return lines.slice(0, 25);
}

function formatTokenAmount(amount: bigint, decimals: number): string {
  if (decimals <= 0) return amount.toString();
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""}`;
}

export async function analyzeAddress(address: string, ctx: AnalysisContext): Promise<Section[]> {
  const url = ctx.link("account", address);
  const balance = await ctx.optionalRpc("balance", () => ctx.rpc.getBalance(address, ctx.budget));
  const info = await ctx.optionalRpc("account info", () => ctx.rpc.getAccountInfo(address, ctx.budget));
  const value = (info as { value?: { owner?: string; executable?: boolean; lamports?: number; data?: unknown } | null })?.value;

  const holdings: string[] = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const rows = await ctx.optionalRpc(`token accounts (${programId})`, () =>
      ctx.rpc.getTokenAccountsByOwner(address, programId, ctx.budget),
    );
    for (const row of rows?.value ?? []) {
      const parsed = (row as { account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string; decimals?: number }; mint?: string } } } } }).account?.data?.parsed?.info;
      const amt = BigInt(parsed?.tokenAmount?.amount ?? "0");
      if (amt === 0n) continue;
      const mint = parsed?.mint;
      if (!mint || !isSolanaAddress(mint)) continue;
      const sym = mint === USDC_MINT ? "USDC" : mint === WRAPPED_SOL_MINT ? "wSOL" : shortAddress(mint);
      holdings.push(`- ${sym} (${shortAddress(mint)}): ${formatTokenAmount(amt, parsed?.tokenAmount?.decimals ?? 0)}`);
      if (holdings.length >= ctx.limits.maxTokenAccounts) break;
    }
  }

  const sigs = await ctx.optionalRpc("recent signatures", () =>
    ctx.rpc.getSignaturesForAddress(address, ctx.budget, { limit: ctx.limits.maxTransactions }),
  );

  const classification = classifyAccount(address, value);
    const sigLines = (sigs ?? []).slice(0, ctx.limits.maxTransactions).map((s) => {
      const memo = s.memo ? ` memo: ${ctx.clean(s.memo)}` : "";
      return `- ${s.signature} (slot ${s.slot})${memo}`;
    });

  const body = [
    `Classification: ${classification}`,
    balance !== undefined ? `SOL balance: ${formatLamports(BigInt(balance))}` : undefined,
    value
      ? `Owner program: ${value.owner ?? "unknown"} (${labelProgramId(value.owner ?? "") ?? "unlabeled"}) · executable: ${value.executable ? "yes" : "no"} · data size: ${dataSize(value.data)} bytes`
      : "Account not found or empty.",
    holdings.length ? `Token holdings (non-zero, bounded):\n${holdings.join("\n")}` : "Token holdings: none found via RPC (or all zero).",
    sigLines.length ? `Recent signatures (bounded):\n${sigLines.join("\n")}` : "Recent signatures: none returned.",
    "RPC cannot provide: address labels, real-world owner identity, holder counts, or daily transaction statistics.",
  ]
    .filter(Boolean)
    .join("\n");

  return [{ title: `Account ${shortAddress(address)}`, ...(url ? { url } : {}), content: body, relevance: 1 }];
}

function dataSize(data: unknown): number {
  if (!data) return 0;
  if (Array.isArray(data) && typeof data[1] === "string") return Math.floor((data[1] as string).length * 3 / 4);
  if (typeof data === "object" && data && "space" in data) return Number((data as { space: number }).space) || 0;
  return 0;
}

function classifyAccount(address: string, value: { owner?: string; executable?: boolean; data?: unknown } | null | undefined): string {
  if (!value) return "not found";
  if (address === WRAPPED_SOL_MINT || KNOWN_MINTS.has(address)) return "token mint";
  if (value.owner === TOKEN_PROGRAM_ID || value.owner === TOKEN_2022_PROGRAM_ID) return "token account";
  if (value.executable) return "program";
  if (value.owner === "11111111111111111111111111111111") return "system wallet";
  return "other account";
}

export async function analyzeTokenMint(mint: string, ctx: AnalysisContext): Promise<Section[]> {
  const url = ctx.link("token", mint);
  const v = validatePubkey(mint);
  if (!v.ok) {
    return [{ title: "Input validation", content: `${v.reason}. Not queried.`, relevance: 1 }];
  }
  const info = await ctx.optionalRpc("mint account", () => ctx.rpc.getAccountInfo(mint, ctx.budget));
  const parsed = (info as { value?: { owner?: string; data?: { parsed?: { type?: string; info?: Record<string, unknown> } } } })?.value?.data?.parsed;
  const tokenInfo = parsed?.info ?? {};
  const supplyResp = await ctx.optionalRpc("token supply", () => ctx.rpc.getTokenSupply(mint, ctx.budget));
  const supply = supplyResp?.value?.amount ? BigInt(supplyResp.value.amount) : undefined;
  const decimals = supplyResp?.value?.decimals ?? Number(tokenInfo.decimals ?? 0);
  const largest = await ctx.optionalRpc("largest accounts", () => ctx.rpc.getTokenLargestAccounts(mint, ctx.budget));

  let nameSymbol = "";
  if (ctx.helius) {
    const asset = await ctx.helius.getAsset(mint, ctx.budget).catch(() => undefined);
    const name = asset?.content?.metadata?.name;
    const symbol = asset?.content?.metadata?.symbol;
    // DAS may include json_uri / metadata URIs; never fetch them (deployer-controlled).
    if (name || symbol) nameSymbol = `Name/symbol (Helius DAS): ${ctx.clean(name ?? "?")} / ${ctx.clean(symbol ?? "?")}`;
    else nameSymbol = "Name/symbol unavailable from Helius for this mint.";
  } else if (parsed?.type === "mint" && tokenInfo) {
    nameSymbol = "Name/symbol unavailable without a DAS key (no on-chain Token-2022 metadata extension in RPC response).";
  } else {
    nameSymbol = "Name/symbol unavailable without a DAS key.";
  }

  const holderLines: string[] = [];
  for (const row of (largest?.value ?? []).slice(0, 20)) {
    const amt = BigInt(row.amount ?? "0");
    const pct = supply && supply > 0n ? Number((amt * 10000n) / supply) / 100 : undefined;
    const addr = row.address;
    if (!addr || !isSolanaAddress(addr)) continue;
    holderLines.push(`- ${shortAddress(addr)}: ${formatTokenAmount(amt, decimals)}${pct !== undefined ? ` (${pct}% of supply)` : ""}`);
  }

  const body = [
    `Program: ${parsed?.type === "mint" ? (info as { value?: { owner?: string } }).value?.owner ?? "unknown" : "unknown"} (${labelProgramId((info as { value?: { owner?: string } }).value?.owner ?? "") ?? "SPL"})`,
    `Decimals: ${decimals}`,
    supply !== undefined ? `Supply: ${formatTokenAmount(supply, decimals)}` : "Supply: unavailable",
    `Mint authority: ${tokenInfo.mintAuthority ?? "null (renounced)"}`,
    `Freeze authority: ${tokenInfo.freezeAuthority ?? "null (renounced)"}`,
    nameSymbol,
    holderLines.length ? `Top holders (RPC, bounded):\n${holderLines.join("\n")}` : "Top holders: unavailable.",
    "Metadata URIs are never fetched.",
  ].join("\n");

  return [{ title: `Token mint ${shortAddress(mint)}`, ...(url ? { url } : {}), content: body, relevance: 1 }];
}

export async function analyzeBlock(block: number | "latest", ctx: AnalysisContext): Promise<Section[]> {
  const slot =
    block === "latest"
      ? await ctx.optionalRpc("latest slot", () => ctx.rpc.getSlot(ctx.budget))
      : block;
  if (slot === undefined) {
    return [{ title: "Block / slot", content: "Could not read slot from RPC.", relevance: 0.8 }];
  }
  const url = ctx.link("block", slot);
  const blk = await ctx.optionalRpc(`block ${slot}`, () => ctx.rpc.getBlock(slot, ctx.budget));
  if (!blk) {
    return [{ title: `Slot ${slot}`, ...(url ? { url } : {}), content: "Block not found at this commitment or pruned from this RPC's ledger.", relevance: 0.9 }];
  }
  const time = (blk as { blockTime?: number | null }).blockTime;
  const sigs = (blk as { signatures?: string[] }).signatures ?? [];
  const body = [
    `Slot: ${slot}`,
    time ? `Block time (UTC): ${new Date(time * 1000).toISOString()}` : "Block time: unavailable",
    `Transaction signatures in block (bounded listing): ${sigs.length}`,
    ...sigs.slice(0, 15).map((s) => (isSignature(s) ? `- ${s}` : `- (invalid signature omitted)`)),
  ].join("\n");
  return [{ title: `Slot ${slot}`, ...(url ? { url } : {}), content: body, relevance: 0.95 }];
}

export async function analyzeNetwork(ctx: AnalysisContext): Promise<Section[]> {
  const slot = await ctx.optionalRpc("slot", () => ctx.rpc.getSlot(ctx.budget));
  const height = await ctx.optionalRpc("block height", () => ctx.rpc.getBlockHeight(ctx.budget));
  const epoch = await ctx.optionalRpc("epoch info", () => ctx.rpc.getEpochInfo(ctx.budget));
  const perf = await ctx.optionalRpc("performance samples", () => ctx.rpc.getRecentPerformanceSamples(ctx.budget, 5));
  let tps = "unavailable";
  if (perf?.length) {
    const sample = perf[0]!;
    const secs = sample.samplePeriodSecs || 60;
    tps = (sample.numTransactions / secs).toFixed(2);
  }
  const progress =
    epoch && epoch.slotsInEpoch
      ? `${(((epoch.slotIndex ?? 0) / epoch.slotsInEpoch) * 100).toFixed(1)}% through epoch ${epoch.epoch}`
      : "unavailable";
  const body = [
    "Network overview (point-in-time RPC; no chain scanning).",
    slot !== undefined ? `Current slot: ${slot}` : undefined,
    height !== undefined ? `Block height: ${height}` : undefined,
    progress !== "unavailable" ? `Epoch progress: ${progress}` : undefined,
    tps !== "unavailable" ? `Estimated TPS (recent sample window): ~${tps} — sample-based, not exact` : undefined,
    "Solana slots are ~0.4s apart; do not iterate full-day slot ranges.",
  ]
    .filter(Boolean)
    .join("\n");
  return [{ title: "Solana network overview", content: body, relevance: 0.85 }];
}
