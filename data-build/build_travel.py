"""Builds the Travel Market Analyzer data (Market Potential Scores) into travel/data/.

The analyzer shows travel businesses where their likely guests live (their feeder markets) and how to focus ad dollars
geographically, for six categories: hotels and lodging, resorts, cruises, casinos, tour operators and visitors bureaus.

A travel business's guests live far from where it operates, so there is no Competition part: a count of hotels in a
feeder market says nothing about that market as a source of guests.

Sources (public with no key, already in the repo, plus Adtaxi's EASI files in data-build/sources):
  - shared/audience/zip_audience.json: Census ACS ages, household incomes and children
  - data-build/sources/gambling_spend_state.csv: gambling spending per person by state, 2025 (BEA; Casinos)
  - Census Gazetteer (downloaded): ZIP land area, for households per square mile
  - data-build/sources/easi_travel_spend_dma.csv / _metro.csv: EASI 2025 household spending on lodging on out-of-town
    trips, other lodging, and public and other transportation
Geography comes from data-build/geo (ZIP -> county, metro, DMA).

  python3 data-build/build_travel.py              # live (GitHub Actions)
  python3 data-build/build_travel.py --cache DIR  # read saved downloads from DIR (tests)
"""
import argparse, datetime, json, os, re, sys
import numpy as np
import pandas as pd
from build_healthcare import pct, combine, zcta_land
from county_level import county_frame, county_mask, county_checks, county_flag, county_names, mark_unranked

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO = os.path.join(HERE, "geo")
OUT = os.path.join(ROOT, "travel", "data")
AUD = os.path.join(ROOT, "shared", "audience")
MIN_POP = 500

# Market Potential Score. Each part is a percentile (0-100). No Competition part (see above).
WEIGHTS = {"demand": 0.60, "category": 0.40}
COUNTY_PARTS = ("demand",)       # EASI isn't published by county
ZIP_PARTS = ("demand",)
EASI = {"lodging_trips": "Lodging on out-of-town trips", "other_lodging": "Other lodging",
        "public_transport": "Public and other transportation"}
# Hotels and Casinos demand follow Nielsen Scarborough USA+ 2026 R1 indexes (adults 18+): hotel/motel guests index 103-107
# at ages 25-64 and 117-128 at household income $100K+; casino visitors index 110-113 at ages 35-64 and 107-111 at $75K+; foreign travelers (Tour operators) index
# 104-111 at ages 35-64, 138 at $100K-$249K and 210 at $250K+; cruise passengers (past 3 years) index 108-112 at ages
# 45+ and 106-143 at $75K+. Resort vacation planners (any resort type) index 109-114 at ages 25-54, 121-141 at $100K+
# and 117 for parents; visitors-bureau travelers (weekend and family trips) 105-111 at 25-54, 105-129 at $75K+, 119 for
# parents; escorted tour planners 115-162 at ages 55+ and 128-183 at $100K+.
# Casinos: gambling spending per person by state, 2025 (U.S. Bureau of Economic Analysis state household spending,
# released Sep 30 2026), spread to ZIPs by state and summed
# up to each market, so a market's figure is the population-weighted average of its states.
GAMBLING = ("gambling", "Gambling")
PALM_SPRINGS, RIVERSIDE_METRO = "804", "40140"
SUBCATS = [
    {"id": "hotels", "label": "Hotels and lodging", "easi": "lodging_trips", "demand": ["inc100", "inc100_share", "a25_64_share"]},
    {"id": "resorts", "label": "Resorts", "easi": "other_lodging", "demand": ["inc100", "inc100_share", "a25_54_share", "kids_share"]},
    {"id": "cruises", "label": "Cruises", "easi": "public_transport", "demand": ["inc75", "a45p_share", "inc75_share"]},
    {"id": "casinos", "label": "Casinos", "easi": "gambling", "demand": ["inc75", "a35_64_share", "inc75_share"]},
    {"id": "tours", "label": "Tour operators", "easi": "public_transport", "demand": ["inc100", "inc100_share", "a55p_share"]},
    {"id": "cvb", "label": "Visitors bureaus", "easi": "lodging_trips", "demand": ["inc75", "inc75_share", "a25_54_share", "kids_share"]},
]
DEMAND_LABELS = {"inc100": "Households earning $100K+", "inc75": "Households earning $75K+",
                 "inc100_share": "Share of households earning $100K+", "inc75_share": "Share of households earning $75K+",
                 "inc150": "Households earning $150K+", "inc150_share": "Share of households earning $150K+",
                 "a35_64_share": "Adults 35–64 (share of adults)", "a45p_share": "Adults 45+ (share of adults)", "a25_54_share": "Adults 25–54 (share of adults)", "a55p_share": "Adults 55+ (share of adults)",
                 "a25_64_share": "Adults 25–64 (share of adults)", "kids_share": "Households with children"}
