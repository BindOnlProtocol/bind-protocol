/* Pure helpers: no DOM, no network, no clock. Loaded by the page, by the build and by the gates (same file).
   A bad or missing read returns null; nothing here invents a number. */
(function (root) {
  "use strict";

  var CHAIN_ID = 4663;
  var FRESH_MS = { rpc: [30e3, 120e3], llama: [180e3, 900e3], dex: [120e3, 600e3] };
  var TICKERS = ["TSLA", "AAPL", "NVDA", "AMZN", "MSFT", "SPY"];
  var MIN_LIQ = 10000; /* a pool under this is left out of the lane: a thin pool says nothing about a price */

  /* ------------------------------------------------------------ numbers -- */
  function num(v) {
    var n = typeof v === "string" ? parseFloat(v) : v;
    return typeof n === "number" && isFinite(n) ? n : null;
  }
  function hexToInt(h) {
    if (typeof h !== "string" || !/^0x[0-9a-fA-F]+$/.test(h)) return null;
    var n = parseInt(h, 16);
    return isFinite(n) ? n : null;
  }
  function fmtInt(n) { return n == null ? "" : Math.round(n).toLocaleString("en-US"); }
  function fmtGwei(wei) {
    if (wei == null) return "";
    var g = wei / 1e9;
    if (g === 0) return "0 gwei";
    return (g >= 100 ? g.toFixed(0) : g >= 1 ? g.toFixed(2) : g.toPrecision(3)) + " gwei";
  }
  function fmtUsd(n) {
    if (n == null) return "";
    var a = Math.abs(n);
    if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + n.toFixed(2);
  }
  function fmtPrice(n) {
    if (n == null) return "";
    if (n >= 1) return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 0.01) return "$" + n.toFixed(4);
    return "$" + n.toPrecision(3);
  }
  function fmtPct(n) { return n == null ? "" : (n > 0 ? "+" : "") + n.toFixed(2) + "%"; }
  function fmtBps(n) { return n == null ? "" : (n > 0 ? "+" : "") + n.toFixed(1); }

  /* whole units, floored: rounding would print "60 s" or "1 h 60 min" */
  function ageLabel(ms) {
    if (ms == null || !isFinite(ms) || ms < 0) return "";
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + " s";
    if (s < 3600) return Math.floor(s / 60) + " min";
    if (s < 172800) return Math.floor(s / 3600) + " h " + Math.floor((s % 3600) / 60) + " min";
    return Math.floor(s / 86400) + " d";
  }
  function freshness(source, ageMs) {
    var b = FRESH_MS[source];
    if (!b || ageMs == null || !isFinite(ageMs) || ageMs < 0) return "unread";
    return ageMs <= b[0] ? "live" : ageMs <= b[1] ? "stale" : "unread";
  }

  /* --------------------------------------------------------- keccak-256 -- */
  /* Keccak-f[1600] over BigInt lanes: readable, not fast. Needed for the EIP-55 address checksum and the proof seal. */
  var M64 = (1n << 64n) - 1n;
  var RC = [0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
  var RHO = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
  var PI = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
  function rotl(x, n) { n = BigInt(n); return ((x << n) | (x >> (64n - n))) & M64; }
  function permute(s) {
    var c = new Array(5), t, r, i, j;
    for (r = 0; r < 24; r++) {
      for (i = 0; i < 5; i++) c[i] = s[i] ^ s[i + 5] ^ s[i + 10] ^ s[i + 15] ^ s[i + 20];
      for (i = 0; i < 5; i++) { t = c[(i + 4) % 5] ^ rotl(c[(i + 1) % 5], 1); for (j = 0; j < 25; j += 5) s[j + i] ^= t; }
      t = s[1];
      for (i = 0; i < 24; i++) { j = PI[i]; var b = s[j]; s[j] = rotl(t, RHO[i]); t = b; }
      for (j = 0; j < 25; j += 5) { for (i = 0; i < 5; i++) c[i] = s[j + i]; for (i = 0; i < 5; i++) s[j + i] = c[i] ^ ((~c[(i + 1) % 5] & M64) & c[(i + 2) % 5]); }
      s[0] ^= RC[r];
    }
  }
  function keccak256(bytes) {
    var rate = 136, n = Math.floor(bytes.length / rate) + 1, p = new Uint8Array(n * rate), s = [], i, j, k;
    p.set(bytes); p[bytes.length] ^= 0x01; p[p.length - 1] ^= 0x80;
    for (i = 0; i < 25; i++) s.push(0n);
    for (k = 0; k < p.length; k += rate) {
      for (i = 0; i < rate / 8; i++) { var lane = 0n; for (j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(p[k + i * 8 + j]); s[i] ^= lane; }
      permute(s);
    }
    var out = "";
    for (i = 0; i < 4; i++) for (j = 0; j < 8; j++) out += ("0" + Number((s[i] >> BigInt(8 * j)) & 0xffn).toString(16)).slice(-2);
    return out;
  }
  function utf8(str) { return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(str) : Uint8Array.from(unescape(encodeURIComponent(str)), function (c) { return c.charCodeAt(0); }); }

  /* --------------------------------------------------------- addresses -- */
  /* 0x plus 40 hex. All lowercase or all uppercase carries no checksum and passes on shape; any mix of cases is a
     claim about the hash and must match EIP-55. A 64-hex value (a block or transaction hash) is not an address, but
     it is not rejected as hex either: isHash32 accepts it. Hex is never refused wholesale. */
  function checksum(lower) {
    var h = keccak256(utf8(lower)), out = "";
    for (var i = 0; i < lower.length; i++) out += parseInt(h[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
    return out;
  }
  function isAddress(v) {
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) return false;
    var body = v.slice(2);
    if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
    return body === checksum(body.toLowerCase());
  }
  function isHash32(v) { return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v); }
  function httpsUrl(v) {
    if (typeof v !== "string") return "";
    try { var u = new URL(v); return u.protocol === "https:" ? u.href : ""; } catch (e) { return ""; }
  }

  /* ------------------------------------------------------------ register -- */
  /* One record per external fact: { state: stated | absent | unconfirmed, value?, url? }.
     Only a stated record may carry a link or a copy action. A handle is derived from the stored URL, never stored. */
  var STATES = ["stated", "absent", "unconfirmed"];
  function handleOf(kind, url) {
    var u = httpsUrl(url);
    if (!u) return "";
    var p = new URL(u), seg = p.pathname.split("/").filter(Boolean);
    if (kind === "x") return /^(x|twitter)\.com$/.test(p.hostname) && seg[0] && /^[A-Za-z0-9_]{1,15}$/.test(seg[0]) ? "@" + seg[0] : "";
    if (kind === "github") return p.hostname === "github.com" && seg[0] && /^[A-Za-z0-9-]{1,39}$/.test(seg[0]) ? seg.slice(0, 2).join("/") : "";
    return "";
  }
  function recordView(kind, rec) {
    var r = rec && STATES.indexOf(rec.state) >= 0 ? rec : { state: "absent" };
    var view = { state: r.state, text: "", href: "", handle: "" };
    if (r.state === "absent") return view;
    if (kind === "ca") { if (isAddress(r.value)) view.text = r.value; else view.state = "absent"; }
    else if (kind === "launch") { if (/^\d{4}-\d{2}-\d{2}$/.test(r.value || "")) view.text = r.value; else view.state = "absent"; }
    else {
      view.handle = handleOf(kind, r.url);
      if (view.handle) view.text = view.handle; else view.state = "absent";
      if (view.state === "stated") view.href = httpsUrl(r.url);
    }
    return view;
  }

  /* --------------------------------------------------------------- reads -- */
  /* JSON-RPC batch: [chainId, blockNumber, gasPrice, latest block]. A wrong chain id is a failed read. */
  function parseRpc(batch) {
    if (!Array.isArray(batch)) return null;
    var by = {};
    batch.forEach(function (r) { if (r && typeof r.id === "number") by[r.id] = r.result; });
    if (hexToInt(by[1]) !== CHAIN_ID) return null;
    var block = hexToInt(by[2]), gas = hexToInt(by[3]);
    var head = by[4] && typeof by[4] === "object" ? by[4] : null;
    if (block == null || gas == null) return null;
    var ts = head ? hexToInt(head.timestamp) : null;
    return { chainId: CHAIN_ID, block: block, gasWei: gas, blockTime: ts == null ? null : ts * 1000, blockHash: head && isHash32(head.hash) ? head.hash : "" };
  }
  function parseLlama(chains) {
    if (!Array.isArray(chains)) return null;
    for (var i = 0; i < chains.length; i++) {
      var c = chains[i];
      if (c && c.chainId === CHAIN_ID && num(c.tvl) != null && c.tvl >= 0) return { tvl: c.tvl, name: String(c.name || "") };
    }
    return null;
  }

  /* DexScreener search for one ticker: this chain's stock-token pools for exactly that symbol. */
  function parsePools(json, ticker, minLiq) {
    if (!json || !Array.isArray(json.pairs)) return null;
    var floor = minLiq == null ? MIN_LIQ : minLiq, out = [];
    json.pairs.forEach(function (p) {
      if (!p || p.chainId !== "robinhood" || !p.baseToken || !p.quoteToken) return;
      if (p.baseToken.symbol !== ticker || !/Robinhood Token$/.test(String(p.baseToken.name || ""))) return;
      var liq = p.liquidity ? num(p.liquidity.usd) : null, price = num(p.priceUsd);
      if (liq == null || price == null || liq <= 0 || liq < floor || price <= 0) return;
      out.push({
        base: ticker,
        name: String(p.baseToken.name).replace(/\s*[^\w\s]\s*Robinhood Token$/, "").slice(0, 40),
        quote: String(p.quoteToken.symbol || "").slice(0, 12),
        dex: String(p.dexId || "").slice(0, 24),
        version: Array.isArray(p.labels) && p.labels[0] ? String(p.labels[0]).slice(0, 6) : "",
        price: price, liq: liq,
        vol24: p.volume ? num(p.volume.h24) : null,
        chg24: p.priceChange ? num(p.priceChange.h24) : null,
        id: /^0x[0-9a-fA-F]{40,64}$/.test(String(p.pairAddress || "")) ? p.pairAddress : "",
        url: /^https:\/\/dexscreener\.com\//.test(String(p.url || "")) ? p.url : ""
      });
    });
    out.sort(function (a, b) { return b.liq - a.liq; });
    return out;
  }

  /* The lane: each pool's price against the median of the pools that price the same share. Two pools at least;
     with fewer there is nothing to line up and the book says so. No outside reference is read, so the centre is
     the median and is labelled as such. */
  function spreadBook(pools) {
    if (!Array.isArray(pools) || pools.length < 2) return null;
    var ps = pools.map(function (p) { return p.price; }).sort(function (a, b) { return a - b; });
    var m = Math.floor(ps.length / 2), median = ps.length % 2 ? ps[m] : (ps[m - 1] + ps[m]) / 2;
    var rows = pools.map(function (p) { var o = {}; for (var k in p) o[k] = p[k]; o.bps = Math.round(((p.price / median - 1) * 1e4) * 10) / 10; return o; });
    var abs = rows.map(function (r) { return Math.abs(r.bps); });
    return { median: median, rows: rows, band: Math.max.apply(null, abs) };
  }
  /* inside the band an own-edge tint, outside an outline: the edge is 25 bps or twice the median deviation */
  function tintOf(book, bps) {
    var a = book.rows.map(function (r) { return Math.abs(r.bps); }).sort(function (x, y) { return x - y; });
    var edge = Math.max(25, 2 * a[Math.floor(a.length / 2)]);
    return Math.abs(bps) > edge ? "out" : "in";
  }
  function laneRange(book) {
    var peak = Math.max(20, book.band);
    return Math.min(400, Math.ceil(peak / 20) * 20);
  }
  function lanePos(bps, range) { return Math.max(0, Math.min(100, 50 + (bps / range) * 50)); }

  function sortPools(rows, key) {
    var k = key === "vol" ? "vol24" : key === "bps" ? "bps" : "liq";
    return rows.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (k === "bps") { x = x == null ? null : Math.abs(x); y = y == null ? null : Math.abs(y); }
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return y - x;
    });
  }

  /* ---------------------------------------------------------------- proof -- */
  /* The proof is plain text a reader can check against the chain: chain id, block, block hash and time. */
  function proofText(s) {
    var lines = ["BIND receipt, Robinhood Chain (id " + CHAIN_ID + ")"];
    if (s.block != null) lines.push("Block " + fmtInt(s.block) + (s.blockTime ? " at " + new Date(s.blockTime).toISOString().replace(".000Z", "Z") : ""));
    if (s.blockHash) lines.push("Block hash " + s.blockHash);
    if (s.gasWei != null) lines.push("Gas " + fmtGwei(s.gasWei));
    if (s.tvl != null) lines.push("Chain TVL " + fmtUsd(s.tvl) + " (DefiLlama)");
    if (s.book) lines.push(s.ticker + ": " + s.book.rows.length + " pools, widest gap " + s.book.band.toFixed(1) + " bps from the median (DexScreener)");
    lines.push("bind.onl");
    return lines.join("\n");
  }
  /* the seal: 128 bits of the proof's keccak, read in a fixed order. 36 rim ticks, a 7x4 mirrored grid (2 bits a cell:
     none, green, lavender, blue), and one tall notch. Same text, same seal. */
  function sealModel(text) {
    var h = keccak256(utf8(text)), bits = [], i;
    for (i = 0; i < 32; i++) { var n = parseInt(h[i], 16); bits.push((n >> 3) & 1, (n >> 2) & 1, (n >> 1) & 1, n & 1); }
    var at = 0, take = function (k) { var v = 0; while (k--) v = (v << 1) | (bits[at++ % 128]); return v; };
    var ticks = [], cells = [], r, c;
    for (i = 0; i < 36; i++) ticks.push(take(1));
    for (r = 0; r < 7; r++) { cells.push([]); for (c = 0; c < 4; c++) cells[r].push(take(2)); }
    return { hash: h, ticks: ticks, cells: cells, notch: take(3) * 4 };
  }

  var api = {
    CHAIN_ID: CHAIN_ID, FRESH_MS: FRESH_MS, TICKERS: TICKERS, MIN_LIQ: MIN_LIQ,
    num: num, hexToInt: hexToInt, fmtInt: fmtInt, fmtGwei: fmtGwei, fmtUsd: fmtUsd, fmtPrice: fmtPrice, fmtPct: fmtPct, fmtBps: fmtBps,
    ageLabel: ageLabel, freshness: freshness, keccak256: keccak256, utf8: utf8, isAddress: isAddress, isHash32: isHash32, httpsUrl: httpsUrl,
    STATES: STATES, handleOf: handleOf, recordView: recordView, parseRpc: parseRpc, parseLlama: parseLlama, parsePools: parsePools,
    spreadBook: spreadBook, tintOf: tintOf, laneRange: laneRange, lanePos: lanePos, sortPools: sortPools, proofText: proofText, sealModel: sealModel
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BindLib = api;
})(typeof window !== "undefined" ? window : globalThis);
