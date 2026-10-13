"""Builds crm-analyzer/data/ from data-build/master/: compact ZIP profiles the browser can load.

  crm-analyzer/data/zips.json         every residential ZIP: place, state, county, DMA, metro, coordinates,
                                      population, households (national; used for distance and market lookups)
  crm-analyzer/data/st/XX.json        one file per state: the profile characteristics for that state's ZIPs
  crm-analyzer/data/fields.json       each characteristic: label, group, unit, base, source, release,
                                      U.S. benchmark, and whether it is used in "find similar areas" by default
  crm-analyzer/data/crm_data_report.md

Characteristics are shares (percent of the right base) or medians and averages, so ZIPs of different size compare
fairly. Race and ethnicity are deliberately not included.

  python3 data-build/build_crm_data.py
"""
import datetime, json, os, re
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
M = os.path.join(HERE, "master")
OUT = os.path.join(os.path.dirname(HERE), "crm-analyzer", "data")


def rd(name, dtype=None, **kw):
    p = os.path.join(M, name)
    return pd.read_csv(p, dtype=dtype or {"zip": str}, low_memory=False, **kw) if os.path.exists(p) else None


def L(t, *lines):
    return [f"{t}_E{n:03d}" for n in lines]


def R(a, b):
    return list(range(a, b + 1))


FIELDS = []   # (key, label, group, unit, base_label, source_key, default_for_similarity)


def F(key, label, group, unit, base, src, sim=True):
    FIELDS.append(dict(key=key, label=label, group=group, unit=unit, base=base, src=src, sim=sim))


