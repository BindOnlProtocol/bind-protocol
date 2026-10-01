// Samples the palette from the real brand assets and rebuilds the raster marks.
//   node scripts/sample-brand.mjs
// Writes: brand/tokens.json (provenance), src/tokens.css (the one file with colour literals),
//         src/img/* (mark, favicons, og image). Deterministic: seeded k-means, no clock, no randomness.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decode, alphaReport, kmeans, hex, bounds, crop, resizePremul, encodePng } from "./lib-img.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = (...a) => join(root, ...a);
const F = {
  markPng: "brand/LOGO BIND PNG...png",      // transparent, RGBA, flat colours: the source of the mark hues
  nightPng: "brand/LOGO BIND PNG.png",        // the mark on its dark ground: the source of night
  slide: "reference/BIND 1.jpg.jpeg",          // light slide: ground, headline ink, wordmark blue
  cover: "reference/SAMPUL BIND JPG.jpg.jpeg"  // the cover, shipped as the share image
};
const SEED = 7;
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const sat = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return (Math.max(...c) - Math.min(...c)) / (Math.max(...c) || 1); };
const hue = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); if (!d) return 0; const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (x * 60 + 360) % 360; };

const mark = decode(P(F.markPng));
const alpha = alphaReport(mark);
const night = decode(P(F.nightPng));
const slide = decode(P(F.slide));
const cover = decode(P(F.cover));

// --- mark hues: k = 3 over the fully opaque pixels of the transparent logo
const m3 = kmeans(mark, 3, { seed: SEED });
const byHue = [...m3];
const green = byHue.find((c) => hue(c.hex) > 120 && hue(c.hex) < 180);
const rest = byHue.filter((c) => c !== green).sort((a, b) => lum(b.hex) - lum(a.hex));
const lavender = rest[0], indigo = rest[1];

// --- ground: the slide's background (top strip, k = 1)
const ground = kmeans(slide, 1, { seed: SEED, region: [0, 0, 1600, 24] })[0];
// --- ink: the darkest of three clusters over the headline block
const ink = kmeans(slide, 3, { seed: SEED, region: [90, 265, 840, 470] }).sort((a, b) => lum(a.hex) - lum(b.hex))[0];
// --- wordmark blue: the most saturated of three clusters over the BIND wordmark
const blue = kmeans(slide, 3, { seed: SEED, region: [95, 35, 310, 105] }).sort((a, b) => sat(b.hex) - sat(a.hex))[0];
// --- night: the largest cluster over the top band of the dark logo
const nightC = kmeans(night, 2, { seed: SEED, region: [0, 0, 2000, 300] })[0];

// --- snow: the lightest cluster over the BIND wordmark on the cover (the brightest real pixels in the set)
const snow = kmeans(cover, 3, { seed: SEED, region: [408, 148, 642, 218] }).sort((a, b) => lum(b.hex) - lum(a.hex))[0];

const roles = { ground: [ground, F.slide, "top strip k=1"], ink: [ink, F.slide, "headline block k=3, darkest"], blue: [blue, F.slide, "wordmark k=3, most saturated"], green: [green, F.markPng, "mark k=3, hue 120-180"], lavender: [lavender, F.markPng, "mark k=3, lightest of the two blue-violets"], indigo: [indigo, F.markPng, "mark k=3, darkest of the two blue-violets"], night: [nightC, F.nightPng, "top band k=2, largest"], snow: [snow, F.cover, "cover wordmark k=3, lightest"] };

const tokens = {
  sampled: true,
  method: "seeded k-means (k-means++ init, seed " + SEED + ", 24 iterations) over opaque pixels; each centroid is snapped to the nearest real pixel of its cluster and that pixel's exact colour is the token",
  alphaReport: { file: F.markPng, ...alpha, resize: alpha.pureBlackTransparent > 0 ? "premultiplied (pure-black transparent region found)" : "straight" },
  colours: Object.fromEntries(Object.entries(roles).map(([k, [c, file, how]]) => [k, { hex: c.hex, file, x: c.x, y: c.y, share: c.share, centroid: c.centroid, how }]))
};
writeFileSync(P("brand", "tokens.json"), JSON.stringify(tokens, null, 2) + "\n");

