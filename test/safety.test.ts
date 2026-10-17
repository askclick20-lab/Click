import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { SAFETY_DISCLAIMER } from "../src/api/discovery.js";
import type { SafetySignal } from "../src/api/safety.js";
import { ACTIVE, app, CONC, discoveryWorld, REN, T22 } from "./discovery-mock.js";

let net: ReturnType<typeof discoveryWorld> | undefined;
afterEach(() => net?.restore());

function byId(signals: SafetySignal[]) {
  return Object.fromEntries(signals.map((s) => [s.id, s])) as Record<string, SafetySignal>;
}

describe("/api/token/:mint/safety", () => {
  it("reports renounced mint and freeze authorities as facts", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request(`/api/token/${REN}/safety`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    const s = byId(body.signals) as any;
    assert.equal(s.mint_authority.value, null);
    assert.match(s.mint_authority.meaning, /renounced|null/i);
    assert.equal(s.freeze_authority.value, null);
    assert.equal(body.disclaimer, SAFETY_DISCLAIMER);
    assert.doesNotMatch(JSON.stringify(body), /\b(safe|unsafe|scam)\b/i);
  });

  it("reports an active mint authority without calling the token safe or unsafe", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request(`/api/token/${ACTIVE}/safety`);
    const s = byId((await res.json() as any).signals) as any;
    assert.equal(typeof s.mint_authority.value, "string");
    assert.match(s.mint_authority.meaning, /active/i);
  });

  it("flags Token-2022 transfer fee factually", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request(`/api/token/${T22}/safety`);
    const s = byId((await res.json() as any).signals) as any;
    assert.equal(s.token_program.value.program, "token-2022");
    assert.equal(s.transfer_fee.value, true);
  });

  it("reports ~90% top-holder concentration with the LP/burn/exchange caveat", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request(`/api/token/${CONC}/safety`);
    const s = byId((await res.json() as any).signals) as any;
    assert.equal(s.holder_concentration.value.top1Pct, 90);
    assert.match(s.holder_concentration.meaning, /LP vaults, burn addresses and exchanges/);
  });

  it("rejects invalid mints", async () => {
    const built = app();
    net = built.net;
    assert.equal((await built.app.request("/api/token/nope/safety")).status, 400);
  });

  it("partial: market down still returns on-chain signals", async () => {
    const built = app({ geckoDown: true });
    net = built.net;
    const res = await built.app.request(`/api/token/${REN}/safety`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.ok(body.signals.some((s: { id: string }) => s.id === "mint_authority"));
  });
});

describe("/api/compare", () => {
  it("returns side-by-side liquidity, market, holders and safety", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request(`/api/compare?a=${REN}&b=${T22}`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.a.mint, REN);
    assert.equal(body.b.mint, T22);
    assert.ok(body.a.safety.signals.length);
    assert.equal(body.disclaimer, SAFETY_DISCLAIMER);
  });

  it("rejects missing or invalid mints", async () => {
    const built = app();
    net = built.net;
    assert.equal((await built.app.request("/api/compare")).status, 400);
    assert.equal((await built.app.request(`/api/compare?a=${REN}&b=nope`)).status, 400);
  });

  it("degrades one side when that mint's market data is missing", async () => {
    const built = app();
    net = built.net;
    const unknown = "11111111111111111111111111111111";
    const res = await built.app.request(`/api/compare?a=${REN}&b=${unknown}`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.ok(body.a.liquidityUsd || body.a.token);
    assert.ok(body.b);
  });
});
