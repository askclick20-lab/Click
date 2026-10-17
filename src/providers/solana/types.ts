import type { SolanaBudget } from "./rpc.js";

export interface OnchainLimits {
  maxTransactions: number;
  maxLogLines: number;
  maxTokenAccounts: number;
}

export interface AnalysisBudget extends SolanaBudget {
  heliusCalls: number;
  maxHeliusCalls: number;
}

export function createAnalysisBudget(signal: AbortSignal, env: { ONCHAIN_MAX_RPC_CALLS: number }): AnalysisBudget {
  return {
    signal,
    rpcCalls: 0,
    maxRpcCalls: Math.max(2, env.ONCHAIN_MAX_RPC_CALLS),
    heliusCalls: 0,
    maxHeliusCalls: 2,
  };
}
