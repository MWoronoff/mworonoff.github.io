/*
 * Adtaxi analyzer engine. One engine, configured per site (Healthcare, Legal, later Home Services).
 * A site page loads Leaflet, topojson-client, this file and its own config, then calls
 * AdtaxiAnalyzer.start(config, document.getElementById("app")).
 *
 * Data files (one per level) look like:
 *   { "level": "dma", "rows": [ { "id": "501", "name": "New York", "v": { "score@dental": 91.2, ... }, "f": ["note"] } ] }
 * Scores and percentiles are computed by the data build; the engine only displays them.
 * A value of null means "no data" (suppressed or missing); a measure not listed for a level is "not available here".
 */
(function () {
  "use strict";
  // Guided steps preview (?guide=1): a start line, quieter Export, a Trade area cue, top-5 ad response. Same switch as shared/radius.js.
  var GUIDE_ON = true;
  var GUIDE = GUIDE_ON || window.ADTAXI_GUIDE === true || /[?&]guide=1(&|$)/.test(location.search);

  var PICK_PREFIX = { dma: "d", metro: "m", county: "c" };   // Custom area tokens in the Trade area tool
  var PICK_NOUN = { dma: ["DMA", "DMAs"], metro: ["metro", "metros"], county: ["county", "counties"] };
  var LEVEL_LABELS = { us: "U.S.", territory: "Territory", dma: "DMA", metro: "Metro", county: "County", zip: "ZIP" };
  var RAMP = ["--ramp-1", "--ramp-2", "--ramp-3", "--ramp-4", "--ramp-5"];

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    }
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  var NF0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  var NF1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var NF2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fmt(v, f) {
    if (v === null || v === undefined || (typeof v === "number" && !isFinite(v))) return null;
    if (typeof v === "string") return v;
    switch (f) {
      case "score": return NF0.format(v);
      case "pct": return NF1.format(v * 100) + "%";
      case "pct0": return NF0.format(v * 100) + "%";
      case "dec1": return NF1.format(v);
      case "dec2": return NF2.format(v);
      case "money": return "$" + NF0.format(v);
      case "moneyM": return Math.abs(v) >= 1e9 ? "$" + NF1.format(v / 1e9) + "B" : "$" + NF1.format(v / 1e6) + "M";
      case "index": return NF0.format(v);
      default: return NF0.format(v);
    }
  }
  function csvCell(s) { s = s == null ? "" : String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  // Export menu: one button that opens a short list of choices (Leave-behind PDF, data CSV)
  function exportMenu(items) {
    var btn, menu, wrap;
    function close() { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    menu = el("div", { class: "az-export-menu", role: "menu", hidden: true }, items.map(function (it) {
      return el("button", { type: "button", role: "menuitem", onclick: function () { close(); it.run(); } },
        [el("b", { text: it.label }), it.note ? el("small", { text: it.note }) : null]);
    }));
    btn = el("button", { type: "button", class: GUIDE ? "az-btn" : "az-btn primary", "aria-haspopup": "menu", "aria-expanded": "false", text: "Export \u25be",
      onclick: function (e) { e.stopPropagation(); var open = menu.hidden; menu.hidden = !open; btn.setAttribute("aria-expanded", String(open)); if (open) menu.querySelector("button").focus(); } });
    wrap = el("div", { class: "az-export", onkeydown: function (e) { if (e.key === "Escape" && !menu.hidden) { close(); btn.focus(); } } }, [btn, menu]);
    document.addEventListener("click", function (e) { if (!wrap.contains(e.target)) close(); });
    return wrap;
  }

  // Leave-behind: the current view laid out for print (the browser's Save as PDF), with an Adtaxi heading and no controls.
  // Maps are redrawn at page width for the print, then put back.
  function printLeaveBehind(logo, lines, maps) {
    var head = el("div", { class: "az-print-head" }, [el("img", { src: logo || "../shared/adtaxi-logo.svg", alt: "Adtaxi" }),
      el("div", null, lines.filter(Boolean).map(function (t, i) { return el(i ? "p" : "h1", { text: t }); }))]);
    document.body.insertBefore(head, document.body.firstChild);
    document.body.classList.add("az-printing");
    var views = (maps || []).filter(Boolean).map(function (m) {
      var v = { m: m, c: m.getCenter(), z: m.getZoom(), b: m.getBounds() };
      m.invalidateSize({ pan: false }); m.fitBounds(v.b, { animate: false });
      return v;
    });
    var done = false;
    function cleanup() {
      if (done) return; done = true;
      window.removeEventListener("afterprint", cleanup);
      head.remove(); document.body.classList.remove("az-printing");
      views.forEach(function (v) { v.m.invalidateSize({ pan: false }); v.m.setView(v.c, v.z, { animate: false }); });
    }
    window.addEventListener("afterprint", cleanup);
    setTimeout(function () { window.print(); }, 450);   // give the map time to redraw at page width
  }
  function today() { return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); }

  function Analyzer(cfg, root) {
    this.cfg = cfg;
    this.root = root;
    this.data = {};
    this.geo = {};
    this.state = {
      level: cfg.defaultLevel || "dma",
      sub: (cfg.subcategories && cfg.subcategories[0] && cfg.subcategories[0].id) || "",
      rank: cfg.defaultRank || (cfg.rankBy && cfg.rankBy[0]),
      sortKey: null, sortDir: "desc",
      show: cfg.defaultShow || 25, query: "", area: null, parent: null
    };
    this.readHash();
    // Footprint navigation (cfg.footprint): rank DMAs or metros nationally, or counties and ZIPs inside a selected market.
    // There is no U.S. summary view or national county list; old links to them open the national DMA ranking.
    this.state.chain = this.state.chain || [];
    this.basket = []; this.basketMsg = "";
    if (cfg.footprint && (this.state.level === "us" || (this.state.level === "county" && !this.state.parent))) { this.state.level = "dma"; this.state.parent = null; }
  }

  Analyzer.prototype.measure = function (key) {
    for (var i = 0; i < this.cfg.measures.length; i++) if (this.cfg.measures[i].key === key) return this.cfg.measures[i];
    return null;
  };
  Analyzer.prototype.availableAt = function (m, level) { return !m.levels || m.levels.indexOf(level) >= 0; };
  // A measure with "subs" belongs only to those categories (e.g. "No dental visit" only with Dental).
  // "*" marks a value filled in for this area (row.e lists measure keys) and the score and demand of any category whose
  // demand inputs include such a value (row.es lists category ids). The area's data notes explain.
  Analyzer.prototype.mark = function (row, m) {
    if (!row || !m) return "";
    if (row.e && row.e.indexOf(m.key) >= 0) return "*";
    if (m.perSub && this.state.sub && row.es && row.es.indexOf(this.state.sub) >= 0 && (m.key === "score" || m.key === "demand")) return "*";
    return "";
  };
  Analyzer.prototype.relevant = function (m) { return !m.subs || !this.state.sub || m.subs.indexOf(this.state.sub) >= 0; };
  Analyzer.prototype.valueKey = function (m) { return m.perSub && this.state.sub ? m.key + "@" + this.state.sub : m.key; };
  Analyzer.prototype.val = function (row, m) {
    if (!row || !m) return undefined;
    var k = this.valueKey(m);
    return Object.prototype.hasOwnProperty.call(row.v, k) ? row.v[k] : null;
  };
  // Tie-breaker for the overall score: a score is an average of ranks, so two markets can land on exactly the same score.
  // Equal scores are ordered by the first score part (Demand); markets equal on both stay tied. Used by the table and panel.
  Analyzer.prototype.tieMeasure = function (m) {
    if (!m || !/^score(@|$)/.test(m.key)) return null;
    var c = (this.cfg.components || [])[0];
    return c ? this.measure(c) : null;
  };
  Analyzer.prototype.tieVal = function (row, t) { var x = t ? this.val(row, t) : null; return typeof x === "number" ? x : -Infinity; };
  Analyzer.prototype.subLabel = function () {
    var s = (this.cfg.subcategories || []).filter(function (x) { return x.id === this.state.sub; }, this)[0];
    return s ? s.label : "";
  };

  /* ---------- Levels: U.S., DMA, Metro, and ZIPs inside one DMA or metro ---------- */
  Analyzer.prototype.key = function (level) {
    var p = this.state.parent;
    if (level === "county" && this.cfg.footprint && this.state.level === "county" && p && p.level !== "county") return "county:" + p.level + ":" + p.id;
    // Drill-down (cfg.drill): a DMA's metros, or a DMA's or metro's counties
    if (this.cfg.drill && p && this.state.level === level && ((level === "county" && (p.level === "dma" || p.level === "metro" || p.level === "sel")) || (level === "metro" && (p.level === "dma" || p.level === "sel")))) return level + ":" + p.level + ":" + p.id;
    return level === "zip" ? (p ? "zip:" + p.level + ":" + p.id : null) : level;
  };
  Analyzer.prototype.isInside = function (level) { var k = this.key(level); return level === "zip" || (k !== level && k !== null); };
  // The level the table lists: with drill-down, the U.S. view lists the ranked DMAs under the U.S. totals
  Analyzer.prototype.tableLevel = function () { return this.cfg.drill && this.state.level === "us" ? "dma" : this.state.level; };
  Analyzer.prototype.d = function (level) { var k = this.key(level); return k ? this.data[k] : null; };
  Analyzer.prototype.url = function (template) {
    var p = this.state.parent || {};
    if (template && typeof template === "object") template = template[p.level] || template["default"];   // ZIP files can live elsewhere for some parent levels (e.g. a client's territories)
    return template.replace("{level}", p.level).replace("{id}", encodeURIComponent(p.id));
  };
  Analyzer.prototype.levelLabel = function (level) { return (this.cfg.levels[level] && this.cfg.levels[level].label) || LEVEL_LABELS[level]; };
  Analyzer.prototype.parentName = function () {
    var p = this.state.parent;
    if (p && p.level === "sel") return this.marketName(p);
    var pd = p && this.data[p.level], row = pd && pd.byId[p.id];
    return row ? row.name + (p.level === "county" ? "" : " " + LEVEL_LABELS[p.level]) : "";   // county names already say County/Parish
  };
  Analyzer.prototype.canDrill = function () {
    var s = this.state;
    return !!this.cfg.levels.zip && (this.drillable(s.level) && !!s.area || s.level === "zip" || (!!this.cfg.drill && !!s.parent));
  };
  // ZIPs in market opens from a DMA, a metro or (when the site has a County view) a county
  Analyzer.prototype.drillable = function (level) { return level === "dma" || level === "metro" || level === "territory" || (level === "county" && !!this.cfg.levels.county); };
  Analyzer.prototype.drill = function () {
    var s = this.state;
    if (!this.cfg.levels.zip || !this.drillable(s.level) || !s.area) return;
    s.parent = { level: s.level, id: s.area };
    s.level = "zip"; s.area = null; s.sortKey = null; s.query = ""; if (this.search) this.search.value = "";
    this.refresh();
  };

  /* ---------- Footprint navigation (cfg.footprint) ---------- */
  Analyzer.prototype.countyMarket = function () {
    if (!this.cmLoad) this.cmLoad = this.loadJSON(this.cfg.countyMarket || "../shared/geo/county_market.json").catch(function () { return {}; });
    return this.cmLoad;
  };
  // The market the "inside" rankings use: the selected DMA or metro, or the one being looked inside
  Analyzer.prototype.footprintFor = function (kind) {
    var s = this.state, p = s.parent;
    if (p) {
      if (p.level === "county") return kind === "zip" ? p : (s.chain[0] || null);
      return p;
    }
    return (s.level === "dma" || s.level === "metro") && s.area ? { level: s.level, id: s.area } : null;
  };
  Analyzer.prototype.marketName = function (f) {
    if (f && f.level === "sel") { var n = selIds(f).length; return NF0.format(n) + " selected DMA" + (n === 1 ? "" : "s"); }
    var d = f && this.data[f.level], row = d && d.byId[f.id];
    return row ? row.name + (f.level === "county" ? "" : " " + LEVEL_LABELS[f.level]) : "";
  };
  Analyzer.prototype.goNational = function (lv) {
    var s = this.state, back = s.parent && s.parent.level === lv ? s.parent.id : (s.chain[0] && s.chain[0].level === lv ? s.chain[0].id : (s.level === lv ? s.area : null));
    if (this.mode === "radius") this.closeRadius();
    s.level = lv; s.parent = null; s.chain = []; s.area = back; s.sortKey = null; s.query = ""; if (this.search) this.search.value = "";
    this.resetView = true; this.refresh();
  };
  Analyzer.prototype.goInside = function (kind, f) {
    var s = this.state;
    f = f || this.footprintFor(kind); if (!f) return;
    if (this.mode === "radius") this.closeRadius();
    if (f.level === "county") { if (!(s.parent && s.parent.level === "county" && s.parent.id === f.id)) s.chain = s.parent && s.parent.level !== "county" ? [s.parent] : s.chain; }
    else s.chain = [];
    s.parent = { level: f.level, id: f.id }; s.level = kind; s.area = null; s.sortKey = null; s.query = ""; if (this.search) this.search.value = "";
    this.refresh();
  };
  // A row's "Inside" button: a DMA or metro opens its counties; a county opens its ZIPs
  Analyzer.prototype.openInside = function (id) {
    var s = this.state;
    if (s.level === "county") this.goInside("zip", { level: "county", id: id });
    else this.goInside("county", { level: s.level, id: id });
  };
  Analyzer.prototype.renderNav = function () {
    if (!this.nav) return;
    var self = this, s = this.state, N = this.nav, radius = this.mode === "radius";
    N.nat.forEach(function (b) { b.setAttribute("aria-pressed", String(!radius && !s.parent && s.level === b.getAttribute("data-nat"))); });
    var any = false;
    N.inside.forEach(function (b) {
      var kind = b.getAttribute("data-in"), f = self.footprintFor(kind), ok = !!f;
      b.disabled = !ok; b.setAttribute("aria-disabled", String(!ok));
      var on = !radius && !!s.parent && s.level === kind; b.setAttribute("aria-pressed", String(on));
      if (ok) any = true;
    });
    var f = this.footprintFor("zip");
    N.insideLabel.textContent = any && f ? "Inside " + (this.marketName(f) || "the selected market") : "Inside the selected market";
    N.insideLabel.title = N.insideLabel.textContent;
    N.radius.setAttribute("aria-pressed", String(radius));
  };
  Analyzer.prototype.renderCrumbs = function () {
    var self = this, s = this.state, box = this.crumbs;
    if (!box) return;
    box.innerHTML = "";
    box.hidden = !s.parent;
    if (!s.parent) return;
    var top = s.chain[0] || s.parent, items = [el("button", { type: "button", class: "az-crumb", text: "U.S. " + (top.level === "metro" ? "metros" : "DMAs"), onclick: function () { self.goNational(top.level === "county" ? "dma" : top.level); } })];
    if (s.chain[0]) items.push(el("button", { type: "button", class: "az-crumb", text: this.marketName(s.chain[0]), onclick: function () { self.goInside("county", s.chain[0]); } }));
    items.push(el("span", { class: "az-crumb-here", text: this.marketName(s.parent) }));
    items.forEach(function (x, i) { if (i) box.appendChild(el("span", { class: "az-crumb-sep", "aria-hidden": "true", text: "\u203a" })); box.appendChild(x); });
  };
  /* ---------- Drill-down navigation (cfg.drill) ----------
     U.S. totals with the DMAs ranked underneath -> inside a DMA: its metros, counties or ZIPs -> inside a metro: its counties
     or ZIPs -> inside a county: its ZIPs. A breadcrumb shows the path; tabs switch what is ranked inside the current market.
     The Geography buttons still open the national DMA, metro and county lists. */
  var US_FILL = "#84cac0";
  // "sel": several DMAs looked at together (the DMAs ticked in the combined area); its id lists their codes
  function selIds(f) { return f.level === "sel" ? String(f.id).split(",") : [f.id]; }   // the U.S. map: one color, halfway between the 34-44 and 44-54 legend shades
  Analyzer.prototype.drillTabs = function (p) {
    var L = this.cfg.levels, out = [];
    if (!p) return out;
    if ((p.level === "dma" || p.level === "sel") && L.metro) out.push(["metro", "Metros"]);
    if ((p.level === "dma" || p.level === "sel" || p.level === "metro") && L.county) out.push(["county", "Counties"]);
    if (L.zip) out.push(["zip", "ZIPs"]);
    return out;
  };
  Analyzer.prototype.clearView = function () { var s = this.state; s.area = null; s.sortKey = null; s.query = ""; if (this.search) this.search.value = ""; };
  Analyzer.prototype.drillInto = function (f, kind, chain) {
    var s = this.state;
    if (this.mode === "radius") { this.mode = null; this.radiusBox.hidden = true; this.anaParts.forEach(function (x) { x.hidden = false; });
      Array.prototype.forEach.call(this.controlBar.querySelectorAll(".az-only"), function (x) { x.hidden = false; }); var m = this.map; setTimeout(function () { m.invalidateSize(); }, 0); }
    s.chain = chain || [];
    s.parent = { level: f.level, id: f.id };
    // Inside DMAs: metros first; inside a metro: counties; inside a county: ZIPs
    s.level = kind || (f.level === "county" ? "zip" : (f.level === "dma" || f.level === "sel") && this.cfg.levels.metro ? "metro" : this.cfg.levels.county ? "county" : "zip");
    this.clearView();
    this.refresh();
  };
  // "Look inside" a market from a list or the market panel; the markets above it stay in the breadcrumb
  Analyzer.prototype.lookInside = function (level, id) {
    var s = this.state, chain = s.parent ? s.chain.concat([s.parent]) : [];
    this.drillInto({ level: level, id: id }, null, chain);
  };
  Analyzer.prototype.drillTab = function (kind) {
    var s = this.state;
    if (!s.parent || s.level === kind) return;
    s.level = kind; this.clearView(); this.refresh();
  };
  // Geography buttons: the national U.S., DMA, metro and county views
  Analyzer.prototype.goLevel = function (lv) {
    var s = this.state, back = null;
    if (this.mode === "radius") this.closeRadius();
    if (!s.parent && s.level === lv) return;
    if (s.parent) s.chain.concat([s.parent]).forEach(function (x) { if (x.level === lv) back = x.id; });   // keep the market you were inside selected
    s.level = lv; s.parent = null; s.chain = []; this.clearView(); s.area = back;
    this.resetView = true; this.refresh();
  };
  Analyzer.prototype.renderDrillBar = function () {
    var self = this, s = this.state, bar = this.drillBar;
    if (!bar) return;
    bar.innerHTML = "";
    bar.hidden = !s.parent || this.mode === "radius";
    if (bar.hidden) return;
    var top = s.chain[0] || s.parent, here = this.marketName(s.parent);
    var items = [el("button", { type: "button", class: "az-crumb", text: "U.S.", onclick: function () { self.goLevel("us"); } }),
      el("button", { type: "button", class: "az-crumb", text: top.level === "metro" ? "Metros" : top.level === "county" ? "Counties" : "DMAs", onclick: function () { self.goLevel(top.level === "sel" ? "dma" : top.level); } })];
    s.chain.forEach(function (x, i) {
      items.push(el("button", { type: "button", class: "az-crumb", text: self.marketName(x), onclick: function () { self.drillInto(x, null, s.chain.slice(0, i)); } }));
    });
    items.push(el("span", { class: "az-crumb-here", text: here }));
    var crumbs = el("nav", { class: "az-crumbs", "aria-label": "Where you are" });
    items.forEach(function (x, i) { if (i) crumbs.appendChild(el("span", { class: "az-crumb-sep", "aria-hidden": "true", text: "›" })); crumbs.appendChild(x); });
    var tabs = this.drillTabs(s.parent);
    bar.appendChild(crumbs);
    if (s.parent.level === "sel" || (s.chain[0] && s.chain[0].level === "sel")) {
      var dd = this.data.dma, sp = s.parent.level === "sel" ? s.parent : s.chain[0];
      crumbs.appendChild(el("span", { class: "az-crumb-list", text: "(" + selIds(sp).map(function (id) { var r = dd && dd.byId[id]; return r ? r.name : id; }).join("; ") + ")" }));
    }
    if (s.parent.level === "sel" || s.parent.level === "dma") {
      var whole = selIds(s.parent);
      crumbs.appendChild(el("button", { type: "button", class: "az-inbtn az-whole", text: whole.length === 1 ? "Whole DMA as trade area" : "Whole DMAs as trade area",
        title: "Open " + (whole.length === 1 ? "this DMA" : "all " + NF0.format(whole.length) + " DMAs") + " together in the Trade area",
        onclick: function () { var ca = whole.map(function (id) { return "d" + id; }).join(","), sub = self.cfg.radiusProfiles ? s.sub : null;
          self.openRadius({ mode: "area", ca: ca, p: sub, view: "area", carry: { key: ca + "|" + (sub || ""), label: self.marketName(s.parent) || "the selected DMA", sub: self.subSel && self.subSel.selectedIndex >= 0 ? self.subSel.options[self.subSel.selectedIndex].text : "", ca: ca, p: sub } }); } }));
    }
    bar.appendChild(el("div", { class: "az-drill-tabs" }, [el("span", { text: "Rank inside " + here }),
      el("div", { class: "az-seg", role: "group", "aria-label": "Rank inside " + here }, tabs.map(function (t) {
        return el("button", { type: "button", "aria-pressed": String(s.level === t[0]), text: t[1], onclick: function () { self.drillTab(t[0]); } });
      }))]));
  };

  /* ---------- Combined area (cfg.drill): DMAs, metros, counties and ZIPs ticked in any list, opened together as one trade area.
     The Trade area tool counts every ZIP once, so overlaps aren't double counted; an area already inside another one is folded in. */
  var AREA_PREFIX = { dma: "d", metro: "m", county: "c", zip: "z" };
  // ZIPs of a county, metro or DMA from the ZIP index (zip -> [county, metro, dma]); built once per index
  var ZIP_POS = { county: 0, metro: 1, dma: 2 };
  function zipsOf(level, id, zx) {
    if (!zx || ZIP_POS[level] == null) return [];
    if (!zx.__by) {
      var by = { county: {}, metro: {}, dma: {} };
      Object.keys(zx).forEach(function (z) { var e = zx[z]; if (!e || !e.length) return;
        ["county", "metro", "dma"].forEach(function (L) { var k = e[ZIP_POS[L]]; if (k) (by[L][k] = by[L][k] || []).push(z); }); });
      Object.defineProperty(zx, "__by", { value: by, enumerable: false });
    }
    return zx.__by[level][id] || [];
  }
  function zipIn(z, a, zx) { var e = zx[z]; return a.level === "zip" ? z === a.id : !!e && e[ZIP_POS[a.level]] === a.id; }
  // a contains b when every one of b's ZIPs lies in a. Counties and metros can straddle a DMA line (Riverside County is
  // split between Los Angeles and Palm Springs), so containment is decided by ZIP, not by the county lists.
  function containsArea(a, b, cm, zx) {
    if (a.level === b.level) return a.id === b.id;
    if (a.level === "zip") return false;
    if (b.level === "zip") return zipIn(b.id, a, zx);
    var zs = zipsOf(b.level, b.id, zx);
    if (zs.length) return zs.every(function (z) { return zipIn(z, a, zx); });
    if (b.level === "county") return (a.level === "dma" || a.level === "metro") && ((cm[a.level] || {})[a.id] || []).indexOf(b.id) >= 0;
    if (b.level === "metro" && a.level === "dma") {
      var mc = (cm.metro || {})[b.id] || [], dc = (cm.dma || {})[a.id] || [];
      return mc.length > 0 && mc.every(function (c) { return dc.indexOf(c) >= 0; });
    }
    return false;
  }
  // Two areas share ZIPs (without one containing the other): their populations overlap in the combined total
  function sharesZips(a, b, zx) {
    if (a.level === "zip" || b.level === "zip") return false;
    return zipsOf(a.level, a.id, zx).some(function (z) { return zipIn(z, b, zx); });
  }
  Analyzer.prototype.zipLookup = function () {
    if (!this.zipLk) this.zipLk = this.loadJSON(this.cfg.zipIndex || "../shared/geo/zip_market.json").catch(function () { return {}; });
    return this.zipLk;
  };
  Analyzer.prototype.inBasket = function (level, id) { return this.basket.some(function (b) { return b.level === level && b.id === id; }); };
  Analyzer.prototype.areaName = function (level, row) {
    if (!row) return "";
    return level === "zip" ? "ZIP " + row.name : level === "dma" ? row.name + " DMA" : level === "metro" ? row.name + " metro" : row.name;
  };
  Analyzer.prototype.toggleBasket = function (level, id, row, on) {
    var self = this;
    if (!on) {
      this.basket = this.basket.filter(function (b) { return !(b.level === level && b.id === id); });
      this.basketMsg = ""; this.afterBasket(); return;
    }
    if (this.inBasket(level, id)) return;
    var item = { level: level, id: id, name: this.areaName(level, row), pop: (row && row.v && row.v.population) || 0 };
    Promise.all([this.countyMarket(), this.zipLookup()]).then(function (r) {
      var cm = self.cmCache = r[0] || {}, zx = self.zxCache = r[1] || {};
      if (self.inBasket(level, id)) return;
      var holder = self.basket.filter(function (b) { return containsArea(b, item, cm, zx); })[0];
      if (holder) { self.basketMsg = item.name + " is already inside " + holder.name + ", so it wasn't added twice."; self.afterBasket(); return; }
      var inner = self.basket.filter(function (b) { return containsArea(item, b, cm, zx); });
      self.basket = self.basket.filter(function (b) { return inner.indexOf(b) < 0; }).concat([item]);
      self.basketMsg = inner.length ? item.name + " already includes " + (inner.length === 1 ? inner[0].name : NF0.format(inner.length) + " areas you had picked") + ", so " + (inner.length === 1 ? "it was" : "they were") + " folded in." : "";
      self.afterBasket();
    });
  };
  // The ticked DMAs become the frame for the next level: their metros (then counties and ZIPs) ranked together.
  // They leave the combined area, so the metros, counties or ZIPs ticked next build the trade area.
  Analyzer.prototype.rankInsideDmas = function (dmas) {
    var ids = dmas.map(function (b) { return b.id; }), one = ids.length === 1;
    this.basket = this.basket.filter(function (b) { return b.level !== "dma"; });
    this.basketMsg = (one ? dmas[0].name + " is" : "The " + NF0.format(ids.length) + " DMAs are") + " now the view above. Tick the metros, counties or ZIPs you want for the trade area, or use \u201cWhole " + (one ? "DMA" : "DMAs") + " as trade area\u201d to keep " + (one ? "all of it" : "them all") + ".";
    this.drillInto(one ? { level: "dma", id: ids[0] } : { level: "sel", id: ids.join(",") }, "metro", []);
  };
  Analyzer.prototype.afterBasket = function () {
    if (this.state.level !== "us" || this.cfg.drill) this.renderTable(); else this.renderPick();
    this.renderDetail();
  };
  Analyzer.prototype.renderBasket = function () {
    var self = this, s = this.state, B = this.basket, bar = this.pickBar, cfg = this.cfg;
    bar.innerHTML = "";
    if (!B.length && !this.basketMsg) { bar.hidden = true; return; }
    bar.hidden = false;
    var msg = this.basketMsg ? el("p", { class: "az-pickmsg", text: this.basketMsg }) : null;
    if (!B.length) { bar.appendChild(el("div", { class: "az-pickinfo" }, [msg])); return; }
    var pop = 0; B.forEach(function (b) { pop += b.pop; });
    // A metro or county can reach past a DMA's edge: then the sum below counts the shared part twice (the trade area won't)
    var zx = this.zxCache || {}, overlap = B.some(function (a, i) { return B.some(function (b, j) { return i < j && sharesZips(a, b, zx); }); });
    var count = {}; B.forEach(function (b) { count[b.level] = (count[b.level] || 0) + 1; });
    var NOUN = { dma: ["DMA", "DMAs"], metro: ["metro", "metros"], county: ["county", "counties"], zip: ["ZIP", "ZIPs"] };
    var mix = ["dma", "metro", "county", "zip"].filter(function (k) { return count[k]; }).map(function (k) { return NF0.format(count[k]) + " " + NOUN[k][count[k] === 1 ? 0 : 1]; }).join(", ");
    bar.appendChild(el("div", { class: "az-pickinfo" }, [
      el("p", null, [el("b", { text: "Combined area: " + mix }), pop ? " · " + (overlap ? "about " : "") + NF0.format(pop) + " people" + (overlap ? " before overlaps are removed" : "") : ""]),
      el("div", { class: "az-chips" }, B.map(function (b) {
        return el("span", { class: "az-chip" }, [b.name, el("button", { type: "button", "aria-label": "Remove " + b.name, title: "Remove", text: "×", onclick: function () { self.toggleBasket(b.level, b.id, null, false); } })]);
      })),
      msg]));
    var dmas = B.filter(function (b) { return b.level === "dma"; }), rk = dmas.length && this.cfg.levels.metro;
    bar.appendChild(el("div", { class: "az-pickact" }, [
      rk ? el("button", { type: "button", class: "az-btn primary", text: dmas.length === 1 ? "Rank metros in this DMA" : "Rank metros in these DMAs",
        title: "Rank the metros, counties and ZIPs inside the " + (dmas.length === 1 ? "selected DMA" : NF0.format(dmas.length) + " selected DMAs") + ", then tick the ones you want for the trade area",
        onclick: function () { self.rankInsideDmas(dmas); } }) : null,
      el("button", { type: "button", class: "az-btn" + (rk ? "" : " primary"), text: "Open as trade area", title: "Count likely customers and rank the ZIPs across these areas together; each ZIP is counted once",
        onclick: function () { var o = self.carryOpt(); if (!o.carry) o = { mode: "area", ca: B.map(function (b) { return AREA_PREFIX[b.level] + b.id; }).join(","), p: cfg.radiusProfiles ? s.sub : null }; o.view = "area"; self.openRadius(o); } }),
      el("button", { type: "button", class: "az-btn", text: "Clear", onclick: function () { self.basket = []; self.basketMsg = ""; self.afterBasket(); } })]));
  };

  // Search for a county by name from any view: suggestions open its ZIPs
  Analyzer.prototype.countySuggest = function (q, td) {
    var self = this;
    if (!this.cfg.footprint || !this.cfg.levels.county || q.length < 3 || /^\d+$/.test(q)) return;
    Promise.all([this.ensureLevel("county", true), this.countyMarket()]).then(function (r) {
      if (self.state.query !== q || !td.isConnected) return;
      var cm = r[1] || {}, dmaOf = {};
      Object.keys(cm.dma || {}).forEach(function (d) { cm.dma[d].forEach(function (c) { if (!dmaOf[c]) dmaOf[c] = d; }); });
      var hits = self.data.county.rows.filter(function (x) { return x.name.toLowerCase().indexOf(q) >= 0; }).slice(0, 6);
      if (!hits.length) return;
      td.innerHTML = "";
      td.appendChild(el("span", { text: "Counties matching \u201c" + q + "\u201d: " }));
      hits.forEach(function (x, i) {
        td.appendChild(el("button", { type: "button", class: "az-inbtn", text: x.name, title: "Rank the ZIPs in " + x.name, onclick: function () {
          self.state.chain = dmaOf[x.id] ? [{ level: "dma", id: dmaOf[x.id] }] : [];
          self.state.parent = null; self.goInside("zip", { level: "county", id: x.id });
        } }));
      });
    });
  };

  // A full ZIP typed into search that isn't in the current list: open that ZIP inside its own market, keeping the
  // market type in use (county, metro or DMA), or the DMA from the national views.
  Analyzer.prototype.maybeFindZip = function () {
    var self = this, s = this.state, q = s.query;
    if (!this.cfg.levels.zip || !/^\d{5}$/.test(q)) return;
    var cur = this.d(s.level);
    if (s.level === "zip" && cur && cur.byId[q]) return;            // already listed here
    if (!this.zipIndex) {
      this.zipIndex = fetch(this.cfg.zipIndex || "../shared/geo/zip_market.json").then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
      });
    }
    this.zipIndex.then(function (ix) {
      if (s.query !== q) return;                                      // the user kept typing
      var e = ix[q];
      if (!e) { self.zipMiss(q, "ZIP " + q + " wasn't found."); return; }
      var want = s.level === "zip" && s.parent ? s.parent.level : (self.drillable(s.level) ? s.level : "dma");
      var ids = { county: e[0], metro: e[1], dma: e[2] }, order = [want, "dma", "county", "metro"], lv = null;
      for (var i = 0; i < order.length; i++) { var L0 = order[i]; if (ids[L0] && self.cfg.levels[L0] && (L0 !== "county" || self.cfg.levels.county)) { lv = L0; break; } }
      if (!lv) { self.zipMiss(q, "ZIP " + q + " isn't in a market this site covers."); return; }
      s.parent = { level: lv, id: ids[lv] };
      s.chain = lv === "county" && ids.dma && self.cfg.levels.dma ? [{ level: "dma", id: ids.dma }] : [];
      s.level = "zip"; s.area = q; s.sortKey = null; s.query = ""; self.search.value = "";
      self.refresh();
    }).catch(function () { self.zipMiss(q, "The ZIP lookup didn't load; try again in a minute."); });
  };
  Analyzer.prototype.zipMiss = function (q, msg) {
    if (this.state.query !== q) return;
    var td = this.tbody.querySelector(".az-empty"); if (td) td.textContent = msg + " Clear the search to see all markets.";
  };

  var VERSION = "Fall 2026";
  var DISCLAIMER = "Estimates for planning. Scores and figures are modeled from public government and licensed third-party data.";
  var ABOUT_ESTIMATES = { title: "About these estimates", body: [
    "Estimates for planning. Scores rank markets against each other; they don't forecast sales, leads or ad results.",
    "Census ACS figures are 5-year survey averages with margins of error, widest for small ZIPs and counties. IRS, mortgage, business and EASI figures are the newest year published, often one to three years old. Years are listed under Sources.",
    "Markets with the same overall score are ranked by their Demand part; markets equal on both share a rank.",
    "Trade area counts are modeled: selected traits are treated as independent within each ZIP.",
    "Business counts: U.S. totals are Census's published national figures. Market counts come from Census's county file, which adds to 1–6% less because Census withholds some county detail.",
    "ZIPs under 500 residents, and ZIPs that are mostly group quarters (campuses, bases, prisons), are shown but not ranked." ] };

  /* ---------- URL state ---------- */
  // Link to the Customer Analysis (CRM) with this analyzer's category, subcategory and selected DMA
  Analyzer.prototype.crmUrl = function () {
    var s = this.state, cfg = this.cfg, q = [];
    q.push("category=" + encodeURIComponent(cfg.exportName || ""));
    var sub = (cfg.subcategories || []).filter(function (x) { return x.id === s.sub; })[0];
    if (sub) q.push("sub=" + encodeURIComponent(sub.id), "subl=" + encodeURIComponent(sub.label));
    q.push("from=" + encodeURIComponent(cfg.title || ""));
    var dma = s.level === "dma" && s.area ? s.area : (s.level === "zip" && s.parent && s.parent.level === "dma" ? s.parent.id : null);
    if (dma) q.push("dma=" + encodeURIComponent(dma));
    return (cfg.crmUrl || "../crm-analyzer/") + "?" + q.join("&");
  };
  Analyzer.prototype.readHash = function () {
    var h = (location.hash || "").replace(/^#/, "");
    this.ptLayers = this.cfg.pointLayers || (this.cfg.pointLayer ? [this.cfg.pointLayer] : []);
    this.state.pts = this.state.pts || {};
    if (!h) return;
    var p = {};
    h.split("&").forEach(function (kv) { var a = kv.split("="); if (a[0]) p[a[0]] = decodeURIComponent(a[1] || ""); });
    var cfg = this.cfg;
    // Radius view (also where the old radius.html links forward to): #level=radius&sub=..&zip=..&r=..
    this.wantRadius = (p.level === "radius" || p.level === "area") && cfg.radius ? { zip: p.zip, r: p.r, p: p.p, mode: p.level === "area" ? "area" : "radius", ca: p.ca, view: p.tab === "plan" ? "plan" : null } : null;
    // From the TV + Video tool: the Digital Video amount to hold in the Recommended allocation (tvv dollars, tvl line, tvp product)
    if (this.wantRadius && +p.tvv > 0 && /^(ctv|youtube)$/.test(p.tvl || "")) this.wantRadius.hand = { dollars: Math.round(+p.tvv), id: p.tvl, product: (p.tvp || "").slice(0, 60), market: (p.tvm || "").slice(0, 80), cpm: +p.tvc > 0 && +p.tvc < 1000 ? +p.tvc : null };   // a profile applies only when the link names one (p=); no preset otherwise
    if (this.wantRadius && p.p && cfg.subcategories && cfg.subcategories.some(function (x) { return x.id === p.p; })) this.state.sub = p.p;
    if (cfg.levels[p.level]) this.state.level = p.level;
    if (p.level === "zip") {
      var m = /^(dma|metro|county|territory):(.+)$/.exec(p["in"] || "");
      if (!m && cfg.drill) m = /^(sel):(\d+(?:,\d+)*)$/.exec(p["in"] || "");
      if (m && cfg.levels.zip && (cfg.levels[m[1]] || m[1] === "sel")) this.state.parent = { level: m[1], id: m[2] }; else this.state.level = cfg.defaultLevel || "dma";
    }
    if (p.level === "county" && cfg.footprint) {
      var mc = /^(dma|metro):(.+)$/.exec(p["in"] || "");
      if (mc && cfg.levels[mc[1]]) this.state.parent = { level: mc[1], id: mc[2] };
    }
    var mv = /^(dma|metro):(.+)$/.exec(p.via || "");
    this.state.chain = mv && cfg.footprint && this.state.parent && this.state.parent.level === "county" ? [{ level: mv[1], id: mv[2] }] : [];
    if (cfg.drill) {
      // Inside a market: in= is the market, via= the markets above it (e.g. in=metro:14460&via=dma:506)
      if (p.level !== "zip") this.state.parent = null;
      var md = /^(dma|metro|sel):(.+)$/.exec(p["in"] || "");
      if (md && (cfg.levels[md[1]] || md[1] === "sel") && (p.level === "county" || (p.level === "metro" && md[1] !== "metro"))) this.state.parent = { level: md[1], id: md[2] };
      var vv = (p.via || "").split("|"); if (vv.length === 1 && !/^sel:/.test(vv[0])) vv = vv[0].split(",");   // older links used commas
      this.state.chain = this.state.parent ? vv.map(function (x) { return /^(dma|metro|county|sel):(.+)$/.exec(x); }).filter(function (m) { return m && (cfg.levels[m[1]] || m[1] === "sel"); })
        .map(function (m) { return { level: m[1], id: m[2] }; }) : [];
    }
    if ((cfg.subcategories || []).some(function (s) { return s.id === p.sub; })) this.state.sub = p.sub;
    if ((cfg.rankBy || []).indexOf(p.rank) >= 0) this.state.rank = p.rank;
    if (p.area) this.state.area = p.area;
    this.state.pts = {};
    if (p.pts) {
      var on = p.pts === "1" ? [this.ptLayers[0] && this.ptLayers[0].key] : p.pts.split(",");
      this.ptLayers.forEach(function (L0) { if (on.indexOf(L0.key) >= 0) this.state.pts[L0.key] = true; }, this);
    }
  };
  Analyzer.prototype.writeHash = function () {
    var s = this.state, rs = this.radius && this.radius.state, isArea = this.mode === "radius" && (rs ? rs.mode === "area" : this.radiusMode === "area");
    var parts = ["level=" + (this.mode === "radius" ? (isArea ? "area" : "radius") : s.level)];
    if (this.mode === "radius") {
      if (s.sub) parts.push("sub=" + encodeURIComponent(s.sub));
      if (rs && rs.profile) parts.push("p=" + encodeURIComponent(rs.profile));
      if (isArea) { if (rs && rs.areaTokens && rs.areaTokens.length <= 2000) parts.push("ca=" + encodeURIComponent(rs.areaTokens.join(","))); }   // custom area: ZIPs, counties, towns and locations
      else { if (rs && rs.zip) parts.push("zip=" + rs.zip); if (rs && rs.r) parts.push("r=" + rs.r); }
      if (rs && rs.view === "plan") parts.push("tab=plan");
      var hr = "#" + parts.join("&"); if (location.hash !== hr) history.replaceState(null, "", hr);
      return;
    }
    if (s.sub) parts.push("sub=" + encodeURIComponent(s.sub));
    if (s.rank) parts.push("rank=" + encodeURIComponent(s.rank));
    if ((s.level === "zip" || s.level === "county" || s.level === "metro") && s.parent) parts.push("in=" + s.parent.level + ":" + encodeURIComponent(s.parent.id));
    if (s.parent && s.chain && s.chain[0]) parts.push("via=" + (this.cfg.drill ? s.chain : s.chain.slice(0, 1)).map(function (x) { return x.level + ":" + encodeURIComponent(x.id); }).join(this.cfg.drill ? "|" : ","));
    if (s.area && s.level !== "us") parts.push("area=" + encodeURIComponent(s.area));
    var onPts = (this.ptLayers || []).filter(function (L0) { return s.pts && s.pts[L0.key]; }).map(function (L0) { return L0.key; });
    if (onPts.length) parts.push("pts=" + (this.cfg.pointLayers ? onPts.join(",") : "1"));
    var h = "#" + parts.join("&");
    if (location.hash !== h) history.replaceState(null, "", h);
  };

  /* ---------- Loading ---------- */
  Analyzer.prototype.loadJSON = function (url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("Couldn't load " + url + " (HTTP " + r.status + ")");
      return r.json();
    });
  };
  Analyzer.prototype.ensureLevel = function (level, plain) {
    var self = this, L = this.cfg.levels[level], jobs = [], key = plain ? level : this.key(level);
    var chainJobs = !plain && this.cfg.drill ? (this.state.chain || []).map(function (x) { return self.ensureLevel(x.level === "sel" ? "dma" : x.level, true); }) : [];   // breadcrumb names
    if (!plain && (level === "county" || level === "metro") && key !== level) {
      // Counties inside a DMA or metro: the national county rows for that market's counties (shared/geo/county_market.json).
      // Metros inside a DMA: every metro with at least one county in the DMA, tagged when part of it lies outside.
      // Several selected DMAs ("sel"): the same, across all of them, with a DMA column (row.mk)
      var p = this.state.parent, isSel = p.level === "sel";
      return Promise.all([this.ensureLevel(level, true), this.ensureLevel(isSel ? "dma" : p.level, true), this.countyMarket()].concat(chainJobs)).then(function (r) {
        if (self.data[key]) return;
        var nat = self.data[level], cm = r[2] || {}, byId = {}, rows, ids = [], dmaOf = {}, dd = self.data.dma;
        if (isSel) selIds(p).forEach(function (d) { ((cm.dma || {})[d] || []).forEach(function (c) { if (!dmaOf[c]) { dmaOf[c] = d; ids.push(c); } }); });
        else ids = (cm[p.level] || {})[p.id] || [];
        var dmaName = function (d) { var x = dd && dd.byId[d]; return x ? x.name : d; };
        var tag = function (row, mk) { if (!isSel) return row; var c = {}; for (var x in row) c[x] = row[x]; c.mk = mk; return c; };
        if (level === "county") rows = ids.map(function (id) { return nat.byId[id] && tag(nat.byId[id], dmaName(dmaOf[id])); }).filter(Boolean);
        else {
          var inMkt = {}; ids.forEach(function (c) { inMkt[c] = 1; });
          rows = [];
          Object.keys(cm.metro || {}).forEach(function (mid) {
            var mc = cm.metro[mid], row = nat.byId[mid], k = mc.filter(function (c) { return inMkt[c]; }).length;
            if (!k || !row) return;
            if (isSel) { var dl = []; mc.forEach(function (c) { var d = dmaOf[c]; if (d && dl.indexOf(d) < 0) dl.push(d); }); row = tag(row, dl.map(dmaName).join("; ")); }
            if (k < mc.length) {
              var copy = {}; for (var x in row) copy[x] = row[x];
              copy.t = "Partly outside";
              copy.f = ["Part of this metro lies outside " + self.marketName(p) + ". Its figures and rank are for the whole metro."].concat(row.f || []);
              row = copy;
            }
            rows.push(row);
          });
        }
        rows.forEach(function (x) { byId[x.id] = x; });
        self.data[key] = { rows: rows, byId: byId, meta: nat.meta };
      });
    }
    if (level === "zip" && !plain && this.state.parent && this.state.parent.level === "sel") return this.ensureSelZips(key, chainJobs);
    if (level === "zip") jobs.push(this.ensureLevel(this.state.parent.level, true));  // parent names and outline
    if (level === "zip" && this.cfg.footprint && this.state.chain && this.state.chain[0]) jobs.push(this.ensureLevel(this.state.chain[0].level, true));   // breadcrumb names
    if (level === "zip") jobs = jobs.concat(chainJobs);
    if (key && !this.data[key]) jobs.push(this.loadJSON(level === "zip" ? this.url(L.data) : L.data).then(function (d) {
      var byId = {};
      d.rows.forEach(function (r) { byId[r.id] = r; });
      self.data[key] = { rows: d.rows, byId: byId, meta: d };
    }));
    var geoUrl = L.geo && (level === "zip" ? this.url(L.geo) : L.geo);
    if (geoUrl && !(geoUrl in this.geo)) jobs.push(this.loadJSON(geoUrl).then(function (t) {
      self.geo[geoUrl] = topojson.feature(t, t.objects[Object.keys(t.objects)[0]]);
    }, function (e) {
      if (level !== "zip") throw e;
      self.geo[geoUrl] = null;  // ZIP boundaries missing for this market: the table still works
    }));
    var states = this.cfg.statesGeo;
    if (states && !this.geo[states]) jobs.push(this.loadJSON(states).then(function (t) {
      self.geo[states] = topojson.mesh(t, t.objects[Object.keys(t.objects)[0]], function (a, b) { return a !== b; });
    }));
    return Promise.all(jobs);
  };

  // ZIPs across several selected DMAs: each DMA's ZIP file and boundaries, merged. ZIP scores in those files rank ZIPs
  // within their own DMA, so they're re-ranked across all the selected DMAs the same way the data build does (cfg.zipScore:
  // each owner profile's inputs, each a percentile among ranked ZIPs, averaged).
  Analyzer.prototype.ensureSelZips = function (key, chainJobs) {
    var self = this, L = this.cfg.levels.zip, p = this.state.parent, ids = selIds(p);
    var fill = function (t, d) { return (typeof t === "object" ? t.dma || t["default"] : t).replace("{level}", "dma").replace("{id}", encodeURIComponent(d)); };
    var geoKey = this.url(L.geo), states = this.cfg.statesGeo;
    var jobs = [this.ensureLevel("dma", true)].concat(chainJobs);
    if (states && !this.geo[states]) jobs.push(this.loadJSON(states).then(function (t) { self.geo[states] = topojson.mesh(t, t.objects[Object.keys(t.objects)[0]], function (a, b) { return a !== b; }); }));
    if (this.data[key] && geoKey in this.geo) return Promise.all(jobs);
    var parts = ids.map(function (d) {
      return Promise.all([self.loadJSON(fill(L.data, d)), L.geo ? self.loadJSON(fill(L.geo, d)).catch(function () { return null; }) : null]).then(function (r) { return { d: d, data: r[0], topo: r[1] }; });
    });
    return Promise.all(jobs.concat([Promise.all(parts).then(function (got) {
      var rows = [], byId = {}, feats = [], dd = self.data.dma;
      got.forEach(function (g) {
        var nm = dd && dd.byId[g.d] ? dd.byId[g.d].name : g.d;
        g.data.rows.forEach(function (r) { if (byId[r.id]) return; var c = {}; for (var x in r) c[x] = r[x]; c.v = {}; for (var y in r.v) c.v[y] = r.v[y]; c.mk = nm; byId[c.id] = c; rows.push(c); });
        if (g.topo) feats = feats.concat(topojson.feature(g.topo, g.topo.objects[Object.keys(g.topo.objects)[0]]).features);
      });
      self.rescoreZips(rows);
      self.data[key] = { rows: rows, byId: byId, meta: got[0] ? got[0].data : {} };
      self.geo[geoKey] = feats.length ? { type: "FeatureCollection", features: feats } : null;
    })]));
  };
  // cfg.zipScore: { weights: { demand, spend }, derived: { key: ["max", a, b] }, subs: { sub: { demand: [inputs], spend: key or null } } }
  // (or the short form { sub: [demand inputs] }, demand only). Same steps as the data builds: each input a percentile
  // (pandas rank(pct=True), average ties, 2 decimals) among ranked ZIPs (no "u"), demand = mean of the available ones,
  // score = demand, or demand and spend weighted when the category has a spend part.
  Analyzer.prototype.rescoreZips = function (rows) {
    var Z = this.cfg.zipScore; if (!Z) return;
    var subs = Z.subs || Z, W = Z.weights || { demand: 0.4, spend: 0.15 }, derived = Z.derived || {};
    var ok = rows.filter(function (r) { return !r.u; }), memo = {};
    var val = function (r, k) { var x = r.v[k]; return typeof x === "number" && isFinite(x) ? x : null; };
    var pctMap = function (getter) {
      var have = ok.map(function (r) { return [r.id, getter(r)]; }).filter(function (x) { return x[1] != null; }).sort(function (a, b) { return a[1] - b[1]; });
      var n = have.length, out = {}, i = 0;
      while (i < n) { var j = i; while (j + 1 < n && have[j + 1][1] === have[i][1]) j++;
        var pr = Math.round(((i + j + 2) / 2) / n * 10000) / 100; for (var q = i; q <= j; q++) out[have[q][0]] = pr; i = j + 1; }
      return out;
    };
    var P = function (k) {
      if (memo[k]) return memo[k];
      var d = derived[k];
      if (d && d[0] === "max") {   // e.g. climate stress = the higher of the heating and cooling percentiles, then ranked again
        var a = P(d[1]), b = P(d[2]), m = {};
        ok.forEach(function (r) { var x = a[r.id], y = b[r.id]; m[r.id] = x == null ? (y == null ? null : y) : (y == null ? x : Math.max(x, y)); });
        return (memo[k] = pctMap(function (r) { return m[r.id]; }));
      }
      return (memo[k] = pctMap(function (r) { return val(r, k); }));
    };
    Object.keys(subs).forEach(function (sub) {
      var def = Array.isArray(subs[sub]) ? { demand: subs[sub], spend: null } : subs[sub];
      var ins = def.demand.filter(function (k) { return derived[k] || ok.some(function (r) { return val(r, k) != null; }); }).map(P);
      var sp = def.spend ? P(def.spend) : null;
      rows.forEach(function (r) {
        var dem = null, spd = null, sc = null;
        if (!r.u) {
          var a = ins.map(function (m) { return m[r.id]; }).filter(function (x) { return x != null; });
          dem = a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null;
          spd = sp ? (sp[r.id] == null ? null : sp[r.id]) : null;
          sc = sp ? (dem != null && spd != null ? (W.demand * dem + W.spend * spd) / (W.demand + W.spend) : null) : dem;
        }
        r.v["demand@" + sub] = dem == null ? null : Math.round(dem * 100) / 100;
        if (sp) r.v["spend@" + sub] = spd;
        r.v["score@" + sub] = sc == null ? null : Math.round(sc * 1000) / 1000;
      });
    });
  };

  /* ---------- Results panel ----------
     Case study slides and testimonials for the selected category. Materials go in cfg.results as
     { "<category id>": { caseStudies: [{ title, summary, url }], testimonials: [{ quote, name, role, business }] } }.
     Until any are loaded, the panel shows a layout preview. */
  Analyzer.prototype.openResults = function () {
    var self = this, cfg = this.cfg;
    var subId = this.subSel ? this.subSel.value : "";
    var subLabel = this.subSel && this.subSel.selectedIndex >= 0 ? this.subSel.options[this.subSel.selectedIndex].text : "";
    var mat = (cfg.results && typeof cfg.results === "object" && cfg.results[subId]) || {};
    var cases = mat.caseStudies || [], quotes = mat.testimonials || [];
    var body = this.resultsBody; body.innerHTML = "";
    body.appendChild(el("div", { class: "az-results-head" }, [
      el("div", null, [
        el("h2", { id: "az-results-title", text: "Results" }),
        el("p", { class: "az-results-sub", text: (cfg.title || "").replace(/ Market Analyzer$/, "") + (subLabel ? " \u00b7 " + subLabel : "") })
      ]),
      el("button", { type: "button", class: "az-modal-close", "aria-label": "Close", text: "\u00d7", onclick: function () { self.resultsPanel.close(); } })
    ]));
    function section(title, items, render, emptyText) {
      return el("section", { class: "az-results-sec" }, [el("h3", { text: title })].concat(items.length ? items.map(render)
        : [el("div", { class: "az-results-ph" }, [el("span", { text: emptyText })])]));
    }
    body.appendChild(section("Case studies", cases, function (c) {
      return el("article", { class: "az-results-card" }, [el("h4", { text: c.title || "" }), c.summary ? el("p", { text: c.summary }) : null,
        c.url ? el("a", { href: c.url, target: "_blank", rel: "noopener", text: "Open the case study" }) : null]);
    }, "Case study slides for this category will appear here."));
    body.appendChild(section("Client testimonials", quotes, function (q) {
      return el("blockquote", { class: "az-results-quote" }, [el("p", { text: "\u201c" + (q.quote || "") + "\u201d" }),
        el("footer", { text: [q.name, q.role, q.business].filter(Boolean).join(", ") })]);
    }, "Short client quotes for this category will appear here."));
    if (!cases.length && !quotes.length) body.appendChild(el("p", { class: "az-results-note", text: "Layout preview: no materials are loaded for this category yet." }));
    if (this.resultsPanel.showModal) this.resultsPanel.showModal(); else this.resultsPanel.setAttribute("open", "");
  };

  /* ---------- Layout ---------- */
  Analyzer.prototype.build = function () {
    var cfg = this.cfg, self = this;
    document.title = cfg.title;
    var links = (cfg.links || []).map(function (l) { return el("a", { href: l.url, text: l.label }); });
    var header = el("header", { class: "az-header" }, [
      el("div", { class: "az-header-inner" }, [
        el("div", { class: "az-title" }, [
          el("h1", { text: cfg.title }),
          el("p", { text: cfg.subtitle || "" }),
          links.length ? el("nav", { class: "az-links", "aria-label": "Related tools" }, links) : null
        ]),
        el("img", { class: "az-logo", src: cfg.logo || "../shared/adtaxi-logo.svg", alt: "Adtaxi" })
      ]),
      this.tabBar = el("nav", { class: "az-tabs", "aria-label": "Analyzer sections", hidden: true }, [["markets", "Markets"], ["timing", "Timing"], ["bench", "Benchmarks"]].map(function (t) {
        return el("button", { type: "button", "data-tab": t[0], "aria-pressed": String(t[0] === "markets"), text: t[1], hidden: t[0] !== "markets", onclick: function () { self.setTab(t[0]); } });
      }))
    ]);

    // Controls
    this.levelSeg = el("div", { class: "az-seg", role: "group", "aria-label": "Geography level" },
      Object.keys(cfg.levels).concat(cfg.radius ? ["radius", "plan"] : []).map(function (lv) {
        // Plan: the second half of the trade area (ad response, Recommended allocation, proposal), open once the trade area has ZIPs
        if (lv === "plan") return self.planBtn = el("button", { type: "button", "data-level": "plan", text: "Plan", disabled: "disabled",
          title: "Build a trade area first; then see ad response, the recommended allocation and the proposal", onclick: function () { self.openRadius({ view: "plan" }); } });
        // Trade area: the Zip Code Radius Tool, which draws the area as a radius or, where the site turns it on, a custom list of ZIPs, counties and towns
        if (lv === "radius") return el("button", { type: "button", "data-level": "radius", text: "Trade area",
          title: "Count likely customers in a business's trade area: a radius around a ZIP or town, or a custom list of ZIPs, counties, towns, DMAs or metros", onclick: function () { self.openTradeArea(); } });
        if (lv === "zip") return el("button", { type: "button", "data-level": "zip", text: cfg.levels.zip.label || "ZIPs in market",
          title: "Pick a DMA, metro or county first, then see the ZIPs inside it", onclick: function () {
            var s = self.state;
            if (cfg.drill) {
              if (s.parent) { if (self.mode === "radius") self.closeRadius(); self.drillTab("zip"); }
              else if (self.drillable(s.level) && s.area) self.drillInto({ level: s.level, id: s.area }, "zip", []);
              return;
            }
            if (self.mode === "radius") self.closeRadius(); if (self.state.level !== "zip") self.drill(); } });
        return el("button", { type: "button", "data-level": lv, text: cfg.levels[lv].label || LEVEL_LABELS[lv],
          onclick: function () { if (cfg.drill) { self.goLevel(lv); return; } if (self.mode === "radius") self.closeRadius(); self.setLevel(lv); } });
      }));
    var controls = [el("div", { class: "az-field" }, [el("span", { text: "Geography" }), this.levelSeg])];
    if (cfg.footprint) {
      // Rank nationally (DMAs or metros) | inside the selected market (counties or ZIPs) | Trade area
      var natB = ["dma", "metro"].filter(function (lv) { return cfg.levels[lv]; }).map(function (lv) {
        return el("button", { type: "button", "data-nat": lv, text: lv === "dma" ? "DMAs" : "Metros", title: "Rank every " + (lv === "dma" ? "DMA" : "metro") + " in the U.S.", onclick: function () { self.goNational(lv); } });
      });
      var inB = [["county", "Counties"], ["zip", "ZIPs"]].filter(function (k) { return cfg.levels[k[0]]; }).map(function (k) {
        return el("button", { type: "button", "data-in": k[0], text: k[1], title: "Rank the " + k[1].toLowerCase() + " inside the selected market", onclick: function () { self.goInside(k[0]); } });
      });
      var radB = cfg.radius ? el("button", { type: "button", text: "Trade area",
        title: "Count likely customers in a business's trade area: a radius around a ZIP or town, or a custom list of ZIPs, counties, towns, DMAs or metros", onclick: function () { self.openRadius(); } }) : null;
      this.nav = { nat: natB, inside: inB, radius: radB || el("span"), insideLabel: el("span", { text: "Inside the selected market" }) };
      this.levelSeg = el("div");   // the level buttons other code updates; not shown with footprint navigation
      controls = [
        el("div", { class: "az-field" }, [el("span", { text: "Rank nationally" }), el("div", { class: "az-seg", role: "group", "aria-label": "Rank nationally" }, natB)]),
        el("div", { class: "az-field az-inside-field" }, [this.nav.insideLabel, el("div", { class: "az-seg", role: "group", "aria-label": "Rank inside the selected market" }, inB)]),
        radB ? el("div", { class: "az-field" }, [el("span", { text: "Or" }), el("div", { class: "az-seg", role: "group", "aria-label": "Trade area" }, [radB])]) : null
      ].filter(Boolean);
    }
    if ((cfg.subcategories || []).length) {
      this.subSel = el("select", { "aria-label": cfg.subcategoryLabel || "Category", onchange: function () { self.state.sub = this.value; self.state.sortKey = null;
        if (self.mode === "radius") { if (self.radius) self.radius.usePreset(self.state.sub); self.writeHash(); } else self.refresh(); } },
        cfg.subcategories.map(function (s) { return el("option", { value: s.id, text: s.label }); }));
      controls.push(el("label", { class: "az-field" }, [el("span", { text: cfg.subcategoryLabel || "Category" }), this.subSel]));
    }
    this.rankSel = el("select", { onchange: function () { self.state.rank = this.value; self.state.sortKey = null; self.refresh(); } });
    controls.push(el("label", { class: "az-field az-only" }, [el("span", { text: "Rank and map by" }), this.rankSel]));
    this.showSel = el("select", { onchange: function () { self.state.show = +this.value; self.renderTable(); } },
      [10, 25, 50, 100, 0].map(function (n) { return el("option", { value: n, text: n ? "Top " + n : "All" }); }));
    this.showSel.value = String(this.state.show);
    controls.push(el("label", { class: "az-field az-only" }, [el("span", { text: "Show" }), this.showSel]));
    this.search = el("input", { type: "search", placeholder: "Find a market", "aria-label": "Find a market",
      oninput: function () { self.state.query = this.value.trim().toLowerCase(); self.renderTable(); self.maybeFindZip(); } });
    controls.push(el("label", { class: "az-field az-only" }, [el("span", { text: "Search" }), this.search]));
    // Action buttons. Results (case studies and testimonials for the selected category, in a side panel) comes last and
    // stays available in the Trade area; the other buttons are hidden there (az-only).
    var exportBtn = exportMenu([
        { label: "Leave-behind (PDF)", note: "A clean page of this view to send after the meeting", run: function () { self.leaveBehind(); } },
        { label: "Data (CSV)", note: "The table's data for a spreadsheet", run: function () { self.exportCSV(); } }]);
    exportBtn.classList.add("az-only");
    controls.push(el("div", { class: "az-actions" }, [
      el("button", { type: "button", class: "az-btn az-only", text: "How scores work", onclick: function () { self.openMethod(); } }),
      cfg.crm === false ? null : el("button", { type: "button", class: "az-btn az-only", text: "Your CRM footprint",
        title: "Customer Analysis (CRM): upload the advertiser's customer list to see where its customers are against this market's potential, ZIP by ZIP",
        onclick: function () { location.href = self.crmUrl(); } }),
      // Results lives in the Trade area's Recommended allocation (shared/radius.js), matched to the plan's channels
      exportBtn
    ]));
    var controlBar = el("section", { class: "az-controls", "aria-label": "Analyzer controls" }, controls);
    this.notice = el("div", { class: "az-notice", hidden: true });
    if (cfg.notice) { this.notice.textContent = cfg.notice; this.notice.hidden = false; }

    // Map + detail
    this.mapHead = el("div", { class: "az-map-head" });
    this.mapMsg = el("div", { class: "az-map-msg", hidden: true });
    this.legend = el("div", { class: "az-legend", "aria-label": "Map legend" });
    this.mapEl = el("div", { class: "az-map", role: "region", "aria-label": "Map of markets" });
    this.detail = el("aside", { class: "az-panel az-detail", "aria-live": "polite" });
    var stage = el("section", { class: "az-stage" }, [
      el("div", { class: "az-panel az-map-panel" }, [this.mapEl, this.mapHead, this.legend, this.mapMsg]),
      this.detail
    ]);

    // Table
    this.tableTitle = el("h2");
    this.backBtn = el("button", { type: "button", class: "az-btn", hidden: true, onclick: function () { self.setLevel(self.state.parent.level); } });
    this.tableNote = el("span");
    this.thead = el("thead");
    this.tbody = el("tbody");
    // Pick several DMAs, metros or counties and open them together as one trade area (Custom area in the Trade area tool)
    this.pick = { level: null, ids: {} };
    this.pickBar = el("div", { class: "az-pickbar", hidden: true, role: "status" });
    this.tablePanel = el("section", { class: "az-panel az-table-panel" }, [
      this.crumbs = cfg.footprint ? el("nav", { class: "az-crumbs", "aria-label": "Where you are", hidden: true }) : null,
      el("div", { class: "az-table-head" }, [el("div", { class: "az-table-title" }, [this.tableTitle, this.backBtn]), this.tableNote]),
      this.pickBar,
      el("div", { class: "az-tablewrap" }, [el("table", { class: "az-table" }, [this.thead, this.tbody])])
    ]);

    // Sources
    var srcLinks = (cfg.sources || []).map(function (s, i) {
      return el("span", null, [i ? " · " : "", s.url ? el("a", { href: s.url, target: "_blank", rel: "noopener", text: s.label }) : s.label]);
    });
    this.sourcesNote = el("p", { text: cfg.sourcesNote || "" });
    var disclaimer = el("p", { class: "az-disclaimer", text: cfg.disclaimer || DISCLAIMER });
    var version = el("p", { class: "az-version", text: "Adtaxi Market Analyzers \u00b7 " + (cfg.version || VERSION) });
    var sources = el("section", { class: "az-panel az-sources" }, [el("h2", { text: "Sources" }), el("p", null, srcLinks), this.sourcesNote, disclaimer, version]);

    // Methodology dialog
    this.modalBody = el("div", { class: "az-modal-body" });
    this.modal = el("dialog", { class: "az-modal", "aria-labelledby": "az-method-title" }, [this.modalBody]);

    this.errorBox = el("div", { class: "az-error", role: "alert", hidden: true });
    this.adPanel = el("section", { class: "az-panel az-ad", hidden: true, "aria-live": "polite" });
    this.radiusBox = el("div", { class: "az-radius-embed", hidden: true });
    // Drill-down: breadcrumb and "rank inside" tabs, shown above the map when looking inside a market
    this.drillBar = cfg.drill ? el("section", { class: "az-drillbar", hidden: true, "aria-label": "Where you are" }) : el("div", { hidden: true });
    this.anaParts = [this.drillBar, stage, this.adPanel, this.tablePanel, sources];
    this.controlBar = controlBar;
    this.benchPanel = el("section", { class: "az-bench", hidden: true, "aria-live": "polite" });
    this.timingPanel = el("section", { class: "az-bench az-timing", hidden: true, "aria-live": "polite" });
    this.tab = "markets";
    this.startLine = GUIDE ? el("p", { class: "az-startline az-only" }, [el("b", { text: "Start here: " }), "choose a category, then click a market on the map or in the ranked list. " +
      (cfg.radius ? "Open Trade area to size a business's area and build its plan." : "")]) : null;
    this.tabParts = [controlBar, this.startLine, this.notice, this.errorBox, this.drillBar, stage, this.adPanel, this.tablePanel, sources, this.radiusBox];
    var main = el("main", { class: "az-main" }, [controlBar, this.startLine, this.notice, this.errorBox, this.drillBar, stage, this.adPanel, this.tablePanel, sources, this.radiusBox, this.benchPanel, this.timingPanel]);
    this.root.innerHTML = "";
    this.root.appendChild(header);
    this.root.appendChild(main);
    this.root.appendChild(this.modal);
    this.resultsBody = el("div", { class: "az-results-body" });
    this.resultsPanel = el("dialog", { class: "az-results", "aria-labelledby": "az-results-title" }, [this.resultsBody]);
    this.resultsPanel.addEventListener("click", function (e) { if (e.target === self.resultsPanel) self.resultsPanel.close(); });
    this.root.appendChild(this.resultsPanel);

    // Leaflet map with no tile basemap: the boundaries are the map.
    this.map = L.map(this.mapEl, { zoomControl: false, zoomSnap: 0.25, minZoom: 2, maxZoom: 10, attributionControl: true, worldCopyJump: false });
    L.control.zoom({ position: "topright" }).addTo(this.map);
    this.map.attributionControl.setPrefix(false);
    this.map.attributionControl.addAttribution(cfg.mapAttribution || "Boundaries: U.S. Census Bureau");
    this.map.fitBounds([[24.4, -125], [49.5, -66.9]]);
  };

  /* ---------- State changes ---------- */
  /* ---------- Radius view: the Zip Code Radius Tool inside the analyzer page ---------- */
  Analyzer.prototype.renderPick = function () {
    if (this.cfg.drill) return this.renderBasket();
    var self = this, s = this.state, cfg = this.cfg, ids = Object.keys(this.pick.ids), bar = this.pickBar;
    bar.innerHTML = "";
    if (!ids.length || PICK_PREFIX[s.level] == null) { bar.hidden = true; return; }
    var rows = this.sortedRows().filter(function (r) { return self.pick.ids[r.id]; }), pop = 0;
    rows.forEach(function (r) { pop += (r.v && r.v.population) || 0; });
    var noun = PICK_NOUN[s.level][ids.length === 1 ? 0 : 1];
    var names = rows.slice(0, 3).map(function (r) { return r.name; }).join("; ") + (rows.length > 3 ? "; and " + (rows.length - 3) + " more" : "");
    bar.hidden = false;
    bar.appendChild(el("p", null, [el("b", { text: NF0.format(ids.length) + " " + noun + " selected" }), ": " + names + (pop ? " · " + NF0.format(pop) + " people" : "")]));
    bar.appendChild(el("div", { class: "az-pickact" }, [
      el("button", { type: "button", class: "az-btn primary", text: "Open as trade area", title: "Count likely customers, rank ZIPs, split a budget and build a proposal for these " + PICK_NOUN[s.level][1] + " together",
        onclick: function () { self.openRadius({ mode: "area", ca: ids.map(function (id) { return PICK_PREFIX[s.level] + id; }).join(","), p: cfg.radiusProfiles ? s.sub : null }); } }),
      el("button", { type: "button", class: "az-btn", text: "Clear", onclick: function () { self.pick.ids = {}; self.renderPick(); self.renderTable(); } })]));
  };
  Analyzer.prototype.openRadius = function (opt) {
    var self = this, cfg = this.cfg, s = this.state; opt = opt || {};
    this.mode = "radius";
    this.guideCue();
    // Radius or custom area: a link or a ZIP's "Build a radius audience" button says which; the Trade area button keeps the last one used (Radius at first)
    var rmode = this.radiusMode = opt.mode === "area" ? "area" : opt.mode === "radius" || opt.zip ? "radius" : (this.radius ? this.radius.state.mode : "radius");
    this.anaParts.forEach(function (x) { x.hidden = true; });
    Array.prototype.forEach.call(this.controlBar.querySelectorAll(".az-only"), function (x) { x.hidden = true; });
    this.radiusBox.hidden = false;
    this.renderNav();
    Array.prototype.forEach.call(this.levelSeg.children, function (b) {
      if (b.getAttribute("data-level") === "zip") b.disabled = false;
    });
    this.syncRadiusTabs(opt.view || (this.radius ? this.radius.state.view : "area"));
    var preset = cfg.radiusProfiles && opt.p ? opt.p : null;   // no best-prospect preset unless asked for
    function go() {
      if (!self.radius) {
        var RC = cfg.radius === true ? window.ADTAXI_RADIUS : cfg.radius;   // the site's radius-config.js sets ADTAXI_RADIUS
        var rc = {}; for (var k in RC) rc[k] = RC[k];
        rc.embedded = true; rc.initial = { zip: opt.zip, r: opt.r, p: preset, mode: rmode, ca: opt.ca, hand: opt.hand, view: opt.view, carry: opt.carry };
        if (opt.carry) self.lastCarry = opt.carry.key;
        rc.onState = function () { self.writeHash(); };
        rc.onView = function (v) { self.syncRadiusTabs(v); self.writeHash(); };
        rc.context = function () { return { ad: cfg.adResponse, sub: self.state.sub,
          subLabel: self.subSel && self.subSel.selectedIndex >= 0 ? self.subSel.options[self.subSel.selectedIndex].text : "" }; };   // the proposal's ad-response reasons
        rc.onUpdate = function (ready) { self.radiusReady = ready; self.renderAd(); self.syncRadiusTabs(); };
        self.radius = window.AdtaxiRadius.start(rc, self.radiusBox);
      } else {
        if (preset) self.radius.usePreset(preset);
        if (self.radius.setMode) self.radius.setMode(rmode, opt.ca);
        if (opt.zip && rmode === "radius") self.radius.centerOn(opt.zip);
        if (opt.hand && self.radius.handoff) self.radius.handoff(opt.hand);
        if (opt.carry && self.radius.showCarry) { self.lastCarry = opt.carry.key; self.radius.showCarry(opt.carry); }
        if (self.radius.setView) self.radius.setView(opt.view === "plan" || opt.hand ? "plan" : "area");
        self.radius.resize();
      }
      self.writeHash();
      window.scrollTo(0, 0);
    }
    if (window.AdtaxiRadius) go();
    else {
      var sc = document.createElement("script"); sc.src = cfg.radiusScript || "../shared/radius.js?v=20261031d";   // version tag: browsers fetch the new file after an update
      sc.onload = go; sc.onerror = function () { self.showError("The radius tool didn't load. Refresh the page and try again."); };
      document.head.appendChild(sc);
    }
  };
  // Trade area and Plan buttons: which one is on, and Plan only once the trade area has ZIPs
  Analyzer.prototype.syncRadiusTabs = function (view) {
    var rad = this.mode === "radius", v = view || (this.radius ? this.radius.state.view : "area");
    var ready = !!(this.radius && this.radius.hasZips && this.radius.hasZips());
    Array.prototype.forEach.call(this.levelSeg.children, function (b) {
      var lv = b.getAttribute("data-level");
      if (lv === "radius") b.setAttribute("aria-pressed", String(rad && v !== "plan"));
      else if (lv === "plan") { b.setAttribute("aria-pressed", String(rad && v === "plan")); b.disabled = !ready; b.title = ready ? "Ad response, the recommended allocation and the proposal for this trade area" : "Build a trade area first; then see ad response, the recommended allocation and the proposal"; }
      else if (rad) b.setAttribute("aria-pressed", "false");
    });
    if (this.nav && this.nav.radius) this.nav.radius.setAttribute("aria-pressed", String(rad));
  };
  /* Carry the market views into the Trade area: areas ticked in the lists, or else the market selected or looked inside,
     plus the category's audience. Returns openRadius options (empty when nothing is selected). */
  Analyzer.prototype.carryOpt = function () {
    var s = this.state, cfg = this.cfg, self = this, tokens = [], label = "";
    if (cfg.drill && this.basket && this.basket.length) {
      tokens = this.basket.map(function (b) { return AREA_PREFIX[b.level] + b.id; });
      label = this.basket.length === 1 ? (this.marketName(this.basket[0]) || "1 selected area") : NF0.format(this.basket.length) + " selected areas";
    } else {
      // The market being looked inside (ZIPs or counties in market). A row merely highlighted in a national list isn't carried:
      // the lists open on the top-ranked market, which the rep may never have chosen.
      var f = s.parent && s.parent.level !== "territory" ? s.parent : null;
      if (f && f.level === "sel") { tokens = selIds(f).map(function (id) { return "d" + id; }); label = this.marketName(f); }
      else if (f && AREA_PREFIX[f.level]) { tokens = [AREA_PREFIX[f.level] + f.id]; label = this.marketName(f) || f.id; }
    }
    if (!tokens.length || !cfg.customArea && !(cfg.radius === true ? (window.ADTAXI_RADIUS || {}).customArea : (cfg.radius || {}).customArea)) return {};
    var sub = cfg.radiusProfiles && s.sub ? s.sub : null;
    var subLabel = this.subSel && this.subSel.selectedIndex >= 0 ? this.subSel.options[this.subSel.selectedIndex].text : "";
    return { mode: "area", ca: tokens.join(","), p: sub, carry: { key: tokens.join(",") + "|" + (sub || ""), label: label, sub: subLabel, ca: tokens.join(","), p: sub } };
  };
  // The Trade area button: the first time, start from the market views; later, offer to update if they changed
  Analyzer.prototype.openTradeArea = function () {
    var o = this.carryOpt();
    if (!this.radius) { this.openRadius(o.carry ? o : {}); return; }
    this.openRadius({});
    if (o.carry && o.carry.key !== this.lastCarry && this.radius.offerCarry) {
      var self = this;
      this.radius.offerCarry(o.carry, function () { self.lastCarry = o.carry.key; });
    }
  };
  Analyzer.prototype.closeRadius = function () {
    this.mode = null;
    this.guideCue();
    this.radiusBox.hidden = true;
    this.anaParts.forEach(function (x) { x.hidden = false; });
    Array.prototype.forEach.call(this.controlBar.querySelectorAll(".az-only"), function (x) { x.hidden = false; });
    this.adPanel.hidden = true;
    this.syncRadiusTabs();
    var m = this.map; setTimeout(function () { m.invalidateSize(); }, 0);
    this.refresh();
  };
  Analyzer.prototype.setLevel = function (lv) {
    var s = this.state;
    if (s.level === lv) return;
    var from = s.level;
    s.area = from === "zip" && s.parent && s.parent.level === lv ? s.parent.id : null;
    s.level = lv; s.sortKey = null;
    if (from === "zip") { s.query = ""; if (this.search) this.search.value = ""; this.resetView = true; }
    this.refresh();
  };
  // Guided: the start line shows on the market views only; once a market is picked, Trade area carries a small "Next" cue
  Analyzer.prototype.guideCue = function () {
    if (!GUIDE) return;
    var s = this.state, rad = this.mode === "radius";
    if (this.startLine) this.startLine.hidden = rad;
    var tb = this.levelSeg && this.levelSeg.querySelector('[data-level="radius"]');
    if (tb) tb.classList.toggle("az-cue", !!s.area && s.level !== "us" && !rad);
  };
  Analyzer.prototype.select = function (id, opts) {
    this.state.area = id;
    this.guideCue();
    this.renderDetail();
    this.highlight();
    this.markRow();
    this.writeHash();
    if (opts && opts.zoom && this.layerById && this.layerById[id]) {
      this.map.fitBounds(this.layerById[id].getBounds(), { maxZoom: 6, padding: [40, 40] });
    }
  };

  Analyzer.prototype.refresh = function (keepError) {
    var self = this, s = this.state;
    this.guideCue();
    // A ranking measure that isn't published at this level (e.g. a Metro-only layer) falls back to the default ranking.
    var rm = this.measure(s.rank), dm = this.measure(this.cfg.defaultRank);
    if (rm && dm && !this.availableAt(rm, s.level === "us" ? (this.cfg.usMapLevel || "dma") : s.level)) s.rank = this.cfg.defaultRank;
    // Ranking choices follow the selected category; one that doesn't apply falls back to the default ranking.
    if (rm && dm && !this.relevant(rm)) s.rank = this.cfg.defaultRank;
    var self0 = this, opts = (this.cfg.rankBy || []).filter(function (k) { var m = self0.measure(k); return !m || self0.relevant(m); });
    if (this.rankSel.getAttribute("data-opts") !== opts.join(",")) {
      this.rankSel.innerHTML = "";
      opts.forEach(function (k) { var m = self0.measure(k); self0.rankSel.appendChild(el("option", { value: k, text: m ? m.label : k })); });
      this.rankSel.setAttribute("data-opts", opts.join(","));
    }
    var drill = this.canDrill(), drillNav = !!this.cfg.drill;
    Array.prototype.forEach.call(this.levelSeg.children, function (b) {
      var lv = b.getAttribute("data-level");
      // With drill-down, inside a market only "ZIPs in market" stays lit (the bar above the map shows what is ranked)
      b.setAttribute("aria-pressed", drillNav && s.parent ? lv === "zip" && s.level === "zip" : lv === s.level);
      if (lv === "zip") { b.disabled = !drill; b.setAttribute("aria-disabled", !drill); }
    });
    if (this.subSel) this.subSel.value = s.sub;
    this.rankSel.value = s.rank;
    if (!keepError) this.errorBox.hidden = true;
    var mapLevel = s.level === "us" ? (this.cfg.usMapLevel || "dma") : s.level;
    var needed = [this.ensureLevel(s.level)];
    if (mapLevel !== s.level) needed.push(this.ensureLevel(mapLevel));
    var ticket = this.refreshTicket = (this.refreshTicket || 0) + 1;   // a newer refresh supersedes this one
    Promise.all(needed).then(function () {
      if (ticket !== self.refreshTicket) return;     // the view changed while this one was loading
      if (s.level !== "us" && !self.d(s.level)) return;
      self.mapLevel = mapLevel;
      if (s.level === "us") s.area = (self.data.us.rows[0] || {}).id;
      else if (!self.d(s.level).byId[s.area]) s.area = (self.sortedRows()[0] || {}).id || null;  // open on the top-ranked market
      Array.prototype.forEach.call(self.levelSeg.children, function (b) {
        if (b.getAttribute("data-level") === "zip") { var ok = self.canDrill(); b.disabled = !ok; b.setAttribute("aria-disabled", !ok); }
      });
      self.renderMap();
      self.renderTable();
      self.renderDetail();
      self.renderNav(); self.renderCrumbs(); self.renderDrillBar();
      self.renderAd();
      self.writeHash();
    }).catch(function (e) {
      if (ticket !== self.refreshTicket) return;     // a stale load failing doesn't matter
      self.errorBox.hidden = false;
      if (s.level === "zip" && s.parent) {
        // ZIP data for this market didn't load: step back to the market so the page stays usable.
        self.errorBox.textContent = "The ZIPs for this market couldn't be loaded (" + e.message + "). Showing the market instead; try again in a minute.";
        s.level = s.parent.level; s.area = s.parent.id;
        if (self.cfg.drill) { if (s.level === "sel") { s.level = "dma"; s.area = null; } s.parent = null; s.chain = []; }
        self.refresh(true);
        return;
      }
      self.errorBox.textContent = e.message + ". Refresh the page; if it keeps happening, the data files for this view are missing.";
    });
  };

  /* ---------- Ad response (optional, national survey data per category) ---------- */
  Analyzer.prototype.renderAd = function () {
    // Ad response comes at the end of the process: only in the Radius view, under the radius map, after a center and radius are chosen
    var A = this.cfg.adResponse, self = this;
    if (this.adPanel) this.adPanel.hidden = true;
    var rad = this.mode === "radius" && this.radius, box = rad && this.radius.extra;
    if (!box) return;
    if (!A || !this.radiusReady) { box.innerHTML = ""; box.hidden = true; return; }
    var rp = this.radius.state.profile;
    var d = A.subs && (A.subs[rp] || A.subs[this.state.sub]);
    if (!box.classList.contains("az-panel")) box.className = "rz-extra az-panel az-ad";
    box.innerHTML = "";
    if (!d) { var sp0 = this.spendPanel(); if (sp0) { box.hidden = false; box.appendChild(sp0); } else box.hidden = true; return; }
    box.hidden = false;
    // A blended audience (d.blend: several AudienceSCAN groups weighted by fit) keeps each group's figure for the row's hover text
    var rows = d.rows.map(function (r, i) { return { label: r[0], aud: r[1], us: r[2], diff: r[2] ? r[1] / r[2] - 1 : null,
      parts: (d.blend || []).map(function (g) { return g.short + " (" + Math.round(g.weight * 100) + "%): " + g.values[i] + "%"; }) }; });
    var sortKey = this.adSort || "aud";
    var pct = function (x) { return (Math.round(x * 10) / 10).toFixed(1) + "%"; };
    var dif = function (x) { var n = Math.round(Math.abs(x) * 100); return (n === 0 ? "" : x > 0 ? "+" : "−") + n + "%"; };
    var byAud = rows.slice().sort(function (a, b) { return b.aud - a.aud; });
    var byDiff = rows.slice().sort(function (a, b) { return b.diff - a.diff; });
    // Short names for AudienceSCAN's ad types (the full survey wording shows on hover)
    var SHORT = { "Ad on a social network": "Social", "Streaming TV advertising (such as Hulu, Pluto TV or YouTube TV)": "Streaming TV",
      "Ad on search results pages (like on Google, Yahoo or Bing)": "Search", "Mobile phone app or text message": "Mobile",
      "Television (traditional, including cable or satellite subscription)": "TV/Cable/Sat.", "Ad that plays before or during the video you want to watch": "Pre-roll",
      "Online display ads (banners and pop-up ads)": "Online display", "Emailed ad or newsletter": "Email", "Text link ad on a website": "Text link",
      "Ads/Coupons in your mailbox": "Direct mail", "Advertising circulars in your mailbox or inserted in the newspaper": "Circulars",
      "Radio (over-the-air, online, mobile or tablet)": "Radio", "Outdoor ad/sign/billboard/transit": "Outdoor", "Newspaper (print, online, mobile or tablet)": "Newspaper",
      "Ads at movie theater": "Movie theater", "Ad on a podcast": "Podcast", "Magazine (print, online, mobile or on tablet)": "Magazine" };
    var short = function (t) { return SHORT[t] || t.replace(/ \(.*\)$/, ""); };
    var list = function (a, f) { return a.map(function (r) { return short(r.label) + " (" + f(r) + ")"; }).join(", "); };
    var max = Math.max.apply(null, rows.map(function (r) { return r.aud; }));
    // Bars start above zero (10 points below the lowest value, rounded down to a multiple of 10, e.g. lowest about 40% -> axis starts at 30%) so differences between ad types stand out
    var min = Math.min.apply(null, rows.map(function (r) { return r.aud; }));
    var base = Math.max(0, Math.floor((min - 10) / 10) * 10);
    // Scale ends 10 points above the highest value, rounded up to a multiple of 10 (e.g. highest 60% -> scale ends at 70%)
    var top = Math.min(100, Math.ceil((max + 10) / 10) * 10);
    var barW = function (v) { return top > base ? Math.max(1, (v - base) / (top - base) * 100) : 100; };
    box.appendChild(el("div", { class: "az-ad-head" }, [
      el("div", null, [
        el("h2", { text: (A.title || "How likely customers respond to advertising").replace("{sub}", this.subLabel()).replace("{aud}", (d.short || "").toLowerCase()) }),
        el("p", { text: d.blend ? "Blended estimate of the percent of likely candidates, and of all U.S. adults, who saw or heard an ad on each medium that led them to take action in the past 30 days. Point to a row for each source group's figure." : d.audience ? "Percent of the target group (" + d.audience + ") and of all U.S. adults who saw or heard an ad on each medium that led them to take action in the past 30 days. Percentages are based on everyone in each group, not only people who use that medium." : "" })
      ]),
      el("div", { class: "az-seg", role: "group", "aria-label": "Sort ad types" }, [["aud", "Sort by response"], ["diff", "Sort by vs. average"]].map(function (o) {
        return el("button", { type: "button", "aria-pressed": String(sortKey === o[0]), text: o[1], onclick: function () { self.adSort = o[0]; self.renderAd(); } });
      }))
    ]));
    box.appendChild(el("div", { class: "az-ad-take" }, [
      el("p", null, [el("b", { text: "Highest response: " }), list(byAud.slice(0, 3), function (r) { return pct(r.aud); })])
    ]));
    // Two columns side by side (first 11 ad types on the left, the rest on the right) so the box stays short
    var ordered = sortKey === "diff" ? byDiff : byAud, SPLIT = 11;
    var colHead = function () {
      return el("div", { class: "az-ad-row az-ad-colhead", role: "row" }, [el("span", { role: "columnheader", text: "Type of ad" }), el("span", { role: "columnheader", text: "" }),
        el("span", { class: "num", role: "columnheader", text: d.short || "Audience" }), el("span", { class: "num", role: "columnheader", text: "Total" }), el("span", { class: "num", role: "columnheader", text: "Vs. average" })]);
    };
    var adRow = function (r, rank) {
      return el("div", { class: "az-ad-row", role: "row" }, [
        el("span", { class: "az-ad-label", role: "cell", title: r.label + (r.parts.length ? "\n" + r.parts.join("\n") : "") }, [el("span", { class: "az-ad-rank", text: rank + "." }), short(r.label)]),
        el("span", { class: "az-ad-bars", role: "cell", "aria-hidden": "true" }, [
          el("span", { class: "az-ad-bar aud", style: "width:" + barW(r.aud) + "%" })]),
        el("span", { class: "num", role: "cell", text: pct(r.aud) }),
        el("span", { class: "num muted", role: "cell", text: pct(r.us) }),
        el("span", { class: "num az-ad-diff", role: "cell", text: dif(r.diff) })
      ]);
    };
    var cols = el("div", { class: "az-ad-cols" });
    var parts = [ordered.slice(0, SPLIT), ordered.slice(SPLIT)];
    if (GUIDE && !this.adAll) parts = [ordered.slice(0, 5)];
    parts.forEach(function (part, c) {
      if (!part.length) return;
      var t = el("div", { class: "az-ad-rows", role: "table", "aria-label": "Advertising response by type of ad, " + (c ? (SPLIT + 1) + " to " + ordered.length : "1 to " + Math.min(SPLIT, ordered.length)) });
      t.appendChild(colHead());
      part.forEach(function (r, i) { t.appendChild(adRow(r, c * SPLIT + i + 1)); });
      cols.appendChild(t);
    });
    box.appendChild(cols);
    if (GUIDE && ordered.length > 5) box.appendChild(el("button", { type: "button", class: "az-showmore", text: this.adAll ? "Show less" : "Show all " + ordered.length,
      "aria-expanded": String(!!this.adAll), onclick: function () { self.adAll = !self.adAll; self.renderAd(); } }));
    var adNoteP = el("p", { class: "az-ad-note", text: (A.note || "") + (d.blendNote ? " " + d.blendNote : "") + " Bar scale runs from " + base + "% to " + top + "%" + (base > 0 ? ", not from zero, to make the differences easier to see." : ".") + (d.source ? " Source: " + d.source + "." : A.source ? " Source: " + A.source + "." : "") });
    box.appendChild(GUIDE ? el("details", { class: "az-ad-fold" }, [el("summary", { text: "About these figures" }), adNoteP]) : adNoteP);
    var sp = this.spendPanel(); if (sp) box.appendChild(sp);
  };

  /* ---------- Category ad spend (optional, national: digital vs. traditional and the digital breakout) ---------- */
  Analyzer.prototype.spendPanel = function () {
    var S = this.cfg.adSpend;
    if (!S || !S.digital || !S.formats) return null;
    var NS = "http://www.w3.org/2000/svg";
    var total = S.digital + S.traditional, dShare = S.digital / total;
    var money = function (x) { return "$" + (x >= 1 ? x.toFixed(1) : x.toFixed(2)) + "B"; };
    var pc = function (x) { return (Math.round(x * 1000) / 10).toFixed(1) + "%"; };
    // Donut: digital vs. traditional
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 120 120"); svg.setAttribute("class", "az-sp-donut"); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Digital " + pc(dShare) + ", traditional " + pc(1 - dShare) + " of " + money(total) + " total");
    var R = 46, C = 2 * Math.PI * R;
    [["#b9c6d3", 1, 0], ["var(--teal)", dShare, 0]].forEach(function (a) {
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", 60); c.setAttribute("cy", 60); c.setAttribute("r", R); c.setAttribute("fill", "none");
      c.setAttribute("stroke-width", 18); c.setAttribute("style", "stroke:" + a[0]);
      c.setAttribute("stroke-dasharray", (a[1] * C) + " " + C); c.setAttribute("transform", "rotate(-90 60 60)");
      svg.appendChild(c);
    });
    [["az-sp-big", 58, money(total)], ["az-sp-small", 74, "total"]].forEach(function (t) {
      var x = document.createElementNS(NS, "text");
      x.setAttribute("x", 60); x.setAttribute("y", t[1]); x.setAttribute("text-anchor", "middle"); x.setAttribute("class", t[0]);
      x.textContent = t[2]; svg.appendChild(x);
    });
    var left = el("div", { class: "az-sp-left" }, [svg, el("div", { class: "az-sp-legend" }, [
      el("p", null, [el("span", { class: "az-sp-key dig" }), el("b", { text: "Digital " + pc(dShare) }), " " + money(S.digital)]),
      el("p", null, [el("span", { class: "az-sp-key trad" }), el("b", { text: "Traditional " + pc(1 - dShare) }), " " + money(S.traditional)])
    ])]);
    // Digital breakout, largest first
    var f = S.formats.slice().sort(function (a, b) { return b.value - a.value; });
    var fmax = f[0].value;
    var rows = el("div", { class: "az-sp-rows", role: "table", "aria-label": "Digital ad spend by format" });
    f.forEach(function (r) {
      rows.appendChild(el("div", { class: "az-sp-row", role: "row" }, [
        el("span", { class: "az-sp-label", role: "cell" }, [r.label, r.sub ? el("small", { text: r.sub }) : null]),
        el("span", { class: "az-sp-bars", role: "cell", "aria-hidden": "true" }, [el("span", { class: "az-sp-bar", style: "width:" + Math.max(1, r.value / fmax * 100) + "%" })]),
        el("span", { class: "num", role: "cell", text: money(r.value) }),
        el("span", { class: "num muted", role: "cell", text: pc(r.value / S.digital) })
      ]));
    });
    var right = el("div", { class: "az-sp-right" }, [el("h3", { text: "Digital spend by format" }), rows,
      S.social ? el("p", { class: "az-sp-prog" }, [el("b", { text: "Social media: " + money(S.social) + " (" + pc(S.social / S.digital) + " of digital)," }), " " + (S.socialNote || "counted within display and video above.")]) : null,
      S.programmatic ? el("p", { class: "az-sp-prog" }, [el("b", { text: "Bought programmatically: about " + money(S.programmatic) + " (" + Math.round(S.programmatic / S.digital * 100) + "% of digital)." }), S.programmaticNote ? " " + S.programmaticNote : ""]) : null]);
    return el("div", { class: "az-sp" }, [
      el("div", { class: "az-ad-head" }, [el("div", null, [el("h2", { text: S.title || "How the category spends on advertising" }), S.intro ? el("p", { text: S.intro }) : null])]),
      el("div", { class: "az-sp-grid" }, [left, right]),
      S.note ? el("p", { class: "az-ad-note", text: S.note }) : null
    ]);
  };

  /* ---------- Map ---------- */
  Analyzer.prototype.breaks = function (values) {
    var v = values.filter(function (x) { return typeof x === "number" && isFinite(x); }).sort(function (a, b) { return a - b; });
    if (!v.length) return [];
    var q = [];
    for (var i = 1; i < 5; i++) q.push(v[Math.min(v.length - 1, Math.floor(v.length * i / 5))]);
    return q;
  };
  Analyzer.prototype.classOf = function (x, br) {
    if (typeof x !== "number" || !isFinite(x)) return -1;
    var c = 0; while (c < br.length && x >= br[c]) c++;
    return c;
  };
  Analyzer.prototype.renderMap = function () {
    var self = this, s = this.state, lv = this.mapLevel, L0 = this.cfg.levels[lv];
    var m = this.measure(s.rank), d = this.d(lv);
    var fc = this.geo[lv === "zip" ? this.url(L0.geo) : L0.geo];
    var idField = L0.idField;
    var inside = lv === "zip" || ((lv === "county" || lv === "metro") && this.key(lv) !== lv);   // a market's metros, counties or ZIPs
    var usSolid = !!this.cfg.drill && s.level === "us";   // the U.S. view: one color for the national total, not the DMA shading
    if (fc && (lv === "county" || lv === "metro") && inside) fc ={ type: "FeatureCollection", features: fc.features.filter(function (f) { return d.byId[String(f.properties[idField])]; }) };
    var values = d.rows.map(function (r) { return self.val(r, m); });
    var br = this.breaks(values);
    this.currentBreaks = br;
    var colors = RAMP.map(cssVar);
    if (this.areaLayer) this.map.removeLayer(this.areaLayer);
    if (this.stateLayer) this.map.removeLayer(this.stateLayer);
    if (this.parentLayer) { this.map.removeLayer(this.parentLayer); this.parentLayer = null; }
    if (this.pointsLayer) { this.map.removeLayer(this.pointsLayer); this.pointsLayer = null; }
    this.layerById = {};
    this.mapMsg.hidden = true;
    if (!fc) {
      this.areaLayer = null;
      this.mapMsg.hidden = false;
      this.mapMsg.textContent = "ZIP boundaries for this market aren't available yet. The rankings below still work.";
    }
    this.areaLayer = fc && L.geoJSON(fc, {
      style: function (f) {
        if (usSolid) return { color: US_FILL, weight: 0.6, fillOpacity: 1, fillColor: US_FILL };
        var row = d.byId[String(f.properties[idField])];
        var c = self.classOf(row ? self.val(row, m) : null, br);
        return { color: "#ffffff", weight: 0.8, fillOpacity: 1, fillColor: c < 0 ? cssVar("--nodata") : colors[c] };
      },
      onEachFeature: function (f, layer) {
        var id = String(f.properties[idField]), row = d.byId[id];
        self.layerById[id] = layer;
        var name = row ? row.name + (row.t ? " (" + row.t.toLowerCase() + ")" : "") : (f.properties.dma_name || f.properties.NAME || id);
        if (!row && lv === "zip") name = "ZIP " + id;
        var v = row ? fmt(self.val(row, m), m.format) : null;
        if (v != null) v += self.mark(row, m);
        layer.bindTooltip(function () {
          if (usSolid) return '<div class="az-tip"><b>' + name + "</b><br>Click to see how this DMA ranks</div>";
          return '<div class="az-tip"><b>' + name + "</b><br>" + (m ? m.label : "") + ": " + (v == null ? "No data" : v) + "</div>";
        }, { sticky: true, direction: "top", opacity: 0.97 });
        layer.on("click", function () {
          if (!row) return;
          if (s.level === "us") { self.state.level = lv; self.state.area = id; self.refresh(); return; }
          self.select(id);
        });
      }
    });
    if (this.areaLayer) this.areaLayer.addTo(this.map);
    if (inside) {
      var P = this.cfg.levels[s.parent.level === "sel" ? "dma" : s.parent.level], pfc = this.geo[P.geo], pids = selIds(s.parent).map(String);
      var pfs = pfc && pfc.features.filter(function (f) { return pids.indexOf(String(f.properties[P.idField])) >= 0; });
      var pf = pfs && pfs.length ? { type: "FeatureCollection", features: pfs } : null;
      if (pf) this.parentLayer = L.geoJSON(pf, { interactive: false, style: { color: "#0f2742", weight: 2.5, dashArray: "6 5", fill: false } }).addTo(this.map);
      var b = (this.areaLayer && this.areaLayer.getBounds().isValid()) ? this.areaLayer.getBounds() : (this.parentLayer && this.parentLayer.getBounds());
      if (b && b.isValid() && this.parentLayer && this.parentLayer.getBounds().isValid()) b = L.latLngBounds(b.getSouthWest(), b.getNorthEast()).extend(this.parentLayer.getBounds());
      if (b && b.isValid()) this.map.fitBounds(b, { paddingTopLeft: [24, 80], paddingBottomRight: [24, 24] });   // room for the map heading
    } else if (this.resetView) {
      this.map.fitBounds([[24.4, -125], [49.5, -66.9]]);
    }
    this.resetView = false;
    var mesh = this.cfg.statesGeo && this.geo[this.cfg.statesGeo];
    if (mesh) this.stateLayer = L.geoJSON(mesh, { interactive: false, style: { color: "#0f2742", weight: 1.1, opacity: 0.55, fill: false } }).addTo(this.map);
    this.highlight();
    // Header and legend
    this.mapHead.innerHTML = "";
    this.mapHead.appendChild(el("b", { text: (m ? m.label : "") + (m && m.perSub && this.subLabel() ? ": " + this.subLabel() : "") }));
    this.mapHead.appendChild(el("span", { text: usSolid ? "United States total. Click a DMA, or see the DMAs ranked below." :
      inside ? (lv === "zip" ? "ZIPs" : lv === "metro" ? "Metros" : "Counties") + " in " + this.parentName() + ", ranked within this market." :
      "By " + this.levelLabel(lv) + (s.level === "us" ? ". Click a market to rank at that level." : ". Click a market for details.") }));
    (this.ptLayers || []).forEach(function (P0) {
      var pm = self.measure(P0.key);
      if (pm && !self.relevant(pm)) return;      // no toggle for a category without that count
      var box = el("input", { type: "checkbox", onchange: function () { s.pts[P0.key] = this.checked; self.renderPoints(d); self.writeHash(); } });
      box.checked = !!s.pts[P0.key];
      var lab = [box, " "];
      if (P0.color) lab.push(el("span", { class: "az-pt-dot", style: "background:" + P0.color }));
      lab.push(" " + (P0.label || "Show locations"));
      self.mapHead.appendChild(el("label", { class: "az-pt-toggle" }, lab));
    });
    this.legend.innerHTML = "";
    if (usSolid) {
      this.legend.appendChild(el("div", { class: "az-legend-row" }, [el("span", { class: "az-swatch", style: "background:" + US_FILL }), el("span", { text: "U.S. total" })]));
      this.renderPoints(d);
      return;
    }
    if (br.length) {
      var lo = values.filter(function (x) { return typeof x === "number"; });
      var bounds = [Math.min.apply(null, lo)].concat(br).concat([Math.max.apply(null, lo)]);
      // Close values can round to the same whole number ("43 – 43"); show one decimal for those legends
      var lab = function (x) { return fmt(x, m.format); };
      if (["score", "index", "int", undefined].indexOf(m.format) >= 0 && bounds.some(function (x, j) { return j > 0 && lab(x) === lab(bounds[j - 1]); }))
        lab = function (x) { return NF1.format(x); };
      for (var i = 4; i >= 0; i--) {
        this.legend.appendChild(el("div", { class: "az-legend-row" }, [
          el("span", { class: "az-swatch", style: "background:" + colors[i] }),
          el("span", { class: "num", text: lab(bounds[i]) + " – " + lab(bounds[i + 1]) })
        ]));
      }
    }
    this.legend.appendChild(el("div", { class: "az-legend-row" }, [el("span", { class: "az-swatch nodata" }), el("span", { text: lv === "zip" ? "Not ranked or no data" : "No data" })]));
    this.renderPoints(d);
  };
  // Optional overlay: a circle on each area sized by a count (e.g. competing businesses), switched on and off by the user
  Analyzer.prototype.renderPoints = function (d) {
    var self = this, s = this.state;
    if (this.pointsLayer) { this.map.removeLayer(this.pointsLayer); this.pointsLayer = null; }
    (this.ptLegends || []).forEach(function (x) { x.remove(); }); this.ptLegends = [];
    if (!this.layerById) return;
    var layers = (this.ptLayers || []).filter(function (P0) { var m = self.measure(P0.key); return s.pts && s.pts[P0.key] && m && self.relevant(m); });
    if (!layers.length) return;
    // One size scale across the layers that are on, so a bank circle and a credit union circle of the same size mean the same count
    var pts = [], max = 0;
    layers.forEach(function (P0) {
      var m = self.measure(P0.key);
      Object.keys(self.layerById).forEach(function (id) {
        var row = d.byId[id], v = row ? self.val(row, m) : null;
        if (typeof v !== "number" || v <= 0) return;
        var b = self.layerById[id].getBounds(); if (!b.isValid()) return;
        pts.push([b.getCenter(), v, row.name, P0, m]); if (v > max) max = v;
      });
    });
    var big = this.mapLevel === "zip" ? 16 : 22;
    pts.sort(function (a, b) { return b[1] - a[1]; });   // big circles first, so small ones stay clickable on top
    this.pointsLayer = L.layerGroup(pts.map(function (p) {
      var r = Math.max(2.5, Math.sqrt(p[1] / max) * big), P0 = p[3];
      return L.circleMarker(p[0], { radius: r, color: "#ffffff", weight: 1, fillColor: P0.color || cssVar("--pt") || "#e07b24", fillOpacity: 0.85 })
        .bindTooltip('<div class="az-tip"><b>' + p[2] + "</b><br>" + fmt(p[1], p[4].format) + " " + (P0.unit || "") + "</div>", { direction: "top", opacity: 0.97 });
    })).addTo(this.map);
    layers.forEach(function (P0) {
      var row = el("div", { class: "az-legend-row az-pt-legend" }, [el("span", { class: "az-pt-dot", style: P0.color ? "background:" + P0.color : null }),
        el("span", { text: (P0.legend || "Circle size = count") + (self.mapLevel === "zip" && P0.zipNote ? " " + P0.zipNote : "") })]);
      self.legend.appendChild(row); self.ptLegends.push(row);
    });
  };
  Analyzer.prototype.highlight = function () {
    var self = this;
    if (!this.layerById) return;
    var usSolid = !!this.cfg.drill && this.state.level === "us";
    Object.keys(this.layerById).forEach(function (id) {
      var sel = id === self.state.area && self.state.level === self.mapLevel;
      var lyr = self.layerById[id];
      if (usSolid) { lyr.setStyle({ color: US_FILL, weight: 0.6 }); return; }
      lyr.setStyle({ color: sel ? "#0f2742" : "#ffffff", weight: sel ? 3 : 0.8 });
      if (sel) lyr.bringToFront();
    });
    if (this.stateLayer) this.stateLayer.bringToFront();
  };

  /* ---------- Table ---------- */
  Analyzer.prototype.columns = function () {
    var self = this, lv = this.tableLevel();
    var keys = this.cfg.tableColumns || this.cfg.measures.map(function (m) { return m.key; });
    return keys.map(function (k) { return self.measure(k); }).filter(function (m) { return m && self.availableAt(m, lv) && self.relevant(m); });
  };
  Analyzer.prototype.sortedRows = function () {
    var self = this, s = this.state, d = this.d(this.tableLevel());
    var key = s.sortKey || s.rank, m = this.measure(key), dir = s.sortKey ? s.sortDir : (m && m.lowerIsBetter ? "asc" : "desc");
    var rows = d.rows.slice(), t = this.tieMeasure(m);
    rows.sort(function (a, b) {
      var x = self.val(a, m), y = self.val(b, m);
      var xn = typeof x !== "number", yn = typeof y !== "number";
      if (xn && yn) return a.name.localeCompare(b.name);
      if (xn) return 1; if (yn) return -1;          // no data always sorts last
      if (x === y && t) { var tx = self.tieVal(a, t), ty = self.tieVal(b, t); if (tx !== ty) return dir === "asc" ? tx - ty : ty - tx; }
      return dir === "asc" ? x - y : y - x;
    });
    return rows;
  };
  Analyzer.prototype.renderTable = function () {
    var self = this, s = this.state, drillNav = !!this.cfg.drill, tl = this.tableLevel();
    if (s.level === "us" && !drillNav) {
      this.tablePanel.hidden = true;
      return;
    }
    this.tablePanel.hidden = this.mode === "radius";   // stays hidden behind the Radius view
    var cols = this.columns(), rankM = this.measure(s.rank);
    var all = this.sortedRows();
    // Rank numbers follow the "rank by" measure, independent of column sorting.
    var rankOrder = s.sortKey ? (function () { var k = s.sortKey; s.sortKey = null; var r = self.sortedRows(); s.sortKey = k; return r; })() : all;
    // Equal values share a rank (1, 2, 2, 4), the same way the market panel counts rank and ties
    var rankOf = {}, n = 0, prevV = null, prevT = null, prevR = 0, tieM = this.tieMeasure(rankM);
    rankOrder.forEach(function (r) {
      var x = self.val(r, rankM); if (typeof x !== "number") return; n++;
      var t = self.tieVal(r, tieM);
      if (x !== prevV || t !== prevT) { prevR = n; prevV = x; prevT = t; }
      rankOf[r.id] = prevR;
    });
    var rows = all.filter(function (r) { return !s.query || r.name.toLowerCase().indexOf(s.query) >= 0; });
    var shown = s.show && !s.query ? rows.slice(0, s.show) : rows;
    var isZip = tl === "zip", lvLabel = isZip ? "ZIP" : this.levelLabel(tl);
    var inCounties = tl === "county" && this.key("county") !== "county", inMetros = tl === "metro" && this.key("metro") !== "metro", fp = !!this.cfg.footprint;
    var natTitle = fp ? lvLabel + "s nationally" : drillNav ? (tl === "county" ? "Counties" : lvLabel + "s") + " ranked" : lvLabel + " rankings";
    this.tableTitle.textContent = (isZip ? "ZIPs in " + this.parentName() : inCounties ? "Counties in " + this.parentName() : inMetros ? "Metros in " + this.parentName() : natTitle) + (this.subLabel() ? ": " + this.subLabel() : "");
    this.backBtn.hidden = !isZip || fp || drillNav;
    this.search.placeholder = isZip ? "Find a ZIP or town" : "Find a market";
    if (isZip) this.backBtn.textContent = "Back to " + LEVEL_LABELS[s.parent.level] + " rankings";
    this.tableNote.textContent = "Showing " + NF0.format(shown.length) + " of " + NF0.format(all.length) + (isZip ? " ZIPs" : inCounties ? " counties" : inMetros ? " metros" : drillNav ? { dma: " DMAs", metro: " metros", county: " counties" }[tl] || " markets" : " markets") + ", ranked by " + (rankM ? rankM.label.toLowerCase() : "") + ". Click a column to sort.";

    this.thead.innerHTML = "";
    var cfg = this.cfg, RCf = cfg.radius === true ? window.ADTAXI_RADIUS : cfg.radius;
    // Tick boxes: with drill-down, any list (DMAs, metros, counties, ZIPs) adds to one combined area that lasts across views
    var pickable = !!(RCf && RCf.customArea) && (drillNav ? AREA_PREFIX[tl] != null : PICK_PREFIX[s.level] != null);
    if (!drillNav && this.pick.level !== s.level) this.pick = { level: s.level, ids: {} };
    var mkCol = drillNav && !!s.parent && s.parent.level === "sel";   // several DMAs: which DMA each row is in
    var hr = el("tr", null, [pickable ? el("th", { scope: "col", class: "az-pickcol", title: drillNav ? "Add to a combined trade area" : "Select markets to combine into one trade area" }, [el("span", { class: "az-visually-hidden", text: "Select" })]) : null,
      el("th", { scope: "col", text: "Rank" }), el("th", { scope: "col", text: lvLabel }), mkCol ? el("th", { scope: "col", class: "az-mkcol", text: "DMA" }) : null]);
    var inCol = (fp || drillNav) && !isZip && this.cfg.levels.zip;   // "Inside" button: a DMA or metro's counties, a county's ZIPs
    cols.forEach(function (m) {
      var active = (s.sortKey || s.rank) === m.key;
      var dir = s.sortKey ? s.sortDir : (m.lowerIsBetter ? "asc" : "desc");
      hr.appendChild(el("th", { scope: "col", "aria-sort": active ? (dir === "asc" ? "ascending" : "descending") : null, title: m.help || null }, [
        el("button", { type: "button", text: m.short || m.label, onclick: function () {
          if (s.sortKey === m.key) s.sortDir = s.sortDir === "desc" ? "asc" : "desc";
          else { s.sortKey = m.key; s.sortDir = m.lowerIsBetter ? "asc" : "desc"; }
          self.renderTable();
        } })
      ]));
    });
    if (inCol) hr.appendChild(el("th", { scope: "col", class: "az-incol", text: "Look inside" }));
    this.thead.appendChild(hr);

    var frag = document.createDocumentFragment(), anyMark = false;
    // On the U.S. view (drill-down) a DMA row opens the DMA view with that DMA selected
    var choose = function (id) { if (tl !== s.level) { s.level = tl; s.area = id; s.sortKey = null; s.query = ""; self.search.value = ""; self.refresh(); } else self.select(id, { zoom: true }); };
    shown.forEach(function (r) {
      var tr = el("tr", { tabindex: "0", "data-id": r.id, "aria-selected": r.id === s.area ? "true" : "false",
        onclick: function () { choose(r.id); },
        onkeydown: function (e) { if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(r.id); } } }, [
        pickable ? el("td", { class: "az-pickcol", onclick: function (e) { e.stopPropagation(); } }, [el("input", { type: "checkbox", "aria-label": (drillNav ? "Add to combined area: " : "Select ") + r.name,
          checked: (drillNav ? self.inBasket(tl, r.id) : self.pick.ids[r.id]) ? "checked" : null, onchange: function () {
            if (drillNav) { self.toggleBasket(tl, r.id, r, this.checked); return; }
            if (this.checked) self.pick.ids[r.id] = 1; else delete self.pick.ids[r.id]; self.renderPick(); } })]) : null,
        el("td", { class: "az-rank num", text: rankOf[r.id] ? String(rankOf[r.id]) : "–" }),
        el("td", null, [r.name, r.t ? el("span", { class: "az-tag", title: (r.f && r.f[0]) || null, text: r.t }) : null]),
        mkCol ? el("td", { class: "az-mkcol", text: r.mk || "" }) : null
      ]);
      cols.forEach(function (m) {
        var v = fmt(self.val(r, m), m.format);
        if (v == null && r.u && (m.key === s.rank || m.key.indexOf("score") === 0 || m.key.indexOf("p_") === 0)) tr.appendChild(el("td", { class: "az-na", title: (r.f && r.f[0]) || "Not ranked", text: "Not ranked" }));
        else if (v == null) tr.appendChild(el("td", { class: "az-na", title: "No data for this area", text: "No data" }));
        else { var mk = self.mark(r, m); if (mk) anyMark = true; tr.appendChild(el("td", { class: "num", title: mk ? "Uses estimated values; see this market's Data notes" : null, text: v + mk })); }
      });
      if (inCol && drillNav) tr.appendChild(el("td", { class: "az-incol" }, [el("button", { type: "button", class: "az-inbtn", text: tl === "county" ? "ZIPs \u203a" : "Look inside \u203a",
        title: tl === "county" ? "Rank the ZIPs in " + r.name : "Rank the " + (tl === "dma" ? "metros, " : "") + "counties and ZIPs in " + self.areaName(tl, r), onclick: function (e) { e.stopPropagation(); self.lookInside(tl, r.id); } })]));
      else if (inCol) tr.appendChild(el("td", { class: "az-incol" }, [el("button", { type: "button", class: "az-inbtn", text: s.level === "county" ? "ZIPs \u203a" : "Counties \u203a",
        title: (s.level === "county" ? "Rank the ZIPs in " : "Rank the counties and ZIPs in ") + r.name, onclick: function (e) { e.stopPropagation(); self.openInside(r.id); } })]));
      frag.appendChild(tr);
    });
    this.tbody.innerHTML = "";
    if (!shown.length) { var emptyTd = el("td", { colspan: String(cols.length + (pickable ? 3 : 2) + (inCol ? 1 : 0) + (mkCol ? 1 : 0)), class: "az-empty", text: "No markets match \u201c" + s.query + "\u201d. Clear the search to see all markets." });
      this.tbody.appendChild(el("tr", null, [emptyTd])); if (s.query) this.countySuggest(s.query, emptyTd); }
    this.tbody.appendChild(frag);
    if (anyMark) this.tableNote.textContent += " * Uses estimated health values; select the market and see its Data notes.";
    if (pickable) this.tableNote.textContent += drillNav ? " Tick boxes in any list (DMAs, metros, counties or ZIPs) to combine them into one trade area." : " Tick several to open them together as one trade area.";
    this.renderPick();
  };
  Analyzer.prototype.markRow = function () {
    var id = this.state.area, sel = null;
    Array.prototype.forEach.call(this.tbody.children, function (tr) {
      var on = tr.getAttribute("data-id") === id; tr.setAttribute("aria-selected", on ? "true" : "false"); if (on) sel = tr;
    });
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest" });
  };

  /* ---------- Detail ---------- */
  Analyzer.prototype.renderDetail = function () {
    var self = this, s = this.state, cfg = this.cfg, box = this.detail;
    box.innerHTML = "";
    var d = this.d(s.level), row = d && d.byId[s.area];
    if (!row) {
      box.appendChild(el("h2", { text: "Pick a market" }));
      box.appendChild(el("p", { class: "az-empty", text: "Click a market on the map or in the rankings to see its score and the numbers behind it." }));
      return;
    }
    var lvLabel = s.level === "zip" ? "ZIP in " + this.parentName() : this.levelLabel(s.level);
    box.appendChild(el("div", null, [el("h2", null, [s.level === "zip" ? "ZIP " + row.name : row.name, row.t ? el("span", { class: "az-tag", text: row.t }) : null]), el("div", { class: "az-sub", text: lvLabel + (this.subLabel() ? " · " + this.subLabel() : "") })]));

    var head = this.measure(cfg.headlineMeasure || s.rank);
    // Rank among the other markets at this level (ties share the better rank); null at the U.S. level or with no value
    var metroIn = s.level === "metro" && this.key("metro") !== "metro";
    var LEVEL_PLURAL = { territory: "territories", dma: "DMAs", metro: metroIn ? (s.parent.level === "sel" ? "metros in these DMAs" : "metros in this DMA") : "metros", county: this.key("county") !== "county" && s.level === "county" ? "counties in this market" : "counties", zip: "ZIPs in this market" };
    var rankOf = function (m, v) {
      if (s.level === "us" || typeof v !== "number") return null;
      var vals = [], tm = self.tieMeasure(m), tv = self.tieVal(row, tm), better = 0, ties = 0;
      d.rows.forEach(function (r) {
        var x = self.val(r, m); if (typeof x !== "number") return;
        vals.push(x);
        if (m.lowerIsBetter ? x < v : x > v) better++;
        else if (x === v && r !== row) { var t = self.tieVal(r, tm); if (t > tv) better++; else if (t === tv) ties++; }
      });
      return { rank: better + 1, total: vals.length, vals: vals, ties: ties };
    };
    if (head && this.availableAt(head, s.level)) {
      var hv = this.val(row, head), hr = rankOf(head, hv), hvText = fmt(hv, head.format);
      if (hv == null && row.u) {
        box.appendChild(el("div", { class: "az-score" }, [el("b", { class: "num", text: "—" }), el("span", { text: "Not ranked" })]));
      } else if (hr) {
        // Rank first: "#1 of 210 DMAs", then the value with reference points (the best or next best, and the typical market)
        var sorted = hr.vals.slice().sort(function (a, b) { return head.lowerIsBetter ? a - b : b - a; });
        var mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
        var lvNoun = LEVEL_PLURAL[s.level] || "markets";
        var typical = s.level === "zip" ? "typical ZIP here " : "typical " + (s.level === "county" ? (this.key("county") !== "county" ? "county here" : "county") : s.level === "metro" ? (metroIn ? "metro here" : "metro") : s.level === "territory" ? "territory" : "DMA") + " ";
        var ties = hr.ties;
        var nextBest = sorted.filter(function (x) { return x !== hv; })[0];
        var ref = hr.rank === 1 ? (nextBest != null ? "next best " + fmt(nextBest, head.format) : null) : "#1 " + (head.format === "score" ? "scores " : "is ") + fmt(sorted[0], head.format);
        box.appendChild(el("div", { class: "az-score az-rankhead" }, [
          el("b", { class: "num", text: "#" + NF0.format(hr.rank) }),
          el("span", { class: "az-rank-of", text: "of " + NF0.format(hr.total) + " " + lvNoun + (ties ? ", tied with " + NF0.format(ties) + (ties === 1 ? " other" : " others") : "") })
        ]));
        box.appendChild(el("p", { class: "az-score-line", text: [head.label + " " + (hvText == null ? "—" : hvText + self.mark(row, head)), ref, typical + fmt(mid, head.format)].filter(Boolean).join(" · ") }));
      } else {
        box.appendChild(el("div", { class: "az-score" }, [el("b", { class: "num", text: hvText == null ? "—" : hvText + self.mark(row, head) }), el("span", { text: head.label })]));
      }
    }

    var comps = (cfg.components || []).map(function (k) { return self.measure(k); }).filter(function (m) { return m && self.availableAt(m, s.level) && self.relevant(m); });
    if (comps.length) {
      // Each part: a plain-word rating by fifths of the markets, plus its rank. Competition ranks best where there are fewest
      // competitors, so it gets its own words (light to heavy) rather than "very high" meaning little competition.
      var WORDS = ["Very high", "High", "Average", "Low", "Very low"], COMP_WORDS = ["Very light", "Light", "Average", "Heavy", "Very heavy"];
      var anyRank = false;
      box.appendChild(el("div", { class: "az-bars" }, comps.map(function (m) {
        var v = self.val(row, m), ok = typeof v === "number", r = ok ? rankOf(m, v) : null;
        var isComp = m.key === "comp" || /^comp(@|$)/.test(m.key);
        var right, width = ok ? Math.max(0, Math.min(100, v)) : 0;
        if (r && r.total > 1) {
          anyRank = true;
          var fifth = Math.min(4, Math.floor((r.rank - 1) / r.total * 5));
          right = el("span", { class: "az-bar-rate" }, [
            el("span", { class: "az-rate az-rate-" + fifth, text: (isComp ? COMP_WORDS : WORDS)[fifth] }),
            el("b", { class: "num", text: "#" + NF0.format(r.rank) })
          ]);
          width = Math.max(2, (r.total - r.rank + 1) / r.total * 100);   // bar shows rank position: #1 is a full bar
        } else right = el("b", { class: "num" + (ok ? "" : " az-na"), text: ok ? fmt(v, m.format) + self.mark(row, m) : "No data" });
        return el("div", { title: m.help || null }, [
          el("div", { class: "az-bar-label" }, [el("span", { text: m.label }), right]),
          el("div", { class: "az-track" }, [el("div", { class: "az-fill", style: "width:" + width + "%" })])
        ]);
      })));
      if (anyRank) box.appendChild(el("p", { class: "az-bars-note", text: "Ranks among " + (LEVEL_PLURAL[s.level] ? NF0.format(d.rows.filter(function (r) { return typeof self.val(r, comps[0]) === "number"; }).length) + " " + LEVEL_PLURAL[s.level] : "these markets") + ". Very high is the top 20%." +
        (comps.some(function (m) { return m.key === "comp"; }) ? " Competition ranks best where there are fewest competitors " + (self.cfg.compBasis || "per resident") + "." : "") }));
    }

    var details = (cfg.detailMeasures || []).map(function (k) { return self.measure(k); }).filter(function (m) { return m && self.relevant(m); });
    if (details.length) {
      box.appendChild(el("div", { class: "az-measures" }, details.map(function (m) {
        if (!self.availableAt(m, s.level) && m.hideWhenUnavailable) return null;
        if (!self.availableAt(m, s.level)) return el("div", { class: "az-measure", title: m.help || null }, [el("span", { text: m.label }), el("b", { class: "az-na", text: "Not available at this level" })]);
        var v = fmt(self.val(row, m), m.format);
        // "e" lists measures filled in for this area rather than taken from the current source release
        var mk = v != null ? self.mark(row, m) : "";
        return el("div", { class: "az-measure", title: (mk ? "Estimated for this area; see Data notes. " : "") + (m.help || "") || null }, [el("span", { text: m.label }), el("b", { class: "num" + (v == null ? " az-na" : ""), text: v == null ? "No data" : v + mk })]);
      })));
    }
    if (cfg.drill && s.level !== "us") {
      // Look inside this market (metros, counties and ZIPs inside a DMA; counties and ZIPs inside a metro; ZIPs inside a county), and add it to the combined area
      var RCd = cfg.radius === true ? window.ADTAXI_RADIUS : cfg.radius, isIn = this.inBasket(s.level, row.id);
      var nm = this.areaName(s.level, row);
      if (s.level !== "zip" && this.cfg.levels.zip) box.appendChild(el("button", { type: "button", class: "az-btn primary az-drill",
        text: s.level === "county" ? "Rank the ZIPs in this county" : "Look inside: rank its " + (s.level === "dma" ? "metros, " : "") + "counties and ZIPs", onclick: function () { self.lookInside(s.level, row.id); } }));
      if (RCd && RCd.customArea) box.appendChild(el("button", { type: "button", class: "az-btn az-drill", text: isIn ? "Remove from combined area" : "Add to combined area",
        title: isIn ? "Take " + nm + " out of the combined trade area" : "Add " + nm + " to a combined trade area with other DMAs, metros, counties or ZIPs", onclick: function () { self.toggleBasket(s.level, row.id, row, !isIn); } }));
    } else if (cfg.footprint && s.level !== "zip" && this.cfg.levels.zip) {
      box.appendChild(el("button", { type: "button", class: "az-btn primary az-drill", text: s.level === "county" ? "Rank the ZIPs in this county" : "Rank the counties and ZIPs in this market", onclick: function () { self.openInside(row.id); } }));
    } else if (this.cfg.levels.zip && this.drillable(s.level)) {
      box.appendChild(el("button", { type: "button", class: "az-btn primary az-drill", text: "See ZIPs in this market", onclick: function () { self.drill(); } }));
    }
    if (s.level === "zip") {
      if (cfg.radius) box.appendChild(el("button", { type: "button", class: "az-btn primary az-drill", onclick: function () { self.openRadius({ zip: row.id, p: cfg.radiusProfiles ? self.state.sub : null }); },
        text: cfg.radiusProfiles && this.subLabel() ? "Find likely customers around this ZIP" : "Build a radius audience from this ZIP" }));
      else if (cfg.radiusPage) box.appendChild(el("a", { class: "az-btn primary az-drill", href: cfg.radiusPage + "#zip=" + encodeURIComponent(row.id) + "&r=" + (cfg.radiusDefault || 10) + (cfg.radiusProfiles && this.state.sub ? "&p=" + encodeURIComponent(this.state.sub) : ""),
        text: cfg.radiusProfiles && this.subLabel() ? "Find likely customers around this ZIP" : "Build a radius audience from this ZIP" }));
      if (!cfg.footprint && !cfg.drill) box.appendChild(el("button", { type: "button", class: "az-btn az-drill", text: "Back to " + this.parentName(), onclick: function () { self.setLevel(s.parent.level); } }));
    }
    if (row.f && row.f.length) box.appendChild(el("div", { class: "az-flags" }, [el("b", { text: "Data notes" }), el("ul", null, row.f.map(function (t) { return el("li", { text: t }); }))]));
  };

  /* ---------- Methodology + export ---------- */
  Analyzer.prototype.openMethod = function () {
    var self = this, b = this.modalBody;
    b.innerHTML = "";
    b.appendChild(el("button", { type: "button", class: "az-modal-close", "aria-label": "Close", text: "×", onclick: function () { self.modal.close(); } }));
    b.appendChild(el("h2", { id: "az-method-title", text: "How scores work" }));
    (this.cfg.methodology || []).concat([ABOUT_ESTIMATES]).forEach(function (sec) {
      b.appendChild(el("h3", { text: sec.title }));
      (Array.isArray(sec.body) ? sec.body : [sec.body]).forEach(function (p) { b.appendChild(el("p", { text: p })); });
    });
    var dd = this.d(this.state.level), meta = dd && dd.meta;
    if (meta && meta.meta) meta = meta.meta;   // some levels keep the whole data file here, with its meta inside
    // Data years from the build (meta): what each source's figures cover, then when the files were built
    if (meta) {
      var yrs = [["acsYears", "Census ACS", "5-year estimates"], ["cbpYear", "Census Business Patterns"], ["placesRelease", "CDC PLACES", "release"], ["ipedsYear", "IPEDS"],
                 ["irsYear", "IRS Statistics of Income"], ["hmdaYear", "HMDA"], ["permitsYear", "Census building permits"], ["zoriMonth", "Zillow rents"]]
        .filter(function (y) { return meta[y[0]] !== undefined && meta[y[0]] !== null && meta[y[0]] !== ""; })
        .map(function (y) { var v = String(meta[y[0]]), m = /^(\d{4})-(\d{2})$/.exec(v);
          if (m) v = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][+m[2] - 1] + " " + m[1];
          return y[1] + " " + v + (y[2] ? " " + y[2] : ""); });
      if (yrs.length) b.appendChild(el("p", { class: "az-empty", text: "Data years: " + yrs.join("; ") + "." }));
      if (meta.built) b.appendChild(el("p", { class: "az-empty", text: "Data built " + meta.built + "." }));
    }
    if (this.modal.showModal) this.modal.showModal(); else this.modal.setAttribute("open", "");
  };
  /* ---------- Benchmarks tab: typical search and social results for the category ---------- */
  Analyzer.prototype.loadBench = function () {
    var self = this, cfg = this.cfg;
    function load(url, key, tab) {
      fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (b) { if (b.map && b.map[cfg.exportName]) { self[key] = b; self.tabBar.querySelector('[data-tab="' + tab + '"]').hidden = false; self.tabBar.hidden = false; } })
        .catch(function () { /* no tab without data */ });
    }
    if (cfg.benchmarks !== false) load(cfg.benchmarksData || "../shared/benchmarks.json?v=20261022f", "bench", "bench");
    if (cfg.timing !== false) load(cfg.timingData || "../shared/timing.json?v=20261022g", "timing", "timing");
  };
  Analyzer.prototype.setTab = function (tab) {
    var self = this, prev = this.tab;
    if (tab === prev) return;
    Array.prototype.forEach.call(this.tabBar.children, function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-tab") === tab)); });
    if (prev === "markets") { this.tabSaved = this.tabParts.map(function (x) { return x.hidden; }); this.tabParts.forEach(function (x) { x.hidden = true; }); }
    this.benchPanel.hidden = tab !== "bench"; this.timingPanel.hidden = tab !== "timing";
    this.tab = tab;
    if (tab === "bench") this.renderBench();
    else if (tab === "timing") this.renderTiming();
    else {
      this.tabParts.forEach(function (x, i) { x.hidden = self.tabSaved ? self.tabSaved[i] : false; });
      if (this.map) this.map.invalidateSize();
      if (this.mode === "radius" && this.radius) this.radius.resize();
    }
  };
  // Category picker shared by the Timing and Benchmarks tabs; it drives the same category as the Markets tab
  Analyzer.prototype.tabControls = function (render, note, noMenu) {
    var self = this, cfg = this.cfg, s = this.state, subs = noMenu ? [] : cfg.subcategories || [];
    var sel = subs.length ? el("select", { "aria-label": cfg.subcategoryLabel || "Category", onchange: function () {
      if (self.subSel) { self.subSel.value = this.value; self.subSel.dispatchEvent(new Event("change")); } else s.sub = this.value;
      render.call(self); } }, subs.map(function (x) { return el("option", { value: x.id, text: x.label }); })) : null;
    if (sel) sel.value = s.sub;
    return el("section", { class: "az-controls az-bench-controls", "aria-label": "Category" }, [
      sel ? el("label", { class: "az-field" }, [el("span", { text: cfg.subcategoryLabel || "Category" }), sel]) : null,
      el("div", { class: "az-actions" }, [exportMenu([{ label: "Leave-behind (PDF)", note: note, run: function () { self.leaveBehind(); } }])])]);
  };

  /* ---------- Timing tab: when the category's sales peak through the year ---------- */
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  Analyzer.prototype.renderTiming = function () {
    var cfg = this.cfg, T = this.timing, box = this.timingPanel;
    if (!T) return;
    box.innerHTML = "";
    var m = T.map[cfg.exportName];
    // Industry-level data (one pattern for every category type): no category menu, and the title names what is measured,
    // so the same numbers never appear under different category names
    var industry = !Object.keys(m).some(function (k) { return k !== "_default"; });
    box.appendChild(this.tabControls(this.renderTiming, "A clean page of this calendar to send after the meeting", industry));
    var codes = [].concat(m[this.state.sub] || m._default), sub = industry ? "" : this.subLabel ? this.subLabel() : "";
    var names = function (list) { return list.slice().sort(function (a, b) { return a - b; }).map(function (i) { return MONTHS_LONG[i]; }).join(", "); };
    var level = function (v) { if (v >= 105) return 4; if (v >= 101) return 3; if (v > 96) return 2; return 1; };
    var peaks = function (idx, n) { return idx.map(function (v, i) { return i; }).sort(function (a, b) { return idx[b] - idx[a]; }).slice(0, n); };
    var lows = function (idx, n) { return idx.map(function (v, i) { return i; }).sort(function (a, b) { return idx[a] - idx[b]; }).slice(0, n); };
    var stripFor = function (S) {
      var idx = S.index, hi = peaks(idx, 3), mn = Math.min.apply(null, idx), mx = Math.max.apply(null, idx);
      return el("div", { class: "az-tm-strip", role: "list", "aria-label": S.label + ", by month, 100 = average month" }, idx.map(function (v, i) {
        return el("div", { class: "az-tm-cell az-tm-l" + level(v) + (hi.indexOf(i) >= 0 ? " az-tm-peak" : ""), role: "listitem", "aria-label": MONTHS_LONG[i] + ": " + NF0.format(v) }, [
          el("b", { text: MONTHS[i] }), el("span", { class: "az-tm-bar", "aria-hidden": "true" }, [el("i", { style: "height:" + Math.round(18 + (v - mn) / Math.max(1, mx - mn) * 62) + "%" })]),
          el("span", { class: "num", text: NF0.format(v) })]);
      }));
    };
    var legend = el("div", { class: "az-tm-legend", "aria-hidden": "true" }, [el("span", { text: "Below average" }), el("i", { class: "az-tm-l1" }), el("i", { class: "az-tm-l2" }), el("i", { class: "az-tm-l3" }), el("i", { class: "az-tm-l4" }), el("span", { text: "Above average" })]);
    // a short online history only names peaks when some month runs at least 10% above average
    var steady = function (S) { return S.kind === "online" && Math.max.apply(null, S.index) < 110; };
    var head = function (S) { var l = S.label.replace(/\s*\(.*\)$/, "").toLowerCase(); return S.kind === "online" ? "When people visit " + l : "When sales peak at " + l.replace(/^building mat\./, "building materials"); };
    var desc = function (S) { return "U.S. " + (S.kind === "online" ? "visits to " : "") + S.label.toLowerCase() + ", typical month = 100. " + (S.kind === "sales" ? ((T.proxyNote || {})[cfg.exportName] || "") : ""); };
    var P = T.series[codes[0]], panel = el("section", { class: "az-panel az-bench-panel" }, [
      el("h2", { text: head(P) + (sub ? ": " + sub : "") }), el("p", { class: "az-bench-ind", text: desc(P) + (industry ? (P.kind === "sales" ? "" : " ") + "An industry-wide pattern: it applies to every " + ((cfg.subcategoryLabel || "category").toLowerCase()) + " in this analyzer." : "") }), stripFor(P), legend]);
    codes.slice(1).forEach(function (c) {
      var S = T.series[c];
      panel.appendChild(el("h3", { class: "az-tm-h3", text: head(S) }));
      panel.appendChild(el("p", { class: "az-bench-ind", text: desc(S) + (steady(S) ? "Fairly steady year-round." : "Peaks: " + names(peaks(S.index, 3)) + ".") +
        (S.ytd ? " " + S.ytd.period + " " + S.ytd.year + " vs. a year earlier: visitors " + (S.ytd.visitors >= 0 ? "+" : "") + NF1.format(S.ytd.visitors) + "%, visits " + (S.ytd.visits >= 0 ? "+" : "") + NF1.format(S.ytd.visits) + "%." : "") }));
      panel.appendChild(stripFor(S));
    });
    box.appendChild(panel);
    var hi = peaks(P.index, 3), lo = lows(P.index, 3);
    // back-to-back peak months are one season: start a month ahead of each season's first month
    var ahead = hi.filter(function (i) { return hi.indexOf((i + 11) % 12) < 0; }).sort(function (a, b) { return a - b; })
      .map(function (i) { return MONTHS_LONG[(i + 11) % 12]; }).join(", ");
    var card = function (k, v, n) { return el("div", { class: "az-panel az-tm-card" }, [el("span", { text: k }), el("b", { text: v }), n ? el("small", { text: n }) : null]); };
    var L = P.latest, cards = steady(P) ? [card("Seasonal swing", "Fairly steady year-round", "No month runs 10% or more above average"),
      card("Highest months", names(hi), "Small lifts, not true peaks"), card("Timing advice", "Keep a steady presence", "Spend can follow budget cycles rather than season")] :
      [card("Peak months", names(hi), P.kind === "online" ? "Most online visits" : "Highest typical sales"),
      card("Slowest months", names(lo), P.kind === "online" ? "Fewest online visits" : "Lowest typical sales"),
      card("Start campaigns by", ahead, "About a month ahead of each peak")];
    var pc = function (v) { return (v >= 0 ? "+" : "") + NF1.format(v) + "%"; };
    if (!L && P.ytd) cards.push(card("Online audience, " + P.ytd.period, pc(P.ytd.visitors), "Visitors vs. " + P.ytd.period + " " + (P.ytd.year - 1) + "; visits " + pc(P.ytd.visits)));
    if (L) cards.push(card("Latest month", (L.yoy >= 0 ? "+" : "") + NF1.format(L.yoy) + "%", MONTHS_LONG[L.month - 1] + " " + L.year + " sales vs. a year earlier" + (L.prelim ? " (preliminary)" : "")));
    box.appendChild(el("section", { class: "az-tm-cards" + (cards.length === 3 ? " az-tm-cards3" : "") }, cards));
    var used = {}; codes.forEach(function (c) { used[T.series[c].source] = 1; });
    box.appendChild(el("p", { class: "az-bench-note", text: Object.keys(used).map(function (k) { return T.sources[k].note; }).concat([T.note]).join(" ") }));
    box.appendChild(el("section", { class: "az-panel az-sources" }, [el("h2", { text: "Sources" }),
      el("p", null, Object.keys(used).map(function (k, i) { var X = T.sources[k];
        return el("span", null, [i ? " \u00b7 " : "", X.url ? el("a", { href: X.url, target: "_blank", rel: "noopener", text: X.label }) : X.label]); }).concat([" Updated " + T.updated + "."]))]));
  };

  Analyzer.prototype.benchFor = function (sub) {
    var m = this.bench.map[this.cfg.exportName], pick = m[sub] || m._default;
    return { ind: this.bench.industries[pick[0]], exact: pick[1], all: this.bench.industries.all };
  };
  Analyzer.prototype.renderBench = function () {
    var self = this, cfg = this.cfg, B = this.bench, s = this.state, box = this.benchPanel;
    if (!B) return;
    box.innerHTML = "";
    box.appendChild(this.tabControls(this.renderBench, "A clean page of these benchmarks to send after the meeting"));

    var R = this.benchFor(s.sub), I = R.ind, A = R.all, subLabel = this.subLabel ? this.subLabel() : "";
    var money2 = function (v) { return "$" + NF2.format(v); }, pct = function (v) { return NF2.format(v) + "%"; };
    var rows = [["cpc", "Cost per click", money2, "What each ad click costs"], ["ctr", "Click-through rate", pct, "Share of people who saw the ad and clicked"],
                ["cvr", "Conversion rate", pct, "Share of clicks that became a lead (call, form or message)"], ["cpl", "Cost per lead", money2, "Ad spend for each lead"]];
    var cols = [["search", "Search ads", "Google and Microsoft Ads"], ["socialLeads", "Facebook and Instagram", "Lead ads"], ["socialTraffic", "Facebook and Instagram", "Traffic ads"]]
      .filter(function (c) { return I[c[0]]; });   // a platform with nothing published for this category is left out, and the note says so
    var cell = function (col, r) {
      var v = I[col[0]], a = A[col[0]];
      if (col[0] === "socialTraffic" && (r[0] === "cvr" || r[0] === "cpl")) return el("td", { class: "az-bench-na", text: "Not measured for traffic ads" });
      if (!v || v[r[0]] == null) return el("td", { class: "az-bench-na", text: "Not published for this category" });
      return el("td", null, [el("b", { class: "num", text: r[2](v[r[0]]) }), a && a[r[0]] != null ? el("small", { text: "All industries " + r[2](a[r[0]]) }) : null]);
    };
    var thead = el("thead", null, [el("tr", null, [el("th", { scope: "col", text: "Measure" })].concat(cols.map(function (c) {
      return el("th", { scope: "col" }, [c[1], el("small", { text: c[2] })]); })))]);
    var tbody = el("tbody", null, rows.map(function (r) {
      return el("tr", null, [el("th", { scope: "row" }, [r[1], el("small", { text: r[3] })])].concat(cols.map(function (c) { return cell(c, r); })));
    }));
    box.appendChild(el("section", { class: "az-panel az-bench-panel" }, [
      el("h2", { text: "What to expect" + (subLabel ? ": " + subLabel : "") }),
      el("p", { class: "az-bench-ind", text: "Benchmarks for " + I.label + (R.exact ? "" : " (closest published category)") + ", " + B.updated + "." }),
      el("div", { class: "az-tablewrap" }, [el("table", { class: "az-table az-bench-table" }, [thead, tbody])]),
      el("p", { class: "az-bench-note", text: (I.socialLeads ? "" : "Facebook and Instagram lead-ad figures aren't published for this category. ") + B.note })]));
    box.appendChild(el("section", { class: "az-panel az-sources" }, [el("h2", { text: "Sources" }),
      el("p", null, B.sources.map(function (x, i) { return el("span", null, [i ? " \u00b7 " : "", el("a", { href: x.url, target: "_blank", rel: "noopener", text: x.label })]); }))]));
  };

  Analyzer.prototype.leaveBehind = function () {
    if (this.tab !== "markets") {
      var sub = this.subLabel ? this.subLabel() : "";
      return printLeaveBehind(this.cfg.logo, [this.cfg.title, (this.tab === "timing" ? "Sales timing through the year" : "Performance benchmarks") + (sub ? " \u00b7 " + (this.cfg.subcategoryLabel || "Category") + ": " + sub : ""),
        "Prepared by Adtaxi \u00b7 " + today()], []);
    }
    var cfg = this.cfg, opt = this.rankSel && this.rankSel.options[this.rankSel.selectedIndex];
    var sub = this.subLabel ? this.subLabel() : "";
    printLeaveBehind(cfg.logo, [cfg.title,
      [sub ? (cfg.subcategoryLabel || "Category") + ": " + sub : null, this.tableTitle.textContent || null, opt ? "Ranked by " + opt.text : null].filter(Boolean).join(" \u00b7 "),
      "Prepared by Adtaxi \u00b7 " + today()], [this.map]);
  };
  Analyzer.prototype.exportCSV = function () {
    var self = this, s = this.state;
    var level = this.tableLevel(), d = this.d(level);   // the U.S. view with drill-down exports its DMA ranking
    if (!d) return;
    var cols = this.cfg.measures.filter(function (m) { return self.availableAt(m, level) && self.relevant(m); });
    var rows = level === "us" ? d.rows : this.sortedRows().filter(function (r) { return !s.query || r.name.toLowerCase().indexOf(s.query) >= 0; });
    var lines = [["Level", level === "zip" ? "ZIP" : "ID", "Name"].concat(this.subLabel() ? ["Category"] : []).concat(cols.map(function (m) { return m.label; })).map(csvCell).join(",")];
    rows.forEach(function (r) {
      lines.push([LEVEL_LABELS[level], r.id, r.name].concat(self.subLabel() ? [self.subLabel()] : []).concat(cols.map(function (m) {
        var v = self.val(r, m); return v == null ? "" : v;
      })).map(csvCell).join(","));
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = el("a", { href: URL.createObjectURL(blob), download: (this.cfg.exportName || "adtaxi-analyzer") + "-" + (level === "zip" ? "zips-in-" + s.parent.level + "-" + s.parent.id : level) + (s.sub ? "-" + s.sub : "") + ".csv" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  };

  window.AdtaxiAnalyzer = {
    start: function (cfg, root) {
      var app = new Analyzer(cfg, root || document.getElementById("app"));
      app.build();
      app.refresh();
      app.loadBench();
      if (app.wantRadius) app.openRadius(app.wantRadius);
      window.addEventListener("hashchange", function () { app.readHash(); if (app.wantRadius) app.openRadius(app.wantRadius); else { if (app.mode === "radius") app.closeRadius(); app.refresh(); } });
      return app;
    },
    format: fmt
  };
})();
