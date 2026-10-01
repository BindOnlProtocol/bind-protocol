// Gates (30 at most). Every check reads the built dist/ or the project files. Synthetic fixtures only, injected clock,
// no network: the browser gate serves dist/ locally and answers the three live services from test/fixtures.mjs.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import * as F from "../test/fixtures.mjs";
import { build, validate, slots } from "./build.mjs";
import { decode } from "./lib-img.mjs";
import { measure, VIEWPORTS } from "./measure.mjs";

const T0 = Date.now();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist"), src = join(root, "src");
const rd = (p) => readFileSync(p, "utf8");
const walk = (d, o = []) => { for (const n of readdirSync(d)) { if (n === "node_modules" || n === ".git") continue; const p = join(d, n); statSync(p).isDirectory() ? walk(p, o) : o.push(p); } return o; };
const TEXT = new Set([".html", ".css", ".js", ".json", ".webmanifest", ".txt", ".mjs", ".cjs", ".md"]);

if (!existsSync(join(dist, "index.html"))) { console.log("FAIL dist/index.html missing: run npm run build first"); process.exit(1); }
const html = rd(join(dist, "index.html"));
const srcHtml = rd(join(src, "index.html"));
const jsFiles = ["register.js", "lib.js", "site.js", "live.js", "proof.js"];
const js = Object.fromEntries(jsFiles.map((f) => [f, rd(join(dist, f))]));
const allJs = jsFiles.map((f) => js[f]).join("\n");
const liveJs = js["site.js"] + js["live.js"] + js["proof.js"];

const ctx = { window: {}, URL, TextEncoder }; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(js["lib.js"], ctx);
vm.runInContext(js["register.js"], ctx);
const L = ctx.window.BindLib, REG = ctx.window.BIND_REGISTER;
const regSrc = JSON.parse(rd(join(src, "register.json")));
const tokens = JSON.parse(rd(join(root, "brand", "tokens.json")));
const tokensCss = rd(join(src, "tokens.css"));

const gates = [];
const gate = (name, fn) => gates.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m || "eq"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const count = (re, s = html) => (s.match(re) || []).length;
const throws = (fn, m) => { let t = false; try { fn(); } catch (e) { t = true; } ok(t, m || "expected a throw"); };

