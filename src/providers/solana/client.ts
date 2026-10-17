import type { Env } from "../../config/env.js";
import { solanaCluster } from "../../config/solana.js";
import { createHeliusClient, type HeliusClient } from "./helius.js";
import { SolanaRpcClient } from "./rpc.js";

const rpcs = new WeakMap<Env, SolanaRpcClient>();
const heliusClients = new WeakMap<Env, HeliusClient | null>();

export function rpcClientFor(env: Env): SolanaRpcClient {
  let rpc = rpcs.get(env);
  if (!rpc) {
    const cluster = solanaCluster(env);
    rpc = new SolanaRpcClient(cluster.rpcUrls, {
      timeoutMs: env.ONCHAIN_RPC_TIMEOUT_MS,
      retries: env.ONCHAIN_RPC_RETRIES,
      stableTtlMs: env.ONCHAIN_CACHE_TTL_SECONDS * 1000,
      liveTtlMs: env.ONCHAIN_LIVE_TTL_SECONDS * 1000,
      expectedGenesisHash: cluster.genesisHash,
    });
    rpcs.set(env, rpc);
  }
  return rpc;
}

export function heliusClientFor(env: Env): HeliusClient | undefined {
  if (heliusClients.has(env)) return heliusClients.get(env) ?? undefined;
  const cluster = solanaCluster(env);
  const client = env.HELIUS_API_KEY
    ? createHeliusClient(env.HELIUS_API_KEY, { timeoutMs: env.ONCHAIN_RPC_TIMEOUT_MS, cluster: cluster.cluster })
    : null;
  heliusClients.set(env, client);
  return client ?? undefined;
}