// --- src/tokens.css: the ONE file with colour literals
const c = tokens.colours;
const prov = (k) => `/* ${c[k].file} @ (${c[k].x},${c[k].y}) share ${c[k].share}, ${c[k].how}, centroid ${c[k].centroid} */`;
const css = `/* Written by scripts/sample-brand.mjs. Do not edit by hand.
   PALETTE PROVENANCE: every literal below is the exact colour of a real pixel in the brand or reference assets.
   Method: ${tokens.method}.
   This is the only file allowed to hold a colour literal; every other stylesheet reads these variables. */
:root {
  --ground: ${c.ground.hex}; ${prov("ground")}
  --ink: ${c.ink.hex}; ${prov("ink")}
  --blue: ${c.blue.hex}; ${prov("blue")}
  --green: ${c.green.hex}; ${prov("green")}
  --lavender: ${c.lavender.hex}; ${prov("lavender")}
  --indigo: ${c.indigo.hex}; ${prov("indigo")}
  --night: ${c.night.hex}; ${prov("night")}
  --snow: ${c.snow.hex}; ${prov("snow")}

  /* derived only by mixing the sampled values above (srgb), never a new literal */
  --paper: color-mix(in srgb, var(--ground) 40%, var(--snow));
  --ink-2: color-mix(in srgb, var(--ink) 84%, var(--ground));
  --ink-3: color-mix(in srgb, var(--ink) 77%, var(--ground));
  --mist: color-mix(in srgb, var(--lavender) 14%, var(--ground));
  --line: color-mix(in srgb, var(--ink) 11%, var(--ground));
  --line-2: color-mix(in srgb, var(--ink) 16%, transparent);
  --green-ink: color-mix(in srgb, var(--green) 38%, var(--ink));
  --seal: var(--night);
  --on-seal: color-mix(in srgb, var(--ground) 88%, var(--snow));
  --on-seal-2: color-mix(in srgb, var(--ground) 84%, var(--night));
  --shade: color-mix(in srgb, var(--indigo) 30%, transparent);
}
`;
writeFileSync(P("src", "tokens.css"), css);

// --- rasters from the real logo pixel grid (premultiplied resize: the transparent area is pure black)
mkdirSync(P("src", "img"), { recursive: true });
const [bx0, by0, bx1, by1] = bounds(mark);
const glyph = crop(mark, bx0, by0, bx1, by1);
const out = (name, buf) => writeFileSync(P("src", "img", name), buf);
const widths = [96, 192, 384, 768];
for (const w of widths) out(`mark-${w}.png`, encodePng(resizePremul(glyph, w, Math.round((w * glyph.h) / glyph.w))));

const square = (size, pad, bg) => {
  const inner = Math.round(size * (1 - 2 * pad));
  const g = resizePremul(glyph, inner, Math.round((inner * glyph.h) / glyph.w));
  const buf = Buffer.alloc(size * size * 4);
  if (bg) for (let i = 0; i < size * size; i++) { buf[i * 4] = bg[0]; buf[i * 4 + 1] = bg[1]; buf[i * 4 + 2] = bg[2]; buf[i * 4 + 3] = 255; }
  const ox = Math.floor((size - g.w) / 2), oy = Math.floor((size - g.h) / 2);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const s = (y * g.w + x) * 4, d = ((oy + y) * size + ox + x) * 4, a = g.data[s + 3] / 255;
    if (bg) { for (let k = 0; k < 3; k++) buf[d + k] = Math.round(g.data[s + k] * a + buf[d + k] * (1 - a)); }
    else { buf[d] = g.data[s]; buf[d + 1] = g.data[s + 1]; buf[d + 2] = g.data[s + 2]; buf[d + 3] = g.data[s + 3]; }
  }
  return { w: size, h: size, data: buf };
};
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const fav = {};
for (const s of [16, 32, 48]) { fav[s] = encodePng(square(s, s <= 32 ? 0.04 : 0.06)); out(`favicon-${s}.png`, fav[s]); }
out("apple-touch-icon.png", encodePng(square(180, 0.16, rgb(c.ground.hex))));
out("icon-192.png", encodePng(square(192, 0.14)));
out("icon-512.png", encodePng(square(512, 0.14)));
// favicon.ico: three PNG-encoded frames
const frames = [16, 32, 48].map((s) => fav[s]);
const head = Buffer.alloc(6 + 16 * frames.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
let off = head.length;
frames.forEach((b, i) => { const s = [16, 32, 48][i], o = 6 + 16 * i; head[o] = s; head[o + 1] = s; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(b.length, o + 8); head.writeUInt32LE(off, o + 12); off += b.length; });
writeFileSync(P("src", "favicon.ico"), Buffer.concat([head, ...frames]));
copyFileSync(P(F.cover), P("src", "img", "og.jpg"));

console.log(JSON.stringify({ alpha: tokens.alphaReport, colours: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, `${v.hex} @${v.x},${v.y}`])), glyph: [glyph.w, glyph.h] }, null, 1));
