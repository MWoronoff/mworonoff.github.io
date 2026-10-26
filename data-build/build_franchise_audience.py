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
  Persona (Oct 2026): B25007 tenure by age of householder (owner 4-11, renter 14-21 for ages 25-34 ... 85+);
         B11001 household type (1 total, 3 married-couple family, 8 living alone); B25024 units in structure
         (1 total, 2 single-family detached, 3 attached, 6-9 five or more units, 10 mobile home).

Columns: h<age>_<income> for age 2544, 4564, 65p and the Trade area's eight income groups (lt35, 35_50, 50_75, 75_100,
100_125, 125_150, 150_200, 200p); hh19037 (all households in the table); val500 and val_own (owner-occupied homes);
own<age>/rent<age> (householders who own or rent, by the same three ages); hh_type, hh_married, hh_alone;
units, sfd, sfa, apt5, mobile.
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
    need = [col("B19037", n) for n in range(1, 70)] + [col("B25075", 1)] + [col("B25075", n) for n in range(23, 28)] \
        + [col("B25007", n) for n in range(1, 22)] + [col("B11001", n) for n in (1, 3, 8)] + [col("B25024", n) for n in (1, 2, 3, 6, 7, 8, 9, 10)]
    acs = pd.read_csv(SRC, dtype={"zip": str}, usecols=["zip"] + need)
    out = pd.DataFrame({"zip": acs.zip})
    for a, first in AGES.items():
        for k, pos in INCOME.items():
            out[f"h{a}_{k}"] = acs[[col("B19037", first + p) for p in pos]].sum(axis=1, min_count=len(pos))
    out["hh19037"] = acs[col("B19037", 1)]
    out["val_own"] = acs[col("B25075", 1)]
    out["val500"] = acs[[col("B25075", n) for n in range(23, 28)]].sum(axis=1, min_count=5)
    tenure = {"2544": (4, 5), "4564": (6, 7, 8), "65p": (9, 10, 11)}      # owner lines; renter lines are +10
    for a, lines in tenure.items():
        out[f"own{a}"] = acs[[col("B25007", n) for n in lines]].sum(axis=1, min_count=len(lines))
        out[f"rent{a}"] = acs[[col("B25007", n + 10) for n in lines]].sum(axis=1, min_count=len(lines))
    out["hh_type"], out["hh_married"], out["hh_alone"] = acs[col("B11001", 1)], acs[col("B11001", 3)], acs[col("B11001", 8)]
    out["units"], out["sfd"], out["sfa"], out["mobile"] = acs[col("B25024", 1)], acs[col("B25024", 2)], acs[col("B25024", 3)], acs[col("B25024", 10)]
    out["apt5"] = acs[[col("B25024", n) for n in (6, 7, 8, 9)]].sum(axis=1, min_count=4)
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
            "source": "Census ACS 5-year: B19037 age of householder by household income; B25075 home value; B25007 tenure by age of householder; B11001 household type; B25024 units in structure"}
    with open(OUT, "w") as f:
        json.dump({"meta": meta, "cols": cols}, f, separators=(",", ":"))
    print(f"wrote {OUT}: {len(out)} ZIPs, {len(cols) - 1} columns, {os.path.getsize(OUT) / 1e6:.1f} MB")
    us = out.drop(columns="zip").sum()
    print("U.S. owners among householders 45-64:", round(us.own4564 / (us.own4564 + us.rent4564), 3), "| married-couple share:", round(us.hh_married / us.hh_type, 3),
          "| single-family detached:", round(us.sfd / us.units, 3))
    print("U.S. householders 45-64 at $125K+:", int(us[["h4564_125_150", "h4564_150_200", "h4564_200p"]].sum()),
          "| 25-64 at $100K+:", int(sum(us[f"h{a}_{k}"] for a in ("2544", "4564") for k in ("100_125", "125_150", "150_200", "200p"))))


if __name__ == "__main__":
    main()
