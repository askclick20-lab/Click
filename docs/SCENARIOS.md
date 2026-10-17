# End-to-end scenarios

Against a running server (`npm run dev` or `npm start`). Default origin `http://127.0.0.1:8787`. If `CLICK_API_KEY` is set, add `-H "Authorization: Bearer $CLICK_API_KEY"`.

Automated: `npm run e2e` (needs ≥1 LLM key or `CLICK_DEV_MOCK_LLM=true`). Live RPC/market: `npm run check:solana`. RSS: `npm run check:feeds`.

```bash
export BASE=http://127.0.0.1:8787
# USDC mint and System Program are well-known public ids (not secrets).
```

### General Q

```bash
curl -s $BASE/chat -H "content-type: application/json" \
  -d '{"message":"Tell me a short joke about compilers"}'
```

### Web news Q

```bash
curl -s $BASE/chat -H "content-type: application/json" \
  -d '{"message":"What happened in AI news today?"}'
```

### GitHub repo analysis

```bash
curl -s $BASE/chat -H "content-type: application/json" \
  -d '{"message":"Analyze this GitHub repo https://github.com/honojs/hono"}'
```

### Research mode

```bash
curl -s $BASE/chat -H "content-type: application/json" \
  -d '{"message":"Tokenized equities on Solana","mode":"research"}'
```

### Signature / wallet / mint / price

```bash
curl -s $BASE/chat -H "content-type: application/json" \
  -d '{"message":"Analyze this wallet 11111111111111111111111111111111"}'
curl -s $BASE/chat -H "content-type: application/json" \
  -d '{"message":"Analyze this token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"}'
curl -s $BASE/chat -H "content-type: application/json" \
  -d '{"message":"What is the price of So11111111111111111111111111111111111111112?"}'
```

Set `ONCHAIN_ENABLED=true` and prefer a paid `SOLANA_RPC_URL` so these are grounded.

### Symbol collision

```bash
curl -s $BASE/chat -H "content-type: application/json" \
  -d '{"message":"What is the price of $BONK?"}'
```

Expect copycat / multiple-mint caution in sources or the answer — never a silent pick of one mint.

### Follow-up resolution

```bash
curl -s $BASE/chat -H "content-type: application/json" \
  -d '{"message":"what about its liquidity?","history":[{"role":"user","content":"Analyze this token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"}]}'
```

### Streaming run

```bash
curl -N $BASE/chat -H "content-type: application/json" \
  -d '{"message":"Say hello in one sentence","stream":true}'
```

### Degraded mode (every optional key missing)

Start with LLM only (or mock), `ONCHAIN_ENABLED=false`, `MARKET_ENABLED=false`, `RSS_ENABLED=false`, `JINA_ALLOW_KEYLESS=false`, `GITHUB_ALLOW_UNAUTHENTICATED=false`, no Tavily/Exa/Firecrawl/Helius:

```bash
curl -s $BASE/chat -H "content-type: application/json" \
  -d '{"message":"search for who is the CEO of NVIDIA right now"}'
```

Must return `"grounded":false` and name the missing live capability (typically `web.search`) in `warnings` / `plan.unavailable`.

### Provider fallback

```bash
curl -s $BASE/chat -H "content-type: application/json" \
  -d '{"message":"Tell me a joke","model":"gemini"}'
```

If Gemini is unset, `model.fallbackUsed` is true and another configured provider answers.
