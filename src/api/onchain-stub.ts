import type { Context } from "hono";
import type { Env } from "../config/env.js";

/** Landing + chat chain routes until Solana RPC is wired (Phase 3). */
export function onchainUnavailable(c: Context, env: Env) {
  if (!env.ONCHAIN_ENABLED) {
    return c.json({ error: { kind: "unavailable", message: "On-chain data is turned off." } }, 503);
  }
  return c.json(
    { error: { kind: "not_configured", message: "Solana on-chain reads are not configured yet. The chain tool ships in a later phase." } },
    503,
  );
}