def main():
    idx = rd("zip_index.csv.gz", dtype=str)
    for c in ("lat", "lon"):
        idx[c] = pd.to_numeric(idx[c], errors="coerce")
    acs = rd("zip_acs.csv.gz")
    dlx = rd("zip_deluxe.csv.gz", usecols=["zip", "dlx_landarea", "dlx_citymixedcase"])
    irs, cbp, lodes = rd("zip_irs.csv.gz"), rd("zip_cbp.csv.gz"), rd("zip_lodes.csv.gz")
    ruca, places, fhfa = rd("zip_ruca.csv.gz"), rd("zip_places.csv.gz"), rd("zip_fhfa.csv.gz")
    rel = {}
    for line in open(os.path.join(M, "master_report.md")):
        m = re.match(r"\| (.+?) \| (.+?) \| (.*?) \|", line)
        if m and m.group(1) not in ("Source", "---"):
            rel[m.group(1)] = m.group(3)
    SRC = {"acs": ("U.S. Census Bureau, ACS 5-year", rel.get("Census ACS 5-year", "")),
           "irs": ("IRS Statistics of Income", rel.get("IRS income tax statistics", "")),
           "cbp": ("Census ZIP Code Business Patterns", rel.get("Census ZIP Code Business Patterns", "")),
           "lodes": ("Census LEHD (LODES)", rel.get("Census LEHD jobs (LODES)", "")),
           "ruca": ("USDA ERS rural-urban codes", rel.get("USDA rural-urban codes", "")),
           "places": ("CDC PLACES (model-based)", rel.get("CDC PLACES health estimates", "")),
           "fhfa": ("FHFA house price index", rel.get("FHFA house price index", "")),
           "dlx": ("Deluxe ZIP database", rel.get("Deluxe ZIP database", ""))}

    d = acs.copy()
    for o in (dlx, irs, cbp, lodes, ruca, places, fhfa):
        if o is not None:
            d = d.merge(o, on="zip", how="left")
    S = lambda cols: d[[c for c in cols]].sum(axis=1, min_count=1)
    out = pd.DataFrame({"zip": d["zip"]})
    nums, dens = {}, {}   # numerator / denominator series for weighted U.S. benchmarks
    wavg = set()          # keys whose benchmark is a weighted average of the ZIP values (already in final units)

    def pct(key, label, group, num_cols, den, base, src="acs", sim=True):
        n = S(num_cols) if isinstance(num_cols, list) else num_cols
        den_s = S(den) if isinstance(den, list) else den
        out[key] = (n / den_s * 100).where(den_s > 0)
        nums[key], dens[key] = n, den_s
        F(key, label, group, "%", base, src, sim)

    def val(key, label, group, series, unit, base, src="acs", sim=True, weight=None):
        out[key] = series
        if weight is not None:
            nums[key], dens[key] = series * weight, weight.where(series.notna())
            wavg.add(key)
        F(key, label, group, unit, base, src, sim)

    pop, hh = d["B01001_E001"], d["B11001_E001"]
    m, f = (lambda a, b: R(a, b)), (lambda a, b: [x + 24 for x in R(a, b)])
    # ---- People
    pct("age_u18", "Under 18", "People", L("B01001", *m(3, 6), *f(3, 6)), pop, "population")
    pct("age_18_34", "Age 18–34", "People", L("B01001", *m(7, 12), *f(7, 12)), pop, "population")
    pct("age_35_54", "Age 35–54", "People", L("B01001", *m(13, 16), *f(13, 16)), pop, "population")
    pct("age_55_64", "Age 55–64", "People", L("B01001", *m(17, 19), *f(17, 19)), pop, "population")
    pct("age_65p", "Age 65+", "People", L("B01001", *m(20, 25), *f(20, 25)), pop, "population")
    val("median_age", "Median age", "People", d["B01002_E001"], "years", "population", weight=pop)
    pct("kids_u5", "Children under 5", "People", L("B09001", 3, 4), pop, "population")
    pct("kids_5_11", "Children 5–11", "People", L("B09001", 5, 6, 7), pop, "population")
    pct("kids_12_17", "Children 12–17", "People", L("B09001", 8, 9), pop, "population")
    pct("veterans", "Veterans", "People", ["B21001_E002"], ["B21001_E001"], "civilians 18+")
    pct("disability", "Has a disability", "People", L("B18101", 4, 7, 10, 13, 16, 19, 23, 26, 29, 32, 35, 38),
        ["B18101_E001"], "civilian noninstitutional population")
    pct("uninsured", "No health insurance", "People", L("B27010", 17, 33, 50, 66), ["B27010_E001"],
        "civilian noninstitutional population")
    # ---- Households
    pct("hh_married", "Married-couple households", "Households", ["B11001_E003"], hh, "households")
    pct("hh_kids", "Households with children under 18", "Households", ["B11005_E002"], ["B11005_E001"], "households")
    pct("hh_alone", "People living alone", "Households", ["B11001_E008"], hh, "households")
    pct("hh_4plus", "Households of 4 or more", "Households", L("B11016", 5, 6, 7, 8, 13, 14, 15, 16), ["B11016_E001"], "households")
    pct("moved_1yr", "Moved in the last year", "Households", (d["B07003_E001"] - d["B07003_E004"]), d["B07003_E001"], "population 1+")
    # B25038's year groups change with each release (2020-2024: "2023 or later", "2020 to 2022"); take the start
    # year of the second group from the Census label so the label always matches the data
    dic = pd.read_csv(os.path.join(M, "field_dictionary.csv"), dtype=str).set_index("column")["label"]
    yr = re.search(r"Moved in (\d{4}) to", str(dic.get("B25038_E004", "")))
    if not yr:
        raise SystemExit(f"Unexpected B25038 line 4 label: {dic.get('B25038_E004')}")
    pct("moved_recent", f"Moved into home {yr.group(1)} or later", "Households", L("B25038", 3, 4, 10, 11),
        ["B25038_E001"], "households")
    pct("spanish_hh", "Spanish spoken at home", "Households", ["C16002_E003"], ["C16002_E001"], "households")
    pct("limited_english", "Limited-English households", "Households", L("C16002", 4, 7, 10, 13), ["C16002_E001"], "households")
    pct("broadband", "Broadband internet", "Households", ["B28002_E004"], ["B28002_E001"], "households")
    pct("no_internet", "No internet access", "Households", ["B28002_E013"], ["B28002_E001"], "households")
    pct("no_vehicle", "No vehicle", "Households", L("B25044", 3, 10), ["B25044_E001"], "households")
    pct("veh_3plus", "3 or more vehicles", "Households", L("B25044", 6, 7, 8, 13, 14, 15), ["B25044_E001"], "households")
    # ---- Income
    inc = ["B19001_E001"]
    pct("inc_lt35", "Income under $35K", "Income", L("B19001", *R(2, 7)), inc, "households")
    pct("inc_35_50", "Income $35–50K", "Income", L("B19001", 8, 9, 10), inc, "households")
    pct("inc_50_75", "Income $50–75K", "Income", L("B19001", 11, 12), inc, "households")
    pct("inc_75_100", "Income $75–100K", "Income", L("B19001", 13), inc, "households")
    pct("inc_100_150", "Income $100–150K", "Income", L("B19001", 14, 15), inc, "households")
    pct("inc_150_200", "Income $150–200K", "Income", L("B19001", 16), inc, "households")
    pct("inc_200p", "Income $200K+", "Income", L("B19001", 17), inc, "households")
    val("median_income", "Median household income", "Income", d["B19013_E001"], "$", "households", weight=hh)
    pct("poverty", "Households below poverty", "Income", ["B17017_E002"], ["B17017_E001"], "households")
    pct("snap", "Households receiving SNAP", "Income", ["B22003_E002"], ["B22003_E001"], "households")
    pct("ss_income", "Social Security income", "Income", ["B19055_E002"], ["B19055_E001"], "households")
    pct("retire_income", "Retirement income", "Income", ["B19059_E002"], ["B19059_E001"], "households")
    if irs is not None:
        n1 = d["irs_n1"]
        val("irs_avg_agi", "Average adjusted gross income per tax return", "Income", d["irs_a00100"] / n1 * 1000, "$",
            "tax returns", "irs", weight=n1)
        nums["irs_avg_agi"], dens["irs_avg_agi"] = d["irs_a00100"] * 1000, n1.where(d["irs_a00100"].notna())
        pct("irs_200k", "Tax returns with income $200K+", "Income", d["irs_n1_stub6"], n1, "tax returns", "irs")
        pct("irs_business", "Returns with business income", "Income", d["irs_n00900"], n1, "tax returns", "irs")
        pct("irs_capgain", "Returns with capital gains", "Income", d["irs_n01000"], n1, "tax returns", "irs")
        pct("irs_dividends", "Returns with dividends", "Income", d["irs_n00600"], n1, "tax returns", "irs")
        pct("irs_mortgage", "Returns deducting mortgage interest", "Income", d["irs_n19300"], n1, "tax returns", "irs")
        pct("irs_eitc", "Returns with earned income credit", "Income", d["irs_n59660"], n1, "tax returns", "irs")
    # ---- Education and work
    ed = ["B15003_E001"]
    pct("ed_hs_or_less", "High school or less", "Education and work", L("B15003", *R(2, 18)), ed, "adults 25+")
    pct("ed_some_college", "Some college or associate's", "Education and work", L("B15003", 19, 20, 21), ed, "adults 25+")
    pct("ed_bachelors", "Bachelor's degree or higher", "Education and work", L("B15003", 22, 23, 24, 25), ed, "adults 25+")
    pct("ed_graduate", "Graduate degree", "Education and work", L("B15003", 23, 24, 25), ed, "adults 25+")
    pct("unemployed", "Unemployment rate", "Education and work", ["B23025_E005"], ["B23025_E003"], "civilian labor force")
    emp = ["C24010_E001"]
    pct("occ_mgmt", "Management, business, science and arts jobs", "Education and work", L("C24010", 3, 39), emp, "employed 16+")
    pct("occ_service", "Service jobs", "Education and work", L("C24010", 19, 55), emp, "employed 16+")
    pct("occ_sales", "Sales and office jobs", "Education and work", L("C24010", 27, 63), emp, "employed 16+")
    pct("occ_trades", "Construction, maintenance and natural resources jobs", "Education and work", L("C24010", 30, 66), emp, "employed 16+")
    pct("occ_production", "Production and transportation jobs", "Education and work", L("C24010", 34, 70), emp, "employed 16+")
    com = ["B08301_E001"]
    pct("wfh", "Work from home", "Education and work", ["B08301_E021"], com, "workers 16+")
    pct("transit", "Commute by public transit", "Education and work", ["B08301_E010"], com, "workers 16+")
    pct("commute_45", "Commute 45 minutes or more", "Education and work", L("B08303", 11, 12, 13), ["B08303_E001"], "workers not at home")
    # ---- Housing
    pct("own", "Homeowners", "Housing", ["B25003_E002"], ["B25003_E001"], "households")
    pct("single_family", "Single-family detached homes", "Housing", ["B25024_E002"], ["B25024_E001"], "housing units")
    pct("apartments", "Apartments (5+ units)", "Housing", L("B25024", 6, 7, 8, 9), ["B25024_E001"], "housing units")
    pct("mobile_home", "Mobile homes", "Housing", ["B25024_E010"], ["B25024_E001"], "housing units")
    pct("built_2010p", "Built 2010 or later", "Housing", L("B25034", 2, 3), ["B25034_E001"], "housing units")
    pct("built_pre1980", "Built before 1980", "Housing", L("B25034", *R(7, 11)), ["B25034_E001"], "housing units")
    pct("seasonal", "Seasonal or second homes", "Housing", ["B25004_E006"], (d["B25034_E001"]), "housing units")
    val("median_value", "Median home value", "Housing", d["B25077_E001"], "$", "owner homes", weight=d["B25003_E002"])
    val_ = ["B25075_E001"]
    pct("val_lt200", "Home value under $200K", "Housing", L("B25075", *R(2, 18)), val_, "owner homes")
    pct("val_200_400", "Home value $200–400K", "Housing", L("B25075", 19, 20, 21), val_, "owner homes")
    pct("val_400_750", "Home value $400–750K", "Housing", L("B25075", 22, 23), val_, "owner homes")
    pct("val_750p", "Home value $750K+", "Housing", L("B25075", *R(24, 27)), val_, "owner homes")
    pct("mortgage", "Owners with a mortgage", "Housing", ["B25081_E002"], ["B25081_E001"], "owner homes")
    val("median_rent", "Median rent", "Housing", d["B25064_E001"], "$", "renter homes", weight=d["B25003_E003"])
    pct("rent_burden", "Renters paying 30%+ of income", "Housing", L("B25070", 7, 8, 9, 10),
        d["B25070_E001"] - d["B25070_E011"], "renters")
    if fhfa is not None and "fhfa_change_5yr" in d:
        val("price_5yr", "Home price change, last 5 years", "Housing", d["fhfa_change_5yr"], "%", "single-family homes", "fhfa",
            sim=False, weight=d["B25003_E002"])
    # ---- Place and economy
    land = pd.to_numeric(d["dlx_landarea"], errors="coerce")
    val("density", "People per square mile", "Place and economy", (pop / land).where(land > 0), "per sq mi", "land area", "dlx")
    nums["density"], dens["density"] = pop.where(land > 0), land.where(land > 0)
    if ruca is not None:
        val("ruca", "Rural-urban code (1 = metro core, 10 = rural)", "Place and economy", d["ruca_primary"], "code", "ZIP", "ruca")
    if cbp is not None:
        for key, col, lab in (("biz_per_1k", "cbp_establishments", "Businesses per 1,000 residents"),
                              ("retail_per_1k", "cbp_est_44", "Retail stores per 1,000 residents"),
                              ("food_per_1k", "cbp_est_72", "Restaurants and lodging per 1,000 residents"),
                              ("health_per_1k", "cbp_est_62", "Health care businesses per 1,000 residents")):
            if col in d:
                val(key, lab, "Place and economy", (d[col].fillna(0) / pop * 1000).where(pop >= 100), "per 1,000", "residents", "cbp")
                nums[key], dens[key] = d[col].fillna(0).where(pop >= 100), pop.where(pop >= 100) / 1000
    if lodes is not None:
        val("jobs_per_res", "Jobs located here per resident", "Place and economy",
            (d["lodes_wac_c000"].fillna(0) / pop).where(pop >= 100), "ratio", "residents", "lodes")
        nums["jobs_per_res"], dens["jobs_per_res"] = d["lodes_wac_c000"].fillna(0).where(pop >= 100), pop.where(pop >= 100)
        pct("workers_high_pay", "Resident workers earning over $3,333/month", "Place and economy",
            d["lodes_rac_ce03"], d["lodes_rac_c000"], "resident workers", "lodes")
    # ---- Health (CDC model-based estimates; not used in "find similar areas" unless chosen)
    if places is not None:
        for k, lab in (("obesity", "Obesity"), ("diabetes", "Diabetes"), ("bphigh", "High blood pressure"),
                       ("csmoking", "Current smoking"), ("depression", "Depression"), ("checkup", "Routine checkup in past year"),
                       ("dental", "Dental visit in past year"), ("lpa", "No leisure-time physical activity"),
                       ("hearing", "Hearing disability"), ("mobility", "Mobility disability")):
            c = f"places_{k}"
            if c in d:
                val(f"health_{k}", lab + " (% of adults, CDC estimate)", "Health (CDC estimates)", d[c], "%", "adults",
                    "places", sim=False, weight=pop)

    # keep residential ZIPs with enough households for stable shares; tag small ones
    out["pop"], out["hh"] = pop, hh
    keep = out["hh"].fillna(0) > 0
    out = out[keep].copy()
    # index columns
    idx = idx.set_index("zip")
    base = pd.DataFrame({"zip": out["zip"]}).set_index("zip").join(idx, how="left").reset_index()
    base["city"] = base["city"].fillna("")
    zips = base[["zip", "city", "state", "county", "county_fips", "dma_code", "dma_name", "cbsa_code", "cbsa_name", "lat", "lon"]].copy()
    zips["pop"] = out["pop"].values
    zips["hh"] = out["hh"].values
    zips = zips[zips["lat"].notna() & zips["state"].notna()]
    if zips["dma_code"].notna().mean() < 0.95:
        raise SystemExit(f"Only {zips['dma_code'].notna().mean():.0%} of ZIPs have a DMA code; check zip_index.csv.gz")

    # U.S. benchmarks (weighted: total numerator / total denominator)
    bench = {}
    for f in FIELDS:
        k = f["key"]
        if k in nums:
            n, dd = nums[k][keep], dens[k][keep]
            ok = n.notna() & dd.notna()
            tot = dd[ok].sum()
            v = n[ok].sum() / tot if tot else np.nan
            bench[k] = v * 100 if f["unit"] == "%" and k not in wavg else v
        else:
            bench[k] = float(out[k].median())

    os.makedirs(os.path.join(OUT, "st"), exist_ok=True)
    keys = [f["key"] for f in FIELDS]

    def rnd(v, unit):
        if pd.isna(v):
            return None
        if unit in ("$",):
            return int(round(v))
        if unit in ("per sq mi",):
            return round(float(v), 0)
        return round(float(v), 2 if unit in ("ratio", "per 1,000") else 1)

    units = {f["key"]: f["unit"] for f in FIELDS}
    # national ZIP list
    zl = {"cols": ["zip", "city", "state", "county", "county_fips", "dma", "dma_name", "cbsa", "cbsa_name", "lat", "lon", "pop", "hh"],
          "rows": [[r.zip, r.city, r.state, r.county if isinstance(r.county, str) else "",
                    r.county_fips if isinstance(r.county_fips, str) else "", r.dma_code if isinstance(r.dma_code, str) else "",
                    r.dma_name if isinstance(r.dma_name, str) else "", r.cbsa_code if isinstance(r.cbsa_code, str) else "",
                    r.cbsa_name if isinstance(r.cbsa_name, str) else "", round(float(r.lat), 5), round(float(r.lon), 5),
                    int(r.pop), int(r.hh)] for r in zips.itertuples()]}
    json.dump(zl, open(os.path.join(OUT, "zips.json"), "w"), separators=(",", ":"))
    out = out.merge(zips[["zip", "state"]], on="zip", how="inner")
    sizes = {}
    for st, g in out.groupby("state"):
        rows = {z: [rnd(v, units[k]) for k, v in zip(keys, vals)] for z, vals in zip(g["zip"], g[keys].values)}
        p = os.path.join(OUT, "st", f"{st}.json")
        json.dump({"keys": keys, "rows": rows}, open(p, "w"), separators=(",", ":"))
        sizes[st] = os.path.getsize(p)
    meta = []
    for f in FIELDS:
        s = SRC[f["src"]]
        meta.append({**f, "source": s[0], "release": s[1], "us": rnd(bench[f["key"]], f["unit"]),
                     "coverage": int(out[f["key"]].notna().sum())})
    json.dump({"built": datetime.date.today().isoformat(), "fields": meta}, open(os.path.join(OUT, "fields.json"), "w"),
              separators=(",", ":"), ensure_ascii=False)
    # report
    Lr = ["# CRM analyzer data report", "", f"Built {datetime.date.today().isoformat()} from data-build/master/.", "",
          f"- ZIPs with households: {len(zips):,} (population {int(zips['pop'].sum()):,}; households {int(zips['hh'].sum()):,}).",
          f"- Characteristics: {len(FIELDS)} in {len(set(f['group'] for f in FIELDS))} groups.",
          f"- State files: {len(sizes)}, largest {max(sizes, key=sizes.get)} at {max(sizes.values()) / 1e6:.1f} MB, "
          f"total {sum(sizes.values()) / 1e6:.1f} MB.", "",
          "| Characteristic | Group | U.S. | ZIPs with a value | Source |", "| --- | --- | --- | --- | --- |"]
    for f in meta:
        Lr.append(f"| {f['label']} | {f['group']} | {f['us']} {f['unit'] if f['unit'] != '%' else '%'} | {f['coverage']:,} | {f['source']} {f['release']} |")
    open(os.path.join(OUT, "crm_data_report.md"), "w").write("\n".join(Lr) + "\n")
    print("\n".join(Lr[:8]))


if __name__ == "__main__":
    main()
