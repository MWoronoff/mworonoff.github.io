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

  var MIN_BUDGET = 1000;
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

  /* BUDGETS ARE GROSS: per the Adtaxi rate card, the client's budget includes Adtaxi's management (social, search and
     YouTube carry a fee taken from the budget; programmatic is priced by CPM with the margin built in). So every amount
     shown is the client's total investment by channel. No rates are published here: this repo is public.
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
    offNote: "Amounts are total monthly investment by channel, including Adtaxi management."
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

  /* One channel's fee: { kind: "fee", pct, fee, media } | { kind: "cpm" } | { kind: "none" } */
  function channelFee(id, dollars) {
    var ch = CHANNELS[id];
    if (!ch || dollars == null) return { kind: "none" };
    if (ch.prog) return { kind: "cpm" };
    var pct = MGMT.pct[id];
    if (id === "search") pct = MGMT.search.filter(function (t) { return dollars >= t.min && dollars < t.max; })[0].pct;
    if (pct == null) return { kind: "none" };
    var fee = Math.round(dollars * pct);
    return { kind: "fee", pct: pct, fee: fee, media: dollars - fee };
  }
  /* Plan totals: fees and media for fee-based channels, and the programmatic amount (management in CPM) */
  function feeSummary(items) {
    var out = { fee: 0, media: 0, feeBased: 0, cpm: 0, none: 0, total: 0 };
    items.forEach(function (r) {
      var d = r.dollars; if (d == null) return;
      var f = channelFee(r.id, d); out.total += d;
      if (f.kind === "fee") { out.fee += f.fee; out.media += f.media; out.feeBased += d; }
      else if (f.kind === "cpm") out.cpm += d; else out.none += d;
    });
    return out;
  }
  function feeLine(f) {
    if (f.kind === "fee") return "Media $" + Math.round(f.media).toLocaleString("en-US") + " · management fee $" + Math.round(f.fee).toLocaleString("en-US") + " (" + Math.round(f.pct * 100) + "%)";
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
  function buildPlan(s, budget, tierBudget) {
    var tb = tierBudget || budget;
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

  window.AdtaxiPlan = {
    CHANNELS: CHANNELS, ROLES: ROLES, STRATEGIES: STRATEGIES, MIN_BUDGET: MIN_BUDGET, TIERS: TIERS,
    SERVICE_TIERS: SERVICE_TIERS, CUSTOM_PLAN_BUDGET: CUSTOM_PLAN_BUDGET, FEES: FEES,
    serviceTier: serviceTier, minFor: minFor, buildPlan: buildPlan, applyFees: applyFees, termNote: termNote,
    MGMT: MGMT, channelFee: channelFee, feeSummary: feeSummary, feeLine: feeLine
  };
})();
