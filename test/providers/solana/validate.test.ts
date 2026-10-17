import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { base58Encode } from "../../../src/providers/solana/base58.js";
import { USDC_MINT, WRAPPED_SOL_MINT } from "../../../src/providers/solana/programs.js";
import { classifyInput, isSignature, isSolanaAddress, validatePubkey } from "../../../src/providers/solana/validate.js";

describe("providers/solana/validate", () => {
  it("accepts wSOL and USDC mints", () => {
    assert.equal(isSolanaAddress(WRAPPED_SOL_MINT), true);
    assert.equal(isSolanaAddress(USDC_MINT), true);
    assert.equal(classifyInput(USDC_MINT), "address");
  });

  it("preserves address case", () => {
    const mixed = "So11111111111111111111111111111111111111112";
    const r = validatePubkey(mixed);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.address, mixed);
  });

  it("rejects truncated and padded addresses", () => {
    assert.equal(isSolanaAddress("11111111111111111111111111111111"), true);
    assert.equal(isSolanaAddress("111111111111111111111111111111111"), false);
    assert.equal(isSolanaAddress("111111111111111111111111111111"), false);
  });

  it("rejects forbidden base58 characters", () => {
    assert.equal(isSolanaAddress("So11111111111111111111111111111111111111110"), false);
    assert.equal(isSolanaAddress("O11111111111111111111111111111111"), false);
  });

  it("classifies 64-byte signatures", () => {
    const sig = base58Encode(new Uint8Array(64).fill(9));
    assert.ok(sig.length >= 86 && sig.length <= 88);
    assert.equal(isSignature(sig), true);
    assert.equal(classifyInput(sig), "signature");
    assert.equal(isSolanaAddress(sig), false);
  });

  it("rejects pubkey-shaped strings that decode to wrong length", () => {
    const thirty = base58Encode(new Uint8Array(30));
    assert.equal(isSolanaAddress(thirty), false);
    assert.equal(classifyInput(thirty), "unknown");
  });

  it("does not treat English words as addresses even when base58 charset", () => {
    for (const word of ["hello", "world", "banana", "Solana"]) {
      assert.equal(isSolanaAddress(word), false);
      assert.equal(isSignature(word), false);
      assert.equal(classifyInput(word), "unknown");
    }
  });
});
