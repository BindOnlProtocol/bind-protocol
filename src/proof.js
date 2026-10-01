/* The proof note: a short plain-text receipt written from the page's own reads, and a seal drawn from that text.
   Nothing in it is an address, a balance or a signature. It refreshes with each read until the pointer or focus is on
   the tool, then holds still so the note you are about to copy does not change under you. */
(function () {
  "use strict";

  var L = window.BindLib, B = window.BIND, h = B.h;
  var box = document.querySelector("[data-proof]");
  if (!box) return;

  var inc = { block: true, hash: true, gas: false, tvl: false, lane: true };
  var frozen = false, text = "", timer = 0;
  var sealEl = box.querySelector("[data-seal]"), noteEl = box.querySelector("[data-note]");
  var copyBtn = box.querySelector("[data-copy]"), post = box.querySelector("[data-post]"), live = box.querySelector("[data-proof-live]");
  var NS = "http://www.w3.org/2000/svg";

  function svg(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  /* 36 rim ticks, a 7 by 7 grid mirrored left to right (7 rows of 4 cells, 2 bits a cell: empty, green, lavender,
     blue), one tall notch. The disc is the night ground; classes carry the brand colours from tokens.css. */
  function drawSeal(t) {
    var m = L.sealModel(t), s = svg("svg", { viewBox: "0 0 120 120", role: "img", "aria-label": "Seal drawn from the note" });
    var defs = svg("defs"), clip = svg("clipPath", { id: "sl-core" });
    clip.appendChild(svg("circle", { cx: 60, cy: 60, r: 38 })); defs.appendChild(clip); s.appendChild(defs);
    s.appendChild(svg("circle", { cx: 60, cy: 60, r: 60, class: "sl-disc" }));
    m.ticks.forEach(function (on, i) {
      var tall = i === m.notch;
      if (!on && !tall) return;
      s.appendChild(svg("rect", { x: 58.5, y: tall ? 3 : 5, width: 3, height: tall ? 12 : 8, rx: 1.5, class: tall ? "sl-t sl-t--tall" : "sl-t", transform: "rotate(" + i * 10 + " 60 60)" }));
    });
    s.appendChild(svg("circle", { cx: 60, cy: 60, r: 44, class: "sl-ring" }));
    var g = svg("g", { "clip-path": "url(#sl-core)" }), cls = [null, "sl-g", "sl-l", "sl-b"];
    for (var r = 0; r < 7; r++) for (var c = 0; c < 7; c++) {
      var k = cls[m.cells[r][c < 4 ? c : 6 - c]];
      if (k) g.appendChild(svg("rect", { x: 29 + c * 9, y: 29 + r * 9, width: 8, height: 8, rx: 1.6, class: k }));
    }
    s.appendChild(g);
    while (sealEl.firstChild) sealEl.removeChild(sealEl.firstChild);
    sealEl.appendChild(s);
  }

  function build() {
    if (frozen) return;
    var s = B.snapshot();
    if (s.block == null) {
      text = "";
      noteEl.textContent = "The node has not answered, so there is nothing to note. No figure is written until it does.";
      while (sealEl.firstChild) sealEl.removeChild(sealEl.firstChild);
      sealEl.appendChild(h("span", { class: "state", "data-state": "unread" }, ["unread"]));
      copyBtn.disabled = true; post.removeAttribute("href"); post.setAttribute("aria-disabled", "true"); post.setAttribute("role", "link");
      return;
    }
    var snap = { block: inc.block || inc.hash ? s.block : null, blockTime: s.blockTime, blockHash: inc.hash ? s.blockHash : "", gasWei: inc.gas ? s.gasWei : null, tvl: inc.tvl ? s.tvl : null, ticker: s.ticker, book: inc.lane ? s.book : null };
    var next = L.proofText(snap);
    if (next === text) return;
    text = next;
    noteEl.textContent = text;
    drawSeal(text);
    copyBtn.disabled = false;
    post.setAttribute("href", "https://x.com/intent/post?text=" + encodeURIComponent(text));
    post.setAttribute("target", "_blank"); post.setAttribute("rel", "noopener noreferrer");
    post.removeAttribute("aria-disabled"); post.removeAttribute("role");
  }

  function say(msg) {
    live.textContent = msg;
    clearTimeout(timer);
    timer = setTimeout(function () { live.textContent = ""; copyBtn.textContent = "Copy the note"; }, 1800);
  }
  function fallback() {
    var ta = h("textarea", { readonly: true, "aria-hidden": "true", tabindex: "-1" });
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    copyBtn.textContent = ok ? "Copied" : "Copy failed"; say(ok ? "Note copied" : "Copy failed");
  }
  copyBtn.addEventListener("click", function () {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { copyBtn.textContent = "Copied"; say("Note copied"); }, fallback);
    else fallback();
  });

  Array.prototype.forEach.call(box.querySelectorAll("[data-inc]"), function (chip) {
    chip.addEventListener("click", function () {
      var k = chip.getAttribute("data-inc");
      inc[k] = !inc[k];
      chip.setAttribute("aria-pressed", inc[k] ? "true" : "false");
      var was = frozen; frozen = false; text = ""; build(); frozen = was;
    });
  });

  var tool = box.querySelector(".rc");
  ["mouseenter", "focusin"].forEach(function (t) { tool.addEventListener(t, function () { frozen = true; }); });
  ["mouseleave", "focusout"].forEach(function (t) { tool.addEventListener(t, function (e) { if (t === "focusout" && e.relatedTarget && tool.contains(e.relatedTarget)) return; frozen = false; build(); }); });

  B.onRead(build);
  build();
})();
