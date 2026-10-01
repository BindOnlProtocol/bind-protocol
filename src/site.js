/* Site runtime, loaded by the page right after lib.js and before live.js and proof.js.

   - window.BIND is the one namespace: BIND.h builds DOM nodes (never markup strings), BIND.getJSON is one shared GET per URL,
     BIND.reduced() mirrors prefers-reduced-motion live, BIND.onRead / BIND.emit carry "new data" between modules.
   - The chrome: the mobile menu, scroll reveals, the pinned merge story, the nav's reading marker, the CA copy action
     (only while the register says stated), a held hero height, and a deep link scrolled to again once fonts settle.
   Nothing here writes a number it did not read. */
(function () {
  "use strict";

  var L = window.BindLib;
  var root = document.documentElement;
  var B = window.BIND = window.BIND || {};
  root.classList.add("js");

  /* ------------------------------------------------------------ helpers -- */
  var motion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reduced = !!(motion && motion.matches);
  if (motion && motion.addEventListener) motion.addEventListener("change", function (e) { reduced = e.matches; root.classList.toggle("reduced-motion", reduced); });
  root.classList.toggle("reduced-motion", reduced);
  B.reduced = function () { return reduced; };

  B.h = function (tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  };

  var pending = {};
  /* one GET per URL, shared; fresh forces a new read that later callers share. Resolves to parsed JSON or null, never rejects. */
  B.getJSON = function (url, fresh) {
    if (fresh || !pending[url]) {
      var ctl = "AbortController" in window ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, 10000) : 0;
      pending[url] = fetch(url, { headers: { accept: "application/json" }, credentials: "omit", signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (j) { clearTimeout(timer); return j; });
    }
    return pending[url];
  };

  var subs = [];
  B.onRead = function (fn) { subs.push(fn); };
  B.emit = function () { subs.forEach(function (fn) { try { fn(); } catch (e) { setTimeout(function () { throw e; }); } }); };

  function all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  /* ------------------------------------------------------------- CA slot -- */
  /* The markup already carries the register's truth. Only a stated record ships a button; copying takes the address
     from that button's own text, so the page holds one copy of it. */
  function caSlot() {
    var slot = document.querySelector('[data-ca][data-state="stated"]');
    if (!slot) return;
    var btn = slot.querySelector("[data-ca-btn]"), hint = slot.querySelector("[data-ca-hint]"), live = slot.querySelector("[data-ca-live]");
    var text = slot.querySelector("[data-ca-text]").textContent.trim();
    var timer = 0;
    function done(ok) {
      slot.toggleAttribute("data-copied", ok);
      hint.textContent = ok ? "Copied" : "Copy failed";
      if (live) live.textContent = ok ? "Contract address copied" : "Copy failed";
      clearTimeout(timer);
      timer = setTimeout(function () { slot.removeAttribute("data-copied"); hint.textContent = "Click to copy"; }, 1800);
    }
    function fallback() {
      var ta = B.h("textarea", { readonly: true, "aria-hidden": "true", tabindex: "-1" });
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove(); done(ok);
    }
    btn.addEventListener("click", function () {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
      else fallback();
    });
  }

  /* ----------------------------------------------------------------- menu -- */
  /* The nav links sit before the button in the DOM, so opening moves focus onto the first link, and focus leaving the
     bar closes the panel rather than hiding the ring under it. */
  function menu() {
    var bar = document.querySelector("[data-bar]"), btn = bar && bar.querySelector("[data-menu]");
    if (!btn) return;
    function set(open) { btn.setAttribute("aria-expanded", open ? "true" : "false"); bar.toggleAttribute("data-open", open); }
    btn.addEventListener("click", function () {
      var open = btn.getAttribute("aria-expanded") !== "true";
      set(open);
      var first = open && bar.querySelector("#site-nav a");
      if (first) first.focus();
    });
    bar.addEventListener("focusout", function (e) { if (e.relatedTarget && !bar.contains(e.relatedTarget)) set(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && bar.hasAttribute("data-open")) { set(false); btn.focus(); } });
    bar.addEventListener("click", function (e) { if (e.target.closest && e.target.closest(".nav a")) set(false); });
    var wide = window.matchMedia("(min-width: 901px)");
    if (wide.addEventListener) wide.addEventListener("change", function (e) { if (e.matches) set(false); });
  }

  /* -------------------------------------------------------------- reveals -- */
  function reveals() {
    var els = all("[data-reveal]");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) { els.forEach(function (el) { el.classList.add("is-in"); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* The merge story: the stage stays pinned by CSS (sticky) while the steps scroll past; the step crossing the reading
     line sets the stage's data-at. The markup ships data-at="4" (the finished picture) for pages read without scripting.
     On a phone the stage covers the top of the screen and the text is read just under it, so the stage shows the
     earliest step whose text still shows a line below it. */
  function mergeStory() {
    var story = document.querySelector("[data-merge]");
    if (!story || !("IntersectionObserver" in window)) return;
    var stage = story.querySelector("[data-stage]"), steps = all("[data-step]", story);
    if (!stage || !steps.length) return;
    function at(n) {
      stage.setAttribute("data-at", n);
      steps.forEach(function (s) { s.classList.toggle("is-at", s.getAttribute("data-step") === n); });
    }
    at("1");
    if (window.matchMedia("(max-width: 900px)").matches) {
      var pin = stage.parentNode, shown = -1, queued = false;
      var follow = function () {
        queued = false;
        var under = pin.getBoundingClientRect().bottom + 24, n = steps.length - 1;
        for (var i = 0; i < steps.length; i++) if ((steps[i].lastElementChild || steps[i]).getBoundingClientRect().bottom > under) { n = i; break; }
        if (n !== shown) { shown = n; at(steps[n].getAttribute("data-step")); }
      };
      window.addEventListener("scroll", function () { if (!queued) { queued = true; requestAnimationFrame(follow); } }, { passive: true });
      follow();
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) at(en.target.getAttribute("data-step")); });
    }, { rootMargin: "-48% 0px -48% 0px", threshold: 0 });
    steps.forEach(function (s) { io.observe(s); });
  }

  /* the nav marks the section being read */
  function spy() {
    var links = all("#site-nav a");
    if (!links.length || !("IntersectionObserver" in window)) return;
    var map = {};
    links.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.removeAttribute("aria-current"); });
        var a = map[en.target.id];
        if (a) a.setAttribute("aria-current", "true");
      });
    }, { rootMargin: "-30% 0px -60% 0px", threshold: 0 });
    Object.keys(map).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* The hero card rotates through stocks with different row counts. CSS reserves an estimate; this holds the tallest
     height drawn at the current width so the page under it never moves. A new width lets go. */
  function hold() {
    if (!("ResizeObserver" in window)) return;
    all(".hero__book").forEach(function (el) {
      var width = window.innerWidth, max = 0;
      new ResizeObserver(function () {
        var drawn = !!el.querySelector(".bk-htop");
        if (window.innerWidth !== width || !drawn) {
          width = window.innerWidth; max = 0;
          if (el.style.minHeight) { el.style.minHeight = ""; return; }
        }
        var h = el.offsetHeight;
        if (drawn && h > max) { max = h; el.style.minHeight = h + "px"; }
      }).observe(el);
    });
  }

  /* A deep link lands on its heading. The browser scrolls to the fragment before fonts and late styles apply, which can
     leave the heading under the bar, so once fonts are in, scroll to it again unless the reader has moved on. */
  var moved = false;
  ["wheel", "touchstart", "keydown"].forEach(function (t) { window.addEventListener(t, function () { moved = true; }, { once: true, passive: true }); });
  function anchor() {
    var id = window.location.hash.slice(1);
    if (!id || !document.fonts) return;
    document.fonts.ready.then(function () {
      var target = null;
      try { target = document.getElementById(decodeURIComponent(id)); } catch (e) { /* a malformed fragment names nothing */ }
      if (target && !moved) target.scrollIntoView({ behavior: "instant", block: "start" });
    });
  }

  function chrome() {
    caSlot(); menu(); reveals(); mergeStory(); spy(); hold();
    function settled() { anchor(); root.classList.add("is-settled"); }
    if (document.readyState === "complete") settled(); else window.addEventListener("load", settled);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", chrome); else chrome();
})();
