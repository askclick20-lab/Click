/** Well-known on-chain program and mint IDs (verified against Solana / SPL docs). */
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysKcVkUVT86H1AqqtXE";
export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface KnownProgram {
  id: string;
  name: string;
  kind: "program" | "mint";
}

const TABLE: KnownProgram[] = [
  { id: SYSTEM_PROGRAM_ID, name: "System Program", kind: "program" },
  { id: TOKEN_PROGRAM_ID, name: "SPL Token", kind: "program" },
  { id: TOKEN_2022_PROGRAM_ID, name: "SPL Token-2022", kind: "program" },
  { id: ASSOCIATED_TOKEN_PROGRAM_ID, name: "Associated Token Account", kind: "program" },
  { id: MEMO_PROGRAM_ID, name: "Memo Program", kind: "program" },
  { id: COMPUTE_BUDGET_PROGRAM_ID, name: "Compute Budget", kind: "program" },
  { id: WRAPPED_SOL_MINT, name: "Wrapped SOL", kind: "mint" },
  { id: USDC_MINT, name: "USDC", kind: "mint" },
];

const BY_ID = new Map(TABLE.map((e) => [e.id, e]));

/** Human label for a program or mint id; undefined when unknown. */
export function labelProgramId(programId: string): string | undefined {
  return BY_ID.get(programId)?.name;
}

export function knownPrograms(): readonly KnownProgram[] {
  return TABLE;
}

/** Both token programs used for owner scans. */
export const TOKEN_PROGRAM_IDS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const;
