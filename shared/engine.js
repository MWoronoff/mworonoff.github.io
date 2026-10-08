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

  var LEVEL_LABELS = { us: "U.S.", dma: "DMA", metro: "Metro", zip: "ZIP" };
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
      case "moneyM": return "$" + NF1.format(v / 1e6) + "M";
      case "index": return NF0.format(v);
      default: return NF0.format(v);
    }
  }
  function csvCell(s) { s = s == null ? "" : String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

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
  Analyzer.prototype.valueKey = function (m) { return m.perSub && this.state.sub ? m.key + "@" + this.state.sub : m.key; };
  Analyzer.prototype.val = function (row, m) {
    if (!row || !m) return undefined;
    var k = this.valueKey(m);
    return Object.prototype.hasOwnProperty.call(row.v, k) ? row.v[k] : null;
  };
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
    return template.replace("{level}", p.level).replace("{id}", encodeURIComponent(p.id));
  };
  Analyzer.prototype.levelLabel = function (level) { return (this.cfg.levels[level] && this.cfg.levels[level].label) || LEVEL_LABELS[level]; };
  Analyzer.prototype.parentName = function () {
    var p = this.state.parent, pd = p && this.data[p.level], row = pd && pd.byId[p.id];
    return row ? row.name + " " + LEVEL_LABELS[p.level] : "";
  };
  Analyzer.prototype.canDrill = function () {
    var s = this.state;
    return !!this.cfg.levels.zip && ((s.level === "dma" || s.level === "metro") && !!s.area || s.level === "zip");
  };
  Analyzer.prototype.drill = function () {
    var s = this.state;
    if (!this.cfg.levels.zip || !(s.level === "dma" || s.level === "metro") || !s.area) return;
    s.parent = { level: s.level, id: s.area };
    s.level = "zip"; s.area = null; s.sortKey = null; s.query = ""; if (this.search) this.search.value = "";
    this.refresh();
  };

  /* ---------- URL state ---------- */
  Analyzer.prototype.readHash = function () {
    var h = (location.hash || "").replace(/^#/, "");
    if (!h) return;
    var p = {};
    h.split("&").forEach(function (kv) { var a = kv.split("="); if (a[0]) p[a[0]] = decodeURIComponent(a[1] || ""); });
    var cfg = this.cfg;
    if (cfg.levels[p.level]) this.state.level = p.level;
    if (p.level === "zip") {
      var m = /^(dma|metro):(.+)$/.exec(p["in"] || "");
      if (m && cfg.levels.zip) this.state.parent = { level: m[1], id: m[2] }; else this.state.level = "dma";
    }
    if ((cfg.subcategories || []).some(function (s) { return s.id === p.sub; })) this.state.sub = p.sub;
    if ((cfg.rankBy || []).indexOf(p.rank) >= 0) this.state.rank = p.rank;
    if (p.area) this.state.area = p.area;
  };
  Analyzer.prototype.writeHash = function () {
    var s = this.state, parts = ["level=" + s.level];
    if (s.sub) parts.push("sub=" + encodeURIComponent(s.sub));
    if (s.rank) parts.push("rank=" + encodeURIComponent(s.rank));
    if (s.level === "zip" && s.parent) parts.push("in=" + s.parent.level + ":" + encodeURIComponent(s.parent.id));
    if (s.area && s.level !== "us") parts.push("area=" + encodeURIComponent(s.area));
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
      ])
    ]);

    // Controls
    this.levelSeg = el("div", { class: "az-seg", role: "group", "aria-label": "Geography level" },
      Object.keys(cfg.levels).map(function (lv) {
        if (lv === "zip") return el("button", { type: "button", "data-level": "zip", text: cfg.levels.zip.label || "ZIPs in market",
          title: "Pick a DMA or metro first, then see the ZIPs inside it", onclick: function () { if (self.state.level !== "zip") self.drill(); } });
        return el("button", { type: "button", "data-level": lv, text: cfg.levels[lv].label || LEVEL_LABELS[lv],
          onclick: function () { self.setLevel(lv); } });
      }));
    var controls = [el("div", { class: "az-field" }, [el("span", { text: "Geography" }), this.levelSeg])];
    if ((cfg.subcategories || []).length) {
      this.subSel = el("select", { "aria-label": cfg.subcategoryLabel || "Category", onchange: function () { self.state.sub = this.value; self.state.sortKey = null; self.refresh(); } },
        cfg.subcategories.map(function (s) { return el("option", { value: s.id, text: s.label }); }));
      controls.push(el("label", { class: "az-field" }, [el("span", { text: cfg.subcategoryLabel || "Category" }), this.subSel]));
    }
    this.rankSel = el("select", { onchange: function () { self.state.rank = this.value; self.state.sortKey = null; self.refresh(); } },
      (cfg.rankBy || []).map(function (k) { var m = self.measure(k); return el("option", { value: k, text: m ? m.label : k }); }));
    controls.push(el("label", { class: "az-field" }, [el("span", { text: "Rank and map by" }), this.rankSel]));
    this.showSel = el("select", { onchange: function () { self.state.show = +this.value; self.renderTable(); } },
      [10, 25, 50, 100, 0].map(function (n) { return el("option", { value: n, text: n ? "Top " + n : "All" }); }));
    this.showSel.value = String(this.state.show);
    controls.push(el("label", { class: "az-field" }, [el("span", { text: "Show" }), this.showSel]));
    this.search = el("input", { type: "search", placeholder: "Find a market", "aria-label": "Find a market",
      oninput: function () { self.state.query = this.value.trim().toLowerCase(); self.renderTable(); } });
    controls.push(el("label", { class: "az-field" }, [el("span", { text: "Search" }), this.search]));
    controls.push(el("div", { class: "az-actions" }, [
      el("button", { type: "button", class: "az-btn", text: "How scores work", onclick: function () { self.openMethod(); } }),
      el("button", { type: "button", class: "az-btn primary", text: "Export CSV", onclick: function () { self.exportCSV(); } })
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
    this.tablePanel = el("section", { class: "az-panel az-table-panel" }, [
      el("div", { class: "az-table-head" }, [el("div", { class: "az-table-title" }, [this.tableTitle, this.backBtn]), this.tableNote]),
      el("div", { class: "az-tablewrap" }, [el("table", { class: "az-table" }, [this.thead, this.tbody])])
    ]);

    // Sources
    var srcLinks = (cfg.sources || []).map(function (s, i) {
      return el("span", null, [i ? " · " : "", s.url ? el("a", { href: s.url, target: "_blank", rel: "noopener", text: s.label }) : s.label]);
    });
    this.sourcesNote = el("p", { text: cfg.sourcesNote || "" });
    var sources = el("section", { class: "az-panel az-sources" }, [el("h2", { text: "Sources" }), el("p", null, srcLinks), this.sourcesNote]);

    // Methodology dialog
    this.modalBody = el("div", { class: "az-modal-body" });
    this.modal = el("dialog", { class: "az-modal", "aria-labelledby": "az-method-title" }, [this.modalBody]);

    this.errorBox = el("div", { class: "az-error", role: "alert", hidden: true });
    var main = el("main", { class: "az-main" }, [controlBar, this.notice, this.errorBox, stage, this.tablePanel, sources]);
    this.root.innerHTML = "";
    this.root.appendChild(header);
    this.root.appendChild(main);
    this.root.appendChild(this.modal);

    // Leaflet map with no tile basemap: the boundaries are the map.
    this.map = L.map(this.mapEl, { zoomControl: false, zoomSnap: 0.25, minZoom: 2, maxZoom: 10, attributionControl: true, worldCopyJump: false });
    L.control.zoom({ position: "topright" }).addTo(this.map);
    this.map.attributionControl.setPrefix(false);
    this.map.attributionControl.addAttribution(cfg.mapAttribution || "Boundaries: U.S. Census Bureau");
    this.map.fitBounds([[24.4, -125], [49.5, -66.9]]);
  };

  /* ---------- State changes ---------- */
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

  Analyzer.prototype.refresh = function () {
    var self = this, s = this.state;
    var drill = this.canDrill();
    Array.prototype.forEach.call(this.levelSeg.children, function (b) {
      var lv = b.getAttribute("data-level");
      b.setAttribute("aria-pressed", lv === s.level);
      if (lv === "zip") { b.disabled = !drill; b.setAttribute("aria-disabled", !drill); }
    });
    if (this.subSel) this.subSel.value = s.sub;
    this.rankSel.value = s.rank;
    this.errorBox.hidden = true;
    var mapLevel = s.level === "us" ? (this.cfg.usMapLevel || "dma") : s.level;
    var needed = [this.ensureLevel(s.level)];
    if (mapLevel !== s.level) needed.push(this.ensureLevel(mapLevel));
    Promise.all(needed).then(function () {
      self.mapLevel = mapLevel;
      if (s.level === "us") s.area = (self.data.us.rows[0] || {}).id;
      else if (!self.d(s.level).byId[s.area]) s.area = (self.sortedRows()[0] || {}).id || null;  // open on the top-ranked market
      Array.prototype.forEach.call(self.levelSeg.children, function (b) {
        if (b.getAttribute("data-level") === "zip") { var ok = self.canDrill(); b.disabled = !ok; b.setAttribute("aria-disabled", !ok); }
      });
      self.renderMap();
      self.renderTable();
      self.renderDetail();
      self.writeHash();
    }).catch(function (e) {
      self.errorBox.hidden = false;
      self.errorBox.textContent = e.message + ". Refresh the page; if it keeps happening, the data files for this view are missing.";
    });
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
        var name = row ? row.name : (f.properties.dma_name || f.properties.NAME || id);
        if (!row && lv === "zip") name = "ZIP " + id;
        var v = row ? fmt(self.val(row, m), m.format) : null;
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
    return keys.map(function (k) { return self.measure(k); }).filter(function (m) { return m && self.availableAt(m, lv); });
  };
  Analyzer.prototype.sortedRows = function () {
    var self = this, s = this.state, d = this.d(s.level);
    var key = s.sortKey || s.rank, m = this.measure(key), dir = s.sortKey ? s.sortDir : (m && m.lowerIsBetter ? "asc" : "desc");
    var rows = d.rows.slice();
    rows.sort(function (a, b) {
      var x = self.val(a, m), y = self.val(b, m);
      var xn = typeof x !== "number", yn = typeof y !== "number";
      if (xn && yn) return a.name.localeCompare(b.name);
      if (xn) return 1; if (yn) return -1;          // no data always sorts last
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
    this.tablePanel.hidden = false;
    var cols = this.columns(), rankM = this.measure(s.rank);
    var all = this.sortedRows();
    // Rank numbers follow the "rank by" measure, independent of column sorting.
    var rankOrder = s.sortKey ? (function () { var k = s.sortKey; s.sortKey = null; var r = self.sortedRows(); s.sortKey = k; return r; })() : all;
    var rankOf = {}, n = 0;
    rankOrder.forEach(function (r) { if (typeof self.val(r, rankM) === "number") rankOf[r.id] = ++n; });
    var rows = all.filter(function (r) { return !s.query || r.name.toLowerCase().indexOf(s.query) >= 0; });
    var shown = s.show && !s.query ? rows.slice(0, s.show) : rows;
    var isZip = s.level === "zip", lvLabel = isZip ? "ZIP" : this.levelLabel(s.level);
    this.tableTitle.textContent = (isZip ? "ZIPs in " + this.parentName() : lvLabel + " rankings") + (this.subLabel() ? ": " + this.subLabel() : "");
    this.backBtn.hidden = !isZip;
    this.search.placeholder = isZip ? "Find a ZIP or town" : "Find a market";
    if (isZip) this.backBtn.textContent = "Back to " + LEVEL_LABELS[s.parent.level] + " rankings";
    this.tableNote.textContent = "Showing " + NF0.format(shown.length) + " of " + NF0.format(all.length) + (isZip ? " ZIPs" : " markets") + ", ranked by " + (rankM ? rankM.label.toLowerCase() : "") + ". Click a column to sort.";

    this.thead.innerHTML = "";
    var hr = el("tr", null, [el("th", { scope: "col", text: "Rank" }), el("th", { scope: "col", text: lvLabel })]);
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

    var frag = document.createDocumentFragment();
    shown.forEach(function (r) {
      var tr = el("tr", { tabindex: "0", "data-id": r.id, "aria-selected": r.id === s.area ? "true" : "false",
        onclick: function () { self.select(r.id, { zoom: true }); },
        onkeydown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); self.select(r.id, { zoom: true }); } } }, [
        el("td", { class: "az-rank num", text: rankOf[r.id] ? String(rankOf[r.id]) : "–" }),
        el("td", { text: r.name })
      ]);
      cols.forEach(function (m) {
        var v = fmt(self.val(r, m), m.format);
        if (v == null && r.u && (m.key === s.rank || m.key.indexOf("score") === 0 || m.key.indexOf("p_") === 0)) tr.appendChild(el("td", { class: "az-na", title: (r.f && r.f[0]) || "Not ranked", text: "Not ranked" }));
        else tr.appendChild(v == null ? el("td", { class: "az-na", title: "No data for this area", text: "No data" }) : el("td", { class: "num", text: v }));
      });
      frag.appendChild(tr);
    });
    this.tbody.innerHTML = "";
    if (!shown.length) this.tbody.appendChild(el("tr", null, [el("td", { colspan: String(cols.length + 2), class: "az-empty", text: "No markets match \u201c" + s.query + "\u201d. Clear the search to see all markets." })]));
    this.tbody.appendChild(frag);
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
    box.appendChild(el("div", null, [el("h2", { text: s.level === "zip" ? "ZIP " + row.name : row.name }), el("div", { class: "az-sub", text: lvLabel + (this.subLabel() ? " · " + this.subLabel() : "") })]));

    var head = this.measure(cfg.headlineMeasure || s.rank);
    if (head && this.availableAt(head, s.level)) {
      var hv = this.val(row, head);
      var rank = null, total = 0;
      if (s.level !== "us" && typeof hv === "number") {
        d.rows.forEach(function (r) { var x = self.val(r, head); if (typeof x === "number") { total++; } });
        rank = 1 + d.rows.filter(function (r) { var x = self.val(r, head); return typeof x === "number" && (head.lowerIsBetter ? x < hv : x > hv); }).length;
      }
      box.appendChild(el("div", { class: "az-score" }, [
        el("b", { class: "num", text: fmt(hv, head.format) == null ? "—" : fmt(hv, head.format) }),
        el("span", { text: hv == null && row.u ? "Not ranked" : head.label + (rank ? ", ranked " + rank + " of " + total + (s.level === "zip" ? " ZIPs in this market" : "") : "") })
      ]));
    }

    var comps = (cfg.components || []).map(function (k) { return self.measure(k); }).filter(function (m) { return m && self.availableAt(m, s.level); });
    if (comps.length) {
      box.appendChild(el("div", { class: "az-bars" }, comps.map(function (m) {
        var v = self.val(row, m), ok = typeof v === "number";
        return el("div", { title: m.help || null }, [
          el("div", { class: "az-bar-label" }, [el("span", { text: m.label }), el("b", { class: "num" + (ok ? "" : " az-na"), text: ok ? fmt(v, m.format) : "No data" })]),
          el("div", { class: "az-track" }, [el("div", { class: "az-fill", style: "width:" + (ok ? Math.max(0, Math.min(100, v)) : 0) + "%" })])
        ]);
      })));
    }

    var details = (cfg.detailMeasures || []).map(function (k) { return self.measure(k); }).filter(Boolean);
    if (details.length) {
      box.appendChild(el("div", { class: "az-measures" }, details.map(function (m) {
        if (!self.availableAt(m, s.level) && m.hideWhenUnavailable) return null;
        if (!self.availableAt(m, s.level)) return el("div", { class: "az-measure", title: m.help || null }, [el("span", { text: m.label }), el("b", { class: "az-na", text: "Not available at this level" })]);
        var v = fmt(self.val(row, m), m.format);
        return el("div", { class: "az-measure", title: m.help || null }, [el("span", { text: m.label }), el("b", { class: "num" + (v == null ? " az-na" : ""), text: v == null ? "No data" : v })]);
      })));
    }
    if (this.cfg.levels.zip && (s.level === "dma" || s.level === "metro")) {
      box.appendChild(el("button", { type: "button", class: "az-btn primary az-drill", text: "See ZIPs in this market", onclick: function () { self.drill(); } }));
    }
    if (s.level === "zip") {
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
    (this.cfg.methodology || []).forEach(function (sec) {
      b.appendChild(el("h3", { text: sec.title }));
      (Array.isArray(sec.body) ? sec.body : [sec.body]).forEach(function (p) { b.appendChild(el("p", { text: p })); });
    });
    var dd = this.d(this.state.level), meta = dd && dd.meta;
    if (meta && meta.built) b.appendChild(el("p", { class: "az-empty", text: "Data built " + meta.built + "." }));
    if (this.modal.showModal) this.modal.showModal(); else this.modal.setAttribute("open", "");
  };
  Analyzer.prototype.exportCSV = function () {
    var self = this, s = this.state;
    var level = s.level, d = this.d(level);
    if (!d) return;
    var cols = this.cfg.measures.filter(function (m) { return self.availableAt(m, level); });
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
      window.addEventListener("hashchange", function () { app.readHash(); app.refresh(); });
      return app;
    },
    format: fmt
  };
})();
