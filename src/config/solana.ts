import type { Env } from "./env.js";

export type SolanaCluster = "mainnet-beta" | "devnet";
export type Commitment = "confirmed" | "finalized";

/** Verified against Solana docs (mainnet-beta); override with SOLANA_GENESIS_HASH if needed. */
export const MAINNET_BETA_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

/** Public devnet genesis (cluster default); override via SOLANA_GENESIS_HASH when unsure. */
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1sKQawZAfQWA4";

const CLUSTER_DEFAULTS: Record<
  SolanaCluster,
  { rpc: string; genesis: string }
> = {
  "mainnet-beta": {
    rpc: "https://api.mainnet-beta.solana.com",
    genesis: MAINNET_BETA_GENESIS_HASH,
  },
  devnet: {
    rpc: "https://api.devnet.solana.com",
    genesis: DEVNET_GENESIS_HASH,
  },
};

export interface SolanaConfig {
  cluster: SolanaCluster;
  /** Primary first. Never logged — URLs may embed API keys. */
  rpcUrls: string[];
  genesisHash: string;
  /** Explorer UI base; undefined when disabled. */
  explorerBase?: string;
  liveCommitment: Commitment;
  stableCommitment: Commitment;
  heliusApiKey?: string;
  /** True when using the official public RPC (rate-limited). */
  publicRpc: boolean;
}

export function solanaCluster(env: Env): SolanaConfig {
  const cluster = env.SOLANA_NETWORK;
  const defaults = CLUSTER_DEFAULTS[cluster];
  const primary = env.SOLANA_RPC_URL ?? defaults.rpc;
  const fallbacks = (env.SOLANA_RPC_FALLBACK_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const explorer =
    env.SOLANA_EXPLORER_URL === "none"
      ? undefined
      : (env.SOLANA_EXPLORER_URL ?? "https://solscan.io").replace(/\/+$/, "");
  return {
    cluster,
    rpcUrls: [...new Set([primary, ...fallbacks])],
    genesisHash: env.SOLANA_GENESIS_HASH ?? defaults.genesis,
    ...(explorer ? { explorerBase: explorer } : {}),
    liveCommitment: "confirmed",
    stableCommitment: "finalized",
    ...(env.HELIUS_API_KEY ? { heliusApiKey: env.HELIUS_API_KEY } : {}),
    publicRpc: primary === defaults.rpc,
  };
}

export { explorerLinks } from "../providers/solana/explorer.js";
