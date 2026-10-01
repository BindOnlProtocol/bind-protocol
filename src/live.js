/* Live reads: the node (JSON-RPC), DefiLlama and DexScreener, drawn as the stat strip, the hero lane and the pool book.
   Every figure carries its source and an age that counts up by the second. A failed read never replaces a number with
   a guess: past its window a source shows "unread".

   Timing, all constants: node every 6 s, DefiLlama and DexScreener every 45 s (paused while the tab is hidden, and read
   again the moment it is shown); ages tick every 1 s; the hero card turns every 9 s with a 260 ms fade, never while the
   pointer or focus is on it, never after a choice, never off screen or under reduced motion; marks settle in 1.1 s on
   cubic-bezier(0.32, 0.72, 0, 1). */
(function () {
  "use strict";

  var L = window.BindLib, B = window.BIND, h = B.h, R = window.BIND_REGISTER;
  var BEAT = { rpc: 6e3, llama: 45e3, dex: 45e3, age: 1e3, turn: 9e3, fade: 260 };
  var SRC = ["rpc", "llama", "dex"];
  var st = { rpc: null, llama: null, dex: {} }; /* { at, data } per source; dex is one entry per ticker */
  var started = false, tried = {};
  var sortKey = "liq", filter = "all", current = null, chosen = false, hovered = false, seen = true;
  var openSet = {}, sigs = { hero: "", book: "", band: "" };

  function $(s, c) { return (c || document).querySelector(s); }
  function all(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
  function now() { return Date.now(); }

  /* ----------------------------------------------------------------- reads -- */
  function readRpc() {
    var body = JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
      { jsonrpc: "2.0", id: 3, method: "eth_gasPrice", params: [] },
      { jsonrpc: "2.0", id: 4, method: "eth_getBlockByNumber", params: ["latest", false] }
    ]);
    var ctl = "AbortController" in window ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 10e3) : 0;
    return fetch(R.rpc.url, { method: "POST", headers: { "content-type": "application/json" }, body: body, credentials: "omit", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) { clearTimeout(t); var d = L.parseRpc(j); if (d) st.rpc = { at: now(), data: d }; done("rpc"); });
  }
  function readLlama(fresh) {
    return B.getJSON(R.llama.url, fresh).then(function (j) { var d = L.parseLlama(j); if (d) st.llama = { at: now(), data: d }; done("llama"); });
  }
  function readDex(fresh) {
    return Promise.all(L.TICKERS.map(function (tk) {
      return B.getJSON(R.dexscreener.url + "?q=" + encodeURIComponent(tk), fresh).then(function (j) {
        var pools = L.parsePools(j, tk);
        if (pools && pools.length) st.dex[tk] = { at: now(), data: pools };
      });
    })).then(function () { done("dex"); });
  }
  function done(s) { tried[s] = true; if (tried.rpc && tried.llama && tried.dex) started = true; B.emit(); render(); }

  /* ------------------------------------------------------------- derived -- */
  function fresh(src) { return st[src] && src !== "dex" ? L.freshness(src, now() - st[src].at) : "unread"; }
  function dexFresh(tk) { return st.dex[tk] ? L.freshness("dex", now() - st.dex[tk].at) : "unread"; }
  function dexAny() {
    var best = "unread";
    L.TICKERS.forEach(function (t) { var f = dexFresh(t); if (f === "live") best = "live"; else if (f === "stale" && best !== "live") best = "stale"; });
    return best;
  }
  function srcFresh(s) { return s === "dex" ? dexAny() : fresh(s); }

  /* the stocks that have a readable book, in watch-list order */
  function books() {
    var out = [];
    L.TICKERS.forEach(function (tk) {
      var e = st.dex[tk], f = dexFresh(tk);
      if (!e || f === "unread") return;
      out.push({ ticker: tk, name: e.data[0].name || tk, at: e.at, fresh: f, pools: e.data, book: L.spreadBook(e.data) });
    });
    return out;
  }

  /* ---------------------------------------------------------- primitives -- */
  function agoEl(at) {
    return h("time", { class: "bk-age", "data-t": at, datetime: new Date(at).toISOString() }, [L.ageLabel(now() - at) + " ago"]);
  }
  function src(label, href, at) {
    var u = L.httpsUrl(href);
    return h("span", { class: "src" }, [u ? h("a", { href: u, rel: "noopener noreferrer", target: "_blank" }, [label]) : label, at ? " " : null, at ? agoEl(at) : null]);
  }
  function stateChip(s, text) { return h("span", { class: "state", "data-state": s }, [text || s]); }
  function unreadWord() { return h("span", { class: "bk-unread" }, ["unread"]); }
  function priceEl(v) { return v == null || !(v > 0) ? unreadWord() : h("span", { class: "num" }, [L.fmtPrice(v)]); }
  function bpsEl(v) { return v == null ? h("span", { class: "muted" }, ["n/a"]) : h("span", { class: "num" }, [L.fmtBps(v)]); }

  /* A read replaces a mount's children. The control that had focus (the same row's Details button, the same chip, the
     same link) gets it back, so a keyboard or screen reader user keeps their place. */
  function sig(n) {
    var tr = n.closest("[data-row]"), g = n.closest(".bk-group");
    return [n.tagName, n.className, n.getAttribute("data-sym"), n.getAttribute("data-sort"), n.getAttribute("href"), n.textContent, tr ? tr.getAttribute("data-row") : "", g ? g.getAttribute("data-sym") : ""].join("|");
  }
  function paint(el, nodes) {
    var controls = function () { return all("a[href], button", el); };
    var a = document.activeElement, key = a && a !== el && el.contains(a) ? sig(a) : null;
    var nth = key === null ? 0 : controls().filter(function (n) { return sig(n) === key; }).indexOf(a);
    while (el.firstChild) el.removeChild(el.firstChild);
    nodes.forEach(function (n) { el.appendChild(n); });
    if (key === null) return;
    var same = controls().filter(function (n) { return sig(n) === key; });
    var hit = same[nth] || same[0];
    if (hit) hit.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------ stat strip -- */
  function valueCell(cell, text, f) {
    if (!cell) return;
    if (f === "unread" || !text) {
      var chip = cell.querySelector(".state");
      if (!chip) { cell.textContent = ""; chip = stateChip("unread", "unread"); cell.appendChild(chip); }
      chip.setAttribute("data-state", started ? "unread" : "reading");
      chip.textContent = started ? "unread" : "reading";
      return;
    }
    setText(cell, text);
  }
  function noteFor(src, label) {
    var at = src === "dex" ? null : st[src] && st[src].at;
    if (!at) return label + ": unread";
    var f = srcFresh(src);
    return f === "unread" ? label + ": unread" : label + " \u00b7 " + L.ageLabel(now() - at) + " ago" + (f === "stale" ? " \u00b7 stale" : "");
  }
  function renderStats() {
    var rpc = st.rpc && st.rpc.data, fR = fresh("rpc"), fL = fresh("llama");
    var map = {
      block: [rpc ? L.fmtInt(rpc.block) : "", fR, noteFor("rpc", "node")],
      gas: [rpc ? L.fmtGwei(rpc.gasWei) : "", fR, noteFor("rpc", "node")],
      tvl: [st.llama ? L.fmtUsd(st.llama.data.tvl) : "", fL, noteFor("llama", "DefiLlama")]
    };
    Object.keys(map).forEach(function (k) {
      var box = $('[data-stat="' + k + '"]');
      if (!box) return;
      valueCell($("[data-value]", box), map[k][0], map[k][1]);
      box.setAttribute("data-fresh", map[k][1]);
      setText($("[data-note]", box), map[k][2]);
    });
    function strip(k, text, f, note) {
      var c = $('[data-chain-strip] [data-k="' + k + '"]');
      if (!c) return;
      valueCell($("[data-v]", c), text, f);
      if (note) setText($("[data-n]", c), note);
    }
    strip("block", map.block[0], fR, noteFor("rpc", "node"));
    strip("gas", map.gas[0], fR, noteFor("rpc", "node"));
    var ms = rpc && rpc.blockTime ? now() - rpc.blockTime : null;
    strip("age", ms != null && ms >= 0 ? L.ageLabel(ms) : "", fR);
    strip("hash", rpc && rpc.blockHash ? rpc.blockHash : "", fR);
  }

  function renderChip() {
    var n = SRC.filter(function (s) { return srcFresh(s) === "live"; }).length;
    var any = SRC.filter(function (s) { return srcFresh(s) !== "unread"; }).length;
    var reading = !started && !any;
    var state = reading ? "unread" : any === 0 ? "unread" : n === 3 ? "live" : n === 0 ? "stale" : "degraded";
    var label = reading ? "Reading" : any === 0 ? "Unread" : n === 3 ? "Live 3/3" : n === 0 ? "Stale" : n + "/3 live";
    var bar = $("[data-bookstate]");
    if (bar) { bar.setAttribute("data-state", state); setText($("[data-text]", bar), label); bar.setAttribute("title", any ? n + " of 3 sources inside their window" : "No source has answered"); }
    var chip = $('[data-bookstate="chip"]');
    if (chip) { chip.setAttribute("data-state", reading ? "reading" : state === "degraded" ? "stale" : state); setText($("[data-text]", chip), reading ? "reading" : any === 0 ? "unread" : n + " of 3 read"); }
    var agePart = st.rpc && fresh("rpc") !== "unread" ? "node " + L.ageLabel(now() - st.rpc.at) + " ago" : "";
    setText($("[data-bookage]"), agePart || "3 sources");
  }

  /* one tick per pool, by state; redrawn only when the states change, so the ticks do not scatter and settle on each read */
  function renderBand() {
    var band = $("[data-bookmerge]");
    if (!band) return;
    var states = [];
    books().forEach(function (b) { b.pools.forEach(function () { states.push(b.fresh); }); });
    var key = states.join();
    if (key === sigs.band) return;
    sigs.band = key;
    band.classList.remove("is-merged");
    while (band.firstChild) band.removeChild(band.firstChild);
    states.forEach(function (s, i) {
      var t = h("i", { "data-s": s });
      t.style.setProperty("--i", (4 + (i * 92) / Math.max(1, states.length - 1)).toFixed(2));
      band.appendChild(t);
    });
    requestAnimationFrame(function () { requestAnimationFrame(function () { band.classList.add("is-merged"); }); });
  }

  /* -------------------------------------------------------------- hero lane -- */
  function pickCurrent(list) {
    if (!list.length) { current = null; return null; }
    var withBook = list.filter(function (b) { return b.book; });
    var pool = withBook.length ? withBook : list;
    if (!current || !pool.some(function (b) { return b.ticker === current; })) current = pool[0].ticker;
    return list.filter(function (b) { return b.ticker === current; })[0];
  }
  function refLine(u) {
    var f = u.fresh, what = u.book ? "Median of " + u.pools.length + " pools" : "Only one pool holds enough liquidity";
    var top = u.pools[0];
    return h("p", { class: "bk-ref" }, [
      h("span", {}, [what]), u.book ? h("span", { class: "bk-refnum" }, [priceEl(u.book.median)]) : priceEl(top.price),
      stateChip(f), src("DexScreener", top.url, u.at)
    ]);
  }
  function drawHero(u, list) {
    var hero = $("[data-hero]");
    if (!hero) return;
    hero.removeAttribute("aria-busy");
    if (!u) {
      hero.removeAttribute("aria-busy");
      paint(hero, [h("div", { class: "bk-shell" }, [h("div", { class: "bk-core" }, [
        h("p", { class: "bk-idle" }, [stateChip(started ? "unread" : "reading"), "Pool lane"]),
        h("p", { class: "bk-cap" }, [started ? "No pool has answered inside its window. The next read is in 45 seconds." : "Reading the pools."]),
        h("ul", { class: "hp-idle", "aria-hidden": "true" }, [h("li"), h("li"), h("li"), h("li")])
      ])])]);
      return;
    }
    var rows = u.pools.slice(0, 5), book = u.book, range = book ? L.laneRange(book) : 20;
    var picker = list.length > 1 ? h("div", { class: "bk-pick", role: "group", "aria-label": "Stock" }, list.map(function (b) {
      return h("button", { type: "button", class: "chip", "data-sym": b.ticker, "aria-pressed": b.ticker === u.ticker ? "true" : "false" }, [b.ticker]);
    })) : null;
    var byId = {}; if (book) book.rows.forEach(function (r) { byId[r.id + r.quote + r.version] = r; });
    var items = rows.map(function (p) {
      var r = byId[p.id + p.quote + p.version], bps = r ? r.bps : null, deep = p === rows[0];
      return h("li", { class: "bk-hrow" }, [
        h("span", { class: "bk-hname" }, [h("span", { class: "bk-issuer" }, [p.quote + " pool"]), " ", h("span", { class: "bk-label" }, [p.dex + (p.version ? " " + p.version : "")])]),
        bps != null ? h("span", { class: "bk-lane", "aria-hidden": "true" }, [h("span", { class: "bk-track" }, [h("span", { class: "bk-mark" + (deep ? " bk-deep" : ""), "data-bps": String(bps) })])]) : null,
        h("span", { class: "bk-hval" }, [priceEl(p.price), " ", bps != null ? h("span", { class: "bk-hbps bk-" + L.tintOf(book, bps) }, [L.fmtBps(bps) + " bps"]) : null]),
        h("span", { class: "bk-hsrc" }, [src("DexScreener", "", u.at)])
      ]);
    });
    var axis = book ? h("li", { class: "bk-axis", "aria-hidden": "true" }, [h("span", { class: "bk-axlane" }, [
      h("span", { class: "bk-axl" }, ["\u2212" + range + " bps"]), h("span", { class: "bk-axc" }, ["median"]), h("span", { class: "bk-axr" }, ["+" + range + " bps"])])]) : null;
    var cap = book
      ? "Each mark sits where that pool's price falls against the median of the pools read, " + (book.band < 25 ? "and none of them strays far." : "and the widest gap is " + book.band.toFixed(1) + " bps.")
      : "Every other pool holds under 10,000 USD, so there is nothing to line up.";
    paint(hero, [h("div", { class: "bk-shell" }, [h("div", { class: "bk-core" }, [
      h("div", { class: "bk-htop" }, [h("div", {}, [h("p", { class: "bk-hname-u" }, [u.name + " ", h("span", { class: "mono" }, [u.ticker])]), refLine(u)]), picker]),
      h("ol", { class: "bk-hrows" + (book ? " bk-scaled" : "") }, [axis].concat(items)),
      h("p", { class: "bk-cap" }, [cap]),
      h("p", { class: "bk-open-link" }, [h("a", { href: "#pools" }, ["Open the " + u.ticker + " pools"])])
    ])])]);
    all(".bk-pick .chip", hero).forEach(function (btn) {
      btn.addEventListener("click", function () { chosen = true; current = btn.getAttribute("data-sym"); sigs.hero = ""; render(); });
    });
    place(hero, book, range);
  }
  /* marks start at the centre and slide to their place; under reduced motion they are simply placed */
  function place(hero, book, range) {
    var marks = all(".bk-mark", hero);
    var set = function (m, v) { m.style.setProperty("--x", L.lanePos(v, range).toFixed(2)); };
    if (B.reduced()) { marks.forEach(function (m) { set(m, parseFloat(m.getAttribute("data-bps"))); }); return; }
    marks.forEach(function (m) { m.classList.add("bk-still"); m.style.setProperty("--x", "50"); });
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      marks.forEach(function (m) { m.classList.remove("bk-still"); set(m, parseFloat(m.getAttribute("data-bps"))); });
    }); });
  }

  /* --------------------------------------------------------------- pool book -- */
  function groupHead(u) {
    var top = u.pools[0], out = [h("h3", {}, [u.name + " ", h("span", { class: "mono" }, [u.ticker])]), refLine(u)];
    out.push(h("p", { class: "bk-deriv" }, [u.book
      ? "How: the median of the prices of " + u.pools.length + " pools that each hold at least 10,000 USD. A gap compares one pool's price with that median. No outside reference is read. The pools are read again every 45 seconds."
      : "How: only one pool clears the 10,000 USD floor, so there is no median to measure from. The pool is read again every 45 seconds."]));
    out.push(h("p", { class: "bk-best" }, [
      (u.book ? "Widest gap across the pools: " : ""), u.book ? h("span", { class: "num" }, [u.book.band.toFixed(1)]) : null, u.book ? " bps. " : "",
      "Deepest pool: " + top.quote + ", " + top.dex + (top.version ? " " + top.version : "") + ", holding ", h("span", { class: "num" }, [L.fmtUsd(top.liq)]), "."
    ]));
    return h("div", { class: "bk-ghead" }, out);
  }
  function rowEl(u, p, open) {
    var r = u.book ? u.book.rows.filter(function (x) { return x.id === p.id && x.quote === p.quote && x.version === p.version; })[0] : null;
    var bps = r ? r.bps : null, rid = (u.ticker + "-" + (p.id || p.quote) + "-" + p.version).replace(/[^a-z0-9-]/gi, "").slice(0, 60);
    var label = p.quote + " pool", more = "bk-x-" + rid;
    return h("tr", { class: "bk-tr" + (open ? " bk-open" : ""), "data-row": rid }, [
      h("th", { scope: "row", class: "bk-name" }, [
        p.url ? h("a", { href: p.url, rel: "noopener noreferrer", target: "_blank" }, [label]) : h("span", { class: "bk-issuer" }, [label]), " ",
        h("span", { class: "bk-label" }, [p.dex + (p.version ? " " + p.version : "")]), " ",
        h("button", { type: "button", class: "bk-more", "aria-expanded": open ? "true" : "false", "aria-controls": more }, ["Details"])
      ]),
      h("td", { class: "bk-px" }, [priceEl(p.price)]),
      h("td", { class: "bk-sp " + (bps != null ? "bk-" + L.tintOf(u.book, bps) : "") }, [bps != null ? bpsEl(bps) : ""]),
      h("td", { class: "bk-x", id: more }, [h("span", { class: "bk-k" }, ["Liquidity"]), " ", h("span", { class: "num" }, [L.fmtUsd(p.liq)])]),
      h("td", { class: "bk-x" }, [h("span", { class: "bk-k" }, ["Volume 24h"]), " ", p.vol24 == null ? h("span", { class: "muted" }, ["n/a"]) : h("span", { class: "num" }, [L.fmtUsd(p.vol24)])]),
      h("td", { class: "bk-x" }, [h("span", { class: "bk-k" }, ["24h"]), " ", p.chg24 == null ? h("span", { class: "muted" }, ["n/a"]) : h("span", { class: "num" }, [L.fmtPct(p.chg24)])]),
      h("td", { class: "bk-x bk-srccell" }, [h("span", { class: "bk-k" }, ["Source"]), " ", stateChip(u.fresh), " ", src("DexScreener", p.url, u.at)])
    ]);
  }
  function tableEl(u) {
    var rows = L.sortPools(u.book ? u.book.rows : u.pools, sortKey);
    var heads = ["Pool", "Price", "vs median, bps", "Liquidity", "Volume 24h", "24h", "Source, age, state"];
    return h("table", { class: "bk-table bk-cols", "data-fresh": u.fresh }, [
      h("caption", { class: "sr" }, [u.name + " across pools, USD"]),
      h("colgroup", {}, heads.map(function () { return h("col"); })),
      h("thead", {}, [h("tr", {}, heads.map(function (t, i) { return h("th", { scope: "col", class: i === 1 ? "bk-px" : i === 2 ? "bk-sp" : i > 2 ? "bk-x" : null }, [t]); }))]),
      h("tbody", {}, rows.map(function (p) { return rowEl(u, p, !!openSet[(u.ticker + "-" + (p.id || p.quote) + "-" + p.version).replace(/[^a-z0-9-]/gi, "").slice(0, 60)]); }))
    ]);
  }
  function drawBook(list) {
    var el = $("[data-book]");
    if (!el) return;
    el.removeAttribute("aria-busy");
    if (!list.length) {
      paint(el, [h("p", { class: "bk-fail" }, [stateChip(started ? "unread" : "reading"), " ", started ? "No pool has answered inside its window. The next read is in 45 seconds." : "Reading the pools."])]);
      return;
    }
    var chips = [["all", "All"]].concat(list.map(function (b) { return [b.ticker, b.ticker]; })).map(function (c) {
      return h("button", { type: "button", class: "chip", "data-sym": c[0], "aria-pressed": c[0] === filter ? "true" : "false" }, [c[1]]);
    });
    var sorts = [["liq", "Liquidity"], ["vol", "Volume"], ["bps", "Widest gap"]].map(function (c) {
      return h("button", { type: "button", class: "chip", "data-sort": c[0], "aria-pressed": c[0] === sortKey ? "true" : "false" }, [c[1]]);
    });
    var oldest = Math.min.apply(null, list.map(function (b) { return b.at; }));
    var groups = list.map(function (u) {
      return h("section", { class: "bk-group", "data-sym": u.ticker, "aria-label": u.name, hidden: filter !== "all" && filter !== u.ticker }, [groupHead(u), tableEl(u)]);
    });
    paint(el, [
      h("div", { class: "bk-filter", role: "group", "aria-label": "Stock" }, chips),
      h("div", { class: "bk-filter bk-sorts", role: "group", "aria-label": "Sort pools" }, sorts),
      h("p", { class: "bk-asof" }, ["Oldest read ", agoEl(oldest), ". Each group is one stock; each row is one pool quoting it."])
    ].concat(groups));
    all(".bk-filter [data-sym]", el).forEach(function (c) { c.addEventListener("click", function () { filter = c.getAttribute("data-sym"); sigs.book = ""; render(); }); });
    all(".bk-filter [data-sort]", el).forEach(function (c) { c.addEventListener("click", function () { sortKey = c.getAttribute("data-sort"); sigs.book = ""; render(); }); });
    all(".bk-more", el).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tr = btn.closest("tr"), open = !tr.classList.contains("bk-open");
        tr.classList.toggle("bk-open", open);
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        openSet[tr.getAttribute("data-row")] = open;
      });
    });
  }

  /* ------------------------------------------------------------------ render -- */
  function updateAges() {
    if (document.hidden) return;
    var t = now();
    all("time.bk-age[data-t]").forEach(function (el) { setText(el, L.ageLabel(Math.max(0, t - Number(el.getAttribute("data-t")))) + " ago"); });
  }
  function render() {
    renderStats(); renderChip(); renderBand();
    var list = books();
    var u = pickCurrent(list);
    var heroSig = [current, u ? u.at + u.fresh : "none", list.map(function (b) { return b.ticker; }).join(), started].join("|");
    if (heroSig !== sigs.hero) { sigs.hero = heroSig; drawHero(u, list); }
    var bookSig = [filter, sortKey, list.map(function (b) { return b.ticker + b.at + b.fresh; }).join(), started].join("|");
    if (bookSig !== sigs.book) { sigs.book = bookSig; drawBook(list); }
    updateAges();
  }

  /* the shared snapshot the proof note is written from */
  B.snapshot = function () {
    var rpc = st.rpc && fresh("rpc") !== "unread" ? st.rpc.data : null, u = pickCurrent(books());
    return {
      block: rpc ? rpc.block : null, blockTime: rpc ? rpc.blockTime : null, blockHash: rpc ? rpc.blockHash : "", gasWei: rpc ? rpc.gasWei : null,
      tvl: st.llama && fresh("llama") !== "unread" ? st.llama.data.tvl : null, ticker: u ? u.ticker : "", book: u ? u.book : null
    };
  };

  /* ---------------------------------------------------------------- wiring -- */
  var hero = $("[data-hero]");
  if (hero) {
    hero.addEventListener("mouseenter", function () { hovered = true; });
    hero.addEventListener("mouseleave", function () { hovered = false; });
    hero.addEventListener("focusin", function () { hovered = true; });
    hero.addEventListener("focusout", function () { hovered = false; });
    if ("IntersectionObserver" in window) new IntersectionObserver(function (en) { seen = en[en.length - 1].isIntersecting; }).observe(hero);
  }
  /* rotation: a short list, every 9 s, never under reduced motion, never after a choice */
  setInterval(function () {
    var list = books().filter(function (b) { return b.book; });
    if (list.length < 2 || chosen || hovered || !seen || document.hidden || B.reduced()) return;
    var i = list.map(function (b) { return b.ticker; }).indexOf(current);
    current = list[(i + 1) % list.length].ticker;
    hero.classList.add("bk-fade");
    setTimeout(function () { sigs.hero = ""; render(); hero.classList.remove("bk-fade"); }, BEAT.fade);
  }, BEAT.turn);

  function every(fn, ms) { setInterval(function () { if (!document.hidden) fn(); }, ms); }
  readRpc(); readLlama(false); readDex(false);
  every(readRpc, BEAT.rpc); every(function () { readLlama(true); }, BEAT.llama); every(function () { readDex(true); }, BEAT.dex);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { readRpc(); readLlama(true); readDex(true); } });
  setInterval(function () { if (!document.hidden) render(); }, BEAT.age);
  setTimeout(function () { started = true; render(); }, 8000); /* a source that has not answered in 8 s reads unread, not reading */
  render();
})();
