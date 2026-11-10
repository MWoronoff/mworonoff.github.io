#!/usr/bin/env python3
"""Build shared/media/newspapers.json from the NMS circulation-by-ZIP workbook (and, later, web uniques by ZIP).

Usage: python3 data-build/build_newspapers.py
Inputs:
  data-build/sources/newspapers/nms_circulation_by_zip.xlsx   sheet "By ZIP" (NMS export, one row per paper/day/ZIP)
  data-build/sources/newspapers/web/*.csv                     optional: columns paper, zip, uniques (monthly unique visitors)
  shared/geo/zip_market.json                                  ZIP -> [county, metro, DMA]
Output (one file, read by shared/engine.js and shared/radius.js):
  papers: list of {id, name, city, st, asOf, days, wk, free, home, off, webAsOf}
     days = reported days in display order (Sun, the main weekday, other days; "Web" when web uniques are loaded)
     off  = copies per day not assigned to a ZIP (e-edition "Digital Replica" and "all other" lines)
  zip / county / metro / dma: {areaId: {paperIndex: [value per entry in that paper's days]}}
Penetration is worked out on the page against each analyzer's own household counts.
"""
import csv, glob, json, os, re, sys, collections, datetime
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-build", "sources", "newspapers")
OUT = os.path.join(ROOT, "shared", "media", "newspapers.json")

# Display names: NMS member names lead with the parent paper ("Chicago Tribune - Evanston Review"); show the edition's own name.
RENAME = {
    "The Denver Post/The Sunday Denver Post": "The Denver Post",
    "Boston Herald, Boston Sunday Herald": "Boston Herald",
    "Daily Freeman, Sunday Freeman": "Daily Freeman",
    "Record Sunday Record": "The Record",
    "The Sun, The Sunday Sun": "The Sun (Lowell)",
    "Daily Oakland Press": "The Oakland Press",
    "The Times-Tribune - yes! Your Essential Shopper": "yes! Your Essential Shopper",
}
SUB_RENAME = {"The Sun": "The Sun (San Bernardino)", "Reporter": "The Reporter (Vacaville)", "Times-Herald": "Times-Herald (Vallejo)"}
CITY_SUFFIX = {"The News-Herald": True}       # two papers share this name; add the city
DAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]


