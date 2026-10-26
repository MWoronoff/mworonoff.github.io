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
    btn = el("button", { type: "button", class: "az-btn primary", "aria-haspopup": "menu", "aria-expanded": "false", text: "Export \u25be",
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
    return level === "zip" ? (p ? "zip:" + p.level + ":" + p.id : null) : level;
  };
  Analyzer.prototype.d = function (level) { var k = this.key(level); return k ? this.data[k] : null; };
  Analyzer.prototype.url = function (template) {
    var p = this.state.parent || {};
    if (template && typeof template === "object") template = template[p.level] || template["default"];   // ZIP files can live elsewhere for some parent levels (e.g. a client's territories)
    return template.replace("{level}", p.level).replace("{id}", encodeURIComponent(p.id));
  };
  Analyzer.prototype.levelLabel = function (level) { return (this.cfg.levels[level] && this.cfg.levels[level].label) || LEVEL_LABELS[level]; };
  Analyzer.prototype.parentName = function () {
    var p = this.state.parent, pd = p && this.data[p.level], row = pd && pd.byId[p.id];
    return row ? row.name + (p.level === "county" ? "" : " " + LEVEL_LABELS[p.level]) : "";   // county names already say County/Parish
  };
  Analyzer.prototype.canDrill = function () {
    var s = this.state;
    return !!this.cfg.levels.zip && (this.drillable(s.level) && !!s.area || s.level === "zip");
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
    this.wantRadius = (p.level === "radius" || p.level === "area") && cfg.radius ? { zip: p.zip, r: p.r, p: p.p, mode: p.level === "area" ? "area" : "radius", ca: p.ca } : null;   // a profile applies only when the link names one (p=); no preset otherwise
    if (this.wantRadius && p.p && cfg.subcategories && cfg.subcategories.some(function (x) { return x.id === p.p; })) this.state.sub = p.p;
    if (cfg.levels[p.level]) this.state.level = p.level;
    if (p.level === "zip") {
      var m = /^(dma|metro|county|territory):(.+)$/.exec(p["in"] || "");
      if (m && cfg.levels.zip && cfg.levels[m[1]]) this.state.parent = { level: m[1], id: m[2] }; else this.state.level = cfg.defaultLevel || "dma";
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
      var hr = "#" + parts.join("&"); if (location.hash !== hr) history.replaceState(null, "", hr);
      return;
    }
    if (s.sub) parts.push("sub=" + encodeURIComponent(s.sub));
    if (s.rank) parts.push("rank=" + encodeURIComponent(s.rank));
    if (s.level === "zip" && s.parent) parts.push("in=" + s.parent.level + ":" + encodeURIComponent(s.parent.id));
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
  Analyzer.prototype.ensureLevel = function (level) {
    var self = this, L = this.cfg.levels[level], jobs = [], key = this.key(level);
    if (level === "zip") jobs.push(this.ensureLevel(this.state.parent.level));  // parent names and outline
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
      Object.keys(cfg.levels).concat(cfg.radius ? ["radius"] : []).map(function (lv) {
        // Trade area: the Zip Code Radius Tool, which draws the area as a radius or, where the site turns it on, a custom list of ZIPs, counties and towns
        if (lv === "radius") return el("button", { type: "button", "data-level": "radius", text: "Trade area",
          title: "Count likely customers in a business's trade area: a radius around a ZIP or town, or a custom list of ZIPs, counties, towns, DMAs or metros", onclick: function () { self.openRadius(); } });
        if (lv === "zip") return el("button", { type: "button", "data-level": "zip", text: cfg.levels.zip.label || "ZIPs in market",
          title: "Pick a DMA, metro or county first, then see the ZIPs inside it", onclick: function () { if (self.mode === "radius") self.closeRadius(); if (self.state.level !== "zip") self.drill(); } });
        return el("button", { type: "button", "data-level": lv, text: cfg.levels[lv].label || LEVEL_LABELS[lv],
          onclick: function () { if (self.mode === "radius") self.closeRadius(); self.setLevel(lv); } });
      }));
    var controls = [el("div", { class: "az-field" }, [el("span", { text: "Geography" }), this.levelSeg])];
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
      cfg.crm === false ? null : el("button", { type: "button", class: "az-btn az-only", text: "Analyze your footprint",
        title: "Upload a customer list to see the business's geographic footprint against this market's potential, ZIP by ZIP",
        onclick: function () { location.href = self.crmUrl(); } }),
      cfg.results === false ? null : el("button", { type: "button", class: "az-btn az-results-btn", text: "Results",
        title: "Case studies and client testimonials for this category", "aria-haspopup": "dialog", onclick: function () { self.openResults(); } }),
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
    this.anaParts = [stage, this.adPanel, this.tablePanel, sources];
    this.controlBar = controlBar;
    this.benchPanel = el("section", { class: "az-bench", hidden: true, "aria-live": "polite" });
    this.timingPanel = el("section", { class: "az-bench az-timing", hidden: true, "aria-live": "polite" });
    this.tab = "markets";
    this.tabParts = [controlBar, this.notice, this.errorBox, stage, this.adPanel, this.tablePanel, sources, this.radiusBox];
    var main = el("main", { class: "az-main" }, [controlBar, this.notice, this.errorBox, stage, this.adPanel, this.tablePanel, sources, this.radiusBox, this.benchPanel, this.timingPanel]);
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
    // Radius or custom area: a link or a ZIP's "Build a radius audience" button says which; the Trade area button keeps the last one used (Radius at first)
    var rmode = this.radiusMode = opt.mode === "area" ? "area" : opt.mode === "radius" || opt.zip ? "radius" : (this.radius ? this.radius.state.mode : "radius");
    this.anaParts.forEach(function (x) { x.hidden = true; });
    Array.prototype.forEach.call(this.controlBar.querySelectorAll(".az-only"), function (x) { x.hidden = true; });
    this.radiusBox.hidden = false;
    Array.prototype.forEach.call(this.levelSeg.children, function (b) {
      var on = b.getAttribute("data-level") === "radius"; b.setAttribute("aria-pressed", on);
      if (b.getAttribute("data-level") === "zip") b.disabled = false;
    });
    var preset = cfg.radiusProfiles && opt.p ? opt.p : null;   // no best-prospect preset unless asked for
    function go() {
      if (!self.radius) {
        var RC = cfg.radius === true ? window.ADTAXI_RADIUS : cfg.radius;   // the site's radius-config.js sets ADTAXI_RADIUS
        var rc = {}; for (var k in RC) rc[k] = RC[k];
        rc.embedded = true; rc.initial = { zip: opt.zip, r: opt.r, p: preset, mode: rmode, ca: opt.ca };
        rc.onState = function () { self.writeHash(); };
        rc.context = function () { return { ad: cfg.adResponse, sub: self.state.sub }; };   // the proposal's ad-response reasons
        rc.onUpdate = function (ready) { self.radiusReady = ready; self.renderAd(); };
        self.radius = window.AdtaxiRadius.start(rc, self.radiusBox);
      } else {
        if (preset) self.radius.usePreset(preset);
        if (self.radius.setMode) self.radius.setMode(rmode, opt.ca);
        if (opt.zip && rmode === "radius") self.radius.centerOn(opt.zip);
        self.radius.resize();
      }
      self.writeHash();
      window.scrollTo(0, 0);
    }
    if (window.AdtaxiRadius) go();
    else {
      var sc = document.createElement("script"); sc.src = cfg.radiusScript || "../shared/radius.js?v=20261026g";   // version tag: browsers fetch the new file after an update
      sc.onload = go; sc.onerror = function () { self.showError("The radius tool didn't load. Refresh the page and try again."); };
      document.head.appendChild(sc);
    }
  };
  Analyzer.prototype.closeRadius = function () {
    this.mode = null;
    this.radiusBox.hidden = true;
    this.anaParts.forEach(function (x) { x.hidden = false; });
    Array.prototype.forEach.call(this.controlBar.querySelectorAll(".az-only"), function (x) { x.hidden = false; });
    this.adPanel.hidden = true;
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
  Analyzer.prototype.select = function (id, opts) {
    this.state.area = id;
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
    var drill = this.canDrill();
    Array.prototype.forEach.call(this.levelSeg.children, function (b) {
      var lv = b.getAttribute("data-level");
      b.setAttribute("aria-pressed", lv === s.level);
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
      self.renderAd();
      self.writeHash();
    }).catch(function (e) {
      if (ticket !== self.refreshTicket) return;     // a stale load failing doesn't matter
      self.errorBox.hidden = false;
      if (s.level === "zip" && s.parent) {
        // ZIP data for this market didn't load: step back to the market so the page stays usable.
        self.errorBox.textContent = "The ZIPs for this market couldn't be loaded (" + e.message + "). Showing the market instead; try again in a minute.";
        s.level = s.parent.level; s.area = s.parent.id;
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
    var rows = d.rows.map(function (r) { return { label: r[0], aud: r[1], us: r[2], diff: r[2] ? r[1] / r[2] - 1 : null }; });
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
        el("p", { text: d.audience ? "Percent of the target group (" + d.audience + ") and of all U.S. adults who saw or heard an ad on each medium that led them to take action in the past 30 days. Percentages are based on everyone in each group, not only people who use that medium." : "" })
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
        el("span", { class: "az-ad-label", role: "cell", title: r.label }, [el("span", { class: "az-ad-rank", text: rank + "." }), short(r.label)]),
        el("span", { class: "az-ad-bars", role: "cell", "aria-hidden": "true" }, [
          el("span", { class: "az-ad-bar aud", style: "width:" + barW(r.aud) + "%" })]),
        el("span", { class: "num", role: "cell", text: pct(r.aud) }),
        el("span", { class: "num muted", role: "cell", text: pct(r.us) }),
        el("span", { class: "num az-ad-diff", role: "cell", text: dif(r.diff) })
      ]);
    };
    var cols = el("div", { class: "az-ad-cols" });
    [ordered.slice(0, SPLIT), ordered.slice(SPLIT)].forEach(function (part, c) {
      if (!part.length) return;
      var t = el("div", { class: "az-ad-rows", role: "table", "aria-label": "Advertising response by type of ad, " + (c ? (SPLIT + 1) + " to " + ordered.length : "1 to " + Math.min(SPLIT, ordered.length)) });
      t.appendChild(colHead());
      part.forEach(function (r, i) { t.appendChild(adRow(r, c * SPLIT + i + 1)); });
      cols.appendChild(t);
    });
    box.appendChild(cols);
    box.appendChild(el("p", { class: "az-ad-note", text: (A.note || "") + " Bar scale runs from " + base + "% to " + top + "%" + (base > 0 ? ", not from zero, to make the differences easier to see." : ".") + (d.source ? " Source: " + d.source + "." : A.source ? " Source: " + A.source + "." : "") }));
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
    if (lv === "zip") {
      var P = this.cfg.levels[s.parent.level], pfc = this.geo[P.geo];
      var pf = pfc && pfc.features.filter(function (f) { return String(f.properties[P.idField]) === String(s.parent.id); })[0];
      if (pf) this.parentLayer = L.geoJSON(pf, { interactive: false, style: { color: "#0f2742", weight: 2.5, dashArray: "6 5", fill: false } }).addTo(this.map);
      var b = (this.areaLayer && this.areaLayer.getBounds().isValid()) ? this.areaLayer.getBounds() : (this.parentLayer && this.parentLayer.getBounds());
      if (b && b.isValid()) this.map.fitBounds(b, { padding: [24, 24] });
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
    this.mapHead.appendChild(el("span", { text: lv === "zip" ? "ZIPs in " + this.parentName() + ", ranked within this market." :
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
    if (br.length) {
      var lo = values.filter(function (x) { return typeof x === "number"; });
      var bounds = [Math.min.apply(null, lo)].concat(br).concat([Math.max.apply(null, lo)]);
      for (var i = 4; i >= 0; i--) {
        this.legend.appendChild(el("div", { class: "az-legend-row" }, [
          el("span", { class: "az-swatch", style: "background:" + colors[i] }),
          el("span", { class: "num", text: fmt(bounds[i], m.format) + " – " + fmt(bounds[i + 1], m.format) })
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
    Object.keys(this.layerById).forEach(function (id) {
      var sel = id === self.state.area && self.state.level === self.mapLevel;
      var lyr = self.layerById[id];
      lyr.setStyle({ color: sel ? "#0f2742" : "#ffffff", weight: sel ? 3 : 0.8 });
      if (sel) lyr.bringToFront();
    });
    if (this.stateLayer) this.stateLayer.bringToFront();
  };

  /* ---------- Table ---------- */
  Analyzer.prototype.columns = function () {
    var self = this, lv = this.state.level;
    var keys = this.cfg.tableColumns || this.cfg.measures.map(function (m) { return m.key; });
    return keys.map(function (k) { return self.measure(k); }).filter(function (m) { return m && self.availableAt(m, lv) && self.relevant(m); });
  };
  Analyzer.prototype.sortedRows = function () {
    var self = this, s = this.state, d = this.d(s.level);
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
    var self = this, s = this.state;
    if (s.level === "us") {
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
    var isZip = s.level === "zip", lvLabel = isZip ? "ZIP" : this.levelLabel(s.level);
    this.tableTitle.textContent = (isZip ? "ZIPs in " + this.parentName() : lvLabel + " rankings") + (this.subLabel() ? ": " + this.subLabel() : "");
    this.backBtn.hidden = !isZip;
    this.search.placeholder = isZip ? "Find a ZIP or town" : "Find a market";
    if (isZip) this.backBtn.textContent = "Back to " + LEVEL_LABELS[s.parent.level] + " rankings";
    this.tableNote.textContent = "Showing " + NF0.format(shown.length) + " of " + NF0.format(all.length) + (isZip ? " ZIPs" : " markets") + ", ranked by " + (rankM ? rankM.label.toLowerCase() : "") + ". Click a column to sort.";

    this.thead.innerHTML = "";
    var cfg = this.cfg, RCf = cfg.radius === true ? window.ADTAXI_RADIUS : cfg.radius;
    var pickable = !!(RCf && RCf.customArea) && PICK_PREFIX[s.level] != null;
    if (this.pick.level !== s.level) this.pick = { level: s.level, ids: {} };
    var hr = el("tr", null, [pickable ? el("th", { scope: "col", class: "az-pickcol", title: "Select markets to combine into one trade area" }, [el("span", { class: "az-visually-hidden", text: "Select" })]) : null,
      el("th", { scope: "col", text: "Rank" }), el("th", { scope: "col", text: lvLabel })]);
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
    this.thead.appendChild(hr);

    var frag = document.createDocumentFragment(), anyMark = false;
    shown.forEach(function (r) {
      var tr = el("tr", { tabindex: "0", "data-id": r.id, "aria-selected": r.id === s.area ? "true" : "false",
        onclick: function () { self.select(r.id, { zoom: true }); },
        onkeydown: function (e) { if (e.target.tagName === "INPUT") return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); self.select(r.id, { zoom: true }); } } }, [
        pickable ? el("td", { class: "az-pickcol", onclick: function (e) { e.stopPropagation(); } }, [el("input", { type: "checkbox", "aria-label": "Select " + r.name,
          checked: self.pick.ids[r.id] ? "checked" : null, onchange: function () { if (this.checked) self.pick.ids[r.id] = 1; else delete self.pick.ids[r.id]; self.renderPick(); } })]) : null,
        el("td", { class: "az-rank num", text: rankOf[r.id] ? String(rankOf[r.id]) : "–" }),
        el("td", null, [r.name, r.t ? el("span", { class: "az-tag", title: (r.f && r.f[0]) || null, text: r.t }) : null])
      ]);
      cols.forEach(function (m) {
        var v = fmt(self.val(r, m), m.format);
        if (v == null && r.u && (m.key === s.rank || m.key.indexOf("score") === 0 || m.key.indexOf("p_") === 0)) tr.appendChild(el("td", { class: "az-na", title: (r.f && r.f[0]) || "Not ranked", text: "Not ranked" }));
        else if (v == null) tr.appendChild(el("td", { class: "az-na", title: "No data for this area", text: "No data" }));
        else { var mk = self.mark(r, m); if (mk) anyMark = true; tr.appendChild(el("td", { class: "num", title: mk ? "Uses estimated values; see this market's Data notes" : null, text: v + mk })); }
      });
      frag.appendChild(tr);
    });
    this.tbody.innerHTML = "";
    if (!shown.length) this.tbody.appendChild(el("tr", null, [el("td", { colspan: String(cols.length + (pickable ? 3 : 2)), class: "az-empty", text: "No markets match \u201c" + s.query + "\u201d. Clear the search to see all markets." })]));
    this.tbody.appendChild(frag);
    if (anyMark) this.tableNote.textContent += " * Uses estimated health values; select the market and see its Data notes.";
    if (pickable) this.tableNote.textContent += " Tick several to open them together as one trade area.";
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
    var LEVEL_PLURAL = { territory: "territories", dma: "DMAs", metro: "metros", county: "counties", zip: "ZIPs in this market" };
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
        var typical = s.level === "zip" ? "typical ZIP here " : "typical " + (s.level === "county" ? "county" : s.level === "metro" ? "metro" : s.level === "territory" ? "territory" : "DMA") + " ";
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
    if (this.cfg.levels.zip && this.drillable(s.level)) {
      box.appendChild(el("button", { type: "button", class: "az-btn primary az-drill", text: "See ZIPs in this market", onclick: function () { self.drill(); } }));
    }
    if (s.level === "zip") {
      if (cfg.radius) box.appendChild(el("button", { type: "button", class: "az-btn primary az-drill", onclick: function () { self.openRadius({ zip: row.id, p: cfg.radiusProfiles ? self.state.sub : null }); },
        text: cfg.radiusProfiles && this.subLabel() ? "Find likely customers around this ZIP" : "Build a radius audience from this ZIP" }));
      else if (cfg.radiusPage) box.appendChild(el("a", { class: "az-btn primary az-drill", href: cfg.radiusPage + "#zip=" + encodeURIComponent(row.id) + "&r=" + (cfg.radiusDefault || 10) + (cfg.radiusProfiles && this.state.sub ? "&p=" + encodeURIComponent(this.state.sub) : ""),
        text: cfg.radiusProfiles && this.subLabel() ? "Find likely customers around this ZIP" : "Build a radius audience from this ZIP" }));
      box.appendChild(el("button", { type: "button", class: "az-btn az-drill", text: "Back to " + this.parentName(), onclick: function () { self.setLevel(s.parent.level); } }));
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
    if (meta && meta.built) b.appendChild(el("p", { class: "az-empty", text: "Data built " + meta.built + "." }));
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
  Analyzer.prototype.tabControls = function (render, note) {
    var self = this, cfg = this.cfg, s = this.state, subs = cfg.subcategories || [];
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
    box.appendChild(this.tabControls(this.renderTiming, "A clean page of this calendar to send after the meeting"));
    var m = T.map[cfg.exportName], codes = [].concat(m[this.state.sub] || m._default), sub = this.subLabel ? this.subLabel() : "";
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
    var head = function (S) { return S.kind === "online" ? "When people shop online" : "When sales peak"; };
    var desc = function (S) { return "U.S. " + (S.kind === "online" ? "visits to " : "") + S.label.toLowerCase() + ", typical month = 100. " + (S.kind === "sales" ? ((T.proxyNote || {})[cfg.exportName] || "") : ""); };
    var P = T.series[codes[0]], panel = el("section", { class: "az-panel az-bench-panel" }, [
      el("h2", { text: head(P) + (sub ? ": " + sub : "") }), el("p", { class: "az-bench-ind", text: desc(P) }), stripFor(P), legend]);
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
      [card("Peak months", names(hi), P.kind === "online" ? "Most online shopping activity" : "Highest typical sales"),
      card("Slowest months", names(lo), P.kind === "online" ? "Least online shopping activity" : "Lowest typical sales"),
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
    var level = s.level, d = this.d(level);
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
