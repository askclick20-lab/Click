import { createApp } from "../src/app.js";
import { MAINNET_BETA_GENESIS_HASH } from "../src/config/solana.js";
import { createContainer } from "../src/container.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, USDC_MINT, WRAPPED_SOL_MINT } from "../src/providers/solana/programs.js";
import { base58Encode } from "../src/solana/base58.js";
import { jsonResponse, mockFetch, testEnv } from "./helpers.js";

export const RPC = "https://rpc.solana-discovery-test.example.com/v2/SECRETKEYSECRETKEY1234";
export const GT = "https://api.geckoterminal.com/api/v2";
export const FEED = "https://news.example.com/solana.xml";

export const REN = USDC_MINT;
export const ACTIVE = base58Encode(new Uint8Array(32).fill(177));
export const T22 = base58Encode(new Uint8Array(32).fill(194));
export const CONC = base58Encode(new Uint8Array(32).fill(211));
export const WALLET = base58Encode(new Uint8Array(32).fill(161));
export const SIG = base58Encode(new Uint8Array(64).fill(17));
export const POOL = base58Encode(new Uint8Array(32).fill(82));
export const POOL_NEW = base58Encode(new Uint8Array(32).fill(83));
export const AUTH = base58Encode(new Uint8Array(32).fill(68));
export const HOLDER = base58Encode(new Uint8Array(32).fill(144));

export function mintAccount(opts: { owner?: string; mintAuthority?: string | null; freezeAuthority?: string | null; extensions?: { extension: string }[]; supply?: string; decimals?: number }) {
  return {
    lamports: 1,
    owner: opts.owner ?? TOKEN_PROGRAM_ID,
    executable: false,
    data: {
      program: opts.owner === TOKEN_2022_PROGRAM_ID ? "spl-token-2022" : "spl-token",
      parsed: {
        type: "mint",
        info: {
          decimals: opts.decimals ?? 6,
          mintAuthority: opts.mintAuthority === undefined ? null : opts.mintAuthority,
          freezeAuthority: opts.freezeAuthority === undefined ? null : opts.freezeAuthority,
          supply: opts.supply ?? "1000000000",
          ...(opts.extensions ? { extensions: opts.extensions } : {}),
        },
      },
      space: 82,
    },
  };
}

export function poolJson(address: string, extra: Record<string, unknown> = {}) {
  const base = (extra.base as string) ?? REN;
  return {
    id: `solana_${address}`,
    type: "pool",
    attributes: {
      address,
      name: extra.name ?? "USDC / SOL",
      reserve_in_usd: extra.liq ?? "250000",
      base_token_price_usd: extra.price ?? "142.50",
      volume_usd: { h24: extra.vol ?? "40000" },
      price_change_percentage: { h24: extra.chg ?? "1.2" },
      pool_created_at: extra.created ?? "2026-10-15T05:38:21Z",
      transactions: { h24: { buys: extra.buys ?? 10, sells: extra.sells ?? 8 } },
      ...((extra.attrs as object) ?? {}),
    },
    relationships: {
      dex: { data: { id: extra.dex ?? "raydium" } },
      base_token: { data: { id: `solana_${base}` } },
    },
  };
}

