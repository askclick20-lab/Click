import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { app, discoveryWorld, REN, WALLET } from "./discovery-mock.js";

let net: ReturnType<typeof discoveryWorld> | undefined;
afterEach(() => net?.restore());

describe("/api/portfolio/:wallet", () => {
  it("lists token holdings with batched prices and native SOL", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request(`/api/portfolio/${WALLET}`);
    assert.equal(res.status, 200);
    const p: any = await res.json();
    const priceCalls = net.calls.filter((c) => c.url.includes("/token_price/"));
    assert.equal(priceCalls.length, 1);
    assert.ok(p.holdings.some((h: { program: string }) => h.program === "native-sol"));
    assert.ok(p.holdings.some((h: { mint: string; priced: boolean }) => h.mint === REN && h.priced));
    assert.ok(p.totalUsd > 0);
    assert.ok(p.change24hPct !== undefined);
    assert.match(res.headers.get("cache-control") ?? "", /s-maxage/);
  });

  it("rejects invalid wallets", async () => {
    const built = app();
    net = built.net;
    assert.equal((await built.app.request("/api/portfolio/not-a-wallet")).status, 400);
  });

  it("still returns holdings when GeckoTerminal is down (unpriced)", async () => {
    const built = app({ geckoDown: true });
    net = built.net;
    const res = await built.app.request(`/api/portfolio/${WALLET}`);
    assert.equal(res.status, 200);
    const p: any = await res.json();
    assert.ok(p.unpriced >= 1);
    assert.ok(p.holdings.every((h: { note?: string; priced: boolean }) => !h.priced || h.note === "no price"));
  });
});
