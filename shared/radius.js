/*
 * Adtaxi ZIP radius audience tool. Shared by the Healthcare, Legal, Higher Education, Home Services and Apartment analyzers.
 * A site page loads Leaflet, topojson-client, engine.css, this file and its own config, then calls
 * AdtaxiRadius.start(config, document.getElementById("app")).
 *
 * Audience math (per ZIP): base people x the share of each other selected trait, assuming traits are independent
 * within a ZIP. Gender x age is one Census table, so that part is exact; anything combined with it is an estimate.
 * Traits Census publishes by age (insurance, hearing, vision, living alone, home ownership, health conditions for adults)
 * are applied within each age group, so "hearing difficulty" among people 75+ uses the 75+ rate, not the all-ages rate.
 * A site picks its age groups with cfg.ageSet: "default" (15+, Higher Education), "health" (all ages) or "adult" (18+).
 * Best-prospect profiles (cfg.profiles): a category's starting audience. A profile's "either" list adds an or-condition
 * (e.g. 65+ OR diabetes), combined within each sex x age group as 1 - (1 - a)(1 - b), treating the two as independent.
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
  var INC4 = { lt50: ["lt35", "35_50"], "50_100": ["50_75", "75_100"], "100_150": ["100_150"], "150p": ["150_200", "200p"] };   // fewer income bands
  var INC5 = { lt50: ["lt35", "35_50"], "50_75": ["50_75"], "75_100": ["75_100"], "100_150": ["100_150"], "150p": ["150_200", "200p"] };
  var BUILT = [["pre1980", "Before 1980"], ["80_99", "1980–1999"], ["2000p", "2000 or later"]];
  var VALUES = [["lt200", "Under $200K"], ["200_400", "$200K–$399K"], ["400_750", "$400K–$749K"], ["750p", "$750K+"]];
  var EMPLOY = { emp: "employed", unemp: "unemployed", nilf: "nilf" };
  var RINC = [["lt35", "Under $35K"], ["35_50", "$35K–$49K"], ["50_75", "$50K–$74K"], ["75_100", "$75K–$99K"], ["100_150", "$100K–$149K"], ["150p", "$150K+"]];
  var FILTERS = {
    gender:   { label: "Gender", type: "multi", options: [["m", "Male"], ["f", "Female"]] },
    age:      { label: "Age", type: "multi", options: AGE },
    income:   { label: "Household income", type: "multi", options: [["lt35", "Under $35K"], ["35_50", "$35K–$49K"], ["50_75", "$50K–$74K"], ["75_100", "$75K–$99K"],
                           ["100_150", "$100K–$149K"], ["150_200", "$150K–$199K"], ["200p", "$200K+"]],
                share: function (c, i, sel) { return ratio(sum(sel, function (b) { return c["inc_" + b][i]; }), c.inc_tot[i]); } },
    income4:  { label: "Household income", type: "multi", options: [["lt50", "Under $50K"], ["50_100", "$50K–$99K"], ["100_150", "$100K–$149K"], ["150p", "$150K+"]],
                share: function (c, i, sel) { return ratio(sum(sel, function (b) { return sum(INC4[b], function (x) { return c["inc_" + x][i]; }); }), c.inc_tot[i]); } },
    income5:  { label: "Household income", type: "multi", options: [["lt50", "Under $50K"], ["50_75", "$50K–$74K"], ["75_100", "$75K–$99K"], ["100_150", "$100K–$149K"], ["150p", "$150K+"]],
                share: function (c, i, sel) { return ratio(sum(sel, function (b) { return sum(INC5[b], function (x) { return c["inc_" + x][i]; }); }), c.inc_tot[i]); } },
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
    nodental: { label: "No recent dental visit", type: "flag", text: "No dental visit in the past year (adults)",
                byAge: function (c, i, b) { if (b === "u18") return 0; var p = c.nodental ? c.nodental[i] : null; return p == null ? null : Math.min(1, p / 1000); } },
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
    lep:      { label: "Limited English", type: "flag", text: "Limited-English household", share: function (c, i) { return ratio(c.lep_hh[i], c.lang_hh[i]); } },

    // Home Services (age set "adult"): owner homes. The first owner filter selected applies the homeowner rate for each
    // age group; the others apply their share among owner homes, so owners aren't counted twice.
    built:    { label: "Owner home built", type: "multi", options: BUILT,
                byAge: function (c, i, b, sel, all) {
                  var t = c.hb_tot[i], o = ownerPart(c, i, b, all, "built"); if (o == null || t == null) return null;
                  var x = sum(sel, function (k) { return c["hb_" + k][i]; }); if (x == null) return null;
                  return t ? o * Math.min(1, x / t) : 0;
                } },
    ownval:   { label: "Owner home value", type: "multi", options: VALUES,
                byAge: function (c, i, b, sel, all) {
                  var t = c.val_tot[i], o = ownerPart(c, i, b, all, "ownval"); if (o == null || t == null) return null;
                  var x = sum(sel, function (k) { return c["val_" + k][i]; }); if (x == null) return null;
                  return t ? o * Math.min(1, x / t) : 0;
                } },
    sfd:      { label: "Single-family detached", type: "flag", text: "Owner home is a single-family detached house",
                byAge: function (c, i, b, v, all) { var o = ownerPart(c, i, b, all, "sfd"), x = ratio(c.sfd_own[i], c.hu_tot[i]); return o == null || x == null ? null : o * x; } },
    longten:  { label: "Owned since before 2010", type: "flag", text: "Owner has lived in the home since before 2010",
                byAge: function (c, i, b, v, all) { var o = ownerPart(c, i, b, all, "longten"), x = ratio(c.lt_own[i], c.hm_tot[i]); return o == null || x == null ? null : o * x; } },

    // Apartment (age set "adult"): renter households. The first renter filter selected applies the renter rate for each
    // age group; the others apply their share among renter households, so renters aren't counted twice.
    renter:   { label: "Renters", type: "flag", text: "Rents their home",
                byAge: function (c, i, b, v, all) { return renterPart(c, i, b, all, "renter"); } },
    rinc:     { label: "Renter household income", type: "multi", options: RINC,
                byAge: function (c, i, b, sel, all) {
                  var r = renterPart(c, i, b, all, "rinc"), t = c.rinc_tot ? c.rinc_tot[i] : null; if (r == null || t == null) return null;
                  var x = sum(sel, function (k) { return c["rinc_" + k][i]; }); if (x == null) return null;
                  return t ? r * Math.min(1, x / t) : 0;
                } },
    rtype:    { label: "Rental type", type: "multi", options: [["apt", "Apartment building (5+ units)"], ["sfd", "Single-family house"]],
                byAge: function (c, i, b, sel, all) {
                  var r = renterPart(c, i, b, all, "rtype"), t = c.r_tot ? c.r_tot[i] : null; if (r == null || t == null) return null;
                  var x = sum(sel, function (k) { return c[k === "apt" ? "r_5p" : "r_sfd"][i]; }); if (x == null) return null;
                  return t ? r * Math.min(1, x / t) : 0;
                } },
    rmoved:   { label: "Recent movers", type: "flag", text: "Renter who moved in 2020 or later",
                byAge: function (c, i, b, v, all) { var r = renterPart(c, i, b, all, "rmoved"), x = ratio(c.r_moved20[i], c.r_mtot[i]); return r == null || x == null ? null : r * x; } },
    rburden:  { label: "Rent-burdened", type: "flag", text: "Renter paying 30%+ of income in rent",
                byAge: function (c, i, b, v, all) { var r = renterPart(c, i, b, all, "rburden"), x = ratio(c.rb_30p[i], c.rb_base[i]); return r == null || x == null ? null : r * x; } },
    rkids:    { label: "Renters with children", type: "flag", text: "Renter household with children under 18",
                byAge: function (c, i, b, v, all) { var r = renterPart(c, i, b, all, "rkids"), x = ratio(c.r_kids[i], c.rk_tot[i]); return r == null || x == null ? null : r * x; } },
    // Financial (age set "adult"). Tax return traits (IRS, by ZIP) are shares of returns, which stand in for households.
    mortg:    { label: "Mortgage", type: "multi", options: [["with", "Owner with a mortgage or home equity loan"], ["free", "Owner, no mortgage"]],
                byAge: function (c, i, b, sel, all) {
                  var o = ownerPart(c, i, b, all, "mortg"), t = c.own_units ? c.own_units[i] : null; if (o == null || t == null) return null;
                  var x = sum(sel, function (k) { return c[k === "with" ? "mortg" : "mortg_free"][i]; }); if (x == null) return null;
                  return t ? o * Math.min(1, x / t) : 0;
                } },
    mover:    { label: "Recent movers", type: "flag", text: "Moved in the past year", share: function (c, i) { return ratio(c.movers ? c.movers[i] : null, c.mob_tot ? c.mob_tot[i] : null); } },
    taxprep:  { label: "Paid tax preparer", type: "flag", text: "Household pays a preparer to file taxes", share: function (c, i) { return irsShare(c, i, "prep"); } },
    eitc:     { label: "Earned Income Credit", type: "flag", text: "Household claims the Earned Income Credit", share: function (c, i) { return irsShare(c, i, "eitc"); } },
    selfemp:  { label: "Self-employed", type: "flag", text: "Household has business or self-employment income", share: function (c, i) { return irsShare(c, i, "selfemp"); } },
    invest:   { label: "Dividend income", type: "flag", text: "Household has dividend income", share: function (c, i) { return irsShare(c, i, "div"); } },
    capgain:  { label: "Capital gains", type: "flag", text: "Household reports capital gains", share: function (c, i) { return irsShare(c, i, "cg"); } },
    ira:      { label: "IRA distributions", type: "flag", text: "Household takes IRA distributions", share: function (c, i) { return irsShare(c, i, "ira"); } },
    pension:  { label: "Pension income", type: "flag", text: "Household has pension or annuity income", share: function (c, i) { return irsShare(c, i, "pens"); } },
    // Auto (age set "adult"): share of households with this many vehicles available (Census)
    vehicles: { label: "Vehicles in household", type: "multi", options: [["0", "None"], ["1", "1"], ["2", "2"], ["3p", "3 or more"]],
                share: function (c, i, sel) {
                  if (!c.veh_tot) return null;
                  return ratio(sum(sel, function (k) { var col = { "0": "veh0", "1": "v1", "2": "v2", "3p": "veh3p" }[k]; return c[col] ? c[col][i] : null; }), c.veh_tot[i]);
                } }
  };
  // Homeowner rate for an age group, applied once: by the first selected owner filter in OWNER_ORDER, 1 for the rest
  var OWNER_ORDER = ["mortg", "built", "ownval", "sfd", "longten"];
  function irsShare(c, i, k) { return c.returns ? ratio(c[k] ? c[k][i] : null, c.returns[i]) : null; }
  function picked(v) { return v === true || (v && v.length > 0); }
  function ownerPart(c, i, b, all, me) {
    for (var k = 0; k < OWNER_ORDER.length && OWNER_ORDER[k] !== me; k++) if (all && picked(all[OWNER_ORDER[k]])) return 1;
    var o = c["o" + b] ? c["o" + b][i] : null, r = c["r" + b] ? c["r" + b][i] : null;
    if (o == null || r == null) return null;
    return o + r ? o / (o + r) : 0;
  }
  // Renter rate for an age group, applied once: by the first selected renter filter in RENTER_ORDER, 1 for the rest
  var RENTER_ORDER = ["renter", "rinc", "rtype", "rmoved", "rburden", "rkids"];
  function renterPart(c, i, b, all, me) {
    for (var k = 0; k < RENTER_ORDER.length && RENTER_ORDER[k] !== me; k++) if (all && picked(all[RENTER_ORDER[k]])) return 1;
    var o = c["o" + b] ? c["o" + b][i] : null, r = c["r" + b] ? c["r" + b][i] : null;
    if (o == null || r == null) return null;
    return o + r ? r / (o + r) : 0;
  }
  var CLASSES = [[0, 80, "--ramp-1", "Under 80"], [80, 100, "--ramp-2", "80–99"], [100, 120, "--ramp-3", "100–119"], [120, 150, "--ramp-4", "120–149"], [150, Infinity, "--ramp-5", "150+"]];
  var SMALL_ZIP = 1000;   // when sorting by index, ZIPs with fewer residents go last: a high share of a tiny ZIP is too few people to buy
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
    this.state = { zip: cfg.defaultZip || "", r: cfg.defaultRadius || 0, minIndex: 0, sortKey: "aud", sortDir: "desc", show: 50, sel: {}, profile: null,
                   mode: "radius", area: null, areaTokens: null };
    this.profiles = {};
    (cfg.profiles || []).forEach(function (p) { this.profiles[p.id] = p; }, this);
    if (cfg.embedded) {   // inside an analyzer page: the analyzer owns the URL and passes the starting ZIP, radius and preset
      var ini = cfg.initial || {};
      if (/^\d{5}$/.test(ini.zip || "")) this.state.zip = ini.zip;
      if (+ini.r > 0) this.state.r = +ini.r;
      if (ini.p && this.profiles[ini.p]) { this.state.profile = ini.p; this.state.sel = JSON.parse(JSON.stringify(this.profiles[ini.p].sel)); this.state.sortKey = "idx"; }
      if (ini.mode === "area" && cfg.customArea) { this.state.mode = "area"; if (ini.ca) this.pendingCA = ini.ca; }
    } else this.readHash();
  }

  /* ---------- URL state ---------- */
  Radius.prototype.readHash = function () {
    var h = (location.hash || "").replace(/^#/, ""), s = this.state, self = this;
    if (!h) return;
    s.sel = {}; s.minIndex = 0; s.profile = null;
    var hasF = false;
    h.split("&").forEach(function (kv) {
      var a = kv.split("="), k = a[0], val = decodeURIComponent(a[1] || "");
      if (k === "zip" && /^\d{5}$/.test(val)) s.zip = val;
      else if (k === "r" && +val > 0) s.r = +val;
      else if (k === "min") s.minIndex = +val || 0;
      else if (k === "p" && self.profiles[val]) s.profile = val;
      else if (k === "f" && val) { hasF = true; val.split(";").forEach(function (part) {
        var p = part.split(":"), f = self.filterDefs[p[0]];
        if (!f || self.cfg.filters.indexOf(p[0]) < 0) return;
        if (f.type === "flag") { s.sel[p[0]] = true; return; }
        var opts = (p[1] || "").split(",").filter(function (o) { return f.options.some(function (x) { return x[0] === o; }); });
        if (opts.length) s.sel[p[0]] = opts;
      }); }
    });
    // A link from the analyzer carries only the category: start from that category's profile
    if (s.profile && !hasF) { s.sel = JSON.parse(JSON.stringify(this.profiles[s.profile].sel)); s.sortKey = "idx"; s.sortDir = "desc"; }
  };
  Radius.prototype.writeHash = function () {
    if (this.cfg.embedded) { if (this.cfg.onState) this.cfg.onState(this.state); return; }
    var s = this.state, f = [];
    Object.keys(s.sel).forEach(function (k) {
      var v = s.sel[k];
      if (v === true) f.push(k); else if (v && v.length) f.push(k + ":" + v.join(","));
    });
    var h = "#zip=" + s.zip + "&r=" + s.r + (s.minIndex ? "&min=" + s.minIndex : "") + (s.profile ? "&p=" + s.profile : "") +
            "&f=" + encodeURIComponent(f.join(";"));
    if (location.hash !== h) history.replaceState(null, "", h);
  };

  /* ---------- Layout ---------- */
  Radius.prototype.build = function () {
    var cfg = this.cfg, self = this, s = this.state;
    if (!cfg.embedded) document.title = cfg.title;
    var links = (cfg.links || []).map(function (l) { return el("a", { href: l.url, text: l.label }); });
    var header = cfg.embedded ? null : el("header", { class: "az-header" }, [el("div", { class: "az-header-inner" }, [
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
        if (s.r && radii.indexOf(s.r) < 0) { radii.push(s.r); radii.sort(function (a, b) { return a - b; }); }   // keep a radius from a shared link
        return [el("option", { value: "", text: "Choose a radius", disabled: "disabled" })].concat(
          radii.map(function (r) { return el("option", { value: r, text: (cfg.radiusLabels && cfg.radiusLabels[r]) || (cfg.radiusLabel || "{r} miles").replace("{r}", r) }); }));
      })());
    this.minSel = el("select", { "aria-label": "Show", onchange: function () { s.minIndex = +this.value; self.update(false); } },
      [[0, "All ZIPs in range"], [100, "Index 100+"], [120, "Index 120+"], [150, "Index 150+"]].map(function (o) { return el("option", { value: o[0], text: o[1] }); }));
    var controls = el("section", { class: "az-controls", "aria-label": "Radius controls" }, [
      this.centerField = el("label", { class: "az-field" }, [el("span", { text: "Center" }), this.zipIn, this.towns]),
      this.radiusField = el("label", { class: "az-field" }, [el("span", { text: "Radius" }), this.rSel]),
      el("label", { class: "az-field" }, [el("span", { text: "Show" }), this.minSel]),
      el("div", { class: "az-actions" }, [
        el("button", { type: "button", class: "az-btn", text: "How estimates work", onclick: function () { self.openMethod(); } }),
        el("button", { type: "button", class: "az-btn primary", text: "Export ZIP list", onclick: function () { self.exportCSV(); } })])]);
    this.errorBox = el("div", { class: "az-error", role: "alert", hidden: true });
    this.areaPanel = cfg.customArea ? this.buildArea() : null;

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
    var presets = (cfg.presets || []).length ? el("div", { class: "rz-presets" }, [el("span", { class: "rz-presets-label", text: cfg.profiles ? "More audiences" : "Start from" })].concat(cfg.presets.map(function (p) {
      return el("button", { type: "button", class: "az-btn", text: p.label, onclick: function () { s.sel = JSON.parse(JSON.stringify(p.sel)); s.profile = null; self.syncFilters(); self.update(false); } });
    }))) : null;
    var profileBox = null;
    if ((cfg.profiles || []).length) {
      this.profileSel = el("select", { "aria-label": "Best prospects for", onchange: function () { self.applyProfile(this.value); } },
        [el("option", { value: "", text: "Custom audience" })].concat(cfg.profiles.map(function (p) { return el("option", { value: p.id, text: p.label }); })));
      this.eitherBox = el("div", { class: "rz-either", hidden: true });
      profileBox = el("div", { class: "rz-profile" }, [el("label", { class: "az-field" }, [el("span", { text: cfg.profileLabel || "Best prospects for" }), this.profileSel]),
        this.profileNote = el("p", { class: "rz-note" }), this.eitherBox]);
    }
    this.filterPanel = el("aside", { class: "az-panel rz-filters", "aria-label": "Audience filters" }, [
      el("div", { class: "rz-filters-head" }, [el("h2", { text: "Audience" }),
        el("button", { type: "button", class: "rz-clear", text: "Clear all", onclick: function () { s.sel = {}; s.profile = null; self.syncFilters(); self.update(false); } })]),
      profileBox, presets].concat(groups).concat([el("p", { class: "rz-note", text: this.ages.note })]));

    // Summary + map
    this.summary = el("div", { class: "rz-summary", "aria-live": "polite" });
    this.legend = el("div", { class: "az-legend", "aria-label": "Map legend" });
    this.mapEl = el("div", { class: "az-map rz-map", role: "region", "aria-label": "Map of ZIPs in the radius" });
    this.extra = el("div", { class: "rz-extra" });   // filled by an analyzer page that embeds the tool (ad response and category ad spend, below the ZIP table)
    var right = el("div", { class: "rz-right" }, [this.summary, el("div", { class: "az-panel az-map-panel" }, [this.mapEl, this.legend])]);

    // Table
    this.tableTitle = el("h2"); this.tableNote = el("span");
    this.thead = el("thead"); this.tbody = el("tbody");
    var table = el("section", { class: "az-panel az-table-panel" }, [el("div", { class: "az-table-head" }, [this.tableTitle, this.tableNote]),
      el("div", { class: "az-tablewrap" }, [el("table", { class: "az-table" }, [this.thead, this.tbody])])]);
    this.modalBody = el("div", { class: "az-modal-body" });
    this.modal = el("dialog", { class: "az-modal", "aria-labelledby": "rz-method-title" }, [this.modalBody]);
    var sources = el("section", { class: "az-panel az-sources" }, [el("h2", { text: "Sources" }), this.sourcesP = el("p")]);

    var main = el("main", { class: "az-main" }, [controls, this.areaPanel, this.errorBox, el("section", { class: "rz-stage" }, [this.filterPanel, right]), table, this.extra, sources]);
    this.root.innerHTML = ""; if (header) this.root.appendChild(header); this.root.appendChild(main); this.root.appendChild(this.modal);
    this.rSel.value = s.r ? String(s.r) : ""; this.minSel.value = String(s.minIndex);
    this.syncFilters();

    this.map = L.map(this.mapEl, { zoomControl: false, zoomSnap: 0.25, minZoom: 3, maxZoom: 12 });
    L.control.zoom({ position: "topright" }).addTo(this.map);
    this.map.attributionControl.setPrefix(false);
    this.map.attributionControl.addAttribution("Boundaries: U.S. Census Bureau");
    this.map.fitBounds([[24.4, -125], [49.5, -66.9]]);
    this.showMode();
  };
  Radius.prototype.applyProfile = function (id) {
    var s = this.state, p = this.profiles[id];
    s.profile = p ? id : null;
    if (p) { s.sel = JSON.parse(JSON.stringify(p.sel)); s.sortKey = "idx"; s.sortDir = "desc"; }
    this.syncFilters(); this.update(false);
  };
  Radius.prototype.syncFilters = function () {
    var s = this.state, self = this, p = s.profile && this.profiles[s.profile];
    if (this.profileSel) {
      this.profileSel.value = p ? p.id : "";
      this.profileNote.textContent = p ? p.note || "" : "";
      this.profileNote.hidden = !(p && p.note);
      this.eitherBox.innerHTML = "";
      this.eitherBox.hidden = !(p && p.either);
      if (p && p.either) {
        this.eitherBox.appendChild(el("span", { text: "And either " + p.either.map(function (x) { return x.text; }).join(", or ") }));
        this.eitherBox.appendChild(el("button", { type: "button", class: "rz-clear", text: "Remove", onclick: function () { s.profile = null; self.syncFilters(); self.update(false); } }));
      }
    }
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
    var either = this.state.profile && this.profiles[this.state.profile] && this.profiles[this.state.profile].either;
    if (either) return this.audienceEither(i, either);
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
  // Share of one sex x age cell matching a set of filters (gender and age act as in/out of the cell)
  Radius.prototype.cellShare = function (i, sex, b, sel) {
    var c = this.c, defs = this.filterDefs, sh = 1, keys = Object.keys(sel);
    if (sel.gender && sel.gender.length && sel.gender.indexOf(sex) < 0) return 0;
    if (sel.age && sel.age.length && sel.age.indexOf(b) < 0) return 0;
    for (var k = 0; k < keys.length && sh > 0; k++) {
      var f = defs[keys[k]], v = sel[keys[k]], x;
      if (f.byAge) x = f.byAge(c, i, b, v, sel); else if (f.share) x = f.share(c, i, v, sel); else continue;
      if (x == null) return null;
      sh *= x;
    }
    return sh;
  };
  Radius.prototype.audienceEither = function (i, either) {
    var c = this.c, ages = this.ages, sel = this.state.sel, total = 0;
    var groups = ages.options.map(function (x) { return x[0]; });
    for (var si = 0; si < 2; si++) for (var ai = 0; ai < groups.length; ai++) {
      var sex = ["m", "f"][si], b = groups[ai];
      var v = c[ages.col(sex, b)][i]; if (v == null) return null;
      if (!v) continue;
      var base = this.cellShare(i, sex, b, sel); if (base == null) return null;
      if (!base) continue;
      var none = 1;
      for (var e = 0; e < either.length; e++) {
        var x = this.cellShare(i, sex, b, either[e].sel); if (x == null) return null;
        none *= 1 - x;
      }
      total += v * base * (1 - none);
    }
    return total;
  };
  Radius.prototype.isEstimate = function () {
    var sel = this.state.sel, defs = this.filterDefs;
    return !!this.state.profile || Object.keys(sel).some(function (k) { return defs[k].share || defs[k].byAge; });
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
    if (s.mode === "area") return this.updateArea(moved);
    var ci = this.byZip[s.zip];
    if (ci === undefined || !s.r) { this.renderEmpty(); if (this.cfg.onUpdate) this.cfg.onUpdate(false); return; }
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
    if (this.cfg.onUpdate) this.cfg.onUpdate(true);   // a center and radius are set: the analyzer can show what comes next
  };
  Radius.prototype.visible = function () {
    var m = this.state.minIndex;
    return m ? this.rows.filter(function (r) { return r.idx != null && r.idx >= m; }) : this.rows;
  };
  // Nothing is preselected: results appear once the user has chosen both a center and a radius
  Radius.prototype.renderEmpty = function () {
    var s = this.state, hasZip = this.c && this.byZip[s.zip] !== undefined;
    if (s.mode === "area") hasZip = false;
    var msg = s.mode === "area" ? "List ZIPs, counties or towns above, or upload a file, then select Map this area." : hasZip ? "Choose a radius to see the audience around " + s.zip + "." :
              s.r ? "Enter a ZIP or town to see the audience within " + s.r + " miles." :
              "Enter a ZIP or town and choose a radius to see the audience.";
    this.rows = null; this.mapToken = (this.mapToken || 0) + 1;
    ["circle", "centerMark", "zipLayer", "areaLayer"].forEach(function (k) { if (this[k]) { this.map.removeLayer(this[k]); this[k] = null; } }, this);
    if (hasZip && this.map) this.map.setView([this.c.lat[this.byZip[s.zip]], this.c.lon[this.byZip[s.zip]]], 9);
    this.summary.innerHTML = "";
    this.summary.appendChild(el("p", { class: "az-empty", text: msg }));
    this.tbody.innerHTML = ""; this.thead.innerHTML = ""; this.tableTitle.textContent = s.mode === "area" ? "ZIPs in the area" : "ZIPs in range"; this.tableNote.textContent = "";
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
      el("span", { text: (s.profile ? "Best prospects for " + this.profiles[s.profile].label + ", e" : est ? "E" : "") + (s.profile || est ? "stimated audience" : "Audience") + (s.mode === "area" ? " in the custom area (" + this.areaPhrase() + ")" : " within " + s.r + " miles of " + s.zip + " " + c.city[ci] + ", " + c.state[ci]) + (s.minIndex ? " (ZIPs at index " + s.minIndex + "+)" : "") })]));
    this.summary.appendChild(stat(share == null ? "—" : NF1.format(share * 100) + "%", "Share of population"));
    this.summary.appendChild(stat(idx == null ? "—" : NF0.format(idx), "Index vs. U.S. (100 = average)"));
    this.summary.appendChild(stat(NF0.format(rows.length), "ZIPs"));
    this.summary.appendChild(stat(NF0.format(P), "Population"));
  };
  Radius.prototype.renderTable = function () {
    var self = this, s = this.state, rows = this.visible().slice(), est = this.isEstimate();
    var area = s.mode === "area", circ = area && s.area && s.area.circles.length;
    var cols = [["zip", "ZIP", "l"], ["town", "Town", "l"]].concat(area ? [["county", "County", "l"]] : []).concat(!area || circ ? [["dist", area ? "Miles to location" : "Miles", "n"]] : [])
      .concat([["pop", "Population", "n"], ["aud", est ? "Est. audience" : "Audience", "n"], ["share", "Share", "n"], ["idx", "Index", "n"]]);
    this.sortRows(rows);
    var k = s.sortKey, nSmall = k === "idx" ? rows.filter(function (r) { return (r.pop || 0) < SMALL_ZIP; }).length : 0;
    this.tableTitle.textContent = area ? "ZIPs in the custom area" : "ZIPs within " + s.r + " miles";
    this.tableNote.textContent = (rows.length > s.show ? "Showing " + s.show + " of " + NF0.format(rows.length) + " ZIPs. Export includes all." : NF0.format(rows.length) + " ZIPs.") + (nSmall ? " ZIPs under " + NF0.format(SMALL_ZIP) + " residents are listed last." : "") + " Click a column to sort.";
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
        area ? el("td", { class: "rz-l rz-county", text: r.county || "—" }) : null,
        !area || circ ? el("td", { class: "num", text: r.dist == null ? "—" : NF1.format(r.dist) }) : null,
        el("td", { class: "num", text: r.pop == null ? "—" : NF0.format(r.pop) }),
        el("td", { class: "num", text: r.aud == null ? "No data" : NF0.format(Math.round(r.aud)) }),
        el("td", { class: "num", text: r.share == null ? "—" : NF1.format(r.share * 100) + "%" }),
        el("td", { class: "num", text: r.idx == null ? "—" : NF0.format(r.idx) })]));
    });
    if (!rows.length) frag.appendChild(el("tr", null, [el("td", { colspan: String(cols.length), class: "az-empty", text: area ? "No ZIPs meet the index cutoff. Lower the Show setting or add to the area." : "No ZIPs meet the index cutoff. Lower the Show setting or widen the radius." })]));
    this.tbody.appendChild(frag);
    if (rows.length > s.show) this.tbody.appendChild(el("tr", null, [el("td", { colspan: String(cols.length) }, [el("button", { type: "button", class: "az-btn", text: "Show all " + NF0.format(rows.length), onclick: function () { s.show = 1e9; self.renderTable(); } })])]));
  };

  Radius.prototype.sortRows = function (rows) {
    var s = this.state, k = s.sortKey, dir = s.sortDir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      if (k === "idx") { var sa = (a.pop || 0) < SMALL_ZIP, sb = (b.pop || 0) < SMALL_ZIP; if (sa !== sb) return sa ? 1 : -1; }
      var x = a[k], y = b[k];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return typeof x === "string" ? dir * x.localeCompare(y) : dir * (x - y);
    });
    return rows;
  };

  /* ---------- Map ---------- */
  Radius.prototype.colorFor = function (idx) {
    if (idx == null) return cssVar("--nodata");
    for (var k = 0; k < CLASSES.length; k++) if (idx >= CLASSES[k][0] && idx < CLASSES[k][1]) return cssVar(CLASSES[k][2]);
    return cssVar("--nodata");
  };
  Radius.prototype.renderMap = function (moved) {
    var self = this, s = this.state, c = this.c;
    ["circle", "centerMark", "areaLayer"].forEach(function (k) { if (this[k]) { this.map.removeLayer(this[k]); this[k] = null; } }, this);
    if (s.mode === "area") {
      // Custom area: circles for any locations given with miles; the shaded ZIPs show the rest of the footprint
      this.areaLayer = L.layerGroup().addTo(this.map);
      var bounds = L.latLngBounds([]);
      this.rows.forEach(function (r) { bounds.extend([c.lat[r.i], c.lon[r.i]]); });
      s.area.circles.forEach(function (q) {
        var ll = [c.lat[q.i], c.lon[q.i]];
        var ring = L.circle(ll, { radius: q.r * 1609.34, color: "#0f2742", weight: 2, dashArray: "6 5", fill: false, interactive: false }).addTo(self.areaLayer);
        L.circleMarker(ll, { radius: 6, color: "#fff", weight: 2, fillColor: "#0f2742", fillOpacity: 1 }).bindTooltip(q.label).addTo(self.areaLayer);
        bounds.extend(ring.getBounds());
      });
      if (moved && bounds.isValid()) this.map.fitBounds(bounds.pad(0.05), { padding: [16, 16], maxZoom: 11 });
    } else {
      var ci = this.byZip[s.zip], center = [c.lat[ci], c.lon[ci]];
      this.circle = L.circle(center, { radius: s.r * 1609.34, color: "#0f2742", weight: 2, dashArray: "6 5", fill: false, interactive: false }).addTo(this.map);
      this.centerMark = L.circleMarker(center, { radius: 6, color: "#fff", weight: 2, fillColor: "#0f2742", fillOpacity: 1 }).bindTooltip("Center: " + s.zip).addTo(this.map);
      if (moved) this.map.fitBounds(this.circle.getBounds(), { padding: [16, 16] });
    }
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
      if (self.circle) { self.circle.bringToFront(); self.centerMark.bringToFront(); }
      if (self.areaLayer) self.areaLayer.eachLayer(function (l) { l.bringToFront(); });
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
    var p = this.state.profile && this.profiles[this.state.profile];
    if (p && p.either) parts.push("and either " + p.either.map(function (x) { return x.text; }).join(" or "));
    var out = parts.length ? parts.join("; ") : "Everyone";
    return p ? "Best prospects for " + p.label + ": " + out : out;
  };
  Radius.prototype.exportCSV = function () {
    if (!this.rows) return;
    var s = this.state, est = this.isEstimate();
    var rows = this.sortRows(this.visible().slice());   // same order as the table
    var area = s.mode === "area", circ = area && s.area.circles.length;
    var head = ["ZIP", "Town"].concat(area ? ["County"] : []).concat(!area ? ["Miles from center"] : circ ? ["Miles to nearest location"] : []);
    var lines = [head.concat(["Population", est ? "Estimated audience" : "Audience", "Audience share", "Index vs US", "Audience definition"]).map(csvCell).join(",")];
    var def = this.describe();
    rows.forEach(function (r) {
      var lead = [r.zip, r.town].concat(area ? [r.county || ""] : []).concat(!area || circ ? [r.dist == null ? "" : r.dist.toFixed(1)] : []);
      lines.push(lead.concat([r.pop, r.aud == null ? "" : Math.round(r.aud), r.share == null ? "" : (r.share * 100).toFixed(1) + "%", r.idx == null ? "" : Math.round(r.idx), def]).map(csvCell).join(","));
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = el("a", { href: URL.createObjectURL(blob), download: (this.cfg.exportName || "adtaxi-radius") + (area ? "-custom-area.csv" : "-" + s.zip + "-" + s.r + "mi.csv") });
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
      ["Which ZIPs are included", this.state.mode === "area" ?
        "In a custom area, a ZIP is included when you list it, when it's assigned to a county you list, when its town name matches a town you list, or when its center point is within the miles you give for a location. Each ZIP is assigned to one county, the primary county in the Deluxe ZIP database, so a ZIP that crosses a county line counts toward the county where it's listed. PO box and business-only ZIPs with no residents are left out." :
        "A ZIP is in range when its center point is inside the circle. PO box and business-only ZIPs with no residents are left out."],
      ["Gender and age", this.ages.method],
      ["Everything else is an estimate", list(traits).replace(/^./, function (x) { return x.toUpperCase(); }) + " come from separate tables. The tool multiplies the base count by each trait's share in that ZIP, which assumes the traits are independent within a ZIP. That's the standard approach, but real overlaps can be higher or lower, so combined counts are labeled as estimates."]
    ];
    if (aged.length) secs.push(["Traits applied by age group", list(aged).replace(/^./, function (x) { return x.toUpperCase(); }) + " are published by age, so the tool applies each age group's own rate in each ZIP. For example, hearing difficulty among people 75 and older uses the 75+ rate, which is far higher than the rate for all ages."]);
    if ((this.cfg.profiles || []).length) secs.push(["Best prospects", "Each category starts from a profile of its likely customers, built from the same Census and CDC data. A profile is a starting point: change any filter to fit the client. When a profile includes an \"either\" condition (such as 65 and older, or diabetes), people who meet either one are counted once. The ZIP list is sorted by index, so the ZIPs where prospects are most concentrated come first; ZIPs with fewer than 1,000 residents are listed after the rest, since a high share of a tiny ZIP is too few people to reach. Sort by Est. audience to see the largest counts."]);
    if (cf.indexOf("built") >= 0) secs.push(["Homeowners", "Year built, home value, single-family detached and years in the home are Census counts of owner-occupied homes in each ZIP. The tool applies the homeowner rate for each age of householder once, then each selected trait's share among owner homes, so combining them doesn't count owners twice."]);
    if (cf.indexOf("renter") >= 0) secs.push(["Renters", "Renter income, rental type, recent moves, rent burden and children at home are Census counts of renter households in each ZIP. The tool applies the renter rate for each age of householder once, then each selected trait's share among renter households, so combining them doesn't count renters twice. Counts are adults in renter households."]);
    if (cf.indexOf("parented") >= 0) secs.push(["Parents' education", "This is the education of the head of household in every household in the ZIP. Combine it with Children at home to estimate households with children whose head of household has no college."]);
    secs.push(["Index vs. U.S.", "A ZIP's audience share of its population, divided by the same share nationally, times 100. Above 100 means the audience is more concentrated there than in the U.S. overall."]);
    secs = secs.concat((this.cfg.methodology || []).map(function (m) { return [m.title, m.body]; }));
    secs.forEach(function (x) { b.appendChild(el("h3", { text: x[0] })); b.appendChild(el("p", { text: x[1] })); });
    if (this.meta) b.appendChild(el("p", { class: "az-empty", text: "Census ACS " + this.meta.acsYears + ". Data built " + this.meta.built + "." }));
    if (this.modal.showModal) this.modal.showModal(); else this.modal.setAttribute("open", "");
  };

  /* ---------- Custom area: an advertiser footprint that isn't a circle ---------- */
  // A list of ZIPs, counties and towns, several locations each with its own miles, or an uploaded CSV/Excel file.
  // Turned on per analyzer with customArea: true in the site's radius-config.js.
  var STATE_NAMES = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
    "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
    kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
    montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY" };
  var STATE_CODES = {}; Object.keys(STATE_NAMES).forEach(function (k) { STATE_CODES[STATE_NAMES[k]] = 1; });
  var COUNTY_WORD = /\s+(county|parish|borough|census area|city and borough|municipality|co\.?)$/i;
  var MAX_LINK_TOKENS = 2000;   // larger areas still work; they just aren't saved in the page link
  function normName(t) {
    return String(t || "").toLowerCase().replace(/\bsaint\b/g, "st").replace(/\bsainte\b/g, "ste").replace(/[.'’]/g, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
  }
  function stateCode(t) {
    t = String(t || "").replace(/\./g, "").trim();
    if (STATE_CODES[t.toUpperCase()] && t.length === 2) return t.toUpperCase();
    return STATE_NAMES[t.toLowerCase()] || null;
  }
  // "Cook County, IL" / "Cook County IL" / "Naperville, Illinois" -> name + state
  function splitPlace(t) {
    var m = /^(.*\S)\s*,\s*([A-Za-z .]+)$/.exec(t), st;
    if (m && (st = stateCode(m[2]))) return { name: m[1].trim(), st: st };
    m = /^(.*\S)\s+([A-Za-z]{2})$/.exec(t);
    if (m && (st = stateCode(m[2]))) return { name: m[1].replace(/,\s*$/, "").trim(), st: st };
    return { name: t.replace(/,\s*$/, "").trim(), st: null };
  }
  function zipOf(tok) {   // 60462, 60462-1234, 604621234; a 4-digit value is a ZIP that lost its leading zero (Excel does this)
    tok = String(tok == null ? "" : tok).trim();
    var m = /^(\d{5})(?:-?\d{4})?$/.exec(tok);
    if (m) return { zip: m[1] };
    if (/^\d{4}$/.test(tok)) return { zip: "0" + tok, padded: true };
    if (/^\d{3}$/.test(tok)) return { zip: "00" + tok, padded: true };
    return null;
  }
  function parseCSV(text) {
    var first = text.split(/\r?\n/, 1)[0] || "", d = first.indexOf("\t") >= 0 && first.indexOf(",") < 0 ? "\t" : ",";
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === d) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    if (loadXLSX.p) return loadXLSX.p;
    return (loadXLSX.p = new Promise(function (ok, fail) {
      var sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      sc.onload = ok; sc.onerror = function () { loadXLSX.p = null; fail(new Error("the Excel reader didn't load")); };
      document.head.appendChild(sc);
    }));
  }
  // Turn a spreadsheet's rows into one area line per row, using whichever ZIP, county, state, town and miles columns it has
  function rowsToLines(rows) {
    rows = rows.filter(function (r) { return r && r.some(function (x) { return String(x == null ? "" : x).trim() !== ""; }); });
    var cols = null, hi = -1;
    for (var h = 0; h < Math.min(5, rows.length) && !cols; h++) {
      var f = {}, hdr = rows[h].map(function (x) { return String(x == null ? "" : x).trim().toLowerCase(); });
      hdr.forEach(function (t, j) {
        if (f.zip == null && /\b(zip|zipcode|zip code|zip5|postal|postal code|postcode)\b|^zip/.test(t) && !/plus|\+4|zip4|county/.test(t)) f.zip = j;
        else if (f.fips == null && /fips/.test(t)) f.fips = j;
        else if (f.county == null && /county|parish/.test(t)) f.county = j;
        else if (f.st == null && /^(state|st|state code|state abbr|state abbreviation|province)$/.test(t)) f.st = j;
        else if (f.city == null && /^(city|town|place|municipality|city name)$/.test(t)) f.city = j;
        else if (f.mi == null && /^(miles|mi|radius|radius miles|radius \(miles\)|miles radius|trade area miles)$/.test(t)) f.mi = j;
      });
      if (f.zip != null || f.fips != null || f.county != null || f.city != null) { cols = f; hi = h; }
    }
    var out = [], seen = {}, add = function (line) { if (line && !seen[line]) { seen[line] = 1; out.push(line); } };
    var get = function (r, j) { return j == null ? "" : String(r[j] == null ? "" : r[j]).trim(); };
    if (cols) {
      var skipped = 0;
      rows.slice(hi + 1).forEach(function (r) {
        var mi = parseFloat(get(r, cols.mi)), tail = mi > 0 ? ", " + mi + " miles" : "";
        var z = zipOf(get(r, cols.zip).replace(/\.0$/, "")), st = get(r, cols.st);
        if (z) return add(z.zip + tail);
        if (cols.zip != null) { skipped++; return; }   // a customer file: a row without a ZIP is skipped, not widened to its whole county
        var fips = get(r, cols.fips).replace(/\.0$/, "");
        if (/^\d{4,5}$/.test(fips)) return add("FIPS " + (fips.length === 4 ? "0" + fips : fips));
        var cty = get(r, cols.county);
        if (cty) return add(cty + (COUNTY_WORD.test(cty) || /\bcity$/i.test(cty) ? "" : " County") + (st ? ", " + st : ""));
        var town = get(r, cols.city);
        if (town) add(town + (st ? ", " + st : "") + tail);
      });
      return { lines: out, rows: rows.length - hi - 1, skipped: skipped };
    }
    // No headers we recognize: take a ZIP from each row, or the row's only value
    rows.forEach(function (r) {
      var z = null;
      for (var j = 0; j < r.length && !z; j++) { var v = String(r[j] == null ? "" : r[j]).trim(); if (/^\d{5}(-?\d{4})?$/.test(v)) z = zipOf(v); }
      if (z) add(z.zip);
      else { var vals = r.map(function (x) { return String(x == null ? "" : x).trim(); }).filter(Boolean); if (vals.length === 1) add(vals[0]); }
    });
    return { lines: out, rows: rows.length };
  }

  Radius.prototype.buildArea = function () {
    var self = this;
    this.areaIn = el("textarea", { class: "rz-area-input", rows: "5", spellcheck: "false", "aria-label": "Custom area",
      placeholder: "60462\n60463, 60464, 60467\nCook County, IL\nNaperville, IL\n46307, 15 miles",
      onkeydown: function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) self.applyArea(); } });
    this.areaFile = el("input", { type: "file", accept: ".csv,.txt,.tsv,.xlsx,.xls", class: "rz-visually-hidden", tabindex: "-1",
      onchange: function () { if (this.files && this.files[0]) self.readAreaFile(this.files[0]); this.value = ""; } });
    this.areaReport = el("div", { class: "rz-area-report", "aria-live": "polite", hidden: true });
    return el("section", { class: "az-panel rz-area", "aria-label": "Custom area", hidden: true }, [
      el("div", { class: "rz-area-text" }, [
        el("h2", { text: "Custom area" }),
        el("p", { class: "rz-note", text: "For a business whose market isn't a circle. Enter one item per line: a ZIP, a county (Cook County, IL), a town (Naperville, IL), or a ZIP or town with miles to draw a circle around a location (46307, 15 miles). ZIPs can also go on one line separated by commas." }),
        el("p", { class: "rz-note", text: "Or upload a CSV or Excel file of the advertiser's ZIPs, counties or locations. The tool reads columns named ZIP, County, State, City and Miles and ignores the rest; uploading replaces the list." })
      ]),
      el("div", { class: "rz-area-entry" }, [
        this.areaIn,
        el("div", { class: "rz-area-actions" }, [
          el("button", { type: "button", class: "az-btn primary", text: "Map this area", onclick: function () { self.applyArea(); } }),
          el("button", { type: "button", class: "az-btn", text: "Upload a file", onclick: function () { self.areaFile.click(); } }),
          this.areaFile,
          el("button", { type: "button", class: "rz-clear", text: "Clear", onclick: function () { self.areaIn.value = ""; self.state.area = null; self.state.areaTokens = null; self.areaReport.hidden = true; self.update(true); self.writeHash(); } })
        ]),
        this.areaReport
      ])
    ]);
  };
  Radius.prototype.showMode = function () {
    var area = this.state.mode === "area";
    if (this.centerField) this.centerField.hidden = area;
    if (this.radiusField) this.radiusField.hidden = area;
    if (this.areaPanel) this.areaPanel.hidden = !area;
    this.mapEl.setAttribute("aria-label", area ? "Map of ZIPs in the custom area" : "Map of ZIPs in the radius");
    if (this.minSel && this.minSel.options[0]) this.minSel.options[0].text = area ? "All ZIPs in the area" : "All ZIPs in range";
  };
  // Called by the analyzer page: Geography > Radius or Geography > Custom area
  Radius.prototype.setMode = function (mode, ca) {
    var s = this.state;
    mode = mode === "area" && this.cfg.customArea ? "area" : "radius";
    if (mode === "area" && ca && ca !== (s.areaTokens || []).join(",")) this.pendingCA = ca;
    if (s.mode === mode && !this.pendingCA) { this.resize(); return; }
    s.mode = mode; this.showMode(); this.resize();
    this.errorBox.hidden = true;
    if (!this.c) return;   // still loading: start() picks up the mode
    if (mode === "area") this.startArea(); else this.update(true);
  };
  Radius.prototype.startArea = function () {
    var self = this;
    this.loadCounties().then(function () {
      if (self.pendingCA) {
        self.areaIn.value = self.tokensToText(self.pendingCA.split(","));
        self.pendingCA = null; self.applyArea();
      } else self.update(true);
      if (!self.areaIn.value) self.areaIn.focus({ preventScroll: true });
    }).catch(function (e) { self.showError("The county list didn't load (" + e.message + "). Refresh the page and try again."); });
  };
  Radius.prototype.loadCounties = function () {
    var self = this;
    if (this.countyP) return this.countyP;
    var url = this.cfg.countyZips || this.cfg.zipGeo.replace(/zip\/\{level\}\/\{id\}\.json$/, "county_zips.json");
    return (this.countyP = fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      var cty = self.counties = d.counties, byName = {}, cityName = {}, anyState = {};
      self.zipCounty = {};
      Object.keys(cty).forEach(function (f) {
        var x = cty[f], n = x.n;
        x.z.forEach(function (z) { self.zipCounty[z] = f; });
        if (/ city$/.test(n)) { (cityName[x.s + "|" + normName(n.slice(0, -5))] = cityName[x.s + "|" + normName(n.slice(0, -5))] || []).push(f); return; }   // independent cities: "Richmond city"
        var base = normName(n.replace(COUNTY_WORD, ""));
        (byName[x.s + "|" + base] = byName[x.s + "|" + base] || []).push(f);
        (anyState[base] = anyState[base] || []).push(f);
      });
      self.countyIdx = { byName: byName, city: cityName, any: anyState };
      // Towns: every ZIP's town name, by state
      var towns = {}, townAny = {}, c = self.c;
      for (var i = 0; i < self.n; i++) {
        if (!c.city[i]) continue;
        var k = normName(c.city[i]);
        (towns[c.state[i] + "|" + k] = towns[c.state[i] + "|" + k] || []).push(i);
        (townAny[k] = townAny[k] || {})[c.state[i]] = 1;
      }
      self.townIdx = { byName: towns, any: townAny };
    }));
  };
  Radius.prototype.countyLabel = function (f) { var x = this.counties[f]; return x ? x.n + ", " + x.s : f; };
  Radius.prototype.findCounty = function (name, st) {
    var I = this.countyIdx, base = normName(name.replace(COUNTY_WORD, "")), hits;
    if (st) {
      hits = I.byName[st + "|" + base];
      if (!hits && / city$/.test(base)) hits = I.city[st + "|" + base.slice(0, -5)];   // "Baltimore City, MD"
      return hits ? { f: hits } : null;
    }
    hits = I.any[base];
    if (!hits) return null;
    return hits.length === 1 ? { f: hits } : { many: hits.map(function (f) { return this.counties[f].s; }, this) };
  };
  Radius.prototype.findTown = function (name, st) {
    var T = this.townIdx, k = normName(name);
    if (!st) { var sts = Object.keys(T.any[k] || {}); if (sts.length > 1) return { many: sts }; st = sts[0]; }
    var hits = st && T.byName[st + "|" + k];
    return hits ? { st: st, i: hits } : null;
  };
  // Read the list into ZIPs, counties, towns and circles; anything not understood is reported back, not dropped silently
  Radius.prototype.resolveArea = function (text) {
    var self = this, c = this.c;
    var A = { zips: {}, circles: [], items: [], bad: [], padded: [], noRes: 0, tokens: [], n: { zip: 0, county: 0, town: 0, loc: 0 } };
    var tok = {}, addTok = function (t) { if (!tok[t]) { tok[t] = 1; A.tokens.push(t); } };
    var bad = function (t, why) { A.bad.push({ text: t, why: why }); };
    var addZip = function (raw) {
      var z = zipOf(raw);
      if (!z) return bad(raw, "isn't a 5-digit ZIP");
      if (self.byZip[z.zip] === undefined) return bad(z.zip, "isn't a residential ZIP in the data (it may be a PO box, business or retired ZIP)");
      if (z.padded) A.padded.push(raw + " → " + z.zip);
      if (!A.zips[z.zip]) { A.zips[z.zip] = 1; A.n.zip++; }
      addTok("z" + z.zip);
    };
    var addCircle = function (place, r, line) {
      if (!(r > 0) || r > 500) return bad(line, "needs miles between 1 and 500");
      var i = null, z = zipOf(place);
      if (z) { i = self.byZip[z.zip]; if (i === undefined) return bad(line, "doesn't have a residential ZIP as its center"); }
      else {
        var p = splitPlace(place), t = self.findTown(p.name, p.st);
        if (!t) return bad(line, "needs a ZIP or a town as its center");
        if (t.many) return bad(line, "names a town in " + t.many.length + " states; add the state, such as " + p.name + ", " + t.many[0]);
        t.i.forEach(function (j) { if (i == null || c.population[j] > c.population[i]) i = j; });   // the town's most populous ZIP
      }
      var label = c.zip[i] + " " + c.city[i] + ", " + c.state[i] + ": " + r + " miles";
      A.circles.push({ i: i, r: r, label: label }); A.n.loc++;
      A.items.push({ kind: "loc", label: label });
      addTok("r" + c.zip[i] + ":" + r);
    };
    var addCounty = function (f) {
      var x = self.counties[f];
      if (tok["c" + f]) return;
      var k = 0; x.z.forEach(function (z) { var i = self.byZip[z]; if (i !== undefined) { A.zips[z] = 1; if (c.population[i] > 0 || c.acs_pop[i] > 0) k++; } });
      A.n.county++; A.items.push({ kind: "county", label: x.n + ", " + x.s, count: k });
      addTok("c" + f);
    };
    String(text || "").split(/[\r\n;]+/).forEach(function (line) {
      var t = line.replace(/\s+/g, " ").trim(), m;
      if (!t) return;
      // Numbers only: a ZIP list, or "ZIP miles"
      if (/^[\d\s,\t-]+$/.test(t)) {
        var parts = t.split(/[\s,\t]+/).filter(function (x) { return x && x !== "-"; });
        if (parts.length === 2 && /^\d{1,3}$/.test(parts[1]) && zipOf(parts[0])) return addCircle(parts[0], +parts[1], t);
        return parts.forEach(addZip);
      }
      if ((m = /^fips[:#\s]*(\d{4,5})$/i.exec(t))) {
        var f = m[1].length === 4 ? "0" + m[1] : m[1];
        return self.counties[f] ? addCounty(f) : bad(t, "isn't a county FIPS code");
      }
      // A ZIP or town with miles: "46307, 15 miles", "Naperville, IL 10 mi", "60462 within 25"
      if ((m = /^(.+?)[,\s-]+(?:within\s+)?(\d{1,3}(?:\.\d+)?)\s*(?:mi|mile|miles)?\.?(?:\s+radius)?$/i.exec(t)) && !COUNTY_WORD.test(splitPlace(m[1]).name)) return addCircle(m[1].trim(), +m[2], t);
      var p = splitPlace(t), hit;
      var isCounty = COUNTY_WORD.test(p.name);
      if (!isCounty) {
        var town = self.findTown(p.name, p.st);
        if (town && town.many) return bad(t, "is a town in " + town.many.length + " states (" + town.many.slice(0, 4).join(", ") + (town.many.length > 4 ? "…" : "") + "); add the state, such as " + p.name + ", " + town.many[0]);
        if (town) {
          var k = 0, key = "t" + town.st + ":" + c.city[town.i[0]];
          if (tok[key]) return;
          town.i.forEach(function (i) { if (c.population[i] > 0 || c.acs_pop[i] > 0) k++; A.zips[c.zip[i]] = 1; });
          A.n.town++; A.items.push({ kind: "town", label: c.city[town.i[0]] + ", " + town.st, count: k });
          return addTok(key);
        }
      }
      hit = self.findCounty(p.name, p.st);
      if (hit && hit.many) return bad(t, "is a county name in " + hit.many.length + " states; add the state, such as " + p.name + ", " + hit.many[0]);
      if (hit) return hit.f.forEach(addCounty);
      bad(t, isCounty ? "isn't a county we can find" + (p.st ? " in " + p.st : "; check the spelling and add the state") :
        "isn't a ZIP, county or town we can find" + (p.st ? " in " + p.st : "; check the spelling and add the state"));
    });
    return A;
  };
  Radius.prototype.applyArea = function () {
    var self = this;
    if (!this.counties) { this.loadCounties().then(function () { self.applyArea(); }); return; }
    var A = this.resolveArea(this.areaIn.value);
    this.errorBox.hidden = true;
    this.state.area = A.tokens.length ? A : null;
    this.state.areaTokens = A.tokens.length ? A.tokens : null;
    this.state.show = 50;
    this.update(true);
    this.renderAreaReport(A);
  };
  Radius.prototype.tokensToText = function (tokens) {
    var self = this;
    return tokens.map(function (t) {
      var k = t.charAt(0), v = t.slice(1);
      if (k === "z") return v;
      if (k === "c") return self.counties && self.counties[v] ? self.countyLabel(v) : "FIPS " + v;
      if (k === "t") { var a = v.split(":"); return a.slice(1).join(":") + ", " + a[0]; }
      if (k === "r") { var b = v.split(":"); return b[0] + ", " + b[1] + " miles"; }
      return "";
    }).filter(Boolean).join("\n");
  };
  Radius.prototype.updateArea = function (moved) {
    var s = this.state, c = this.c, A = s.area;
    if (!A) { this.renderEmpty(); if (this.cfg.onUpdate) this.cfg.onUpdate(false); this.writeHash(); return; }
    this.computeNational();
    var inSet = {}, near = {}, rows = [], self = this;
    Object.keys(A.zips).forEach(function (z) { var i = self.byZip[z]; if (i !== undefined) inSet[i] = 1; });
    A.circles.forEach(function (q) {   // ZIPs whose center is within each location's miles
      var lat0 = c.lat[q.i], lon0 = c.lon[q.i], dLat = q.r / 69, dLon = q.r / (69 * Math.cos(lat0 * Math.PI / 180));
      for (var i = 0; i < self.n; i++) {
        if (Math.abs(c.lat[i] - lat0) > dLat || Math.abs(c.lon[i] - lon0) > dLon) continue;
        if (miles(lat0, lon0, c.lat[i], c.lon[i]) <= q.r) { inSet[i] = 1; near[i] = 1; }
      }
    });
    var noRes = 0;
    Object.keys(inSet).forEach(function (k) {
      var i = +k, pop = c.acs_pop[i];
      if (!pop && !c.population[i]) { noRes++; return; }
      var d = null;
      if (near[i]) A.circles.forEach(function (q) { var x = miles(c.lat[q.i], c.lon[q.i], c.lat[i], c.lon[i]); if (d == null || x < d) d = x; });
      var aud = self.audience(i), share = aud != null && pop ? aud / pop : null, f = self.zipCounty[c.zip[i]];
      rows.push({ i: i, zip: c.zip[i], town: c.city[i] + ", " + c.state[i], county: f ? self.counties[f].n : "", dist: d, pop: pop, aud: aud, share: share,
                  idx: share != null && self.natRate ? share / self.natRate * 100 : null, dma: c.dma[i] });
    });
    A.noRes = noRes;
    this.rows = rows;
    this.writeHash();
    this.renderSummary();
    this.renderTable();
    this.renderMap(moved);
    if (this.cfg.onUpdate) this.cfg.onUpdate(rows.length > 0);
  };
  Radius.prototype.areaPhrase = function () {
    var n = this.state.area.n, parts = [];
    var pl = function (k, one, many) { if (k) parts.push(NF0.format(k) + " " + (k === 1 ? one : many)); };
    pl(n.county, "county", "counties"); pl(n.town, "town", "towns"); pl(n.zip, "ZIP", "ZIPs"); pl(n.loc, "location", "locations");
    return parts.length < 2 ? parts.join("") : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  };
  Radius.prototype.renderAreaReport = function (A) {
    var box = this.areaReport, self = this;
    box.innerHTML = ""; box.hidden = false;
    if (A.fileNote) box.appendChild(el("p", { class: "rz-note", text: A.fileNote }));
    if (A.tokens.length) {
      var res = this.rows ? this.rows.length : 0;
      box.appendChild(el("p", { class: "rz-area-ok", text: "Mapped " + this.areaPhrase() + ": " + NF0.format(res) + " residential ZIP" + (res === 1 ? "" : "s") + " in the area." +
        (A.noRes ? " " + NF0.format(A.noRes) + " PO box or business-only ZIP" + (A.noRes === 1 ? " has" : "s have") + " no residents and " + (A.noRes === 1 ? "is" : "are") + " left out." : "") }));
      var items = A.items.filter(function (x) { return x.kind !== "zip"; });
      if (items.length) {
        var shown = items.slice(0, 12).map(function (x) { return x.label + (x.count != null ? " (" + NF0.format(x.count) + " ZIP" + (x.count === 1 ? "" : "s") + ")" : ""); });
        box.appendChild(el("p", { class: "rz-note", text: "Read as: " + shown.join("; ") + (items.length > 12 ? "; and " + (items.length - 12) + " more." : ".") }));
      }
      if (A.padded.length) box.appendChild(el("p", { class: "rz-note", text: "Added a leading zero to " + A.padded.slice(0, 5).join(", ") + (A.padded.length > 5 ? " and " + (A.padded.length - 5) + " more" : "") + "." }));
      if (A.tokens.length > MAX_LINK_TOKENS) box.appendChild(el("p", { class: "rz-note", text: "This area is too large to save in the page link. Export the ZIP list to keep it." }));
    } else if (!A.bad.length) box.appendChild(el("p", { class: "rz-note", text: "The list is empty. Enter ZIPs, counties or towns, or upload a file." }));
    if (A.bad.length) {
      var list = el("ul", { class: "rz-area-bad" }, A.bad.slice(0, 15).map(function (b) { return el("li", null, [el("b", { text: b.text }), " " + b.why + "."]); }));
      box.appendChild(el("div", { class: "rz-area-warn" }, [el("p", { text: NF0.format(A.bad.length) + " item" + (A.bad.length === 1 ? " wasn't" : "s weren't") + " mapped:" }), list,
        A.bad.length > 15 ? el("p", { class: "rz-note", text: "And " + (A.bad.length - 15) + " more. Fix the list above and select Map this area again." }) : null]));
    }
  };
  Radius.prototype.readAreaFile = function (file) {
    var self = this, name = (file.name || "").toLowerCase();
    var read = /\.xlsx?$/.test(name) ?
      loadXLSX().then(function () { return file.arrayBuffer(); }).then(function (buf) {
        var wb = window.XLSX.read(buf, { type: "array" });
        return window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
      }) :
      file.text().then(parseCSV);
    read.then(function (rows) {
      var res = rowsToLines(rows);
      if (!res.lines.length) { self.showError("No ZIPs, counties or towns were found in " + file.name + ". Check that it has a column named ZIP, County or City, then upload it again."); return; }
      self.areaIn.value = res.lines.join("\n");
      self.loadCounties().then(function () {
        self.applyArea();
        var A = self.state.area || { tokens: [], bad: [], items: [], padded: [], n: {} };
        A.fileNote = file.name + ": " + NF0.format(res.rows) + " row" + (res.rows === 1 ? "" : "s") + " read, " + NF0.format(res.lines.length) + " different ZIP" + (res.lines.length === 1 ? "" : "s") + ", counties or locations." +
          (res.skipped ? " " + NF0.format(res.skipped) + " row" + (res.skipped === 1 ? " has" : "s have") + " no ZIP and " + (res.skipped === 1 ? "was" : "were") + " skipped." : "");
        if (self.state.area) self.renderAreaReport(A);
        else { var B = self.resolveArea(self.areaIn.value); B.fileNote = A.fileNote; self.renderAreaReport(B); }
      });
    }).catch(function (e) { self.showError(file.name + " couldn't be read: " + e.message + ". Save it as CSV or .xlsx and try again."); });
  };

  /* ---------- Used by an analyzer page that embeds the radius tool ---------- */
  Radius.prototype.resize = function () { if (this.map) this.map.invalidateSize(); };
  Radius.prototype.usePreset = function (id) { if (this.profiles[id] && this.state.profile !== id) this.applyProfile(id); };
  Radius.prototype.centerOn = function (zip) {
    if (!/^\d{5}$/.test(zip || "") || zip === this.state.zip) return;
    if (this.c) this.setCenter(zip); else this.state.zip = zip;
  };

  window.AdtaxiRadius = {
    start: function (cfg, root) {
      var app = new Radius(cfg, root || document.getElementById("app"));
      app.build();
      app.load().then(function () {
        if (app.state.zip && app.byZip[app.state.zip] !== undefined) {
          var c = app.c, i = app.byZip[app.state.zip];
          app.zipIn.value = app.state.zip + " " + c.city[i] + ", " + c.state[i];
        }
        if (app.state.mode === "area") app.startArea(); else app.update(true);
      }).catch(function (e) { app.showError(e.message + ". Refresh the page; if it keeps happening, the audience data hasn't been built yet."); });
      if (!cfg.embedded) window.addEventListener("hashchange", function () {
        if (!app.c) return;
        app.readHash(); app.syncFilters();
        app.rSel.value = app.state.r ? String(app.state.r) : ""; app.minSel.value = String(app.state.minIndex);
        var i = app.byZip[app.state.zip];
        if (i !== undefined) app.zipIn.value = app.state.zip + " " + app.c.city[i] + ", " + app.c.state[i];
        app.update(true);
      });
      return app;
    },
    filters: FILTERS
  };
})();
