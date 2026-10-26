#!/usr/bin/env python3
"""
Franchise Trade area: households counted directly by the householder's age and the household's income, plus home-equity
signals, by ZIP. Written to shared/audience/zip_audience_hh.json in the same column format as the other audience files.

Source: data-build/master/zip_acs.csv.gz (Census ACS 5-year, ZCTA), already in the repo; no download, no API key.
  B19037 Age of householder by household income. Blocks: 2 under 25 (lines 3-18), 19 householder 25-44 (20-35),
         36 householder 45-64 (37-52), 53 householder 65+ (54-69). Each block has 16 income lines in this order:
         <$10K, $10-15K, $15-20K, $20-25K, $25-30K, $30-35K, $35-40K, $40-45K, $45-50K, $50-60K, $60-75K,
         $75-100K, $100-125K, $125-150K, $150-200K, $200K+.
  B25075 Value of owner-occupied homes: line 1 total, lines 23-27 = $500,000 or more.
  (Mortgage status, B25081, is already in zip_audience_fin.json as own_units and mortg_free.)

Columns: h<age>_<income> for age 2544, 4564, 65p and the Trade area's eight income groups (lt35, 35_50, 50_75, 75_100,
100_125, 125_150, 150_200, 200p); hh19037 (all households in the table); val500 and val_own (owner-occupied homes).
"""
import datetime, json, os
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "master", "zip_acs.csv.gz")
OUT = os.path.join(HERE, "..", "shared", "audience", "zip_audience_hh.json")

AGES = {"2544": 20, "4564": 37, "65p": 54}               # first income line of each householder-age block
INCOME = {"lt35": range(0, 6), "35_50": range(6, 9), "50_75": range(9, 11), "75_100": [11],
          "100_125": [12], "125_150": [13], "150_200": [14], "200p": [15]}   # positions within the 16 income lines


def col(table, n): return f"{table}_E{n:03d}"


def main():
    need = [col("B19037", n) for n in range(1, 70)] + [col("B25075", 1)] + [col("B25075", n) for n in range(23, 28)]
    acs = pd.read_csv(SRC, dtype={"zip": str}, usecols=["zip"] + need)
    out = pd.DataFrame({"zip": acs.zip})
    for a, first in AGES.items():
        for k, pos in INCOME.items():
            out[f"h{a}_{k}"] = acs[[col("B19037", first + p) for p in pos]].sum(axis=1, min_count=len(pos))
    out["hh19037"] = acs[col("B19037", 1)]
    out["val_own"] = acs[col("B25075", 1)]
    out["val500"] = acs[[col("B25075", n) for n in range(23, 28)]].sum(axis=1, min_count=5)
    out = out.sort_values("zip").reset_index(drop=True)
    # checks: the income groups of each age block add up to the block total; blocks add up to the table total
    for a, first in AGES.items():
        parts = out[[f"h{a}_{k}" for k in INCOME]].sum(axis=1)
        tot = acs.set_index("zip").loc[out.zip, col("B19037", first - 1)].values
        assert ((parts - tot).abs().fillna(0) < 1).all(), a
    cols = {"zip": out.zip.tolist()}
    for c in out.columns[1:]:
        cols[c] = [None if pd.isna(v) else int(round(v)) for v in out[c]]
    meta = {"built": datetime.date.today().isoformat(), "acsYears": "2020–2024",
            "source": "Census ACS 5-year: B19037 age of householder by household income; B25075 value of owner-occupied homes"}
    with open(OUT, "w") as f:
        json.dump({"meta": meta, "cols": cols}, f, separators=(",", ":"))
    print(f"wrote {OUT}: {len(out)} ZIPs, {len(cols) - 1} columns, {os.path.getsize(OUT) / 1e6:.1f} MB")
    us = out.drop(columns="zip").sum()
    print("U.S. householders 45-64 at $125K+:", int(us[["h4564_125_150", "h4564_150_200", "h4564_200p"]].sum()),
          "| 25-64 at $100K+:", int(sum(us[f"h{a}_{k}"] for a in ("2544", "4564") for k in ("100_125", "125_150", "150_200", "200p"))))


if __name__ == "__main__":
    main()
