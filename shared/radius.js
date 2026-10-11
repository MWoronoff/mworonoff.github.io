/*
 * Adtaxi ZIP radius audience tool. Shared by the Healthcare, Legal and Higher Education analyzers.
 * A site page loads Leaflet, topojson-client, engine.css, this file and its own config, then calls
 * AdtaxiRadius.start(config, document.getElementById("app")).
 *
 * Audience math (per ZIP): base people x the share of each other selected trait, assuming traits are independent
 * within a ZIP. Gender x age is one Census table, so that part is exact; anything combined with it is an estimate.
 * Traits Census publishes by age (insurance, hearing, vision, living alone, home ownership, health conditions for adults)
 * are applied within each age group, so "hearing difficulty" among people 75+ uses the 75+ rate, not the all-ages rate.
 * A site picks its age groups with cfg.ageSet: "default" (15+, Higher Education), "health" (all ages) or "adult" (18+).
 */
(function () {
  "use strict";

  var AGE = [["15_17", "15–17"], ["18_24", "18–24"], ["25_34", "25–34"], ["35_44", "35–44"], ["45_54", "45–54"], ["55p", "55+"]];
  var AGE_SETS = {
    "default": { options: AGE, col: function (sex, b) { return sex + b; }, all: "acs_pop",
                 note: "Gender and age cover people 15 and older. Leave a group blank to include everyone.",
                 method: "Counts of people by sex and age come from one Census table, so a gender and age selection is an exact count for people 15 and older." },
    health:    { options: [["u18", "Under 18"], ["18_34", "18–34"], ["35_64", "35–64"], ["65_74", "65–74"], ["75p", "75+"]],
                 col: function (sex, b) { return sex + "h" + b; }, all: "acs_pop",
                 note: "Ages cover everyone. Leave a group blank to include everyone.",
                 method: "Counts of people by sex and age come from one Census table, so a gender and age selection is an exact count. The age groups match the ones Census uses for insurance, hearing and vision, so those filters use the rate for each age group." },
    adult:     { options: [["18_24", "18–24"], ["25_34", "25–34"], ["35_44", "35–44"], ["45_54", "45–54"], ["55p", "55+"]],
                 col: function (sex, b) { return sex + b; }, all: "adults18",
                 note: "Counts cover adults 18 and older. Leave a group blank to include every adult.",
                 method: "The audience starts from adults 18 and older. Counts of adults by sex and age come from one Census table, so a gender and age selection is an exact count." }
  };
  // Health conditions (CDC PLACES, adults): any of the selected, treating conditions as independent within a ZIP
  var CONDITIONS = [["diabetes", "Diabetes"], ["bphigh", "High blood pressure"], ["arthritis", "Arthritis"], ["obesity", "Obesity"],
                    ["depression", "Depression"], ["mhlth", "Frequent mental distress"], ["fairpoor", "Fair or poor health"]];
  var VALUES = [["lt200", "Under $200K"], ["200_400", "$200K–$399K"], ["400_750", "$400K–$749K"], ["750p", "$750K+"]];
  var EMPLOY = { emp: "employed", unemp: "unemployed", nilf: "nilf" };
  var FILTERS = {
    gender:   { label: "Gender", type: "multi", options: [["m", "Male"], ["f", "Female"]] },
    age:      { label: "Age", type: "multi", options: AGE },
    income:   { label: "Household income", type: "multi", options: [["lt35", "Under $35K"], ["35_50", "$35K–$49K"], ["50_75", "$50K–$74K"], ["75_100", "$75K–$99K"],
                           ["100_150", "$100K–$149K"], ["150_200", "$150K–$199K"], ["200p", "$200K+"]],
                share: function (c, i, sel) { return ratio(sum(sel, function (b) { return c["inc_" + b][i]; }), c.inc_tot[i]); } },
    parented: { label: "Parents' education (head of household)", type: "multi",
                options: [["nocol", "No college"], ["some", "Some college or associate's"], ["ba", "Bachelor's or higher"]],
                share: function (c, i, sel) { return ratio(sum(sel, function (b) { return c["hhed_" + b][i]; }), c.hhed_tot[i]); } },
    kids:     { label: "Children at home", type: "flag", text: "Households with children under 18", share: function (c, i) { return ratio(c.hh_kids[i], c.hh_tot[i]); } },
    enrolled: { label: "Currently enrolled", type: "flag", text: "In college or graduate school", share: function (c, i) { return ratio(c.enr_college[i], c.enr_tot[i]); } },
    hispanic: { label: "Hispanic or Latino", type: "flag", text: "Hispanic or Latino", share: function (c, i) { return ratio(c.hispanic[i], c.hisp_tot[i]); } },
    spanish:  { label: "Spanish at home", type: "flag", text: "Spanish spoken at home", share: function (c, i) { return ratio(c.lang_spanish[i], c.pop5[i]); } },
    veterans: { label: "Veterans", type: "flag", text: "Civilian veterans 18+", share: function (c, i) { return ratio(c.veterans[i], c.vet_tot[i]); } },
    somecollege: { label: "Some college, no degree", type: "flag", text: "Adults 25+ who started college but didn't finish", share: function (c, i) { return ratio(c.some_college[i], c.adults25[i]); } },
    homeowners: { label: "Homeowners", type: "flag", text: "Owner-occupied households", share: function (c, i) { return ratio(c.owners ? c.owners[i] : null, c.hhed_tot[i]); } },

    // Healthcare (age set "health"): applied within each age group
    insurance: { label: "Health insurance", type: "multi", options: [["ins", "Insured"], ["unins", "Uninsured"]],
                 byAge: function (c, i, b, sel) {
                   var u = ratio(c["unins_" + b][i], c["inst_" + b][i]); if (u == null) return null;
                   return (sel.indexOf("unins") >= 0 ? u : 0) + (sel.indexOf("ins") >= 0 ? 1 - u : 0);
                 } },
    conditions: { label: "Health conditions (adults, any of)", type: "multi", options: CONDITIONS,
                  byAge: function (c, i, b, sel) {
                    if (b === "u18") return 0;
                    var none = 1;
                    for (var k = 0; k < sel.length; k++) { var p = c[sel[k]] ? c[sel[k]][i] : null; if (p == null) return null; none *= 1 - Math.min(1, p / 1000); }
                    return 1 - none;
                  } },
    hearing:  { label: "Hearing difficulty", type: "flag", text: "Hearing difficulty", byAge: function (c, i, b) { return ratio(c["hear_" + b][i], c["civ_" + b][i]); } },
    vision:   { label: "Vision difficulty", type: "flag", text: "Vision difficulty", byAge: function (c, i, b) { return ratio(c["vis_" + b][i], c["civ_" + b][i]); } },
    alone:    { label: "Lives alone", type: "flag", text: "Lives alone (adults)",
                byAge: function (c, i, b) {
                  if (b === "u18") return 0;
                  var g = b === "65_74" || b === "75p" ? "65p" : b;
                  return ratio(c["alone_" + g][i], c["liv_" + g][i]);
                } },

    // Legal (age set "adult")
    home:     { label: "Home", type: "multi", options: [["rent", "Renter"]].concat(VALUES.map(function (x) { return ["own" + x[0], "Owner, home " + x[1]]; })),
                byAge: function (c, i, b, sel) {
                  var o = c["o" + b][i], r = c["r" + b][i]; if (o == null || r == null) return null;
                  var t = o + r; if (!t) return 0;
                  var share = sel.indexOf("rent") >= 0 ? r / t : 0, vt = c.val_tot[i], vs = 0;
                  for (var k = 0; k < VALUES.length; k++) if (sel.indexOf("own" + VALUES[k][0]) >= 0) {
                    var x = c["val_" + VALUES[k][0]][i]; if (x == null || vt == null) return null; vs += vt ? x / vt : 0;
                  }
                  return share + o / t * Math.min(1, vs);
                } },
    employ:   { label: "Employment", type: "multi", options: [["emp", "Employed"], ["unemp", "Unemployed"], ["nilf", "Not in labor force"]],
                share: function (c, i, sel) { return ratio(sum(sel, function (k) { return c[EMPLOY[k]][i]; }), c.pop16[i]); } },
    car:      { label: "Commutes by car", type: "flag", text: "Commutes by car, truck or van",
                share: function (c, i, v, all) {
                  var e = all.employ;
                  if (e && e.length) {   // car commuters are all employed: share within the selected employment groups
                    if (e.indexOf("emp") < 0) return 0;
                    return ratio(c.car_commute[i], sum(e, function (k) { return c[EMPLOY[k]][i]; }));
                  }
                  return ratio(c.car_commute[i], c.pop16[i]);
                } },
    divsep:   { label: "Divorced or separated", type: "flag", text: "Divorced or separated", share: function (c, i) { return ratio(c.divsep[i], c.marital_tot[i]); } },
    poverty:  { label: "Below poverty", type: "flag", text: "Household below the poverty line", share: function (c, i) { return ratio(c.pov_hh[i], c.pov_tot[i]); } },
    lep:      { label: "Limited English", type: "flag", text: "Limited-English household", share: function (c, i) { return ratio(c.lep_hh[i], c.lang_hh[i]); } }
  };
  var CLASSES = [[0, 80, "--ramp-1", "Under 80"], [80, 100, "--ramp-2", "80–99"], [100, 120, "--ramp-3", "100–119"], [120, 150, "--ramp-4", "120–149"], [150, Infinity, "--ramp-5", "150+"]];
  var NF0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  var NF1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function ratio(a, b) { return (a == null || b == null) ? null : (b > 0 ? Math.min(1, a / b) : 0); }
  function sum(arr, f) { var t = 0; for (var k = 0; k < arr.length; k++) { var x = f(arr[k]); if (x == null) return null; t += x; } return t; }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") n.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function miles(lat1, lon1, lat2, lon2) {
    var R = 3958.8, r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function csvCell(s) { s = s == null ? "" : String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  function Radius(cfg, root) {
    this.cfg = cfg; this.root = root; this.geo = {};
    this.ages = AGE_SETS[cfg.ageSet || "default"];
    this.filterDefs = {};
    for (var k in FILTERS) this.filterDefs[k] = FILTERS[k];
    this.filterDefs.age = { label: "Age", type: "multi", options: this.ages.options };
    this.state = { zip: cfg.defaultZip || "", r: cfg.defaultRadius || 25, minIndex: 0, sortKey: "aud", sortDir: "desc", show: 50, sel: {} };
    this.readHash();
  }

  /* ---------- URL state ---------- */
  Radius.prototype.readHash = function () {
    var h = (location.hash || "").replace(/^#/, ""), s = this.state, self = this;
    if (!h) return;
    s.sel = {}; s.minIndex = 0;
    h.split("&").forEach(function (kv) {
      var a = kv.split("="), k = a[0], val = decodeURIComponent(a[1] || "");
      if (k === "zip" && /^\d{5}$/.test(val)) s.zip = val;
      else if (k === "r" && +val > 0) s.r = +val;
      else if (k === "min") s.minIndex = +val || 0;
      else if (k === "f" && val) val.split(";").forEach(function (part) {
        var p = part.split(":"), f = self.filterDefs[p[0]];
        if (!f || self.cfg.filters.indexOf(p[0]) < 0) return;
        if (f.type === "flag") { s.sel[p[0]] = true; return; }
        var opts = (p[1] || "").split(",").filter(function (o) { return f.options.some(function (x) { return x[0] === o; }); });
        if (opts.length) s.sel[p[0]] = opts;
      });
    });
  };
  Radius.prototype.writeHash = function () {
    var s = this.state, f = [];
    Object.keys(s.sel).forEach(function (k) {
      var v = s.sel[k];
      if (v === true) f.push(k); else if (v && v.length) f.push(k + ":" + v.join(","));
    });
    var h = "#zip=" + s.zip + "&r=" + s.r + (s.minIndex ? "&min=" + s.minIndex : "") + (f.length ? "&f=" + encodeURIComponent(f.join(";")) : "");
    if (location.hash !== h) history.replaceState(null, "", h);
  };

  /* ---------- Layout ---------- */
  Radius.prototype.build = function () {
    var cfg = this.cfg, self = this, s = this.state;
    document.title = cfg.title;
    var links = (cfg.links || []).map(function (l) { return el("a", { href: l.url, text: l.label }); });
    var header = el("header", { class: "az-header" }, [el("div", { class: "az-header-inner" }, [
      el("div", { class: "az-title" }, [el("h1", { text: cfg.title }), el("p", { text: cfg.subtitle || "" }),
        links.length ? el("nav", { class: "az-links", "aria-label": "Related tools" }, links) : null]),
      el("img", { class: "az-logo", src: cfg.logo || "../shared/adtaxi-logo.svg", alt: "Adtaxi" })])]);

    this.zipIn = el("input", { type: "text", inputmode: "search", list: "rz-towns", placeholder: "ZIP or town", "aria-label": "Center ZIP or town", value: s.zip,
      onchange: function () { self.setCenter(this.value); }, onkeydown: function (e) { if (e.key === "Enter") self.setCenter(this.value); },
      oninput: function () { self.suggest(this.value); } });
    this.towns = el("datalist", { id: "rz-towns" });
    this.rSel = el("select", { "aria-label": "Radius", onchange: function () { s.r = +this.value; self.update(true); } },
      (function () {
        var radii = (cfg.radii || [5, 10, 15, 25, 50]).slice();
        if (radii.indexOf(s.r) < 0) { radii.push(s.r); radii.sort(function (a, b) { return a - b; }); }   // keep a radius from a shared link
        return radii.map(function (r) { return el("option", { value: r, text: (cfg.radiusLabel || "{r} miles").replace("{r}", r) }); });
      })());
    this.minSel = el("select", { "aria-label": "Show", onchange: function () { s.minIndex = +this.value; self.update(false); } },
      [[0, "All ZIPs in range"], [100, "Index 100+"], [120, "Index 120+"], [150, "Index 150+"]].map(function (o) { return el("option", { value: o[0], text: o[1] }); }));
    var controls = el("section", { class: "az-controls", "aria-label": "Radius controls" }, [
      el("label", { class: "az-field" }, [el("span", { text: "Center" }), this.zipIn, this.towns]),
      el("label", { class: "az-field" }, [el("span", { text: "Radius" }), this.rSel]),
      el("label", { class: "az-field" }, [el("span", { text: "Show" }), this.minSel]),
      el("div", { class: "az-actions" }, [
        el("button", { type: "button", class: "az-btn", text: "How estimates work", onclick: function () { self.openMethod(); } }),
        el("button", { type: "button", class: "az-btn primary", text: "Export ZIP list", onclick: function () { self.exportCSV(); } })])]);
    this.errorBox = el("div", { class: "az-error", role: "alert", hidden: true });

    // Filters: multi-choice groups as chips, yes/no filters together under one heading
    var defs = this.filterDefs;
    var flags = cfg.filters.filter(function (k) { return defs[k].type === "flag"; });
    var groups = cfg.filters.filter(function (k) { return defs[k].type !== "flag"; }).map(function (key) {
      var f = defs[key];
      return el("fieldset", { class: "rz-group" }, [el("legend", { text: f.label }), el("div", { class: "rz-chips" }, f.options.map(function (o) {
        return el("label", { class: "rz-chip" }, [el("input", { type: "checkbox", "data-f": key, value: o[0], onchange: function () {
          var cur = s.sel[key] || [], i = cur.indexOf(o[0]);
          if (this.checked && i < 0) cur.push(o[0]); if (!this.checked && i >= 0) cur.splice(i, 1);
          if (cur.length) s.sel[key] = cur; else delete s.sel[key];
          self.update(false);
        } }), el("span", { text: o[1] })]);
      }))]);
    });
    if (flags.length) groups.push(el("fieldset", { class: "rz-group rz-flags" }, [el("legend", { text: cfg.flagsLabel || "Narrow to" })].concat(flags.map(function (key) {
      var f = defs[key];
      return el("label", { class: "rz-check", title: f.label }, [el("input", { type: "checkbox", "data-f": key, onchange: function () { if (this.checked) s.sel[key] = true; else delete s.sel[key]; self.update(false); } }), el("span", { text: f.text })]);
    }))));
    var presets = (cfg.presets || []).length ? el("div", { class: "rz-presets" }, [el("span", { class: "rz-presets-label", text: "Start from" })].concat(cfg.presets.map(function (p) {
      return el("button", { type: "button", class: "az-btn", text: p.label, onclick: function () { s.sel = JSON.parse(JSON.stringify(p.sel)); self.syncFilters(); self.update(false); } });
    }))) : null;
    this.filterPanel = el("aside", { class: "az-panel rz-filters", "aria-label": "Audience filters" }, [
      el("div", { class: "rz-filters-head" }, [el("h2", { text: "Audience" }),
        el("button", { type: "button", class: "rz-clear", text: "Clear all", onclick: function () { s.sel = {}; self.syncFilters(); self.update(false); } })]),
      presets].concat(groups).concat([el("p", { class: "rz-note", text: this.ages.note })]));

    // Summary + map
    this.summary = el("div", { class: "rz-summary", "aria-live": "polite" });
    this.legend = el("div", { class: "az-legend", "aria-label": "Map legend" });
    this.mapEl = el("div", { class: "az-map rz-map", role: "region", "aria-label": "Map of ZIPs in the radius" });
    var right = el("div", { class: "rz-right" }, [this.summary, el("div", { class: "az-panel az-map-panel" }, [this.mapEl, this.legend])]);

    // Table
    this.tableTitle = el("h2"); this.tableNote = el("span");
    this.thead = el("thead"); this.tbody = el("tbody");
    var table = el("section", { class: "az-panel az-table-panel" }, [el("div", { class: "az-table-head" }, [this.tableTitle, this.tableNote]),
      el("div", { class: "az-tablewrap" }, [el("table", { class: "az-table" }, [this.thead, this.tbody])])]);
    this.modalBody = el("div", { class: "az-modal-body" });
    this.modal = el("dialog", { class: "az-modal", "aria-labelledby": "rz-method-title" }, [this.modalBody]);
    var sources = el("section", { class: "az-panel az-sources" }, [el("h2", { text: "Sources" }), this.sourcesP = el("p")]);

    var main = el("main", { class: "az-main" }, [controls, this.errorBox, el("section", { class: "rz-stage" }, [this.filterPanel, right]), table, sources]);
    this.root.innerHTML = ""; this.root.appendChild(header); this.root.appendChild(main); this.root.appendChild(this.modal);
    this.rSel.value = String(s.r); this.minSel.value = String(s.minIndex);
    this.syncFilters();

    this.map = L.map(this.mapEl, { zoomControl: false, zoomSnap: 0.25, minZoom: 3, maxZoom: 12 });
    L.control.zoom({ position: "topright" }).addTo(this.map);
    this.map.attributionControl.setPrefix(false);
    this.map.attributionControl.addAttribution("Boundaries: U.S. Census Bureau");
    this.map.fitBounds([[24.4, -125], [49.5, -66.9]]);
  };
  Radius.prototype.syncFilters = function () {
    var s = this.state;
    Array.prototype.forEach.call(this.filterPanel.querySelectorAll("input[data-f]"), function (inp) {
      var v = s.sel[inp.getAttribute("data-f")];
      inp.checked = inp.value && inp.value !== "on" ? !!(v && v.indexOf && v.indexOf(inp.value) >= 0) : v === true;
    });
  };

  /* ---------- Data ---------- */
  Radius.prototype.load = function () {
    var self = this;
    return fetch(this.cfg.audienceData).then(function (r) {
      if (!r.ok) throw new Error("Couldn't load the ZIP audience data (HTTP " + r.status + ")");
      return r.json();
    }).then(function (d) {
      self.c = d.cols; self.meta = d.meta; self.n = d.cols.zip.length;
      self.byZip = {}; for (var i = 0; i < self.n; i++) self.byZip[d.cols.zip[i]] = i;
      self.sourcesP.textContent = [d.meta.sources.acs, d.meta.sources.geo, "ZIP boundaries: Census ZIP Code Tabulation Areas"]
        .concat((self.cfg.extraData || []).map(function (x) { return x.source; }).filter(Boolean)).join(" · ") + ". Data built " + d.meta.built + ".";
      return Promise.all((self.cfg.extraData || []).map(function (x) { return self.loadExtra(x); }));
    });
  };
  // Extra ZIP columns from a site's own build (e.g. Healthcare condition rates), joined to the audience data by ZIP
  Radius.prototype.loadExtra = function (x) {
    var self = this;
    return fetch(x.url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      var zips = d.cols.zip;
      Object.keys(d.cols).forEach(function (k) {
        if (k === "zip") return;
        var arr = new Array(self.n).fill(null), src = d.cols[k];
        for (var j = 0; j < zips.length; j++) { var i = self.byZip[zips[j]]; if (i !== undefined) arr[i] = src[j]; }
        self.c[k] = arr;
      });
    }).catch(function (e) {
      (x.columns || []).forEach(function (k) { if (!self.c[k]) self.c[k] = new Array(self.n).fill(null); });
      self.showError((x.label || "Some data") + " couldn't load (" + e.message + "), so those filters show no data. Refresh to try again.");
    });
  };
  Radius.prototype.suggest = function (q) {
    q = (q || "").trim().toLowerCase();
    this.towns.innerHTML = "";
    if (q.length < 3 || /^\d+$/.test(q) || !this.c) return;
    var c = this.c, hits = [];
    for (var i = 0; i < this.n; i++) if (c.city[i] && c.city[i].toLowerCase().indexOf(q) === 0 && c.population[i] > 0) hits.push(i);
    hits.sort(function (a, b) { return c.population[b] - c.population[a]; });
    var seen = {}, self = this;
    hits.forEach(function (i) {
      var key = c.city[i] + ", " + c.state[i];
      if (seen[key] || Object.keys(seen).length >= 8) return; seen[key] = 1;
      self.towns.appendChild(el("option", { value: c.zip[i] + " " + key }));
    });
  };
  Radius.prototype.setCenter = function (txt) {
    var m = /(\d{5})/.exec(txt || ""), c = this.c, zip = null;
    if (m && this.byZip[m[1]] !== undefined) zip = m[1];
    else if (txt && c) {   // town name: use its most populous ZIP
      var q = txt.replace(/,.*$/, "").trim().toLowerCase(), best = -1;
      for (var i = 0; i < this.n; i++) if (c.city[i] && c.city[i].toLowerCase() === q && (best < 0 || c.population[i] > c.population[best])) best = i;
      if (best >= 0) zip = c.zip[best];
    }
    if (!zip) { this.showError("Enter a 5-digit ZIP or a town name, such as 80202 or Denver."); return; }
    this.errorBox.hidden = true;
    this.state.zip = zip;
    this.zipIn.value = zip + " " + c.city[this.byZip[zip]] + ", " + c.state[this.byZip[zip]];
    this.update(true);
  };
  Radius.prototype.showError = function (t) { this.errorBox.hidden = false; this.errorBox.textContent = t; };

  /* ---------- Audience math ---------- */
  Radius.prototype.audience = function (i) {
    var c = this.c, sel = this.state.sel, defs = this.filterDefs, ages = this.ages, base;
    var g = sel.gender && sel.gender.length ? sel.gender : null, a = sel.age && sel.age.length ? sel.age : null;
    var keys = Object.keys(sel), byAge = keys.filter(function (k) { return defs[k].byAge; });
    if (g || a || byAge.length) {
      // Add up sex x age cells; traits Census publishes by age are applied with each age group's own rate
      var sexes = g || ["m", "f"], groups = a || ages.options.map(function (x) { return x[0]; });
      base = 0;
      for (var si = 0; si < sexes.length; si++) for (var ai = 0; ai < groups.length; ai++) {
        var v = c[ages.col(sexes[si], groups[ai])][i]; if (v == null) return null;
        for (var bk = 0; bk < byAge.length && v > 0; bk++) {
          var sa = defs[byAge[bk]].byAge(c, i, groups[ai], sel[byAge[bk]], sel); if (sa == null) return null;
          v *= sa;
        }
        base += v;
      }
    } else base = c[ages.all][i];
    if (base == null) return null;
    if (base === 0) return 0;
    for (var k = 0; k < keys.length; k++) {
      var f = defs[keys[k]]; if (!f.share) continue;
      var sh = f.share(c, i, sel[keys[k]], sel); if (sh == null) return null;
      base *= sh;
    }
    return base;
  };
  Radius.prototype.isEstimate = function () {
    var sel = this.state.sel, defs = this.filterDefs;
    return Object.keys(sel).some(function (k) { return defs[k].share || defs[k].byAge; });
  };
  Radius.prototype.computeNational = function () {
    var A = 0, P = 0;
    for (var i = 0; i < this.n; i++) {
      var a = this.audience(i), p = this.c.acs_pop[i];
      if (a != null && p) { A += a; P += p; }
    }
    this.natRate = P ? A / P : 0;
  };

  /* ---------- Update ---------- */
  Radius.prototype.update = function (moved) {
    var s = this.state, c = this.c;
    if (!c) return;
    var ci = this.byZip[s.zip];
    if (ci === undefined) { this.renderEmpty(); return; }
    this.computeNational();
    var lat0 = c.lat[ci], lon0 = c.lon[ci], rows = [];
    var dLat = s.r / 69, dLon = s.r / (69 * Math.cos(lat0 * Math.PI / 180));   // quick bounding box first
    for (var i = 0; i < this.n; i++) {
      if (Math.abs(c.lat[i] - lat0) > dLat || Math.abs(c.lon[i] - lon0) > dLon) continue;
      var d = miles(lat0, lon0, c.lat[i], c.lon[i]); if (d > s.r) continue;
      var pop = c.acs_pop[i];
      if (!pop && !c.population[i]) continue;
      var aud = this.audience(i), share = aud != null && pop ? aud / pop : null;
      rows.push({ i: i, zip: c.zip[i], town: c.city[i] + ", " + c.state[i], dist: d, pop: pop, aud: aud, share: share,
                  idx: share != null && this.natRate ? share / this.natRate * 100 : null, dma: c.dma[i] });
    }
    this.rows = rows;
    this.writeHash();
    this.renderSummary();
    this.renderTable();
    this.renderMap(moved);
  };
  Radius.prototype.visible = function () {
    var m = this.state.minIndex;
    return m ? this.rows.filter(function (r) { return r.idx != null && r.idx >= m; }) : this.rows;
  };
  Radius.prototype.renderEmpty = function () {
    this.summary.innerHTML = "";
    this.summary.appendChild(el("p", { class: "az-empty", text: "Enter a ZIP or town to see the audience around it." }));
    this.tbody.innerHTML = ""; this.thead.innerHTML = ""; this.tableTitle.textContent = "ZIPs in range"; this.tableNote.textContent = "";
  };
  Radius.prototype.renderSummary = function () {
    var s = this.state, c = this.c, rows = this.visible(), A = 0, P = 0;
    rows.forEach(function (r) { if (r.aud != null) { A += r.aud; P += r.pop || 0; } });
    var share = P ? A / P : null, idx = share != null && this.natRate ? share / this.natRate * 100 : null, est = this.isEstimate();
    var ci = this.byZip[s.zip];
    this.summary.innerHTML = "";
    var stat = function (val, label) { return el("div", { class: "rz-stat" }, [el("b", { class: "num", text: val }), el("span", { text: label })]); };
    this.summary.appendChild(el("div", { class: "rz-stat rz-stat-main" }, [
      el("b", { class: "num", text: NF0.format(Math.round(A)) }),
      el("span", { text: (est ? "Estimated audience" : "Audience") + " within " + s.r + " miles of " + s.zip + " " + c.city[ci] + ", " + c.state[ci] + (s.minIndex ? " (ZIPs at index " + s.minIndex + "+)" : "") })]));
    this.summary.appendChild(stat(share == null ? "—" : NF1.format(share * 100) + "%", "Share of population"));
    this.summary.appendChild(stat(idx == null ? "—" : NF0.format(idx), "Index vs. U.S. (100 = average)"));
    this.summary.appendChild(stat(NF0.format(rows.length), "ZIPs"));
    this.summary.appendChild(stat(NF0.format(P), "Population"));
  };
  Radius.prototype.renderTable = function () {
    var self = this, s = this.state, rows = this.visible().slice(), est = this.isEstimate();
    var cols = [["zip", "ZIP", "l"], ["town", "Town", "l"], ["dist", "Miles", "n"], ["pop", "Population", "n"], ["aud", est ? "Est. audience" : "Audience", "n"], ["share", "Share", "n"], ["idx", "Index", "n"]];
    var k = s.sortKey, dir = s.sortDir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return typeof x === "string" ? dir * x.localeCompare(y) : dir * (x - y);
    });
    this.tableTitle.textContent = "ZIPs within " + s.r + " miles";
    this.tableNote.textContent = (rows.length > s.show ? "Showing " + s.show + " of " + NF0.format(rows.length) + " ZIPs. Export includes all." : NF0.format(rows.length) + " ZIPs.") + " Click a column to sort.";
    this.thead.innerHTML = "";
    var hr = el("tr");
    cols.forEach(function (cdef) {
      var active = k === cdef[0];
      hr.appendChild(el("th", { scope: "col", class: cdef[2] === "l" ? "rz-l" : null, "aria-sort": active ? (s.sortDir === "asc" ? "ascending" : "descending") : null }, [
        el("button", { type: "button", text: cdef[1], onclick: function () {
          if (s.sortKey === cdef[0]) s.sortDir = s.sortDir === "asc" ? "desc" : "asc";
          else { s.sortKey = cdef[0]; s.sortDir = cdef[2] === "l" || cdef[0] === "dist" ? "asc" : "desc"; }
          self.renderTable();
        } })]));
    });
    this.thead.appendChild(hr);
    this.tbody.innerHTML = "";
    var frag = document.createDocumentFragment();
    rows.slice(0, s.show).forEach(function (r) {
      frag.appendChild(el("tr", { tabindex: "0", onclick: function () { self.flash(r.zip); }, onkeydown: function (e) { if (e.key === "Enter") self.flash(r.zip); } }, [
        el("td", { class: "rz-l num", text: r.zip }), el("td", { class: "rz-l", text: r.town }),
        el("td", { class: "num", text: NF1.format(r.dist) }), el("td", { class: "num", text: r.pop == null ? "—" : NF0.format(r.pop) }),
        el("td", { class: "num", text: r.aud == null ? "No data" : NF0.format(Math.round(r.aud)) }),
        el("td", { class: "num", text: r.share == null ? "—" : NF1.format(r.share * 100) + "%" }),
        el("td", { class: "num", text: r.idx == null ? "—" : NF0.format(r.idx) })]));
    });
    if (!rows.length) frag.appendChild(el("tr", null, [el("td", { colspan: "7", class: "az-empty", text: "No ZIPs meet the index cutoff. Lower the Show setting or widen the radius." })]));
    this.tbody.appendChild(frag);
    if (rows.length > s.show) this.tbody.appendChild(el("tr", null, [el("td", { colspan: "7" }, [el("button", { type: "button", class: "az-btn", text: "Show all " + NF0.format(rows.length), onclick: function () { s.show = 1e9; self.renderTable(); } })])]));
  };

  /* ---------- Map ---------- */
  Radius.prototype.colorFor = function (idx) {
    if (idx == null) return cssVar("--nodata");
    for (var k = 0; k < CLASSES.length; k++) if (idx >= CLASSES[k][0] && idx < CLASSES[k][1]) return cssVar(CLASSES[k][2]);
    return cssVar("--nodata");
  };
  Radius.prototype.renderMap = function (moved) {
    var self = this, s = this.state, c = this.c, ci = this.byZip[s.zip];
    var center = [c.lat[ci], c.lon[ci]];
    if (this.circle) this.map.removeLayer(this.circle);
    if (this.centerMark) this.map.removeLayer(this.centerMark);
    this.circle = L.circle(center, { radius: s.r * 1609.34, color: "#0f2742", weight: 2, dashArray: "6 5", fill: false, interactive: false }).addTo(this.map);
    this.centerMark = L.circleMarker(center, { radius: 6, color: "#fff", weight: 2, fillColor: "#0f2742", fillOpacity: 1 }).bindTooltip("Center: " + s.zip).addTo(this.map);
    if (moved) this.map.fitBounds(this.circle.getBounds(), { padding: [16, 16] });
    var byZip = {}, vis = {}, dmas = {};
    this.rows.forEach(function (r) { byZip[r.zip] = r; if (r.dma && r.dma !== "0") dmas[r.dma] = 1; });
    this.visible().forEach(function (r) { vis[r.zip] = 1; });
    var urls = Object.keys(dmas).map(function (d) { return self.cfg.zipGeo.replace("{level}", "dma").replace("{id}", d); });
    var token = this.mapToken = (this.mapToken || 0) + 1;
    Promise.all(urls.map(function (u) {
      if (u in self.geo) return Promise.resolve();
      return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).then(function (t) {
        self.geo[u] = t ? topojson.feature(t, t.objects[Object.keys(t.objects)[0]]) : null;
      }).catch(function () { self.geo[u] = null; });
    })).then(function () {
      if (token !== self.mapToken) return;   // a newer update has started
      if (self.zipLayer) self.map.removeLayer(self.zipLayer);
      var feats = [];
      urls.forEach(function (u) { var fc = self.geo[u]; if (fc) fc.features.forEach(function (f) { if (byZip[f.properties.zip]) feats.push(f); }); });
      self.layerByZip = {};
      // Thousands of ZIP outlines (100+ mile radii) draw much faster on a canvas than as separate SVG shapes
      if (feats.length > 1200 && !self.canvas) self.canvas = L.canvas({ padding: 0.3 });
      self.zipLayer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
        renderer: feats.length > 1200 ? self.canvas : undefined,
        style: function (f) {
          var r = byZip[f.properties.zip], on = vis[f.properties.zip];
          return { color: "#ffffff", weight: 0.7, fillOpacity: on ? 0.9 : 0.25, fillColor: self.colorFor(r && r.idx) };
        },
        onEachFeature: function (f, layer) {
          var r = byZip[f.properties.zip]; self.layerByZip[f.properties.zip] = layer;
          layer.bindTooltip(function () {
            return '<div class="az-tip"><b>' + r.zip + " " + r.town + "</b><br>" + (r.aud == null ? "No data" : NF0.format(Math.round(r.aud)) + " people, index " + (r.idx == null ? "—" : NF0.format(r.idx))) + "</div>";
          }, { sticky: true, opacity: 0.97 });
        }
      }).addTo(self.map);
      self.circle.bringToFront(); self.centerMark.bringToFront();
    });
    this.legend.innerHTML = "";
    this.legend.appendChild(el("div", { class: "az-legend-row" }, [el("b", { text: "Index vs. U.S." })]));
    for (var k = CLASSES.length - 1; k >= 0; k--) this.legend.appendChild(el("div", { class: "az-legend-row" }, [el("span", { class: "az-swatch", style: "background:" + cssVar(CLASSES[k][2]) }), el("span", { text: CLASSES[k][3] })]));
    this.legend.appendChild(el("div", { class: "az-legend-row" }, [el("span", { class: "az-swatch nodata" }), el("span", { text: "No data" })]));
  };
  Radius.prototype.flash = function (zip) {
    var l = this.layerByZip && this.layerByZip[zip];
    if (!l) return;
    this.map.fitBounds(l.getBounds(), { maxZoom: 11, padding: [60, 60] });
    l.setStyle({ color: "#0f2742", weight: 3 }); l.bringToFront(); l.openTooltip();
    setTimeout(function () { l.setStyle({ color: "#ffffff", weight: 0.7 }); }, 2500);
  };

  /* ---------- Export + methodology ---------- */
  Radius.prototype.describe = function () {
    var sel = this.state.sel, parts = [], defs = this.filterDefs;
    this.cfg.filters.forEach(function (k) {
      var f = defs[k], v = sel[k];
      if (!v) return;
      if (v === true) parts.push(f.text);
      else parts.push(f.label + ": " + v.map(function (o) { return f.options.filter(function (x) { return x[0] === o; })[0][1]; }).join(", "));
    });
    return parts.length ? parts.join("; ") : "Everyone";
  };
  Radius.prototype.exportCSV = function () {
    if (!this.rows) return;
    var s = this.state, est = this.isEstimate();
    var rows = this.visible().slice().sort(function (a, b) { return (b.aud || 0) - (a.aud || 0); });
    var lines = [["ZIP", "Town", "Miles from center", "Population", est ? "Estimated audience" : "Audience", "Audience share", "Index vs US", "Audience definition"].map(csvCell).join(",")];
    var def = this.describe();
    rows.forEach(function (r) {
      lines.push([r.zip, r.town, r.dist.toFixed(1), r.pop, r.aud == null ? "" : Math.round(r.aud), r.share == null ? "" : (r.share * 100).toFixed(1) + "%", r.idx == null ? "" : Math.round(r.idx), def].map(csvCell).join(","));
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = el("a", { href: URL.createObjectURL(blob), download: (this.cfg.exportName || "adtaxi-radius") + "-" + s.zip + "-" + s.r + "mi.csv" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  };
  Radius.prototype.openMethod = function () {
    var self = this, b = this.modalBody;
    b.innerHTML = "";
    b.appendChild(el("button", { type: "button", class: "az-modal-close", "aria-label": "Close", text: "×", onclick: function () { self.modal.close(); } }));
    b.appendChild(el("h2", { id: "rz-method-title", text: "How estimates work" }));
    var defs = this.filterDefs, cf = this.cfg.filters;
    var noun = function (k) {   // filter label as a noun in a sentence: "Hispanic or Latino" keeps its capital
      var t = defs[k].label.replace(/ \(.*\)$/, "").replace(", no degree", " without a degree");
      return /^(Hispanic|Spanish)/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
    };
    var traits = cf.filter(function (k) { return k !== "gender" && k !== "age"; }).map(noun);
    var aged = cf.filter(function (k) { return defs[k].byAge; }).map(noun);
    var list = function (a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; };
    var secs = [
      ["Which ZIPs are included", "A ZIP is in range when its center point is inside the circle. PO box and business-only ZIPs with no residents are left out."],
      ["Gender and age", this.ages.method],
      ["Everything else is an estimate", list(traits).replace(/^./, function (x) { return x.toUpperCase(); }) + " come from separate tables. The tool multiplies the base count by each trait's share in that ZIP, which assumes the traits are independent within a ZIP. That's the standard approach, but real overlaps can be higher or lower, so combined counts are labeled as estimates."]
    ];
    if (aged.length) secs.push(["Traits applied by age group", list(aged).replace(/^./, function (x) { return x.toUpperCase(); }) + " are published by age, so the tool applies each age group's own rate in each ZIP. For example, hearing difficulty among people 75 and older uses the 75+ rate, which is far higher than the rate for all ages."]);
    if (cf.indexOf("parented") >= 0) secs.push(["Parents' education", "This is the education of the head of household in every household in the ZIP. Combine it with Children at home to estimate households with children whose head of household has no college."]);
    secs.push(["Index vs. U.S.", "A ZIP's audience share of its population, divided by the same share nationally, times 100. Above 100 means the audience is more concentrated there than in the U.S. overall."]);
    secs = secs.concat((this.cfg.methodology || []).map(function (m) { return [m.title, m.body]; }));
    secs.forEach(function (x) { b.appendChild(el("h3", { text: x[0] })); b.appendChild(el("p", { text: x[1] })); });
    if (this.meta) b.appendChild(el("p", { class: "az-empty", text: "Census ACS " + this.meta.acsYears + ". Data built " + this.meta.built + "." }));
    if (this.modal.showModal) this.modal.showModal(); else this.modal.setAttribute("open", "");
  };

  window.AdtaxiRadius = {
    start: function (cfg, root) {
      var app = new Radius(cfg, root || document.getElementById("app"));
      app.build();
      app.load().then(function () {
        if (app.state.zip && app.byZip[app.state.zip] !== undefined) {
          var c = app.c, i = app.byZip[app.state.zip];
          app.zipIn.value = app.state.zip + " " + c.city[i] + ", " + c.state[i];
          app.update(true);
        } else app.renderEmpty();
      }).catch(function (e) { app.showError(e.message + ". Refresh the page; if it keeps happening, the audience data hasn't been built yet."); });
      window.addEventListener("hashchange", function () {
        if (!app.c) return;
        app.readHash(); app.syncFilters();
        app.rSel.value = String(app.state.r); app.minSel.value = String(app.state.minIndex);
        var i = app.byZip[app.state.zip];
        if (i !== undefined) app.zipIn.value = app.state.zip + " " + app.c.city[i] + ", " + app.c.state[i];
        app.update(true);
      });
      return app;
    },
    filters: FILTERS
  };
})();
