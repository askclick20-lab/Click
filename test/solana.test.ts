import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { base58Decode, base58Encode } from "../src/solana/base58.js";
import { TOKEN_PROGRAM_ID, WRAPPED_SOL_MINT } from "../src/solana/constants.js";
import { formatLamports, isSignature, validatePubkey, validateSignature } from "../src/solana/address.js";

describe("base58", () => {
  it("round-trips 32 zero bytes (system program style)", () => {
    const bytes = new Uint8Array(32);
    const enc = base58Encode(bytes);
    assert.equal(enc, "11111111111111111111111111111111");
    assert.deepEqual(base58Decode(enc), bytes);
  });

  it("rejects invalid characters", () => {
    assert.equal(base58Decode("dead+beef"), undefined);
    assert.equal(base58Decode("lmnop"), undefined);
  });
});

describe("validatePubkey", () => {
  it("accepts known program ids", () => {
    assert.equal(validatePubkey(TOKEN_PROGRAM_ID).ok, true);
    assert.equal(validatePubkey(WRAPPED_SOL_MINT).ok, true);
  });

  it("preserves case", () => {
    const mixed = "So11111111111111111111111111111111111111112";
    const r = validatePubkey(mixed);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.address, mixed);
  });

  it("rejects wrong length", () => {
    assert.equal(validatePubkey("11111111111111111111111111111111").ok, true);
    assert.equal(validatePubkey("111111111111111111111111111111111").ok, false);
  });
});

describe("validateSignature", () => {
  it("requires 64 decoded bytes", () => {
    assert.equal(isSignature(TOKEN_PROGRAM_ID), false);
    const sig = base58Encode(new Uint8Array(64).fill(2));
    assert.equal(sig.length, 87);
    assert.equal(validateSignature(sig).ok, true);
    assert.equal(isSignature(sig), true);
  });
});

describe("formatLamports", () => {
  it("formats whole and fractional SOL", () => {
    assert.equal(formatLamports(1_500_000_000n), "1.5");
    assert.equal(formatLamports(1n), "<0.000001");
  });
});
