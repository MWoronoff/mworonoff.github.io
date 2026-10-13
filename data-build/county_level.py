"""County level for the analyzer builds.

Counties are built from the same ZIP rows as DMAs and metros (each ZIP counts in its main county), so county numbers
follow the same sources and math as every other level. County Business Patterns counts are spread to ZIPs by
population share within each county, so a county's ZIPs add back up to its full Census count.

EASI spending is published only for DMAs and metros, so counties are scored without Category Spending: the score is
the weighted blend of the remaining parts (Consumer Demand, Spending Power, Competition), re-weighted to 100%.
Counties with fewer than MIN_COUNTY_POP residents are shown but not ranked (small counties have wide Census margins of error and few businesses, so their rates swing widely).
"""
import os

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
MIN_COUNTY_POP = 10000
COUNTY_PARTS = ("demand", "spend", "comp")


def county_names():
    """fips -> 'Autauga County, AL'. Uses Census names from the boundary build; falls back to the geography table."""
    p = os.path.join(HERE, "geo", "county_names.csv")
    if os.path.exists(p):
        n = pd.read_csv(p, dtype={"fips": str})
        return dict(zip(n.fips.str.zfill(5), n.name))
    g = pd.read_csv(os.path.join(HERE, "geo", "county_geo.csv"), dtype={"county_fips": str})
    return {f: f"{str(c).title()}, {s}" for f, c, s in zip(g.county_fips, g.county, g.state)}


def county_frame(z, frame):
    """Roll ZIP rows up to counties with the build's own frame(). Drops EASI columns (not published by county)."""
    zc = z[z.county_fips.notna() & (z.county_fips.astype(str).str.len() == 5)]
    df = frame(zc.groupby("county_fips"))
    return df.drop(columns=[c for c in df.columns if str(c).startswith("easi_")])


def county_mask(df):
    return df.population >= MIN_COUNTY_POP


def county_checks(rep, df, subcat_ids):
    """Report rows: counties built, counties ranked, scores in range."""
    n, ranked = len(df), int(county_mask(df).sum())
    rep.append(("Counties built from ZIPs", "PASS" if n >= 3000 else "FAIL", f"{n:,} counties ({ranked:,} with {MIN_COUNTY_POP:,}+ residents are ranked)"))
    sc = df[[f"score@{i}" for i in subcat_ids if f"score@{i}" in df.columns]]
    bad = int(((sc < 0) | (sc > 100)).sum().sum())
    rep.append(("County scores within 0–100", "PASS" if bad == 0 else "FAIL",
                f"{bad} out of range; {int(sc.notna().sum().sum()):,} scores computed"))


def county_flag(r):
    if r.get("population", 0) < MIN_COUNTY_POP:
        return [f"Fewer than {MIN_COUNTY_POP:,} residents, so this county isn't ranked."]
    return []


def mark_unranked(rows_out, df):
    """Sets the engine's 'not ranked' marker on small counties."""
    small = set(df.index[~county_mask(df)].astype(str))
    for row in rows_out:
        if row["id"] in small: row["u"] = 1
    return rows_out
