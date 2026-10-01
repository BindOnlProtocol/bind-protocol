// Image helpers for the brand sampler: decode, IHDR, alpha histogram, seeded k-means, premultiplied resize.
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

export function decode(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) === 0x89504e47) {
    const png = PNG.sync.read(buf);
    const ihdr = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colourType: buf[25], interlace: buf[28] };
    return { kind: "png", ihdr, w: png.width, h: png.height, data: png.data, bytes: buf.length };
  }
  const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { kind: "jpeg", ihdr: null, w: j.width, h: j.height, data: j.data, bytes: buf.length };
}

export function alphaReport(img) {
  const d = img.data, n = img.w * img.h;
  let zero = 0, partial = 0, full = 0, blackClear = 0, colourClear = 0;
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3];
    if (a === 0) { zero++; if (d[i * 4] === 0 && d[i * 4 + 1] === 0 && d[i * 4 + 2] === 0) blackClear++; else colourClear++; }
    else if (a === 255) full++; else partial++;
  }
  return { transparent: zero, partial, opaque: full, pureBlackTransparent: blackClear, colouredTransparent: colourClear };
}

/* 32-step-per-channel quantised histogram: the dominant opaque colours, with one real pixel for each */
export function dominant(img, top = 8, minAlpha = 255) {
  const d = img.data, map = new Map();
  for (let i = 0; i < img.w * img.h; i++) {
    if (d[i * 4 + 3] < minAlpha) continue;
    const k = ((d[i * 4] >> 3) << 10) | ((d[i * 4 + 1] >> 3) << 5) | (d[i * 4 + 2] >> 3);
    const e = map.get(k) || { n: 0, i };
    e.n++; map.set(k, e);
  }
  const total = [...map.values()].reduce((s, e) => s + e.n, 0);
  return [...map.values()].sort((a, b) => b.n - a.n).slice(0, top).map((e) => {
    const x = e.i % img.w, y = (e.i / img.w) | 0;
    return { share: +(e.n / total).toFixed(4), hex: hex(d[e.i * 4], d[e.i * 4 + 1], d[e.i * 4 + 2]), x, y };
  });
}

export const hex = (r, g, b) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

function prng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/* k-means++ seeded, on a stride subsample of opaque pixels. Returns centroids snapped to the nearest real pixel. */
export function kmeans(img, k, { seed = 7, minAlpha = 255, maxSamples = 60000, iters = 24, region = null } = {}) {
  const d = img.data, rnd = prng(seed), pts = [];
  const x0 = region ? region[0] : 0, y0 = region ? region[1] : 0, x1 = region ? region[2] : img.w, y1 = region ? region[3] : img.h;
  const area = (x1 - x0) * (y1 - y0), stride = Math.max(1, Math.floor(area / maxSamples));
  let c = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (c++ % stride) continue;
    const i = y * img.w + x;
    if (d[i * 4 + 3] >= minAlpha) pts.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2], x, y]);
  }
  const dist = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  const cent = [pts[Math.floor(rnd() * pts.length)].slice(0, 3)];
  while (cent.length < k) {
    const ds = pts.map((p) => Math.min(...cent.map((q) => dist(p, q))));
    const sum = ds.reduce((a, b) => a + b, 0); let r = rnd() * sum, j = 0;
    while (j < ds.length - 1 && (r -= ds[j]) > 0) j++;
    cent.push(pts[j].slice(0, 3));
  }
  let asg = new Array(pts.length).fill(0);
  for (let it = 0; it < iters; it++) {
    asg = pts.map((p) => { let b = 0, bd = Infinity; cent.forEach((q, j) => { const v = dist(p, q); if (v < bd) { bd = v; b = j; } }); return b; });
    const acc = cent.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => { const a = acc[asg[i]]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++; });
    acc.forEach((a, j) => { if (a[3]) cent[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  return cent.map((q, j) => {
    const members = pts.filter((_, i) => asg[i] === j);
    let best = null, bd = Infinity;
    members.forEach((p) => { const v = dist(p, q); if (v < bd) { bd = v; best = p; } });
    if (!best) return null;
    return { share: +(members.length / pts.length).toFixed(4), centroid: hex(...q.map(Math.round)), hex: hex(best[0], best[1], best[2]), x: best[3], y: best[4] };
  }).filter(Boolean).sort((a, b) => b.share - a.share);
}

/* Premultiplied-alpha box resize: colour is averaged weighted by alpha, so a transparent (0,0,0,0) region
   never darkens an edge. Output is straight (un-premultiplied) RGBA. */
export function crop(img, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0, out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) img.data.copy ? img.data.copy(out, y * w * 4, ((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x1) * 4) : out.set(img.data.subarray(((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x1) * 4), y * w * 4);
  return { w, h, data: out };
}

export function resizePremul(img, W, H) {
  const out = Buffer.alloc(W * H * 4), sx = img.w / W, sy = img.h / H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xa = x * sx, xb = (x + 1) * sx, ya = y * sy, yb = (y + 1) * sy;
    let r = 0, g = 0, b = 0, a = 0, wsum = 0;
    for (let yy = Math.floor(ya); yy < Math.ceil(yb); yy++) {
      const wy = Math.min(yy + 1, yb) - Math.max(yy, ya);
      for (let xx = Math.floor(xa); xx < Math.ceil(xb); xx++) {
        const wx = Math.min(xx + 1, xb) - Math.max(xx, xa), wgt = wx * wy, i = (yy * img.w + xx) * 4, al = img.data[i + 3] / 255;
        r += img.data[i] * al * wgt; g += img.data[i + 1] * al * wgt; b += img.data[i + 2] * al * wgt; a += al * wgt; wsum += wgt;
      }
    }
    const o = (y * W + x) * 4;
    if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
    out[o + 3] = Math.round((a / wsum) * 255);
  }
  return { w: W, h: H, data: out };
}

export function bounds(img, alphaMin = 8) {
  let x0 = img.w, y0 = img.h, x1 = 0, y1 = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.data[(y * img.w + x) * 4 + 3] >= alphaMin) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1 + 1, y1 + 1];
}

export function encodePng(img) { const p = new PNG({ width: img.w, height: img.h }); Buffer.from(img.data).copy(p.data); return PNG.sync.write(p); }
