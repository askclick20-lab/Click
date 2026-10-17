import { Hono } from "hono";
import type { Env } from "../config/env.js";
import { rateLimitEnabled } from "../config/env.js";
import { validatePubkey, validateSignature } from "../solana/address.js";
import type { Logger } from "../core/logger.js";
import type { ClientRateLimiter } from "../security/rate-limit.js";
import { clientKey, tooManyRequests, type AppVariables } from "./http-guards.js";
import { onchainUnavailable } from "./onchain-stub.js";

const LOOKUPS_PER_MINUTE = 20;

/** Placeholder types for token intel (Phase 3). */
export interface AddressProfile {
  address: string;
  kind: "wallet" | "program" | "token";
  generatedAt: string;
}

export interface TxProfile {
  signature: string;
  generatedAt: string;
}

export function createAddressLookup(_env: Env, _logger: Logger) {
  return {
    get: async (_address: string): Promise<AddressProfile> => {
      throw new Error("not_configured");
    },
    getTx: async (_signature: string): Promise<TxProfile | null> => null,
  };
}

export function addressRoutes(
  env: Env,
  _logger: Logger,
  limiter: ClientRateLimiter,
  _lookup?: ReturnType<typeof createAddressLookup>,
): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.get("/api/address/:address", async (c) => {
    c.header("Cache-Control", "no-store");
    const check = validatePubkey(c.req.param("address").trim());
    if (!check.ok) {
      return c.json({ error: { kind: "validation", message: "That is not a valid Solana address (base58, 32 bytes)." } }, 400);
    }
    if (rateLimitEnabled(env)) {
      const verdict = limiter.take("address", clientKey(c, env), LOOKUPS_PER_MINUTE);
      if (!verdict.ok) return tooManyRequests(c, verdict.retryAfterMs);
    }
    return onchainUnavailable(c, env);
  });
  app.get("/api/tx/:hash", async (c) => {
    c.header("Cache-Control", "no-store");
    const sig = c.req.param("hash").trim();
    if (!validateSignature(sig).ok) {
      return c.json({ error: { kind: "validation", message: "That is not a valid transaction signature (base58, 64 bytes)." } }, 400);
    }
    if (rateLimitEnabled(env)) {
      const verdict = limiter.take("address", clientKey(c, env), LOOKUPS_PER_MINUTE);
      if (!verdict.ok) return tooManyRequests(c, verdict.retryAfterMs);
    }
    return onchainUnavailable(c, env);
  });
  return app;
}
