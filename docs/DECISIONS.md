# Architecture decisions (Click)

## License (Phase 0)

Upstream shipped no `LICENSE`. Click is **UNLICENSED / proprietary**; see [NOTICE](../NOTICE) and [LICENSE](../LICENSE). Product docs may name the parent once in README for derivation.

## Phase 1

### No chain libraries

Runtime dependencies stay `hono`, `@hono/node-server`, `zod`. Solana base58 and address checks are implemented in `src/solana/` (no `@solana/web3.js`, no `bs58`).

### Environment prefix

All Click-specific configuration uses the `CLICK_` prefix. Legacy product env prefixes are not read at runtime.

### Case-sensitive addresses

Solana pubkeys are validated by base58-decoding to exactly 32 bytes. There is no mixed-case checksum normalization and addresses are **never lowercased** in entity extraction or APIs.

### Verified program / mint IDs

| Constant | Value | Source |
|----------|-------|--------|
| `TOKEN_PROGRAM_ID` | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | [SPL Token](https://spl.solana.com/token) |
| `TOKEN_2022_PROGRAM_ID` | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | [Token-2022](https://spl.solana.com/token-2022) |
| `WRAPPED_SOL_MINT` | `So11111111111111111111111111111111111111112` | Solana ecosystem convention (native SOL wrapper) |

### Token metadata URIs

Token names, symbols, descriptions, and metadata URIs are treated as attacker-controlled. The server does **not** fetch metadata URIs. Names/symbols/memos are passed through the untrusted sanitizer.

### Secrets and key material

Never paste seed phrases or private keys into Click (chat, logs, or issue reports). The output guard redacts configured secrets (including Solana RPC URLs and `HELIUS_API_KEY`), `api-key=` query values, and JSON arrays of 64 integers (Solana keypair file format). Transaction signatures (86–88 character base58) are **not** blanket-redacted.

### localStorage

Conversation persistence uses `click.conversations.v1`. Existing browser data from prior product keys is not migrated automatically.

### Solana cluster defaults (`src/config/solana.ts`)

| Item | Value | Verification |
|------|-------|----------------|
| Mainnet-beta genesis hash | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` | Matches [Solana cluster genesis hashes](https://docs.solana.com/cluster/rpc-endpoints) (mainnet-beta). Override with `SOLANA_GENESIS_HASH` if your RPC provider documents a different cluster label. |
| Default public RPC | `https://api.mainnet-beta.solana.com` | Official public endpoint; **heavily rate-limited** — use a dedicated RPC URL in production. |
| Explorer | `https://solscan.io` (routes `/tx`, `/account`, `/token`, `/block`) | Disable with `SOLANA_EXPLORER_URL=none`. Links are built only from validated pubkeys, signatures, or slot numbers. |
| Commitments | `confirmed` (live), `finalized` (stable) | Fixed defaults in config; not env-tunable in Phase 1. |
