/* Adtaxi Customer Market Analyzer.
   Reads a customer file in the browser (nothing is uploaded), compares customers in each ZIP with the number expected
   from the ZIP's households and its distance from the business, profiles the over-performing ZIPs, and scores every ZIP
   in a wider search area on how closely it resembles them. Data: data/zips.json, data/fields.json, data/st/XX.json,
   built by data-build/build_crm_data.py from the master ZIP files. */
(function () {
  "use strict";
  var GEO = "../shared/geo/zip/dma/{id}.json";
  var NF0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  var NF1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  var BANDS = [0, 2, 5, 10, 15, 20, 30, 50, 75, 100, 150, 250, 100000];
  var SHRINK = 2;   // customers' worth of "average" added to every ZIP before the index is computed
  var pc = function (f, keys) { if (!f) return null; var t = 0; for (var i = 0; i < keys.length; i++) { if (f[keys[i]] == null) return null; t += f[keys[i]]; } return t / 100; };
  var BASES = {
    hh: { label: "Households", get: function (z) { return z.hh; } },
    pop: { label: "Population", get: function (z) { return z.pop; } },
    adults: { label: "Adults 18+", get: function (z, f) { var u = pc(f, ["age_u18"]); return u == null ? null : z.pop * (1 - u); } },
    a18_34: { label: "Adults 18–34", get: function (z, f) { var v = pc(f, ["age_18_34"]); return v == null ? null : z.pop * v; } },
    a35_64: { label: "Adults 35–64", get: function (z, f) { var v = pc(f, ["age_35_54", "age_55_64"]); return v == null ? null : z.pop * v; } },
    a55p: { label: "Adults 55+", get: function (z, f) { var v = pc(f, ["age_55_64", "age_65p"]); return v == null ? null : z.pop * v; } },
    age65: { label: "Adults 65+", get: function (z, f) { var v = pc(f, ["age_65p"]); return v == null ? null : z.pop * v; } },
    kids5: { label: "Children under 5", get: function (z, f) { var v = pc(f, ["kids_u5"]); return v == null ? null : z.pop * v; } },
    kids: { label: "Households with children", get: function (z, f) { var v = pc(f, ["hh_kids"]); return v == null ? null : z.hh * v; } },
    married: { label: "Married-couple households", get: function (z, f) { var v = pc(f, ["hh_married"]); return v == null ? null : z.hh * v; } },
    own: { label: "Homeowner households", get: function (z, f) { var v = pc(f, ["own"]); return v == null ? null : z.hh * v; } },
    rent: { label: "Renter households", get: function (z, f) { var v = pc(f, ["own"]); return v == null ? null : z.hh * (1 - v); } },
    inclt50: { label: "Households with income under $50K", get: function (z, f) { var v = pc(f, ["inc_lt35", "inc_35_50"]); return v == null ? null : z.hh * v; } },
    inc100: { label: "Households with income $100K+", get: function (z, f) { var v = pc(f, ["inc_100_150", "inc_150_200", "inc_200p"]); return v == null ? null : z.hh * v; } },
    bach: { label: "Adults with a bachelor's degree (approx.)", get: function (z, f) { var u = pc(f, ["age_u18"]), b = pc(f, ["ed_bachelors"]); return u == null || b == null ? null : z.pop * (1 - u) * b; } },
    somecol: { label: "Adults with some college, no degree (approx.)", get: function (z, f) { var u = pc(f, ["age_u18"]), b = pc(f, ["ed_some_college"]); return u == null || b == null ? null : z.pop * (1 - u) * b; } }
  };
  // Each category analyzer's core audience, used as the default potential when the tool is opened from that analyzer
  var CATEGORY_BASE = {
    healthcare: { "": "pop", urgent: "pop", pharmacy: "pop", dental: "pop", hearing: "age65", eye: "pop", chiro: "a35_64", behavioral: "adults", medspa: "a35_64", senior: "age65" },
    legal: { "": "adults", pi: "adults", family: "married", estate: "a55p", bankruptcy: "inclt50", employment: "adults" },
    "higher-ed": { "": "a18_34", fouryear: "a18_34", community: "a18_34", trade: "a18_34", graduate: "bach", adult: "somecol" },
    "home-services": { "": "own" },
    furniture: { "": "hh", outdoor: "own", baby: "kids5" },
    apartments: { "": "rent", senior: "a55p" },
    financial: { "": "hh", tax: "hh", wealth: "inc100", retire: "a55p", purchase: "rent", refi: "own" },
    auto: { "": "hh", newcar: "inc100", newtruck: "hh", usedcar: "hh", usedtruck: "hh" }
  };
  function categoryBase(p) {
    var cat = (p.category || "").toLowerCase(), map = CATEGORY_BASE[cat] || CATEGORY_BASE[cat.replace(/-analyzer$/, "")];
    if (!map && /apart/.test(cat)) map = CATEGORY_BASE.apartments;
    if (!map && /furn/.test(cat)) map = CATEGORY_BASE.furniture;
    if (!map) return null;
    return map[p.sub || ""] || map[""];
  }
  var STATUS = {
    over: { label: "Over-performing", color: "#0b5d53" },
    inline: { label: "In line", color: "#c9d3dc" },
    under: { label: "Under-performing", color: "#c76b1e" },
    few: { label: "Too few to judge", color: "#eef2f5" }
  };

  /* ---------- small helpers ---------- */
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "text") e.textContent = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function $(id) { return document.getElementById(id); }
  function fmt(v, unit) {
    if (v == null || isNaN(v)) return "—";
    if (unit === "%") return NF1.format(v) + "%";
    if (unit === "$") return "$" + NF0.format(v);
    if (unit === "years") return NF1.format(v);
    if (unit === "ratio" || unit === "per 1,000") return (Math.round(v * 100) / 100).toFixed(2);
    return NF0.format(v);
  }
  function miles(a, b) {
    var R = 3958.8, toR = Math.PI / 180, dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function normZip(s) {
    if (s == null) return null;
    s = String(s).trim().replace(/\.0+$/, "");
    var m = s.match(/^(\d{5})(?:[-\s]?\d{4})?$/) || s.match(/^(\d{9})$/);
    if (m) return m[1].slice(0, 5);
    if (/^\d{3,4}$/.test(s)) return ("00" + s).slice(-5);   // Excel dropped the leading zeros
    m = s.match(/^(\d{3,4})-\d{4}$/);
    if (m) return ("00" + m[1]).slice(-5);
    // ZIP inside longer text, as ad platforms export it ("80222, Colorado, United States") or a full address:
    // take the last standalone 5-digit group so a street number isn't mistaken for the ZIP
    if (/[A-Za-z,]/.test(s)) {
      var all = s.match(/(?:^|[^\d])(\d{5})(?:-\d{4})?(?=[^\d]|$)/g);
      if (all) return all[all.length - 1].replace(/^[^\d]/, "").slice(0, 5);
    }
    return null;
  }
  function csvCell(s) { s = s == null ? "" : String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function download(name, rows) {
    var blob = new Blob(["\ufeff" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n")], { type: "text/csv" });
    var a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }
  function wmean(items, key, wkey) {
    var s = 0, w = 0;
    items.forEach(function (it) { var v = it.f && it.f[key], ww = it[wkey]; if (v != null && ww > 0) { s += v * ww; w += ww; } });
    return w > 0 ? s / w : null;
  }
  function wsd(items, key, wkey, mean) {
    var s = 0, w = 0;
    items.forEach(function (it) { var v = it.f && it.f[key], ww = it[wkey]; if (v != null && ww > 0) { s += ww * (v - mean) * (v - mean); w += ww; } });
    return w > 0 ? Math.sqrt(s / w) : null;
  }
  // Exact Poisson tail probabilities (counts are small, so a normal approximation would flag too many ZIPs)
  function poisCdf(k, lam) {   // P(X <= k)
    if (k < 0) return 0;
    var term = Math.exp(-lam), sum = term;
    for (var i = 1; i <= k; i++) { term *= lam / i; sum += term; if (term < 1e-15 && i > lam) break; }
    return Math.min(1, sum);
  }
  var ALPHA = 0.025;   // one-sided, about 97.5% confidence
  /* ---------- app ---------- */
  var S = { zips: {}, list: [], fields: [], fmeta: {}, stFiles: {}, file: null, cust: null, res: null, params: {} };

  function boot() {
    new URLSearchParams(location.search).forEach(function (v, k) { S.params[k] = v; });
    if (S.params.debug) window.__crm = S;   // test hook: lets automated tests read the results
    Promise.all([fetch("data/zips.json").then(function (r) { return r.json(); }), fetch("data/fields.json").then(function (r) { return r.json(); })])
      .then(function (a) {
        var c = a[0].cols;
        a[0].rows.forEach(function (r) {
          var z = {}; c.forEach(function (k, i) { z[k] = r[i]; });
          S.zips[z.zip] = z; S.list.push(z);
        });
        S.fields = a[1].fields; S.built = a[1].built;
        S.fields.forEach(function (f) { S.fmeta[f.key] = f; });
        render();
      })
      .catch(function (e) { $("crm").innerHTML = '<p class="az-error">The ZIP data could not be loaded (' + e.message + "). Reload the page to try again.</p>"; });
  }

  function loadStates(states) {
    var need = states.filter(function (s) { return !S.stFiles[s]; });
    return Promise.all(need.map(function (s) {
      return fetch("data/st/" + s + ".json").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        S.stFiles[s] = j || { keys: [], rows: {} };
        if (!j) return;
        Object.keys(j.rows).forEach(function (zip) {
          var z = S.zips[zip]; if (!z) return;
          var f = {}; j.keys.forEach(function (k, i) { f[k] = j.rows[zip][i]; });
          z.f = f;
        });
      });
    }));
  }

  function render() {
    var root = $("crm"); root.innerHTML = "";
    if (S.params.from || S.params.category) {
      var name = S.params.from || (S.params.category.replace(/-/g, " ") + " analyzer");
      var dmaName = null;
      if (S.params.dma) { var dz = S.list.find(function (z) { return z.dma === S.params.dma; }); if (dz) dmaName = titleCase(dz.dma_name) + " DMA"; }
      var back = document.referrer && /analyzer|healthcare|legal|higher-ed|home-services|furniture|apartment/.test(document.referrer) ? document.referrer : null;
      root.appendChild(el("p", { class: "crm-context" }, [
        "Opened from the " + name + (S.params.subl ? " (" + S.params.subl + ")" : "") + (dmaName ? ", with the trade area set to the " + dmaName : "") + ". ",
        back ? el("a", { href: back, text: "Back to the analyzer" }) : null]));
    }
    root.appendChild(uploadPanel());
    root.appendChild(el("div", { id: "crm-setup" }));
    root.appendChild(el("div", { id: "crm-results" }));
    $("crm-method-link").onclick = function (e) { e.preventDefault(); method(); };
    loadTests(); loadClients();
  }

  /* ---------- step 1: the customer file ---------- */
  function uploadPanel() {
    var input = el("input", { type: "file", id: "crm-file", accept: ".csv,.txt,.xlsx,.xls", class: "crm-visually-hidden",
      onchange: function () { if (this.files[0]) readFile(this.files[0]); } });
    var drop = el("label", { for: "crm-file", class: "crm-drop", id: "crm-drop" }, [
      el("b", { text: "Choose a customer file" }), el("span", { text: " or drop it here" }),
      el("small", { text: "CSV or Excel. One row per customer (or per sale) with a ZIP code column. Sales amounts are optional." })
    ]);
    ["dragover", "dragenter"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    var paste = el("textarea", { id: "crm-paste", rows: 3, placeholder: "Or paste ZIP codes, one per line (add a comma and an amount to include sales)" });
    return el("section", { class: "az-panel crm-step" }, [
      el("h2", { text: "1. Add your customers" }),
      el("p", { class: "crm-privacy", text: "Your file is read inside this browser and never uploaded or stored. Only the ZIP code and amount columns are used; names, emails and other columns are dropped as soon as you pick the columns." }),
      input, drop,
      el("details", { class: "crm-tests crm-howto" }, [
        el("summary", { text: "Using an ad platform report (Google Ads or Meta)" }),
        el("p", { class: "crm-note", text: "The tool reads ad platform exports as they download, title lines and total rows included, and treats conversions or leads as customers." }),
        el("p", {}, [el("b", { text: "Google Ads: " }), "open the Locations report, switch to the view of where users were (user locations) rather than targeted locations, set the location level to postal code, add the Conversions column (and Conv. value if you want sales), and download it as CSV or Excel. A Report Editor report with \u201cPostal code (User location)\u201d and Conversions also works. Rows for every campaign can stay in; the tool adds them up by ZIP."]),
        el("p", {}, [el("b", { text: "Meta: " }), "Ads Manager can't break results down by ZIP, so use a lead form download from Leads Center or the Page's forms. It works when the form asks for ZIP code; each row is one lead."]),
        el("p", { class: "crm-note", text: "Menu names in both platforms change from time to time; look for a postal code (ZIP) breakdown of conversions." })
      ]),
      el("div", { class: "crm-paste-row" }, [paste,
        el("div", { class: "crm-paste-actions" }, [
          el("button", { class: "az-btn", type: "button", text: "Use pasted ZIPs", onclick: function () {
            var rows = $("crm-paste").value.split(/\r?\n/).filter(function (l) { return l.trim(); }).map(function (l) { return l.split(/[,\t;]/); });
            if (!rows.length) return;
            S.file = { name: "Pasted list", header: ["ZIP", "Amount"], rows: rows }; S.test = null;
            mapColumns(0, rows.some(function (r) { return r[1] && !isNaN(parseFloat(r[1])); }) ? 1 : -1);
          } }),
          el("button", { class: "az-btn", type: "button", text: "Try sample data", onclick: sample })
        ])]),
      el("details", { class: "crm-tests", id: "crm-clients" }, [
        el("summary", { text: "Real advertiser files" }),
        el("p", { class: "crm-note", text: "Customer files from real advertisers, reduced to customer counts (and sales, where available) by ZIP. No names or contact details are kept." }),
        el("div", { class: "crm-test-list", id: "crm-client-list" }, [el("p", { class: "crm-note", text: "Loading advertiser files\u2026" })])
      ]),
      el("details", { class: "crm-tests", id: "crm-tests" }, [
        el("summary", { text: "Practice with test files that have a known answer" }),
        el("p", { class: "crm-note", text: "Each file is a synthetic customer list with a hidden pattern built on real ZIP data. Load one, look at the results, decide what you think drives the business, then reveal the answer and see whether the tool found it." }),
        el("div", { class: "crm-test-list", id: "crm-test-list" }, [el("p", { class: "crm-note", text: "Loading test files…" })])
      ])
    ]);
  }

  function loadTests() {
    fetch("test/tests.json").then(function (r) { return r.json(); }).then(function (j) {
      var box = $("crm-test-list"); if (!box) return; box.innerHTML = "";
      j.tests.forEach(function (t) {
        box.appendChild(el("div", { class: "crm-test" }, [
          el("b", { text: t.title }), el("small", { text: NF0.format(t.customers) + " customers · locations " + t.stores.join(", ") }),
          el("p", { text: t.setup }),
          el("div", { class: "crm-test-actions" }, [
            el("button", { class: "az-btn primary", type: "button", text: "Load this test", onclick: function () { loadTest(t); } }),
            el("a", { class: "az-btn", href: "test/" + t.file, download: t.file, text: "Download CSV" })])
        ]));
      });
    }).catch(function () { var box = $("crm-test-list"); if (box) box.innerHTML = "<p class='crm-note'>The test files couldn't be loaded.</p>"; });
  }

  function loadClients() {
    fetch("clients/clients.json").then(function (r) { return r.json(); }).then(function (j) {
      var box = $("crm-client-list"); if (!box) return; box.innerHTML = "";
      j.clients.forEach(function (t) {
        box.appendChild(el("div", { class: "crm-test" }, [
          el("b", { text: t.title }), el("small", { text: t.client + " \u00b7 " + NF0.format(t.customers) + " customers \u00b7 " + (t.stores.length ? "locations " + t.stores.join(", ") : "store locations not set yet") }),
          el("p", { text: t.setup }),
          el("div", { class: "crm-test-actions" }, [
            el("button", { class: "az-btn primary", type: "button", text: "Load this file", onclick: function () { loadClient(t); } }),
            el("a", { class: "az-btn", href: "clients/" + t.file, download: t.file, text: "Download CSV" })])
        ]));
      });
    }).catch(function () { var box = $("crm-client-list"); if (box) box.innerHTML = "<p class='crm-note'>The advertiser files couldn't be loaded.</p>"; });
  }

  function loadClient(t) {
    fetch("clients/" + t.file).then(function (r) { return r.text(); }).then(function (txt) {
      var lines = txt.trim().split(/\r?\n/), header = lines.shift().split(",");
      S.file = { name: t.client + ": " + t.title, header: header, rows: lines.map(function (l) { return l.split(","); }) };
      S.test = null; S.bizName = t.client;
      S.params.locs = t.stores.join(", ");
      guessColumns();
      $("crm-locs").value = t.stores.join(", ");
      $("crm-setup").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function loadTest(t) {
    fetch("test/" + t.file).then(function (r) { return r.text(); }).then(function (txt) {
      var lines = txt.trim().split(/\r?\n/), header = lines.shift().split(",");
      S.file = { name: t.title + " (test file)", header: header, rows: lines.map(function (l) { return l.split(","); }) };
      S.test = t;
      S.params.locs = t.stores.join(", ");
      guessColumns();
      $("crm-locs").value = t.stores.join(", ");
      $("crm-setup").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // Column names that hold ZIPs in client files and ad platform exports ("Location" and "Postal code (User location)" in Google Ads, "zip_code" in Meta lead forms)
  var ZIP_HDR = /zip|postal|^\s*location\s*$|^\s*(user|matched|targeted)\s+locations?\b/i;
  // Columns that mark an ad platform performance report (one row per ZIP per campaign, ad group, device or day)
  var AD_HDR = /^(impr\.?|impressions|clicks|cost|amount spent.*|campaign( name)?|ad group|ad set( name)?|ctr|avg\. cpc|cpc.*|reach)$/i;
  function sourceOf(h) {
    var has = function (re) { return h.some(function (n) { return re.test(String(n).trim()); }); };
    if (has(/^zip_code$/i) && (has(/^(form_name|form_id)$/i) || has(/^is_organic$/i))) return "meta-leads";
    if (has(/^(impr\.?|clicks)$/i) && (has(/^conversions$/i) || has(/conv\./i)) && has(ZIP_HDR)) return "google-ads";
    if (h.some(function (n) { return AD_HDR.test(String(n).trim()); })) return "ad-report";
    return null;
  }
  function readFile(file) {
    S.test = null;
    var r = new FileReader();
    // CSV and text files don't need the spreadsheet library: if it didn't load (a blocked or slow CDN), read them directly
    var asText = typeof XLSX === "undefined" && /\.(csv|txt|tsv)$/i.test(file.name);
    r.onload = function () {
      try {
        var aoa;
        if (asText) aoa = parseDelimited(String(r.result));
        else if (typeof XLSX === "undefined") throw new Error("the Excel reader didn't load (check the connection and refresh, or save the file as CSV)");
        else {
          var wb = XLSX.read(new Uint8Array(r.result), { type: "array", raw: false });
          var ws = wb.Sheets[wb.SheetNames[0]];
          aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        }
        aoa = aoa.filter(function (row) { return row.some(function (c) { return String(c).trim() !== ""; }); });
        if (!aoa.length) throw new Error("the first sheet is empty");
        // Reports often start with title lines ("Zip code report", a date range); use the first row in the top 15 that
        // names a ZIP column and has at least two filled cells as the header, and drop the lines above it
        var filled = function (row) { return row.filter(function (c) { return String(c).trim() !== ""; }).length; };
        for (var hi = 0; hi < Math.min(15, aoa.length); hi++) {
          if (filled(aoa[hi]) >= 2 && aoa[hi].some(function (c) { return ZIP_HDR.test(c) && !normZip(c); })) break;
        }
        if (hi > 0 && hi < Math.min(15, aoa.length)) aoa = aoa.slice(hi);
        var hasHeader = !aoa[0].some(function (c) { return normZip(c); }) || aoa[0].some(function (c) { return ZIP_HDR.test(c); });
        // drop report total lines ("Total: Account", "Total: Campaigns", "Grand total")
        aoa = aoa.filter(function (row, i) { return i === 0 || !/^\s*(grand\s+)?total\b/i.test(String(row[0])); });
        S.file = { name: file.name, header: hasHeader ? aoa[0].map(String) : aoa[0].map(function (c, i) { return "Column " + (i + 1); }),
                   rows: hasHeader ? aoa.slice(1) : aoa };
        S.file.source = sourceOf(S.file.header);
        guessColumns();
      } catch (e) {
        $("crm-setup").innerHTML = ""; $("crm-setup").appendChild(el("p", { class: "az-error", text: "That file couldn't be read: " + e.message + ". Save it as CSV or .xlsx and try again." }));
      }
    };
    if (asText) r.readAsText(file); else r.readAsArrayBuffer(file);
  }
  // Minimal CSV/TSV reader (quoted fields, doubled quotes, commas and line breaks inside quotes)
  function parseDelimited(txt) {
    txt = txt.replace(/^\uFEFF/, "");
    var first = txt.split(/\r?\n/, 1)[0], sep = (first.split("\t").length > first.split(",").length) ? "\t" : ",";
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < txt.length; i++) {
      var ch = txt[i];
      if (q) {
        if (ch === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && txt[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function guessColumns() {
    var h = S.file.header, rows = S.file.rows.slice(0, 200), zi = -1, vi = -1, best = 0, anyZip = 0;
    h.forEach(function (name, i) {
      var hits = rows.filter(function (r) { return normZip(r[i]); }).length;
      var score = hits + (ZIP_HDR.test(name) ? 1000 : 0) - (/phone|id|account|number/i.test(name) && !/zip/i.test(name) ? 500 : 0);
      if (score > best) { best = score; zi = i; }
      // a column counts as holding ZIPs if it is named like one or most of its values are real ZIPs (numbers like impressions can look like ZIPs)
      var real = rows.filter(function (r) { var z = normZip(r[i]); return z && S.zips[z]; }).length;
      if (ZIP_HDR.test(name) || real >= rows.length * 0.5) anyZip = Math.max(anyZip, hits || 1);
    });
    if (!anyZip) {
      var region = h.some(function (n) { return /^(region|dma|country|state|city|designated market area)/i.test(String(n).trim()); });
      $("crm-setup").innerHTML = "";
      $("crm-setup").appendChild(el("p", { class: "az-error", text: "No ZIP codes were found in " + S.file.name + "." + (region
        ? " This looks like a report broken down by region, DMA or city. Meta Ads Manager can't break results down by ZIP; use a lead form download (it includes zip_code when the form asks for it) or the client's own customer list. See \u201cUsing an ad platform report\u201d above."
        : " The file needs a column of 5-digit ZIP codes.") }));
      return;
    }
    var numeric = function (i) { return rows.filter(function (r) { return r[i] !== "" && !isNaN(parseFloat(String(r[i]).replace(/[$,\s]/g, ""))); }).length >= rows.length * 0.8; };
    // Sales amount: client revenue, not ad cost ("Amount spent", "Cost" and rates are skipped)
    h.forEach(function (name, i) { if (vi < 0 && i !== zi && /amount|revenue|sales|total|value|price/i.test(name) && !/spent|cost|rate|per |%|count/i.test(name) && numeric(i)) vi = i; });
    // Count: a summary report with one row per ZIP (ad platform conversions or leads by ZIP, sales counts by ZIP)
    var ci = -1;
    h.forEach(function (name, i) { if (ci < 0 && i !== zi && i !== vi && /conversion|\bconv\b|conv\.|lead|result|order|customer|count|transaction|purchase|patient|qty|quantity/i.test(name) && !/value|rate|cost|%|per |name|id\b/i.test(name) && numeric(i)) ci = i; });
    // only treat it as a summary report if ZIPs mostly appear once
    // (ad platform reports repeat each ZIP once per campaign, ad group or day, so their counts are kept and summed by ZIP)
    if (ci >= 0 && !S.file.source) {
      var seen = {}, dup = 0, tot = 0;
      S.file.rows.forEach(function (r) { var z = normZip(r[zi]); if (z) { tot++; if (seen[z]) dup++; seen[z] = 1; } });
      if (tot && dup / tot > 0.2) ci = -1;
    }
    var fi = -1, fkeep = null;
    h.forEach(function (name, i) { if (fi < 0 && /^location type$/i.test(String(name).trim())) fi = i; });
    if (fi >= 0) {
      var vals = {}; S.file.rows.forEach(function (r) { vals[String(r[fi]).trim()] = 1; });
      fkeep = Object.keys(vals).filter(function (v) { return /presence|physical|located in|people in/i.test(v); });
      if (!fkeep.length) { fi = -1; fkeep = null; }
    }
    mapColumns(zi, vi, ci, fi, fkeep);
  }

  function mapColumns(zi, vi, ci, fi, fkeep) {
    if (ci == null) ci = -1;
    if (fi == null) fi = -1;
    var h = S.file.header, box = $("crm-setup");
    var opt = function (sel, none) {
      return [none ? el("option", { value: -1, text: "None" }) : null].concat(h.map(function (n, i) { return el("option", { value: i, text: n || "Column " + (i + 1), selected: i === sel }); }));
    };
    var zs = el("select", { id: "crm-zipcol" }, opt(zi, false));
    var vs = el("select", { id: "crm-valcol" }, opt(vi, true));
    var cs = el("select", { id: "crm-cntcol" }, opt(ci, true));
    var fs = el("select", { id: "crm-filtcol", onchange: filterValues }, opt(fi, true));
    box.innerHTML = "";
    box.appendChild(el("section", { class: "az-panel crm-step" }, [
      el("h2", { text: "2. Check the columns and set up your market" }),
      sourceNote(ci, fi, fkeep),
      el("p", { class: "crm-note", text: S.file.name + ": " + NF0.format(S.file.rows.length) + " rows." +
        (ci >= 0 && !S.file.source ? " This looks like a summary report with one row per ZIP, so each ZIP's customers are taken from the " + (h[ci] || "count") + " column. Set the count column to None if each row is one customer." : "") }),
      el("div", { class: "az-controls crm-controls" }, [
        el("label", { class: "az-field" }, ["ZIP code column", zs]),
        el("label", { class: "az-field" }, ["Sales amount column (optional)", vs]),
        el("label", { class: "az-field", title: "For summary reports with one row per ZIP, such as conversions or leads by ZIP from Google Ads or Meta" }, ["Count column (one row per ZIP)", cs]),
        el("label", { class: "az-field" }, ["Count only rows where (optional)", fs]),
        el("label", { class: "az-field", id: "crm-filtval-wrap", style: "display:none" }, ["equals", el("select", { id: "crm-filtval", multiple: true, size: 3 })])
      ]),
      el("div", { class: "az-controls crm-controls" }, [
        el("label", { class: "az-field crm-wide" }, ["Your location ZIPs (stores, offices or service base)",
          el("input", { id: "crm-locs", type: "text", placeholder: "e.g. 80222, 80134", value: S.params.locs || "" })]),
        el("label", { class: "az-field" }, ["Trade area", el("select", { id: "crm-radius" }, [
          el("option", { value: "auto", text: "Auto (covers 90% of customers)" }),
          [5, 10, 15, 20, 25, 35, 50, 75, 100, 150].map(function (m) { return el("option", { value: m, text: m + " miles" }); }),
          el("option", { value: "dma", text: "Whole DMA", selected: !!S.params.dma })
        ].flat())]),
        el("label", { class: "az-field" }, ["Measure potential by", el("select", { id: "crm-base" },
          Object.keys(BASES).map(function (k) { return el("option", { value: k, text: BASES[k].label, selected: k === (categoryBase(S.params) || "hh") }); }))]),
        el("label", { class: "az-field" }, ["Search for similar ZIPs in", el("select", { id: "crm-search" }, [
          el("option", { value: "1.5", text: "Trade area plus 50%", selected: true }),
          el("option", { value: "2", text: "Twice the trade area" }),
          el("option", { value: "dma", text: "The whole DMA(s)" }),
          el("option", { value: "state", text: "The whole state(s)" })])]),
        el("div", { class: "az-actions" }, [el("button", { class: "az-btn primary", type: "button", text: "Analyze customers", onclick: run })])
      ]),
      el("p", { class: "crm-note", id: "crm-locs-hint" }),
      categoryBase(S.params) ? el("p", { class: "crm-note", text: "Potential is set to " + BASES[categoryBase(S.params)].label.toLowerCase() +
        ", the core audience for " + (S.params.subl || S.params.from || "this category") + ", so expected customers reflect that audience rather than all households. You can change it." }) : null
    ]));
    if (fi >= 0) {
      filterValues();
      Array.prototype.forEach.call($("crm-filtval").options, function (o) { o.selected = fkeep.indexOf(o.value) >= 0; });
    }
    ["crm-zipcol", "crm-cntcol"].forEach(function (id) { $(id).addEventListener("change", previewMatch); });
    previewMatch();
    zs.onchange = previewMatch;
  }

  // a short box naming the kind of report recognized and what the tool did with it
  function sourceNote(ci, fi, fkeep) {
    var src = S.file.source, h = S.file.header; if (!src) return null;
    var lines = [];
    if (src === "google-ads") {
      lines.push(el("b", { text: "Google Ads location report recognized." }));
      lines.push(" Each ZIP's " + (ci >= 0 ? h[ci].toLowerCase() : "conversions") + " are added up across campaigns" + (h.some(function (n) { return /date|day|week|month|device/i.test(n); }) ? ", dates and devices" : "") + ", and total lines are skipped.");
      if (fi >= 0) lines.push(" Only rows where people were physically in the ZIP (" + fkeep.join(", ") + ") are counted; rows for people who were only interested in the area are left out. You can change this below.");
    } else if (src === "meta-leads") {
      lines.push(el("b", { text: "Meta lead form download recognized." }));
      lines.push(" Each row is one lead, placed by the ZIP the person entered on the form. To leave out organic leads, choose is_organic below and select false.");
    } else {
      lines.push(el("b", { text: "Ad platform report recognized." }));
      lines.push(ci >= 0 ? " Each ZIP's " + h[ci].toLowerCase() + " are added up across rows." : " No conversions or leads column was found, so each row counts as one; pick the count column below if there is one.");
    }
    if (ci >= 0) lines.push(" Results describe where " + h[ci].toLowerCase() + " came from, which reflects both the market and where the campaign was shown.");
    return el("div", { class: "crm-source" }, lines);
  }

  function filterValues() {
    var c = +$("crm-filtcol").value, wrap = $("crm-filtval-wrap"), sel = $("crm-filtval");
    sel.innerHTML = "";
    if (c < 0) { wrap.style.display = "none"; return; }
    var counts = {};
    S.file.rows.forEach(function (r) { var v = String(r[c] == null ? "" : r[c]).trim(); counts[v] = (counts[v] || 0) + 1; });
    var vals = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 40);
    vals.forEach(function (v) { sel.appendChild(el("option", { value: v, text: (v || "(blank)") + " (" + NF0.format(counts[v]) + ")" })); });
    wrap.style.display = "";
  }

  function previewMatch() {
    var zi = +$("crm-zipcol").value, ci = $("crm-cntcol") ? +$("crm-cntcol").value : -1, top = {};
    S.file.rows.forEach(function (r) {
      var z = normZip(r[zi]); if (!z || !S.zips[z]) return;
      var w = ci >= 0 ? parseFloat(String(r[ci]).replace(/[$,\s]/g, "")) : 1;
      if (w > 0) top[z] = (top[z] || 0) + w;
    });
    var best = Object.keys(top).sort(function (a, b) { return top[b] - top[a]; }).slice(0, 3);
    var hint = $("crm-locs-hint"); hint.innerHTML = "";
    if (!best.length) { hint.textContent = "No valid ZIP codes found in that column; pick the column that holds ZIP codes."; return; }
    hint.appendChild(document.createTextNode("Most customers are in " + best.map(function (z) { return z + " " + S.zips[z].city; }).join(", ") + ". "));
    if (!$("crm-locs").value) hint.appendChild(el("button", { class: "crm-linkbtn", type: "button", text: "Use " + best[0] + " as the location",
      onclick: function () { $("crm-locs").value = best[0]; } }));
  }

  /* ---------- sample data: a Denver-area business whose customers lean affluent and near the store ---------- */
  function sample() {
    var store = S.zips["80222"] ? "80222" : S.list[0].zip;
    loadStates(["CO"]).then(function () {
      var rows = [], seed = 7;
      var rand = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      S.list.forEach(function (z) {
        if (z.state !== "CO" || !z.f) return;
        var d = miles(z, S.zips[store]); if (d > 40) return;
        var rich = (z.f.inc_150_200 || 0) + (z.f.inc_200p || 0), own = z.f.own || 0;
        var lam = z.hh * 0.006 * Math.exp(-d / 9) * Math.pow(rich / 22, 1.4) * (own / 65);
        var n = 0, L = Math.exp(-lam), p = 1; do { n++; p *= rand(); } while (p > L && n < 2000); n--;
        for (var i = 0; i < n; i++) rows.push([z.zip, Math.round(400 + rand() * 2600)]);
      });
      S.file = { name: "Sample customers (synthetic, Denver area)", header: ["ZIP", "Sale amount"], rows: rows }; S.test = null;
      S.params.locs = store;
      mapColumns(0, 1);
      $("crm-locs").value = store;
    });
  }

  /* ---------- step 3: analysis ---------- */
  function run() {
    var zi = +$("crm-zipcol").value, vi = +$("crm-valcol").value, fc = +$("crm-filtcol").value, ci = +$("crm-cntcol").value;
    var keepVals = fc >= 0 ? Array.prototype.map.call($("crm-filtval").selectedOptions, function (o) { return o.value; }) : null;
    var cust = {}, stats = { rows: 0, valid: 0, matched: 0, bad: 0, unknown: 0, unknownZips: {} };
    S.file.rows.forEach(function (r) {
      if (keepVals && keepVals.length && keepVals.indexOf(String(r[fc] == null ? "" : r[fc]).trim()) < 0) return;
      stats.rows++;
      var z = normZip(r[zi]);
      if (!z) { stats.bad++; return; }
      stats.valid++;
      if (!S.zips[z]) { stats.unknown++; stats.unknownZips[z] = (stats.unknownZips[z] || 0) + 1; return; }
      var w = 1;
      if (ci >= 0) { w = parseFloat(String(r[ci]).replace(/[$,\s]/g, "")); if (!(w > 0)) return; }   // ZIPs with zero count add nothing
      stats.matched += w;
      var c = cust[z] || (cust[z] = { n: 0, v: 0 });
      c.n += w;
      if (vi >= 0) { var v = parseFloat(String(r[vi]).replace(/[$,\s]/g, "")); if (!isNaN(v)) c.v += v; }
    });
    // Drop the file contents now that the counts are made
    S.file.rows = []; S.cust = cust; S.stats = stats; S.hasValue = vi >= 0; S.countCol = ci >= 0; S.countName = ci >= 0 ? S.file.header[ci] : null;
    if (!stats.matched) { results(el("p", { class: "az-error", text: "None of the ZIP codes matched a residential ZIP. Check that the right column is selected." })); return; }
    var locs = $("crm-locs").value.split(/[\s,;]+/).map(normZip).filter(function (z) { return z && S.zips[z]; });
    var base = $("crm-base").value, radiusSel = $("crm-radius").value, searchSel = $("crm-search").value;
    results(el("p", { class: "az-loading", text: "Analyzing " + NF0.format(stats.matched) + " customers…" }));

    var custZips = Object.keys(cust);
    // distance from every ZIP to the nearest location
    S.list.forEach(function (z) {
      z.d = null;
      locs.forEach(function (l) { var d = miles(z, S.zips[l]); if (z.d == null || d < z.d) z.d = d; });
    });
    // trade area
    var market, radius = null, dmas = {};
    var dmaPreset = S.params.dma && radiusSel === "dma" ? [S.params.dma] : null;
    if (radiusSel === "dma" || !locs.length) {
      var byDma = {}; custZips.forEach(function (z) { var d = S.zips[z].dma; if (d) byDma[d] = (byDma[d] || 0) + cust[z].n; });
      var order = Object.keys(byDma).sort(function (a, b) { return byDma[b] - byDma[a]; }), cum = 0;
      var chosen = dmaPreset || [];
      if (!chosen.length) for (var i = 0; i < order.length && cum < 0.9 * stats.matched; i++) { chosen.push(order[i]); cum += byDma[order[i]]; }
      chosen.forEach(function (d) { dmas[d] = true; });
      market = S.list.filter(function (z) { return dmas[z.dma]; });
    } else {
      if (radiusSel === "auto") {
        var ds = []; custZips.forEach(function (z) { for (var k = 0; k < cust[z].n; k++) ds.push(S.zips[z].d); });
        ds.sort(function (a, b) { return a - b; });
        radius = Math.min(150, Math.max(5, Math.ceil(ds[Math.floor(0.9 * (ds.length - 1))] / 5) * 5));
      } else radius = +radiusSel;
      market = S.list.filter(function (z) { return z.d <= radius; });
      market.forEach(function (z) { if (z.dma) dmas[z.dma] = true; });
    }
    // search area for similar ZIPs
    var search;
    if (searchSel === "dma") search = S.list.filter(function (z) { return dmas[z.dma]; });
    else if (searchSel === "state") {
      var sts = {}; market.forEach(function (z) { sts[z.state] = true; });
      search = S.list.filter(function (z) { return sts[z.state]; });
    } else if (radius) search = S.list.filter(function (z) { return z.d <= radius * +searchSel; });
    else search = market.slice();
    var states = {};
    search.concat(market).forEach(function (z) { states[z.state] = true; });
    loadStates(Object.keys(states)).then(function () {
      analyze({ market: market, search: search, locs: locs, radius: radius, dmas: Object.keys(dmas), base: base, searchSel: searchSel });
    });
  }

  function analyze(o) {
    var cust = S.cust, base = BASES[o.base];
    var items = o.market.map(function (z) {
      var c = cust[z.zip] || { n: 0, v: 0 };
      return { z: z, f: z.f, A: c.n, V: c.v, B: base.get(z, z.f) || 0, d: z.d };
    }).filter(function (it) { return it.B > 0; });
    var inMarket = items.reduce(function (t, it) { return t + it.A; }, 0);
    // Expected customers: potential x a customer rate that falls smoothly with distance from the nearest location,
    // rate(d) = a * exp(-d / s). The scale s is chosen by maximum (Poisson) likelihood over all trade-area ZIPs, so a
    // handful of ZIPs near the store can't distort it; "no distance effect" is one of the candidates.
    var useDist = o.locs.length > 0 && o.radius;
    var totA = items.reduce(function (t, it) { return t + it.A; }, 0);
    var fit = function (sc) {
      var w = function (it) { return sc ? Math.exp(-it.d / sc) : 1; };
      var den = items.reduce(function (t, it) { return t + it.B * w(it); }, 0), a = den > 0 ? totA / den : 0, ll = 0;
      items.forEach(function (it) { var lam = a * it.B * w(it); if (lam > 0) ll += it.A * Math.log(lam) - lam; });
      return { s: sc, a: a, ll: ll };
    };
    var best = fit(0);
    if (useDist) for (var sc = 1; sc <= 400; sc *= 1.15) { var f = fit(sc); if (f.ll > best.ll + 1e-9) best = f; }
    var rateAt = function (d) { return best.a * (best.s ? Math.exp(-d / best.s) : 1); };
    items.forEach(function (it) { it.E = it.B * rateAt(useDist ? it.d : 0); });
    // for the chart: observed rate by distance band next to the fitted curve
    var bandRows = [];
    if (useDist) {
      var edges = BANDS.filter(function (b) { return b < o.radius; }).concat([o.radius]);
      for (var i = 0; i < edges.length - 1; i++) {
        var lo = edges[i], hi = edges[i + 1], inB = items.filter(function (it) { return it.d >= lo && it.d < hi; });
        var bA = inB.reduce(function (t, it) { return t + it.A; }, 0), bB = inB.reduce(function (t, it) { return t + it.B; }, 0);
        if (bB > 0) bandRows.push({ from: lo, to: hi, A: bA, B: bB, raw: bA / bB, fit: rateAt((lo + hi) / 2) });
      }
    }
    var halfMiles = best.s ? best.s * Math.LN2 : null;
    items.forEach(function (it) {
      it.idx = (it.A + SHRINK) / (it.E + SHRINK) * 100;
      it.pHigh = 1 - poisCdf(it.A - 1, it.E);   // chance of this many or more if the ZIP were average
      it.pLow = poisCdf(it.A, it.E);            // chance of this few or fewer
      it.pen = it.A / it.z.hh * 1000;
      it.status = (it.E < 1.5 && it.A < 3) ? "few" : (it.idx >= 120 && it.pHigh < ALPHA) ? "over" : (it.idx <= 80 && it.pLow < ALPHA) ? "under" : "inline";
    });
    // profile of the strong ZIPs
    var strong = items.filter(function (it) { return it.status === "over"; }), strongLabel = "over-performing ZIPs";
    if (strong.length < 5) {
      var ranked = items.filter(function (it) { return it.E >= 1; }).sort(function (a, b) { return b.idx - a.idx; });
      strong = ranked.slice(0, Math.max(5, Math.ceil(ranked.length * 0.2)));
      strongLabel = "top-performing fifth of ZIPs";
    }
    // How many over-performing ZIPs would chance alone produce? (each judged ZIP has at most a 2.5% chance)
    var judged = items.filter(function (it) { return it.status !== "few"; }).length;
    var nOver = items.filter(function (it) { return it.status === "over"; }).length;
    var chanceOver = judged * ALPHA;
    var weakSignal = nOver <= Math.max(3, 2 * chanceOver);
    var prof = S.fields.map(function (f) {
      var mm = wmean(items, f.key, "B"), ms = wmean(strong, f.key, "B"), sd = mm == null ? null : wsd(items, f.key, "B", mm);
      var cw = wmean(items, f.key, "A");
      return { f: f, market: mm, strong: ms, sd: sd, cust: cw, std: (ms != null && sd) ? (ms - mm) / sd : null };
    }).filter(function (p) { return p.std != null && isFinite(p.std); });
    // Pick up to 10 distinguishing characteristics, skipping any that move almost in lockstep (|r| > 0.75 across the
    // trade area's ZIPs) with one already picked, so one trait (income, say) can't fill the profile six times over
    var corr = function (a, b) {
      var xs = [], ys = [];
      items.forEach(function (it) { var x = it.f && it.f[a], y = it.f && it.f[b]; if (x != null && y != null) { xs.push(x); ys.push(y); } });
      var n = xs.length; if (n < 8) return 0;
      var mx = xs.reduce(function (s, v) { return s + v; }, 0) / n, my = ys.reduce(function (s, v) { return s + v; }, 0) / n, sxy = 0, sxx = 0, syy = 0;
      for (var i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my); }
      return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
    };
    var simKeys = [];
    prof.filter(function (p) { return p.f.sim && Math.abs(p.std) >= 0.3; })
      .sort(function (a, b) { return Math.abs(b.std) - Math.abs(a.std); })
      .forEach(function (p) {
        if (simKeys.length >= 10) return;
        if (simKeys.filter(function (q) { return q.f.group === p.f.group; }).length >= 3) return;   // at most 3 per group
        if (simKeys.every(function (q) { return Math.abs(corr(p.f.key, q.f.key)) <= 0.75; })) simKeys.push(p);
      });
    // similarity of every ZIP in the search area to the strong-ZIP profile
    var byZip = {}; items.forEach(function (it) { byZip[it.z.zip] = it; });
    var cand = o.search.map(function (z) {
      if (!z.f) return null;
      var sw = 0, sq = 0, tw = 0;
      simKeys.forEach(function (p) {
        var w = Math.abs(p.std); tw += w;
        var v = z.f[p.f.key]; if (v == null) return;
        var dz = (v - p.strong) / p.sd;
        if ((p.std > 0 && dz > 0) || (p.std < 0 && dz < 0)) dz = 0;   // even further in the strong ZIPs' direction: no penalty
        sq += w * dz * dz; sw += w;
      });
      if (!sw || sw < 0.7 * tw) return null;
      var it = byZip[z.zip], c = cust[z.zip] || { n: 0 };
      var sim = 100 * Math.exp(-sq / sw / 2);
      return { z: z, sim: sim, A: c.n, idx: it ? it.idx : null, status: it ? it.status : null, d: z.d, B: base.get(z, z.f) || 0,
        inMarket: !!it, opp: sim >= 60 && z.hh >= 200 && (!it ? c.n === 0 : (it.status === "under" || (it.status !== "over" && it.idx < 90))) };
    }).filter(Boolean).sort(function (a, b) { return b.sim - a.sim; });
    S.res = { o: o, items: items, strong: strong, strongLabel: strongLabel, prof: prof, simKeys: simKeys, cand: cand,
              bands: bandRows, inMarket: inMarket, useDist: useDist, halfMiles: halfMiles, weakSignal: weakSignal,
              nOver: nOver, chanceOver: chanceOver };
    showResults();
  }

  /* ---------- results ---------- */
  function results(node) { var r = $("crm-results"); r.innerHTML = ""; r.appendChild(node); }

  function showResults() {
    var R = S.res, o = R.o, st = S.stats, items = R.items;
    var count = function (s) { return items.filter(function (it) { return it.status === s; }); };
    var over = count("over"), under = count("under");
    var totB = items.reduce(function (s, it) { return s + it.B; }, 0);
    var area = o.radius ? o.radius + " miles of " + (o.locs.length > 1 ? "your " + o.locs.length + " locations" : o.locs[0] + " " + S.zips[o.locs[0]].city)
                        : (o.dmas.length === 1 ? "the " + titleCase(S.list.find(function (z) { return z.dma === o.dmas[0]; }).dma_name) + " DMA" : o.dmas.length + " DMAs");
    var wrap = el("div", { class: "crm-results" });
    var skipped = st.bad + st.unknown;
    wrap.appendChild(el("section", { class: "az-panel crm-summary" }, [
      el("h2", { text: "3. Results: within " + area }),
      el("div", { class: "crm-kpis" }, [
        kpi(NF0.format(st.matched), S.countCol ? (S.countName || "count").toLowerCase() + " matched to ZIPs" : "customers matched to ZIPs", skipped ? NF0.format(skipped) + (skipped === 1 ? " row" : " rows") + " skipped (" + NF0.format(st.bad) + " missing or invalid ZIP" + (st.bad === 1 ? "" : "s") + ", " + NF0.format(st.unknown) + " PO box or non-residential ZIP" + (st.unknown === 1 ? "" : "s") + ")" : "every row matched"),
        kpi(NF0.format(R.inMarket), "in the trade area", NF1.format(R.inMarket / st.matched * 100) + "% of matched customers; " + NF0.format(items.length) + " ZIPs"),
        kpi(NF1.format(R.inMarket / totB * 1000), "customers per 1,000 " + BASES[o.base].label.toLowerCase(), "across the trade area"),
        kpi(NF0.format(over.length), "over-performing ZIPs", NF0.format(over.reduce(function (s, it) { return s + it.A; }, 0)) + " customers"),
        kpi(NF0.format(under.length), "under-performing ZIPs", NF0.format(Math.round(under.reduce(function (s, it) { return s + it.E - it.A; }, 0))) + " customers short of expected")
      ]),
      R.useDist ? null : el("p", { class: "crm-warn", text: "No location ZIP was entered, so expected customers don't account for distance. ZIPs near your business will look stronger than they are. Add your location ZIPs above and analyze again for a fairer comparison." }),
      el("div", { class: "crm-print-row" }, [
        el("input", { id: "crm-bizname", type: "text", placeholder: "Business name for the summary (optional)", "aria-label": "Business name for the printed summary",
          value: S.test ? S.test.title : (S.bizName || ""), oninput: function () { S.bizName = this.value; } }),
        el("button", { class: "az-btn primary", type: "button", text: "Print one-page summary", onclick: printSummary }),
        el("span", { class: "crm-note", text: "Choose \u201cSave as PDF\u201d in the print dialog to email it." })])
    ]));
    if (S.test) {
      var t = S.test, ans = el("div", { class: "crm-answer", hidden: true }, [
        el("p", {}, [el("b", { text: "The planted pattern: " }), t.answer]),
        el("p", {}, [el("b", { text: "What to look for: " }), t.look])]);
      wrap.appendChild(el("section", { class: "az-panel crm-test-answer" }, [
        el("h3", { text: "Test file: " + t.title }),
        el("p", { class: "crm-note", text: "Look through the maps and the strongest-ZIP profile first and decide what you think drives this business. Then check the answer." }),
        el("button", { class: "az-btn primary", type: "button", text: "Reveal the answer", onclick: function () { ans.hidden = false; this.remove(); } }),
        ans]));
    }
    // two linked maps: market potential (left) and your customers (right), then the profile
    wrap.appendChild(el("section", { id: "crm-print-top", class: "crm-print-only" }));
    wrap.appendChild(el("div", { class: "crm-maps" }, [mapPanel("r"), mapPanel("l")]));
    wrap.appendChild(el("section", { id: "crm-print-bottom", class: "crm-print-only" }));
    wrap.appendChild(profilePanel());
    wrap.appendChild(perfPanel());
    wrap.appendChild(simPanel());
    results(wrap);
    drawMaps();
  }

  function kpi(big, label, note) {
    return el("div", { class: "crm-kpi" }, [el("b", { class: "num", text: big }), el("span", { text: label }), note ? el("small", { text: note }) : null]);
  }
  function titleCase(s) { return String(s || "").toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }

  function profilePanel() {
    var R = S.res, showAll = false;
    var box = el("section", { class: "az-panel crm-profile" });
    var draw = function () {
      box.innerHTML = "";
      box.appendChild(el("h3", { text: "What your strongest ZIPs have in common" }));
      if (R.weakSignal) box.appendChild(el("p", { class: "crm-warn", text: "Treat this profile as tentative: " + NF0.format(R.nOver) +
        " ZIPs over-perform, and chance alone would produce about " + NF0.format(Math.max(1, Math.round(R.chanceOver))) +
        ". Your customers may simply follow population, or the list may be too small to show a clear pattern." }));
      box.appendChild(el("p", { class: "crm-note", text: "Your " + R.strongLabel + " (" + NF0.format(R.strong.length) + ") compared with your whole trade area. Bars show how far apart they are, in standard deviations across the trade area's ZIPs." }));
      var list = R.prof.slice().filter(function (p) { return showAll || p.f.sim; }).sort(function (a, b) { return Math.abs(b.std) - Math.abs(a.std); });
      if (!showAll) list = list.slice(0, 12);
      var tbl = el("table", { class: "crm-prof" }, [el("thead", {}, [el("tr", {}, [el("th", { text: "Characteristic" }), el("th", { text: "Strongest ZIPs" }), el("th", { text: "Trade area" }), el("th", { text: "U.S." }), el("th", { text: "Difference" })])])]);
      var tb = el("tbody");
      list.forEach(function (p) {
        var w = Math.min(100, Math.abs(p.std) / 1.5 * 100);
        var used = R.simKeys.indexOf(p) >= 0;
        tb.appendChild(el("tr", { class: used ? "used" : null, title: used ? "Used to find similar ZIPs" : null }, [
          el("td", { text: p.f.label }), el("td", { class: "num", text: fmt(p.strong, p.f.unit) }), el("td", { class: "num", text: fmt(p.market, p.f.unit) }),
          el("td", { class: "num muted", text: fmt(p.f.us, p.f.unit) }),
          el("td", {}, [el("span", { class: "crm-bar " + (p.std >= 0 ? "pos" : "neg") }, [el("i", { style: "width:" + w + "%" })]), el("span", { class: "num crm-std", text: (p.std >= 0 ? "+" : "−") + NF1.format(Math.abs(p.std)) })])
        ]));
      });
      tbl.appendChild(tb); box.appendChild(el("div", { class: "az-tablewrap" }, [tbl]));
      box.appendChild(el("p", { class: "crm-note" }, [el("span", { class: "crm-dot" }), " Highlighted rows are used to find similar ZIPs. ",
        el("button", { class: "crm-linkbtn", type: "button", text: showAll ? "Show the top 12" : "Show all characteristics, including health estimates", onclick: function () { showAll = !showAll; draw(); } })]));
      if (R.bands.length > 1) {
        box.appendChild(el("h4", { text: "How distance affects your customers" }));
        box.appendChild(el("p", { class: "crm-note", text: R.halfMiles
          ? "Your customer rate halves about every " + NF1.format(R.halfMiles) + " miles from your nearest location. Bars show your actual rate at each distance; the line shows the smooth curve used for expected customers."
          : "Distance from your locations makes little difference to your customer rate, so every ZIP gets the same expected rate." }));
        var max = Math.max.apply(null, R.bands.map(function (b) { return Math.max(b.raw, b.fit); })) || 1;
        box.appendChild(el("div", { class: "crm-bands" }, R.bands.map(function (b) {
          return el("div", { class: "crm-band" }, [el("span", { text: b.from + "–" + b.to + " mi" }),
            el("span", { class: "crm-bar pos crm-fitbar" }, [el("i", { style: "width:" + Math.round(b.raw / max * 100) + "%" }),
              el("b", { class: "crm-fitmark", style: "left:" + Math.round(b.fit / max * 100) + "%", title: "Expected: " + NF1.format(b.fit * 1000) + " per 1,000" })]),
            el("span", { class: "num", text: NF1.format(b.raw * 1000) + " per 1,000" })]);
        })));
      }
    };
    draw();
    return box;
  }

  var perfSort = { key: "E", dir: -1 }, simFilter = "opp";
  function perfPanel() {
    var box = el("section", { class: "az-panel crm-table-panel", id: "crm-perf" });
    drawPerf(box);
    return box;
  }
  function drawPerf(box) {
    box = box || $("crm-perf"); box.innerHTML = "";
    var R = S.res, hv = S.hasValue;
    var cols = [["zip", "ZIP"], ["city", "Town"], ["d", "Miles"], ["A", "Customers"], ["E", "Expected"], ["idx", "Index"], ["status", "Status"], ["B", BASES[R.o.base].label], ["pen", "Per 1,000 households"]];
    if (hv) cols.splice(4, 0, ["V", "Sales"]);
    var rows = R.items.slice().sort(function (a, b) {
      var k = perfSort.key, va = k === "zip" ? a.z.zip : k === "city" ? a.z.city : a[k], vb = k === "zip" ? b.z.zip : k === "city" ? b.z.city : b[k];
      return (va > vb ? 1 : va < vb ? -1 : 0) * perfSort.dir;
    });
    var flt = box.dataset.filter || "all";
    if (flt !== "all") rows = rows.filter(function (it) { return it.status === flt; });
    box.appendChild(el("div", { class: "az-table-head" }, [el("h3", { text: "Performance by ZIP" }),
      el("div", { class: "az-seg", role: "group" }, [["all", "All"], ["over", "Over"], ["under", "Under"], ["inline", "In line"]].map(function (f) {
        return el("button", { type: "button", "aria-pressed": flt === f[0] ? "true" : "false", text: f[1], onclick: function () { box.dataset.filter = f[0]; drawPerf(box); } });
      })),
      el("button", { class: "az-btn", type: "button", text: "Export CSV", onclick: function () {
        download("customer-performance-by-zip.csv", [cols.map(function (c) { return c[1]; })].concat(R.items.map(function (it) {
          return cols.map(function (c) { var k = c[0]; return k === "zip" ? it.z.zip : k === "city" ? it.z.city : k === "status" ? STATUS[it.status].label : k === "d" ? (it.d == null ? "" : it.d.toFixed(1)) : k === "idx" ? Math.round(it.idx) : k === "E" ? it.E.toFixed(1) : k === "B" ? Math.round(it.B) : k === "pen" ? it.pen.toFixed(2) : k === "V" ? Math.round(it.V) : it[k]; });
        })));
      } })]));
    var head = el("tr", {}, cols.map(function (c) {
      return el("th", { class: perfSort.key === c[0] ? "sorted" : null, text: c[1] + (perfSort.key === c[0] ? (perfSort.dir > 0 ? " ▲" : " ▼") : ""), tabindex: 0,
        onclick: function () { perfSort = { key: c[0], dir: perfSort.key === c[0] ? -perfSort.dir : -1 }; drawPerf(box); } });
    }));
    var tb = el("tbody");
    rows.slice(0, 400).forEach(function (it) {
      tb.appendChild(el("tr", { onclick: function () { flash(it.z.zip); } }, cols.map(function (c) {
        var k = c[0];
        if (k === "zip") return el("td", { class: "num", text: it.z.zip });
        if (k === "city") return el("td", { text: it.z.city });
        if (k === "status") return el("td", {}, [el("span", { class: "crm-pill " + it.status, text: STATUS[it.status].label })]);
        var v = it[k];
        return el("td", { class: "num", text: k === "d" ? (v == null ? "—" : NF1.format(v)) : k === "E" ? NF1.format(v) : k === "pen" ? NF1.format(v) : k === "V" ? "$" + NF0.format(v) : NF0.format(v) });
      })));
    });
    box.appendChild(el("div", { class: "az-tablewrap" }, [el("table", { class: "az-table" }, [el("thead", {}, [head]), tb])]));
    if (rows.length > 400) box.appendChild(el("p", { class: "crm-note", text: "Showing 400 of " + NF0.format(rows.length) + " ZIPs; the CSV has all of them." }));
  }

  function simPanel() {
    var box = el("section", { class: "az-panel crm-table-panel", id: "crm-sim" });
    drawSim(box);
    return box;
  }
  function drawSim(box) {
    box = box || $("crm-sim"); box.innerHTML = "";
    var R = S.res;
    var rows = R.cand.filter(function (c) { return simFilter === "all" || c.opp; });
    box.appendChild(el("div", { class: "az-table-head" }, [el("h3", { text: "ZIPs that look like your strongest ones" }),
      el("div", { class: "az-seg", role: "group" }, [["opp", "Untapped or under-performing"], ["all", "All ZIPs in the search area"]].map(function (f) {
        return el("button", { type: "button", "aria-pressed": simFilter === f[0] ? "true" : "false", text: f[1], onclick: function () { simFilter = f[0]; drawSim(box); } });
      })),
      el("button", { class: "az-btn", type: "button", text: "Copy ZIP list", onclick: function () {
        var t = rows.slice(0, 200).map(function (c) { return c.z.zip; }).join(", ");
        navigator.clipboard.writeText(t).then(function () { flashMsg(box, "Copied " + Math.min(200, rows.length) + " ZIPs."); });
      } }),
      el("button", { class: "az-btn primary", type: "button", text: "Export CSV", onclick: function () {
        download("similar-zips.csv", [["ZIP", "Town", "State", "Miles", "Similarity", "Customers", "Index", "Status", "Households", "Opportunity"]].concat(rows.map(function (c) {
          return [c.z.zip, c.z.city, c.z.state, c.d == null ? "" : c.d.toFixed(1), Math.round(c.sim), c.A, c.idx == null ? "" : Math.round(c.idx), c.status ? STATUS[c.status].label : "Outside trade area", c.z.hh, c.opp ? "Yes" : ""];
        })));
      } })]));
    box.appendChild(el("p", { class: "crm-note", text: R.simKeys.length
      ? "Similarity (0–100) compares each ZIP with your strongest ZIPs on the " + R.simKeys.length + " characteristics that best set them apart (closely related measures are counted once): " + R.simKeys.map(function (p) { return p.f.label; }).join("; ") + ". 'Untapped' means a similarity of 60+ with no customers yet, or under-performing in your trade area."
      : "Your strongest ZIPs don't differ enough from the rest of your trade area to build a profile; similarity can't be scored." }));
    var tb = el("tbody");
    rows.slice(0, 300).forEach(function (c) {
      tb.appendChild(el("tr", { onclick: function () { flash(c.z.zip); } }, [
        el("td", { class: "num", text: c.z.zip }), el("td", { text: c.z.city + ", " + c.z.state }), el("td", { class: "num", text: c.d == null ? "—" : NF1.format(c.d) }),
        el("td", {}, [el("span", { class: "crm-bar pos" }, [el("i", { style: "width:" + Math.round(c.sim) + "%" })]), el("span", { class: "num crm-std", text: NF0.format(c.sim) })]),
        el("td", { class: "num", text: NF0.format(c.A) }), el("td", { class: "num", text: c.idx == null ? "—" : NF0.format(c.idx) }),
        el("td", {}, [c.status ? el("span", { class: "crm-pill " + c.status, text: STATUS[c.status].label }) : el("span", { class: "crm-pill out", text: "Outside trade area" })]),
        el("td", { class: "num", text: NF0.format(c.z.hh) })
      ]));
    });
    box.appendChild(el("div", { class: "az-tablewrap" }, [el("table", { class: "az-table" }, [el("thead", {}, [el("tr", {}, ["ZIP", "Town", "Miles", "Similarity", "Customers", "Index", "Status", "Households"].map(function (h) { return el("th", { text: h }); }))]), tb])]));
    if (!rows.length) box.appendChild(el("p", { class: "az-empty", text: "No untapped look-alike ZIPs in this search area. Widen the search area in step 2 or switch to all ZIPs." }));
  }
  function flashMsg(box, t) { var p = el("p", { class: "crm-toast", text: t }); box.appendChild(p); setTimeout(function () { p.remove(); }, 2500); }

  /* ---------- maps ---------- */
  // Map keys: "l" = how the advertiser is doing (shown on the right), "r" = where the potential is (shown on the left). Panning or zooming one moves the other.
  var MAPS = {
    l: { title: "Your customers", mode: "pen", modes: function () {
      return [["pen", "Customers per 1,000 households"]].concat(S.hasValue ? [["spend", "Sales per household"]] : []).concat([["status", "Performance vs. expected"]]); } },
    r: { title: "Market potential", mode: "pot", modes: function () {
      return [["pot", BASES[S.res.o.base].label + " per ZIP"], ["sim", "Similarity to your strongest ZIPs"]]; } }
  };
  // Teal for your customers (right-hand map), navy-blue for market potential and similarity (left-hand map)
  var RAMPS = { l: ["#dff1ee", "#a9dcd4", "#5fb8ac", "#1f8f81", "#0b5d53"], r: ["#e3eaf4", "#b5c7e0", "#7b98c2", "#3f629a", "#173a6b"] };
  var RAMP = RAMPS.l, NONE = "#eef2f5", OUTSIDE = "#f6f8fa";
  function mapPanel(side) {
    var M = MAPS[side];
    M.mode = M.modes()[0][0];
    var seg = el("div", { class: "az-seg crm-seg", role: "group", "aria-label": M.title + " map shows" }, M.modes().map(function (m) {
      return el("button", { type: "button", "aria-pressed": m[0] === M.mode ? "true" : "false", text: m[1], onclick: function () {
        Array.prototype.forEach.call(this.parentNode.children, function (x) { x.setAttribute("aria-pressed", "false"); });
        this.setAttribute("aria-pressed", "true"); M.mode = m[0]; styleMap(side); } });
    }));
    return el("section", { class: "az-panel crm-map-panel" }, [
      el("div", { class: "crm-map-head" }, [el("h3", { text: M.title }), seg]),
      el("div", { class: "az-map crm-map", id: "crm-map-" + side }),
      el("div", { class: "crm-legend", id: "crm-legend-" + side })]);
  }
  // value shown for a ZIP in a given mode (null = no data)
  function mapValue(zip, mode) {
    var e = S.byZip[zip]; if (!e) return null;
    if (mode === "pen") return e.it ? e.it.pen : null;
    if (mode === "spend") return e.it ? e.it.V / e.it.z.hh : null;
    if (mode === "pot") return e.it ? e.it.B : (e.c ? e.c.B : null);
    if (mode === "sim") return e.c ? e.c.sim : null;
    return null;
  }
  // five classes: fifths of the trade area's non-zero values (similarity uses fixed steps)
  function breaks(mode) {
    if (mode === "sim") return [20, 40, 60, 75, 90];
    var v = S.res.items.map(function (it) { return mapValue(it.z.zip, mode); }).filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; });
    if (!v.length) return [0, 0, 0, 0];
    return [0.2, 0.4, 0.6, 0.8].map(function (q) { return v[Math.min(v.length - 1, Math.floor(q * v.length))]; });
  }
  function colorFor(side, zip) {
    var M = MAPS[side], e = S.byZip[zip], RAMP = RAMPS[side];
    if (M.mode === "status") return e && e.it ? STATUS[e.it.status].color : OUTSIDE;
    var v = mapValue(zip, M.mode);
    if (v == null) return OUTSIDE;
    if (M.mode === "sim") { if (v < 20) return NONE; for (var i = 4; i >= 0; i--) if (v >= [20, 40, 60, 75, 90][i]) return RAMP[i]; }
    if (v <= 0) return NONE;
    var br = M.br; for (var k = 0; k < br.length; k++) if (v < br[k]) return RAMP[k];
    return RAMP[4];
  }
  function styleFor(side) {
    return function (f) {
      var e = S.byZip[f.properties.zip], inside = !!(e && e.it), M = MAPS[side];
      var show = inside || M.mode === "sim" || M.mode === "pot";
      return { color: "#ffffff", weight: 0.6, fillColor: colorFor(side, f.properties.zip), fillOpacity: show ? 0.9 : 0.35 };
    };
  }
  function styleMap(side) {
    var M = MAPS[side];
    M.br = breaks(M.mode);
    if (M.layer) M.layer.setStyle(styleFor(side));
    legend(side);
  }
  function drawMaps() {
    var R = S.res;
    ["l", "r"].forEach(function (side) { var M = MAPS[side]; if (M.map) { M.map.remove(); M.map = null; } M.layers = {}; });
    S.byZip = {}; R.items.forEach(function (it) { S.byZip[it.z.zip] = { it: it }; });
    R.cand.forEach(function (c) { (S.byZip[c.z.zip] || (S.byZip[c.z.zip] = {})).c = c; });
    var bounds = L.latLngBounds(R.items.map(function (it) { return [it.z.lat, it.z.lon]; })).pad(0.05);
    var syncing = false;
    ["l", "r"].forEach(function (side) {
      var M = MAPS[side];
      M.map = L.map("crm-map-" + side, { scrollWheelZoom: false, zoomSnap: 0.25 });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap, © CARTO", subdomains: "abcd", maxZoom: 13 }).addTo(M.map);
      M.map.fitBounds(bounds);
      // when a pan or zoom on this map finishes, put the other map in the same place
      M.map.on("moveend", function () {
        if (syncing) return;
        var other = MAPS[side === "l" ? "r" : "l"].map;
        if (!other) return;
        var c = M.map.getCenter(), oc = other.getCenter();
        if (other.getZoom() === M.map.getZoom() && Math.abs(c.lat - oc.lat) < 1e-6 && Math.abs(c.lng - oc.lng) < 1e-6) return;
        syncing = true;
        other.setView(c, M.map.getZoom(), { animate: false });
        syncing = false;
      });
    });
    MAPS.r.map.setView(MAPS.l.map.getCenter(), MAPS.l.map.getZoom(), { animate: false });   // start both in the same place
    var dmas = {}; R.cand.concat(R.items).forEach(function (c) { if (c.z.dma) dmas[c.z.dma] = true; });
    Promise.all(Object.keys(dmas).map(function (d) {
      return fetch(GEO.replace("{id}", d)).then(function (r) { return r.ok ? r.json() : null; }).then(function (t) {
        return t ? topojson.feature(t, t.objects[Object.keys(t.objects)[0]]).features : [];
      }).catch(function () { return []; });
    })).then(function (lists) {
      var feats = [].concat.apply([], lists).filter(function (f) { return S.byZip[f.properties.zip]; });
      ["l", "r"].forEach(function (side) {
        var M = MAPS[side];
        M.br = breaks(M.mode);
        M.layer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
          renderer: feats.length > 1200 ? L.canvas({ padding: 0.3 }) : undefined, style: styleFor(side),
          onEachFeature: function (f, layer) {
            M.layers[f.properties.zip] = layer;
            layer.bindTooltip(function () { return tip(f.properties.zip); }, { sticky: true, opacity: 0.97 });
          }
        }).addTo(M.map);
        R.o.locs.forEach(function (l) {
          var z = S.zips[l];
          L.circleMarker([z.lat, z.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#0f2742", fillOpacity: 1 }).addTo(M.map).bindTooltip("Your location: " + l + " " + z.city);
          if (R.o.radius) L.circle([z.lat, z.lon], { radius: R.o.radius * 1609.34, color: "#0f2742", weight: 1.5, dashArray: "6 6", fill: false, interactive: false }).addTo(M.map);
        });
        legend(side);
      });
    });
  }
  function tip(zip) {
    var e = S.byZip[zip], z = S.zips[zip], R = S.res, h = "<div class='az-tip'><b>" + zip + " " + z.city + "</b><br>";
    if (e.it) {
      h += NF0.format(e.it.A) + " customers (" + NF1.format(e.it.pen) + " per 1,000 households)<br>";
      if (S.hasValue) h += "$" + NF0.format(e.it.V) + " in sales ($" + NF1.format(e.it.V / e.it.z.hh) + " per household)<br>";
      h += NF1.format(e.it.E) + " expected · index " + NF0.format(e.it.idx) + " · " + STATUS[e.it.status].label + "<br>";
      h += BASES[R.o.base].label + ": " + NF0.format(e.it.B) + "<br>";
    } else {
      h += "Outside your trade area<br>";
      if (e.c) h += BASES[R.o.base].label + ": " + NF0.format(e.c.B) + "<br>";
    }
    if (e.c) h += "Similarity " + NF0.format(e.c.sim) + (e.c.opp ? " · untapped" : "");
    return h + "</div>";
  }
  function legend(side) {
    var RAMP = RAMPS[side];
    var M = MAPS[side], box = $("crm-legend-" + side); if (!box) return; box.innerHTML = "";
    var f = M.mode === "spend" ? function (v) { return "$" + NF1.format(v); } : M.mode === "pen" ? function (v) { return NF1.format(v); } : function (v) { return NF0.format(v); };
    var rows;
    if (M.mode === "status") rows = ["over", "inline", "under", "few"].map(function (k) { return [STATUS[k].color, STATUS[k].label]; });
    else if (M.mode === "sim") rows = [[RAMP[4], "90–100"], [RAMP[3], "75–90"], [RAMP[2], "60–75"], [RAMP[1], "40–60"], [RAMP[0], "20–40"], [NONE, "Under 20"]];
    else {
      var b = M.br;
      rows = [[RAMP[4], f(b[3]) + "+"], [RAMP[3], f(b[2]) + "–" + f(b[3])], [RAMP[2], f(b[1]) + "–" + f(b[2])], [RAMP[1], f(b[0]) + "–" + f(b[1])], [RAMP[0], "Under " + f(b[0])]];
      if (M.mode !== "pot") rows.push([NONE, M.mode === "spend" ? "No sales" : "No customers"]);
    }
    var title = { pen: "Customers per 1,000 households", spend: "Sales per household", status: "Performance vs. expected",
                  pot: BASES[S.res.o.base].label + " per ZIP", sim: "Similarity to your strongest ZIPs" }[M.mode];
    box.appendChild(el("b", { text: title }));
    rows.forEach(function (r) { box.appendChild(el("span", { class: "crm-key" }, [el("i", { style: "background:" + r[0] }), r[1]])); });
    if (M.mode !== "status" && M.mode !== "sim") box.appendChild(el("small", { class: "crm-legend-note", text: "Colors split the trade area's ZIPs into fifths." }));
  }
  function flash(zip) {
    var first = MAPS.l.layers && MAPS.l.layers[zip]; if (!first) return;
    $("crm-map-l").scrollIntoView({ behavior: "smooth", block: "center" });
    MAPS.l.map.fitBounds(first.getBounds(), { maxZoom: 11, padding: [60, 60] });
    ["l", "r"].forEach(function (side) {
      var l = MAPS[side].layers[zip]; if (!l) return;
      l.setStyle({ color: "#0f2742", weight: 3 }); l.bringToFront(); if (side === "l") l.openTooltip();
      setTimeout(function () { l.setStyle({ color: "#ffffff", weight: 0.6 }); }, 2500);
    });
  }

  /* ---------- one-page printable summary ---------- */
  function areaText(o) {
    return o.radius ? o.radius + " miles of " + (o.locs.length > 1 ? o.locs.length + " locations (" + o.locs.join(", ") + ")" : o.locs[0] + " " + S.zips[o.locs[0]].city)
      : (o.dmas.length === 1 ? "the " + titleCase(S.list.find(function (z) { return z.dma === o.dmas[0]; }).dma_name) + " DMA" : o.dmas.length + " DMAs");
  }
  function zipName(z) { return z.zip + " " + titleCase(z.city); }
  function buildPrint() {
    var R = S.res, o = R.o, st = S.stats, items = R.items;
    var totB = items.reduce(function (t, it) { return t + it.B; }, 0);
    var over = items.filter(function (it) { return it.status === "over"; }).sort(function (a, b) { return (b.A - b.E) - (a.A - a.E); });
    var under = items.filter(function (it) { return it.status === "under"; }).sort(function (a, b) { return (b.E - b.A) - (a.E - a.A); });
    var opp = R.cand.filter(function (c) { return c.opp; }).slice(0, 8);
    var traits = R.prof.filter(function (p) { return p.f.sim; }).sort(function (a, b) { return Math.abs(b.std) - Math.abs(a.std); }).slice(0, 5);
    var unit = S.countCol ? (S.countName || "customers").toLowerCase() : "customers";
    var name = ($("crm-bizname") && $("crm-bizname").value.trim()) || "Customer market analysis";
    var top = $("crm-print-top"); top.innerHTML = "";
    top.appendChild(el("div", { class: "crm-p-head" }, [
      el("div", {}, [el("div", { class: "crm-p-kicker", text: "Adtaxi Customer Market Analysis" }), el("h1", { text: name }),
        el("div", { class: "crm-p-sub", text: "Trade area: within " + areaText(o) + " \u00b7 Potential measured by " + BASES[o.base].label.toLowerCase() + " \u00b7 " + new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) })]),
      el("img", { src: "../shared/adtaxi-logo.svg", alt: "Adtaxi" })]));
    var k = function (big, lab) { return el("div", { class: "crm-p-kpi" }, [el("b", { text: big }), el("span", { text: lab })]); };
    top.appendChild(el("div", { class: "crm-p-kpis" }, [
      k(NF0.format(R.inMarket), unit + " in the trade area"),
      k(NF1.format(R.inMarket / totB * 1000), "per 1,000 " + BASES[o.base].label.toLowerCase()),
      k(NF0.format(over.length), "over-performing ZIPs"),
      k(NF0.format(under.length), "under-performing ZIPs"),
      k(NF0.format(R.cand.filter(function (c) { return c.opp; }).length), "untapped look-alike ZIPs")]));
    var bot = $("crm-print-bottom"); bot.innerHTML = "";
    var find = [];
    if (R.halfMiles) find.push("Your " + unit + " rate halves about every " + NF1.format(R.halfMiles) + " miles from your nearest location; expected " + unit + " account for this.");
    if (traits.length) find.push((R.weakSignal ? "Tentatively, your" : "Your") + " strongest ZIPs stand out for " + traits.slice(0, 3).map(function (p) {
      return p.f.label.toLowerCase() + " (" + fmt(p.strong, p.f.unit) + " vs. " + fmt(p.market, p.f.unit) + " across the area)"; }).join(", ") + ".");
    if (under.length) find.push("The biggest gaps: " + under.slice(0, 3).map(function (it) { return zipName(it.z) + " (" + NF0.format(it.A) + " vs. " + NF0.format(it.E) + " expected)"; }).join("; ") + ".");
    if (opp.length) find.push("Best untapped look-alikes: " + opp.slice(0, 4).map(function (c) { return zipName(c.z); }).join(", ") + ".");
    if (R.weakSignal) find.push("Caution: the number of over-performing ZIPs is close to what chance alone would produce, so treat the profile as tentative.");
    var tbl = function (title, head, rows) {
      return el("div", { class: "crm-p-tbl" }, [el("h3", { text: title }), el("table", {}, [el("thead", {}, [el("tr", {}, head.map(function (h) { return el("th", { text: h }); }))]),
        el("tbody", {}, rows.length ? rows.map(function (r) { return el("tr", {}, r.map(function (c, i) { return el("td", { class: i ? "num" : null, text: c }); })); }) : [el("tr", {}, [el("td", { colspan: head.length, text: "None" })])])])]);
    };
    bot.appendChild(el("div", { class: "crm-p-grid" }, [
      el("div", { class: "crm-p-find" }, [el("h3", { text: "Key findings" }), el("ul", {}, find.map(function (t) { return el("li", { text: t }); }))]),
      tbl("Over-performing ZIPs", ["ZIP", "Actual", "Expected", "Index"], over.slice(0, 5).map(function (it) { return [zipName(it.z), NF0.format(it.A), NF0.format(it.E), NF0.format(it.idx)]; })),
      tbl("Under-performing ZIPs", ["ZIP", "Actual", "Expected", "Index"], under.slice(0, 5).map(function (it) { return [zipName(it.z), NF0.format(it.A), NF0.format(it.E), NF0.format(it.idx)]; })),
      tbl("Untapped look-alike ZIPs", ["ZIP", "Similarity", "Miles", "Households"], opp.slice(0, 5).map(function (c) { return [zipName(c.z), NF0.format(c.sim), c.d == null ? "\u2014" : NF0.format(c.d), NF0.format(c.z.hh)]; }))]));
    bot.appendChild(el("p", { class: "crm-p-foot", text: "Expected " + unit + " = each ZIP's potential \u00d7 your " + unit + " rate at its distance. Over/under-performing = index of 120+/80 or below and unlikely to be chance (97.5% confidence). Sources: U.S. Census Bureau ACS 5-year, IRS, Census Business Patterns and LEHD, USDA, CDC PLACES, FHFA, Deluxe. Customer data was analyzed in the browser and not stored." }));
  }
  var printSizing = false;
  function fitMapsForPrint(on, done) {
    document.body.classList.toggle("crm-printing", on);
    // wait a frame for the new size to take effect, then resize and re-fit both maps to the trade area
    setTimeout(function () {
      var b = S.res && L.latLngBounds(S.res.items.map(function (it) { return [it.z.lat, it.z.lon]; }));
      ["l", "r"].forEach(function (side) {
        var M = MAPS[side]; if (!M.map) return;
        M.map.invalidateSize({ pan: false, animate: false });
        if (b) M.map.fitBounds(b, { animate: false, padding: on ? [6, 6] : [0, 0] });
      });
      if (done) setTimeout(done, 250);
    }, 60);
  }
  function printSummary() {
    buildPrint();
    fitMapsForPrint(true, function () { window.print(); });   // let the maps redraw at print size first
  }
  window.addEventListener("beforeprint", function () { if (S.res && !document.body.classList.contains("crm-printing")) { buildPrint(); fitMapsForPrint(true); } });
  window.addEventListener("afterprint", function () { if (document.body.classList.contains("crm-printing")) fitMapsForPrint(false); });
  if (location.search.indexOf("debug=1") >= 0) window.__crmPrint = function () { return new Promise(function (res) { buildPrint(); fitMapsForPrint(true, res); }); };

  /* ---------- how it works ---------- */
  function method() {
    var close = function () { m.close(); m.remove(); };
    var src = {}; S.fields.forEach(function (f) { src[f.source + (f.release ? " (" + f.release + ")" : "")] = true; });
    var m = el("dialog", { class: "az-modal", "aria-label": "How it works", onclick: function (e) { if (e.target === m) close(); }, oncancel: function (e) { e.preventDefault(); close(); } }, [
      el("div", { class: "az-modal-body" }, [
        el("button", { class: "az-modal-close", type: "button", "aria-label": "Close", text: "×", onclick: close }),
        el("h2", { text: "How the Customer Market Analyzer works" }),
        el("h3", { text: "Your data stays with you" }),
        el("p", { text: "The customer file is read by your browser. Only ZIP codes and amounts are kept, and only in this page's memory; nothing is sent to a server. Closing the page clears it." }),
        el("h3", { text: "Expected customers" }),
        el("p", { text: "Each ZIP's potential is its households, or the audience you choose, such as homeowners, renters, adults 65+ or households earning $100K+. When you open the tool from a category analyzer, potential starts at that category's core audience (adults 65+ for hearing care, homeowners for home services, renters for apartments and so on). When you give your location ZIPs, the tool fits a smooth curve to your own data showing how your customer rate falls with distance from your nearest location (or finds that distance doesn't matter). A ZIP's expected customers are its potential times the rate on that curve for its distance. This keeps far-away ZIPs from being marked weak just because they're far away." }),
        el("h3", { text: "Performance index" }),
        el("p", { text: "Index = customers ÷ expected × 100, after adding two customers' worth of 'average' to both, so ZIPs with only a handful of customers aren't over-read. Over-performing means an index of 120+ and a customer count that would happen by chance less than 2.5% of the time if the ZIP were average (an exact Poisson test); under-performing means an index of 80 or below on the same test. ZIPs expecting fewer than 1.5 customers with fewer than 3 actual are marked too few to judge." }),
        el("h3", { text: "What your strongest ZIPs have in common" }),
        el("p", { text: "The over-performing ZIPs (or, if there are fewer than five, the top fifth by index) are compared with the whole trade area on every characteristic, weighted by potential. Differences are measured in standard deviations across the trade area's ZIPs, so characteristics with different units can be ranked together. If there are no more over-performing ZIPs than chance would produce, the profile is marked tentative." }),
        el("h3", { text: "Similar ZIPs" }),
        el("p", { text: "Up to 10 characteristics that set your strongest ZIPs apart by at least 0.3 standard deviations form a profile; closely related measures count once, and no group (income, housing and so on) gets more than three. Every ZIP in the search area gets a similarity score from 0 to 100 based on how far it falls short of that profile. Going further in the same direction (more homeowners, say, when homeowners are a strength) is not counted against it. Health estimates and home-price trends are shown but not used for similarity. Race and ethnicity are not included anywhere in this tool." }),
        el("h3", { text: "Things to keep in mind" }),
        el("p", { text: "ZIPs are the unit, so results describe neighborhoods, not individual customers. Census figures are 5-year averages. PO box and business-only ZIPs can't be matched to residents and are skipped. A customer list reflects past marketing as well as demand, so an under-performing ZIP may simply be one you haven't reached yet." }),
        el("h3", { text: "Sources" }),
        el("ul", {}, Object.keys(src).map(function (s) { return el("li", { text: s }); })),
        el("p", { class: "crm-note", text: "ZIP data built " + S.built + "." })
      ])
    ]);
    document.body.appendChild(m);
    m.showModal();
  }

  boot();
})();
