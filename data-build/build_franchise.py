"""Builds the Franchise Development Analyzer data: where a franchise system's best owner candidates are, and how its
territories compare, to focus franchise-development ad dollars.

Reusable: the national levels (DMA, metro, county, ZIPs in market) are the same for every franchise system. Each client
adds a settings file in data-build/franchise/<client>.json naming its territories (whole states, Census metros or
counties), the kinds of businesses that buy its service, and the industry codes of its competitors. The build writes
that client's Territory level into franchise/<client>/data/.

Two owner profiles (the analyzer's "Owner profile" selector):
  exec   Master and multi-unit owners: established executives with capital (householders 45-64 earning $125K+,
         returns with income of $200K+, returns with capital gains)
  owner  Single-unit owner-operators (householders 25-64 earning $100K+, returns with business or self-employment income)

Score = 50% Candidates + 30% Territory Opportunity + 20% Competition, each a percentile among areas at the same level.
  Candidates: the profile's inputs above, count and concentration.
  Territory Opportunity: the client's buyer businesses and the jobs in those industries (count) and buyer businesses
    per 1,000 residents. Without a client (national page) the buyers are all businesses with employees.
  Competition: competitor establishments per 1,000 buyer businesses, reversed (fewer scores higher).
ZIPs in market use Candidates only (they're for targeting where candidates live).

Sources, all already in the repo (data-build/master, built by the "Build master ZIP data" action): Census ACS 5-year
(age of householder by household income, veterans), IRS Statistics of Income by ZIP, Census ZIP Code Business Patterns
(establishments by sector and by 6-digit industry), Census LODES jobs by sector. Land area: Census Gazetteer (downloaded;
density is left blank if it can't be reached). No keys.

  python3 data-build/build_franchise.py                 # all clients in data-build/franchise/
  python3 data-build/build_franchise.py --cache DIR     # read saved downloads from DIR (tests)
"""
import argparse, datetime, glob, json, os, re, sys
import numpy as np
import pandas as pd
from build_healthcare import pct, combine, zcta_land
from county_level import county_frame, county_mask, county_checks, county_flag, county_names, mark_unranked

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO, MASTER, CLIENTS = os.path.join(HERE, "geo"), os.path.join(HERE, "master"), os.path.join(HERE, "franchise")
OUT = os.path.join(ROOT, "franchise", "data")
MIN_POP = 500
WEIGHTS = {"demand": 0.50, "category": 0.30, "comp": 0.20}
SUBCATS = [
    {"id": "exec", "label": "Master and multi-unit owners", "demand": ["x125", "x125_share", "hi200_share", "cg_share"]},
    {"id": "owner", "label": "Single-unit owner-operators", "demand": ["o100", "o100_share", "selfemp_share"]},
]
# Census LODES job sectors (CNS codes) by 2-digit NAICS sector
LODES_SECTOR = {"11": "cns01", "21": "cns02", "22": "cns03", "23": "cns04", "31": "cns05", "42": "cns06", "44": "cns07",
                "48": "cns08", "51": "cns09", "52": "cns10", "53": "cns11", "54": "cns12", "55": "cns13", "56": "cns14",
                "61": "cns15", "62": "cns16", "71": "cns17", "72": "cns18", "81": "cns19"}
ALL_SECTORS = list(LODES_SECTOR)
NATIONAL_COMPETITORS = []   # national page: no competitor industry, so Competition is left out and weights re-scale
SUMS = ["population", "households", "hh_tot", "hh4564", "hh2564", "x125", "o100", "returns", "hi200", "cg", "selfemp",
        "vets", "vet_tot", "buyers", "buyer_jobs", "est_all", "comp_est"]
COUNTS = ["population", "households", "x125", "o100", "hi200", "cg", "selfemp", "vets", "buyers", "buyer_jobs", "comp_est", "returns"]
RATE_PARTS = {"x125_share": ("x125", "hh4564"), "o100_share": ("o100", "hh2564"), "hi200_share": ("hi200", "returns"),
              "cg_share": ("cg", "returns"), "selfemp_share": ("selfemp", "returns"), "vet_share": ("vets", "vet_tot")}
