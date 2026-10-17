import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { app, discoveryWorld, REN, SIG, WALLET } from "./discovery-mock.js";

let net: ReturnType<typeof discoveryWorld> | undefined;
afterEach(() => net?.restore());

describe("/api/lookup/:id", () => {
  it("classifies a mint and returns on-chain sections", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request(`/api/lookup/${REN}`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.kind, "address");
    assert.equal(body.classification, "token mint");
    assert.ok(body.sections.length > 0);
    assert.doesNotMatch(JSON.stringify(body), /SECRETKEY/);
  });

  it("returns a transaction workflow for a signature", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request(`/api/lookup/${SIG}`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.kind, "signature");
    assert.equal(body.id, SIG);
  });

  it("rejects invalid input", async () => {
    const built = app();
    net = built.net;
    const res = await built.app.request("/api/lookup/not-base58!!");
    assert.equal(res.status, 400);
    const body: any = await res.json();
    assert.equal(body.error.kind, "validation");
    assert.equal(net.calls.filter((c) => c.url.includes("rpc.solana")).length, 0);
  });

  it("degrades when RPC is down", async () => {
    const built = app({ rpcDown: true });
    net = built.net;
    const res = await built.app.request(`/api/lookup/${WALLET}`);
    assert.ok(res.status === 502 || res.status === 200);
    const text = await res.text();
    assert.doesNotMatch(text, /SECRETKEY|fetch failed/);
  });
});