/* ---- colour maths over tokens.css: hex, var(), and color-mix(in srgb, A p%, B) ---- */
const vars = {};
for (const m of tokensCss.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].replace(/\/\*[\s\S]*?\*\//g, "").trim();
function colour(expr) {
  expr = expr.trim();
  let m = expr.match(/^var\(--([\w-]+)\)$/); if (m) return colour(vars[m[1]]);
  m = expr.match(/^#([0-9a-f]{6})$/i); if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).concat(1);
  m = expr.match(/^color-mix\(in srgb,\s*(.+)\)$/);
  if (m) {
    const parts = []; let depth = 0, cur = "";
    for (const ch of m[1]) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && !depth) { parts.push(cur); cur = ""; } else cur += ch; }
    parts.push(cur);
    const side = (s) => { const mm = s.trim().match(/^(.*?)(?:\s+(\d+(?:\.\d+)?)%)?$/); return { c: mm[1].trim(), p: mm[2] == null ? null : parseFloat(mm[2]) / 100 }; };
    const a = side(parts[0]), b = side(parts[1]);
    let pa = a.p, pb = b.p; if (pa == null && pb == null) pa = pb = 0.5; else if (pa == null) pa = 1 - pb; else if (pb == null) pb = 1 - pa;
    const ca = a.c === "transparent" ? [0, 0, 0, 0] : colour(a.c), cb = b.c === "transparent" ? [0, 0, 0, 0] : colour(b.c);
    const al = ca[3] * pa + cb[3] * pb;
    return [0, 1, 2].map((i) => (al ? (ca[i] * ca[3] * pa + cb[i] * cb[3] * pb) / al : 0)).concat(al);
  }
  throw new Error("cannot resolve colour " + expr);
}
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lumOf = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a, b) => { const [x, y] = [lumOf(colour(`var(--${a})`)), lumOf(colour(`var(--${b})`))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* ---- copy: word 2-grams ---- */
const words = (s) => s.toLowerCase().replace(/&[a-z#0-9]+;/g, " ").split(/[^a-z0-9]+/).filter(Boolean);
const grams = (lines) => { const out = new Set(); for (const l of lines) { const w = words(l); for (let i = 0; i + 1 < w.length; i++) out.add(w[i] + " " + w[i + 1]); } return out; };
const visibleLines = (h) => h.replace(/<script[\s\S]*?<\/script>/g, "\n").replace(/<style[\s\S]*?<\/style>/g, "\n").replace(/<head>[\s\S]*?<\/head>/, "\n").replace(/<!--[\s\S]*?-->/g, "\n").replace(/<[^>]+>/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean);
const jsStrings = (s) => [...s.matchAll(/"((?:[^"\\\n]|\\.){6,})"/g)].map((m) => m[1]).filter((t) => /[a-z]+ [a-z]+/i.test(t) && !/^(https?:|[.#\[]|[a-z-]+:)/.test(t) && !/[{};=<>]/.test(t));
const ALLOW = new Set(["robinhood chain"]);
const grams3 = (lines) => { const out = new Set(); for (const l of lines) { const w = words(l); for (let i = 0; i + 2 < w.length; i++) out.add(w[i] + " " + w[i + 1] + " " + w[i + 2]); } return out; };
/* Words that carry the slides' own pitch. Plain domain nouns (market, reference, issuer, token, price, wallet, liquidity)
   are what the product is about and stay allowed; the pitch words do not. */
const PITCH = ["connect", "connects", "together", "around", "shared", "transparent", "efficient", "experience", "access", "different", "common", "discover", "opportunities", "unified", "interface", "track", "relationships", "easier", "interact", "interactions", "unnecessarily", "exposing", "identity", "privacy", "transaction", "verifiable", "verify", "signal", "tokenized", "explore", "layer", "unlinked", "proof", "bring", "multiple", "activity", "designed", "onchain"];

gate("G01 build parity: a fresh in-memory build equals dist byte for byte; every local ref resolves; nothing extra", () => {
  const files = build(null);
  for (const [rel, buf] of files) { const p = join(dist, rel); ok(existsSync(p) && Buffer.compare(readFileSync(p), buf) === 0, "drift in " + rel); }
  eq(walk(dist).length, files.size, "extra files in dist");
  const refs = [...html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)].map((m) => m[1]).filter((r) => r !== "/");
  ok(refs.length >= 10); refs.forEach((r) => ok(existsSync(join(dist, r)), "missing " + r));
  [...html.matchAll(/srcset="([^"]+)"/g)].forEach((m) => m[1].split(",").forEach((c) => ok(existsSync(join(dist, c.trim().split(" ")[0])), "srcset " + c)));
  ok(!/<!--slot:|\{\{/.test(html), "unfilled slot");
});
gate("G02 document basics: lang, viewport, one h1, title, description, canonical, share image at its stated size", () => {
  ok(/<html lang="en">/.test(html) && /name="viewport"/.test(html) && /<title>[^<]{10,}<\/title>/.test(html) && /name="description"/.test(html) && /rel="canonical" href="https:\/\/bind\.onl\/"/.test(html));
  eq(count(/<h1[\s>]/g), 1, "h1");
  const og = decode(join(dist, "img", "og.jpg"));
  eq([og.w, og.h], [+html.match(/og:image:width" content="(\d+)/)[1], +html.match(/og:image:height" content="(\d+)/)[1]], "og size");
});
gate("G03 CA slot is the first thing in the sticky bar, before the nav, and shows the whole address when stated", () => {
  const bar = html.indexOf("data-bar"), ca = html.indexOf("data-ca "), nav = html.indexOf('id="site-nav"');
  ok(bar > 0 && ca > bar && ca < nav, "CA before nav");
  ok(/\.bar\s*\{[^}]*position:\s*sticky/.test(rd(join(dist, "site.css"))), "bar sticky");
  const addr = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", s = slots({ ...regSrc, ca: { state: "stated", value: addr } }, L);
  ok(s.ca.includes(`>${addr}<`) && !s.ca.includes("…") && /<button/.test(s.ca) && /Click to copy/.test(s.ca), "stated slot shows the full address in a button");
  ok(js["site.js"].includes("clipboard.writeText(text)") && /data-state="stated"/.test(js["site.js"]) && /aria-live="polite"/.test(html));
});
gate("G04 REGISTER: one record per external fact; state is stated|absent|unconfirmed; the shipped register validates", () => {
  ok(validate(regSrc, L));
  ["ca", "x", "github", "launch", "domain", "chain", "rpc", "llama", "dexscreener", "explorer"].forEach((k) => ok(L.STATES.includes(regSrc[k].state), k));
  eq(L.STATES, ["stated", "absent", "unconfirmed"]);
  const bad = (k, v) => throws(() => validate({ ...regSrc, [k]: v }, L), "should reject " + k);
  bad("ca", { state: "maybe", value: "" }); bad("ca", { state: "absent", value: "0x" + "a".repeat(40) }); bad("ca", { state: "stated", value: "" });
  bad("x", { state: "stated", url: "http://x.com/BindOnl" }); bad("x", { state: "stated", url: "https://example.com/BindOnl" }); bad("rpc", { state: "stated", url: "javascript:alert(1)" });
  eq(REG.ca.state, regSrc.ca.state); ok(REG.ca.state !== "absent" || REG.ca.value === "", "absent ca carries no value"); eq(REG.x.state, "absent"); eq(REG.github.state, "absent"); eq(REG.launch.state, "absent");
});
gate("G05 LINK RULE: no href and no copy action for an unstated record; a stated URL links, unconfirmed never does", () => {
  const box = html.match(/<div class="socials"[\s\S]*?<\/div>/)[0];
  eq(count(/class="social"/g, box), 2); ok(!/href=/.test(box) && count(/aria-disabled="true"/g, box) === 2, "inert icons");
  const ca = html.match(/<div class="ca"[\s\S]*?<\/span>\s*<\/div>/)[0], st = regSrc.ca.state, has = /<button[^>]*data-ca-btn/.test(html);
  eq(has, st === "stated", "copy button exists only while stated");
  if (st === "stated") ok(ca.includes(">" + regSrc.ca.value + "<") && /Click to copy/.test(ca) && !/href=/.test(ca), "stated: full address in a button");
  else if (st === "unconfirmed") ok(ca.includes(regSrc.ca.value) && /Unconfirmed/.test(ca) && !/href=|<button/.test(ca));
  else ok(/Not stated yet/.test(ca) && /Inert until stated/.test(ca) && !/href=|<button/.test(ca) && !html.includes("0x"), "absent: inert");
  const addr = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  const stated = slots({ ...regSrc, x: { state: "stated", url: "https://x.com/BindOnl" }, github: { state: "stated", url: "https://github.com/bindonl/site" } }, L).socials;
  ok(/href="https:\/\/x\.com\/BindOnl"/.test(stated) && /@BindOnl/.test(stated) && /href="https:\/\/github\.com\/bindonl\/site"/.test(stated) && /noopener/.test(stated));
  const unconf = slots({ ...regSrc, x: { state: "unconfirmed", url: "https://x.com/BindOnl" }, ca: { state: "unconfirmed", value: addr } }, L);
  ok(!/href=/.test(unconf.socials) && /unconfirmed/.test(unconf.socials) && !/<button/.test(unconf.ca) && /Unconfirmed/.test(unconf.ca) && unconf.ca.includes(addr), "unconfirmed: visible, never actionable");
  ok(!/<time/.test(html) && slots(regSrc, L).launch === "" && /<time datetime="2026-11-02">/.test(slots({ ...regSrc, launch: { state: "stated", value: "2026-11-02" } }, L).launch), "no date while absent");
  ok(!/https:\/\/robinhoodchain\.blockscout\.com/.test(html), "unconfirmed explorer is not linked");
});
gate("G06 handles are derived from the stored URL, never stored", () => {
  eq(L.handleOf("x", "https://x.com/BindOnl"), "@BindOnl"); eq(L.handleOf("x", "https://twitter.com/BindOnl/status/1"), "@BindOnl");
  eq(L.handleOf("github", "https://github.com/bindonl/site"), "bindonl/site"); eq(L.handleOf("x", "https://x.com/"), ""); eq(L.handleOf("x", "https://evil.test/BindOnl"), "");
  eq(L.handleOf("github", "http://github.com/a"), "");
  ok(!/"handle"/.test(JSON.stringify(regSrc)) && !/"@/.test(JSON.stringify(regSrc)), "no stored handle");
  ok(!/@BindOnl/.test(html) && !/@BindOnl/.test(allJs), "the handle appears nowhere while the record is absent");
});
gate("G07 GATE WARNING: 0x hex is never refused wholesale; addresses, checksums and 32-byte hashes each get their own rule", () => {
  const lower = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";
  ok(L.isAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed") && L.isAddress(lower) && L.isAddress(lower.toUpperCase().replace("0X", "0x")), "checksummed, lowercase and uppercase pass");
  ok(!L.isAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD"), "a mixed-case address with a wrong checksum fails");
  ok(!L.isAddress("0x123") && !L.isAddress("0x" + "g".repeat(40)) && !L.isAddress(null) && !L.isAddress("0x" + "a".repeat(41)) && !L.isAddress(["0x" + "a".repeat(40)]));
  ok(L.isHash32("0x" + "ab".repeat(32)) && !L.isAddress("0x" + "ab".repeat(32)) && !L.isHash32(lower), "a 64-hex value is a hash, not an address, and is not rejected as hex");
  // the secret scan flags labelled key material only; a page may carry 40-hex addresses and 64-hex hashes
  const scan = (t) => /(private[ _-]?key|secret|mnemonic|seed phrase)\s*[:=]\s*["']?(0x)?[0-9a-f]{32,}/i.test(t);
  ok(!scan(`address ${lower} hash 0x${"ab".repeat(32)}`) && scan(`private_key = 0x${"ab".repeat(32)}`), "the scan does not blanket-reject hex");
  ok(!scan(allJs + html + tokensCss));
});
gate("G08 keccak-256 and EIP-55 against published vectors", () => {
  eq(L.keccak256(L.utf8("")), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  eq(L.keccak256(L.utf8("abc")), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  ["0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359", "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB", "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb"].forEach((a) => ok(L.isAddress(a), a));
  eq(L.sealModel("x").hash, L.keccak256(L.utf8("x"))); eq(L.sealModel("x"), L.sealModel("x")); ok(L.sealModel("x").hash !== L.sealModel("y").hash);
  const m = L.sealModel("note"); eq([m.ticks.length, m.cells.length, m.cells[0].length], [36, 7, 4]); ok(m.notch % 4 === 0 && m.notch < 36);
});
gate("G09 PALETTE RULE: colour literals live in src/tokens.css only (no hex, rgb, hsl, oklch or named colours anywhere else)", () => {
  const lit = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(|(?<![-\w])(?:white|black|red|green|blue|gray|grey|orange|purple|yellow|pink|navy|teal|cyan|magenta)(?![-\w])/i;
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\("data:[^"]*"\)/g, "").replace(/(?<=[\w-])(white|black)-space/g, "").replace(/white-space/g, "");
  for (const p of walk(src)) {
    if (!TEXT.has(extname(p)) || p.endsWith("tokens.css") || p.endsWith("register.json")) continue;
    let t = rd(p); const named = !p.endsWith(".html"); if (!named) t = t.replace(/<!--[\s\S]*?-->/g, "").replace(/\{\{ground\}\}/, "");
    ok(!(named ? lit : /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/).test(strip(t)), "colour literal in " + relative(root, p));
  }
  const theme = html.match(/name="theme-color" content="(#[0-9a-f]{6})"/i)[1], man = JSON.parse(rd(join(dist, "site.webmanifest")));
  eq([theme, man.theme_color, man.background_color], [tokens.colours.ground.hex, tokens.colours.ground.hex, tokens.colours.ground.hex], "generated copies come from the token");
  ok(/PALETTE PROVENANCE/.test(tokensCss) && /Written by scripts\/sample-brand\.mjs/.test(tokensCss));
  ok(!/oklch|srgb,\s*#/.test(rd(join(src, "site.css"))), "site.css mixes variables only");
});
gate("G10 palette is sampled: every token is the exact colour of a real pixel at its recorded coordinate", () => {
  eq(tokens.sampled, true); ok(/k-means/.test(tokens.method) && /snapped to the nearest real pixel/.test(tokens.method));
  const cache = {};
  for (const [k, c] of Object.entries(tokens.colours)) {
    const img = cache[c.file] || (cache[c.file] = decode(join(root, c.file)));
    const i = (c.y * img.w + c.x) * 4, hex = "#" + [0, 1, 2].map((j) => img.data[i + j].toString(16).padStart(2, "0")).join("");
    eq(hex, c.hex, `${k} pixel at ${c.x},${c.y} of ${c.file}`);
    ok(tokensCss.includes(`--${k}: ${c.hex};`) && tokensCss.includes(`@ (${c.x},${c.y})`), k + " in tokens.css with provenance");
  }
  const hue = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (x * 60 + 360) % 360; };
  const C = tokens.colours;
  ok(hue(C.green.hex) > 140 && hue(C.green.hex) < 170 && hue(C.indigo.hex) > 235 && hue(C.lavender.hex) > 235 && hue(C.blue.hex) > 215, "brand hues");
  ok(lumOf(colour("var(--night)")) < 0.02 && lumOf(colour("var(--ground)")) > 0.85, "night is dark, ground is light");
});
gate("G11 alpha: the transparent logo is RGBA (IHDR colour type 6) with a pure-black clear area, so every resize is premultiplied and leaves no dark fringe", () => {
  const a = tokens.alphaReport; eq(a.file, "brand/LOGO BIND PNG...png"); ok(a.pureBlackTransparent > 3e6 && /premultiplied/.test(a.resize));
  const b = readFileSync(join(root, a.file)); eq([b[24], b[25]], [8, 6], "bit depth 8, colour type 6");
  const floor = Math.min(...["green", "lavender", "indigo"].map((k) => lumOf(colour(`var(--${k})`))));
  for (const w of [96, 192, 384, 768]) {
    const img = decode(join(dist, "img", `mark-${w}.png`)); let partial = 0, dark = 0;
    for (let i = 0; i < img.w * img.h; i++) { const al = img.data[i * 4 + 3]; if (al > 8 && al < 247) { partial++; if (lumOf([0, 1, 2].map((j) => img.data[i * 4 + j] / 255)) < floor * 0.6) dark++; } }
    ok(partial > 20 && dark / partial < 0.02, `mark-${w}: ${dark}/${partial} fringe pixels are darker than the darkest brand hue`);
  }
});
gate("G12 favicon is rebuilt from the real logo pixels: ico frames 16/32/48, brand hues present, clear corners", () => {
  const ico = readFileSync(join(dist, "favicon.ico")); eq([ico.readUInt16LE(2), ico.readUInt16LE(4)], [1, 3]);
  const sizes = [0, 1, 2].map((i) => ico[6 + 16 * i]); eq(sizes, [16, 32, 48]);
  for (const s of [16, 32, 48]) {
    const img = decode(join(dist, "img", `favicon-${s}.png`)); eq([img.w, img.h], [s, s]); ok(img.data[3] === 0, "corner is clear");
    const near = (h) => { const t = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); let n = 0; for (let i = 0; i < s * s; i++) if (img.data[i * 4 + 3] > 240 && [0, 1, 2].every((j) => Math.abs(img.data[i * 4 + j] - t[j]) < 40)) n++; return n; };
    ["green", "lavender", "indigo"].forEach((k) => ok(near(tokens.colours[k].hex) > 2, `favicon-${s} carries ${k}`));
  }
  const man = JSON.parse(rd(join(dist, "site.webmanifest"))); man.icons.forEach((i) => ok(existsSync(join(dist, i.src)), i.src));
  ok(/rel="icon" href="\/favicon\.ico"/.test(html) && /apple-touch-icon/.test(html) && !existsSync(join(dist, "favicon.svg")), "no placeholder svg favicon left");
});
gate("G13 copy: no word 2-gram shared with the six slides or the cover (Robinhood Chain excepted), none of their pitch words, no 3-gram from the other site", () => {
  const slides = rd(join(root, "test", "reference-copy.txt")).split("\n").filter((l) => !l.startsWith("#"));
  const other = rd(join(root, "test", "reference-merger.txt")).split("\n").filter((l) => !l.startsWith("#"));
  const lines = visibleLines(srcHtml).concat(jsStrings(liveJs)).concat(jsStrings(js["lib.js"]));
  const theirs = grams(slides), mine = grams(lines);
  eq([...mine].filter((g) => theirs.has(g) && !ALLOW.has(g)), [], "2-grams shared with the slides");
  const mineWords = new Set(lines.flatMap(words));
  eq(PITCH.filter((w) => mineWords.has(w)), [], "pitch words reused from the slides");
  const t3 = grams3(other); eq([...grams3(lines)].filter((g) => t3.has(g)), [], "3-grams shared with the other site");
  ok(mine.size > 600, "copy was actually read: " + mine.size);
  ok(!/merger|merrger/i.test(html + allJs), "no name of the other site");
});
gate("G14 chain reads: id 4663 enforced, node batch parsed with hash, DefiLlama and pool feeds parsed, malformed input is null", () => {
  eq([L.CHAIN_ID, regSrc.chain.id, regSrc.rpc.url], [4663, 4663, "https://rpc.mainnet.chain.robinhood.com"]);
  eq(L.parseRpc(F.rpcWrongChain), null); eq(L.parseRpc(F.rpcBroken), null); eq(L.parseRpc(null), null); eq(L.parseRpc({}), null);
  const r = L.parseRpc(F.rpcFor([1, 2, 3, 4], 1e6 * 1000)); eq([r.chainId, r.block, r.gasWei, r.blockHash], [4663, 1234567, 1e9, "0x" + "ab".repeat(32)]);
  eq(L.parseRpc(F.rpcOk), { chainId: 4663, block: 100, gasWei: 1e9, blockTime: 1e6, blockHash: "" });
  eq(L.parseLlama(F.llamaOk), { tvl: 2500000, name: "Synthetic Chain" }); eq(L.parseLlama(F.llamaMissing), null); eq(L.parseLlama("x"), null);
  const p = L.parsePools(F.pairsOk, "TOP", 0), q = L.parsePools(F.pairsOk, "LOW", 5);
  eq(p.map((x) => x.base), ["TOP"]); eq(q.length, 1); eq(L.parsePools(F.pairsOk, "OFF"), []); eq(L.parsePools(F.pairsOk, "NAN", 0), []); eq(L.parsePools(F.pairsOk, "ZERO", 0), []);
  eq(L.parsePools(F.pairsOk, "EVIL", 0)[0].url, "", "unsafe url dropped"); eq(L.parsePools(F.pairsOk, "TOP"), [], "under the liquidity floor"); eq(L.parsePools(null, "TOP"), null);
  eq(L.parsePools({ pairs: [{ ...F.pairsOk.pairs[1], baseToken: { symbol: "TOP", name: "Not a stock token" } }] }, "TOP", 0), [], "only Robinhood stock tokens");
});
gate("G15 the lane maths: median, bps, tint, range and position on fixtures; one pool has no book", () => {
  const book = L.spreadBook(L.parsePools(F.dexFor("TSLA"), "TSLA"));
  ok(Math.abs(book.median - 353.65) < 1e-9, "median of four"); eq(book.rows.map((r) => r.bps), [-7.1, 7.1, 41, -69.3]); eq(L.spreadBook(L.parsePools(F.dexFor("NVDA"), "NVDA")), null);
  ok(Math.abs(book.rows[0].bps - Math.round(((353.4 / 353.65) - 1) * 1e5) / 10) < 0.11, "bps = (price / median - 1) x 10,000");
  eq(L.laneRange(book), 80); eq(L.lanePos(0, 80), 50); eq(L.lanePos(80, 80), 100); eq(L.lanePos(-999, 80), 0);
  eq(L.tintOf(book, 1), "in"); eq(L.tintOf(book, 500), "out");
  eq(L.sortPools(book.rows, "vol")[0].base, "TSLA"); eq(L.sortPools(book.rows, "bps")[0].bps, Math.max(...book.rows.map((r) => Math.abs(r.bps))) * Math.sign(L.sortPools(book.rows, "bps")[0].bps));
  ok(/The pools are read again every 45 seconds/.test(js["live.js"]) && /No outside reference is read/.test(js["live.js"]), "the page says the centre is a median");
});
gate("G16 freshness windows, age units (floored), formatters", () => {
  eq(L.freshness("rpc", 10e3), "live"); eq(L.freshness("rpc", 60e3), "stale"); eq(L.freshness("rpc", 200e3), "unread"); eq(L.freshness("llama", 170e3), "live"); eq(L.freshness("dex", 599e3), "stale");
  eq(L.freshness("rpc", null), "unread"); eq(L.freshness("rpc", -5), "unread"); eq(L.freshness("nope", 1), "unread");
  eq([L.ageLabel(59999), L.ageLabel(60e3), L.ageLabel(3599e3), L.ageLabel(5400e3), L.ageLabel(3 * 86400e3), L.ageLabel(null)], ["59 s", "1 min", "59 min", "1 h 30 min", "3 d", ""]);
  eq([L.fmtInt(1234567), L.fmtGwei(1e9), L.fmtGwei(22222048), L.fmtUsd(1024906532), L.fmtUsd(2500000), L.fmtUsd(1500), L.fmtPrice(353.4), L.fmtPrice(0.001776), L.fmtPct(-2), L.fmtBps(7.1)], ["1,234,567", "1.00 gwei", "0.0222 gwei", "$1.02B", "$2.50M", "$1.5K", "$353.40", "$0.00178", "-2.00%", "+7.1"]);
});
gate("G17 no fabricated numbers: every live cell ships only an unread state; the one fixed fact is the chain id", () => {
  const cells = [...html.matchAll(/data-value>([\s\S]*?)<\/p>/g)].map((m) => m[1]).concat([...html.matchAll(/data-v>([\s\S]*?)<\/dd>/g)].map((m) => m[1]));
  eq(cells.length, 7, "live cells"); cells.forEach((c) => ok(!/\d/.test(c.replace(/<[^>]*>/g, "")), "digit in a live cell: " + c));
  ok(/<dd class="num">4663<\/dd>/.test(html));
  ok(/"unread"/.test(js["live.js"]) && /started \? "unread" : "reading"/.test(js["live.js"]), "an unanswered source reads unread");
});
gate("G18 network: only the three named services, taken from the register; no third-party asset; no innerHTML, eval or storage", () => {
  const hosts = new Set([...jsFiles.filter((f) => f !== "register.js").map((f) => js[f]).join("\n").matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]));
  const allowed = new Set(["www.w3.org", "rpc.mainnet.chain.robinhood.com", "api.llama.fi", "api.dexscreener.com", "dexscreener.com", "x.com", "twitter.com", "github.com"]);
  [...hosts].forEach((h) => ok(allowed.has(h), "unexpected host " + h));
  ok(!/<script[^>]+src="https?:/.test(html) && !/<link[^>]+href="https?:\/\/(?!bind\.onl)/.test(html), "no third-party assets");
  ok(/R\.rpc\.url/.test(js["live.js"]) && /R\.llama\.url/.test(js["live.js"]) && /R\.dexscreener\.url/.test(js["live.js"]), "urls come from the register");
  ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|localStorage|sessionStorage|document\.cookie/.test(allJs));
  ok(/credentials: "omit"/.test(js["site.js"]) && /credentials: "omit"/.test(js["live.js"]), "no credentials sent");
});
gate("G19 REPO HYGIENE: no CLAUDE.md, no .claude, no git metadata, no AI attribution anywhere in the project", () => {
  ["CLAUDE.md", ".claude", ".git", ".gitignore"].forEach((n) => ok(!existsSync(join(root, n)), n + " exists"));
  const bad = new RegExp(["clau" + "de", "anthro" + "pic", "co-?authored-?by", "generated (with|by)", "\\bA" + "I[- ]", "copi" + "lot", "chat" + "gpt", "\\bL" + "LM\\b"].join("|"), "i");
  for (const p of walk(root)) {
    const rel = relative(root, p).replace(/\\/g, "/");
    ok(!/(^|\/)(CLAUDE\.md|\.claude|\.git)(\/|$)/.test(rel), rel);
    if (TEXT.has(extname(p)) && rel !== "scripts/gates.mjs" && !rel.startsWith("package-lock") && !rel.startsWith("brand/analysis")) ok(!bad.test(rd(p)), "attribution-like text in " + rel);
  }
  const pkg = JSON.parse(rd(join(root, "package.json"))); ok(!pkg.author && !pkg.repository, "no author or repository field");
});
gate("G20 interaction parity with the reference: lane settle, rotation, pickers, filters, details, focus restore, held height, hidden-tab pause", () => {
  const css = rd(join(dist, "site.css"));
  ok(/BEAT = \{ rpc: 6e3, llama: 45e3, dex: 45e3, age: 1e3, turn: 9e3, fade: 260 \}/.test(js["live.js"]), "timing constants");
  ok(/transition: transform 1\.1s var\(--ease-2\)/.test(css) && /--ease-2: cubic-bezier\(0\.32, 0\.72, 0, 1\)/.test(css), "1.1 s settle on the reference easing");
  ok(/bk-still/.test(js["live.js"]) && /requestAnimationFrame\(function \(\) \{ requestAnimationFrame/.test(js["live.js"]), "marks start still, then settle");
  ok(/chosen \|\| hovered \|\| !seen \|\| document\.hidden \|\| B\.reduced\(\)/.test(js["live.js"]) && /bk-fade/.test(css), "rotation guards");
  ok(/visibilitychange/.test(js["live.js"]) && /document\.hidden/.test(js["live.js"]), "hidden-tab pause and refresh");
  ok(/aria-expanded/.test(js["live.js"]) && /container: bktable/.test(css) && /@container bktable \(max-width: 1049px\)/.test(css) && /@container bkhero/.test(css), "row sheets by container width");
  ok(/focus\(\{ preventScroll: true \}\)/.test(js["live.js"]) && /aria-busy/.test(js["live.js"]), "focus restore and busy state");
  ok(/ResizeObserver/.test(js["site.js"]) && /fonts\.ready/.test(js["site.js"]) && /relatedTarget/.test(js["site.js"]) && /Escape/.test(js["site.js"]), "held height, deep-link rescroll, menu focus rules");
  ok(/is-merged/.test(js["live.js"]) && /data-at/.test(js["site.js"]) && /scroll/.test(js["site.js"]), "merge band and pinned story, with the phone follower");
  ok(/prefers-reduced-motion:\s*reduce/.test(css) && /prefers-reduced-transparency/.test(css) && /B\.reduced\(\)/.test(js["live.js"]));
  ok(/\.js \[data-reveal\]/.test(css) && /html:not\(\.js\) \.if-js/.test(css) && count(/class="if-no-js">unread/g) >= 6, "no-script fallback says unread");
});
gate("G21 accessibility: skip link, landmarks, live regions, named controls, unique ids, focus ring, alt", () => {
  const css = rd(join(dist, "site.css"));
  ok(/class="skip" href="#main"/.test(html) && /<main id="main">/.test(html) && /<header/.test(html) && /<footer/.test(html) && /<nav[^>]+aria-label/.test(html));
  ok(/role="status"[^>]*data-bookstate/.test(html) && /:focus-visible/.test(css) && count(/aria-live="polite"/g) >= 2);
  ok(!/<img(?![^>]*alt=)/.test(html), "img alt");
  [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].forEach((m) => ok(/[A-Za-z]{3,}/.test(m[1].replace(/<svg[\s\S]*?<\/svg>/g, "")) || /aria-label/.test(m[0]), "unnamed button"));
  [...html.matchAll(/\sid="([^"]+)"/g)].forEach((m) => eq(count(new RegExp(`\\sid="${m[1]}"`, "g")), 1, "duplicate id " + m[1]));
  ok(!/\.live__text\s*\{[^}]*display:\s*none/.test(css), "the state word is never display:none");
});
gate("G22 contrast from the sampled tokens (srgb mixes evaluated): text 4.5:1 on its surfaces", () => {
  const pairs = [["ink", "ground"], ["ink", "paper"], ["ink", "mist"], ["ink-2", "ground"], ["ink-2", "paper"], ["ink-2", "mist"], ["ink-3", "ground"], ["ink-3", "paper"], ["ink-3", "mist"],
    ["blue", "ground"], ["blue", "paper"], ["blue", "mist"], ["on-seal", "night"], ["on-seal-2", "night"], ["on-seal", "indigo"], ["on-seal-2", "indigo"], ["paper", "ink"], ["night", "green"], ["ink", "green-ink"], ["on-seal", "green-ink"]];
  pairs.forEach(([a, b]) => { if (a === "ink" && b === "green-ink") return; ok(contrast(a, b) >= 4.5, `${a} on ${b}: ${contrast(a, b).toFixed(2)}`); });
  ok(contrast("ink", "snow") >= 4.5 && contrast("blue", "snow") >= 4.5);
});
gate("G23 state is never hue alone: live solid, stale half, unread hollow, with a glyph legend on the page", () => {
  const css = rd(join(dist, "site.css"));
  ok(/data-state="live"\]::before \{[^}]*background: var\(--green\)/.test(css) && /data-state="stale"\]::before \{[^}]*linear-gradient/.test(css) && /box-shadow: inset 0 0 0 1\.75px currentColor/.test(css));
  ok(/glyph--live/.test(html) && /glyph--stale/.test(html) && /glyph--unread/.test(html));
});
gate("G24 js is ASCII-only (no encoding dependence), parses, and lib exports the full api", () => {
  jsFiles.forEach((f) => { ok(!/[^\x00-\x7f]/.test(js[f]), f + " has non-ASCII characters"); const r = spawnSync(process.execPath, ["--check", join(dist, f)]); eq(r.status, 0, f + ": " + r.stderr); });
  ["parseRpc", "parseLlama", "parsePools", "spreadBook", "sortPools", "freshness", "recordView", "handleOf", "isAddress", "isHash32", "keccak256", "sealModel", "proofText", "fmtUsd"].forEach((k) => eq(typeof L[k], "function", k));
});
gate("G25 proof note: text carries only chain facts; seal is deterministic; no address, balance or signature", () => {
  const n = L.proofText({ block: 100, blockTime: 1e6, blockHash: "0x" + "ab".repeat(32), gasWei: 1e9, tvl: 2.5e6, ticker: "TSLA", book: L.spreadBook(L.parsePools(F.dexFor("TSLA"), "TSLA")) });
  ok(/^BIND receipt, Robinhood Chain \(id 4663\)/.test(n) && /Block 100 at 1970-01-01T00:16:40Z/.test(n) && /Block hash 0x(ab){32}/.test(n) && /Chain TVL \$2\.50M/.test(n) && /TSLA: 4 pools, widest gap 69\.3 bps/.test(n) && /bind\.onl$/.test(n));
  ok(!/0x[0-9a-f]{40}\b/i.test(L.proofText({ block: 1, blockHash: "", ticker: "", book: null })), "no address shape in a note");
  ok(/https:\/\/x\.com\/intent\/post\?text=/.test(js["proof.js"]) && /clipboard\.writeText\(text\)/.test(js["proof.js"]) && /frozen/.test(js["proof.js"]), "copy, post intent, hold still while used");
  ok(/class="rc__foot"/.test(html) && /no address, no balance and no signature/.test(html));
});
gate("G26 fixtures are synthetic, labelled and never shipped; reference text is test-only", () => {
  eq(F.SYNTHETIC, true); ok(/SYNTHETIC FIXTURES/.test(rd(join(root, "test", "fixtures.mjs"))));
  ok(!existsSync(join(dist, "fixtures.mjs")) && !existsSync(join(dist, "test")) && !existsSync(join(dist, "reference-copy.txt")) && !existsSync(join(dist, "register.json")));
  ok(!/reference-copy|reference-merger/.test(html + allJs));
});
gate("G27 weight: the page, styles and scripts stay small; images are the only heavy files", () => {
  const size = (f) => statSync(join(dist, f)).size;
  ok(size("index.html") < 32e3 && size("site.css") < 60e3 && ["lib.js", "site.js", "live.js", "proof.js"].reduce((n, f) => n + size(f), 0) < 70e3);
  const total = walk(dist).reduce((n, f) => n + statSync(f).size, 0); ok(total < 1.5e6, `dist is ${(total / 1024).toFixed(0)} KB`);
});

let browserResults = null;
gate("G28 five widths 360/390/430/1366/1440 in a real browser: no horizontal overflow, every control at least 48 px, no console errors, nothing external", async () => {
  browserResults = await measure();
  eq(browserResults.map((r) => r.width), VIEWPORTS);
  for (const r of browserResults) {
    eq(r.overflowPx, 0, `${r.width}px overflow`); eq(r.offenders, [], `${r.width}px elements past the edge`); eq(r.small, [], `${r.width}px tap targets under 48 px`);
    eq(r.errors, [], `${r.width}px console errors`); eq(r.external, [], `${r.width}px requests outside the fixtures`); ok(r.tables >= 4, `${r.width}px drew the pool book`);
    if (r.menuTargets) r.menuTargets.forEach((h) => ok(h >= 48, `${r.width}px menu link ${h}px`));
    ok(r.ca.fits && r.ca.top >= 0 && r.ca.top <= 12, `${r.width}px CA slot visible and whole: ${JSON.stringify(r.ca)}`);
  }
});
gate("G29 the five standing rules are each enforced by a gate above (register G04-G06, link G05, gate warning G07, palette G09-G12, hygiene G19)", () => {
  const titles = gates.map(([n]) => n.slice(0, 3)); ok(titles.includes("G04") && titles.includes("G05") && titles.includes("G07") && titles.includes("G09") && titles.includes("G10") && titles.includes("G19"));
  ok(gates.length <= 30, "at most 30 gates");
});
gate("G30 fast clock: constants not wall-clock waits; the whole run inside 5 minutes", () => {
  ok(Date.now() - T0 < 300e3, "over budget");
  ok(!/setTimeout\([^)]*,\s*(\d{5,})/.test(js["live.js"].replace(/8000/g, "")), "no long waits");
});

let pass = 0, fail = 0;
const only = (process.env.ONLY || "").split(",").filter(Boolean);
for (const [name, fn] of gates) {
  if (only.length && !only.some((o) => name.startsWith(o + " "))) continue;
  try { await fn(); pass++; console.log("PASS " + name); } catch (e) { fail++; console.log("FAIL " + name + "\n     " + String(e.message).slice(0, 900)); }
}
console.log(`\n${pass}/${gates.length} gates passed in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
process.exit(fail ? 1 : 0);