IRS = {"irs_n1": "returns", "irs_n1_stub6": "hi200", "irs_n01000": "cg", "irs_n00900": "selfemp"}
IRS_KEYS = set(IRS.values()) - {"returns"}


def log(*a): print(*a, flush=True)


def self_test():
    s = pct(pd.Series([10, 20, 30, 40, np.nan]))
    assert list(s[:4]) == [25.0, 50.0, 75.0, 100.0] and np.isnan(s[4]), s
    c = combine([pd.Series([100.0, np.nan]), pd.Series([0.0, 50.0])], [0.50, 0.20])
    assert abs(c[0] - 50 / 0.70) < 1e-9 and c[1] == 50.0, c
    assert abs(sum(WEIGHTS.values()) - 1) < 1e-9
    return "percentile and weighted-average hand checks reproduce exactly"


def load_zips(cache, rep):
    z = pd.read_csv(os.path.join(GEO, "zip_geo.csv"), dtype={"zip": str, "county_fips": str, "cbsa_code": str, "dma_code": str})
    z["cbsa_code"] = z.cbsa_code.fillna(""); z["dma_code"] = z.dma_code.fillna("0")
    b = lambda n: f"B19037_E{n:03d}"
    acs_cols = [b(n) for n in (1, 19, 36, 32, 33, 34, 35, 49, 50, 51, 52)] + ["B21001_E001", "B21001_E002"]
    acs = pd.read_csv(os.path.join(MASTER, "zip_acs.csv.gz"), dtype={"zip": str}, usecols=["zip"] + acs_cols)
    m = pd.DataFrame({"zip": acs.zip})
    m["hh_tot"], m["hh4564"] = acs[b(1)], acs[b(36)]
    m["hh2564"] = acs[b(19)] + acs[b(36)]
    m["x125"] = acs[b(50)] + acs[b(51)] + acs[b(52)]                               # householder 45-64, $125K+
    m["o100"] = acs[[b(n) for n in (32, 33, 34, 35, 49, 50, 51, 52)]].sum(axis=1, min_count=8)   # householder 25-64, $100K+
    m["vet_tot"], m["vets"] = acs.B21001_E001, acs.B21001_E002
    z = z.merge(m, on="zip", how="left")
    irs = pd.read_csv(os.path.join(MASTER, "zip_irs.csv.gz"), dtype={"zip": str}, usecols=["zip"] + list(IRS)).rename(columns=IRS)
    z = z.merge(irs, on="zip", how="left")
    cbp = pd.read_csv(os.path.join(MASTER, "zip_cbp.csv.gz"), dtype={"zip": str})
    keep = ["zip", "cbp_establishments"] + [c for c in cbp.columns if re.fullmatch(r"cbp_est_\d\d", c)]
    z = z.merge(cbp[keep], on="zip", how="left")
    lod = pd.read_csv(os.path.join(MASTER, "zip_lodes.csv.gz"), dtype={"zip": str})
    z = z.merge(lod[["zip"] + [c for c in lod.columns if re.fullmatch(r"lodes_wac_cns\d\d", c)]], on="zip", how="left")
    naics = pd.read_csv(os.path.join(MASTER, "cbp_zip_naics.csv.gz"), dtype={"zip": str, "naics": str}, usecols=["zip", "naics", "est"])
    try:
        z["land"] = z.zip.map(zcta_land(cache, rep))
    except Exception as e:
        z["land"] = np.nan
        rep.append(("Land area (Census Gazetteer)", "INFO", f"not available here ({str(e)[:80]}); households per square mile left blank"))
    # ZIP Business Patterns lists every ZIP with establishments; a ZIP with residents but no row has none
    has = z.population.fillna(0) > 0
    for c in [c for c in z.columns if c.startswith("cbp_") or c.startswith("lodes_")]: z.loc[has, c] = z.loc[has, c].fillna(0)
    return z, naics


