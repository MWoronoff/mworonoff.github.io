/*
 * Adtaxi ZIP radius audience tool. Shared by the Healthcare, Legal, Higher Education, Home Services and Apartment analyzers.
 * A site page loads Leaflet, topojson-client, engine.css, this file and its own config, then calls
 * AdtaxiRadius.start(config, document.getElementById("app")).
 *
 * Audience math (per ZIP): base people x the share of each other selected trait, assuming traits are independent
 * within a ZIP. Gender x age is one Census table, so that part is exact; anything combined with it is an estimate.
 * Traits Census publishes by age (insurance, hearing, vision, living alone, home ownership, health conditions for adults)
 * are applied within each age group, so "hearing difficulty" among people 75+ uses the 75+ rate, not the all-ages rate.
 * A site picks its age groups with cfg.ageSet: "default" (15+, Higher Education), "health" (all ages), "adult" (18+) or "adult65" (18+, 55+ split at 65; franchise tools).
 * Target audience profiles (cfg.profiles; optional filters: [...] lists the filter groups shown for that audience): a category's starting audience. A profile's "either" list adds an or-condition
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
    // Franchise tools: 55+ split at 65 (sex x age columns m55_64, m65p, f55_64, f65p in zip_audience_inc.json)
    adult65:   { options: [["18_24", "18–24"], ["25_34", "25–34"], ["35_44", "35–44"], ["45_54", "45–54"], ["55_64", "55–64"], ["65p", "65+"]],
                 col: function (sex, b) { return sex + b; }, all: "adults18",
                 note: "Counts cover adults 18 and older. Leave a group blank to include every adult.",
                 method: "The audience starts from adults 18 and older. Counts of adults by sex and age come from one Census table, so a gender and age selection is an exact count." },
    // Franchise Trade area with cfg.hhCount: households by the householder's age, counted directly with income (Census B19037)
    householder: { options: [["2544", "25–44"], ["4564", "45–64"], ["65p", "65+"]], col: null, all: "hh19037",
                 note: "Counts are households, by the householder's age and the household's income, counted directly from one Census table. Leave a group blank to include every household.",
                 method: "Households come from one Census table of householder age by household income, so an age and income selection is a direct count of households, not an estimate. Census groups householders as 25 to 44, 45 to 64 and 65 and older." },
    adult:     { options: [["18_24", "18–24"], ["25_34", "25–34"], ["35_44", "35–44"], ["45_54", "45–54"], ["55p", "55+"]],
                 col: function (sex, b) { return sex + b; }, all: "adults18",
                 note: "Counts cover adults 18 and older. Leave a group blank to include every adult.",
                 method: "The audience starts from adults 18 and older. Counts of adults by sex and age come from one Census table, so a gender and age selection is an exact count." }
  };
  // Health conditions (CDC PLACES, adults): any of the selected, treating conditions as independent within a ZIP
  var CONDITIONS = [["diabetes", "Diabetes"], ["bphigh", "High blood pressure"], ["arthritis", "Arthritis"], ["obesity", "Obesity"],
                    ["depression", "Depression"], ["mhlth", "Frequent mental distress"], ["fairpoor", "Fair or poor health"]];
  // A ZIP's CDC PLACES rate covers all its adults. CDC's national rates by age (BRFSS, saved with the ZIP condition data)
  // split it across age groups: rate for an age = ZIP rate x national rate for that age / national rate at the ZIP's own
  // adult age mix, so the ZIP's total stays at CDC's figure while seniors get more and young adults fewer.
  var COND_AGE = null, ADULT_AGES = ["18_34", "35_64", "65_74", "75p"];
  function condRate(c, i, b, k) {
    var p = c[k] ? c[k][i] : null; if (p == null) return null; p = p / 1000;
    var r = COND_AGE && COND_AGE[k];
    if (r && r[b] != null && c.mh18_34) {
      var mix = 0, adults = 0;
      for (var a = 0; a < ADULT_AGES.length; a++) {
        var x = (c["mh" + ADULT_AGES[a]][i] || 0) + (c["fh" + ADULT_AGES[a]][i] || 0); mix += x * r[ADULT_AGES[a]]; adults += x;
      }
      if (mix > 0) p = p * r[b] * adults / mix;
    }
    return Math.min(0.95, p);
  }
  var INC4 = { lt50: ["lt35", "35_50"], "50_100": ["50_75", "75_100"], "100_150": ["100_150"], "150p": ["150_200", "200p"] };   // fewer income bands
  var INC5 = { lt50: ["lt35", "35_50"], "50_75": ["50_75"], "75_100": ["75_100"], "100_150": ["100_150"], "150p": ["150_200", "200p"] };
  var BUILT = [["pre1980", "Before 1980"], ["80_99", "1980–1999"], ["2000p", "2000 or later"]];
  var VALUES = [["lt200", "Under $200K"], ["200_400", "$200K–$399K"], ["400_750", "$400K–$749K"], ["750p", "$750K+"]];
  // Radius age groups -> Census college enrollment age groups (B14004)
  var ENR_MAP = { "15_17": ["15_17"], "18_24": ["18_24"], "25_34": ["25_34"], "35_44": ["35p"], "45_54": ["35p"], "55p": ["35p"],
                  "18_34": ["18_24", "25_34"], "35_64": ["35p"], "65_74": ["35p"], "75p": ["35p"] };
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
    // Franchise tools: $100K–$149K split at $125K (B19001 lines 14 and 15, in zip_audience_inc.json). Until that file is
    // loaded, the band is split at the national ratio (about 56% under $125K).
    income8:  { label: "Household income", type: "multi", options: [["lt35", "Under $35K"], ["35_50", "$35K–$49K"], ["50_75", "$50K–$74K"], ["75_100", "$75K–$99K"],
                           ["100_125", "$100K–$124K"], ["125_150", "$125K–$149K"], ["150_200", "$150K–$199K"], ["200p", "$200K+"]],
                share: function (c, i, sel) { return ratio(sum(sel, function (b) {
                  if (c["inc_" + b]) return c["inc_" + b][i];
                  var x = c.inc_100_150[i]; return x == null ? null : b === "100_125" ? x * 0.56 : b === "125_150" ? x * 0.44 : 0;
                }), c.inc_tot[i]); } },
    parented: { label: "Parents' education (head of household)", type: "multi",
                options: [["nocol", "No college"], ["some", "Some college or associate's"], ["ba", "Bachelor's or higher"]],
                share: function (c, i, sel) { return ratio(sum(sel, function (b) { return c["hhed_" + b][i]; }), c.hhed_tot[i]); } },
    kids:     { label: "Children at home", type: "flag", text: "Households with children under 18", share: function (c, i) { return ratio(c.hh_kids[i], c.hh_tot[i]); } },
    // Each age group's own college enrollment rate (Census B14004: 15-17, 18-24, 25-34, 35+); about 4 in 10 at 18-24, far
    // fewer at older ages. If that file hasn't loaded, falls back to the all-ages rate.
    enrolled: { label: "Currently enrolled", type: "flag", text: "In college or graduate school",
                byAge: function (c, i, b) {
                  if (b === "u18") return 0;
                  var g = ENR_MAP[b];
                  if (!g || !c["enr_" + g[0]]) return ratio(c.enr_college[i], c.enr_tot[i]);
                  var e = 0, t = 0;
                  for (var k = 0; k < g.length; k++) { var x = c["enr_" + g[k]][i], y = c["ent_" + g[k]][i]; if (x == null || y == null) return null; e += x; t += y; }
                  return t ? Math.min(1, e / t) : 0;
                } },
    hispanic: { label: "Hispanic or Latino", type: "flag", text: "Hispanic or Latino", share: function (c, i) { return ratio(c.hispanic[i], c.hisp_tot[i]); } },
    spanish:  { label: "Spanish at home", type: "flag", text: "Spanish spoken at home", share: function (c, i) { return ratio(c.lang_spanish[i], c.pop5[i]); } },
    // Veterans are adults 18+ and "some college, no degree" is measured for adults 25+: the rate applies only to those ages
    veterans: { label: "Veterans", type: "flag", text: "Civilian veterans 18+",
                byAge: function (c, i, b) { return b === "u18" || b === "15_17" ? 0 : ratio(c.veterans[i], c.vet_tot[i]); } },
    somecollege: { label: "Some college, no degree", type: "flag", text: "Adults 25+ who started college but didn't finish",
                   byAge: function (c, i, b) { return b === "u18" || b === "15_17" || b === "18_24" ? 0 : ratio(c.some_college[i], c.adults25[i]); } },
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
                    for (var k = 0; k < sel.length; k++) { var p = condRate(c, i, b, sel[k]); if (p == null) return null; none *= 1 - p; }
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
  /* ZIP context columns: area rates shown beside each ZIP (and sortable), not applied to people as filters.
     IRS shares of returns and CDC PLACES adult rates are ZIP-level estimates; they say how common something is
     in a ZIP, not who it applies to. A preset lists its columns in context and can rank by one with sortBy. */
  function listAnd(a) { return a.length < 3 ? a.join(" and ") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  function per1000(c, i, k) { var v = c[k] ? c[k][i] : null; return v == null ? null : Math.min(1, v / 1000); }
  function presetSort(p) { return p && p.sortBy && CONTEXT[p.sortBy] ? "x_" + p.sortBy : "idx"; }
  var CONTEXT = {
    prep:     { label: "Paid preparer", long: "Share of tax returns filed by a paid preparer (IRS)", value: function (c, i) { return irsShare(c, i, "prep"); } },
    eitc:     { label: "EITC returns", long: "Share of tax returns claiming the Earned Income Credit (IRS)", value: function (c, i) { return irsShare(c, i, "eitc"); } },
    selfemp:  { label: "Self-employed", long: "Share of tax returns with business or self-employment income (IRS)", value: function (c, i) { return irsShare(c, i, "selfemp"); } },
    hi200:    { label: "$200K+ income", long: "Share of tax returns with income of $200K or more (IRS)", value: function (c, i) { return irsShare(c, i, "hi200"); } },
    div:      { label: "Dividends", long: "Share of tax returns with dividend income (IRS)", value: function (c, i) { return irsShare(c, i, "div"); } },
    cg:       { label: "Capital gains", long: "Share of tax returns reporting capital gains (IRS)", value: function (c, i) { return irsShare(c, i, "cg"); } },
    ira:      { label: "IRA income", long: "Share of tax returns with IRA distributions (IRS)", value: function (c, i) { return irsShare(c, i, "ira"); } },
    pens:     { label: "Pension income", long: "Share of tax returns with pension or annuity income (IRS)", value: function (c, i) { return irsShare(c, i, "pens"); } },
    diabetes: { label: "Diabetes", long: "Share of adults with diabetes (CDC PLACES)", value: function (c, i) { return per1000(c, i, "diabetes"); } },
    bphigh:   { label: "High BP", long: "Share of adults with high blood pressure (CDC PLACES)", value: function (c, i) { return per1000(c, i, "bphigh"); } },
    arthritis:{ label: "Arthritis", long: "Share of adults with arthritis (CDC PLACES)", value: function (c, i) { return per1000(c, i, "arthritis"); } },
    obesity:  { label: "Obesity", long: "Share of adults with obesity (CDC PLACES)", value: function (c, i) { return per1000(c, i, "obesity"); } },
    depression:{ label: "Depression", long: "Share of adults ever told they have depression (CDC PLACES)", value: function (c, i) { return per1000(c, i, "depression"); } },
    mhlth:    { label: "Mental distress", long: "Share of adults with frequent mental distress (CDC PLACES)", value: function (c, i) { return per1000(c, i, "mhlth"); } },
    nodental: { label: "No dental visit", long: "Share of adults with no dental visit in the past year (CDC PLACES)", value: function (c, i) { return per1000(c, i, "nodental"); } },
    nomortg:  { label: "Owned free and clear", long: "Share of owner-occupied homes with no mortgage (Census ACS): home equity many buyers use to fund a business",
                value: function (c, i) { return c.own_units ? ratio(c.mortg_free ? c.mortg_free[i] : null, c.own_units[i]) : null; } },
    val500:   { label: "$500K+ homes", long: "Share of owner-occupied homes valued at $500,000 or more (Census ACS)",
                value: function (c, i) { return c.val_own ? ratio(c.val500 ? c.val500[i] : null, c.val_own[i]) : null; } },
    mgmt:     { label: "Managers", long: "Share of employed people 16+ in management occupations (Census ACS)",
                value: function (c, i) { var m = c.mgmt && c.mgmt[i], t = c.occ_tot && c.occ_tot[i]; return m == null || !t ? null : ratio(m, t); } },
    ba:       { label: "Bachelor's+", long: "Share of adults 25+ with a bachelor's degree or higher (Census ACS)",
                value: function (c, i) { var a = c.ba_only && c.ba_only[i], g = c.grad_deg && c.grad_deg[i]; return a == null || g == null ? null : ratio(a + g, c.adults25[i]); } }
  };
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

  // Export menu: one button that opens a short list of choices (same as the analyzer page's)
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
  // Leave-behind: the current view laid out for print (Save as PDF), with an Adtaxi heading and no controls
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
    setTimeout(function () { window.print(); }, 450);
  }
  function money(v) { return "$" + NF0.format(v); }
  function parseMoney(t) { var v = parseFloat(String(t || "").replace(/[$,\s]/g, "")); return isFinite(v) && v > 0 ? v : null; }

  // Budget split: each ZIP's share follows its estimated audience (or audience x index, to lean toward above-average ZIPs).
  // by "score" (sites with cfg.blendScore): the ZIPs are picked in Score order, the same ranking as the ZIP table, and each
  // one's share follows audience x Score, so a larger ZIP with the same Score gets more. Unscored (tiny) ZIPs are left out.
  // Whole dollars that add up exactly to the budget (largest remainders get the leftover dollars).
  function splitBudget(rows, budget, by, n) {
    var pick = rows.filter(function (r) { return r.aud != null && r.aud > 0 && (by !== "score" || r.score != null); }).map(function (r) {
      return { r: r, w: by === "score" ? r.aud * Math.max(r.score, 1) / 100 : by === "weighted" ? r.aud * (r.idx == null ? 1 : r.idx / 100) : r.aud };
    }).filter(function (x) { return x.w > 0; });
    pick.sort(by === "score" ? function (a, b) { return (b.r.score - a.r.score) || (b.r.aud - a.r.aud); } : function (a, b) { return b.w - a.w; });
    if (n) pick = pick.slice(0, n);
    var W = pick.reduce(function (t, x) { return t + x.w; }, 0);
    pick.forEach(function (x) { x.share = W ? x.w / W : 0; });
    if (budget) {
      var whole = Math.round(budget), used = 0;
      pick.forEach(function (x) { var raw = whole * x.share; x.amt = Math.floor(raw); x.frac = raw - x.amt; used += x.amt; });
      pick.slice().sort(function (a, b) { return b.frac - a.frac; }).slice(0, whole - used).forEach(function (x) { x.amt += 1; });
    }
    return pick;
  }

  function Radius(cfg, root) {
    this.cfg = cfg; this.root = root; this.geo = {};
    this.ages = AGE_SETS[cfg.ageSet || "default"];
    this.filterDefs = {};
    for (var k in FILTERS) this.filterDefs[k] = FILTERS[k];
    this.filterDefs.age = { label: cfg.hhCount ? "Householder age" : "Age", type: "multi", options: this.ages.options };
    this.state = { unit: cfg.countiesFirst ? "county" : "zip", zip: cfg.defaultZip || "", r: cfg.defaultRadius || 0, minIndex: 0, sortKey: cfg.blendScore ? "score" : "aud", sortDir: "desc", show: 50, sel: {}, profile: null,
                   mode: "radius", area: null, areaTokens: null };
    this.profiles = {};
    (cfg.profiles || []).forEach(function (p) { this.profiles[p.id] = p; }, this);
    if (cfg.embedded) {   // inside an analyzer page: the analyzer owns the URL and passes the starting ZIP, radius and preset
      var ini = cfg.initial || {};
      if (/^\d{5}$/.test(ini.zip || "")) this.state.zip = ini.zip;
      if (+ini.r > 0) this.state.r = +ini.r;
      if (ini.p && this.profiles[ini.p]) { this.state.profile = ini.p; this.state.sel = JSON.parse(JSON.stringify(this.profiles[ini.p].sel)); this.state.sortKey = this.cfg.blendScore ? "score" : presetSort(this.profiles[ini.p]); }
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
    if (s.profile && !hasF) { s.sel = JSON.parse(JSON.stringify(this.profiles[s.profile].sel)); s.sortKey = this.cfg.blendScore ? "score" : presetSort(this.profiles[s.profile]); s.sortDir = "desc"; }
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
      oninput: function () { self.suggest(this.value); var v = this.value.trim(); if (/^\d{5}$/.test(v) && self.byZip && self.byZip[v] !== undefined && v !== self.state.zip) self.setCenter(v); } });   // a full ZIP applies as soon as it is typed
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
    // Radius or custom area (sites with customArea: true): two ways to draw the same trade area
    this.modeSeg = cfg.customArea ? el("div", { class: "az-seg", role: "group", "aria-label": "Draw the area as" }, [["radius", "Radius"], ["area", "Custom area"]].map(function (m) {
      return el("button", { type: "button", "data-mode": m[0], text: m[1], "aria-pressed": String(s.mode === m[0]),
        onclick: function () { self.setMode(m[0]); self.writeHash(); } });
    })) : null;
    var controls = el("section", { class: "az-controls", "aria-label": "Trade area controls" }, [
      this.modeSeg ? el("div", { class: "az-field" }, [el("span", { text: "Area" }), this.modeSeg]) : null,
      this.centerField = el("label", { class: "az-field" }, [el("span", { text: "Center" }), this.zipIn, this.towns]),
      this.radiusField = el("label", { class: "az-field" }, [el("span", { text: "Radius" }), this.rSel]),
      el("label", { class: "az-field" }, [el("span", { text: "Show" }), this.minSel]),
      el("div", { class: "az-field" }, [el("span", { text: "Rank and map" }), this.unitSeg = el("div", { class: "az-seg", role: "group", "aria-label": "Rank and map by ZIP or county" },
        (cfg.countiesFirst ? [["county", "Counties"], ["zip", "ZIPs"]] : [["zip", "ZIPs"], ["county", "Counties"]]).map(function (u) {
          return el("button", { type: "button", "data-unit": u[0], text: u[1], "aria-pressed": String(s.unit === u[0]), title: u[0] === "county" ? "Add up the area's ZIPs by county" : "Rank each ZIP in the area",
            onclick: function () { self.setUnit(u[0]); } });
        }))]),
      el("div", { class: "az-actions" }, [
        el("button", { type: "button", class: "az-btn", text: "How estimates work", onclick: function () { self.openMethod(); } }),
        cfg.persona ? el("button", { type: "button", class: "az-btn", text: "Persona", title: "A one-page portrait of the selected households in this area", onclick: function () { self.openPersona(); } }) : null,
        exportMenu([
          { label: "Leave-behind (PDF)", note: "A clean page of this trade area to send after the meeting", run: function () { self.leaveBehind(); } },
          { label: "ZIP list (CSV)", note: "Every ZIP in the area for a spreadsheet", run: function () { self.exportCSV(); } }])])]);
    this.errorBox = el("div", { class: "az-error", role: "alert", hidden: true });
    this.areaPanel = cfg.customArea ? this.buildArea() : null;

    // Filters: multi-choice groups as chips, yes/no filters together under one heading
    var defs = this.filterDefs;
    var flags = cfg.filters.filter(function (k) { return defs[k].type === "flag"; });
    var groups = cfg.filters.filter(function (k) { return defs[k].type !== "flag"; }).map(function (key) {
      var f = defs[key];
      return el("fieldset", { class: "rz-group", "data-key": key }, [el("legend", { text: f.label }), el("div", { class: "rz-chips" }, f.options.map(function (o) {
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
      return el("label", { class: "rz-check", title: f.label, "data-key": key }, [el("input", { type: "checkbox", "data-f": key, onchange: function () { if (this.checked) s.sel[key] = true; else delete s.sel[key]; self.update(false); } }), el("span", { text: f.text })]);
    }))));
    var presets = (cfg.presets || []).length ? el("div", { class: "rz-presets" }, [el("span", { class: "rz-presets-label", text: cfg.profiles ? "More audiences" : "Start from" })].concat(cfg.presets.map(function (p) {
      return el("button", { type: "button", class: "az-btn", text: p.label, onclick: function () { s.sel = JSON.parse(JSON.stringify(p.sel)); s.profile = null; self.syncFilters(); self.update(false); } });
    }))) : null;
    var profileBox = null;
    if ((cfg.profiles || []).length) {
      this.profileSel = el("select", { "aria-label": "Target audience", onchange: function () { self.applyProfile(this.value); } },
        [el("option", { value: "", text: "Custom audience" })].concat(cfg.profiles.map(function (p) { return el("option", { value: p.id, text: p.label }); })));
      this.eitherBox = el("div", { class: "rz-either", hidden: true });
      profileBox = el("div", { class: "rz-profile" }, [el("label", { class: "az-field" }, [el("span", { text: cfg.profileLabel || "Target audience" }), this.profileSel]),
        this.profileNote = el("p", { class: "rz-note" }), this.eitherBox]);
    }
    this.filterPanel = el("aside", { class: "az-panel rz-filters", "aria-label": "Audience filters" }, [
      el("div", { class: "rz-filters-head" }, [el("h2", { text: "Audience" }),
        el("button", { type: "button", class: "rz-clear", text: "Clear all", onclick: function () { s.sel = {}; s.profile = null; self.syncFilters(); self.update(false); } })]),
      profileBox, presets].concat(groups).concat([el("p", { class: "rz-note", text: this.ages.note })]));

    // Summary + map
    this.summary = el("div", { class: "rz-summary", "aria-live": "polite" });
    this.legend = el("div", { class: "az-legend rz-legend", "aria-label": "Map legend" });
    this.mktBar = el("div", { class: "rz-mkts", role: "group", "aria-label": "Markets in the area", hidden: true });
    this.miniGrid = el("div", { class: "rz-minis", hidden: true });
    this.mapEl = el("div", { class: "az-map rz-map", role: "region", "aria-label": "Map of ZIPs in the radius" });
    this.extra = el("div", { class: "rz-extra" });   // filled by an analyzer page that embeds the tool (ad response and category ad spend, below the ZIP table)
    var right = el("div", { class: "rz-right" }, [this.summary, el("div", { class: "az-panel az-map-panel rz-map-panel" }, [this.mktBar, this.mapEl, this.miniGrid, this.legend])]);

    // Table
    this.tableTitle = el("h2"); this.tableNote = el("span");
    this.thead = el("thead"); this.tbody = el("tbody");
    var table = el("section", { class: "az-panel az-table-panel" }, [el("div", { class: "az-table-head" }, [this.tableTitle, this.tableNote]),
      el("div", { class: "az-tablewrap" }, [el("table", { class: "az-table" }, [this.thead, this.tbody])])]);
    this.modalBody = el("div", { class: "az-modal-body" });
    this.modal = el("dialog", { class: "az-modal", "aria-labelledby": "rz-method-title" }, [this.modalBody]);
    var sources = el("section", { class: "az-panel az-sources" }, [el("h2", { text: "Sources" }), this.sourcesP = el("p"),
      el("p", { class: "az-disclaimer", text: cfg.disclaimer || "Estimates for planning. Scores and figures are modeled from public government and licensed third-party data." }),
      el("p", { class: "az-version", text: "Adtaxi Market Analyzers · " + (cfg.version || "Fall 2026") })]);
    this.budgetBox = this.buildBudget();

    // Order: who and where (map, ZIPs) -> how they respond (ad response, category ad spend) -> Recommended allocation
    // Persona (sites with cfg.persona): a composite portrait of the selected households, between the map and the rankings
    // Opened with the Persona button; kept up to date with every selection while closed
    this.personaBox = cfg.persona ? el("div", { class: "rz-persona", hidden: true }) : null;
    this.personaDlg = cfg.persona ? el("dialog", { class: "az-modal rz-persona-dlg", "aria-label": "Persona" }, [el("div", { class: "rz-persona-bar" }, [
      el("button", { type: "button", class: "az-btn primary", text: "Print or save as PDF", onclick: function () { self.printPersona(); } }),
      el("button", { type: "button", class: "az-modal-close", "aria-label": "Close", text: "\u00d7", onclick: function () { self.personaDlg.close(); } })]), this.personaBox]) : null;
    var main = el("main", { class: "az-main" }, [controls, this.areaPanel, this.errorBox, el("section", { class: "rz-stage" }, [this.filterPanel, right]), table, this.extra, this.budgetBox, sources]);
    this.root.innerHTML = ""; if (header) this.root.appendChild(header); this.root.appendChild(main); this.root.appendChild(this.modal);
    if (this.personaDlg) this.root.appendChild(this.personaDlg);
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
    if (p) { s.sel = JSON.parse(JSON.stringify(p.sel)); s.sortKey = this.cfg.blendScore ? "score" : presetSort(p); s.sortDir = "desc"; }
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
    // A target audience can list the filters that pertain to it (profile.filters); the rest are hidden. Custom audience shows them all.
    var shown = p && p.filters ? p.filters.concat(Object.keys(p.sel || {})) : null;
    Array.prototype.forEach.call(this.filterPanel.querySelectorAll("[data-key]"), function (g) { g.hidden = !!shown && shown.indexOf(g.getAttribute("data-key")) < 0; });
    Array.prototype.forEach.call(this.filterPanel.querySelectorAll(".rz-flags"), function (g) { g.hidden = !g.querySelector(".rz-check:not([hidden])"); });
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
      if (d.meta && d.meta.ageRates && Object.keys(d.meta.ageRates).length) COND_AGE = d.meta.ageRates;
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
    if (!this.c) return;   // ZIP data still loading: start() applies whatever is in the box once it arrives
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
  // cfg.hhCount: the selected householder ages x household incomes, added up from the direct counts (h<age>_<income>);
  // any other selected filter (e.g. veterans) is then applied as a share
  Radius.prototype.hhAudience = function (i) {
    var c = this.c, sel = this.state.sel, defs = this.filterDefs;
    var ages = sel.age && sel.age.length ? sel.age : this.ages.options.map(function (x) { return x[0]; });
    var incs = sel.income8 && sel.income8.length ? sel.income8 : defs.income8.options.map(function (x) { return x[0]; });
    var base = 0;
    for (var a = 0; a < ages.length; a++) for (var b = 0; b < incs.length; b++) {
      var col = c["h" + ages[a] + "_" + incs[b]]; if (!col) return null;
      var v = col[i]; if (v == null) return null; base += v;
    }
    var keys = Object.keys(sel);
    for (var k = 0; k < keys.length && base > 0; k++) {
      if (keys[k] === "age" || keys[k] === "income8" || keys[k] === "gender") continue;
      var f = defs[keys[k]], x = f.byAge ? f.byAge(c, i, "hh", sel[keys[k]], sel) : f.share ? f.share(c, i, sel[keys[k]], sel) : 1;
      if (x == null) return null; base *= x;
    }
    return base;
  };
  Radius.prototype.audience = function (i) {
    if (this.cfg.hhCount) return this.hhAudience(i);
    var c = this.c, sel = this.state.sel, defs = this.filterDefs, ages = this.ages, base;
    // Both genders ticked is the same as no gender filter (counts everyone, not just the ages the sex x age table covers)
    var g = sel.gender && sel.gender.length === 1 ? sel.gender : null, a = sel.age && sel.age.length ? sel.age : null;
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
    if (this.cfg.hhCount) return Object.keys(sel).some(function (k) { return k !== "age" && k !== "income8" && k !== "gender" && picked(sel[k]) && (defs[k].share || defs[k].byAge); });
    return !!this.state.profile || Object.keys(sel).some(function (k) { return defs[k].share || defs[k].byAge; });
  };
  // What share and index are measured against: residents, or all households when the count is households (cfg.hhCount)
  Radius.prototype.baseOf = function (i) { var c = this.c; return this.cfg.hhCount ? (c.hh19037 ? c.hh19037[i] : null) : c.acs_pop[i]; };
  Radius.prototype.computeNational = function () {
    var A = 0, P = 0;
    for (var i = 0; i < this.n; i++) {
      var a = this.audience(i), p = this.baseOf(i);
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
      var aud = this.audience(i), base = this.baseOf(i), share = aud != null && base ? aud / base : null;
      rows.push({ i: i, zip: c.zip[i], town: c.city[i] + ", " + c.state[i], dist: d, pop: pop, base: base, aud: aud, share: share,
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
    var msg = !this.c ? "Loading ZIP data… a ZIP or town entered above will apply as soon as it's ready." :
              s.mode === "area" ? "List ZIPs, counties, towns, DMAs or metros above, or upload a file, then select Map this area." : hasZip ? "Choose a radius to see the audience around " + s.zip + "." :
              s.r ? "Enter a ZIP or town to see the audience within " + s.r + " miles." :
              "Enter a ZIP or town and choose a radius to see the audience.";
    this.rows = null; this.mapToken = (this.mapToken || 0) + 1;
    ["circle", "centerMark", "zipLayer", "areaLayer", "countyLayer"].forEach(function (k) { if (this[k]) { this.map.removeLayer(this[k]); this[k] = null; } }, this);
    if (this.map) this.clearMarkets();
    if (hasZip && this.map) this.map.setView([this.c.lat[this.byZip[s.zip]], this.c.lon[this.byZip[s.zip]]], 9);
    this.summary.innerHTML = "";
    this.summary.appendChild(el("p", { class: "az-empty", text: msg }));
    this.tbody.innerHTML = ""; this.thead.innerHTML = ""; this.tableTitle.textContent = s.mode === "area" ? "ZIPs in the area" : "ZIPs in range"; this.tableNote.textContent = "";
    if (this.budgetBox) this.budgetBox.hidden = true;
  };
  Radius.prototype.renderSummary = function () {
    var s = this.state, c = this.c, rows = this.visible(), A = 0, P = 0, pop = 0;
    rows.forEach(function (r) { if (r.aud != null) { A += r.aud; P += r.base || 0; pop += r.pop || 0; } });   // P: what share is measured against
    var share = P ? A / P : null, idx = share != null && this.natRate ? share / this.natRate * 100 : null, est = this.isEstimate();
    var ci = this.byZip[s.zip];
    this.summary.innerHTML = "";
    var stat = function (val, label) { return el("div", { class: "rz-stat" }, [el("b", { class: "num", text: val }), el("span", { text: label })]); };
    var cfg = this.cfg, where = s.mode === "area" ? " in the custom area (" + this.areaPhrase() + ")" : " within " + s.r + " miles of " + s.zip + " " + c.city[ci] + ", " + c.state[ci];
    var minTxt = s.minIndex ? " (ZIPs at index " + s.minIndex + "+)" : "", label;
    if (cfg.audienceNoun) {   // e.g. franchise: "Qualified adults", a reachable pool rather than a count of likely buyers
      label = cfg.audienceNoun + (est ? " (estimated)" : "") + where + minTxt +
        (s.profile && cfg.audienceFit ? ": " + cfg.audienceFit.replace("{profile}", this.profiles[s.profile].label) : "");
    } else {
      label = (s.profile ? "Target audience: " + this.profiles[s.profile].label + ", e" : est ? "E" : "") + (s.profile || est ? "stimated audience" : "Audience") + where + minTxt;
    }
    this.summary.appendChild(el("div", { class: "rz-stat rz-stat-main" }, [el("b", { class: "num", text: NF0.format(Math.round(A)) }), el("span", { text: label })]));
    var shareStat = stat(share == null ? "—" : NF1.format(share * 100) + "%", this.cfg.shareLabel || "Share of population");
    var idxStat = stat(idx == null ? "—" : NF0.format(idx), "Index vs. U.S. (100 = average)");
    if (cfg.leadWithIndex) { idxStat.classList.add("rz-stat-key"); this.summary.appendChild(idxStat); this.summary.appendChild(shareStat); }
    else { this.summary.appendChild(shareStat); this.summary.appendChild(idxStat); }
    this.summary.appendChild(stat(NF0.format(rows.length), "ZIPs"));
    this.summary.appendChild(stat(NF0.format(pop), "Population"));
    if (cfg.summaryNote) this.summary.appendChild(el("p", { class: "rz-summary-note", text: cfg.summaryNote }));
    this.renderPersona(rows, A, share, idx);
  };

  /* ---------- Persona (cfg.persona) ----------
     A composite portrait of the selected households in this trade area, at three levels, each labeled:
       This group:          direct Census counts of the selected households (householder age by income; ownership by age)
       Their neighborhoods: ZIP-wide rates, averaged with each ZIP weighted by how many of the selected households live there
       National survey:     AudienceSCAN groups closest to the profile (cfg.persona.national), and the blended ad response
     Nothing is shown that the data can't back; it describes a group of households, not an individual. */
  var PERSONA_RATES = [
    ["ba", "Adults with a bachelor's degree or higher", function (c, i) { return c.ba_only && c.grad_deg ? [c.ba_only[i] + c.grad_deg[i], c.adults25[i]] : null; }],
    ["grad", "Adults with a graduate degree", function (c, i) { return c.grad_deg ? [c.grad_deg[i], c.adults25[i]] : null; }],
    ["mgmt", "Workers in management jobs", function (c, i) { return c.mgmt ? [c.mgmt[i], c.occ_tot[i]] : null; }],
    ["hi200", "Tax returns with income of $200K+", function (c, i) { return c.hi200 ? [c.hi200[i], c.returns[i]] : null; }],
    ["cg", "Tax returns with capital gains", function (c, i) { return c.cg ? [c.cg[i], c.returns[i]] : null; }],
    ["married", "Households that are married couples", function (c, i) { return c.hh_married ? [c.hh_married[i], c.hh_type[i]] : null; }],
    ["kids", "Households with children under 18", function (c, i) { return c.hh_kids ? [c.hh_kids[i], c.households[i]] : null; }],
    ["sfd", "Homes that are single-family detached", function (c, i) { return c.sfd ? [c.sfd[i], c.units[i]] : null; }],
    ["val500", "Owner homes valued at $500K+", function (c, i) { return c.val500 ? [c.val500[i], c.val_own[i]] : null; }],
    ["vets", "Adults who are veterans", function (c, i) { return c.veterans ? [c.veterans[i], c.vet_tot[i]] : null; }]
  ];
  Radius.prototype.personaUS = function () {
    if (this._pUS) return this._pUS;
    var c = this.c, out = {};
    PERSONA_RATES.forEach(function (d) {
      var n = 0, t = 0;
      for (var i = 0; i < this.n; i++) { var x = d[2](c, i); if (x && x[0] != null && x[1]) { n += x[0]; t += x[1]; } }
      out[d[0]] = t ? n / t : null;
    }, this);
    return (this._pUS = out);
  };
  Radius.prototype.renderPersona = function (rows, A, share, idx) {
    var box = this.personaBox, cfg = this.cfg, P = cfg.persona, s = this.state, c = this.c, self = this;
    if (!box) return;
    box.innerHTML = "";
    rows = rows.filter(function (r) { return r.aud != null && r.aud > 0; });
    if (!rows.length || !A) { box.hidden = true; return; }
    box.hidden = false;
    var pct = function (x) { return x == null ? "\u2014" : NF0.format(x * 100) + "%"; };
    var prof = s.profile && this.profiles[s.profile];
    var defs = this.filterDefs, sel = s.sel;
    var same = prof && JSON.stringify(prof.sel) === JSON.stringify(sel);   // the profile as defined, not edited
    var key = same ? s.profile : "_custom";
    var ctx = cfg.context ? cfg.context() : {}, ad = ctx.ad, adSub = ad && ad.subs ? ad.subs[s.profile] || ad.subs[ctx.sub] : null;
    var nat = P.national && P.national[s.profile] ? P.national[s.profile] : null;
    // This group: direct counts (households by householder age and income)
    var ages = sel.age && sel.age.length ? sel.age : this.ages.options.map(function (x) { return x[0]; });
    var incs = sel.income8 && sel.income8.length ? sel.income8 : defs.income8.options.map(function (x) { return x[0]; });
    var lab = function (opts, k) { var o = opts.filter(function (x) { return x[0] === k; })[0]; return o ? o[1] : k; };
    var sumCol = function (name) { var t = 0; rows.forEach(function (r) { var v = c[name] && c[name][r.i]; if (v) t += v; }); return t; };
    var direct = !!cfg.hhCount && Object.keys(sel).every(function (k) { return k === "age" || k === "income8" || !picked(sel[k]); });
    var incMix = [], ageMix = [], own = null;
    if (cfg.hhCount) {
      incs.forEach(function (b) { var t = 0; ages.forEach(function (a) { t += sumCol("h" + a + "_" + b); }); incMix.push([lab(defs.income8.options, b), t]); });
      ages.forEach(function (a) { var t = 0; incs.forEach(function (b) { t += sumCol("h" + a + "_" + b); }); ageMix.push([lab(this.ages.options, a), t]); }, this);
      var o = 0, rt = 0; ages.forEach(function (a) { o += sumCol("own" + a); rt += sumCol("rent" + a); });
      own = o + rt ? o / (o + rt) : null;
    }
    var tot = incMix.reduce(function (x, y) { return x + y[1]; }, 0) || 1;
    // Their neighborhoods: ZIP rates weighted by the selected households in each ZIP
    var US = this.personaUS(), hood = {};
    PERSONA_RATES.forEach(function (d) {
      var w = 0, t = 0; rows.forEach(function (r) { var x = d[2](c, r.i); if (x && x[0] != null && x[1]) { t += r.aud * x[0] / x[1]; w += r.aud; } });
      hood[d[0]] = w ? t / w : null;
    });
    // Where they are: towns holding the most of these households
    var towns = {}; rows.forEach(function (r) { towns[r.town] = (towns[r.town] || 0) + r.aud; });
    var topTowns = Object.keys(towns).sort(function (a, b) { return towns[b] - towns[a]; }).slice(0, 6);
    // How they respond: the profile's ad response (blended where the site blends groups)
    var SHORTS = { "Ad on a social network": "social", "Streaming TV advertising (such as Hulu, Pluto TV or YouTube TV)": "streaming TV", "Ad on search results pages (like on Google, Yahoo or Bing)": "search",
      "Mobile phone app or text message": "mobile apps and texts", "Television (traditional, including cable or satellite subscription)": "TV", "Ad that plays before or during the video you want to watch": "pre-roll video",
      "Online display ads (banners and pop-up ads)": "online display", "Emailed ad or newsletter": "email" };
    var media = adSub ? adSub.rows.slice().sort(function (a, b) { return b[1] - a[1]; }).slice(0, 4) : [];
    var short = function (t) { return SHORTS[t] || t.replace(/ \(.*\)$/, "").toLowerCase(); };
    // Layout: one lead sentence, a stat strip, then three columns (Personal, Household, Media and lifestyle).
    // Every row carries its level: Local (Census counts for this area), ZIP-wide (neighborhood rates) or National (AudienceSCAN).
    var ageSpan = function () { var l = ageMix.map(function (x) { return x[0]; }), lo = l[0].split(/[–+]/)[0], last = l[l.length - 1];
      return /\+$/.test(last) ? lo + " and older" : lo + " to " + last.split("–")[1]; };
    var incTxt = cfg.hhCount ? (incs.length === 1 ? lab(defs.income8.options, incs[0]) : lab(defs.income8.options, incs[0]).replace(/–.*$/, "") + (incs[incs.length - 1] === "200p" ? " or more" : " to " + lab(defs.income8.options, incs[incs.length - 1]).replace(/^.*–/, ""))) : "";
    var tw = topTowns.slice(0, 3), st = tw.map(function (t) { var m = /,\s*([A-Z]{2})$/.exec(t); return m ? m[1] : ""; });
    var oneSt = st[0] && st.every(function (x) { return x === st[0]; });
    if (oneSt) tw = tw.map(function (t) { return t.replace(/,\s*[A-Z]{2}$/, ""); });
    var list = function (a) { return a.length < 2 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; };
    var lead = "About " + NF0.format(Math.round(A)) + " households in this area fit the profile" + (cfg.hhCount ? ": householders " + ageSpan() + " earning " + incTxt : "") +
      (tw.length ? ", most of them in and around " + list(tw) + (oneSt ? ", " + st[0] : "") : "") + ".";
    var title = (P.titles && P.titles[key]) || "Your selected households";
    var kicker = "Persona · " + ((P.kickers && P.kickers[key]) || (prof ? prof.label + " (edited)" : "Custom audience"));
    box.appendChild(el("div", { class: "rz-p-head" }, [el("span", { class: "rz-p-kicker", text: kicker }), el("b", { class: "rz-p-title", text: title })]));
    box.appendChild(el("p", { class: "rz-p-sub", text: this.describe() + " · " + (s.mode === "area" ? "Custom area (" + this.areaPhrase() + ")" : s.r + " miles around " + s.zip) }));
    box.appendChild(el("p", { class: "rz-p-story", text: lead }));
    var stat = function (v, t) { return el("div", { class: "rz-p-stat" }, [el("b", { text: v }), el("span", { text: t })]); };
    box.appendChild(el("div", { class: "rz-p-stats" }, [stat(NF0.format(Math.round(A)), (cfg.audienceNoun || "Audience").toLowerCase() + " here"),
      stat(pct(share), (cfg.shareLabel || "Share of population").toLowerCase()), stat(idx == null ? "—" : NF0.format(idx), "index vs. U.S. (100 = average)"),
      stat(topTowns.slice(0, 2).join("; ") || "—", "most of these households")]));
    var LV = { L: ["Local", "rz-lv-l"], Z: ["ZIP-wide", "rz-lv-z"], N: ["National", "rz-lv-n"] };
    var row = function (l, v, ref, lv) { return el("div", { class: "rz-p-row" }, [el("span", null, [l, lv ? el("em", { class: "rz-lv " + LV[lv][1], text: LV[lv][0] }) : null]), el("b", null, [v, ref ? el("i", { text: " · " + ref }) : null])]); };
    var sub = function (t) { return el("p", { class: "rz-p-lab", text: t }); };
    var col = function (h, kids) { return el("div", { class: "rz-p-col" }, [el("h3", { text: h })].concat(kids.filter(Boolean))); };
    var it = {}; if (nat) nat.items.forEach(function (x) { it[x[0]] = x; });
    var natRow = function (k, label) { var x = it[k]; return x ? row(label || k, x[1] + "%", "all adults " + x[2] + "%", "N") : null; };
    var hoodRow = function (k) { var d = PERSONA_RATES.filter(function (x) { return x[0] === k; })[0]; return d && hood[k] != null && (P.rates || []).indexOf(k) >= 0 ? row(d[1], pct(hood[k]), "U.S. " + pct(US[k]), "Z") : null; };
    // Each column: a short narrative (figures from the data, source said in words), then a few key bullets
    var story = function (parts) { parts = parts.filter(Boolean); return parts.length ? el("p", { class: "rz-p-narr", text: parts.join(" ") }) : null; };
    var vs = function (k) { return pct(hood[k]) + " vs. " + pct(US[k]) + " nationally"; };
    var has = function (k) { return hood[k] != null && (P.rates || []).indexOf(k) >= 0; };
    var lower1 = function (t) { return t.replace(/^./, function (y) { return y.toLowerCase(); }); };
    // 1. Personal
    var pN = [];
    if (cfg.hhCount) pN.push("Householders are " + ageSpan() + (ageMix.length > 1 ? ", with the largest share " + ageMix.slice().sort(function (a, b) { return b[1] - a[1]; })[0][0] + " (" + pct(ageMix.slice().sort(function (a, b) { return b[1] - a[1]; })[0][1] / tot) + ")" : "") + ".");
    if (it["Men"]) pN.push("In national surveys of the closest groups, men make up " + it["Men"][1] + "% (all adults " + it["Men"][2] + "%).");
    if (has("ba")) pN.push("They live in well-educated neighborhoods, where " + pct(hood.ba) + " of adults hold a bachelor's degree" + (has("grad") ? " and " + pct(hood.grad) + " a graduate degree" : "") + " (U.S. " + pct(US.ba) + (has("grad") ? " and " + pct(US.grad) : "") + ")" + (has("mgmt") ? ", and " + pct(hood.mgmt) + " of workers hold management jobs (U.S. " + pct(US.mgmt) + ")" : "") + ".");
    var personal = [story(pN)];
    if (cfg.hhCount) personal.push(row("Householder age", ageMix.length > 1 ? ageMix.map(function (x) { return x[0] + " " + pct(x[1] / tot); }).join(", ") : ageMix[0][0], null, "L"));
    personal.push(natRow("Men", "Men"), hoodRow("ba"), hoodRow("mgmt"));
    // 2. Household
    var hN = [];
    if (cfg.hhCount) { var topI = incMix.slice().sort(function (a, b) { return b[1] - a[1]; })[0];
      hN.push("They earn " + incTxt + (incs.length > 1 && topI ? ", and the largest share earns " + topI[0] + " (" + pct(topI[1] / tot) + ")" : "") + "."); }
    if (own != null) hN.push("Among householders this age here, " + pct(own) + " own their home.");
    var wealth = ["val500", "hi200", "cg"].filter(has).map(function (k) { return { val500: "$500K+ homes", hi200: "$200K+ tax returns", cg: "capital gains" }[k] + " (" + vs(k) + ")"; });
    if (wealth.length) hN.push("Their ZIPs stand out for " + list(wealth) + ".");
    var fam = []; if (has("married")) fam.push(pct(hood.married) + " are married couples"); if (has("kids")) fam.push(pct(hood.kids) + " have children at home");
    if (fam.length) hN.push("Of the households around them, " + list(fam) + (has("sfd") ? ", and " + pct(hood.sfd) + " of homes are single-family detached" : "") + ".");
    var household = [story(hN)];
    if (cfg.hhCount) {
      var bar = el("div", { class: "rz-p-bar" }, incMix.filter(function (x) { return x[1] > 0; }).map(function (x, i) {
        return el("div", { style: "flex:" + x[1] + ";opacity:" + (0.45 + 0.55 * (i + 1) / incMix.length), title: x[0] + ": " + pct(x[1] / tot) }, [x[1] / tot >= 0.12 ? pct(x[1] / tot) : ""]); }));
      household.push(el("p", { class: "rz-p-lab" }, ["Household income", el("em", { class: "rz-lv rz-lv-l", text: "Local" })]), bar,
        el("p", { class: "rz-p-legend", text: incMix.filter(function (x) { return x[1] > 0; }).map(function (x) { return x[0] + " " + pct(x[1] / tot); }).join(" · ") }));
    }
    if (own != null) household.push(row("Own their home", pct(own), "householders this age", "L"));
    household.push(hoodRow("val500"), hoodRow("married"));
    if (P.capital) household.push(row(P.capital[0], P.capital[1]));
    // 3. Media and lifestyle
    var oN = [];
    if (media.length >= 3) oN.push("They act on ads more often than the average adult, led by " + short(media[0][0]) + " (" + media[0][1] + "% vs. " + media[0][2] + "%), then " + list(media.slice(1, 3).map(function (m) { return short(m[0]); })) + ".");
    if (it["Live in a city"] && it["Live in a suburb"]) oN.push("Nationally, the closest groups lean " + (it["Live in a city"][1] > it["Live in a suburb"][1] ? "urban: " + it["Live in a city"][1] + "% live in a city and " + it["Live in a suburb"][1] + "% in a suburb." : "suburban: " + it["Live in a suburb"][1] + "% live in a suburb and " + it["Live in a city"][1] + "% in a city."));
    if (nat && nat.mindset && nat.mindset.items.length) { var g = nat.mindset.items[0];
      oN.push("Small business owners nationally are " + NF0.format((g[1] / g[2] - 1) * 100) + "% more likely than all adults to " + lower1(g[0]).replace(/^want to /, "want to ") + " (" + g[1] + "% vs. " + g[2] + "%).");
    }
    var other = [story(oN)];
    if (media.length) { other.push(sub("Acted on an ad in the past 30 days"));
      media.forEach(function (m) { other.push(row(short(m[0]).replace(/^./, function (x) { return x.toUpperCase(); }), m[1] + "%", "all adults " + m[2] + "%", "N")); }); }
    if (nat && nat.mindset && nat.mindset.items.length > 1) other.push(sub(nat.mindset.title));
    if (nat && nat.mindset) nat.mindset.items.slice(1).forEach(function (x) { other.push(row(x[0], x[1] + "%", "all adults " + x[2] + "%", "N")); });
    box.appendChild(el("div", { class: "rz-p-cols" }, [col("Personal", personal), col("Household", household), col("Media and lifestyle", other)]));
    box.appendChild(el("p", { class: "rz-p-note", text: "Composite portrait for planning. Local: Census counts of the selected households in this area. ZIP-wide: the neighborhoods where they live, each ZIP weighted by how many of these households it holds (higher-income households usually exceed their neighborhood on education and income). National: AudienceSCAN survey results for the closest groups" + (nat && nat.weights ? " (" + nat.weights + ")" : "") + "; the same in every market. Census doesn't publish a householder's gender or net worth with age and income by ZIP. It describes a group of households, not an individual." + (P.source ? " " + P.source : "") }));
  };
  // Context columns for the current preset (or the tool's default list when no preset is chosen)
  Radius.prototype.contextKeys = function () {
    var p = this.state.profile && this.profiles[this.state.profile];
    var keys = (p && p.context) || (!p && Array.isArray(this.cfg.contextCols) && this.cfg.contextCols) || [];   // cfg.context is the proposal callback, not a column list
    return keys.filter(function (k) { return CONTEXT[k]; });
  };
  Radius.prototype.addContext = function (rows) {
    var c = this.c, keys = this.contextKeys();
    rows.forEach(function (r) { keys.forEach(function (k) { r["x_" + k] = CONTEXT[k].value(c, r.i); }); });
    return keys;
  };
  /* ---------- Blended score (sites with cfg.blendScore) ----------
     0-100 within this trade area: 40% concentration (index), 30% size (estimated audience), 30% the profile's ZIP-wide
     rates (e.g. $200K+ income, capital gains, bachelor's+, managers). Each part is a percentile among the area's ZIPs
     (or counties). With no ZIP-wide rates for the profile, index and audience split 4:3. Under 1,000 residents: not scored. */
  var SCORE_W = { idx: 0.4, aud: 0.3, ctx: 0.3 };
  function percentiler(vals) {
    var v = vals.filter(function (x) { return typeof x === "number" && isFinite(x); }).sort(function (a, b) { return a - b; }), n = v.length;
    return function (x) {
      if (typeof x !== "number" || !isFinite(x) || !n) return null;
      if (n === 1) return 100;
      var lo = 0, hi = n; while (lo < hi) { var m = (lo + hi) >> 1; if (v[m] < x) lo = m + 1; else hi = m; }
      var eq = 0; while (lo + eq < n && v[lo + eq] === x) eq++;
      return (lo + (eq - 1) / 2) / (n - 1) * 100;   // ties share the middle rank
    };
  }
  // A profile can group its signals (scoreGroups: [[keys], ...]) so overlapping ones (e.g. $200K+ income and capital gains)
  // share one vote: the signals part is then the average of the groups, each group the average of its signals.
  // Signals shown as columns but not in any group are display only.
  Radius.prototype.scoreGroups = function (ctx) {
    var p = this.state.profile && this.profiles[this.state.profile];
    if (p && p.scoreGroups) return p.scoreGroups.map(function (g) { return g.filter(function (k) { return ctx.indexOf(k) >= 0; }); }).filter(function (g) { return g.length; });
    return ctx.map(function (k) { return [k]; });
  };
  Radius.prototype.addScore = function (rows, ctx) {
    if (!this.cfg.blendScore) return;
    var groups = this.scoreGroups(ctx);
    var ok = rows.filter(function (r) { return r.idx != null && r.aud != null && (r.pop || 0) >= SMALL_ZIP; });
    var P = { idx: percentiler(ok.map(function (r) { return r.idx; })), aud: percentiler(ok.map(function (r) { return r.aud; })) };
    ctx.forEach(function (k) { P["x_" + k] = percentiler(ok.map(function (r) { return r["x_" + k]; })); });
    rows.forEach(function (r) { r.score = null; });
    ok.forEach(function (r) {
      var parts = [[P.idx(r.idx), SCORE_W.idx], [P.aud(r.aud), SCORE_W.aud]];
      var avg = function (a) { a = a.filter(function (x) { return x != null; }); return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };
      var cv = avg(groups.map(function (g) { return avg(g.map(function (k) { return P["x_" + k](r["x_" + k]); })); }));
      if (cv != null) parts.push([cv, SCORE_W.ctx]);
      var w = 0, t = 0; parts.forEach(function (p) { if (p[0] != null) { t += p[0] * p[1]; w += p[1]; } });
      r.score = w ? t / w : null;
    });
  };
  Radius.prototype.scoreNote = function (ctx, noun) {
    var groups = this.scoreGroups(ctx), inScore = [].concat.apply([], groups), shown = ctx.filter(function (k) { return inScore.indexOf(k) < 0; });
    var lab = function (k) { return CONTEXT[k].label; };
    var sig = groups.length ? ", 30% " + (groups.some(function (g) { return g.length > 1; }) ? (groups.length === 2 ? "two" : NF0.format(groups.length)) + " equal groups of area-wide signals (" + groups.map(function (g) { return listAnd(g.map(lab)); }).join("; ") + ")" : listAnd(inScore.map(lab))) : "";
    return " Score (0\u2013100) ranks " + noun + " within this area: 40% index, 30% " + (this.isEstimate() ? "estimated " : "") + "audience" + sig +
      ", each compared with the area's other " + noun + (groups.length ? "" : " (index and audience only for this audience)") + "." +
      (shown.length ? " " + listAnd(shown.map(lab)) + (shown.length > 1 ? " are" : " is") + " shown for context only." : "") + " Under " + NF0.format(SMALL_ZIP) + " residents: not scored.";
  };

  /* ---------- Counties: the trade area's ZIPs added up by county ---------- */
  Radius.prototype.setUnit = function (u) {
    var s = this.state; if (s.unit === u) return;
    s.unit = u; s.sortKey = this.cfg.blendScore ? "score" : "aud"; s.sortDir = "desc";
    Array.prototype.forEach.call(this.unitSeg.children, function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-unit") === u)); });
    if (!this.rows) return;
    this.renderTable(); this.renderMap(false);
  };
  // One row per county: the sums of its ZIPs inside the area (a county partly outside counts only the part inside).
  // ZIP-wide context rates are averaged weighted by population.
  Radius.prototype.countyRows = function () {
    var self = this, c = this.c, by = {}, keys = this.contextKeys();
    this.visible().forEach(function (r) {
      var f = self.zipCounty && self.zipCounty[r.zip]; if (!f) return;
      var x = by[f] || (by[f] = { fips: f, town: self.countyLabel(f), zips: 0, pop: 0, base: 0, aud: 0, any: false, w: {}, p: {} });
      x.zips++; x.pop += r.pop || 0; if (r.aud != null) x.base += r.base || 0; if (r.aud != null) { x.aud += r.aud; x.any = true; }
      keys.forEach(function (k) { var v = CONTEXT[k].value(c, r.i); if (v != null && r.pop) { x.w[k] = (x.w[k] || 0) + v * r.pop; x.p[k] = (x.p[k] || 0) + r.pop; } });
    });
    return Object.keys(by).map(function (f) {
      var x = by[f]; if (!x.any) x.aud = null;
      x.share = x.aud != null && x.base ? x.aud / x.base : null;
      x.idx = x.share != null && self.natRate ? x.share / self.natRate * 100 : null;
      keys.forEach(function (k) { x["x_" + k] = x.p[k] ? x.w[k] / x.p[k] : null; });
      return x;
    });
  };
  Radius.prototype.renderCountyTable = function () {
    var self = this, s = this.state, est = this.isEstimate(), area = s.mode === "area";
    if (!this.zipCounty) { this.tableTitle.textContent = "Counties"; this.tableNote.textContent = "Loading counties…"; this.thead.innerHTML = ""; this.tbody.innerHTML = "";
      this.loadCounties().then(function () { if (self.state.unit === "county" && self.rows) { self.renderTable(); self.renderMap(false); } }); return; }
    var rows = this.countyRows(), ctx = this.contextKeys(), sc = !!this.cfg.blendScore;
    this.addScore(rows, ctx);
    if (["town", "zips", "pop", "aud", "share", "idx"].concat(sc ? ["score"] : []).indexOf(s.sortKey) < 0 && !/^x_/.test(s.sortKey)) { s.sortKey = sc ? "score" : "aud"; s.sortDir = "desc"; }
    var cols = [["town", "County", "l"]].concat(sc ? [["score", "Score", "n"]] : []).concat([["zips", "ZIPs", "n"], ["pop", "Population", "n"]]).concat([ ["aud", est ? "Est. audience" : "Audience", "n"], ["share", this.cfg.shareShort || "Share", "n"], ["idx", "Index", "n"]])
      .concat(ctx.map(function (k) { return ["x_" + k, CONTEXT[k].label, "n", CONTEXT[k].long + "; ZIPs averaged by population"]; }));
    this.sortRows(rows);
    var k = s.sortKey;
    this.tableTitle.textContent = area ? "Counties in the custom area" : "Counties within " + s.r + " miles";
    this.tableNote.textContent = NF0.format(rows.length) + (rows.length === 1 ? " county" : " counties") + ". Each county adds up the area's ZIPs in that county, so a county partly outside the area counts only the part inside. Click a column to sort." + (sc ? this.scoreNote(ctx, "counties") : "");
    this.thead.innerHTML = "";
    var hr = el("tr");
    cols.forEach(function (cdef) {
      var active = k === cdef[0];
      hr.appendChild(el("th", { scope: "col", class: cdef[2] === "l" ? "rz-l" : cdef[3] ? "rz-ctx" : null, title: cdef[3] || null, "aria-sort": active ? (s.sortDir === "asc" ? "ascending" : "descending") : null }, [
        el("button", { type: "button", text: cdef[1], onclick: function () {
          if (s.sortKey === cdef[0]) s.sortDir = s.sortDir === "asc" ? "desc" : "asc";
          else { s.sortKey = cdef[0]; s.sortDir = cdef[2] === "l" ? "asc" : "desc"; }
          self.renderTable();
        } })]));
    });
    this.thead.appendChild(hr);
    this.tbody.innerHTML = "";
    var frag = document.createDocumentFragment();
    rows.forEach(function (r, n) {
      frag.appendChild(el("tr", { tabindex: "0", onclick: function () { self.flashCounty(r.fips); }, onkeydown: function (e) { if (e.key === "Enter") self.flashCounty(r.fips); } }, [
        el("td", { class: "rz-l", style: "font-weight:600", text: r.town }), sc ? el("td", { class: "num", style: "font-weight:600", text: r.score == null ? "\u2014" : NF0.format(r.score) }) : null,
        el("td", { class: "num", style: "font-weight:400", text: NF0.format(r.zips) }),
        el("td", { class: "num", text: NF0.format(r.pop) }),
        el("td", { class: "num", text: r.aud == null ? "No data" : NF0.format(Math.round(r.aud)) }),
        el("td", { class: "num", text: r.share == null ? "—" : NF1.format(r.share * 100) + "%" }),
        el("td", { class: "num", text: r.idx == null ? "—" : NF0.format(r.idx) })].concat(ctx.map(function (k) {
          var v = r["x_" + k]; return el("td", { class: "num rz-ctx", text: v == null ? "—" : NF1.format(v * 100) + "%" }); }))));
    });
    if (!rows.length) frag.appendChild(el("tr", null, [el("td", { colspan: String(cols.length), class: "az-empty", text: "No ZIPs meet the index cutoff." })]));
    this.tbody.appendChild(frag);
    this.renderBudget();
  };
  Radius.prototype.flashCounty = function (f) {
    var l = this.layerByCounty && this.layerByCounty[f];
    if (!l) return;
    this.map.fitBounds(l.getBounds(), { maxZoom: 10, padding: [60, 60] });
    l.setStyle({ color: "#0f2742", weight: 3 }); l.bringToFront(); l.openTooltip();
    setTimeout(function () { l.setStyle({ color: "#ffffff", weight: 1 }); }, 2500);
  };
  Radius.prototype.loadCountyGeo = function () {
    var self = this;
    if (this.countyGeoP) return this.countyGeoP;
    var url = this.cfg.countyGeo || this.cfg.zipGeo.replace(/zip\/\{level\}\/\{id\}\.json$/, "county.topo.json");
    return (this.countyGeoP = fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (t) {
      self.countyFC = t ? topojson.feature(t, t.objects[Object.keys(t.objects)[0]]) : null;
    }).catch(function () { self.countyFC = null; }));
  };

  Radius.prototype.renderTable = function () {
    var self = this, s = this.state, rows = this.visible().slice(), est = this.isEstimate();
    if (s.unit === "county") return this.renderCountyTable();
    var area = s.mode === "area", circ = area && s.area && s.area.circles.length;
    var ctx = this.addContext(rows), sc = !!this.cfg.blendScore;
    this.addScore(rows, ctx);
    if (/^x_/.test(s.sortKey) && ctx.indexOf(s.sortKey.slice(2)) < 0) { s.sortKey = sc ? "score" : "idx"; s.sortDir = "desc"; }
    if (s.sortKey === "score" && !sc) s.sortKey = "idx";
    var cols = [["zip", "ZIP", "l"], ["town", "Town", "l"]].concat(area ? [["county", "County", "l"]] : []).concat(sc ? [["score", "Score", "n"]] : []).concat(!area || circ ? [["dist", area ? "Miles to location" : "Miles", "n"]] : [])
      .concat([["pop", "Population", "n"], ["aud", est ? "Est. audience" : "Audience", "n"], ["share", this.cfg.shareShort || "Share", "n"], ["idx", "Index", "n"]])
      .concat(ctx.map(function (k) { return ["x_" + k, CONTEXT[k].label, "n", CONTEXT[k].long]; }));
    this.sortRows(rows);
    var k = s.sortKey, nSmall = (k === "idx" || k === "score" || /^x_/.test(k)) ? rows.filter(function (r) { return (r.pop || 0) < SMALL_ZIP; }).length : 0;
    this.tableTitle.textContent = area ? "ZIPs in the custom area" : "ZIPs within " + s.r + " miles";
    this.tableNote.textContent = (rows.length > s.show ? "Showing " + s.show + " of " + NF0.format(rows.length) + " ZIPs. Export includes all." : NF0.format(rows.length) + " ZIPs.") + (nSmall ? " ZIPs under " + NF0.format(SMALL_ZIP) + " residents are listed last." : "") + " Click a column to sort." +
      (ctx.length ? " " + listAnd(ctx.map(function (k) { return CONTEXT[k].label; })) + (ctx.length > 1 ? " are ZIP-wide rates" : " is a ZIP-wide rate") + (sc ? ", not applied to the audience count (see Score below)" : ", shown for context and not applied to the audience") + "; point to a heading for its source." : "") +
      (sc ? this.scoreNote(ctx, "ZIPs") : "");
    this.thead.innerHTML = "";
    var hr = el("tr");
    cols.forEach(function (cdef) {
      var active = k === cdef[0];
      hr.appendChild(el("th", { scope: "col", class: cdef[2] === "l" ? "rz-l" : cdef[3] ? "rz-ctx" : null, title: cdef[3] || null, "aria-sort": active ? (s.sortDir === "asc" ? "ascending" : "descending") : null }, [
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
        sc ? el("td", { class: "num", style: "font-weight:600", text: r.score == null ? "\u2014" : NF0.format(r.score) }) : null,
        !area || circ ? el("td", { class: "num", text: r.dist == null ? "—" : NF1.format(r.dist) }) : null,
        el("td", { class: "num", text: r.pop == null ? "—" : NF0.format(r.pop) }),
        el("td", { class: "num", text: r.aud == null ? "No data" : NF0.format(Math.round(r.aud)) }),
        el("td", { class: "num", text: r.share == null ? "—" : NF1.format(r.share * 100) + "%" }),
        el("td", { class: "num", text: r.idx == null ? "—" : NF0.format(r.idx) })].concat(ctx.map(function (k) {
          var v = r["x_" + k]; return el("td", { class: "num rz-ctx", text: v == null ? "—" : NF1.format(v * 100) + "%" }); }))));
    });
    if (!rows.length) frag.appendChild(el("tr", null, [el("td", { colspan: String(cols.length), class: "az-empty", text: area ? "No ZIPs meet the index cutoff. Lower the Show setting or add to the area." : "No ZIPs meet the index cutoff. Lower the Show setting or widen the radius." })]));
    this.tbody.appendChild(frag);
    if (rows.length > s.show) this.tbody.appendChild(el("tr", null, [el("td", { colspan: String(cols.length) }, [el("button", { type: "button", class: "az-btn", text: "Show all " + NF0.format(rows.length), onclick: function () { s.show = 1e9; self.renderTable(); } })])]));
    this.renderBudget();
  };

  /* ---------- Recommended allocation (closed until opened) ----------
     Budget -> Adtaxi channel plan (shared/media-plan.js, same rules as the Media Mix Planner)
     -> each channel spread across the top ZIPs by audience. Fees follow the FEES settings there. */
  function loadPlan(src, done) {
    if (window.AdtaxiPlan) { done(); return; }
    if (loadPlan.waiting) { loadPlan.waiting.push(done); return; }
    loadPlan.waiting = [done];
    var sc = document.createElement("script"); sc.src = src || "../shared/media-plan.js?v=20261026l";
    sc.onload = function () { var w = loadPlan.waiting; loadPlan.waiting = null; w.forEach(function (f) { f(); }); };
    sc.onerror = function () { loadPlan.waiting = null; };
    document.head.appendChild(sc);
  }
  // Whole dollars of one amount spread by the ZIP shares, adding up exactly (largest remainders get the leftover dollars)
  function spread(total, pick) {
    var whole = Math.round(total), used = 0, out = pick.map(function (x) { var raw = whole * x.share, v = Math.floor(raw); used += v; return { v: v, f: raw - v }; });
    out.map(function (o, i) { return i; }).sort(function (i, j) { return out[j].f - out[i].f; }).slice(0, whole - used).forEach(function (i) { out[i].v += 1; });
    return out.map(function (o) { return o.v; });
  }
  Radius.prototype.buildBudget = function () {
    var sc = !!this.cfg.blendScore;
    var self = this, b = this.budget = { amount: null, by: sc && this.cfg.spreadBy === "score" ? "score" : "aud", n: 10, strat: "", fees: false };
    this.bAmount = el("input", { type: "text", inputmode: "decimal", placeholder: "$ per month", "aria-label": "Monthly budget",
      oninput: function () { b.amount = parseMoney(this.value); self.renderBudget(); },
      onchange: function () { if (b.amount) this.value = money(b.amount); } });
    this.bStrat = el("select", { "aria-label": "Media strategy", onchange: function () { b.strat = this.value; self.renderBudget(); } },
      [el("option", { value: "", text: "Choose a strategy" })]);
    var bySel = el("select", { "aria-label": "Spread by", onchange: function () { b.by = this.value; self.renderBudget(); } },
      (sc ? [["score", "Score (same ranking as the ZIP table)"]] : []).concat([["aud", "Audience size"], ["weighted", "Audience size, favoring above-average ZIPs"]]).map(function (o) { return el("option", { value: o[0], text: o[1] }); }));
    bySel.value = b.by;
    var nSel = el("select", { "aria-label": "ZIPs to include", onchange: function () { b.n = +this.value; self.renderBudget(); } },
      [[5, "Top 5 ZIPs"], [10, "Top 10 ZIPs"], [15, "Top 15 ZIPs"], [25, "Top 25 ZIPs"], [0, "All ZIPs shown"]].map(function (o) { return el("option", { value: o[0], text: o[1] }); }));
    nSel.value = "10";
    this.bLink = el("a", { class: "rz-mm", href: this.cfg.mediaMixUrl || "../media-mix/", text: "Open in the Media Mix Planner \u2192" });
    this.bSummary = el("p", { class: "rz-alloc-sum" });
    this.bWarn = el("p", { class: "rz-alloc-warn", hidden: true });
    this.cHead = el("thead"); this.cBody = el("tbody");
    this.cWrap = el("div", { class: "rz-alloc-block", hidden: true }, [el("h3", { text: "By channel" }),
      el("div", { class: "az-tablewrap rz-alloc-chwrap" }, [el("table", { class: "az-table rz-alloc-ch" }, [this.cHead, this.cBody])]), this.cNote = el("p", { class: "rz-note" })]);
    this.bHead = el("thead"); this.bBody = el("tbody"); this.bNote = el("p", { class: "rz-note" });
    this.bFee = el("p", { class: "rz-note rz-alloc-fee" });
    this.bRates = el("div", { class: "rz-rates" });
    this.pClient = el("input", { type: "text", placeholder: "e.g. Bright Smile Dental", "aria-label": "Client or business name" });
    this.pComp = el("textarea", { rows: "3", placeholder: "One per line (optional)", "aria-label": "Local competitors" });
    this.pStatus = el("span", { class: "rz-pstatus", role: "status" });
    this.pBox = el("div", { class: "rz-proposal", hidden: true }, [
      el("p", { class: "rz-ptitle", text: "Proposal (PowerPoint, 2 slides): your trade area, then a package summary (investment, targeted impressions, reach and frequency, average CPM, clicks and leads) and the recommended platforms with why each one. Investment includes Adtaxi management. The file is editable." }),
      el("div", { class: "rz-pfields" }, [
        el("label", { class: "az-field" }, [el("span", { text: "Client or business name" }), this.pClient]),
        el("label", { class: "az-field rz-pcomp" }, [el("span", { text: "Local competitors" }), this.pComp]),
        el("div", { class: "rz-pact" }, [el("button", { type: "button", class: "az-btn primary", text: "Download PowerPoint", onclick: function () { self.buildProposal().catch(function () {}); } }), this.pStatus])])]);
    loadPlan(this.cfg.planScript, function () {
      if (self.cfg.planExtend && AdtaxiPlan.extend && !AdtaxiPlan.extended) { AdtaxiPlan.extend(self.cfg.planExtend); AdtaxiPlan.extended = true; }   // this page's own channels (e.g. LinkedIn)
      AdtaxiPlan.STRATEGIES.forEach(function (st) { self.bStrat.appendChild(el("option", { value: st.id, text: st.label })); });
      self.bRates.appendChild(AdtaxiPlan.rateEditor(function () { self.renderBudget(); }));
      self.renderBudget();
    });
    return el("details", { class: "az-panel rz-budget", hidden: true }, [
      el("summary", { text: "Recommended allocation" }),
      el("div", { class: "rz-budget-body" }, [
        el("div", { class: "rz-budget-controls" }, [
          el("label", { class: "az-field" }, [el("span", { text: "Monthly budget" }), this.bAmount]),
          el("label", { class: "az-field" }, [el("span", { text: "Media strategy" }), this.bStrat]),
          el("label", { class: "az-field" }, [el("span", { text: "Spread by" }), bySel]),
          el("label", { class: "az-field" }, [el("span", { text: "Include" }), nSel]),
          el("label", { class: "rz-feetoggle" }, [el("input", { type: "checkbox", onchange: function () { b.fees = this.checked; self.renderBudget(); } }), "Add management fees"]),
          el("div", { class: "rz-budget-actions" }, [
            el("button", { type: "button", class: "az-btn primary", text: "Build proposal", onclick: function () { self.pBox.hidden = !self.pBox.hidden; if (!self.pBox.hidden) self.pClient.focus(); } }),
            el("button", { type: "button", class: "az-btn", text: "Export allocation (CSV)", onclick: function () { self.exportBudget(); } }),
            this.bLink])]),
        this.pBox, this.bRates, this.bSummary, this.bWarn, this.cWrap,
        el("div", { class: "rz-alloc-block" }, [el("h3", { text: "By ZIP" }),
          el("div", { class: "az-tablewrap" }, [el("table", { class: "az-table" }, [this.bHead, this.bBody])]), this.bNote]),
        this.bFee])]);
  };
  Radius.prototype.budgetRows = function () {
    if (!this.rows) return [];
    var rows = this.visible();
    // ZIP Scores: the county view shows first, so score the ZIPs here too (same rows and signals as the ZIP table)
    if (this.budget.by === "score" && this.cfg.blendScore) this.addScore(rows, this.addContext(rows));
    return splitBudget(rows, null, this.budget.by, this.budget.n);
  };
  // Everything the allocation shows: ZIP shares, fee math, channel plan and dollars per ZIP per channel
  Radius.prototype.allocation = function () {
    var b = this.budget, P = window.AdtaxiPlan, pick = this.budgetRows();
    var out = { pick: pick, money: null, strat: null, plan: null, channels: [], below: false };
    if (!pick.length) return out;
    out.money = P ? P.applyFees(b.amount) : { entered: b.amount, media: b.amount, fee: 0, total: b.amount, tierBudget: b.amount, feesOn: false };
    out.strat = P && b.strat ? P.STRATEGIES.filter(function (x) { return x.id === b.strat; })[0] : null;
    out.below = !!(P && b.amount && out.money.tierBudget < P.MIN_BUDGET);
    if (out.strat) {
      out.plan = P.buildPlan(out.strat, out.below ? null : out.money.media, out.below ? null : out.money.tierBudget);
      out.channels = out.plan.items;
    }
    var withDollars = b.amount && !out.below;
    if (withDollars) {
      var media = out.money.media;
      if (out.strat && out.plan.tier) {
        out.channels.forEach(function (c) { c.cost = b.fees && P ? P.channelFee(c.id, c.dollars).total : c.dollars; c.byZip = spread(c.cost, pick); });
        pick.forEach(function (x, i) { x.amt = out.channels.reduce(function (t, c) { return t + c.byZip[i]; }, 0); });
      } else {
        var v = spread(media, pick); pick.forEach(function (x, i) { x.amt = v[i]; });
      }
    } else pick.forEach(function (x) { x.amt = null; });
    out.withDollars = !!withDollars;
    return out;
  };
  Radius.prototype.renderBudget = function () {
    if (!this.budgetBox) return;
    var self = this, b = this.budget, A = this.allocation(), pick = A.pick, P = window.AdtaxiPlan;
    this.budgetBox.hidden = !this.rows || !pick.length;
    if (this.budgetBox.hidden) return;
    var est = this.isEstimate(), chans = A.withDollars && A.plan && A.plan.tier && A.channels.length > 1 ? A.channels : [];
    var showFee = A.money && A.money.feesOn && P.FEES.showFee;

    // Planner link carries the same choices
    var q = new URLSearchParams(), pc = this.cfg.planCategory || String(this.cfg.exportName || "").replace(/-radius$/, "").replace(/^apartment$/, "apartments");
    if (pc && !/^(zip|adtaxi|none)$/.test(pc)) q.set("category", pc);
    if (b.strat) q.set("strategy", b.strat); if (b.amount) q.set("budget", Math.round(b.amount));
    this.bLink.href = (this.cfg.mediaMixUrl || "../media-mix/") + (q.toString() ? "?" + q : "");

    // One-line summary (also what the leave-behind shows in place of the controls)
    var bits = [];
    if (b.amount) bits.push(money(b.amount) + " a month" + (A.money.feesOn ? (P.FEES.budgetIs === "net" ? " in media" : " total") : ""));
    if (A.strat) bits.push(A.strat.label);
    bits.push(b.n ? "top " + b.n + " ZIPs" : "all ZIPs shown");
    this.bSummary.textContent = "Recommended allocation: " + bits.join(" \u00b7 ");

    this.bWarn.hidden = !A.below && !(P && P.customRates());
    this.bWarn.textContent = P && P.customRates() ? P.CUSTOM_NOTE + " " : "";
    if (P && P.customRates()) this.bWarn.appendChild(el("button", { type: "button", class: "rz-reset", text: "Reset to rate card", onclick: function () { P.resetRates(); } }));
    if (A.below) this.bWarn.appendChild(document.createTextNode((P && P.customRates() ? " " : "") + "Adtaxi's minimum is " + money(P.MIN_BUDGET) + " a month. Shares are shown without dollars."));

    // By channel
    this.cWrap.hidden = !A.strat;
    if (A.strat) {
      this.cHead.innerHTML = ""; this.cBody.innerHTML = "";
      var fees = b.fees && A.withDollars && P;
      this.cHead.appendChild(el("tr", null, [["Channel", 1], ["Role", 1], ["Share"]].concat(fees ? [["Media"], ["Management fee"], ["Total cost"]] : [["Monthly amount"]]).map(function (h) {
        return el("th", { scope: "col", class: h[1] ? "rz-l" : null, text: h[0] }); })));
      A.channels.forEach(function (c) {
        var cells = [el("td", { class: "rz-l" }, [el("span", { class: "rz-swatch", style: "background:" + c.ch.color }), c.ch.label]),
          el("td", { class: "rz-l", text: c.ch.role.charAt(0).toUpperCase() + c.ch.role.slice(1) }),
          el("td", { class: "num", text: c.pct + "%" }), el("td", { class: "num", text: A.withDollars && c.dollars != null ? money(c.dollars) : "\u2014" })];
        if (fees) {
          var f = P.channelFee(c.id, c.dollars);
          cells.push(f.kind === "fee" ? el("td", { class: "num", text: "+ " + money(f.fee) + " (" + Math.round(f.pct * 1000) / 10 + "%)" })
                                      : el("td", { class: "rz-feena", text: f.kind === "cpm" ? "Included in CPM" : "Not on rate card" }));
          cells.push(el("td", { class: "num rz-alloc-strong", text: money(f.total) }));
        }
        self.cBody.appendChild(el("tr", null, cells));
      });
      if (fees) {
        var fs = P.feeSummary(A.channels);
        self.cBody.appendChild(el("tr", { class: "rz-alloc-total" }, [el("td", { class: "rz-l", text: "Total" }), el("td"), el("td", { class: "num", text: "100%" }),
          el("td", { class: "num", text: money(fs.media) }), el("td", { class: "num", text: "+ " + money(fs.fee) }), el("td", { class: "num", text: money(fs.total) })]));
      }
      if (showFee && A.withDollars) {
        [["Media", A.money.media], ["Management fee", A.money.fee], ["Total", A.money.total]].forEach(function (r, i) {
          self.cBody.appendChild(el("tr", { class: i === 2 ? "rz-alloc-total" : "rz-alloc-sub" }, [el("td", { class: "rz-l", text: r[0] }), el("td"), el("td"), el("td", { class: "num", text: money(r[1]) })]));
        });
      }
      var notes = [];
      if (A.plan.tier) {
        notes.push(A.plan.tier.label + ". Fully funding fewer channels outperforms spreading a budget thin.");
        A.plan.unavailable.forEach(function (r) { var t = P.SERVICE_TIERS.filter(function (t) { return t.available.indexOf(r.id) >= 0; })[0]; notes.push(P.CHANNELS[r.id].label + " is available from " + money(t.min) + " a month."); });
        A.plan.skipped.forEach(function (x) { notes.push(P.CHANNELS[x.r.id].label + " needs at least " + money(x.min) + " a month on its own, so it isn't in this plan."); });
        var tn = P.termNote(A.channels); if (tn) notes.push(tn);
        if (A.plan.raised.length) notes.push(A.plan.raised.map(function (r) { return r.ch.label; }).join(" and ") + (A.plan.raised.length > 1 ? " are" : " is") + " set at the channel minimum.");
        if (A.money.tierBudget >= P.CUSTOM_PLAN_BUDGET) notes.push("At this budget, Adtaxi's strategy team can also build a custom plan with more channels and refined targeting.");
      } else notes.push(b.amount ? "Strategy mix shown for reference." : "Enter a monthly budget to size the plan: the channel count and minimums depend on it.");
      this.cNote.textContent = notes.join(" ");
    }

    // By ZIP
    this.bHead.innerHTML = "";
    var bySc = b.by === "score";
    var heads = [["ZIP", 1], ["Town", 1]].concat(bySc ? [["Score"]] : []).concat([[est ? "Est. audience" : "Audience"], ["Index"], ["Share"]]);
    chans.forEach(function (c) { heads.push([c.ch.short]); });
    heads.push([chans.length ? "Monthly total" : "Monthly amount"]);
    this.bHead.appendChild(el("tr", null, heads.map(function (h) { return el("th", { scope: "col", class: h[1] ? "rz-l" : null, text: h[0] }); })));
    this.bBody.innerHTML = "";
    var frag = document.createDocumentFragment();
    pick.forEach(function (x, i) {
      var tds = [el("td", { class: "rz-l num", text: x.r.zip }), el("td", { class: "rz-l", text: x.r.town })].concat(bySc ? [el("td", { class: "num", style: "font-weight:600", text: NF0.format(x.r.score) })] : []).concat([
        el("td", { class: "num", text: NF0.format(Math.round(x.r.aud)) }), el("td", { class: "num", text: x.r.idx == null ? "\u2014" : NF0.format(x.r.idx) }),
        el("td", { class: "num", text: NF1.format(x.share * 100) + "%" })]);
      chans.forEach(function (c) { tds.push(el("td", { class: "num", text: money(c.byZip[i]) })); });
      tds.push(el("td", { class: "num rz-alloc-strong", text: x.amt != null ? money(x.amt) : "\u2014" }));
      frag.appendChild(el("tr", null, tds));
    });
    if (A.withDollars) {
      var tot = [el("td", { class: "rz-l", text: "Total" }), el("td"), el("td"), el("td")].concat(bySc ? [el("td")] : []).concat([el("td", { class: "num", text: "100%" })]);
      chans.forEach(function (c) { tot.push(el("td", { class: "num", text: money(c.cost != null ? c.cost : c.dollars) })); });
      tot.push(el("td", { class: "num", text: money(pick.reduce(function (t, x) { return t + x.amt; }, 0)) }));
      frag.appendChild(el("tr", { class: "rz-alloc-total" }, tot));
    }
    this.bBody.appendChild(frag);
    this.bNote.textContent = (b.by === "score" ? "ZIPs are picked by Score, the same ranking as the ZIP table, and each one's share follows its estimated audience times its Score, so a larger ZIP with the same Score gets more. ZIPs under " + NF0.format(SMALL_ZIP) + " residents aren't scored and are left out. " : b.by === "weighted" ? "Each ZIP's share follows its estimated audience times its index, so above-average ZIPs get more. " : "Each ZIP's share follows its estimated audience. ") +
      (!b.amount ? "Enter a monthly budget to see dollar amounts. " : "") + (!A.strat ? "Choose a media strategy to split by channel. " : "") +
      (chans.length ? "Channel minimums apply to each channel's monthly total, not to each ZIP. " : "") +
      "A planning recommendation; final targeting is set by platform.";
    this.bFee.hidden = !!showFee;
    if (b.fees && A.withDollars && P && chans.length + (A.channels || []).length) {
      this.bFee.hidden = false;
      var fsN = P.feeSummary(A.channels);
      this.bFee.textContent = "With management fees: media budget " + money(fsN.media) + " + management fees " + money(fsN.fee) + " = total investment " + money(fsN.total) +
        ". Each platform's fee is added to its media allocation; programmatic is priced by CPM with management included, so it doesn't change. ZIP amounts include fees.";
      return;
    }
    this.bFee.textContent = P ? (A.money && A.money.feesOn ? "Figures shown are media dollars." : P.FEES.offNote) : "Amounts are total monthly investment by channel, including Adtaxi management.";
  };
  Radius.prototype.exportBudget = function () {
    var b = this.budget, A = this.allocation(), pick = A.pick;
    if (!pick.length) return;
    var chans = A.withDollars && A.plan && A.plan.tier && A.channels.length > 1 ? A.channels : [];
    var head = ["ZIP", "Town", "Estimated audience", "Index vs US", "Share"];
    chans.forEach(function (c) { head.push(c.ch.label); });
    head.push("Monthly total", "Media strategy", "Spread by", "Audience definition");
    var lines = [head.map(csvCell).join(",")];
    var by = b.by === "score" ? "Score (ZIPs picked by Score; share = audience x Score)" : b.by === "weighted" ? "Audience x index" : "Audience", def = this.describe(), st = A.strat ? A.strat.label : "";
    pick.forEach(function (x, i) {
      var row = [x.r.zip, x.r.town, Math.round(x.r.aud), x.r.idx == null ? "" : Math.round(x.r.idx), (x.share * 100).toFixed(1) + "%"];
      chans.forEach(function (c) { row.push(c.byZip[i]); });
      row.push(x.amt != null ? x.amt : "", st, by, def);
      lines.push(row.map(csvCell).join(","));
    });
    if (A.withDollars) {
      var t = ["Total", "", "", "", "100.0%"]; chans.forEach(function (c) { t.push(c.cost != null ? c.cost : c.dollars); });
      t.push(pick.reduce(function (s, x) { return s + x.amt; }, 0)); lines.push(t.map(csvCell).join(","));
    }
    var P = window.AdtaxiPlan;
    if (b.fees && A.withDollars && P && A.channels.length) {
      lines.push("", ["Channel", "Media", "Management fee", "Total cost", "Note"].map(csvCell).join(","));
      A.channels.forEach(function (c) {
        var f = P.channelFee(c.id, c.dollars);
        lines.push([c.ch.label, c.dollars, f.kind === "fee" ? f.fee : "", f.total, f.kind === "fee" ? Math.round(f.pct * 1000) / 10 + "% of total" : f.kind === "cpm" ? P.MGMT.cpmNote : P.MGMT.unknownNote].map(csvCell).join(","));
      });
      var fsC = P.feeSummary(A.channels);
      lines.push(["Total", fsC.media, fsC.fee, fsC.total, "ZIP amounts above include fees"].map(csvCell).join(","));
    }
    if (A.money && A.money.feesOn && P.FEES.showFee) lines.push("", ["Media", A.money.media].map(csvCell).join(","), ["Management fee", A.money.fee].map(csvCell).join(","), ["Total", A.money.total].map(csvCell).join(","));
    if (P && P.customRates()) lines.push("", csvCell(P.CUSTOM_NOTE));
    if (!(b.fees && A.withDollars)) lines.push("", csvCell(P ? P.FEES.offNote : "Amounts are total monthly investment by channel, including Adtaxi management."));
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = el("a", { href: URL.createObjectURL(blob), download: (this.cfg.exportName || "adtaxi-radius") + "-recommended-allocation.csv" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  };
  /* ---------- Proposal (PowerPoint) ---------- */
  function loadScriptOnce(url) {
    loadScriptOnce.p = loadScriptOnce.p || {};
    if (!loadScriptOnce.p[url]) loadScriptOnce.p[url] = new Promise(function (ok, bad) {
      var sc = document.createElement("script"); sc.src = url; sc.onload = ok; sc.onerror = function () { delete loadScriptOnce.p[url]; bad(new Error("couldn't load " + url)); };
      document.head.appendChild(sc);
    });
    return loadScriptOnce.p[url];
  }
  // AudienceSCAN media types that match each channel, and how the reason phrases them
  var AD_MATCH = {
    search: [/search results/i, "a search ad"], shopping: [/search results/i, "a search ad"],
    social: [/social network/i, "a social media ad"], tiktok: [/social network/i, "a social media ad"], snapchat: [/social network/i, "a social media ad"],
    ctv: [/streaming tv/i, "a streaming TV ad"], youtube: [/before or during the video/i, "a video ad before or during a video"],
    display: [/online display/i, "an online display ad"], retarget: [/online display/i, "an online display ad"],
    audio: [/radio/i, "a radio or streaming audio ad"], dooh: [/outdoor|billboard/i, "an outdoor or billboard ad"],
    linkedin: [/social network/i, "a social media ad"] };
  Radius.prototype.proposalBase = function () { return (this.cfg.planScript || "../shared/media-plan.js").replace(/media-plan\.js.*$/, ""); };
  Radius.prototype.benchmarks = function () {
    var self = this;
    if (!this._bench) this._bench = fetch(this.cfg.benchmarksData || this.proposalBase() + "benchmarks.json?v=20261026l").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return this._bench.then(function (B) {
      if (!B) return null;
      var cat = self.cfg.planCategory && self.cfg.planCategory !== "none" ? self.cfg.planCategory : String(self.cfg.exportName || "").replace(/-radius$/, "").replace(/^apartment$/, "apartments");
      var m = B.map && B.map[cat], ctx = self.cfg.context ? self.cfg.context() : {};
      var key = m ? (m[self.state.profile] || m[ctx.sub] || m._default) : null;
      return B.industries[key ? key[0] : "all"] || B.industries.all || null;
    });
  };
  Radius.prototype.mapImage = function () {
    var feats = this.mapFeats || [], byZip = this.mapByZip || {}, vis = this.mapVis || {}, s = this.state, c = this.c, self = this;
    if (!feats.length) return null;
    var W = 1080, H = 810, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var g = cv.getContext("2d"); g.fillStyle = "#f4f7fa"; g.fillRect(0, 0, W, H);
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, lat0, ring = null;
    function each(geom, fn) { var polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : []; polys.forEach(function (p) { fn(p); }); }
    if (s.mode !== "area") {
      var ci = this.byZip[s.zip]; lat0 = c.lat[ci];
      ring = { lat: c.lat[ci], lon: c.lon[ci], r: s.r };
      var dLat = s.r / 69, dLon = s.r / (69 * Math.cos(lat0 * Math.PI / 180));
      minX = ring.lon - dLon; maxX = ring.lon + dLon; minY = ring.lat - dLat; maxY = ring.lat + dLat;
    } else {
      feats.forEach(function (f) { if (!vis[f.properties.zip]) return; each(f.geometry, function (p) { p[0].forEach(function (pt) { if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0]; if (pt[1] < minY) minY = pt[1]; if (pt[1] > maxY) maxY = pt[1]; }); }); });
      if (minX > maxX) return null;
      lat0 = (minY + maxY) / 2;
    }
    var k = Math.cos(lat0 * Math.PI / 180), pad = 0.08;
    var spanX = (maxX - minX) * k, spanY = maxY - minY;
    var scale = Math.min(W * (1 - 2 * pad) / spanX, H * (1 - 2 * pad) / spanY);
    var ox = (W - spanX * scale) / 2, oy = (H - spanY * scale) / 2;
    var P = function (lon, lat) { return [ox + (lon - minX) * k * scale, oy + (maxY - lat) * scale]; };
    feats.forEach(function (f) {
      var r = byZip[f.properties.zip];
      g.globalAlpha = vis[f.properties.zip] ? 0.92 : 0.3;
      g.fillStyle = self.colorFor(r && r.idx); g.strokeStyle = "#ffffff"; g.lineWidth = 1;
      each(f.geometry, function (poly) {
        g.beginPath();
        poly.forEach(function (lin) { lin.forEach(function (pt, i) { var q = P(pt[0], pt[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.closePath(); });
        g.fill("evenodd"); g.stroke();
      });
    });
    g.globalAlpha = 1;
    if (ring) {
      var cp = P(ring.lon, ring.lat), rad = ring.r / 69 * scale;
      g.setLineDash([12, 9]); g.strokeStyle = "#0f2742"; g.lineWidth = 3; g.beginPath(); g.arc(cp[0], cp[1], rad, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.fillStyle = "#0f2742"; g.strokeStyle = "#fff"; g.lineWidth = 3; g.beginPath(); g.arc(cp[0], cp[1], 9, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // Legend
    var lx = 22, ly = H - 22 - 26 * CLASSES.length;
    g.globalAlpha = 0.92; g.fillStyle = "#fff"; g.fillRect(lx - 10, ly - 32, 190, 26 * CLASSES.length + 44); g.globalAlpha = 1;
    g.fillStyle = "#0f2742"; g.font = "bold 19px Arial"; g.fillText("Index vs. U.S.", lx, ly - 8);
    for (var j = CLASSES.length - 1, row = 0; j >= 0; j--, row++) {
      g.fillStyle = cssVar(CLASSES[j][2]) || "#999"; g.fillRect(lx, ly + row * 26 + 4, 22, 18);
      g.fillStyle = "#222"; g.font = "17px Arial"; g.fillText(CLASSES[j][3], lx + 32, ly + row * 26 + 19);
    }
    return cv.toDataURL("image/png");
  };
  Radius.prototype.logoImage = function () {
    var src = this.cfg.logo || this.proposalBase() + "adtaxi-logo.svg";
    return new Promise(function (ok) {
      var im = new Image();
      im.onload = function () { try { var cv = document.createElement("canvas"); cv.width = cv.height = 300; cv.getContext("2d").drawImage(im, 0, 0, 300, 300); ok(cv.toDataURL("image/png")); } catch (e) { ok(null); } };
      im.onerror = function () { ok(null); };
      im.src = src;
    });
  };
  Radius.prototype.proposalContext = function (bench, logo) {
    var s = this.state, c = this.c, A = this.allocation(), P = window.AdtaxiPlan;
    var ctx0 = this.cfg.context ? this.cfg.context() : {}, ad = ctx0.ad, prof = s.profile && this.profiles[s.profile];
    var adSub = ad && ad.subs ? (ad.subs[s.profile] || ad.subs[ctx0.sub]) : null;
    // Trade-area counts describe the audience chosen in the tool; ad-response reasons describe AudienceSCAN's target group
    var hasSel = Object.keys(s.sel || {}).some(function (k) { return s.sel[k]; });
    var PC = this.cfg.proposal || {};   // page-specific proposal wording (franchise pages): goals by strategy, platform roles, a footnote line
    var audienceNoun = prof && PC.nouns && PC.nouns[s.profile] ? PC.nouns[s.profile] : prof ? (/candidates|buyers|prospects|owners/i.test(prof.label) ? prof.label.toLowerCase() : "likely " + prof.label.toLowerCase() + " customers") : hasSel ? "people in the selected audience" : "residents";
    var adNoun = adSub && (adSub.noun || adSub.audience) ? adSub.noun || adSub.audience : audienceNoun;   // noun: how a blended audience reads in a sentence
    var rows = this.visible(), aud = 0, pop = 0;
    var basis = 0;
    rows.forEach(function (r) { if (r.aud != null) { aud += r.aud; pop += r.pop || 0; basis += r.base || 0; } });
    var idx = basis && this.natRate ? aud / basis / this.natRate * 100 : null;
    // Top ZIPs: in a large area (a metro, several DMAs, a state) the highest index tends to be a small ZIP, so rank the
    // above-average ZIPs (index 110+) by prospects instead; in a small area, rank by index
    var big = rows.length > 150;
    var top = rows.filter(function (r) { return r.idx != null && (r.pop || 0) >= SMALL_ZIP && (!big || r.idx >= 110); })
      .sort(big ? function (a, z) { return (z.aud - a.aud) || (z.idx - a.idx); } : function (a, z) { return (z.idx - a.idx) || (z.aud - a.aud); }).slice(0, 5)
      .map(function (r) { return { zip: r.zip, town: r.town, aud: Math.round(r.aud), idx: r.idx, pop: r.pop }; });
    var oneTown = top.length > 1 && top.every(function (z) { return z.town === top[0].town; });
    // Concentration: the ZIPs in the allocation (top N by audience) vs. the whole trade area
    var pAud = 0, pPop = 0; A.pick.forEach(function (x) { pAud += x.r.aud || 0; pPop += x.r.base || 0; });
    var pIdx = pPop && this.natRate ? pAud / pPop / this.natRate * 100 : null, pShare = aud ? pAud / aud : null;
    var conc = A.pick.length < rows.length && pShare != null
      ? "Geo-targeted to the " + (this.budget.by === "score" ? "top " + A.pick.length + " ZIPs by Score, which hold " : A.pick.length + " ZIPs that hold ") + Math.round(pShare * 100) + "% of the trade area's " + audienceNoun + (pIdx ? " (index " + Math.round(pIdx) + ")" : "") + "."
      : "Geo-targeted to the trade area's " + rows.length + " ZIPs" + (idx ? " (index " + Math.round(idx) + ")" : "") + ".";
    var adRows = adSub && adSub.rows ? adSub.rows.slice().sort(function (a, z) { return z[1] - a[1]; }) : [];
    var usedConc = false;
    var plan = A.channels.map(function (ch) {
      var reasons = [], m = AD_MATCH[ch.id], amount = ch.cost != null ? ch.cost : ch.dollars;
      if (m && adRows.length) {
        var k = -1; adRows.forEach(function (r, i) { if (k < 0 && m[0].test(r[0])) k = i; });
        if (k >= 0) {
          var r = adRows[k], lift = r[2] ? Math.round((r[1] / r[2] - 1) * 100) : null;
          reasons.push(r[1].toFixed(1).replace(/\.0$/, "") + "% of " + adNoun + " acted on " + m[1] + " in the past 30 days" + (lift != null ? ", " + (lift >= 0 ? "+" : "") + lift + "% vs. all adults" : "") + " (" + (k === 0 ? "#1" : "#" + (k + 1)) + " of " + adRows.length + " media).");
        }
      }
      // The geo-targeting line goes on the first awareness/consideration platform; the others say what the platform does
      var intent = ch.id === "search" || ch.id === "shopping" || ch.id === "retarget";
      var job = (PC.jobs && PC.jobs[ch.id]) || ch.ch.job;
      reasons.push(intent || usedConc ? job : conc); if (!intent) usedConc = true;
      if (reasons.length < 2) reasons.push(job);
      return { id: ch.id, label: ch.id === "social" ? "Meta (Facebook & Instagram)" : ch.ch.label, role: ch.ch.role.charAt(0).toUpperCase() + ch.ch.role.slice(1),
               amount: amount, reasons: reasons, est: P.estimate(ch.id, amount, bench) };
    });
    var total = plan.reduce(function (t, p) { return t + p.amount; }, 0);
    // Whole-number shares that add to 100 (largest remainder)
    plan.forEach(function (p) { var x = total ? p.amount / total * 100 : 0; p.pct = Math.floor(x); p.rem = x - p.pct; });
    var short = total ? 100 - plan.reduce(function (t, p) { return t + p.pct; }, 0) : 0;
    plan.slice().sort(function (a, z) { return z.rem - a.rem; }).slice(0, short).forEach(function (p) { p.pct++; });
    var ci = this.byZip[s.zip];
    var place = s.mode === "area" ? "Custom area: " + this.areaPhrase() : "Within " + s.r + " miles of " + s.zip + " " + c.city[ci] + ", " + c.state[ci];
    var placeShort = s.mode === "area" ? "" : c.city[ci] + ", " + c.state[ci];
    var term = P.termNote(A.channels);
    var has = function (ids) { return A.channels.some(function (c) { return ids.indexOf(c.id) >= 0; }); };
    var foot = "Investment includes Adtaxi management." + (term ? " " + term : "") +
      " Targeted impressions are planning estimates, not guarantees: programmatic at Adtaxi suggested retail CPMs" +
      (has(["display", "retarget"]) ? ", with display clicks at a " + +(P.EST.ctr * 100).toFixed(2) + "% click-through rate (open-exchange benchmark)" : "") +
      (has(["ctv"]) ? " and CTV completed views at a " + Math.round(P.EST.vcr * 1000) / 10 + "% completion rate (Innovid)" : "") +
      "; Google Search and Meta from WordStream 2026 benchmarks (" + (bench && bench.label ? bench.label : "all industries") + ", U.S. medians)" +
      (has(["youtube", "tiktok", "snapchat"]) ? "; YouTube, TikTok and Snapchat at 2026 cross-platform benchmark CPMs (Hubfluence)" : "") +
      ", on the media portion of each investment. Reach and frequency are modeled: about 70% of targeted impressions assumed to land on the audience in the targeted ZIPs, with reach leveling off as frequency builds (at most 85% of the audience). Leads: Search and Meta only; display, video and CTV also drive " + (PC.drives || "store visits and branded searches") + " not counted here." +
      (adSub ? " Ad response: 2026 AudienceSCAN®, " + adNoun + " vs. all U.S. adults." : "") +
      (PC.note ? " " + PC.note : "") + " Audience: Census ACS and Adtaxi estimates." + (P.customRates() ? " Custom rates in use." : "");
    var client = (this.pClient.value || "").trim() || "Prepared for you";
    var comps = (this.pComp.value || "").split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    var d = new Date();
    return {
      client: client, place: place, placeShort: placeShort, logoPng: logo, mapPng: this.mapImage(),
      mapCaption: "ZIPs shaded by concentration of " + audienceNoun + " (index vs. U.S.; darker is higher)." + (s.mode === "area" ? "" : " Dashed ring: " + s.r + "-mile radius.") + " Prepared by Adtaxi, " + d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) + ".",
      audienceNoun: audienceNoun, stats: { aud: aud, idx: idx, zips: rows.length, pop: pop, planAud: pAud }, topZips: top, competitors: comps,
      topTitle: big ? "Largest above-average ZIPs" : "Highest-concentration ZIPs", topTown: oneTown ? top[0].town : null,
      strategy: PC.goals && PC.goals[A.strat.id] ? Object.assign({}, A.strat, { success: PC.goals[A.strat.id] }) : A.strat, plan: plan, total: total, footnote: foot,
      fileName: "Adtaxi proposal - " + client.replace(/[\\/:*?"<>|]/g, "") + " - " + d.toISOString().slice(0, 10) + ".pptx"
    };
  };
  Radius.prototype.buildProposal = function (opt) {
    var self = this, b = this.budget, A = this.allocation(), st = this.pStatus;
    if (!b.amount || !A.strat || !A.withDollars || !A.plan || !A.plan.tier || !A.channels.length) { st.textContent = "Enter a monthly budget and choose a media strategy first."; return Promise.resolve(null); }
    st.textContent = "Building…";
    var base = this.proposalBase();
    return Promise.all([loadScriptOnce(this.cfg.pptxScript || "https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js"), loadScriptOnce(base + "proposal.js?v=20261026l"), this.benchmarks(), this.logoImage()])
      .then(function (res) { return window.AdtaxiProposal.build(self.proposalContext(res[2], res[3]), opt); })
      .then(function (out) { st.textContent = "Downloaded. Open it in PowerPoint or Google Slides to edit."; return out; })
      .catch(function (e) { st.textContent = "The proposal couldn't be built (" + e.message + "). Try again in a minute."; throw e; });
  };
  Radius.prototype.openPersona = function () {
    if (!this.personaBox || this.personaBox.hidden) { this.showError("Choose a center and radius (or map a custom area) with at least one qualifying household first, then open the persona."); return; }
    this.errorBox.hidden = true;
    this.personaDlg.showModal();
  };
  // Persona PDF: just the persona, with the Adtaxi heading, on its own page
  Radius.prototype.printPersona = function () {
    var cfg = this.cfg, box = this.personaBox;
    var wrap = el("div", { class: "rz-persona-print" }, [el("div", { class: "az-print-head" }, [el("img", { src: cfg.logo || "../shared/adtaxi-logo.svg", alt: "Adtaxi" }),
      el("div", null, [el("h1", { text: ((document.querySelector(".az-title h1") || {}).textContent || cfg.title || "Market analyzer") + ": Persona" }), el("p", { text: "Prepared " + new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) })])]), box.cloneNode(true)]);
    document.body.appendChild(wrap); document.body.classList.add("rz-printing-persona");
    var done = false;
    function cleanup() { if (done) return; done = true; window.removeEventListener("afterprint", cleanup); wrap.remove(); document.body.classList.remove("rz-printing-persona"); }
    window.addEventListener("afterprint", cleanup);
    setTimeout(function () { window.print(); setTimeout(cleanup, 1000); }, 300);
  };
  Radius.prototype.leaveBehind = function () {
    if (!this.rows) { this.showError("Choose a center and radius (or map a custom area) first, then create the leave-behind."); return; }
    this.errorBox.hidden = true;
    var s = this.state, c = this.c, ci = this.byZip[s.zip];
    var where = s.mode === "area" ? "Custom area: " + this.areaPhrase() : "Within " + s.r + " miles of " + s.zip + " " + c.city[ci] + ", " + c.state[ci];
    printLeaveBehind(this.cfg.logo, [this.cfg.printTitle || this.cfg.title, where, "Audience: " + this.describe(), "Prepared by Adtaxi \u00b7 " +
      new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })], this.mapEl.style.display === "none" ? this.minis : [this.map]);
  };

  Radius.prototype.sortRows = function (rows) {
    var s = this.state, k = s.sortKey, dir = s.sortDir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      if (k === "idx" || k === "score" || /^x_/.test(k)) { var sa = (a.pop || 0) < SMALL_ZIP, sb = (b.pop || 0) < SMALL_ZIP; if (sa !== sb) return sa ? 1 : -1; }
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
  // Faint state lines for context on every map (main and market panels), drawn above the ZIP shading
  Radius.prototype.loadStates = function () {
    var self = this;
    if (this.statesP) return this.statesP;
    var url = this.cfg.statesGeo || this.cfg.zipGeo.replace(/zip\/\{level\}\/\{id\}\.json$/, "states.topo.json");
    return (this.statesP = fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (t) {
      self.statesFC = t ? topojson.mesh(t, t.objects[Object.keys(t.objects)[0]], function (a, b) { return a !== b; }) : null;
    }).catch(function () { self.statesFC = null; }));
  };
  Radius.prototype.addStates = function (map) {
    if (!this.statesFC) return null;
    if (!map.getPane("rzStates")) { var pn = map.createPane("rzStates"); pn.style.zIndex = 420; pn.style.pointerEvents = "none"; }
    return L.geoJSON(this.statesFC, { pane: "rzStates", interactive: false, style: { color: "#6f8296", weight: 1.1, opacity: 0.75, fill: false } }).addTo(map);
  };
  // Custom areas that span distant places (New York + Boston + San Francisco) are split into markets: groups of ZIPs
  // whose centers touch on a grid of half-degree cells (about 30 miles). Very small groups join the nearest market.
  Radius.prototype.clusters = function (rows) {
    var c = this.c, cellOf = {}, cells = {}, CELL = 0.5;
    rows.forEach(function (r) {
      var k = Math.floor(c.lat[r.i] / CELL) + ":" + Math.floor(c.lon[r.i] / CELL);
      (cells[k] = cells[k] || []).push(r); cellOf[r.zip] = k;
    });
    var seen = {}, groups = [];
    Object.keys(cells).forEach(function (k0) {
      if (seen[k0]) return;
      var stack = [k0], g = []; seen[k0] = 1;
      while (stack.length) {
        var k = stack.pop(), a = k.split(":"), y = +a[0], x = +a[1];
        g = g.concat(cells[k]);
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var n = (y + dy) + ":" + (x + dx);
          if (cells[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }
      groups.push(g);
    });
    var centroid = function (g) {
      var la = 0, lo = 0; g.forEach(function (r) { la += c.lat[r.i]; lo += c.lon[r.i]; });
      return [la / g.length, lo / g.length];
    };
    groups.sort(function (a, b) { return b.length - a.length; });
    var minSize = Math.max(3, Math.round(rows.length * 0.02));
    var major = groups.filter(function (g, i) { return i === 0 || g.length >= minSize; }).slice(0, 6);
    var cents = major.map(centroid);
    groups.forEach(function (g) {
      if (major.indexOf(g) >= 0) return;
      var m = centroid(g), best = 0, bd = Infinity;
      cents.forEach(function (q, j) { var d = miles(m[0], m[1], q[0], q[1]); if (d < bd) { bd = d; best = j; } });
      Array.prototype.push.apply(major[best], g);
    });
    var self = this, names = (this.markets && this.markets.dma) || {};
    return major.map(function (g) {
      var A = 0, P = 0, b = L.latLngBounds([]), byDma = {}, set = {};
      g.forEach(function (r) {
        set[r.zip] = 1; b.extend([c.lat[r.i], c.lon[r.i]]);
        if (r.aud != null) { A += r.aud; P += r.base || 0; }
        if (r.dma && r.dma !== "0") byDma[r.dma] = (byDma[r.dma] || 0) + (r.pop || 0);
      });
      var d = Object.keys(byDma).sort(function (x, y) { return byDma[y] - byDma[x]; });
      var top = d[0] && names[d[0]];
      var name = top ? top + (d.length > 1 ? " area" : " DMA") : (g[0].town || "Market");
      var share = P ? A / P : null;
      return { rows: g, zips: set, bounds: b, aud: A, pop: P, idx: share != null && self.natRate ? share / self.natRate * 100 : null, name: name, center: centroid(g) };
    }).sort(function (a, b) { return b.aud - a.aud; });
  };
  Radius.prototype.zipStyle = function (byZip, vis) {
    var self = this;
    return function (f) {
      var r = byZip[f.properties.zip], on = vis[f.properties.zip];
      return { color: "#ffffff", weight: 0.7, fillOpacity: on ? 0.9 : 0.25, fillColor: self.colorFor(r && r.idx) };
    };
  };
  Radius.prototype.zipTip = function (r) {
    return '<div class="az-tip"><b>' + r.zip + " " + r.town + "</b><br>" + (r.aud == null ? "No data" : NF0.format(Math.round(r.aud)) + " " + (this.cfg.audienceUnit || "people") + ", index " + (r.idx == null ? "—" : NF0.format(r.idx))) + "</div>";
  };
  Radius.prototype.clearMarkets = function () {
    (this.minis || []).forEach(function (m) { m.remove(); });
    this.minis = []; this.mkts = null; this.mktView = null;
    if (this.mktBar) { this.mktBar.hidden = true; this.mktBar.innerHTML = ""; }
    if (this.miniGrid) { this.miniGrid.hidden = true; this.miniGrid.innerHTML = ""; }
    if (this.mapEl && this.mapEl.style.display === "none") { this.mapEl.style.display = ""; this.map.invalidateSize(); }
  };
  // "All markets" shows one zoomed panel per market; a market button (or a panel) zooms the main map to that market
  Radius.prototype.showMarket = function (k) {
    var self = this, M = this.mkts;
    if (!M) return;
    this.mktView = k;
    Array.prototype.forEach.call(this.mktBar.children, function (b, j) { b.classList.toggle("on", (k === "all" && j === 0) || j === k + 1); b.setAttribute("aria-pressed", String((k === "all" && j === 0) || j === k + 1)); });
    if (k === "all") {
      this.mapEl.style.display = "none"; this.miniGrid.hidden = false;
      if (!this.minis.length) this.buildMinis();
      this.minis.forEach(function (m, j) { m.invalidateSize(); m.fitBounds(M[j].bounds, { padding: [10, 10], maxZoom: 10, animate: false }); });
    } else {
      this.miniGrid.hidden = true; this.mapEl.style.display = "";
      this.map.invalidateSize();
      this.map.fitBounds(M[k].bounds, { padding: [24, 24], maxZoom: 11 });
    }
  };
  Radius.prototype.buildMinis = function () {
    var self = this, byZip = this.mapByZip, vis = this.mapVis;
    this.miniGrid.innerHTML = "";
    this.miniGrid.style.setProperty("--rz-cols", this.mkts.length <= 2 ? this.mkts.length : this.mkts.length === 4 ? 2 : 3);
    this.minis = this.mkts.map(function (m, j) {
      var box = el("div", { class: "rz-mini-map" });
      var head = el("button", { type: "button", class: "rz-mini-head", title: "Zoom in on " + m.name, onclick: function () { self.showMarket(j); } }, [
        el("b", { text: m.name }),
        el("span", { text: NF0.format(Math.round(m.aud)) + " · index " + (m.idx == null ? "—" : NF0.format(m.idx)) + " · " + NF0.format(m.rows.length) + " ZIPs" })]);
      self.miniGrid.appendChild(el("div", { class: "rz-mini" }, [head, box]));
      var mm = L.map(box, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
                            keyboard: false, touchZoom: false, zoomSnap: 0.25 });
      var feats = self.mapFeats.filter(function (f) { return m.zips[f.properties.zip]; });
      L.geoJSON({ type: "FeatureCollection", features: feats }, {
        renderer: feats.length > 1200 ? L.canvas({ padding: 0.3 }) : undefined,
        style: self.zipStyle(byZip, vis),
        onEachFeature: function (f, layer) { var r = byZip[f.properties.zip]; layer.bindTooltip(function () { return self.zipTip(r); }, { sticky: true, opacity: 0.97 }); }
      }).addTo(mm);
      self.addStates(mm);
      mm.fitBounds(m.bounds, { padding: [10, 10], maxZoom: 10, animate: false });
      return mm;
    });
  };
  Radius.prototype.renderMarkets = function (moved) {
    var self = this, s = this.state;
    var M = s.mode === "area" && this.rows.length ? this.clusters(this.rows) : [];
    var far = false;
    for (var a = 0; a < M.length; a++) for (var b = a + 1; b < M.length; b++) if (miles(M[a].center[0], M[a].center[1], M[b].center[0], M[b].center[1]) > 250) far = true;
    var prev = this.mktView, prevN = this.mkts ? this.mkts.length : 0;
    (this.minis || []).forEach(function (m) { m.remove(); }); this.minis = [];
    if (M.length < 2 || !far) { this.clearMarkets(); return; }
    this.mkts = M;
    this.mktBar.innerHTML = ""; this.mktBar.hidden = false;
    this.mktBar.appendChild(el("button", { type: "button", class: "rz-mkt", onclick: function () { self.showMarket("all"); } }, [el("b", { text: "All markets" }), el("span", { text: M.length + " side by side" })]));
    M.forEach(function (m, j) {
      self.mktBar.appendChild(el("button", { type: "button", class: "rz-mkt", onclick: function () { self.showMarket(j); } }, [
        el("b", { text: m.name }), el("span", { text: NF0.format(Math.round(m.aud)) + " · index " + (m.idx == null ? "—" : NF0.format(m.idx)) })]));
    });
    this.showMarket(moved || prev == null || prevN !== M.length ? "all" : prev);
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
      this.clearMarkets();
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
    }).concat([this.loadStates(), s.mode === "area" ? this.loadMarkets() : null, s.unit === "county" ? this.loadCounties() : null, s.unit === "county" ? this.loadCountyGeo() : null])).then(function () {
      if (token !== self.mapToken) return;   // a newer update has started
      if (self.zipLayer) self.map.removeLayer(self.zipLayer);
      if (self.countyLayer) { self.map.removeLayer(self.countyLayer); self.countyLayer = null; }
      var feats = [];
      urls.forEach(function (u) { var fc = self.geo[u]; if (fc) fc.features.forEach(function (f) { if (byZip[f.properties.zip]) feats.push(f); }); });
      self.layerByZip = {}; self.mapFeats = feats; self.mapByZip = byZip; self.mapVis = vis;   // kept for the proposal map
      // Thousands of ZIP outlines (100+ mile radii) draw much faster on a canvas than as separate SVG shapes
      if (feats.length > 1200 && !self.canvas) self.canvas = L.canvas({ padding: 0.3 });
      self.zipLayer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
        renderer: feats.length > 1200 ? self.canvas : undefined,
        style: self.zipStyle(byZip, vis),
        onEachFeature: function (f, layer) {
          var r = byZip[f.properties.zip]; self.layerByZip[f.properties.zip] = layer;
          layer.bindTooltip(function () { return self.zipTip(r); }, { sticky: true, opacity: 0.97 });
        }
      });
      if (s.unit === "county" && self.countyFC && self.zipCounty) {
        // Counties view: each county shaded by the index of its ZIPs inside the area (whole county outline shown)
        var cr = {}; self.countyRows().forEach(function (x) { cr[x.fips] = x; });
        self.layerByCounty = {};
        self.countyLayer = L.geoJSON({ type: "FeatureCollection", features: self.countyFC.features.filter(function (f) { return cr[f.properties.fips]; }) }, {
          style: function (f) { return { color: "#ffffff", weight: 1, fillOpacity: 0.9, fillColor: self.colorFor(cr[f.properties.fips].idx) }; },
          onEachFeature: function (f, layer) {
            var x = cr[f.properties.fips]; self.layerByCounty[f.properties.fips] = layer;
            layer.bindTooltip('<div class="az-tip"><b>' + x.town + "</b><br>" + (x.aud == null ? "No data" : NF0.format(Math.round(x.aud)) + " " + (self.cfg.audienceUnit || "people") + " in " + NF0.format(x.zips) + (x.zips === 1 ? " ZIP" : " ZIPs") + " inside the area, index " + (x.idx == null ? "—" : NF0.format(x.idx))) + "</div>", { sticky: true, opacity: 0.97 });
          }
        }).addTo(self.map);
      } else self.zipLayer.addTo(self.map);
      if (!self.statesLayer) self.statesLayer = self.addStates(self.map);
      if (self.circle) { self.circle.bringToFront(); self.centerMark.bringToFront(); }
      if (self.areaLayer) self.areaLayer.eachLayer(function (l) { l.bringToFront(); });
      if (s.mode === "area") self.renderMarkets(moved);
    });
    this.legend.innerHTML = "";
    this.legend.appendChild(el("b", { class: "rz-legend-title", text: "Index vs. U.S." }));
    for (var k = CLASSES.length - 1; k >= 0; k--) this.legend.appendChild(el("span", { class: "az-legend-row" }, [el("span", { class: "az-swatch", style: "background:" + cssVar(CLASSES[k][2]) }), el("span", { text: CLASSES[k][3] })]));
    this.legend.appendChild(el("span", { class: "az-legend-row" }, [el("span", { class: "az-swatch nodata" }), el("span", { text: "No data" })]));
    this.legend.appendChild(el("span", { class: "rz-legend-hint", text: s.unit === "county" ? "Point to a county for its audience and index (its ZIPs inside the area)." : "Point to a ZIP for its audience and index." }));
  };
  Radius.prototype.flash = function (zip) {
    var l = this.layerByZip && this.layerByZip[zip];
    if (!l) return;
    if (this.mkts && this.mapEl.style.display === "none") {   // in the side-by-side view: open the main map first
      var j = -1; this.mkts.forEach(function (m, k) { if (m.zips[zip]) j = k; });
      this.showMarket(j >= 0 ? j : 0);
    }
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
    return p ? (this.cfg.audienceNoun ? this.cfg.audienceNoun + ", " + p.label + " profile: " : "Target audience, " + p.label + ": ") + out : out;
  };
  Radius.prototype.exportCSV = function () {
    if (!this.rows) return;
    var s = this.state, est = this.isEstimate();
    var rows = this.sortRows(this.visible().slice());   // same order as the table
    var area = s.mode === "area", circ = area && s.area.circles.length;
    var head = ["ZIP", "Town"].concat(area ? ["County"] : []).concat(!area ? ["Miles from center"] : circ ? ["Miles to nearest location"] : []);
    var ctx = this.addContext(rows), sc = !!this.cfg.blendScore;
    this.addScore(rows, ctx); this.sortRows(rows);
    if (sc) head.push("Score (within this area)");
    var lines = [head.concat(["Population", est ? "Estimated audience" : "Audience", "Audience share", "Index vs US"]).concat(ctx.map(function (k) { return CONTEXT[k].long; })).concat(["Audience definition"]).map(csvCell).join(",")];
    var def = this.describe();
    rows.forEach(function (r) {
      var lead = [r.zip, r.town].concat(area ? [r.county || ""] : []).concat(!area || circ ? [r.dist == null ? "" : r.dist.toFixed(1)] : []);
      if (sc) lead.push(r.score == null ? "" : Math.round(r.score));
      lines.push(lead.concat([r.pop, r.aud == null ? "" : Math.round(r.aud), r.share == null ? "" : (r.share * 100).toFixed(1) + "%", r.idx == null ? "" : Math.round(r.idx)])
        .concat(ctx.map(function (k) { var v = r["x_" + k]; return v == null ? "" : (v * 100).toFixed(1) + "%"; })).concat([def]).map(csvCell).join(","));
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
    if ((this.cfg.profiles || []).length) secs.push(["Target audiences", "Each category starts from a profile of its likely customers, built from the same Census and CDC data. A profile is a starting point: change any filter to fit the client. Each target audience shows only the filters that pertain to it; choose Custom audience to see them all. When a profile includes an \"either\" condition (such as 65 and older, or diabetes), people who meet either one are counted once. " + (this.cfg.blendScore ? "Counties come first, then ZIPs, both ranked by Score (0\u2013100): 40% index (how concentrated likely customers are), 30% estimated audience (how many there are) and 30% the profile's ZIP-wide rates, each a percentile among the area's counties or ZIPs. ZIPs and county parts with fewer than 1,000 residents aren't scored, since a high share of a tiny ZIP is too few people to reach. Sort by Index or Est. audience to see either on its own." : "The ZIP list is sorted by index, so the ZIPs where likely customers are most concentrated come first; ZIPs with fewer than 1,000 residents are listed after the rest, since a high share of a tiny ZIP is too few people to reach. Sort by Est. audience to see the largest counts.")]);
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
      placeholder: "Type or paste ZIPs, counties, towns, DMAs, metros, states or Census regions, one per line",
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
    if (this.modeSeg) Array.prototype.forEach.call(this.modeSeg.children, function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-mode") === (area ? "area" : "radius"))); });
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
    Promise.all([this.loadCounties(), this.loadMarkets()]).then(function () {
      if (self.pendingCA) {
        self.areaIn.value = self.tokensToText(self.pendingCA.split(","));
        self.pendingCA = null; self.applyArea();
      } else self.update(true);
      if (!self.areaIn.value) self.areaIn.focus({ preventScroll: true });
    }).catch(function (e) { self.showError("The county list didn't load (" + e.message + "). Refresh the page and try again."); });
  };
  // States, Census regions and divisions for Custom area (Census Bureau regions and divisions of the United States)
  var STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
    FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
    NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
    SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
  var CENSUS_GROUPS = {
    new_england: { n: "New England", kind: "division", st: ["CT", "ME", "MA", "NH", "RI", "VT"] },
    middle_atlantic: { n: "Middle Atlantic", kind: "division", st: ["NJ", "NY", "PA"] },
    east_north_central: { n: "East North Central", kind: "division", st: ["IL", "IN", "MI", "OH", "WI"] },
    west_north_central: { n: "West North Central", kind: "division", st: ["IA", "KS", "MN", "MO", "NE", "ND", "SD"] },
    south_atlantic: { n: "South Atlantic", kind: "division", st: ["DE", "DC", "FL", "GA", "MD", "NC", "SC", "VA", "WV"] },
    east_south_central: { n: "East South Central", kind: "division", st: ["AL", "KY", "MS", "TN"] },
    west_south_central: { n: "West South Central", kind: "division", st: ["AR", "LA", "OK", "TX"] },
    mountain: { n: "Mountain", kind: "division", st: ["AZ", "CO", "ID", "MT", "NV", "NM", "UT", "WY"] },
    pacific: { n: "Pacific", kind: "division", st: ["AK", "CA", "HI", "OR", "WA"] }
  };
  CENSUS_GROUPS.northeast = { n: "Northeast", kind: "region", st: CENSUS_GROUPS.new_england.st.concat(CENSUS_GROUPS.middle_atlantic.st) };
  CENSUS_GROUPS.midwest = { n: "Midwest", kind: "region", st: CENSUS_GROUPS.east_north_central.st.concat(CENSUS_GROUPS.west_north_central.st) };
  CENSUS_GROUPS.south = { n: "South", kind: "region", st: CENSUS_GROUPS.south_atlantic.st.concat(CENSUS_GROUPS.east_south_central.st, CENSUS_GROUPS.west_south_central.st) };
  CENSUS_GROUPS.west = { n: "West", kind: "region", st: CENSUS_GROUPS.mountain.st.concat(CENSUS_GROUPS.pacific.st) };
  var STATE_BY_NAME = {}; Object.keys(STATE_NAMES).forEach(function (k) { STATE_BY_NAME[STATE_NAMES[k].toLowerCase()] = k; });
  // DMA and metro names (shared/geo/market_names.json) for Custom area lines such as "Raleigh-Durham DMA"
  Radius.prototype.loadMarkets = function () {
    var self = this;
    if (this.marketP) return this.marketP;
    var url = this.cfg.marketNames || this.cfg.zipGeo.replace(/zip\/\{level\}\/\{id\}\.json$/, "market_names.json");
    return (this.marketP = fetch(url).then(function (r) { return r.ok ? r.json() : { dma: {}, metro: {} }; })
      .catch(function () { return { dma: {}, metro: {} }; }).then(function (d) { self.markets = d; return d; }));
  };
  Radius.prototype.marketZips = function (kind, code) {   // indexes of the ZIPs in a DMA or metro
    var col = kind === "dma" ? this.c.dma : this.c.cbsa;
    if (!col) return [];
    if (!this._mz) this._mz = {};
    if (!this._mz[kind]) { var ix = {}; for (var i = 0; i < col.length; i++) { var k = col[i]; if (k) (ix[k] = ix[k] || []).push(i); } this._mz[kind] = ix; }
    return this._mz[kind][code] || [];
  };
  Radius.prototype.findMarket = function (kind, q) {
    var names = (this.markets && this.markets[kind]) || {}, norm = function (x) { return String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); };
    var nq = norm(q), words = nq.split(" ").filter(Boolean), exact = [], prefix = [], part = [];
    if (!nq) return null;
    Object.keys(names).forEach(function (code) {   // best match first: the whole name, then the start of the name, then all the words anywhere
      var n = norm(names[code]);
      if (n === nq) exact.push(code);
      else if (n.indexOf(nq + " ") === 0) prefix.push(code);
      else if (words.every(function (w) { return (" " + n + " ").indexOf(" " + w) >= 0; })) part.push(code);
    });
    var hits = exact.length ? exact : prefix.length ? prefix : part;
    return hits.length === 1 ? { code: hits[0] } : hits.length ? { many: hits.map(function (c) { return names[c]; }) } : null;
  };
  Radius.prototype.loadCounties = function () {
    var self = this;
    if (this.countyP) return this.countyP;
    this.loadMarkets();
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
    var A = { zips: {}, circles: [], items: [], bad: [], padded: [], noRes: 0, tokens: [], n: { zip: 0, county: 0, town: 0, loc: 0, dma: 0, metro: 0, state: 0, region: 0 } };
    var tok = {}, addTok = function (t) { if (!tok[t]) { tok[t] = 1; A.tokens.push(t); } };
    var bad = function (t, why) { A.bad.push({ text: t, why: why }); };
    var addZip = function (raw) {
      var z = zipOf(raw);
      if (!z) return bad(raw, "isn't a 5-digit ZIP");
      if (self.byZip[z.zip] === undefined) return bad(z.zip, "isn't a residential ZIP in the data (it may be a PO box, business or retired ZIP)");
      if (z.padded) A.padded.push(raw + " → " + z.zip);
      A.zips[z.zip] = 1;
      if (!tok["z" + z.zip]) A.n.zip++;   // count each ZIP the user listed once, whatever order the lines come in
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
    var KIND = { dma: "DMA", metro: "metro" };
    var addMarket = function (kind, code) {
      var key = (kind === "dma" ? "d" : "m") + code;
      if (tok[key]) return;
      var ix = self.marketZips(kind, code), k = 0;
      if (!ix.length) return bad((kind === "dma" ? "DMA " : "Metro ") + code, "has no residential ZIPs in the data");
      ix.forEach(function (i) { A.zips[c.zip[i]] = 1; if (c.population[i] > 0 || c.acs_pop[i] > 0) k++; });
      var nm = self.markets && self.markets[kind] && self.markets[kind][code];
      A.n[kind]++; A.items.push({ kind: kind, label: (nm || code) + " " + KIND[kind], count: k });
      addTok(key);
    };
    var stateZips = function (st) { var out = []; for (var i = 0; i < c.state.length; i++) if (c.state[i] === st) out.push(i); return out; };
    var addState = function (st) {
      if (tok["s" + st]) return;
      var k = 0; stateZips(st).forEach(function (i) { A.zips[c.zip[i]] = 1; if (c.population[i] > 0 || c.acs_pop[i] > 0) k++; });
      A.n.state++; A.items.push({ kind: "state", label: STATE_NAMES[st], count: k }); addTok("s" + st);
    };
    var addGroup = function (key) {
      var g = CENSUS_GROUPS[key]; if (tok["g" + key]) return;
      var k = 0; g.st.forEach(function (st) { stateZips(st).forEach(function (i) { A.zips[c.zip[i]] = 1; if (c.population[i] > 0 || c.acs_pop[i] > 0) k++; }); });
      A.n.region++; A.items.push({ kind: "region", label: g.n + " (Census " + g.kind + ", " + g.st.length + " states)", count: k }); addTok("g" + key);
    };
    var marketLine = function (t) {   // "DMA 560", "Metro 39580", "Raleigh-Durham DMA", "DMA: Charlotte", "Charlotte metro area", "NC", "North Carolina", "South Atlantic", "Midwest region"
      var m, low = t.toLowerCase().replace(/^(?:the\s+)?(?:state of|census (?:region|division)[:\s]*)\s*/, "").replace(/\s+(?:state|census region|census division|region|division)$/, "").trim();
      if (/^[A-Za-z]{2}$/.test(t) && STATE_NAMES[t.toUpperCase()]) return addState(t.toUpperCase()), true;
      if (STATE_BY_NAME[low]) return addState(STATE_BY_NAME[low]), true;
      var gk = low.replace(/[^a-z]+/g, "_");
      if (CENSUS_GROUPS[gk]) return addGroup(gk), true;
      if ((m = /^dma[:#\s-]*(\d{3})\b/i.exec(t))) return addMarket("dma", m[1]), true;
      if ((m = /^(?:metro|msa|cbsa)[:#\s-]*(\d{5})\b/i.exec(t))) return addMarket("metro", m[1]), true;
      var kind = null, q = null;
      if ((m = /^(dma|metro|msa)\s*[:\-]\s*(.+)$/i.exec(t))) { kind = m[1]; q = m[2]; }
      else if ((m = /^(.+?)[\s,-]+(dma|metro(?: area)?|msa)$/i.exec(t))) { kind = m[2]; q = m[1]; }
      if (!kind) return false;
      kind = /^dma$/i.test(kind) ? "dma" : "metro";
      var hit = self.findMarket(kind, q);
      if (!hit) return bad(t, "isn't a " + KIND[kind] + " we can find; check the spelling"), true;
      if (hit.many) return bad(t, "matches " + hit.many.length + " " + (kind === "dma" ? "DMAs" : "metros") + " (" + hit.many.slice(0, 3).join("; ") + (hit.many.length > 3 ? "…" : "") + "); use more of the name"), true;
      return addMarket(kind, hit.code), true;
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
      if (marketLine(t)) return;
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
    if (!this.counties || !this.markets) { Promise.all([this.loadCounties(), this.loadMarkets()]).then(function () { self.applyArea(); }); return; }
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
      if (k === "s") return STATE_NAMES[v] || v;
      if (k === "g") return CENSUS_GROUPS[v] ? CENSUS_GROUPS[v].n + " " + CENSUS_GROUPS[v].kind : "";
      if (k === "d" || k === "m") { var nm = self.markets && self.markets[k === "d" ? "dma" : "metro"][v]; return (k === "d" ? "DMA " : "Metro ") + v + (nm ? " " + nm : ""); }
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
      var aud = self.audience(i), base = self.baseOf(i), share = aud != null && base ? aud / base : null, f = self.zipCounty[c.zip[i]];
      rows.push({ i: i, zip: c.zip[i], town: c.city[i] + ", " + c.state[i], county: f ? self.counties[f].n : "", dist: d, pop: pop, base: base, aud: aud, share: share,
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
    pl(n.region, "Census region or division", "Census regions and divisions"); pl(n.state, "state", "states"); pl(n.dma, "DMA", "DMAs"); pl(n.metro, "metro", "metros"); pl(n.county, "county", "counties"); pl(n.town, "town", "towns"); pl(n.zip, "ZIP", "ZIPs"); pl(n.loc, "location", "locations");
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
    } else if (!A.bad.length) box.appendChild(el("p", { class: "rz-note", text: "The list is empty. Enter ZIPs, counties, towns, DMAs or metros, or upload a file." }));
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
        var typed = (app.zipIn.value || "").trim();
        if (typed && app.state.mode !== "area" && !(app.state.zip && typed.indexOf(app.state.zip) === 0)) {
          app.setCenter(typed);   // typed while the data was loading
          if (app.state.zip) return;
        }
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
