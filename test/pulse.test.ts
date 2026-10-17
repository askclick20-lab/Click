import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createPulse } from "../src/api/pulse.js";
import { silentLogger } from "../src/core/logger.js";
import { app, discoveryEnv, discoveryWorld } from "./discovery-mock.js";

let net: ReturnType<typeof discoveryWorld> | undefined;
afterEach(() => net?.restore());

describe("/api/pulse", () => {
  it("returns latest slot, estimated TPS, liquid pools and headlines", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request("/api/pulse");
    assert.equal(res.status, 200);
    const p: any = await res.json();
    assert.equal(p.chain.ok, true);
    assert.equal(p.chain.slot, 250_000_123);
    assert.equal(p.chain.estimatedTps, 40);
    assert.ok(p.market.pools.every((x: { liquidityUsd: number }) => x.liquidityUsd >= 100_000));
    assert.deepEqual(p.market.pools.map((x: { name: string }) => x.name), ["USDC / SOL"]);
    assert.equal(p.news.headlines[0].title, "Slot record broken");
    assert.match(res.headers.get("cache-control") ?? "", /s-maxage=60/);
    assert.doesNotMatch(JSON.stringify(p), /SECRETKEY|rpc\.solana-discovery/);
  });

  it("each source fails on its own", async () => {
    const built = app({ rpcDown: true });
    net = built.net;
    const res = await built.app.request("/api/pulse");
    const p: any = await res.json();
    assert.equal(p.chain.ok, false);
    assert.equal(p.market.ok, true);
    assert.ok(p.market.pools.length > 0);
  });

  it("invalid method is rejected; GET has no id to validate", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request("/api/pulse", { method: "POST" });
    assert.ok(res.status === 404 || res.status === 405);
  });

  it("caches the snapshot for 60s (one upstream round for concurrent visitors)", async () => {
    let t = 1_000_000;
    net = discoveryWorld();
    const pulse = createPulse(discoveryEnv(), silentLogger, { now: () => t });
    const [a, b] = await Promise.all([pulse.get(), pulse.get()]);
    assert.equal(a, b);
    const first = net.calls.length;
    assert.equal(await pulse.get(), a);
    assert.equal(net.calls.length, first);
    t += 61_000;
    const later = await pulse.get();
    assert.notEqual(later.generatedAt, a.generatedAt);
  });
});
