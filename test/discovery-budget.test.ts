import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { GT, app, discoveryWorld } from "./discovery-mock.js";

let net: ReturnType<typeof discoveryWorld> | undefined;
afterEach(() => net?.restore());

describe("discovery GeckoTerminal budget", () => {
  it("10 simultaneous page loads stay under the 25 calls/min cap", async () => {
    const built = app();
    net = built.net;
    const application = built.app;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        Promise.all([application.request("/api/pulse"), application.request("/api/radar"), application.request("/api/launches")]),
      ),
    );
    const gecko = net.calls.filter((c) => c.url.startsWith(GT));
    assert.ok(gecko.length <= 25, `GeckoTerminal was called ${gecko.length} times`);
    assert.ok(gecko.length <= 6, `shared cache/inflight should collapse page loads to a handful of unique fetches, got ${gecko.length}`);
  });
});
