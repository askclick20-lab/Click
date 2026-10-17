import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { labelProgramId, TOKEN_PROGRAM_ID, USDC_MINT, WRAPPED_SOL_MINT } from "../../../src/providers/solana/programs.js";

describe("providers/solana/programs", () => {
  it("labels verified program ids", () => {
    assert.equal(labelProgramId(TOKEN_PROGRAM_ID), "SPL Token");
    assert.equal(labelProgramId(WRAPPED_SOL_MINT), "Wrapped SOL");
    assert.equal(labelProgramId(USDC_MINT), "USDC");
  });

  it("returns undefined for unknown ids", () => {
    assert.equal(labelProgramId("9xQeWvG816bUx9EPjHmaT23yv3MVHjQzg6gUqMoqN1nY"), undefined);
  });
});