export function rssXml() {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Solana Wire</title>
    <item><title>Slot record broken</title><link>https://news.example.com/slot</link><pubDate>${new Date().toUTCString()}</pubDate></item>
  </channel></rss>`;
}

export function discoveryEnv(extra: Record<string, string> = {}) {
  return testEnv({
    ONCHAIN_ENABLED: "true",
    MARKET_ENABLED: "true",
    ONCHAIN_RPC_RETRIES: "0",
    GECKOTERMINAL_RETRIES: "0",
    SOLANA_RPC_URL: RPC,
    RSS_ENABLED: "true",
    RSS_FEEDS_JSON: JSON.stringify([{ name: "Solana Wire", url: FEED, category: "crypto" }]),
    RSS_REFRESH_MINUTES: "15",
    ...extra,
  });
}

export interface WorldOpts {
  rpcDown?: boolean;
  geckoDown?: boolean;
  rssDown?: boolean;
}

export function discoveryWorld(opts: WorldOpts = {}) {
  return mockFetch((url, body) => {
    if (url.startsWith("https://rpc.solana-discovery-test.example.com")) {
      if (opts.rpcDown) throw new TypeError("fetch failed");
      return rpc(body);
    }
    if (url.startsWith(GT)) {
      if (opts.geckoDown) return jsonResponse({ errors: ["down"] }, 500);
      return gecko(decodeURIComponent(url.slice(GT.length)));
    }
    if (url.startsWith(FEED)) {
      if (opts.rssDown) return new Response("no", { status: 500 });
      return new Response(rssXml(), { status: 200, headers: { "content-type": "application/rss+xml" } });
    }
    return new Response("unexpected " + url, { status: 500 });
  });
}

function rpc(body: { method: string; id: unknown; params?: unknown[] }) {
  const ok = (result: unknown) => jsonResponse({ jsonrpc: "2.0", id: body.id, result });
  const mint = typeof body.params?.[0] === "string" ? body.params[0] : "";
  switch (body.method) {
    case "getGenesisHash":
      return ok(MAINNET_BETA_GENESIS_HASH);
    case "getSlot":
      return ok(250_000_123);
    case "getRecentPerformanceSamples":
      return ok([{ slot: 1, numTransactions: 2400, samplePeriodSecs: 60 }]);
    case "getBalance":
      return ok({ value: 2_000_000_000 });
    case "getAccountInfo":
      if (mint === T22) return ok({ value: mintAccount({ owner: TOKEN_2022_PROGRAM_ID, extensions: [{ extension: "transferFeeConfig" }] }) });
      if (mint === ACTIVE) return ok({ value: mintAccount({ mintAuthority: AUTH }) });
      if (mint === CONC) return ok({ value: mintAccount({ supply: "1000000000" }) });
      if (mint === REN) return ok({ value: mintAccount({}) });
      if (mint === WALLET)
        return ok({
          value: { lamports: 2_000_000_000, owner: "11111111111111111111111111111111", executable: false, data: { program: "system", parsed: { type: "account", info: {} }, space: 0 } },
        });
      return ok({ value: mintAccount({}) });
    case "getTokenSupply":
      return ok({ value: { amount: mint === CONC ? "1000000000" : "1000000000", decimals: 6, uiAmount: 1000 } });
    case "getTokenLargestAccounts":
      if (mint === CONC) {
        return ok({
          value: [
            { address: HOLDER, amount: "900000000" },
            { address: WALLET, amount: "50000000" },
            { address: AUTH, amount: "10000000" },
          ],
        });
      }
      return ok({ value: [{ address: HOLDER, amount: "100000000" }] });
    case "getTokenAccountsByOwner":
      return ok({
        value: [
          {
            pubkey: base58Encode(new Uint8Array(32).fill(119)),
            account: {
              data: { parsed: { info: { mint: REN, tokenAmount: { amount: "1000000", decimals: 6, uiAmount: 1 } } } },
            },
          },
        ],
      });
    case "getTransaction":
      if (mint === SIG)
        return ok({
          slot: 249_000_000,
          blockTime: 1_760_000_000,
          meta: { err: null, fee: 5000, logMessages: ["ok"], computeUnitsConsumed: 1000 },
          transaction: { signatures: [SIG], message: { accountKeys: [WALLET] } },
        });
      return ok(null);
    case "getSignaturesForAddress":
      return ok([]);
    default:
      return jsonResponse({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "n/a" } });
  }
}

function gecko(path: string) {
  const p = path.replace(/\?.*$/, "");
  if (p === "/networks/solana/pools") {
    return jsonResponse({
      data: [
        poolJson(POOL, { name: "USDC / SOL", liq: "250000" }),
        poolJson(POOL_NEW, { name: "DUST / SOL", liq: "12" }),
      ],
    });
  }
  if (p === "/networks/solana/trending_pools" || p.startsWith("/networks/solana/trending_pools")) {
    return jsonResponse({
      data: [poolJson(POOL, { name: "USDC / SOL", liq: "250000", dex: "raydium" })],
      included: [{ id: `solana_${REN}`, type: "token", attributes: { address: REN, symbol: "USDC", name: "USD Coin" } }],
    });
  }
  if (p.startsWith("/networks/solana/new_pools")) {
    return jsonResponse({
      data: [poolJson(POOL_NEW, { name: "PUMP / SOL", liq: "5000", dex: "pump-fun", vol: "80000", created: new Date().toISOString(), base: T22 })],
      included: [
        {
          id: `solana_${T22}`,
          type: "token",
          attributes: { address: T22, symbol: "PUMP", name: "Pump", launchpad_details: { completed: false } },
        },
      ],
    });
  }
  if (p.startsWith(`/networks/solana/tokens/${REN}`) || p.startsWith(`/networks/solana/tokens/${ACTIVE}`) || p.startsWith(`/networks/solana/tokens/${T22}`) || p.startsWith(`/networks/solana/tokens/${CONC}`)) {
    const mint = p.split("/")[4] ?? REN;
    return jsonResponse({
      data: {
        id: `solana_${mint}`,
        type: "token",
        attributes: { address: mint, symbol: mint === T22 ? "PUMP" : "USDC", name: "Token", price_usd: "1.0", total_reserve_in_usd: "250000", volume_usd: { h24: "40000" } },
      },
      included: [poolJson(POOL, { base: mint, liq: "250000" })],
    });
  }
  if (p.startsWith("/simple/networks/solana/token_price/")) {
    return jsonResponse({
      data: {
        attributes: {
          token_prices: { [REN]: "1.0", [WRAPPED_SOL_MINT]: "150" },
          h24_price_change_percentage: { [REN]: "-10", [WRAPPED_SOL_MINT]: "2" },
          total_reserve_in_usd: { [REN]: "250000", [WRAPPED_SOL_MINT]: "1e9" },
        },
      },
    });
  }
  return jsonResponse({ errors: [{ status: "404" }] }, 404);
}

export function app(opts: WorldOpts = {}, env: Record<string, string> = {}) {
  const net = discoveryWorld(opts);
  const application = createApp(createContainer(discoveryEnv(env)));
  return { app: application, net };
}
