/* Adtaxi proposal: a 2-slide, editable PowerPoint built in the browser from a Trade area and its Recommended allocation.
   Slide 1  Your trade area: map, prospects, index, top ZIPs, local competitors (typed by the rep).
   Slide 2  Recommended monthly investment & targeted impressions: each platform with its investment (management
            included), why it's recommended (ad response, audience concentration, its role) and estimated delivery,
            after a package summary (investment, targeted impressions, reach and frequency, average CPM, clicks, leads);
            then the goal.
   Uses PptxGenJS (loaded on demand). window.AdtaxiProposal.build(ctx) returns a Promise that resolves when the file
   is saved. ctx is assembled by shared/radius.js. */
(function () {
  var C = { black: "1A1A1A", teal: "0F7E70", mint: "D9F2EE", orange: "F7941D", gray: "4D4D4D", light: "EDEDED",
            ink: "222222", muted: "5F7286", line: "D0D7DE", white: "FFFFFF", band: "F4F6F8" };
  var FONT = "Arial";
  var nf = function (x) { return Math.round(x).toLocaleString("en-US"); };
  var money = function (x) { return "$" + nf(x); };
  function approx(x, step) {
    if (x == null || !isFinite(x)) return null;
    step = step || (x >= 100000 ? 1000 : x >= 10000 ? 100 : x >= 1000 ? 10 : 1);
    return "~" + nf(Math.round(x / step) * step);
  }

  function frame(pres, slide, ctx, n) {
    slide.background = { color: C.white };
    slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0.18, w: 10, h: 0.62, fill: { color: C.black }, line: { color: C.black } });
    slide.addShape(pres.shapes.RECTANGLE, { x: 0.35, y: 0.31, w: 0.08, h: 0.36, fill: { color: C.teal }, line: { color: C.teal } });
    slide.addText(ctx.client + (ctx.placeShort ? ": " + ctx.placeShort : ""), { x: 0.58, y: 0.18, w: 7.6, h: 0.62, fontFace: FONT, fontSize: 16, color: C.white, valign: "middle", margin: 0, isTextBox: true });
    if (ctx.logoPng) slide.addImage({ data: ctx.logoPng, x: 9.05, y: 0.1, w: 0.78, h: 0.78 });
    slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 7.02, w: 10, h: 0.38, fill: { color: C.light }, line: { color: C.light } });
    slide.addShape(pres.shapes.RECTANGLE, { x: 0.35, y: 7.06, w: 1.55, h: 0.3, fill: { color: "333333" }, line: { color: "333333" } });
    slide.addText("CONFIDENTIAL", { x: 0.35, y: 7.06, w: 1.55, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: C.white, align: "center", valign: "middle", margin: 0, isTextBox: true });
    slide.addText([{ text: "ADTAXI: ", options: { bold: true, color: C.teal } }, { text: "Solving your most complex marketing challenges", options: { color: C.ink } }],
      { x: 2.05, y: 7.06, w: 6.5, h: 0.3, fontFace: FONT, fontSize: 9, valign: "middle", margin: 0, isTextBox: true });
    slide.addText(String(n), { x: 9.2, y: 7.06, w: 0.45, h: 0.3, fontFace: FONT, fontSize: 11, color: C.ink, align: "right", valign: "middle", margin: 0, isTextBox: true });
  }

  function slideMarket(pres, ctx) {
    var s = pres.addSlide();
    frame(pres, s, ctx, 1);
    s.addText("Your Trade Area", { x: 0.4, y: 0.98, w: 9.2, h: 0.45, fontFace: FONT, fontSize: 22, bold: true, color: C.ink, margin: 0, isTextBox: true });
    s.addText(ctx.place, { x: 0.4, y: 1.42, w: 9.2, h: 0.3, fontFace: FONT, fontSize: 11, color: C.muted, margin: 0, isTextBox: true });
    if (ctx.mapPng) {
      s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 1.85, w: 5.4, h: 4.05, fill: { color: C.white }, line: { color: C.line, width: 0.75 } });
      s.addImage({ data: ctx.mapPng, x: 0.42, y: 1.87, w: 5.36, h: 4.01 });
    }
    s.addText(ctx.mapCaption, { x: 0.4, y: 5.95, w: 5.4, h: 0.5, fontFace: FONT, fontSize: 9, color: C.muted, margin: 0, valign: "top", isTextBox: true });

    // Right column: audience stats, top ZIPs, competitors
    var X = 6.05, W = 3.55;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: X, y: 1.85, w: W, h: 1.12, fill: { color: C.mint }, line: { color: C.mint }, rectRadius: 0.08 });
    s.addText(nf(ctx.stats.aud), { x: X + 0.15, y: 1.9, w: W - 0.3, h: 0.55, fontFace: FONT, fontSize: 26, bold: true, color: C.teal, margin: 0, isTextBox: true });
    s.addText("estimated " + ctx.audienceNoun + " in the trade area", { x: X + 0.15, y: 2.45, w: W - 0.3, h: 0.45, fontFace: FONT, fontSize: 10, color: C.ink, margin: 0, valign: "top", isTextBox: true });
    var half = (W - 0.15) / 2;
    [[ctx.stats.idx == null ? "—" : nf(ctx.stats.idx), "Index vs. U.S. (100 = average)"], [nf(ctx.stats.zips), "ZIPs in the trade area"]].forEach(function (st, i) {
      var x = X + i * (half + 0.15);
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x, y: 3.07, w: half, h: 0.82, fill: { color: C.band }, line: { color: C.band }, rectRadius: 0.06 });
      s.addText(st[0], { x: x + 0.1, y: 3.1, w: half - 0.2, h: 0.4, fontFace: FONT, fontSize: 18, bold: true, color: C.ink, margin: 0, isTextBox: true });
      s.addText(st[1], { x: x + 0.1, y: 3.48, w: half - 0.2, h: 0.38, fontFace: FONT, fontSize: 8.5, color: C.muted, margin: 0, valign: "top", isTextBox: true });
    });
    s.addText((ctx.topTitle || "Highest-concentration ZIPs") + (ctx.topTown ? ", all in " + ctx.topTown : ""), { x: X, y: 4.02, w: W, h: 0.28, fontFace: FONT, fontSize: 11, bold: true, color: C.ink, margin: 0, isTextBox: true });
    var hdr = { bold: true, color: C.white, fill: { color: C.gray }, fontSize: 8.5 };
    // When every top ZIP is in the same town, the town goes in the heading and the column shows population instead
    var townCol = !ctx.topTown;
    var rows = [[{ text: "ZIP", options: hdr }, { text: townCol ? "Town" : "Population", options: townCol ? hdr : Object.assign({ align: "right" }, hdr) }, { text: ctx.audCol || "Likely customers", options: Object.assign({ align: "right" }, hdr) }, { text: "Index", options: Object.assign({ align: "right" }, hdr) }]];
    ctx.topZips.slice(0, 5).forEach(function (z) {
      rows.push([z.zip, townCol ? z.town : { text: nf(z.pop || 0), options: { align: "right" } }, { text: nf(z.aud), options: { align: "right" } }, { text: z.idx == null ? "—" : nf(z.idx), options: { align: "right" } }]);
    });
    s.addTable(rows, { x: X, y: 4.32, w: W, colW: [0.6, 1.5, 0.85, 0.6], fontFace: FONT, fontSize: 8.5, color: C.ink, border: { type: "solid", pt: 0.5, color: C.line }, rowH: 0.24, margin: [0.02, 0.05, 0.02, 0.05] });
    if (ctx.competitors.length) {
      var y = 4.32 + 0.24 * rows.length + 0.15, n = Math.min(5, ctx.competitors.length);
      s.addText("Local competitors", { x: X, y: y, w: W, h: 0.26, fontFace: FONT, fontSize: 11, bold: true, color: C.ink, margin: 0, isTextBox: true });
      s.addText(ctx.competitors.slice(0, n).map(function (c, i) { return { text: c, options: { bullet: { indent: 10 }, breakLine: i < n - 1 } }; }),
        { x: X, y: y + 0.28, w: W, h: Math.min(6.9 - y - 0.3, 0.2 * n + 0.1), fontFace: FONT, fontSize: 9, color: C.ink, margin: 0, valign: "top", paraSpaceAfter: 1, isTextBox: true });
    }
  }

  // Package totals: impressions, clicks and leads add up over the platforms that have an estimate;
  // the averages divide those platforms' investment by their delivery (so a platform without an estimate doesn't skew them).
  function totals(plan) {
    var t = { impr: 0, clicks: 0, leads: 0, views: 0, $impr: 0, $clicks: 0, $leads: 0, nImpr: 0, n: plan.length };
    plan.forEach(function (p) {
      var e = p.est;
      if (e.impr != null) { t.impr += e.impr; t.$impr += p.amount; t.nImpr++; }
      if (e.clicks != null) { t.clicks += e.clicks; t.$clicks += p.amount; }
      if (e.leads != null) { t.leads += e.leads; t.$leads += p.amount; }
      if (e.views != null) t.views += e.views;
    });
    t.cpm = t.impr ? t.$impr / t.impr * 1000 : null;
    t.cpc = t.clicks ? t.$clicks / t.clicks : null;
    t.cpl = t.leads ? t.$leads / t.leads : null;
    return t;
  }
  // Reach and frequency for the whole plan (not by platform: the same people overlap across channels). Modeled, not
  // measured: ON_TARGET of targeted impressions land on the audience in the targeted ZIPs; reach follows a standard
  // saturation curve, reach = MAX x (1 - e^(-OTS / K)), where OTS is on-target impressions per person, so it levels off
  // as frequency builds instead of passing the audience size. Average frequency = on-target impressions / people reached.
  var RF = { ON_TARGET: 0.70, MAX: 0.85, K: 3 };
  function reachFreq(impr, aud) {
    if (!impr || !aud || aud <= 0) return null;
    var on = impr * RF.ON_TARGET, ots = on / aud, share = RF.MAX * (1 - Math.exp(-ots / RF.K));
    var reach = share * aud;
    return reach >= 1 ? { reach: reach, share: share, freq: on / reach } : null;
  }
  var money2 = function (x) { return "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  function slideInvestment(pres, ctx) {
    var s = pres.addSlide();
    frame(pres, s, ctx, 2);
    s.addText("Recommended Monthly Investment & Targeted Impressions", { x: 0.4, y: 0.98, w: 9.2, h: 0.45, fontFace: FONT, fontSize: 19, bold: true, color: C.ink, margin: 0, isTextBox: true });
    s.addText(ctx.strategy.label + " · " + money(ctx.total) + " a month · investment includes Adtaxi management", { x: 0.4, y: 1.42, w: 9.2, h: 0.3, fontFace: FONT, fontSize: 11, color: C.muted, margin: 0, isTextBox: true });

    // Package summary: one row of tiles
    var T = totals(ctx.plan), partial = T.nImpr && T.nImpr < T.n;
    var R = reachFreq(T.impr, ctx.stats.planAud || ctx.stats.aud);
    var tiles = [
      [money(ctx.total), "Monthly investment", money(ctx.total * 3) + " for the first 3 months"],
      [T.impr ? approx(T.impr) : "—", "Targeted impressions", T.impr ? approx(T.impr * 3) + " over 3 months" + (T.views ? "\n" + approx(T.views) + " completed CTV views" : "") : "Estimate on request"],
      [R ? approx(R.reach) : "—", "Est. monthly reach", R ? Math.round(R.share * 100) + "% of the audience, about " + (Math.round(R.freq * 10) / 10) + " times each" + (partial ? " (platforms with an estimate)" : "") : "Estimate on request"],
      [T.cpm != null ? money2(T.cpm) : "—", "Average CPM", partial ? "On platforms with an estimate" : "Investment per 1,000 targeted impressions"],
      [T.clicks ? approx(T.clicks) : "—", "Est. clicks", T.cpc != null ? money2(T.cpc) + " average cost per click" : ""],
      [T.leads ? approx(T.leads) : "—", "Est. leads", "Search & Meta" + (T.cpl != null ? ", " + money(T.cpl) + " average cost per lead" : "")]
    ];
    var gap = 0.1, tw = (9.2 - gap * (tiles.length - 1)) / tiles.length, ty = 1.82, th = 0.95;
    s.addText("PACKAGE SUMMARY", { x: 0.4, y: ty, w: 4, h: 0.22, fontFace: FONT, fontSize: 8.5, bold: true, color: C.teal, charSpacing: 1, margin: 0, isTextBox: true });
    ty += 0.25;
    tiles.forEach(function (t, i) {
      var x = 0.4 + i * (tw + gap), first = i === 0;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x, y: ty, w: tw, h: th, fill: { color: first ? C.teal : C.mint }, line: { color: first ? C.teal : C.mint }, rectRadius: 0.06 });
      s.addText(t[0], { x: x + 0.08, y: ty + 0.06, w: tw - 0.16, h: 0.38, fontFace: FONT, fontSize: tiles.length > 5 ? 15 : 17, bold: true, color: first ? C.white : C.teal, margin: 0, isTextBox: true });
      s.addText(t[1], { x: x + 0.08, y: ty + 0.44, w: tw - 0.16, h: 0.2, fontFace: FONT, fontSize: 8.5, bold: true, color: first ? C.white : C.ink, margin: 0, isTextBox: true });
      if (t[2]) s.addText(t[2], { x: x + 0.08, y: ty + 0.64, w: tw - 0.16, h: 0.27, fontFace: FONT, fontSize: 7.5, color: first ? C.mint : C.muted, margin: 0, valign: "top", isTextBox: true });
    });

    // Platform table
    var H = { bold: true, color: C.white, fill: { color: C.orange }, fontSize: 9.5, valign: "middle" };
    var rows = [[{ text: "Platform", options: H }, { text: "Monthly investment", options: Object.assign({ align: "right" }, H) }, { text: "Why this platform", options: H },
                 { text: "Targeted impressions", options: Object.assign({ align: "right" }, H) }, { text: "Est. results", options: Object.assign({ align: "right" }, H) }]];
    var many = ctx.plan.length > 2, rFont = many ? 7.5 : 8.5, rowsH = 0.42;
    ctx.plan.forEach(function (p) {
      var e = p.est, cl = [];
      if (e.clicks != null) cl.push(approx(e.clicks) + " clicks");
      if (e.leads != null) cl.push(approx(e.leads) + " leads");
      if (e.views != null) cl.push(approx(e.views) + " completed views");
      var why = (many ? p.reasons.slice(0, 2) : p.reasons).join(" ");
      // PowerPoint sizes rows to their text; estimate the height so the Goal row sits just under the table
      rowsH += Math.max(0.5, Math.ceil(why.length / (rFont > 8 ? 62 : 70)) * (rFont / 72 * 1.2) + 0.1);
      rows.push([
        { text: [{ text: p.label, options: { bold: true, breakLine: true } }, { text: p.role, options: { fontSize: 8, color: C.muted } }] },
        { text: [{ text: money(p.amount), options: { bold: true, breakLine: true } }, { text: p.pct + "% of plan", options: { fontSize: 8, color: C.muted } }], options: { align: "right" } },
        { text: why, options: { fontSize: rFont } },
        { text: e.impr != null ? approx(e.impr) : "Estimate on request", options: { align: "right", bold: e.impr != null, color: e.impr != null ? C.ink : C.muted, fontSize: e.impr != null ? 10 : 8.5 } },
        { text: cl.length ? cl.join("\n") : "—", options: { align: "right", fontSize: 8.5, color: cl.length ? C.ink : C.muted } }
      ]);
    });
    var tableY = ty + th + 0.2;
    s.addTable(rows, { x: 0.4, y: tableY, w: 9.2, colW: [1.55, 1.15, 3.85, 1.25, 1.4], fontFace: FONT, fontSize: 9, color: C.ink, valign: "middle",
                       border: { type: "solid", pt: 0.5, color: C.line }, margin: [0.04, 0.07, 0.04, 0.07], autoPage: false });

    // Goal, just under the table
    var y = Math.min(5.7, tableY + rowsH + 0.25), gh = 0.6;
    s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: y, w: 9.2, h: gh, fill: { color: C.mint }, line: { color: C.mint } });
    s.addText([{ text: "Goal: ", options: { bold: true, fontSize: 13 } }, { text: ctx.strategy.success, options: { fontSize: 12 } }],
      { x: 0.55, y: y, w: 8.9, h: gh, fontFace: FONT, color: C.ink, align: "center", valign: "middle", margin: 0, isTextBox: true });
    s.addText(ctx.footnote, { x: 0.4, y: 6.4, w: 9.2, h: 0.58, fontFace: FONT, fontSize: 6.5, color: C.muted, margin: 0, valign: "top", isTextBox: true });
  }

  function build(ctx, opt) {
    var pres = new window.PptxGenJS();
    pres.layout = "LAYOUT_4x3";
    pres.author = "Adtaxi"; pres.company = "Adtaxi"; pres.title = "Proposal: " + ctx.client;
    slideMarket(pres, ctx);
    slideInvestment(pres, ctx);
    if (opt && opt.output) return pres.write({ outputType: opt.output });   // for testing
    return pres.writeFile({ fileName: ctx.fileName });
  }
  window.AdtaxiProposal = { build: build };
})();
