# Click — AI research engine for Solana

> Every answer is sourced; live facts are never invented.

Click is **derived from TILIK**. The understand → plan → execute → verify → reason → answer pipeline, Hono backend, and static client were ported from that product to **Solana**. Upstream did not include a license grant; Click is **proprietary / UNLICENSED** unless the rights holder publishes one. Attribution lives in [NOTICE](NOTICE) and [LICENSE](LICENSE).

## Architecture

```
browser (web/)  →  POST /chat  →  ClickEngine
                                    ├─ intent (rules, optional hybrid LLM)
                                    ├─ tools (chain, market, search, extract, GitHub, RSS)
                                    ├─ LLM registry (OpenRouter → Gemini → Groq)
                                    └─ output guard (redact, canary, unverified links)
```

The Node server also serves `web/` from the same origin. Secrets never leave the process: `/health` returns booleans only; startup logs print `configured` / `missing` / `default` / `disabled`.

## Folder structure

| Path | Role |
|------|------|
| `src/index.ts` | Node entry (`npm start`) |
| `src/vercel.ts` | Vercel `api/index.js` adapter |
| `src/app.ts` | Hono app, static web, shareable routes |
| `src/core/` | Engine, prompts, HTTP, SSE, logging, claims |
| `src/router/` | Intent, tool routing, model routing |
| `src/providers/solana/` | JSON-RPC, Helius (optional), analysis, explorer links |
| `src/providers/market/` | GeckoTerminal (network `solana`) |
| `src/providers/{llm,search,web,github,news}/` | Models and live web tools |
| `src/security/` | URL guard, rate limit, output/credential guards |
| `src/api/` | `/chat`, `/health`, lookup, portfolio, pulse, radar |
| `src/config/` | Env schema, Solana cluster, feeds, routing |
| `web/` | Static UI |
| `scripts/` | Tests, RSS check, Solana check, e2e |
| `docs/` | Port status, decisions, security, scenarios |

## Run locally

```bash
cp .env.example .env   # at least one LLM key, or CLICK_DEV_MOCK_LLM=true
npm install
npm run dev            # tsx watch, http://127.0.0.1:8787
```

```bash
npm run typecheck
npm test
npm run build && npm start
npm run check:feeds
npm run check:solana
npm run e2e            # requires the server running + ≥1 LLM key
```

Never paste seed phrases or private keys into chat, logs, or tickets. RPC URLs and Helius keys stay on the server.

## Environment

Copy `.env.example` for every variable and default. Highlights:

| Variable | Default | Notes |
|----------|---------|--------|
| `NODE_ENV` | `development` | Production refuses mock LLM and CORS `*` |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Render sets `HOST=0.0.0.0` |
| `CLICK_LOG_LEVEL` | `info` | |
| `CLICK_API_KEY` | unset | Bearer required on `POST /chat` when set |
| `CLICK_CORS_ORIGIN` | unset | Alias `CORS_ORIGIN`. Empty → localhost in dev, same-origin in production |
| `TRUST_PROXY` | false | `X-Forwarded-For` for rate limits |
| `CLICK_DEV_MOCK_LLM` | false | Local only |
| `RATE_LIMIT_MAX_REQUESTS` | 20 / 60s | |
| `RATE_LIMIT_HEAVY_MAX_REQUESTS` | 5 / 60s | Research / multi-source |
| `CLICK_MAX_BODY_BYTES` | 262144 | |
| `CLICK_MAX_MESSAGE_CHARS` | 8000 | |
| `CLICK_REQUEST_TIMEOUT_MS` | 120000 | Whole-request deadline |
| `OPENROUTER_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` | unset | ≥1 required to answer |
| `ONCHAIN_ENABLED` | false | Set `true` for chain tools and landing APIs |
| `SOLANA_NETWORK` | `mainnet-beta` | or `devnet` |
| `SOLANA_RPC_URL` | public cluster RPC | **Secret.** Paid URL in production |
| `HELIUS_API_KEY` | unset | Optional enrichment |
| `MARKET_ENABLED` | true | GeckoTerminal, no key |
| `GECKOTERMINAL_NETWORK` | `solana` | |
| `GECKOTERMINAL_RATE_LIMIT_PER_MINUTE` | 25 | Stay under the public 30/min cap |
| `TAVILY_API_KEY` / `EXA_API_KEY` | unset | Web search |
| `JINA_API_KEY` / `FIRECRAWL_API_KEY` | unset | Page extract; Jina can run keyless |
| `GITHUB_TOKEN` | unset | 60 req/h unauthenticated |
| `RSS_ENABLED` | true | `feeds.json` |

