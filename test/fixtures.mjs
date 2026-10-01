// SYNTHETIC FIXTURES. Every value below is invented for the gates. None was read from a chain or an API,
// and none is ever shipped: this folder is outside src/, so the build does not copy it.
export const SYNTHETIC = true;

export const rpcOk = [
  { jsonrpc: "2.0", id: 1, result: "0x1237" },
  { jsonrpc: "2.0", id: 2, result: "0x64" },
  { jsonrpc: "2.0", id: 3, result: "0x3b9aca00" },
  { jsonrpc: "2.0", id: 4, result: { timestamp: "0x3e8" } }
];
export const rpcWrongChain = [{ jsonrpc: "2.0", id: 1, result: "0x1" }, ...rpcOk.slice(1)];
export const rpcBroken = [{ jsonrpc: "2.0", id: 1, result: "0x1237" }, { jsonrpc: "2.0", id: 2, error: { code: -1 } }];

export const llamaOk = [
  { name: "Synthetic A", chainId: 1, tvl: 5 },
  { name: "Synthetic Chain", chainId: 4663, tvl: 2500000 }
];
export const llamaMissing = [{ name: "Synthetic A", chainId: 1, tvl: 5 }];

const tok = (symbol) => ({ symbol, name: symbol + " Synthetic \u2022 Robinhood Token" });
const pair = (o) => ({
  chainId: "robinhood", dexId: "synthdex", url: "https://dexscreener.com/robinhood/0xsynthetic",
  baseToken: { symbol: "AAA", name: "Synthetic • Robinhood Token" }, quoteToken: { symbol: "ETH" }, priceUsd: "1.5",
  liquidity: { usd: 1000 }, volume: { h24: 50 }, priceChange: { h24: -2 }, ...o
});
export const pairsOk = {
  pairs: [
    pair({ baseToken: tok("LOW"), liquidity: { usd: 10 }, volume: { h24: 900 }, priceChange: { h24: 40 } }),
    pair({ baseToken: tok("TOP"), liquidity: { usd: 9000 }, volume: { h24: 10 }, priceChange: { h24: -5 } }),
    pair({ chainId: "other", baseToken: tok("OFF") }),
    pair({ baseToken: tok("NAN"), priceUsd: "abc" }),
    pair({ baseToken: tok("ZERO"), liquidity: { usd: 0 } }),
    pair({ baseToken: tok("EVIL"), url: "javascript:alert(1)" })
  ]
};

// Served to the browser gate in place of the three live services. Synthetic, like everything in this file.
export const rpcFor = (ids, nowMs, block = 1234567) => ids.map((id) => ({
  jsonrpc: "2.0", id,
  result: id === 1 ? "0x1237" : id === 2 ? "0x" + block.toString(16) : id === 3 ? "0x3b9aca00"
    : { timestamp: "0x" + Math.floor(nowMs / 1000 - 3).toString(16), hash: "0x" + "ab".repeat(32) }
}));
const STOCKS = { TSLA: [353.4, 353.9, 355.1, 351.2], AAPL: [333.7, 333.8, 334.4], NVDA: [120.1], AMZN: [200.2, 200.9], MSFT: [], SPY: [560.3, 561.0] };
export const dexFor = (ticker) => ({
  pairs: (STOCKS[ticker] || []).map((price, i) => pair({
    baseToken: { symbol: ticker, name: ticker + " Synthetic • Robinhood Token" }, quoteToken: { symbol: ["USDG", "WETH", "SPY", "ETH"][i % 4] },
    priceUsd: String(price), liquidity: { usd: 900000 / (i + 1) }, volume: { h24: 40000 / (i + 1) }, priceChange: { h24: i - 1.5 },
    pairAddress: "0x" + String(i + 1).repeat(64).slice(0, 64), labels: [i % 2 ? "v3" : "v4"]
  }))
});

export const goodCA = "0x" + "aB".repeat(20);
export const badCAs = ["", "0x123", "0x" + "g".repeat(40), goodCA + "0", goodCA.slice(0, 20) + "…" + goodCA.slice(-6), null];
