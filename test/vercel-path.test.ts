import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withOriginalPath } from "../src/vercel-path.js";

describe("Vercel rewrite path restore", () => {
  it("restores /chat from __clickPath on /api/index", () => {
    const req = withOriginalPath(new Request("https://example.vercel.app/api/index?__clickPath=chat"));
    assert.equal(new URL(req.url).pathname, "/chat");
    assert.equal(new URL(req.url).searchParams.has("__clickPath"), false);
  });

  it("restores nested API paths and keeps other query params", () => {
    const req = withOriginalPath(new Request("https://example.vercel.app/api/index?__clickPath=api/pulse&x=1"));
    const url = new URL(req.url);
    assert.equal(url.pathname, "/api/pulse");
    assert.equal(url.searchParams.get("x"), "1");
  });

  it("falls back to x-forwarded-uri when the rewrite query is missing", () => {
    const req = withOriginalPath(
      new Request("https://example.vercel.app/api/index", { headers: { "x-forwarded-uri": "/health" } }),
    );
    assert.equal(new URL(req.url).pathname, "/health");
  });
});
