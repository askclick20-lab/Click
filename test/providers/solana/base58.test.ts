import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { base58Decode, base58Encode } from "../../../src/providers/solana/base58.js";

describe("providers/solana/base58", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 255, 128, 64]);
    assert.deepEqual(base58Decode(base58Encode(bytes)), bytes);
  });

  it("handles leading zero bytes", () => {
    const bytes = new Uint8Array([0, 0, 0, 1, 2]);
    const enc = base58Encode(bytes);
    assert.ok(enc.startsWith("111"));
    assert.deepEqual(base58Decode(enc), bytes);
  });

  it("matches known vectors", () => {
    assert.equal(base58Encode(Uint8Array.from([97, 98, 99])), "ZiCa");
    assert.deepEqual(base58Decode("ZiCa"), Uint8Array.from([97, 98, 99]));
    assert.equal(base58Encode(new Uint8Array(32)), "11111111111111111111111111111111");
    assert.deepEqual(base58Decode("11111111111111111111111111111111"), new Uint8Array(32));
  });

  it("rejects invalid alphabet characters", () => {
    for (const bad of ["0", "O", "I", "l", "dead+beef", "hello!", " "]) {
      assert.equal(base58Decode(bad), undefined);
    }
  });

  it("empty input encodes and decodes", () => {
    assert.equal(base58Encode(new Uint8Array(0)), "");
    assert.deepEqual(base58Decode(""), new Uint8Array(0));
  });
});
