import { base58Decode } from "./base58.js";

const BASE58_CHARSET = /^[1-9A-HJ-NP-Za-km-z]+$/;
const PUBKEY_LEN = 32;
const SIGNATURE_LEN = 64;

/** Solana address length in base58 (32-byte pubkey). */
const ADDRESS_MIN_LEN = 32;
const ADDRESS_MAX_LEN = 44;
/** Typical ed25519 signature encoding length. */
const SIG_MIN_LEN = 86;
const SIG_MAX_LEN = 88;

export type InputKind = "address" | "signature" | "unknown";

/** True only when the full string is a valid 32-byte Solana pubkey (case preserved). */
export function isSolanaAddress(s: string): boolean {
  if (s.length < ADDRESS_MIN_LEN || s.length > ADDRESS_MAX_LEN) return false;
  if (!BASE58_CHARSET.test(s)) return false;
  const decoded = base58Decode(s);
  return decoded !== undefined && decoded.length === PUBKEY_LEN;
}

/** True only when the full string is a valid 64-byte transaction signature. */
export function isSignature(s: string): boolean {
  if (s.length < SIG_MIN_LEN || s.length > SIG_MAX_LEN) return false;
  if (!BASE58_CHARSET.test(s)) return false;
  const decoded = base58Decode(s);
  return decoded !== undefined && decoded.length === SIGNATURE_LEN;
}

export function classifyInput(s: string): InputKind {
  if (isSignature(s)) return "signature";
  if (isSolanaAddress(s)) return "address";
  return "unknown";
}

export type PubkeyCheck = { ok: true; address: string } | { ok: false; reason: string };

export function validatePubkey(input: string): PubkeyCheck {
  const trimmed = input.trim();
  if (!isSolanaAddress(trimmed)) {
    if (!BASE58_CHARSET.test(trimmed)) {
      return { ok: false, reason: `"${trimmed.slice(0, 16)}${trimmed.length > 16 ? "…" : ""}" is not valid base58` };
    }
    const decoded = base58Decode(trimmed);
    if (!decoded) return { ok: false, reason: `"${trimmed.slice(0, 16)}…" is not valid base58` };
    return {
      ok: false,
      reason: `"${trimmed.slice(0, 16)}${trimmed.length > 16 ? "…" : ""}" is not a valid Solana address (expected 32 bytes, got ${decoded.length})`,
    };
  }
  return { ok: true, address: trimmed };
}

export function validateSignature(input: string): PubkeyCheck {
  const trimmed = input.trim();
  if (!isSignature(trimmed)) {
    if (!BASE58_CHARSET.test(trimmed)) return { ok: false, reason: "not valid base58" };
    const decoded = base58Decode(trimmed);
    if (!decoded) return { ok: false, reason: "not valid base58" };
    return { ok: false, reason: `expected a 64-byte signature (${SIG_MIN_LEN}–${SIG_MAX_LEN} base58 chars), got ${decoded.length} bytes` };
  }
  return { ok: true, address: trimmed };
}
