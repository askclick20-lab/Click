import { toClickError } from "../core/errors.js";
import type { PoolFacts } from "../providers/market/analysis.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../providers/solana/programs.js";
import { isSolanaAddress } from "../solana/address.js";
import { analysisCtx, loadTokenMarket, SAFETY_DISCLAIMER, type Discovery, type RadarPoolRow } from "./discovery.js";

export interface SafetySignal {
  id: string;
  value: string | number | boolean | null | Record<string, unknown>;
  meaning: string;
  source: string;
  fetchedAt: string;
  unavailable?: boolean;
}

export interface SafetyReport {
  mint: string;
  generatedAt: string;
  signals: SafetySignal[];
  disclaimer: string;
  notices: string[];
}

const EXT_FLAGS: { id: string; keys: string[]; meaning: string }[] = [
  { id: "transfer_fee", keys: ["transferFeeConfig", "transferFeeAmount"], meaning: "A transfer fee extension is present. Transfers may deduct a fee set by the mint." },
  { id: "permanent_delegate", keys: ["permanentDelegate"], meaning: "A permanent delegate extension is present. That delegate can transfer or burn tokens without the owner's signature." },
  { id: "non_transferable", keys: ["nonTransferable", "nonTransferableAccount"], meaning: "A non-transferable extension is present. Token accounts cannot be transferred." },
  { id: "default_account_state", keys: ["defaultAccountState"], meaning: "A default account state extension is present. New accounts may start frozen or with a required state." },
  { id: "transfer_hook", keys: ["transferHook", "transferHookAccount"], meaning: "A transfer hook extension is present. Transfers invoke extra on-chain logic." },
  { id: "pausable", keys: ["pausable", "pausableConfig"], meaning: "A pausable extension is present. Transfers can be paused by the configured authority." },
  { id: "confidential_transfer", keys: ["confidentialTransferMint", "confidentialTransferFeeConfig", "confidentialTransferAccount"], meaning: "A confidential transfer extension is present. Balances and transfer amounts can be hidden." },
];

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function authorityOf(v: unknown): string | null {
  if (v === null || v === undefined || v === "" || v === "null") return null;
  return typeof v === "string" && isSolanaAddress(v) ? v : typeof v === "string" ? v : null;
}

function extensionNames(info: Record<string, unknown>): string[] {
  const raw = info.extensions;
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const ext = (row as { extension?: unknown }).extension;
    if (typeof ext === "string") names.push(ext);
  }
  return names;
}

function sharePct(part: bigint, whole: bigint): number | undefined {
  if (whole <= 0n) return undefined;
  return Number((part * 10000n) / whole) / 100;
}

export async function readSafety(d: Discovery, mint: string, signal: AbortSignal, hint?: { pools?: PoolFacts[]; rows?: RadarPoolRow[] }): Promise<SafetyReport> {
  const cached = d.safetyCache.get(mint);
  if (cached && d.now() - cached.at < 30_000) return cached.value as SafetyReport;
  return d.safetyGate.run(async () => {
    const again = d.safetyCache.get(mint);
    if (again && d.now() - again.at < 30_000) return again.value as SafetyReport;
    const report = await computeSafety(d, mint, signal, hint);
    d.safetyCache.set(mint, { at: d.now(), value: report });
    if (d.safetyCache.size > 400) {
      const oldest = d.safetyCache.keys().next().value;
      if (oldest) d.safetyCache.delete(oldest);
    }
    return report;
  });
}

