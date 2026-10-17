import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { SAFETY_DISCLAIMER } from "../src/api/discovery.js";
import { app, discoveryWorld, T22 } from "./discovery-mock.js";

let net: ReturnType<typeof discoveryWorld> | undefined;
afterEach(() => net?.restore());

describe("/api/radar", () => {
  it("lists trending and new pools with liquidity, volume, change and age", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request("/api/radar");
    assert.equal(res.status, 200);
    const r: any = await res.json();
    assert.equal(r.ok, true);
    assert.equal(r.trending[0].name, "USDC / SOL");
    assert.ok(r.trending[0].liquidityUsd >= 1000);
    assert.ok(r.fresh[0].ageMs !== undefined || r.fresh[0].createdAt);
    assert.equal(r.fresh[0].token.address, T22);
  });

  it("degrades when GeckoTerminal is down", async () => {
    const built = app({ geckoDown: true });
    net = built.net;
    const res = await built.app.request("/api/radar");
    assert.equal(res.status, 200);
    const r: any = await res.json();
    assert.equal(r.ok, false);
    assert.deepEqual(r.trending, []);
  });

  it("rejects non-GET", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request("/api/radar", { method: "POST" });
    assert.ok(res.status === 404 || res.status === 405);
  });
});

describe("/api/launches", () => {
  it("lists newest pools with a per-row safety read", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request("/api/launches");
    assert.equal(res.status, 200);
    const d: any = await res.json();
    assert.ok(d.launches.length >= 1);
    const safety = d.launches[0].safety;
    assert.equal(safety.disclaimer, SAFETY_DISCLAIMER);
    assert.ok(safety.signals.some((s: { id: string }) => s.id === "mint_authority"));
    assert.doesNotMatch(JSON.stringify(d), /\b(safe|unsafe|scam)\b/i);
  });

  it("keeps the row when on-chain safety fails", async () => {
    const built = app({ rpcDown: true });
    net = built.net;
    const res = await built.app.request("/api/launches");
    assert.equal(res.status, 200);
    const d: any = await res.json();
    assert.ok(d.launches.length >= 1);
    assert.ok(d.launches[0].pool);
  });
});
