// Builds dist/ from src/: copies files, fills the html slots from the register and the sampled tokens, and emits
// register.js and site.webmanifest. No dependencies. build(outDir) is exported so the gates can rebuild in memory.
import { rmSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const walk = (d, o = []) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, o) : o.push(p); } return o; };

function loadLib() {
  const ctx = { window: {}, URL, TextEncoder }; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(join(src, "lib.js"), "utf8"), ctx);
  return ctx.window.BindLib;
}

export function validate(reg, L) {
  const need = ["ca", "x", "github", "launch", "domain", "chain", "rpc", "llama", "dexscreener", "explorer"];
  for (const k of need) {
    const r = reg[k];
    if (!r || !L.STATES.includes(r.state)) throw new Error(`register.${k}: state must be one of ${L.STATES.join(", ")}`);
    const payload = r.value || r.url || "";
    if (r.state === "absent" && payload) throw new Error(`register.${k}: absent must carry no value`);
    if (r.state !== "absent" && !payload && k !== "chain") throw new Error(`register.${k}: ${r.state} needs a value`);
    if (r.url && !L.httpsUrl(r.url)) throw new Error(`register.${k}: url must be https`);
  }
  if (reg.ca.state !== "absent" && !L.isAddress(reg.ca.value)) throw new Error("register.ca: not a valid address (EIP-55 checked when mixed case)");
  if (reg.chain.id !== 4663) throw new Error("register.chain.id must be 4663");
  for (const k of ["x", "github"]) if (reg[k].state !== "absent" && !L.handleOf(k, reg[k].url)) throw new Error(`register.${k}: url does not name a profile`);
  return true;
}

const icon = {
  x: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M17.75 3h3.1l-6.77 7.73L22 21h-6.24l-4.89-6.39L5.27 21H2.17l7.24-8.27L2 3h6.4l4.42 5.84L17.75 3Zm-1.09 16.15h1.72L7.42 4.75H5.58l11.08 14.4Z"/></svg>',
  github: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.15-1.11-1.46-1.11-1.46-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>'
};
const NAME = { x: "X", github: "GitHub" };

export function slots(reg, L) {
  const ca = L.recordView("ca", reg.ca);
  let caHtml;
  if (ca.state === "stated") {
    caHtml = `<div class="ca" data-ca data-state="stated"><span class="pill">CA</span><button type="button" class="ca__btn" data-ca-btn aria-label="Copy contract address ${esc(ca.text)}"><span class="ca__addr mono" data-ca-text>${esc(ca.text)}</span><span class="ca__hint" data-ca-hint>Click to copy</span></button><span class="sr" role="status" aria-live="polite" data-ca-live></span></div>`;
  } else if (ca.state === "unconfirmed") {
    caHtml = `<div class="ca" data-ca data-state="unconfirmed"><span class="pill">CA</span><span class="ca__addr mono" data-ca-text>${esc(ca.text)}</span><span class="ca__hint">Unconfirmed</span><span class="sr" role="status" aria-live="polite" data-ca-live></span></div>`;
  } else {
    caHtml = `<div class="ca" data-ca data-state="absent"><span class="pill">CA</span><span class="ca__addr" data-ca-text aria-disabled="true">Not stated yet</span><span class="ca__hint">Inert until stated</span><span class="sr" role="status" aria-live="polite" data-ca-live></span></div>`;
  }
  const mirror = `<span class="mono" data-ca-mirror data-state="${ca.state}">${ca.state === "absent" ? "Not stated yet" : esc(ca.text)}</span>`;
  const socials = ["x", "github"].map((k) => {
    const v = L.recordView(k, reg[k]);
    if (v.state === "stated") return `<a class="social" data-social="${k}" data-state="stated" href="${esc(v.href)}" target="_blank" rel="noopener noreferrer" aria-label="${NAME[k]}, ${esc(v.handle)}, opens in a new tab">${icon[k]}</a>`;
    const why = v.state === "unconfirmed" ? "unconfirmed" : "not stated yet";
    return `<a class="social" data-social="${k}" data-state="${v.state}" role="link" aria-disabled="true" aria-label="${NAME[k]}, ${why}">${icon[k]}</a>`;
  }).join("");
  const l = L.recordView("launch", reg.launch);
  const launch = l.state === "stated" ? `<p class="tokenband__date">Opens <time datetime="${esc(l.text)}">${esc(l.text)}</time></p>` : "";
  return { ca: caHtml, mirror, socials, launch };
}

export function build(outDir = join(root, "dist")) {
  const L = loadLib();
  const reg = JSON.parse(readFileSync(join(src, "register.json"), "utf8"));
  validate(reg, L);
  const tok = JSON.parse(readFileSync(join(root, "brand", "tokens.json"), "utf8"));
  const s = slots(reg, L);
  const files = new Map();
  for (const p of walk(src)) {
    const rel = relative(src, p).replace(/\\/g, "/");
    if (rel === "register.json") continue;
    let buf = readFileSync(p);
    if (rel.endsWith(".html")) {
      buf = Buffer.from(buf.toString("utf8")
        .replace("<!--slot:ca-->", s.ca)
        .replaceAll("<!--slot:ca-mirror-->", s.mirror)
        .replace("<!--slot:socials-->", s.socials)
        .replace("<!--slot:launch-->", s.launch)
        .replaceAll("{{ground}}", tok.colours.ground.hex), "utf8");
      if (/<!--slot:|\{\{/.test(buf.toString("utf8"))) throw new Error(rel + ": unfilled slot");
    }
    files.set(rel, buf);
  }
  const pub = {}; for (const k of Object.keys(reg)) if (k !== "_note") pub[k] = reg[k];
  files.set("register.js", Buffer.from("/* Built from src/register.json by scripts/build.mjs. */\nwindow.BIND_REGISTER = Object.freeze(" + JSON.stringify(pub) + ");\n"));
  files.set("site.webmanifest", Buffer.from(JSON.stringify({ name: "BIND", short_name: "BIND", start_url: "/", display: "standalone", theme_color: tok.colours.ground.hex, background_color: tok.colours.ground.hex, icons: [{ src: "/img/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/img/icon-512.png", sizes: "512x512", type: "image/png" }] }, null, 2) + "\n"));
  if (outDir) {
    rmSync(outDir, { recursive: true, force: true });
    for (const [rel, buf] of files) { const to = join(outDir, rel); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, buf); }
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = build();
  const bytes = [...files.values()].reduce((n, b) => n + b.length, 0);
  console.log(`build ok: ${files.size} files, ${(bytes / 1024).toFixed(1)} KB -> dist/`);
}