async function computeSafety(d: Discovery, mint: string, signal: AbortSignal, hint?: { pools?: PoolFacts[]; rows?: RadarPoolRow[] }): Promise<SafetyReport> {
  const fetchedAt = iso(d.now());
  const notices: string[] = [];
  const signals: SafetySignal[] = [];
  const ctx = analysisCtx(d, signal);

  let mintInfo: Record<string, unknown> | undefined;
  let owner: string | undefined;
  try {
    const info = await ctx.rpc.getAccountInfo(mint, ctx.budget);
    const value = info?.value as { owner?: string; data?: { parsed?: { type?: string; info?: Record<string, unknown> } } } | null | undefined;
    owner = value?.owner;
    if (value?.data?.parsed?.type === "mint") mintInfo = value.data.parsed.info ?? {};
    else if (value) notices.push("Account is not a parsed token mint.");
  } catch (err) {
    notices.push(`Mint account read failed (${toClickError(err, "rpc").kind}).`);
  }

  const mintAuth = authorityOf(mintInfo?.mintAuthority);
  const freezeAuth = authorityOf(mintInfo?.freezeAuthority);
  signals.push({
    id: "mint_authority",
    value: mintAuth ?? null,
    meaning: mintInfo
      ? mintAuth
        ? "Mint authority is active. Additional tokens can still be minted."
        : "Mint authority is null (renounced). The supply cannot be increased by a mint authority."
      : "Mint authority was not read.",
    source: "solana-rpc:getAccountInfo",
    fetchedAt,
    ...(mintInfo ? {} : { unavailable: true }),
  });
  signals.push({
    id: "freeze_authority",
    value: freezeAuth ?? null,
    meaning: mintInfo
      ? freezeAuth
        ? "Freeze authority is active. Token accounts can be frozen."
        : "Freeze authority is null (renounced). Accounts cannot be frozen by a freeze authority."
      : "Freeze authority was not read.",
    source: "solana-rpc:getAccountInfo",
    fetchedAt,
    ...(mintInfo ? {} : { unavailable: true }),
  });

  const program =
    owner === TOKEN_2022_PROGRAM_ID ? "token-2022" : owner === TOKEN_PROGRAM_ID ? "spl-token" : owner ?? "unknown";
  const names = mintInfo ? extensionNames(mintInfo) : [];
  const present: Record<string, boolean> = {};
  for (const flag of EXT_FLAGS) present[flag.id] = flag.keys.some((k) => names.includes(k));
  signals.push({
    id: "token_program",
    value: { program, extensions: names, flags: present },
    meaning:
      program === "token-2022"
        ? `Token-2022 mint. Extensions present (factual flags, not a rating): ${EXT_FLAGS.filter((f) => present[f.id]).map((f) => f.id).join(", ") || "none of the listed set"}.`
        : program === "spl-token"
          ? "Classic SPL Token program. Token-2022 extensions are not used on this mint."
          : "Token program could not be classified from the account owner.",
    source: "solana-rpc:getAccountInfo",
    fetchedAt,
  });
  for (const flag of EXT_FLAGS) {
    signals.push({
      id: flag.id,
      value: present[flag.id] ?? false,
      meaning: present[flag.id] ? flag.meaning : `No ${flag.id.replace(/_/g, " ")} extension was listed on this mint.`,
      source: "solana-rpc:getAccountInfo",
      fetchedAt,
    });
  }

  let supply: bigint | undefined;
  let decimals: number | undefined;
  try {
    const supplyResp = await ctx.rpc.getTokenSupply(mint, ctx.budget);
    if (supplyResp?.value?.amount) supply = BigInt(supplyResp.value.amount);
    decimals = supplyResp?.value?.decimals ?? (typeof mintInfo?.decimals === "number" ? mintInfo.decimals : undefined);
  } catch (err) {
    notices.push(`Token supply read failed (${toClickError(err, "rpc").kind}).`);
  }
  signals.push({
    id: "supply",
    value: { amount: supply?.toString() ?? null, decimals: decimals ?? null },
    meaning: supply !== undefined ? `Reported supply ${supply.toString()} with ${decimals ?? "unknown"} decimals.` : "Supply was not reported.",
    source: "solana-rpc:getTokenSupply",
    fetchedAt,
    ...(supply === undefined ? { unavailable: true } : {}),
  });

  let top1: number | undefined;
  let top5: number | undefined;
  let top10: number | undefined;
  let holderCount = 0;
  try {
    const largest = await ctx.rpc.getTokenLargestAccounts(mint, ctx.budget);
    const rows = (largest?.value ?? []).filter((r) => isSolanaAddress(r.address));
    holderCount = rows.length;
    if (supply && supply > 0n) {
      const amts = rows.map((r) => BigInt(r.amount ?? "0"));
      const sum = (n: number) => amts.slice(0, n).reduce((a, b) => a + b, 0n);
      top1 = sharePct(sum(1), supply);
      top5 = sharePct(sum(5), supply);
      top10 = sharePct(sum(10), supply);
    }
  } catch (err) {
    notices.push(`Largest accounts read failed (${toClickError(err, "rpc").kind}).`);
  }
  signals.push({
    id: "holder_concentration",
    value: { top1Pct: top1 ?? null, top5Pct: top5 ?? null, top10Pct: top10 ?? null, accountsReturned: holderCount },
    meaning:
      top1 === undefined
        ? "Holder concentration was not computed (supply or largest-account list missing)."
        : `Largest reported accounts hold about ${top1}% (top 1), ${top5 ?? "n/a"}% (top 5), ${top10 ?? "n/a"}% (top 10) of supply. LP vaults, burn addresses and exchanges can appear among top holders and are not auto-classified.`,
    source: "solana-rpc:getTokenLargestAccounts",
    fetchedAt,
    ...(top1 === undefined ? { unavailable: true } : {}),
  });

  let pools = hint?.pools;
  let marketFetchedAt = fetchedAt;
  if (!pools && !hint?.rows?.length) {
    try {
      const m = await loadTokenMarket(d, mint, signal);
      pools = m.pools;
      marketFetchedAt = m.fetchedAt ?? fetchedAt;
      notices.push(...m.notices);
    } catch (err) {
      notices.push(`Market data failed (${toClickError(err, "market").kind}).`);
      pools = [];
    }
  }
  const row = hint?.rows?.find((r) => r.token?.address === mint);
  const liq = pools?.reduce((s, p) => s + (p.liquidityUsd ?? 0), 0) || row?.liquidityUsd;
  const vol = pools?.reduce((s, p) => s + (p.volumeUsd.h24 ?? 0), 0) || row?.volume24hUsd;
  const age = pools?.map((p) => p.createdAt).filter(Boolean).sort()[0] ?? row?.createdAt;
  const buys = pools?.reduce((s, p) => s + (p.txns.h24?.buys ?? 0), 0) || row?.buys;
  const sells = pools?.reduce((s, p) => s + (p.txns.h24?.sells ?? 0), 0) || row?.sells;
  const ratio = liq && liq > 0 && vol !== undefined ? vol / liq : undefined;
  const huge = ratio !== undefined && ratio >= 10;
  signals.push({
    id: "liquidity",
    value: {
      liquidityUsd: liq ?? null,
      poolAge: age ?? null,
      volume24hUsd: vol ?? null,
      volumeToLiquidity: ratio ?? null,
      hugeVolumeOnTinyLiquidity: huge,
      pools: pools?.length ?? null,
      buys24h: buys ?? null,
      sells24h: sells ?? null,
      buysSellsRatio: buys !== undefined && sells !== undefined && sells > 0 ? buys / sells : null,
    },
    meaning: huge
      ? `24h volume is at least 10× reported liquidity (${ratio?.toFixed(1)}×). That is a factual ratio, not a verdict.`
      : liq !== undefined
        ? `Reported DEX liquidity about $${liq.toLocaleString("en-US")} across ${pools?.length ?? 0} pool(s).`
        : "DEX liquidity was not reported.",
    source: "geckoterminal",
    fetchedAt: marketFetchedAt,
    ...(liq === undefined ? { unavailable: true } : {}),
  });

  const launchDex = [...(pools ?? []).map((p) => p.dex), row?.dex].find((dex) => dex && /pump-?fun|moonshot|letsbonk|launchlab|raydium-launch|boop|meteora-dbc|virtuals/i.test(dex));
  const lp = hint?.rows?.find((r) => r.token?.address === mint)?.token?.launchpad;
  signals.push({
    id: "launchpad",
    value: {
      dex: launchDex ?? null,
      bondingCurve: Boolean(launchDex),
      migrated: lp?.completed ?? Boolean(lp?.migratedPool) ?? null,
      migratedPool: lp?.migratedPool ?? null,
    },
    meaning: launchDex
      ? `Pool DEX id "${launchDex}" indicates a bonding-curve launchpad. ${lp?.completed || lp?.migratedPool ? "GeckoTerminal reports the token as migrated." : "Migration status is only stated when the API returns it."}`
      : "No bonding-curve launchpad DEX id was present in the returned pools.",
    source: "geckoterminal",
    fetchedAt: marketFetchedAt,
  });

  if (d.helius) {
    try {
      const asset = await d.helius.getAsset(mint, ctx.budget);
      const update = asset?.authorities?.find((a) => a.scopes?.some((s) => /full|metadata|update/i.test(s)))?.address ?? null;
      signals.push({
        id: "metadata",
        value: { mutable: asset?.mutable ?? null, updateAuthority: update, uriFetched: false },
        meaning:
          asset?.mutable === false
            ? "DAS reports metadata as immutable. Update authority is listed when present. Metadata URIs are never fetched."
            : asset?.mutable === true
              ? "DAS reports metadata as mutable. The update authority can still change name/symbol/URI. Metadata URIs are never fetched."
              : "DAS did not report mutability. Metadata URIs are never fetched.",
        source: "helius-das:getAsset",
        fetchedAt,
      });
    } catch {
      signals.push({
        id: "metadata",
        value: "not checked",
        meaning: "DAS was configured but the asset lookup failed. Metadata mutability was not checked. Metadata URIs are never fetched.",
        source: "helius-das:getAsset",
        fetchedAt,
        unavailable: true,
      });
    }
  } else {
    signals.push({
      id: "metadata",
      value: "not checked",
      meaning: "DAS is not configured, so metadata mutability and update authority were not checked. Metadata URIs are never fetched.",
      source: "helius-das",
      fetchedAt,
      unavailable: true,
    });
  }

  return { mint, generatedAt: iso(d.now()), signals, disclaimer: SAFETY_DISCLAIMER, notices };
}