def set_concept(z, naics, sectors, comp_codes):
    """Buyer businesses and jobs (the client's sectors) and competitor establishments for every ZIP."""
    z["buyers"] = z[[f"cbp_est_{s}" for s in sectors]].sum(axis=1, min_count=1)
    z["buyer_jobs"] = z[[f"lodes_wac_{LODES_SECTOR[s]}" for s in sectors]].sum(axis=1, min_count=1)
    z["est_all"] = z.cbp_establishments
    if comp_codes:
        z["comp_est"] = z.zip.map(naics[naics.naics.isin(comp_codes)].groupby("zip").est.sum()).fillna(0)
    else:
        z["comp_est"] = np.nan
    return z


def agg(g):
    r = {c: g[c].sum(min_count=1) for c in SUMS}
    land = g.land.where(g.land > 0).sum()
    r["density"] = g.households.where(g.land > 0, 0).sum() / land if land > 0 else np.nan
    irs_ok = g.returns.notna()
    for k, (n, d) in RATE_PARTS.items():
        if n in IRS_KEYS:
            den = g.returns[irs_ok].sum(); r[k] = g[n][irs_ok].sum() / den if den > 0 else np.nan
        else:
            ok = g[n].notna() & g[d].notna(); den = g[d][ok].sum()
            r[k] = g[n][ok].sum() / den if den > 0 else np.nan
    pop = r["population"]
    r["buyers_per1k"] = r["buyers"] / pop * 1000 if pop and pop > 0 and r["buyers"] == r["buyers"] else np.nan
    r["comp_per1k"] = r["comp_est"] / r["buyers"] * 1000 if r["buyers"] and r["buyers"] > 0 and r["comp_est"] == r["comp_est"] else np.nan
    return r


def frame(groups):
    return pd.DataFrame.from_dict({k: agg(g) for k, g in groups}, orient="index")


def score(df, parts=tuple(WEIGHTS), mask=None):
    if mask is None: mask = pd.Series(True, index=df.index)
    P = lambda s: pct(s.where(mask))
    dem = {k: P(df[k]) for s in SUBCATS for k in s["demand"] if k in df.columns}
    opp = combine([P(df.buyers), P(df.buyer_jobs), P(df.buyers_per1k)], [1, 1, 1]) if "category" in parts else None
    has_comp = "comp" in parts and df.comp_per1k.notna().any()
    comp = P(-df.comp_per1k) if has_comp else None
    for s in SUBCATS:
        i = s["id"]
        ins = [dem[k] for k in s["demand"] if k in dem and df[k].notna().any()]
        df[f"demand@{i}"] = combine(ins, [1] * len(ins)) if ins else np.nan
        df[f"category@{i}"] = opp if opp is not None else np.nan
        df[f"comp@{i}"] = comp if comp is not None else np.nan
        df[f"est@{i}"] = df.comp_est
        df[f"per1k@{i}"] = df.comp_per1k
        use = [c for c in WEIGHTS if c in parts and not (c == "comp" and not has_comp)]
        cols = [df[f"{c}@{i}"] for c in use]
        full = pd.concat(cols, axis=1).notna().all(axis=1)
        df[f"score@{i}"] = combine(cols, [WEIGHTS[c] for c in use]).where(full & mask).round(3)
        for c in WEIGHTS: df[f"{c}@{i}"] = df[f"{c}@{i}"].round(2)
        if has_comp:
            under = (df[f"demand@{i}"] >= 70) & (P(df.comp_per1k) <= 30)
            known = df[f"demand@{i}"].notna() & df.comp_per1k.notna() & mask
            df[f"under@{i}"] = np.where(under & known, "Yes", np.where(known, "No", None))
    return df


RATES = list(RATE_PARTS) + ["buyers_per1k", "comp_per1k", "density"]
KEEP = COUNTS + RATES
PER_SUB = ["score", "demand", "category", "comp", "under", "est", "per1k"]
SCORE_KEYS = ("score", "demand", "category", "comp")


