import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withOriginalPath } from "../src/vercel-path.js";

describe("Vercel rewrite path restore", () => {
  it("maps rewritten /api/chat to Hono /chat", () => {
    const req = withOriginalPath(new Request("https://example.vercel.app/api/chat"));
    assert.equal(new URL(req.url).pathname, "/chat");
  });

  it("maps /api/health and /api/models to top-level routes", () => {
    assert.equal(new URL(withOriginalPath(new Request("https://example.vercel.app/api/health")).url).pathname, "/health");
    assert.equal(new URL(withOriginalPath(new Request("https://example.vercel.app/api/models")).url).pathname, "/models");
  });

  it("leaves discovery paths under /api unchanged", () => {
    const pulse = withOriginalPath(new Request("https://example.vercel.app/api/pulse"));
    assert.equal(new URL(pulse.url).pathname, "/api/pulse");
    const lookup = withOriginalPath(new Request("https://example.vercel.app/api/lookup/abc"));
    assert.equal(new URL(lookup.url).pathname, "/api/lookup/abc");
  });

  it("still honors __clickPath when present", () => {
    const req = withOriginalPath(new Request("https://example.vercel.app/api/index?__clickPath=chat"));
    assert.equal(new URL(req.url).pathname, "/chat");
  });
});