COUNTS = ["population", "households", "adults", "inc100", "inc75", "inc150", "a55p"]
RATE_PARTS = {"inc100_share": ("inc100", "inc_tot"), "inc150_share": ("inc150", "inc_tot"), "inc75_share": ("inc75", "inc_tot"), "kids_share": ("hh_kids", "hh_tot"),
              "a35_64_share": ("a35_64", "adults18"), "a55p_share": ("a55p", "adults18"), "a45p_share": ("a45p", "adults18"), "a25_54_share": ("a25_54", "adults18"), "a25_64_share": ("a25_64", "adults18")}
RATES = list(RATE_PARTS)
SUMS = ["population", "households", "adults18", "inc100", "inc75", "inc150", "inc_tot", "hh_kids", "hh_tot", "a35_64", "a55p", "a45p", "a25_64", "a25_54", "gam_dollars"]


def log(*a): print(*a, flush=True)


def self_test():
    s = pct(pd.Series([10, 20, 30, 40, np.nan]))
    assert list(s[:4]) == [25.0, 50.0, 75.0, 100.0] and np.isnan(s[4]), s
    c = combine([pd.Series([100.0, np.nan]), pd.Series([0.0, 50.0])], [0.60, 0.40])
    assert abs(c[0] - 60.0) < 1e-9 and c[1] == 50.0, c
    assert abs(sum(WEIGHTS.values()) - 1) < 1e-9
    return "percentile and weighted-average hand checks reproduce exactly"


def load_inputs():
    z = pd.read_csv(os.path.join(GEO, "zip_geo.csv"), dtype={"zip": str, "county_fips": str, "cbsa_code": str, "dma_code": str})
    z["cbsa_code"] = z.cbsa_code.fillna(""); z["dma_code"] = z.dma_code.fillna("0")
    aud = json.load(open(os.path.join(AUD, "zip_audience.json")))
    a = pd.DataFrame(aud["cols"])
    need = ["adults18", "a25_64", "a45p", "a65p", "m35_44", "f35_44", "m55p", "f55p", "inc_tot", "inc_75_100", "inc_100_150",
            "inc_150_200", "inc_200p", "hh_kids", "hh_tot"]
    miss = [c for c in need if c not in a.columns]
    if miss: sys.exit(f"shared/audience/zip_audience.json lacks {miss}; the audience step must run first.")
    a["inc100"] = a[["inc_100_150", "inc_150_200", "inc_200p"]].sum(axis=1, min_count=3)
    a["inc75"] = a[["inc_75_100", "inc100"]].sum(axis=1, min_count=2)
    a["inc150"] = a[["inc_150_200", "inc_200p"]].sum(axis=1, min_count=2)
    a["a55p"] = a[["m55p", "f55p"]].sum(axis=1, min_count=2)
    a["a35_64"] = a.m35_44 + a.f35_44 + a.a45p - a.a65p
    a["a25_54"] = a.a25_64 - (a.a55p - a.a65p)
    g = pd.read_csv(os.path.join(HERE, "sources", "gambling_spend_state.csv"))
    ab = {"Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO", "Connecticut": "CT",
          "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
          "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
          "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT",
          "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
          "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
          "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT",
          "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"}
    pp = dict(zip(g.state.map(ab), g.gambling_per_person_2025))
    pp = {k: v for k, v in pp.items() if isinstance(k, str)}
    if len(pp) != 51: sys.exit("gambling_spend_state.csv must list all 50 states and DC")
    z["gam_dollars"] = z.state.map(pp) * z.population
    z = z.merge(a[["zip", "adults18", "a25_64", "a25_54", "a35_64", "a45p", "a55p", "inc100", "inc75", "inc150", "inc_tot", "hh_kids", "hh_tot"]], on="zip", how="left")
    return z, aud


