import { ClickError } from "../core/errors.js";
import { base58Decode } from "../providers/solana/base58.js";
import { classifyInput, isSignature, isSolanaAddress, validatePubkey, validateSignature } from "../providers/solana/validate.js";

const LOOSE_BASE58 = /\b[1-9A-HJ-NP-Za-km-z]{26,90}\b/g;

export { classifyInput, isSignature, isSolanaAddress, validatePubkey, validateSignature };

/** Substrings that look like base58 pubkeys/signatures but fail length checks. */
export function malformedBase58Tokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LOOSE_BASE58)) {
    const token = m[0]!;
    const decoded = base58Decode(token);
    if (!decoded) continue;
    if (!isSolanaAddress(token) && !isSignature(token)) out.push(token);
  }
  return [...new Set(out)];
}

export function shortAddress(a: string): string {
  return a.length <= 12 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`;
}

/** Lamports → SOL string (9 decimals), no float rounding. */
export function formatLamports(lamports: bigint, maxFraction = 6): string {
  const sign = lamports < 0n ? "-" : "";
  const v = lamports < 0n ? -lamports : lamports;
  const decimals = 9;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  if (whole === 0n && !frac && v > 0n) return `${sign}<0.${"0".repeat(Math.max(0, maxFraction - 1))}1`;
  return `${sign}${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

const SOURCE = "rpc";

export function assertPubkey(input: string, field = "address"): string {
  const check = validatePubkey(input);
  if (!check.ok) throw new ClickError("bad_request", SOURCE, `${field}: ${check.reason}`);
  return check.address;
}
