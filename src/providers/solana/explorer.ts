import type { SolanaConfig } from "../../config/solana.js";
import { validatePubkey, validateSignature } from "./validate.js";

/** Explorer links only for validated pubkeys, signatures, or numeric slots. */
export function explorerLinks(cluster: SolanaConfig) {
  const base = cluster.explorerBase;
  return {
    tx: (signature: string) => {
      if (!base || !validateSignature(signature).ok) return undefined;
      return `${base}/tx/${signature}`;
    },
    account: (address: string) => {
      if (!base || !validatePubkey(address).ok) return undefined;
      return `${base}/account/${address}`;
    },
    token: (mint: string) => {
      if (!base || !validatePubkey(mint).ok) return undefined;
      return `${base}/token/${mint}`;
    },
    block: (slot: number | string) => {
      if (!base) return undefined;
      const s = String(slot).trim();
      if (!/^\d+$/.test(s)) return undefined;
      return `${base}/block/${s}`;
    },
    home: () => base,
  };
}
