import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { solanaCluster } from "../../../src/config/solana.js";
import { explorerLinks } from "../../../src/providers/solana/explorer.js";
import { WRAPPED_SOL_MINT } from "../../../src/providers/solana/programs.js";
import { base58Encode } from "../../../src/providers/solana/base58.js";
import { testEnv } from "../../helpers.js";

describe("providers/solana/explorer", () => {
  it("builds validated explorer links", () => {
    const links = explorerLinks(solanaCluster(testEnv()));
    const sig = base58Encode(new Uint8Array(64).fill(1));
    assert.equal(links.account(WRAPPED_SOL_MINT), `https://solscan.io/account/${WRAPPED_SOL_MINT}`);
    assert.equal(links.tx(sig), `https://solscan.io/tx/${sig}`);
    assert.equal(links.block(12345), "https://solscan.io/block/12345");
    assert.equal(links.block("not-a-slot"), undefined);
    assert.equal(links.account("not-valid"), undefined);
  });

  it("disables links when explorer is none", () => {
    const links = explorerLinks(solanaCluster(testEnv({ SOLANA_EXPLORER_URL: "none" })));
    assert.equal(links.account(WRAPPED_SOL_MINT), undefined);
    assert.equal(links.home(), undefined);
  });
});
