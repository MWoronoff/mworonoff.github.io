/* Slides panel: category slides (market, then media use) and platform guides (trend, then by demographic).
   Opened from the ad response panel and from Recommended allocation. The plan's platforms come first; with no plan,
   platforms follow the ad response ranking. Images and PDFs are in shared/slides (Nielsen Scarborough USA+ Spring 2026). */
(function () {
  var BASE = (function () { var s = document.currentScript && document.currentScript.src; return s ? s.replace(/slides\.js.*$/, "slides/") : "../shared/slides/"; })();
  // Analyzer -> category slides
  var CATS = {
    auto:        { id: "auto", name: "Auto", title: "U.S. Automotive" },
    "higher-ed": { id: "education", name: "Education", title: "U.S. Education" },
    financial:   { id: "finance", name: "Finance", title: "U.S. Finance" },
    furniture:   { id: "furniture", name: "Furniture", title: "U.S. Furniture and Mattress" },
    healthcare:  { id: "healthcare", name: "Healthcare", title: "U.S. Healthcare" }
  };
  var PLATFORMS = [
    { id: "streaming-tv", name: "Streaming TV", line: "Who streams TV and video, and how often" },
    { id: "ctv", name: "Connected TV", line: "Households with a CTV device, compared with cable" },
    { id: "social", name: "Social", line: "Social media reach by age, sex and income" },
    { id: "search", name: "Search", line: "Search engine reach by age, sex and income" },
    { id: "streaming-audio", name: "Streaming audio", line: "Audio streaming reach and digital audio ad spend" },
    { id: "ecommerce", name: "Ecommerce", line: "Who shops online, and retail digital ad spend" }
  ];
  // Plan channels (shared/media-plan.js) and ad response types -> platform guides
  var FROM_CHANNEL = { ctv: ["streaming-tv", "ctv"], youtube: ["streaming-tv"], social: ["social"], tiktok: ["social"], snapchat: ["social"],
                       audio: ["streaming-audio"], search: ["search"], shopping: ["ecommerce", "search"] };
  var FROM_AD = { "Streaming TV": ["streaming-tv", "ctv"], "Pre-roll": ["streaming-tv"], "Social": ["social"], "Search": ["search"],
                  "Podcast": ["streaming-audio"], "Radio": ["streaming-audio"] };
  var RETAIL = ["auto", "furniture"];

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "text") n.textContent = attrs[k]; else if (k === "onclick") n.onclick = attrs[k]; else if (attrs[k] != null) n.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function slide(file, label) {
    return el("figure", { class: "az-slide" }, [
      el("a", { href: BASE + file + ".png", target: "_blank", rel: "noopener", title: "Open full size" },
        [el("img", { src: BASE + file + ".png", alt: label, loading: "lazy" })]),
      el("figcaption", null, [el("span", { text: label }), el("a", { href: BASE + file + ".pdf", download: file + ".pdf", text: "Download PDF" })])]);
  }
  function platform(p, open) {
    return el("details", { class: "az-slide-pf", open: open ? "" : null }, [
      el("summary", null, [el("b", { text: p.name }), el("span", { text: p.line })]),
      slide(p.id + "-trend", p.name + ": monthly reach and growth"),
      slide(p.id + "-demo", p.name + ": by demographic")]);
  }
  function cat(key) { return CATS[key === "furniture-analyzer" ? "furniture" : key] || null; }

  window.AdtaxiSlides = {
    has: function (key) { return !!cat(key); },
    label: function (key) { var c = cat(key); return c ? c.name + " slides" : "Platform guides"; },
    // o: { cat, only: "category" | "platforms", plan: [channel ids], strategy, adOrder: [ad response short names, best first], channels, close }
    render: function (body, o) {
      body.innerHTML = "";
      var c = o.only === "platforms" ? null : cat(o.cat), CH = o.channels || {}, plan = o.plan || [];
      var sub = plan.length ? "Plan: " + plan.map(function (id) { return CH[id] ? CH[id].short : id; }).join(", ") : "";
      body.appendChild(el("div", { class: "az-results-head" }, [
        el("div", null, [el("h2", { id: "az-slides-title", text: o.only === "category" && c ? c.name + " slides" : "Platform guides" }), sub && o.only !== "category" ? el("p", { class: "az-results-sub", text: sub }) : null]),
        el("button", { type: "button", class: "az-modal-close", "aria-label": "Close", text: "×", onclick: o.close })]));
      if (c) body.appendChild(el("section", { class: "az-results-sec" }, [el("h3", { text: c.title }),
        slide(c.id + "-market", c.name + ": market size and buyers"), slide(c.id + "-media", c.name + ": how buyers use media")]));
      if (o.only === "category") { body.appendChild(el("p", { class: "az-results-note", text: "Source: Nielsen Scarborough USA+ Spring 2026 and AdMall. National figures. Select a slide to open it full size." })); return; }
      // Platforms tied to the plan first, then (no plan) the ad response ranking, then the rest
      var first = [], add = function (ids) { (ids || []).forEach(function (id) { if (first.indexOf(id) < 0) first.push(id); }); };
      plan.forEach(function (id) { add(FROM_CHANNEL[id]); });
      if (o.strategy === "online" || RETAIL.indexOf(o.cat === "furniture-analyzer" ? "furniture" : o.cat) >= 0) { if (plan.length) add(["ecommerce"]); }
      var inPlan = first.slice();
      if (!plan.length) (o.adOrder || []).forEach(function (t) { add(FROM_AD[t]); });
      var byId = {}; PLATFORMS.forEach(function (p) { byId[p.id] = p; });
      var rest = PLATFORMS.filter(function (p) { return first.indexOf(p.id) < 0; });
      if (inPlan.length) body.appendChild(el("section", { class: "az-results-sec" }, [el("h3", { text: "Platforms in your plan" })]
        .concat(inPlan.map(function (id, i) { return platform(byId[id], i === 0); }))));
      var others = (inPlan.length ? [] : first.map(function (id) { return byId[id]; })).concat(rest);
      body.appendChild(el("section", { class: "az-results-sec" }, [el("h3", { text: inPlan.length ? "Other platforms" : "Platform guides" })]
        .concat(others.map(function (p, i) { return platform(p, !inPlan.length && i === 0); }))));
      body.appendChild(el("p", { class: "az-results-note", text: "Source: Nielsen Scarborough USA+ Spring 2026; ad spend from EMARKETER. National figures. Select a slide to open it full size." }));
    }
  };

  // One shared side panel for every page
  var dlg = null, bodyEl = null;
  window.AdtaxiSlides.open = function (o) {
    if (!dlg) {
      bodyEl = el("div", { class: "az-results-body" });
      dlg = el("dialog", { class: "az-results az-slides", "aria-labelledby": "az-slides-title" }, [bodyEl]);
      dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
      document.body.appendChild(dlg);
    }
    o.close = function () { dlg.close(); };
    window.AdtaxiSlides.render(bodyEl, o);
    if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
    bodyEl.scrollTop = 0;
  };
})();
