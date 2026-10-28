/* Adtaxi plan settings, shared by the Media Mix Planner and the Recommended allocation
   in every analyzer's Trade area, so both always show the same channel split.

   =====================  SETTINGS (draft: edit here)  =====================
   CHANNELS:      what each channel is, its funnel role and how it's bought.
   STRATEGIES:    draft weights per channel. With a budget, the plan keeps the
                  top channels by weight (how many depends on the budget tier)
                  and re-scales them to 100%.
   TIERS:         from the Adtaxi media mix training (fewer channels at lower budgets).
   SERVICE_TIERS: Adtaxi service tiers, set by the advertiser's TOTAL monthly budget.
                  available: channels Adtaxi offers at that tier.
                  minimums:  fixed monthly minimums by channel.
                  progFirst / progAdd: programmatic channels without a fixed minimum
                  need progFirst for the first (highest-weight) one and progAdd for
                  each additional one. DOOH keeps its own minimum.
                  Channel availability by tier is from the 2024 tier sheet; minimums are from the Adtaxi rate card (Nov 2025).
   TERMS:         channels with term: 3 are sold with a 3-month minimum (rate card).
   FEES:          management fees. OFF until real rates are supplied (see below). */
(function () {
  var CHANNELS = {
    ctv:      { label: "CTV / streaming TV",     short: "CTV",              role: "awareness",     prog: true,  color: "#0b5d53", job: "Reaches new households on the big screen, targeted by audience and ZIP instead of whole TV markets." },
    youtube:  { label: "YouTube",                short: "YouTube",          role: "awareness",     prog: false, color: "#1f8f81", job: "Video reach at scale, on TVs and phones, with targeting by interest and intent." },
    dooh:     { label: "Digital out-of-home",    short: "DOOH",             role: "awareness",     prog: true,  color: "#5fb8ac", job: "Screens near where people shop and commute, bought by location and daypart." },
    social:   { label: "Social (Meta)",          short: "Social",           role: "consideration", prog: false, term: 3, color: "#13a196", job: "Builds familiarity and drives action with targeted image and video ads on Facebook and Instagram." },
    display:  { label: "Programmatic display",   short: "Display",          role: "consideration", prog: true,  color: "#3f7fb5", job: "Keeps the brand in front of the target audience across websites and apps, geo-targeted to the trade area." },
    audio:    { label: "Digital audio",          short: "Audio",            role: "consideration", prog: true,  color: "#7aa6cf", job: "Streaming audio and podcast ads that reinforce the message, targeted by audience and location." },
    search:   { label: "Google Search",          short: "Search",           role: "conversion",    prog: false, term: 3, color: "#0f2742", job: "Captures people actively searching for what you offer, at the moment they're ready to act." },
    shopping: { label: "Shopping / product ads", short: "Shopping",         role: "conversion",    prog: false, color: "#173c63", job: "Puts products and prices in front of shoppers who are ready to buy." },
    tiktok:   { label: "TikTok",                 short: "TikTok",           role: "awareness",     prog: false, term: 3, color: "#2f9e8f", job: "Short-form video that reaches new audiences with engaging, sound-on creative." },
    snapchat: { label: "Snapchat",               short: "Snapchat",         role: "awareness",     prog: false, term: 3, color: "#8fcfc6", job: "Full-screen mobile ads that reach younger audiences close to home." },
    retarget: { label: "Retargeting",            short: "Retargeting",      role: "conversion",    prog: true,  color: "#5f7286", job: "Brings back people who visited or engaged but didn't act yet." }
  };
  var ROLES = [ ["awareness", "Awareness: reach new audiences"], ["consideration", "Consideration: build familiarity"], ["conversion", "Conversion: capture demand"] ];

  var STRATEGIES = [
    { id: "awareness", label: "Brand awareness", success: "Reach, visibility and brand familiarity",
      kpis: [ ["Reach and frequency", "How many target households saw the brand, and how often"], ["Video completion", "Share of video ads watched to the end"], ["Brand search lift", "Growth in searches for the brand name"] ],
      weights: { ctv: 35, youtube: 25, social: 20, display: 10, audio: 5, dooh: 5, tiktok: 5, snapchat: 3 } },
    { id: "leads", label: "Lead generation", success: "Form fills, calls and appointments",
      kpis: [ ["Cost per lead", "Media cost divided by qualified leads"], ["Calls and form fills", "Tracked leads by channel"], ["Lead-to-appointment rate", "How many leads become appointments"] ],
      weights: { search: 50, social: 25, retarget: 15, youtube: 10 } },
    { id: "online", label: "Online sales", success: "Ecommerce purchases and return on ad spend",
      kpis: [ ["Return on ad spend", "Revenue per dollar of media"], ["Online purchases", "Orders attributed to the campaign"], ["Cost per acquisition", "Media cost per new customer"] ],
      weights: { shopping: 35, search: 25, social: 20, retarget: 15, youtube: 5 } },
    { id: "offline", label: "Offline / in-store sales", success: "Store visits and local purchases",
      kpis: [ ["Store visits", "Measured visits to the location"], ["Calls and directions", "Calls and map requests from ads"], ["Cost per visit", "Media cost per measured visit"] ],
      weights: { search: 30, social: 25, display: 25, ctv: 10, dooh: 10 } },
    { id: "growth", label: "Growth (full funnel)", success: "New audiences plus captured demand",
      kpis: [ ["New-audience reach", "Households reached that hadn't engaged before"], ["Search demand", "Growth in searches and site visits"], ["Leads or sales", "Outcomes tied back to the plan"] ],
      weights: { search: 30, ctv: 30, social: 25, display: 15 } }
  ];

  var MIN_BUDGET = 3000;   // Adtaxi monthly minimum ad spend (Oct 2026: $3,000; Tier 3 below it no longer applies)
  var TIERS = [ { max: 7500, channels: 1, label: "Under $7.5K: one primary channel" },
                { max: 12000, channels: 2, label: "$7.5K–$12K: one to two complementary channels" },
                { max: 20000, channels: 3, label: "$12K–$20K: two to three channels with distinct roles" },
                { max: Infinity, channels: 4, label: "$20K+: a broader multi-channel strategy" } ];
  // Monthly minimums per channel (Adtaxi rate card, Nov 2025): each programmatic product (display, which includes
  // retargeting, plus CTV and audio) $3K; DOOH $5K; Meta, TikTok and Snapchat $3K; Google Search $1.5K; YouTube $750.
  // Shopping isn't on the rate card: $3K per Adtaxi (Oct 2026), sometimes per platform; one channel here, so $3K.
  var MINIMUMS = { display: 3000, retarget: 3000, ctv: 3000, audio: 3000, dooh: 5000, social: 3000, tiktok: 3000, snapchat: 3000, search: 1500, youtube: 750, shopping: 3000 };
  var SERVICE_TIERS = [
    { label: "Tier 3", min: 1000, max: 3000,
      available: ["display", "retarget", "social", "tiktok", "snapchat", "search", "youtube"], minimums: MINIMUMS },
    { label: "Tier 2", min: 3000, max: 10000,
      available: ["ctv", "youtube", "dooh", "social", "tiktok", "snapchat", "display", "audio", "search", "shopping", "retarget"], minimums: MINIMUMS },
    { label: "Strategic", min: 10000, max: Infinity,
      available: ["ctv", "youtube", "dooh", "social", "tiktok", "snapchat", "display", "audio", "search", "shopping", "retarget"], minimums: MINIMUMS }
  ];
  var CUSTOM_PLAN_BUDGET = 10000;   // Strategic tier: show the "larger opportunity" note

  /* BUDGET AND FEES: the budget is allocated in full by platform. With "Add management fees" on, each platform's fee is
     added to its cost (programmatic is priced by CPM with management included, so it doesn't change).
     MANAGEMENT FEES: switched OFF. While enabled is false, nothing about fees appears
     on screen and every dollar shown is media spend, with the note below.
     To switch fees on, fill in the rates and set enabled: true:
       budgetIs: "gross": the budget entered includes fees (fees come out of it)
                 "net":   the budget entered is media only (fees are added on top)
       tierOn:   "gross" or "media": which figure sets the service tier and channel count
       rates:    by service tier label: pct (share, e.g. 0.15 for 15%) and/or flat
                 ($ a month). Both may be used; flat is added to the percentage fee.
       minFee:   optional monthly floor for the total fee.
       showFee:  true shows the fee line in the allocation; false keeps it off screen
                 and labels the figures as media. */
  var FEES = {
    enabled: false,
    budgetIs: "gross",
    tierOn: "gross",
    rates: { "Tier 3": { pct: null, flat: null }, "Tier 2": { pct: null, flat: null }, "Strategic": { pct: null, flat: null } },
    minFee: null,
    showFee: true,
    offNote: "Amounts allocate the full budget by platform. Turn on Add management fees to add each platform's fee to its cost."
  };
  /* MANAGEMENT FEE SCHEDULE (Adtaxi rate card, Nov 2025), shown only when a user turns on "Show management fees".
     Budgets are gross: the fee comes out of each channel's amount, and the rest is media spend.
       pct:      fee as a share of the channel's monthly amount
       search:   Google Search fee by the search amount (Tier 3 $1,500-$2,999: 25%; $3,000+: 20%)
       Programmatic channels (prog: true) are priced by CPM with management included: no separate fee line.
       Shopping's fee isn't on the rate card, so no fee is shown for it. */
  var MGMT = {
    pct: { social: 0.40, tiktok: 0.40, snapchat: 0.40, youtube: 0.40 },
    search: [ { min: 0, max: 3000, pct: 0.25 }, { min: 3000, max: Infinity, pct: 0.20 } ],
    cpmNote: "Management included in CPM pricing",
    unknownNote: "Fee not on the rate card"
  };
  /* =========================  END OF SETTINGS  ========================= */

  /* Management fees added on top (the "Add management fees" toggle): a channel's allocated amount is its media spend,
     and the fee is added so the channel's total cost rises. Rate card fees are a share of the total (Meta: 60% of the
     total goes to media), so total = media / (1 - fee): $2,640 of Meta media costs $4,400, a $1,760 fee.
     Search's fee tier follows the resulting total (25% under $3,000, 20% at $3,000+).
     Returns { kind: "fee", pct, media, fee, total } | { kind: "cpm", media, total } | { kind: "none", media, total } */
  function channelFee(id, media) {
    var ch = CHANNELS[id];
    if (!ch || media == null) return { kind: "none", media: media, total: media };
    if (ch.prog) return { kind: "cpm", media: media, total: media };
    var pct = MGMT.pct[id];
    var total;
    if (id === "search") {
      var hi = MGMT.search[MGMT.search.length - 1], lo = MGMT.search[0];
      if (media / (1 - hi.pct) >= hi.min) pct = hi.pct;
      else if (media / (1 - lo.pct) < hi.min) pct = lo.pct;
      else { total = hi.min; pct = (total - media) / total; }   // between tiers: the total sits at the tier boundary
    }
    if (pct == null) return { kind: "none", media: media, total: media };
    if (total == null) total = Math.round(media / (1 - pct));
    return { kind: "fee", pct: pct, media: media, fee: total - media, total: total, placeholder: !!ch.placeholder };
  }
  /* Plan totals with fees added: media (the budget), fees, and total cost */
  function feeSummary(items) {
    var out = { media: 0, fee: 0, total: 0, cpm: 0, none: 0 };
    items.forEach(function (r) {
      if (r.dollars == null) return;
      var f = channelFee(r.id, r.dollars);
      out.media += f.media; out.total += f.total;
      if (f.kind === "fee") out.fee += f.fee; else if (f.kind === "cpm") out.cpm += f.media; else out.none += f.media;
    });
    return out;
  }
  function usd0(x) { return "$" + Math.round(x).toLocaleString("en-US"); }
  function feeLine(f) {
    if (f.kind === "fee") return "Media " + usd0(f.media) + " + management fee " + usd0(f.fee) + " (" + Math.round(f.pct * 1000) / 10 + "% of total" + (f.placeholder ? ", placeholder rate" : "") + ") = " + usd0(f.total);
    if (f.kind === "cpm") return MGMT.cpmNote;
    return MGMT.unknownNote;
  }

  // "Social (Meta) and Google Search are sold with a 3-month minimum." for the channels in a plan that carry a term
  function termNote(items) {
    var t = items.filter(function (r) { return CHANNELS[r.id] && CHANNELS[r.id].term; }).map(function (r) { return CHANNELS[r.id].label; });
    if (!t.length) return "";
    var list = t.length === 1 ? t[0] : t.slice(0, -1).join(", ") + " and " + t[t.length - 1];
    return list + (t.length === 1 ? " is" : " are") + " sold with a 3-month minimum.";
  }
  function serviceTier(budget) { return SERVICE_TIERS.filter(function (t) { return budget >= t.min && budget < t.max; })[0] || null; }
  function minFor(id, set, st) {
    if (st.minimums[id] != null) return st.minimums[id];
    if (CHANNELS[id].prog && st.progFirst) {
      var progs = set.filter(function (r) { return CHANNELS[r.id].prog && st.minimums[r.id] == null; });
      return progs.length && progs[0].id === id ? st.progFirst : st.progAdd;
    }
    return 0;
  }
  // Split the budget by weight, lifting any channel below its minimum up to it; null if the minimums don't fit
  function fit(set, budget, st) {
    var mins = {}, need = 0;
    set.forEach(function (r) { mins[r.id] = minFor(r.id, set, st); need += mins[r.id]; });
    if (need > budget) return null;
    var out = {}, raised = {}, free = set.slice(), changed = true;
    while (changed) {
      changed = false;
      var rest = budget - Object.keys(out).reduce(function (a, k) { return a + out[k]; }, 0);
      var W = free.reduce(function (a, r) { return a + r.w; }, 0);
      free.slice().forEach(function (r) {
        if (rest * r.w / W < mins[r.id]) { out[r.id] = mins[r.id]; raised[r.id] = true; free.splice(free.indexOf(r), 1); changed = true; }
      });
      if (!changed) free.forEach(function (r) { out[r.id] = rest * r.w / W; });
    }
    return { dollars: out, raised: raised, mins: mins };
  }

  /* Channel plan for a strategy and a MEDIA budget.
     tierBudget (optional): the figure that sets the tier and channel count when it differs
     from the media budget (fees on, tierOn "gross"). Defaults to the media budget. */
  /* fixed (optional): { id, dollars, label, job } a line set elsewhere (the TV + Video tool's Digital Video amount). It keeps
     its dollars; the rest of the budget is split across the strategy's other channels as usual. */
  function buildPlan(s, budget, tierBudget, fixed) {
    var tb = tierBudget || budget;
    if (fixed && CHANNELS[fixed.id] && fixed.dollars > 0 && budget && budget >= MIN_BUDGET && tb >= MIN_BUDGET) return buildFixed(s, budget, tb, fixed);
    var list = Object.keys(s.weights).map(function (k) { return { id: k, w: s.weights[k] }; }).sort(function (a, b) { return b.w - a.w; });
    var tier = null, st = null, skipped = [], unavailable = [], raised = [], mins = {};
    if (budget && budget >= MIN_BUDGET && tb >= MIN_BUDGET) {
      tier = TIERS.filter(function (t) { return tb < t.max; })[0];
      st = serviceTier(tb);
      // Take channels in weight order: skip ones not offered at this tier or whose minimum won't fit
      var chosen = [], result = null;
      list.forEach(function (r) {
        if (chosen.length >= tier.channels) return;
        if (st.available.indexOf(r.id) < 0) { unavailable.push(r); return; }
        var trial = fit(chosen.concat([r]), budget, st);
        if (trial) { chosen.push(r); result = trial; }
        else skipped.push({ r: r, min: minFor(r.id, chosen.concat([r]), st) });
      });
      list = chosen;
      if (!list.length) return { items: [], tier: tier, service: st, skipped: skipped, unavailable: unavailable, raised: raised, mins: mins };
      // Dollars to the nearest $50, adding any rounding difference to the largest channel
      list.forEach(function (r) { r.dollars = Math.round(result.dollars[r.id] / 50) * 50; mins[r.id] = result.mins[r.id]; if (result.raised[r.id]) raised.push(r); });
      var diff = Math.round(budget) - list.reduce(function (a, r) { return a + r.dollars; }, 0);
      list.slice().sort(function (a, b) { return b.dollars - a.dollars; })[0].dollars += diff;
      list.forEach(function (r) { r.share = r.dollars / budget; });
    } else {
      var sum = list.reduce(function (a, r) { return a + r.w; }, 0);
      list.forEach(function (r) { r.share = r.w / sum; });
    }
    list.forEach(function (r) { r.ch = CHANNELS[r.id]; r.pct = Math.floor(r.share * 100); });
    var left = 100 - list.reduce(function (a, r) { return a + r.pct; }, 0);
    list.slice().sort(function (a, b) { return (b.share * 100 - b.pct) - (a.share * 100 - a.pct); }).slice(0, left).forEach(function (r) { r.pct++; });
    list.forEach(function (r) { r.share = r.pct / 100; });
    // Only mention unavailable channels that would have made the plan (weight above the last channel kept)
    var floorW = list.length ? list[list.length - 1].w : 0;
    unavailable = unavailable.filter(function (r) { return r.w >= floorW; });
    return { items: list, tier: tier, service: st, skipped: skipped, unavailable: unavailable, raised: raised, mins: mins };
  }

  /* Plan with one line held at a set amount. The tier still comes from the total; the held line counts as one of the
     tier's channels, and when money is left over at least one other channel is added so the rest is spent. */
  function buildFixed(s, budget, tb, fixed) {
    var tier = TIERS.filter(function (t) { return tb < t.max; })[0], st = serviceTier(tb);
    var F = Math.min(Math.round(fixed.dollars), Math.round(budget)), rest = Math.round(budget) - F;
    var skipped = [], unavailable = [], raised = [], mins = {}, leftover = 0;
    var others = Object.keys(s.weights).filter(function (k) { return k !== fixed.id; }).map(function (k) { return { id: k, w: s.weights[k] }; }).sort(function (a, b) { return b.w - a.w; });
    var slots = rest > 0 ? Math.max(1, tier.channels - 1) : 0, chosen = [], result = null;
    others.forEach(function (r) {
      if (chosen.length >= slots) return;
      if (st.available.indexOf(r.id) < 0) { unavailable.push(r); return; }
      var trial = fit(chosen.concat([r]), rest, st);
      if (trial) { chosen.push(r); result = trial; }
      else skipped.push({ r: r, min: minFor(r.id, chosen.concat([r]), st) });
    });
    if (rest > 0 && !chosen.length) { leftover = rest; F += rest; }   // no other channel's minimum fits what's left: it stays on the held line
    else if (chosen.length) {
      chosen.forEach(function (r) { r.dollars = Math.round(result.dollars[r.id] / 50) * 50; mins[r.id] = result.mins[r.id]; if (result.raised[r.id]) raised.push(r); });
      var diff = rest - chosen.reduce(function (a, r) { return a + r.dollars; }, 0);
      chosen.slice().sort(function (a, b) { return b.dollars - a.dollars; })[0].dollars += diff;
    }
    var held = { id: fixed.id, w: s.weights[fixed.id] || 0, dollars: F, fixed: true };
    mins[fixed.id] = MINIMUMS[fixed.id] || 0;
    var list = [held].concat(chosen);
    list.forEach(function (r) { r.share = r.dollars / budget; r.ch = CHANNELS[r.id]; r.pct = Math.floor(r.share * 100); });
    held.ch = Object.assign({}, CHANNELS[fixed.id], fixed.label ? { label: fixed.label, short: fixed.short || fixed.label } : {}, fixed.job ? { job: fixed.job } : {});
    var left = 100 - list.reduce(function (a, r) { return a + r.pct; }, 0);
    list.slice().sort(function (a, b) { return (b.share * 100 - b.pct) - (a.share * 100 - a.pct); }).slice(0, left).forEach(function (r) { r.pct++; });
    list.forEach(function (r) { r.share = r.pct / 100; });
    var floorW = chosen.length ? chosen[chosen.length - 1].w : 0;
    unavailable = unavailable.filter(function (r) { return r.w >= floorW; });
    return { items: list, tier: tier, service: st, skipped: chosen.length ? skipped : [], unavailable: unavailable, raised: raised, mins: mins,
             fixed: { id: fixed.id, dollars: Math.min(Math.round(fixed.dollars), Math.round(budget)), leftover: leftover, short: budget < fixed.dollars } };
  }
  /* A starting total for a held line: the smallest budget (in $500 steps, at least $7,500 so the plan has room for more
     than one channel) at which the strategy would on its own put at least that amount on the line. */
  function fixedBudget(s, id, dollars) {
    if (!s || !dollars) return null;
    var T = Math.max(7500, MIN_BUDGET, Math.ceil(dollars / 500) * 500);
    for (var n = 0; n < 2000; n++, T += 500) {
      var p = buildPlan(s, T, T);
      var it = p.items.filter(function (r) { return r.id === id; })[0];
      if (it && it.dollars >= dollars) return T;
    }
    return Math.max(MIN_BUDGET, Math.ceil(dollars / 500) * 500);   // the strategy doesn't use this line: start at the line itself
  }

  /* Budget entered -> media dollars, fee and the figure that sets the tier.
     With fees off: media = entered, fee = 0, total = entered. */
  function applyFees(entered) {
    var out = { entered: entered, media: entered, fee: 0, total: entered, tierBudget: entered, feesOn: false };
    if (!entered || !FEES.enabled) return out;
    function feeOn(base) {
      var st = serviceTier(base), r = st && FEES.rates[st.label];
      if (!r) return 0;
      var f = (r.pct || 0) * base + (r.flat || 0);
      if (FEES.minFee && f < FEES.minFee) f = FEES.minFee;
      return Math.round(f);
    }
    out.feesOn = true;
    if (FEES.budgetIs === "net") {          // budget is media; fee added on top
      out.media = entered; out.fee = feeOn(entered); out.total = entered + out.fee;
    } else {                                // budget includes the fee; solve fee = rate x gross
      out.fee = feeOn(entered); out.media = Math.max(0, entered - out.fee); out.total = entered;
    }
    out.tierBudget = FEES.tierOn === "media" ? out.media : out.total;
    return out;
  }

  /* ---------- Targeted impressions (proposals) ----------
     Estimates for a channel's monthly investment (which includes Adtaxi management):
       Programmatic: impressions at Adtaxi's suggested retail CPMs (rate card, Nov 2025; management is in the CPM).
         Display and retargeting clicks at a 0.10% click-through rate (open-exchange banner benchmark, 0.05-0.1%).
         CTV completed views at a 95% completion rate (Innovid global CTV benchmarks).
       Google Search and Meta: the media portion (investment minus the management fee) at WordStream 2026 benchmarks
         for the industry: Search clicks = media / CPC, impressions = clicks / CTR, leads = media / CPL;
         Meta CPM = CPC x CTR x 1,000, impressions = media / CPM x 1,000, clicks = media / CPC.
       YouTube, TikTok and Snapchat: the media portion at mid-range 2026 cross-platform benchmark CPMs (Hubfluence).
       Leads are estimated for Search and Meta only. Audio, DOOH and Shopping: no published basis, so no estimate. */
  var RETAIL_CPM = { display: 10, retarget: 10, ctv: 50, audio: 35, dooh: 30 };
  var BENCH_CPM = { youtube: 20, tiktok: 6.5, snapchat: 5.25 };
  // ctr: display/retargeting click-through rate; vcr: CTV completion rate. search/social: a rep's own CPC, CTR (%) and CPL;
  // null uses the WordStream benchmark for the category.
  var EST = { ctr: 0.001, vcr: 0.95, search: { cpc: null, ctr: null, cpl: null }, social: { cpc: null, ctr: null, cpl: null } };
  function benchWith(id, b) {   // the category benchmark with any of the rep's overrides on top
    var o = EST[id], r = {};
    ["cpc", "ctr", "cpl"].forEach(function (k) { r[k] = o[k] != null ? o[k] : b ? b[k] : null; });
    return r.cpc && r.ctr ? r : null;
  }
  function feeShare(id, amount) {
    if (id === "search") { var t = MGMT.search.filter(function (x) { return amount >= x.min && amount < x.max; })[0]; return t ? t.pct : 0; }
    return MGMT.pct[id] || 0;
  }
  function estimate(id, amount, bench) {
    var out = { impr: null, clicks: null, leads: null, views: null, basis: "none" };
    if (!amount || !CHANNELS[id]) return out;
    if (RETAIL_CPM[id]) {
      out.impr = amount / RETAIL_CPM[id] * 1000; out.basis = "cpm"; out.cpm = RETAIL_CPM[id];
      if (id === "display" || id === "retarget") out.clicks = out.impr * EST.ctr;
      if (id === "ctv") out.views = out.impr * EST.vcr;
      return out;
    }
    var media = amount * (1 - feeShare(id, amount));
    if (BENCH_CPM[id]) { out.impr = media / BENCH_CPM[id] * 1000; out.basis = "bench"; out.cpm = BENCH_CPM[id]; return out; }
    var b = id === "search" ? benchWith("search", bench && bench.search)
          : id === "social" ? benchWith("social", bench && bench.socialTraffic && { cpc: bench.socialTraffic.cpc, ctr: bench.socialTraffic.ctr, cpl: bench.socialLeads && bench.socialLeads.cpl }) : null;
    if (b && id === "search") { out.clicks = media / b.cpc; out.impr = out.clicks / (b.ctr / 100); if (b.cpl) out.leads = media / b.cpl; out.basis = "search"; return out; }
    if (b && id === "social") {
      var cpm = b.cpc * b.ctr / 100 * 1000;
      out.impr = media / cpm * 1000; out.clicks = media / b.cpc; if (b.cpl) out.leads = media / b.cpl; out.basis = "social"; return out;
    }
    return out;
  }

  /* ---------- Editable rates ----------
     A user can change channel minimums and management fees on their own device (saved in this browser only).
     Plans recalculate from the edited values; "Reset to rate card" restores the settings above. */
  var CPM_ALL = {}; Object.keys(RETAIL_CPM).forEach(function (k) { CPM_ALL[k] = RETAIL_CPM; }); Object.keys(BENCH_CPM).forEach(function (k) { CPM_ALL[k] = BENCH_CPM; });
  function cpmNow() { var o = {}; Object.keys(CPM_ALL).forEach(function (k) { o[k] = CPM_ALL[k][k]; }); return o; }
  function estNow() { return JSON.parse(JSON.stringify(EST)); }
  var DEFAULTS = { min: JSON.parse(JSON.stringify(MINIMUMS)), pct: JSON.parse(JSON.stringify(MGMT.pct)), search: MGMT.search.map(function (t) { return t.pct; }), cpm: cpmNow(), est: estNow() };
  var RATE_KEY = "adtaxi-plan-rates-v1", listeners = [];
  function num(v, lo, hi) { v = typeof v === "string" ? parseFloat(v.replace(/[$,%\s]/g, "")) : v; return isFinite(v) && v >= lo && v <= hi ? v : null; }
  function applyRates(o) {
    o = o || {};
    Object.keys(DEFAULTS.min).forEach(function (k) { var v = o.min && num(o.min[k], 0, 1e7); MINIMUMS[k] = v != null ? v : DEFAULTS.min[k]; });
    Object.keys(MGMT.pct).forEach(function (k) { if (!(k in DEFAULTS.pct)) delete MGMT.pct[k]; });
    Object.keys(CHANNELS).forEach(function (k) {
      if (CHANNELS[k].prog || k === "search") return;
      var v = o.pct && o.pct[k] != null ? num(o.pct[k], 0, 0.9) : null;
      if (v != null) MGMT.pct[k] = v; else if (k in DEFAULTS.pct) MGMT.pct[k] = DEFAULTS.pct[k]; else delete MGMT.pct[k];
    });
    MGMT.search.forEach(function (t, i) { var v = o.search && num(o.search[i], 0, 0.9); t.pct = v != null ? v : DEFAULTS.search[i]; });
    Object.keys(CPM_ALL).forEach(function (k) { var v = o.cpm && num(o.cpm[k], 0.01, 1e4); CPM_ALL[k][k] = v != null ? v : DEFAULTS.cpm[k]; });
    var e = o.est || {}, D = DEFAULTS.est;
    var c = num(e.ctr, 0, 1); EST.ctr = c != null ? c : D.ctr;
    var vc = num(e.vcr, 0, 1); EST.vcr = vc != null ? vc : D.vcr;
    ["search", "social"].forEach(function (id) {
      ["cpc", "ctr", "cpl"].forEach(function (k) { var v = e[id] && e[id][k] != null ? num(e[id][k], 0.0001, 1e5) : null; EST[id][k] = v != null ? v : null; });
    });
  }
  function currentRates() { return { min: JSON.parse(JSON.stringify(MINIMUMS)), pct: JSON.parse(JSON.stringify(MGMT.pct)), search: MGMT.search.map(function (t) { return t.pct; }), cpm: cpmNow(), est: estNow() }; }
  function customRates() { return JSON.stringify(currentRates()) !== JSON.stringify(DEFAULTS); }
  function setRates(o) {
    applyRates(o);
    try { if (customRates()) localStorage.setItem(RATE_KEY, JSON.stringify(currentRates())); else localStorage.removeItem(RATE_KEY); } catch (e) {}
    listeners.forEach(function (f) { try { f(); } catch (e) {} });
  }
  function resetRates() { setRates(null); }
  try { var saved = localStorage.getItem(RATE_KEY); if (saved) applyRates(JSON.parse(saved)); } catch (e) {}
  var CUSTOM_NOTE = "Custom rates in use: minimums, management fees or estimate rates were edited on this device.";

  // The editor: a closed panel listing each channel's minimum and fee. onChange runs after every edit and on reset.
  function rateEditor(onChange) {
    if (!document.getElementById("ap-rates-css")) {
      var st = document.createElement("style"); st.id = "ap-rates-css";
      st.textContent = ".ap-rates{border:1px solid #dce4ec;border-radius:10px;padding:10px 14px;background:#fff}" +
        ".ap-rates>summary{cursor:pointer;font-weight:700;color:#0f2742}.ap-rates p{margin:8px 0;font-size:12px;color:#5f7286}" +
        ".ap-rates table{border-collapse:collapse;font-size:13px;width:100%;max-width:720px}.ap-rates th{font-size:12px;color:#5f7286;text-align:right;padding:4px 6px;font-weight:600}" +
        ".ap-rates th:first-child,.ap-rates td:first-child{text-align:left}.ap-rates td{padding:3px 6px;border-top:1px solid #eef2f5;text-align:right;white-space:nowrap}" +
        ".ap-rates input{width:84px;padding:4px 6px;border:1px solid #c9d5e0;border-radius:6px;font:inherit;text-align:right}.ap-rates input.ap-pct{width:56px}" +
        ".ap-rates .ap-edited{background:#fff7db;border-color:#ead58d}.ap-rates button{margin-top:8px;padding:6px 12px;border:1px solid #c9d5e0;border-radius:8px;background:#fff;font:inherit;font-weight:600;color:#0f2742;cursor:pointer}" +
        ".ap-rates .ap-flag{color:#6b5200;font-weight:600}@media print{.ap-rates{display:none!important}}";
      document.head.appendChild(st);
    }
    function E(tag, attrs, kids) {
      var n = document.createElement(tag);
      for (var k in attrs || {}) { if (k === "text") n.textContent = attrs[k]; else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null) n.setAttribute(k, attrs[k]); }
      (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
      return n;
    }
    var box = E("details", { class: "ap-rates" }), flag = E("span", { class: "ap-flag" }), tbody = E("tbody");
    function input(val, isPct, def, save) {
      var shown = val == null ? "" : isPct ? String(Math.round(val * 1000) / 10) : String(Math.round(val));
      var i = E("input", { type: "text", inputmode: "decimal", value: shown, placeholder: isPct ? "none" : "", class: (isPct ? "ap-pct" : "") + (val !== def ? " ap-edited" : ""),
        "aria-label": isPct ? "Management fee percent" : "Monthly minimum in dollars", onchange: function () { save(this.value); } });
      return i;
    }
    // A general input: dec = decimals shown, scale = 100 for a share shown as a percent; blank saves null (benchmark) when allowed
    function field(val, def, dec, scale, label, save, blankOk) {
      var shown = val == null ? "" : String(Math.round(val * (scale || 1) * Math.pow(10, dec)) / Math.pow(10, dec));
      return E("input", { type: "text", inputmode: "decimal", value: shown, placeholder: blankOk ? "auto" : "", class: "ap-pct" + (val !== def ? " ap-edited" : ""), "aria-label": label,
        onchange: function () { var t = String(this.value).trim(); if (t === "" && blankOk) return save(null); var x = num(t, 0, 1e7); save(x == null ? def : x / (scale || 1)); } });
    }
    var ebody = E("tbody");
    function drawEst() {
      var R = currentRates(), D = DEFAULTS.est;
      ebody.innerHTML = "";
      function set(fn) { var o = currentRates(); fn(o.est); setRates(o); }
      ebody.appendChild(E("tr", null, [E("td", { text: "Programmatic display & retargeting (click-through)" }), E("td", { text: "—" }), E("td", null, [field(R.est.ctr, D.ctr, 2, 100, "Display click-through rate percent", function (v) { set(function (e) { e.ctr = v; }); }), "%"]), E("td", { text: "—" })]));
      ebody.appendChild(E("tr", null, [E("td", { text: "CTV / streaming TV (completion)" }), E("td", { text: "—" }), E("td", null, [field(R.est.vcr, D.vcr, 1, 100, "CTV completion rate percent", function (v) { set(function (e) { e.vcr = v; }); }), "%"]), E("td", { text: "—" })]));
      [["search", "Google Search"], ["social", "Meta"]].forEach(function (x) {
        var id = x[0], o = R.est[id];
        ebody.appendChild(E("tr", null, [E("td", { text: x[1] }),
          E("td", null, ["$", field(o.cpc, null, 2, 1, x[1] + " cost per click", function (v) { set(function (e) { e[id].cpc = v; }); }, true)]),
          E("td", null, [field(o.ctr, null, 2, 1, x[1] + " click-through rate percent", function (v) { set(function (e) { e[id].ctr = v; }); }, true), "%"]),
          E("td", null, ["$", field(o.cpl, null, 0, 1, x[1] + " cost per lead", function (v) { set(function (e) { e[id].cpl = v; }); }, true)])]));
      });
    }
    function draw() {
      var R = currentRates();
      tbody.innerHTML = "";
      drawEst();
      Object.keys(CHANNELS).forEach(function (id) {
        var ch = CHANNELS[id], minDef = DEFAULTS.min[id];
        var minCell = id in R.min ? ["$", input(R.min[id], false, minDef, function (v) { var o = currentRates(); o.min[id] = num(v, 0, 1e7) != null ? num(v, 0, 1e7) : minDef; setRates(o); })] : ["—"];
        var feeCell;
        if (ch.prog) feeCell = ["In CPM"];
        else if (id === "search") feeCell = MGMT.search.map(function (t, i) {
          return E("span", null, [i ? " / " : "", input(R.search[i], true, DEFAULTS.search[i], function (v) { var o = currentRates(), x = num(v, 0, 90); o.search[i] = x != null ? x / 100 : DEFAULTS.search[i]; setRates(o); }), "%"]);
        });
        else feeCell = [input(R.pct[id], true, DEFAULTS.pct[id], function (v) { var o = currentRates(), x = String(v).trim() === "" ? null : num(v, 0, 90); if (x == null) delete o.pct[id]; else o.pct[id] = x / 100; setRates(o); }), "%"];
        var cpmCell = id in R.cpm ? ["$", field(R.cpm[id], DEFAULTS.cpm[id], 2, 1, ch.label + " CPM", function (v) { var o = currentRates(); o.cpm[id] = v; setRates(o); })]
                    : [id === "search" || id === "social" ? "Below" : "—"];
        tbody.appendChild(E("tr", null, [E("td", { text: ch.label + (id === "search" ? " (under $3K / $3K+)" : "") + (ch.placeholder ? " (placeholder rates)" : "") }), E("td", null, minCell), E("td", null, feeCell), E("td", null, cpmCell)]));
      });
      flag.textContent = customRates() ? " · custom rates in use" : "";
    }
    box.appendChild(E("summary", null, ["Edit rates", flag]));
    box.appendChild(E("p", { text: "Minimums, fees and programmatic CPMs default to the Adtaxi rate card (Nov 2025); YouTube, TikTok and Snapchat CPMs and the estimate rates below default to industry benchmarks. Changes recalculate the plan and the proposal's targeted impressions right away and are saved on this device only; they don't change anyone else's view. Leave a fee blank for none." }));
    box.appendChild(E("table", null, [E("thead", null, [E("tr", null, [E("th", { text: "Channel" }), E("th", { text: "Monthly minimum" }), E("th", { text: "Management fee" }), E("th", { text: "CPM (for estimates)" })])]), tbody]));
    box.appendChild(E("p", { text: "Estimate rates. Search and Meta set to auto use the WordStream 2026 benchmark for the category; enter your own from campaign results to replace any of them." }));
    box.appendChild(E("table", null, [E("thead", null, [E("tr", null, [E("th", { text: "Platform" }), E("th", { text: "Cost per click" }), E("th", { text: "Click-through / completion rate" }), E("th", { text: "Cost per lead" })])]), ebody]));
    box.appendChild(E("button", { type: "button", text: "Reset to rate card", onclick: function () { resetRates(); } }));
    listeners.push(function () { draw(); if (onChange) onChange(); });
    draw();
    return box;
  }

  /* Page-level channels: a page can add a channel of its own (e.g. LinkedIn on the Franchise analyzer only). Each page
     loads its own copy of this file, so nothing changes on other pages or in the Media Mix Planner.
     x: { channels: { id: {label, short, role, prog, color, job, placeholder (rates not yet confirmed)} }, weights: { strategyId: { id: weight } },
          minimums: { id: $ }, mgmtPct: { id: share }, cpm: { id: benchmark CPM }, tiers: [service tier labels offering it] } */
  function extend(x) {
    if (!x) return;
    Object.keys(x.channels || {}).forEach(function (k) { CHANNELS[k] = x.channels[k]; });
    Object.keys(x.weights || {}).forEach(function (sid) {
      var st = STRATEGIES.filter(function (t) { return t.id === sid; })[0]; if (!st) return;
      Object.keys(x.weights[sid]).forEach(function (k) { st.weights[k] = x.weights[sid][k]; });
    });
    Object.keys(x.minimums || {}).forEach(function (k) { MINIMUMS[k] = DEFAULTS.min[k] = x.minimums[k]; });
    Object.keys(x.mgmtPct || {}).forEach(function (k) { MGMT.pct[k] = DEFAULTS.pct[k] = x.mgmtPct[k]; });
    Object.keys(x.cpm || {}).forEach(function (k) { BENCH_CPM[k] = DEFAULTS.cpm[k] = x.cpm[k]; CPM_ALL[k] = BENCH_CPM; });
    Object.keys(x.channels || {}).forEach(function (k) {
      SERVICE_TIERS.forEach(function (t) { if ((x.tiers || []).indexOf(t.label) >= 0 && t.available.indexOf(k) < 0) t.available.push(k); });
    });
    try { var sv = localStorage.getItem(RATE_KEY); if (sv) applyRates(JSON.parse(sv)); } catch (e) {}   // edits saved on this device still apply
  }

  // Why this many channels. Below the custom-plan level, fewer fully funded channels beat a thin spread; at or above it
  // the plan already has room for several channels and the "custom plan with more channels" note follows, so the
  // "fewer channels" line would contradict it.
  function whyLine(tier, budget) {
    return tier.label + (budget >= CUSTOM_PLAN_BUDGET ? ". Every channel in the plan meets its monthly minimum." : ". Fully funding fewer channels outperforms spreading a budget thin.");
  }
  window.AdtaxiPlan = {
    extend: extend, whyLine: whyLine,
    CHANNELS: CHANNELS, ROLES: ROLES, STRATEGIES: STRATEGIES, MIN_BUDGET: MIN_BUDGET, TIERS: TIERS,
    SERVICE_TIERS: SERVICE_TIERS, CUSTOM_PLAN_BUDGET: CUSTOM_PLAN_BUDGET, FEES: FEES,
    serviceTier: serviceTier, minFor: minFor, buildPlan: buildPlan, fixedBudget: fixedBudget, applyFees: applyFees, termNote: termNote,
    MGMT: MGMT, channelFee: channelFee, feeSummary: feeSummary, feeLine: feeLine,
    RETAIL_CPM: RETAIL_CPM, BENCH_CPM: BENCH_CPM, EST: EST, estimate: estimate,
    rateEditor: rateEditor, setRates: setRates, resetRates: resetRates, customRates: customRates, CUSTOM_NOTE: CUSTOM_NOTE
  };
})();