def clean(v):
    if v is None: return None
    if isinstance(v, str): return v
    if isinstance(v, (float, np.floating)):
        if not np.isfinite(v): return None
        v = float(v)
        return round(v, 3) if abs(v) < 1 else round(v, 2) if abs(v) < 100 else round(v)
    if isinstance(v, np.integer): return int(v)
    return v


def rows(df, names, flags_fn=None):
    out = []
    for idx, r in df.iterrows():
        v = {}
        for c in KEEP:
            if c in df.columns:
                x = clean(r[c]); v[c] = int(round(x)) if c in COUNTS and x is not None else x
        for s in SUBCATS:
            for p in PER_SUB:
                k = f"{p}@{s['id']}"
                if k in df.columns:
                    x = clean(r[k])
                    if x is not None and p in SCORE_KEYS: x = round(x, 3 if p == "score" else 2)
                    elif x is not None and p == "est": x = int(round(x))
                    v[k] = x
        v = {k: x for k, x in v.items() if x is not None}
        out.append({"id": str(idx), "name": names(idx), "v": v, "f": flags_fn(idx, r) if flags_fn else []})
    return out


def dump(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path, "w"), separators=(",", ":"))


def zip_frame(z):
    zz = z.drop_duplicates("zip").set_index("zip")
    zf = pd.DataFrame(index=zz.index)
    for c in SUMS: zf[c] = zz[c]
    zf["density"] = (zz.households / zz.land).where(zz.land > 0)
    for k, (n, d) in RATE_PARTS.items(): zf[k] = (zz[n] / zz[d]).where(zz[d] > 0)
    zf["buyers_per1k"] = (zz.buyers / zz.population * 1000).where(zz.population > 0)
    zf["comp_per1k"] = (zz.comp_est / zz.buyers * 1000).where(zz.buyers > 0)
    return zf


def write_zip_files(z, zf, groups, folder, level):
    n = 0
    for code, g in groups:
        f = zf.loc[g.zip.drop_duplicates()].copy()
        gq = f.households.fillna(0) < 0.15 * f.population      # mostly group quarters: shown, not ranked
        ok = (f.population >= MIN_POP) & ~gq
        f = score(f, parts=("demand",), mask=ok)
        city = g.drop_duplicates("zip").set_index("zip").city.fillna("")
        out = rows(f, lambda i: f"{i} {city.get(i, '')}".strip())
        for row in out:
            if f.loc[row["id"], "population"] < MIN_POP:
                row["u"] = 1; row["f"].append(f"Fewer than {MIN_POP} residents, so this ZIP isn't ranked.")
            elif gq.get(row["id"], False):
                row["u"] = 1; row["f"].append("Mostly group quarters (a campus, base or institution, with few households), so this ZIP isn't ranked.")
            for s in SUBCATS:
                for p in ("category", "comp", "under"): row["v"].pop(f"{p}@{s['id']}", None)
        dump({"level": "zip", "parent": {"level": level, "id": code}, "rows": out}, os.path.join(folder, f"{code}.json"))
        n += 1
    return n


def territory_zips(z, t, states_of_county):
    if t.get("states"): sel = z.state.isin(t["states"])
    elif t.get("cbsa"): sel = z.cbsa_code.isin(t["cbsa"]) & (z.state == t["state"])   # metro parts inside the listed state
    else: sel = z.county_fips.isin(t["counties"])
    return z[sel & z.county_fips.notna() & (z.county_fips.astype(str).str.len() == 5)]


def report(path, title, rep, built):
    failed = [r for r in rep if r[1] == "FAIL"]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(f"# {title}\n\nBuilt {built}. Result: **{'FAILED' if failed else 'PASSED'}**\n\n| Check | Result | Detail |\n| --- | --- | --- |\n")
        for r in rep: f.write(f"| {r[0]} | {r[1]} | {r[2]} |\n")
    for r in rep: log(f"[{r[1]}] {r[0]}: {r[2]}")
    return failed