## Data sources and free-tier limits

| Source | Auth | Cap to remember |
|--------|------|-----------------|
| Solana JSON-RPC | URL (secret) | Public `api.mainnet-beta.solana.com` is heavily rate-limited |
| Helius | optional key | Extra RPC/enrichment; daily cap `HELIUS_DAILY_REQUEST_LIMIT` |
| GeckoTerminal | none | Public **30/min**; Click defaults to **25/min** |
| Tavily | key | Free plan ~1,000 credits/month; `TAVILY_DAILY_REQUEST_LIMIT=30` |
| Exa | key | Starter credits; `EXA_DAILY_REQUEST_LIMIT=30` |
| Jina Reader | optional | Keyless ~20/min; keyed higher |
| Firecrawl | key | 1 credit/page; `FIRECRAWL_DAILY_REQUEST_LIMIT=30` |
| GitHub | optional token | 60/h IP vs 5,000/h with token |
| RSS | none | `feeds.json`, refresh every `RSS_REFRESH_MINUTES` |

## Routing

Keyword/entity rules pick intents (`onchain`, `market`, `github`, `web_search`, `research`, …). `CLICK_INTENT_MODE=hybrid` may ask a cheap model when rules are unsure. Model tiers: OpenRouter first, then Gemini, then Groq, each model at most once (`CLICK_MAX_MODEL_ATTEMPTS=4`). `CLICK_STREAM_PREFER_GROQ=true` sends streams to Groq first. Override tables with `CLICK_ROUTING_FILE`.

## Security model

- **URL guard:** http(s) only; block private/link-local/metadata IPs (including decimal/hex forms), odd ports, credentials in URLs, blocked domains.
- **Untrusted text:** README, web pages, token names/symbols are sanitized (prompt-injection, delimiter forgery).
- **Output guard:** env secrets, credential patterns, canary (`CLICK-CANARY-…`), unverified links stripped.
- **Logs:** `secretValues()` includes RPC URL path/query key material and `HELIUS_API_KEY`. Access logs never include headers or conversation ids.
- **Production:** `CLICK_API_KEY`, explicit CORS origin, no mock LLM.

Checklist: [docs/SECURITY.md](docs/SECURITY.md).

## API

`POST /chat` JSON: `{ message, model?, mode?: "auto"|"research", stream?, history?, context? }`.

Response includes `answer`, `grounded`, `sources`, `plan`, `warnings`. `grounded` is false when live data was required and not retrieved; the answer must not invent those facts.

Also: `GET /health`, `GET /models`, lookup/portfolio/pulse/radar under `/api/*` when on-chain/market are enabled.

## Streaming

`stream: true` returns SSE. Default `streamFormat: v2`: `request.started` → `intent.detected` → `plan.created` → tool events → `response.delta*` → `response.completed` (or `error`). Client disconnect aborts work. Caps: `CLICK_MAX_STREAM_CHARS`, request deadline.

## Failure table

| Situation | Client sees |
|-----------|-------------|
| No LLM key | 503, which keys to set (no values) |
| All providers failed | 503, generic in production |
| Provider cooldown | 503 “temporarily paused” |
| Rate limit | 429 + `Retry-After` |
| Body/message too large | 400 / 413 |
| Deadline | 504 / SSE `error` timeout |
| Live tool missing | 200, `grounded: false`, warning names the capability |
| Gecko/RPC outage | Stale market (labelled) or unavailable chain section |

## Observability

JSON logs: `config`, `http.request` (id, endpoint, status, ms), `intent.detected`, `plan.created`, `context.built`. Request id is `X-Request-Id`. `/health` is booleans only.

## Deployment

- **Vercel:** `vercel.json` rewrites to `api/index`, 300s function budget, security headers. Set env in the Vercel dashboard (same names as `.env.example`).
- **Render:** `render.yaml` service `click`, `CLICK_*` names, `ONCHAIN_ENABLED=true`. Secrets `sync: false`.

**Production checklist**

1. `NODE_ENV=production`
2. `CLICK_API_KEY` set
3. Explicit `CLICK_CORS_ORIGIN` (never `*`)
4. Paid `SOLANA_RPC_URL` (not the public cluster endpoint)
5. `ONCHAIN_ENABLED=true` if you want chain tools
6. At least one LLM key; mock LLM off

## Docs

- [docs/MIGRATION.md](docs/MIGRATION.md) — port complete; pending list empty
- [docs/DECISIONS.md](docs/DECISIONS.md)
- [docs/SECURITY.md](docs/SECURITY.md)
- [docs/SCENARIOS.md](docs/SCENARIOS.md) — curl / live e2e
