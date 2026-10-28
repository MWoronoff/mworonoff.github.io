/* Adtaxi case studies for the Results button in every Trade area's Recommended allocation and the Media Mix Planner.

   Each entry:
     client    who it was for (as the case study names them)
     headline  one line, the strongest number(s) from the case study
     cats      analyzer categories it belongs to (healthcare, legal, higher-ed, home-services, apartment,
               auto, financial, furniture, franchise); [] for general examples
     channels  plan channel ids it used (same ids as shared/media-plan.js: ctv, youtube, dooh, social,
               display, audio, search, shopping, tiktok, snapchat, retarget)
     related   optional: other categories it fits on audience or business, each { cat, why }; "why" is shown on the card
     group     optional: entries with the same group are near-duplicates; only the first one shown is listed
     file      the PDF in shared/results/
     date      YYMM from the case study's file name (newer ones are listed first on ties)

   To add one: put the PDF in shared/results/ and add an entry below. Only add materials cleared for clients. */
(function () {
  var ITEMS = [
    { client: "Multi-location furniture retailer", headline: "32% lower cost per store visit and 28% higher ROAS, measured on in-store sales",
      cats: ["furniture"], channels: ["social", "display", "search", "ctv"], related: [{ cat: "auto", why: "Same purchase path: shoppers research online and buy in store, measured on store visits." }], file: "furniture-offline-attribution-2609.pdf", date: 2609 },
    { client: "Regional appliance, furniture & mattress chain", headline: "39% more in-store purchases and 59% more in-store revenue from customer data",
      cats: ["furniture"], channels: ["social", "display", "search"], file: "furniture-crm-data-activation-2302.pdf", date: 2302 },
    { client: "NapQueen (mattresses, online)", headline: "1,257% growth in direct-to-consumer revenue",
      cats: ["furniture"], channels: ["search", "shopping", "social", "display", "ctv"], file: "furniture-napqueen-dtc-2408.pdf", date: 2408 },
    { client: "Marysville Toyota", headline: "41% sales growth across new, used and CPO; 120% better ROI",
      cats: ["auto"], channels: ["search", "shopping", "ctv", "youtube", "display", "social"], file: "auto-marysville-toyota-2511.pdf", date: 2511 },
    { client: "Kia of Irvine", headline: "100% more phone calls and 28% more search traffic after adding DOOH",
      cats: ["auto"], channels: ["dooh", "search"], related: [{ cat: "furniture", why: "Same purchase path: shoppers research online and buy in store, measured on store visits." }], file: "auto-kia-irvine-dooh-2407.pdf", date: 2407 },
    { client: "Prince George's Community College", headline: "27,867 completed applications at $10.74 each",
      cats: ["higher-ed"], channels: ["ctv", "display", "social", "tiktok", "search"], related: [{ cat: "apartment", why: "Same audience: it reached prospective college students, the renters the Student housing profile is built around." }], file: "higher-ed-pgcc-omnichannel-2508.pdf", date: 2508 },
    { client: "Higher-education institution", headline: "30% more organic search traffic after adding display to CTV",
      cats: ["higher-ed"], channels: ["ctv", "display", "retarget"], file: "higher-ed-ctv-2209.pdf", date: 2209 },
    { client: "Home services company", headline: "5x the leads at the same spend; 80% lower cost per lead",
      cats: ["home-services"], channels: ["search", "social"], related: [{ cat: "legal", why: "Same business model: lead generation measured in cost per lead and lead volume." }], file: "home-services-search-social-2503.pdf", date: 2503 },
    { client: "Southeast windows & doors company", headline: "125% more branded search clicks; revenue 24% over goal",
      cats: ["home-services"], channels: ["display", "ctv", "social", "search"], related: [{ cat: "furniture", why: "Same audience: homeowners researching a big-ticket upgrade for their home." }], file: "home-services-windows-doors-omnichannel-2511.pdf", date: 2511 },
    { client: "L.A. liposuction clinic", headline: "408% more form fills; 23% lower cost per lead",
      cats: ["healthcare"], channels: ["search"], related: [{ cat: "legal", why: "Same business model: search-driven lead generation measured in form fills, calls and cost per lead." }], file: "healthcare-liposuction-search-2202.pdf", date: 2202 },
    { client: "13,000-unit apartment community", headline: "Occupancy up from 79% to 95%; 163% more leads",
      cats: ["apartment"], channels: ["search", "display"], file: "apartment-occupancy-google-ads-2211.pdf", date: 2211 },
    { client: "USA Kilts", headline: "11.85x ROAS (48% over goal); $536.7K revenue",
      cats: [], channels: ["tiktok", "social", "display"], file: "ecommerce-usa-kilts-social-2601.pdf", date: 2601 },
    { client: "Amusement park & hotel resort", headline: "1,310% average ROAS over 9 seasonal campaigns",
      cats: [], channels: ["ctv", "display", "social"], file: "attractions-hotel-omnichannel-2503.pdf", date: 2503 },
    { client: "Motorcycle parts maker (online)", headline: "62.8% higher ROAS; 46.9% more purchase revenue",
      cats: [], channels: ["social", "retarget"], group: "meta-advantage", file: "ecommerce-motorcycle-parts-meta-2403.pdf", date: 2403 },
    { client: "Eco-fashion brand (online)", headline: "62% higher ROAS; 102% more purchase revenue",
      cats: [], channels: ["social", "retarget"], group: "meta-advantage", file: "ecommerce-fashion-meta-2402.pdf", date: 2402 },
    { client: "Hotel management company", headline: "12x ROAS; 30% more revenue from call-in bookings",
      cats: [], channels: ["search"], related: [{ cat: "apartment", why: "Same problem: filling units with direct bookings instead of relying on third-party sites, as apartments do with listing sites." }], file: "hospitality-hotel-search-2209.pdf", date: 2209 },
    { client: "Nonprofit", headline: "$3.4M in donations in 5 weeks",
      cats: [], channels: ["display", "social", "youtube", "retarget"], file: "nonprofit-programmatic-2209.pdf", date: 2209 },
    { client: "Health system (nurse hiring)", headline: "4,000+ conversions for a nursing hiring event",
      cats: [], channels: ["display"], file: "recruitment-nurse-hiring-programmatic-2206.pdf", date: 2206 },
    { client: "Online pet supply retailer", headline: "Peak ROAS of 1,633% on 50% less ad spend",
      cats: [], channels: ["shopping", "search"], file: "ecommerce-pet-supply-shopping-2202.pdf", date: 2202 },
    { client: "National CBD brand", headline: "2x revenue; brand share from 19th to 3rd",
      cats: [], channels: ["display", "social", "youtube", "retarget"], file: "ecommerce-cbd-programmatic-2202.pdf", date: 2202 }
  ];

  // Category matches first, then other case studies by how many of the plan's channels they share.
  function match(cat, planChannels) {
    var plan = planChannels || [], seen = {};
    function shared(it) { return it.channels.filter(function (c) { return plan.indexOf(c) >= 0; }); }
    function keep(it) { if (it.group) { if (seen[it.group]) return false; seen[it.group] = true; } return true; }
    // Order: most plan channels used, then the case study built mostly on those channels, then newest
    function order(a, b) { var sa = shared(a).length, sb = shared(b).length;
      return sb - sa || sb / b.channels.length - sa / a.channels.length || b.date - a.date; }
    var inCat = ITEMS.filter(function (it) { return cat && it.cats.indexOf(cat) >= 0; })
      .sort(order).filter(keep)
      .map(function (it) { return { item: it, shared: shared(it) }; });
    function relFor(it) { return cat && it.related ? it.related.filter(function (r) { return r.cat === cat; })[0] : null; }
    var related = ITEMS.filter(function (it) { return !(cat && it.cats.indexOf(cat) >= 0) && relFor(it); })
      .sort(order).filter(keep)
      .map(function (it) { return { item: it, shared: shared(it), why: relFor(it).why }; });
    var byChannel = ITEMS.filter(function (it) { return !(cat && it.cats.indexOf(cat) >= 0) && !relFor(it) && shared(it).length; })
      .sort(order).filter(keep)
      .map(function (it) { return { item: it, shared: shared(it) }; });
    return { inCat: inCat, related: related, byChannel: byChannel };
  }

  var CATS = { healthcare: "Healthcare", legal: "Legal", "higher-ed": "Higher Education", "home-services": "Home Services",
    apartment: "Apartments", apartments: "Apartments", auto: "Auto", financial: "Financial", furniture: "Furniture", franchise: "Franchise" };
  var BASE = "../shared/results/";

  // The Results panel, shared by every Trade area's Recommended allocation and the Media Mix Planner.
  // o: { cat, subLabel, plan: [channel ids], channels: AdtaxiPlan.CHANNELS, close: fn }
  // Category matches first, then related ones (same audience or business, with the reason), then other case studies
  // that used the most of the plan's channels. Four show and up to four more are behind "Show more".
  function render(body, o) {
    function el(tag, attrs, kids) {
      var n = document.createElement(tag);
      for (var k in attrs || {}) { if (k === "text") n.textContent = attrs[k]; else if (k === "onclick") n.onclick = attrs[k]; else if (attrs[k] != null) n.setAttribute(k, attrs[k]); }
      (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
      return n;
    }
    body.innerHTML = "";
    var cat = o.cat === "apartments" ? "apartment" : o.cat, plan = o.plan || [], CH = o.channels || {};
    if (!CATS[cat]) cat = "";
    var short = function (id) { return CH[id] ? CH[id].short : id; };
    var sub = [cat ? CATS[cat] + (o.subLabel ? " \u00b7 " + o.subLabel : "") : "", plan.length ? "Plan: " + plan.map(short).join(", ") : ""]
      .filter(Boolean).join(" \u2014 ");
    body.appendChild(el("div", { class: "az-results-head" }, [
      el("div", null, [el("h2", { id: "az-results-title", text: "Results" }), sub ? el("p", { class: "az-results-sub", text: sub }) : null]),
      el("button", { type: "button", class: "az-modal-close", "aria-label": "Close", text: "\u00d7", onclick: o.close })]));
    var M = match(cat, plan), shown = 0, LIMIT = 4, MAX = 8, more = [];
    var byCh = plan.length ? M.byChannel.slice(0, Math.max(0, MAX - M.inCat.length - M.related.length)) : [];   // the strongest matches only
    function card(m) {
      var it = m.item, chips = el("p", { class: "az-results-ch" });
      it.channels.forEach(function (c, i) {
        if (i) chips.appendChild(document.createTextNode(" \u00b7 "));
        chips.appendChild(m.shared.indexOf(c) >= 0 ? el("b", { text: short(c) }) : el("span", { text: short(c) }));
      });
      return el("article", { class: "az-results-card" }, [el("h4", { text: it.client }), el("p", { text: it.headline }),
        m.why ? el("p", { class: "az-results-why", text: m.why }) : null, chips,
        el("a", { href: BASE + it.file, target: "_blank", rel: "noopener", text: "Open the case study" })]);
    }
    function section(title, list) {
      if (!list.length) return;
      var sec = el("section", { class: "az-results-sec" }, [el("h3", { text: title })]), vis = 0;
      list.forEach(function (m) { var c = card(m); if (shown >= LIMIT) { c.hidden = true; more.push(c); } else vis++; shown++; sec.appendChild(c); });
      if (!vis) { sec.hidden = true; more.push(sec); }
      body.appendChild(sec);
    }
    section("In your category", M.inCat);
    section("Related: same audience or business", M.related);
    section("Same channels as your plan", byCh);
    if (more.length) {
      var btn = el("button", { type: "button", class: "az-btn", text: "Show more (" + more.filter(function (x) { return x.tagName === "ARTICLE"; }).length + ")",
        onclick: function () { more.forEach(function (c) { c.hidden = false; }); btn.remove(); } });
      body.appendChild(btn);
    }
    if (!plan.length) body.appendChild(el("p", { class: "az-results-note", text: "Choose a media strategy to also see case studies that used the same channels as the plan." }));
    else if (!shown) body.appendChild(el("p", { class: "az-results-note", text: "No case studies match this plan's channels yet." }));
    body.appendChild(el("p", { class: "az-results-note", text: "Channels in bold are in the plan. Results are from the client named in each case study, not a forecast for this business." }));
  }

  // True when the category has case studies of its own or related ones; the Results button shows only then
  function has(cat) { cat = cat === "apartments" ? "apartment" : cat;
    return !!cat && ITEMS.some(function (it) { return it.cats.indexOf(cat) >= 0 || (it.related || []).some(function (r) { return r.cat === cat; }); }); }

  window.AdtaxiResults = { ITEMS: ITEMS, match: match, render: render, has: has, base: BASE };
})();