def main():
    ap_ = argparse.ArgumentParser(); ap_.add_argument("--cache"); ap_.add_argument("--client", help="build only this client")
    a = ap_.parse_args()
    built = datetime.date.today().isoformat()
    rep = [("Formula tests", "PASS", self_test())]
    z0, naics = load_zips(a.cache, rep)
    irs_ty = re.search(r"IRS income tax statistics \| built \| tax year (\d{4})", open(os.path.join(MASTER, "master_report.md")).read())
    acs_rel = pd.read_csv(os.path.join(MASTER, "field_dictionary.csv")).query("column == 'B19037_E001'").release.iloc[0]
    meta = {"built": built, "acsYears": acs_rel.replace("5-year ", ""), "irsYear": irs_ty.group(1) if irs_ty else "", "cbpYear": 2023}

    # ---------------- National levels (every franchise system) ----------------
    z = set_concept(z0.copy(), naics, ALL_SECTORS, NATIONAL_COMPETITORS)
    met_list = pd.read_csv(os.path.join(GEO, "metro_list.csv"), dtype={"cbsa_code": str})
    metros = set(met_list[met_list.cbsa_type == "Metro"].cbsa_code)
    dma_list = pd.read_csv(os.path.join(GEO, "dma_list.csv"), dtype={"dma_code": str})
    zd, zm = z[z.dma_code != "0"], z[z.cbsa_code.isin(metros)]
    parts = ("demand", "category")
    dma = score(frame(zd.groupby("dma_code")), parts=parts)
    met = score(frame(zm.groupby("cbsa_code")), parts=parts)
    cty = county_frame(z, frame); cty = score(cty, parts=parts, mask=county_mask(cty))
    us = frame([("us", z)])
    U = lambda k: float(us[k].iloc[0])
    for k, lo, hi in (("x125_share", .28, .50), ("o100_share", .30, .55), ("hi200_share", .04, .12), ("cg_share", .10, .28),
                      ("selfemp_share", .12, .25), ("vet_share", .04, .09)):
        rep.append((f"U.S. {k}", "PASS" if lo <= U(k) <= hi else "FAIL", f"{U(k):.1%} (expected {lo:.0%}–{hi:.0%})"))
    rep.append(("U.S. businesses with employees (ZIP Business Patterns)", "PASS" if 7.0e6 <= U("est_all") <= 9.0e6 else "FAIL", f"{U('est_all'):,.0f} (expected 7–9 million)"))
    rep.append(("U.S. householders 45–64 earning $125K+", "PASS" if 10e6 <= U("x125") <= 22e6 else "FAIL", f"{U('x125'):,.0f}"))
    for name, df in (("DMA", dma), ("Metro", met)):
        sc = df[[f"score@{s['id']}" for s in SUBCATS]]
        bad = int(((sc < 0) | (sc > 100)).sum().sum())
        rep.append((f"{name} scores within 0–100", "PASS" if bad == 0 else "FAIL", f"{bad} out of range; {int(sc.notna().sum().sum()):,} computed"))
    for s in SUBCATS:
        d = dma.sort_values(f"score@{s['id']}", ascending=False)
        rep.append((f"Top DMAs: {s['label']}", "INFO", ", ".join(dma_list.set_index("dma_code").dma_name.get(x, x).title() for x in d.index[:5])))
    county_checks(rep, cty, [s["id"] for s in SUBCATS])
    os.makedirs(OUT, exist_ok=True)
    if report(os.path.join(OUT, "franchise_report.md"), "Franchise Development data check report (national)", rep, built):
        sys.exit("A check failed; the franchise data was not updated. See franchise/data/franchise_report.md.")
    dname = dma_list.set_index("dma_code").dma_name
    tidy = lambda n: re.sub(r"(, )([A-Za-z]{2})\b", lambda m: m.group(1) + m.group(2).upper(), str(n).title())
    mname = met_list.set_index("cbsa_code").cbsa_name
    cname = county_names()
    dump({"level": "dma", "meta": meta, "rows": rows(dma, lambda i: tidy(dname.get(i, i)))}, os.path.join(OUT, "dma.json"))
    dump({"level": "metro", "meta": meta, "rows": rows(met, lambda i: mname.get(i, i))}, os.path.join(OUT, "metro.json"))
    dump({"level": "county", "meta": meta, "rows": mark_unranked(rows(cty, lambda i: cname.get(str(i), str(i)), lambda i, r: county_flag(r)), cty)}, os.path.join(OUT, "county.json"))
    dump({"level": "us", "meta": meta, "rows": rows(us, lambda i: "United States")}, os.path.join(OUT, "us.json"))
    zf = zip_frame(z)
    nz = sum(write_zip_files(z, zf, src.groupby(col), os.path.join(OUT, "zip", lv), lv)
             for lv, col, src in (("dma", "dma_code", zd), ("metro", "cbsa_code", zm), ("county", "county_fips", z[z.county_fips.astype(str).str.len() == 5])))
    log(f"National: {len(dma)} DMAs, {len(met)} metros, {len(cty)} counties, {nz} ZIP files")

    # ---------------- Clients: territories ----------------
    for path in sorted(glob.glob(os.path.join(CLIENTS, "*.json"))):
        c = json.load(open(path))
        if a.client and c["id"] != a.client: continue
        crep = [("Formula tests", "PASS", self_test())]
        cout = os.path.join(ROOT, "franchise", c["id"], "data")
        zc = set_concept(z0.copy(), naics, c["buyers"]["sectors"], c["competitors"]["naics"])
        groups, county_lists, seen = [], {}, {}
        for t in c["territories"]:
            g = territory_zips(zc, t, None)
            if g.empty: crep.append((f"Territory {t['name']}", "FAIL", "no ZIPs matched its definition")); continue
            groups.append((t["id"], g)); county_lists[t["id"]] = sorted(g.county_fips.astype(str).unique())
            for zp in g.zip.unique(): seen.setdefault(zp, []).append(t["id"])
        overlap = {k: v for k, v in seen.items() if len(v) > 1}
        crep.append(("Territories that share ZIPs", "PASS" if not overlap else "FAIL", f"{len(overlap)} ZIPs in more than one territory" + (f": {list(overlap.items())[:3]}" if overlap else "")))
        ter = score(frame(groups))
        for s in SUBCATS:
            sc = ter[f"score@{s['id']}"]
            crep.append((f"Territory scores: {s['label']}", "PASS" if sc.notna().sum() == len(ter) and sc.between(0, 100).all() else "FAIL",
                         f"{int(sc.notna().sum())} of {len(ter)} scored; top: " + ", ".join(next(t['name'] for t in c['territories'] if t['id'] == i) for i in ter.sort_values(f'score@{s["id"]}', ascending=False).index[:5])))
        cz = zc.comp_est.sum()
        crep.append((f"U.S. {c['competitors']['label'].lower()}", "INFO", f"{cz:,.0f} establishments (industry {', '.join(c['competitors']['naics'])})"))
        crep.append(("Pending territories (not drawn)", "INFO", ", ".join(c.get("pending", [])) or "none"))
        if report(os.path.join(cout, "franchise_report.md"), f"Franchise Development data check report: {c['client']}", crep, built):
            sys.exit(f"A check failed for {c['client']}; see franchise/{c['id']}/data/franchise_report.md.")
        tmeta = dict(meta, client=c["client"])
        byid = {t["id"]: t for t in c["territories"]}
        def tflags(i, r):
            t = byid[i]; return [t["note"]] if t.get("note") else []
        dump({"level": "territory", "meta": tmeta, "rows": rows(ter, lambda i: byid[i]["name"], tflags)}, os.path.join(cout, "territory.json"))
        dump({"level": "us", "meta": tmeta, "rows": rows(frame([("us", zc)]), lambda i: "United States")}, os.path.join(cout, "us.json"))
        dump({"counties": county_lists, "names": {i: byid[i]["name"] for i in county_lists}}, os.path.join(cout, "territory_counties.json"))
        nt = write_zip_files(zc, zip_frame(zc), groups, os.path.join(cout, "zip", "territory"), "territory")
        log(f"{c['client']}: {len(ter)} territories, {nt} ZIP files")


if __name__ == "__main__":
    main()
