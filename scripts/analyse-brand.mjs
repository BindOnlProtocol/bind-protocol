// Reads every file in brand/ and reference/: IHDR, alpha histogram, dominant pixels. Prints JSON; writes brand/analysis.json.
import { readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decode, alphaReport, dominant } from "./lib-img.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = {};
for (const dir of ["brand", "reference"]) {
  for (const n of readdirSync(join(root, dir))) {
    if (!/\.(png|jpe?g)$/i.test(n)) continue;
    const img = decode(join(root, dir, n));
    out[`${dir}/${n}`] = { kind: img.kind, ihdr: img.ihdr, size: [img.w, img.h], bytes: img.bytes, alpha: alphaReport(img), dominant: dominant(img, 6) };
  }
}
writeFileSync(join(root, "brand", "analysis.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 1));