def main():
    ap_ = argparse.ArgumentParser(); ap_.add_argument("--cache"); a = ap_.parse_args()
    rep = [("Formula tests", "PASS", self_test())]
    built = datetime.date.today().isoformat()
    z, aud = load_inputs()
    met_list = pd.read_csv(os.path.join(GEO, "metro_list.csv"), dtype={"cbsa_code": str})
    metros = set(met_list[met_list.cbsa_type == "Metro"].cbsa_code)
    dma_list = pd.read_csv(os.path.join(GEO, "dma_list.csv"), dtype={"dma_code": str})
    dma_list = dma_list[dma_list.dma_code != "0"]
    z["land"] = z.zip.map(zcta_land(a.cache, rep))

    # ---------------- Aggregate ----------------
    def agg(g):
        r = {c: g[c].sum(min_count=1) for c in SUMS if c in g}
        r["adults"] = r.get("adults18")
        land = g.land.where(g.land > 0).sum()
        r["density"] = g.households.where(g.land > 0, 0).sum() / land if land > 0 else np.nan
        for k, (n, d) in RATE_PARTS.items():
            ok = g[n].notna() & g[d].notna(); den = g[d][ok].sum()
            r[k] = g[n][ok].sum() / den if den > 0 else np.nan
        return r

    def frame(groups):
        return pd.DataFrame.from_dict({k: agg(g) for k, g in groups}, orient="index")

    def score(df, parts=tuple(WEIGHTS), mask=None):
        if mask is None: mask = pd.Series(True, index=df.index)
        P = lambda s: pct(s.where(mask))
        dem = {k: P(df[k]) for k in DEMAND_LABELS if k in df.columns}
        for s in SUBCATS:
            i, e = s["id"], s["easi"]
            ins = [dem[k] for k in s["demand"] if k in dem and df[k].notna().any()]
            df[f"demand@{i}"] = combine(ins, [1] * len(ins)) if ins else np.nan
            has_cat = "category" in parts and e is not None and f"easi_{e}_hh" in df.columns
            df[f"category@{i}"] = combine([P(df[f"easi_{e}_hh"]), P(df[f"easi_{e}_total"])], [0.5, 0.5]) if has_cat else np.nan
            use = [c for c in parts if not (c == "category" and not has_cat)]
            cols = [df[f"{c}@{i}"] for c in use]
            full = pd.concat(cols, axis=1).notna().all(axis=1)
            df[f"score@{i}"] = combine(cols, [WEIGHTS[c] for c in use]).where(full & mask).round(3)
            for c in WEIGHTS: df[f"{c}@{i}"] = df[f"{c}@{i}"].round(2)
        return df

    # EASI: per-household spending by DMA and metro; totals = per household x this site's households
    src = os.path.join(HERE, "sources")
    sd = pd.read_csv(os.path.join(src, "easi_travel_spend_dma.csv"))
    xw = pd.read_csv(os.path.join(src, "easi_dma_crosswalk.csv"), dtype={"dma_code": str})
    sd = sd.merge(xw[["easi_market", "dma_code"]], left_on="market", right_on="easi_market", how="left")
    if sd.dma_code.isna().any(): sys.exit("easi_dma_crosswalk.csv is missing EASI DMAs: " + ", ".join(sd[sd.dma_code.isna()].market))
    sm = pd.read_csv(os.path.join(src, "easi_travel_spend_metro.csv"))
    em = pd.read_csv(os.path.join(src, "easi_metro_2025.csv"), dtype={"cbsa_code": str})
    key = lambda t: re.sub(r"[^a-z0-9]", "", str(t).lower())
    sm["cbsa_code"] = sm.market.map(key).map(dict(zip(em.metro.map(key), em.cbsa_code)))
    us_hh = {}
    for e, lab in EASI.items():
        us_hh[e] = sd[f"{e}_total"].sum() / sd.households.sum()
        rep.append((f"EASI U.S. {lab.lower()} per household", "INFO", f"${us_hh[e]:,.2f}"))

    def add_easi(df, table, idcol, label):
        t = table.dropna(subset=[idcol]).set_index(idcol)
        for e in EASI:
            per = t[f"{e}_per_hh"].copy()
            if idcol == "dma_code" and PALM_SPRINGS not in per.index:
                pm = sm.dropna(subset=["cbsa_code"]).set_index("cbsa_code")[f"{e}_per_hh"]
                if RIVERSIDE_METRO in pm.index: per.loc[PALM_SPRINGS] = pm.loc[RIVERSIDE_METRO]
            df[f"easi_{e}_hh"] = df.index.map(per).astype(float)
            df[f"easi_{e}_total"] = df[f"easi_{e}_hh"] * df.households
            df[f"easi_{e}_idx"] = (df[f"easi_{e}_hh"] / us_hh[e] * 100).round(0)
        miss = [str(i) for i in df.index if df.at[i, f"easi_{e}_hh"] != df.at[i, f"easi_{e}_hh"]]
        rep.append((f"EASI travel spending matched to {label}", "PASS" if len(miss) <= (2 if label == "metros" else 0) else "FAIL",
                    f"{len(df) - len(miss)} of {len(df)}" + (f"; missing {miss[:8]}" if miss else "")))

    us_gam = z.gam_dollars.sum() / z.households.sum()
    rep.append(("State gambling spending per U.S. household", "INFO", f"${us_gam:,.2f} (from per-person figures x population)"))

    def add_gambling(df):
        df["easi_gambling_total"] = df.gam_dollars
        df["easi_gambling_hh"] = (df.gam_dollars / df.households).where(df.households > 0)
        df["easi_gambling_idx"] = (df.easi_gambling_hh / us_gam * 100).round(0)

    zd = z[z.dma_code != "0"]
    dma = frame(zd.groupby("dma_code")); add_easi(dma, sd, "dma_code", "DMAs"); add_gambling(dma); dma = score(dma)
    zm = z[z.cbsa_code.isin(metros)]
    met = frame(zm.groupby("cbsa_code")); add_easi(met, sm, "cbsa_code", "metros"); add_gambling(met); met = score(met)
    cty = county_frame(z, frame); cty = score(cty, parts=COUNTY_PARTS, mask=county_mask(cty))
    us = frame([("us", z)]); add_gambling(us)
    g_us = pd.read_csv(os.path.join(HERE, "sources", "gambling_spend_state.csv")).set_index("state").total_gambling_2025_usd.get("U.S.")
    r_ = float(us.gam_dollars.iloc[0]) / g_us if g_us else 1
    rep.append(("State gambling spending, U.S. total vs. the file's own U.S. total", "PASS" if 0.93 <= r_ <= 1.07 else "FAIL", f"{r_:.1%}"))
    for e, lab in EASI.items():
        us[f"easi_{e}_hh"], us[f"easi_{e}_idx"] = us_hh[e], 100.0
        us[f"easi_{e}_total"] = us_hh[e] * us.households
        r_ = dma[f"easi_{e}_total"].sum() / sd[f"{e}_total"].sum()
        rep.append((f"EASI {lab.lower()}, DMAs vs. EASI's own total", "PASS" if 0.95 <= r_ <= 1.05 else "FAIL", f"{r_:.1%}"))

    # ---------------- Checks ----------------
    U = lambda k: float(us[k].iloc[0])
    for k, lo, hi in (("inc100_share", .30, .48), ("inc75_share", .42, .62), ("inc150_share", .14, .26), ("kids_share", .25, .35),
                      ("a35_64_share", .44, .56), ("a55p_share", .30, .42), ("a45p_share", .46, .58), ("a25_54_share", .42, .56), ("a25_64_share", .60, .72)):
        rep.append((f"U.S. {DEMAND_LABELS[k].lower()}", "PASS" if lo <= U(k) <= hi else "FAIL", f"{U(k):.1%} (expected {lo:.0%}–{hi:.0%})"))
    for name, df in (("DMA", dma), ("Metro", met)):
        sc = df[[f"score@{s['id']}" for s in SUBCATS]]
        bad = int(((sc < 0) | (sc > 100)).sum().sum())
        rep.append((f"{name} scores within 0–100", "PASS" if bad == 0 else "FAIL",
                    f"{bad} out of range; {int(sc.notna().sum().sum()):,} computed, {int(sc.isna().sum().sum()):,} not computed (missing input)"))
    for s in SUBCATS:
        i = s["id"]; d = dma.sort_values(f"score@{i}", ascending=False)
        top = ", ".join(dma_list.set_index("dma_code").dma_name.get(x, x).title() for x in d.index[:5])
        rep.append((f"Top DMAs: {s['label']}", "INFO", top))
    county_checks(rep, cty, [s["id"] for s in SUBCATS])
    failed = [r for r in rep if r[1] == "FAIL"]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "travel_report.md"), "w") as f:
        f.write(f"# Travel data check report\n\nBuilt {built}. Result: **{'FAILED' if failed else 'PASSED'}**\n\n| Check | Result | Detail |\n| --- | --- | --- |\n")
        for r in rep: f.write(f"| {r[0]} | {r[1]} | {r[2]} |\n")
    for r in rep: log(f"[{r[1]}] {r[0]}: {r[2]}")
    if failed: sys.exit("A check failed; the Travel data was not updated. See travel/data/travel_report.md.")

    # ---------------- Write ----------------
    keep = COUNTS + RATES + ["density"] + [f"easi_{e}_{k}" for e in list(EASI) + ["gambling"] for k in ("hh", "total", "idx")]
    per_sub = ["score", "demand", "category"]
    INTS = set(COUNTS) | {f"easi_{e}_total" for e in list(EASI) + ["gambling"]}

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
            for c in keep:
                if c in df.columns:
                    x = clean(r[c]); v[c] = int(round(x)) if c in INTS and x is not None else x
            for s in SUBCATS:
                for p in per_sub:
                    k = f"{p}@{s['id']}"
                    if k in df.columns:
                        x = clean(r[k]); v[k] = round(x, 3 if p == "score" else 2) if x is not None else x   # two decimals so ranks don't tie
            v = {k: x for k, x in v.items() if x is not None}
            out.append({"id": str(idx), "name": names(idx), "v": v, "f": flags_fn(idx, r) if flags_fn else []})
        return out

    dname = dma_list.set_index("dma_code").dma_name
    tidy = lambda n: re.sub(r"(, )([A-Za-z]{2})\b", lambda m: m.group(1) + m.group(2).upper(), str(n).title())
    mname = met_list.set_index("cbsa_code").cbsa_name

    def flags(idx, r):
        return ["Palm Springs boundary is provisional: 28 Coachella Valley ZIPs assigned by Adtaxi, pending a Nielsen check."] if str(idx) == "804" else []

    meta = {"built": built, "acsYears": aud["meta"]["acsYears"]}
    json.dump({"level": "dma", "meta": meta, "rows": rows(dma, lambda i: tidy(dname.get(i, i)), flags)}, open(os.path.join(OUT, "dma.json"), "w"), separators=(",", ":"))
    json.dump({"level": "metro", "meta": meta, "rows": rows(met, lambda i: mname.get(i, i))}, open(os.path.join(OUT, "metro.json"), "w"), separators=(",", ":"))
    cname = county_names()
    json.dump({"level": "county", "meta": meta, "rows": mark_unranked(rows(cty, lambda i: cname.get(str(i), str(i)), lambda i, r: county_flag(r)), cty)},
              open(os.path.join(OUT, "county.json"), "w"), separators=(",", ":"))
    json.dump({"level": "us", "meta": meta, "rows": rows(us, lambda i: "United States")}, open(os.path.join(OUT, "us.json"), "w"), separators=(",", ":"))

    # ZIPs inside each market, ranked within the market on Consumer Demand. Each ZIP's own values are computed once for
    # all ZIPs, then ranked within each market.
    zz = z.set_index("zip")
    zf = pd.DataFrame(index=zz.index)
    for c in SUMS: zf[c] = zz[c]
    zf["adults"] = zz.adults18
    zf["density"] = (zz.households / zz.land).where(zz.land > 0)
    for k, (n, d) in RATE_PARTS.items(): zf[k] = (zz[n] / zz[d]).where(zz[d] > 0)
    nfiles = 0
    for level, col, src_ in (("dma", "dma_code", zd), ("metro", "cbsa_code", zm),
                             ("county", "county_fips", z[z.county_fips.astype(str).str.len() == 5])):
        folder = os.path.join(OUT, "zip", level); os.makedirs(folder, exist_ok=True)
        for code, g in src_.groupby(col):
            f = zf.loc[g.zip].copy()
            f = f[~f.index.duplicated()]
            # Mostly group quarters (dorms, bases, prisons): households under 15% of residents. Per-household rates
            # there rest on a handful of homes, so these ZIPs are shown but not ranked.
            gq = f.households.fillna(0) < 0.15 * f.population
            ok = (f.population >= MIN_POP) & ~gq
            f = score(f, parts=ZIP_PARTS, mask=ok)
            city = g.set_index("zip").city.fillna("")
            out = rows(f, lambda i: f"{i} {city.get(i, '')}".strip())
            for row in out:
                if f.loc[row["id"], "population"] < MIN_POP:
                    row["u"] = 1; row["f"].append(f"Fewer than {MIN_POP} residents, so this ZIP isn't ranked.")
                elif gq.get(row["id"], False):
                    row["u"] = 1; row["f"].append("Mostly group quarters (a campus, base or institution, with few households), so this ZIP isn't ranked.")
                for s in SUBCATS: row["v"].pop(f"category@{s['id']}", None)
            json.dump({"level": "zip", "parent": {"level": level, "id": code}, "rows": out},
                      open(os.path.join(folder, f"{code}.json"), "w"), separators=(",", ":"))
            nfiles += 1
    log(f"Wrote {len(dma)} DMAs, {len(met)} metros, {len(cty)} counties and {nfiles} ZIP files to {OUT}")


if __name__ == "__main__":
    main()
