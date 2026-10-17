# Security audit checklist

Each item is verified by an automated test or a short operator note. Do not treat this as a pentest report.

| Control | Expected | Verification |
|---------|----------|--------------|
| URL guard — private IPv4/IPv6, metadata (`169.254.169.254`, cloud metadata host), decimal/hex loopback | Fetch refused; reason names the class | `test/security.test.ts` “URL guard”; `test/hardening.test.ts` “never fetches localhost…” |
| URL guard — odd ports, credentials in URL, non-http schemes | Blocked | `test/security.test.ts` (`:22`, `user:pass`, `file:`, `javascript:`) |
| Prompt injection — web page | Injection stripped; `security.flaggedSources`; warning | `test/security.test.ts` “malicious webpage end-to-end” |
| Prompt injection — GitHub README | Same | `test/github.test.ts` “repository content is data” |
| Prompt injection — token name/symbol | Sanitizer flags; warning | `test/market.test.ts` “redacts and flags prompt injection inside a token name” |
| Secret redaction in answer | Model echo of env keys → `[REDACTED]` | `test/security.test.ts` “never echoes our API keys” |
| Secret redaction in stream | Key split across SSE chunks still redacted | `test/security.test.ts` “redacts a key even when streamed” |
| Canary leak | System-prompt dump drops canary; `redactions` includes `system_prompt` | `test/security.test.ts` “caught by the canary” |
| Unverified link removal | Answer links not in sources/user URLs removed | `test/security.test.ts` `removeUnverifiedUrls` |
| RPC URL / Helius key never in logs | `secretValues` + `redactLogLine`; access log has no bearer | `test/hardening.test.ts` “RPC URLs with embedded keys”; “access logs carry request id…” |
| CORS in production | Explicit origin only; `*` refused at startup | `test/hardening.test.ts` CORS describe + `productionProblems` |
| API key in production mode | `CLICK_API_KEY` → 401 without Bearer | `test/engine.test.ts` “requires the bearer token”; `test/web.test.ts` deep links stay public |
| Body / message size limits | 400/413 before any provider | `test/hardening.test.ts` “enforces configurable message…”; defaults `CLICK_MAX_BODY_BYTES=262144`, `CLICK_MAX_MESSAGE_CHARS=8000` |
| Rate limits 20/min and 5/min heavy | Defaults + 429 | `test/hardening.test.ts` rate limiting + “defaults are 20…” |
| Request deadline 120 s | Default `CLICK_REQUEST_TIMEOUT_MS=120000`; hanging provider → 504 | `test/hardening.test.ts` defaults + “hanging provider cannot hang” |

## Operator notes (not unit-tested live)

- Production must set `NODE_ENV=production`, `CLICK_API_KEY`, explicit `CLICK_CORS_ORIGIN`, and a paid `SOLANA_RPC_URL`. The process refuses to start with the mock LLM or CORS `*`.
- Token metadata URIs are never fetched (`docs/DECISIONS.md`).
- `/health` must not include key material (`test/hardening.test.ts`, `test/security.test.ts`).
