// Loads dist/ in a real browser at five widths with the three live services replaced by synthetic fixtures, then
// measures horizontal overflow and tap-target size. Used by the gates; run alone it prints a table (SHOTS=dir saves pngs).
import http from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import * as F from "../test/fixtures.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
export const VIEWPORTS = [360, 390, 430, 1366, 1440];
const BROWSERS = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"];
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".txt": "text/plain" };

function serve() {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let u = q.url.split("?")[0]; if (u === "/") u = "/index.html";
      const p = join(dist, u);
      if (!p.startsWith(dist) || !existsSync(p)) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" }); r.end(readFileSync(p));
    }).listen(0, "127.0.0.1", () => res(s));
  });
}

/* runs inside the page: what overflows, and which tap targets are under 48 px */
const probe = () => {
  const vw = document.documentElement.clientWidth, out = { vw, scrollW: document.documentElement.scrollWidth, offenders: [], small: [] };
  const vis = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !(r.bottom <= 0 && r.top < -20) && !el.closest("[hidden]"); };
  const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "") + (el.textContent ? ` "${el.textContent.trim().slice(0, 24)}"` : "");
  document.querySelectorAll("body *").forEach((el) => {
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) { if (!el.closest(".sr, .skip") && getComputedStyle(el).position !== "fixed") out.offenders.push(name(el) + ` [${Math.round(r.left)}..${Math.round(r.right)}]`); }
  });
  document.querySelectorAll("a[href], button:not([disabled]), [role=link][aria-disabled], [role=button], input, select, textarea, summary").forEach((el) => {
    if (!vis(el) || el.closest(".sr")) return;
    const r = el.getBoundingClientRect();
    if (r.top + scrollY < -1 || el.classList.contains("skip")) return;
    if (r.height < 47.5 || r.width < 47.5) out.small.push(name(el) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
  });
  return out;
};

export async function measure({ shots } = {}) {
  const exe = BROWSERS.find(existsSync);
  if (!exe) throw new Error("no Edge or Chrome found for the browser gate");
  const server = await serve(), base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const results = [];
  try {
    for (const width of VIEWPORTS) {
      const page = await browser.newPage(), errors = [], external = [];
      const mobile = width <= 430;
      await page.setViewport({ width, height: mobile ? 800 : 900, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await page.setRequestInterception(true);
      page.on("pageerror", (e) => errors.push(String(e.message || e)));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("request", async (req) => {
        const u = new URL(req.url());
        if (u.hostname === "127.0.0.1" || u.protocol === "data:") return req.continue();
        const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
        if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: cors });
        if (u.hostname === "rpc.mainnet.chain.robinhood.com") {
          const batch = JSON.parse(req.postData() || "[]");
          return req.respond({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(F.rpcFor(batch.map((b) => b.id), Date.now())) });
        }
        if (u.hostname === "api.llama.fi") return req.respond({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(F.llamaOk) });
        if (u.hostname === "api.dexscreener.com") return req.respond({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(F.dexFor(u.searchParams.get("q"))) });
        external.push(req.url()); return req.abort();
      });
      await page.goto(base, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector("[data-bookstate]")?.getAttribute("data-state") === "live" && document.querySelectorAll("[data-book] .bk-group").length > 0, { timeout: 15000 });
      await new Promise((r) => setTimeout(r, 1500)); // let the marks settle
      await page.evaluate(() => document.querySelectorAll("[data-reveal]").forEach((e) => e.classList.add("is-in")));
      const m = await page.evaluate(probe);
      let menu = null;
      if (mobile) {
        await page.click("[data-menu]");
        menu = await page.evaluate(() => [...document.querySelectorAll("#site-nav a")].map((a) => Math.round(a.getBoundingClientRect().height)));
      }
      const ca = await page.evaluate(() => { const a = document.querySelector("[data-ca-text]"), b = document.querySelector("[data-ca]"); const r = a.getBoundingClientRect(); return { text: a.textContent.trim(), fits: a.scrollWidth <= Math.ceil(a.clientWidth) + 1 && r.right <= b.getBoundingClientRect().right + 1, top: Math.round(document.querySelector("[data-ca]").getBoundingClientRect().top) }; });
      const tables = await page.evaluate(() => document.querySelectorAll(".bk-table").length);
      if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `bind-${width}.png`), fullPage: true }); }
      results.push({ width, overflowPx: Math.max(0, m.scrollW - m.vw), offenders: m.offenders.slice(0, 6), small: m.small.slice(0, 8), menuTargets: menu, ca, tables, errors, external });
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await measure({ shots: process.env.SHOTS });
  for (const x of r) console.log(x.width, `overflow ${x.overflowPx}px`, `offenders ${x.offenders.length}`, `small ${x.small.length}`, x.small.join(" | "), x.offenders.join(" | "), x.errors.join(" | "), JSON.stringify(x.ca), "menu", JSON.stringify(x.menuTargets));
}