def display_name(member, city):
    if member in RENAME:
        return RENAME[member]
    if " - " in member:
        sub = member.split(" - ", 1)[1].strip()
        return SUB_RENAME.get(sub, sub)
    if member in CITY_SUFFIX:
        return member + " (" + city.title() + ")"
    return member


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    zx = json.load(open(os.path.join(ROOT, "shared", "geo", "zip_market.json")))
    wb = openpyxl.load_workbook(os.path.join(SRC, "nms_circulation_by_zip.xlsx"), read_only=True, data_only=True)
    ws = wb["By ZIP"]
    head = None
    papers = collections.OrderedDict()   # key (member, city) -> info
    for r in ws.iter_rows(values_only=True):
        if head is None:
            head = [str(h).strip() if h else "" for h in r]
            ix = {h: i for i, h in enumerate(head)}
            need = ["Member Name", "City Published", "State Published", "Reporting Date", "Frequency Description", "ZIP", "Total Paid", "Total Qualified", "Total Circulation"]
            miss = [n for n in need if n not in ix]
            if miss:
                sys.exit("Missing columns in By ZIP: " + ", ".join(miss))
            continue
        member = r[ix["Member Name"]]
        if not member:
            continue
        city = (r[ix["City Published"]] or "").strip()
        day = (r[ix["Frequency Description"]] or "").strip()[:3].title()
        if day not in DAY_ORDER:
            continue
        p = papers.setdefault((member, city), {"member": member, "city": city, "st": r[ix["State Published"]], "asOf": None,
                                               "zip": collections.defaultdict(collections.Counter), "off": collections.Counter(),
                                               "paid": 0, "qual": 0})
        d = r[ix["Reporting Date"]]
        if isinstance(d, datetime.datetime):
            d = d.date().isoformat()
        p["asOf"] = max(p["asOf"] or "", str(d)[:10])
        z = str(r[ix["ZIP"]] or "").strip()
        circ = r[ix["Total Circulation"]] or 0
        if re.fullmatch(r"\d{5}", z) and not z.startswith("9999"):
            z = z.zfill(5)
            p["zip"][z][day] += circ
            p["paid"] += r[ix["Total Paid"]] or 0
            p["qual"] += r[ix["Total Qualified"]] or 0
        else:
            p["off"][day] += circ      # Digital Replica, "all other states", unknown ZIP

    # Optional web uniques by ZIP: paper (display name or NMS member name), zip, uniques
    web, web_asof = collections.defaultdict(dict), {}
    for f in sorted(glob.glob(os.path.join(SRC, "web", "*.csv"))):
        for row in csv.DictReader(open(f, newline="", encoding="utf-8-sig")):
            k = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            name, z = k.get("paper", ""), k.get("zip", "").zfill(5)
            try:
                u = int(float(k.get("uniques", "").replace(",", "")))
            except ValueError:
                continue
            if name and re.fullmatch(r"\d{5}", z):
                web[name][z] = web[name].get(z, 0) + u
                if k.get("month"):
                    web_asof[name] = max(web_asof.get(name, ""), k["month"])

    out_papers, tables = [], {"zip": {}, "county": {}, "metro": {}, "dma": {}}
    unmatched = collections.Counter()
    for (member, city), p in papers.items():
        days = [d for d in DAY_ORDER if any(p["zip"][z][d] for z in p["zip"])]
        if not days:
            continue
        tot = {d: sum(p["zip"][z][d] for z in p["zip"]) for d in days}
        wkds = [d for d in days if d in WEEKDAYS]
        wk = max(wkds, key=lambda d: tot[d]) if wkds else None
        order = (["Sun"] if "Sun" in days else []) + ([wk] if wk else []) + [d for d in days if d != "Sun" and d != wk]
        name = display_name(member, city)
        w = web.get(name) or web.get(member) or {}
        if w:
            order = order + ["Web"]
        pi = len(out_papers)
        # Home DMA: where most of the paper's copies (its biggest day) land
        big = max(days, key=lambda d: tot[d])
        by_dma = collections.Counter()
        for z, c in p["zip"].items():
            e = zx.get(z)
            if e and e[2]:
                by_dma[e[2]] += c[big]
            else:
                unmatched[name] += c[big]
        home = by_dma.most_common(1)[0][0] if by_dma else None
        total = p["paid"] + p["qual"]
        out_papers.append({"id": slug(name + "-" + city), "name": name, "member": member, "city": city.title(), "st": p["st"],
                           "asOf": p["asOf"], "days": order, "wk": wk, "free": bool(total and p["paid"] / total < 0.5), "home": home,
                           "dmas": [d for d, _ in by_dma.most_common()],
                           "off": {d: p["off"][d] for d in days if p["off"][d]}, "webAsOf": web_asof.get(name) or web_asof.get(member)})
        zips = set(p["zip"]) | set(w)
        for z in zips:
            vals = [p["zip"][z][d] if d != "Web" else w.get(z, 0) for d in order]
            if not any(vals):
                continue
            tables["zip"].setdefault(z, {})[str(pi)] = vals
            e = zx.get(z)
            if not e:
                continue
            for lv, i in (("county", 0), ("metro", 1), ("dma", 2)):
                if e[i]:
                    cur = tables[lv].setdefault(e[i], {}).setdefault(str(pi), [0] * len(order))
                    for j, v in enumerate(vals):
                        cur[j] += v

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    meta = {"built": datetime.date.today().isoformat(), "source": "NMS circulation by ZIP", "papers": len(out_papers)}
    json.dump({"meta": meta, "papers": out_papers, **tables}, open(OUT, "w"), separators=(",", ":"))
    print("papers", len(out_papers), "zips", len(tables["zip"]), "size", os.path.getsize(OUT))
    for name, c in unmatched.most_common(10):
        print("  copies in ZIPs with no market match:", name, c)


if __name__ == "__main__":
    main()
