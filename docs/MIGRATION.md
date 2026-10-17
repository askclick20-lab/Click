# Click port status

Click is a Solana port of the parent intelligence-engine architecture (see [NOTICE](../NOTICE) for attribution). Chain IDs, EVM addresses, and explorer APIs from that product are gone: JSON-RPC + optional Helius, GeckoTerminal network `solana`, Solscan links, base58 pubkeys/signatures.

## Pending port

None. `test/pending/` was removed. Chain-relevant coverage lives in the active `test/` tree (`npm test`).

## Test parity

Active suite is well above the 310 chain-relevant equivalents from the parent product (on-chain RPC/tools, lookup, portfolio, pulse/radar, market, intent/follow-up, news/search, security/hardening). Run `npm test` and confirm the reported total.

## What shipped

| Area | Location |
|------|----------|
| Cluster + genesis check | `src/config/solana.ts`, `src/providers/solana/rpc.ts` |
| Chain tool | `src/providers/solana/tool.ts` |
| Market | `src/providers/market/*`, `GECKOTERMINAL_NETWORK=solana` |
| Landing APIs | `src/api/lookup.ts`, `portfolio.ts`, `pulse.ts`, `discovery.ts` |
| Web UI | `web/` (Click branding, Solana copy) |
| Env prefix | `CLICK_*`; RPC `SOLANA_*`; optional `HELIUS_API_KEY` |
| Deploy | `render.yaml` service `click`; `vercel.json` unchanged aside from docs |

## Intentionally not ported

EVM-only modules (hex checksums, event topics, explorer v2 address hashes) have no Solana equivalent and are not listed as pending.
