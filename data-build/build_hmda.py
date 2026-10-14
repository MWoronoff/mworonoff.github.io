"""Builds data-build/master/zip_hmda.csv.gz: home mortgage originations by ZIP from the HMDA national loan-level file.

Source: FFIEC / CFPB Home Mortgage Disclosure Act (HMDA) Snapshot National Loan-Level Dataset, the newest year
published (a public download, no key). Only loans that were made (action taken = originated) on owner-occupied homes
are counted. Each loan is counted by its census tract; tracts are spread to ZIP Code Tabulation Areas by their share of
the tract's land area, using the Census 2020 ZCTA-to-tract relationship file (HMDA uses 2020 tracts from 2022 on).

Columns per ZIP: hmda_purch (home purchase loans, first lien), hmda_refi (refinance and cash-out refinance, first lien),
hmda_equity (home equity lines, second liens and home improvement or other-purpose loans), hmda_total.
Race, ethnicity, sex and age fields in HMDA are not read: the analyzer doesn't use them.

  python3 data-build/build_hmda.py                  # live (GitHub Actions)
  python3 data-build/build_hmda.py --year 2025      # a specific year
  python3 data-build/build_hmda.py --lar FILE.zip --rel FILE.txt   # local files (tests)
"""
import argparse, datetime, io, json, os, sys, time, urllib.request, urllib.error, zipfile

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "master")
UA = {"User-Agent": "Mozilla/5.0 (Adtaxi analyzer data build; github.com/MWoronoff)"}
LAR_URLS = ["https://s3.amazonaws.com/cfpb-hmda-public/prod/snapshot-data/{y}/{y}_public_lar_csv.zip",
            "https://files.ffiec.cfpb.gov/static-data/snapshot/{y}/{y}_public_lar_csv.zip",
            "https://s3.amazonaws.com/cfpb-hmda-public/prod/one-year-data/{y}/{y}_public_lar_one_year_csv.zip"]
REL_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tract20_natl.txt"
COLS = ["action_taken", "occupancy_type", "loan_purpose", "lien_status", "open-end_line_of_credit", "census_tract", "county_code"]


def log(*a): print(*a, flush=True)


def head_ok(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers=UA), timeout=60) as r:
            return r.status == 200
    except Exception as e:
        log(f"  not available: {url} -> {e}")
        return False


def download(url, path, tries=4):
    for i in range(tries):
        try:
            log(f"Downloading {url}")
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=1800) as r, open(path, "wb") as f:
                n, t0 = 0, time.time()
                while True:
                    b = r.read(1 << 22)
                    if not b: break
                    f.write(b); n += len(b)
                    if n % (1 << 28) < (1 << 22): log(f"  {n / 1e6:,.0f} MB ({time.time() - t0:,.0f}s)")
            log(f"  done: {os.path.getsize(path) / 1e6:,.0f} MB")
            return path
        except Exception as e:
            log(f"  attempt {i + 1} failed: {e}")
            if i == tries - 1: raise
            time.sleep(20 * (i + 1))


def find_lar(year):
    this = datetime.date.today().year
    years = [year] if year else list(range(this - 1, this - 5, -1))
    for y in years:
        for u in LAR_URLS:
            url = u.format(y=y)
            if head_ok(url):
                log(f"HMDA {y}: {url}")
                return y, url
    sys.exit("No HMDA national loan-level file could be found. Check https://ffiec.cfpb.gov/data-publication/ for the current file names.")


def classify(d):
    """Owner-occupied originations: purchase (first lien), equity (open-end, second lien, home improvement, other), refinance."""
    d = d[(d.action_taken == 1) & (d.occupancy_type == 1)]
    purch = (d.loan_purpose == 1) & (d.lien_status == 1) & (d.open_end != 1)
    equity = ~purch & ((d.open_end == 1) | (d.lien_status == 2) | d.loan_purpose.isin([2, 4]))
    refi = ~purch & ~equity & d.loan_purpose.isin([31, 32])
    out = pd.DataFrame({"tract": d.census_tract, "county": d.county_code,
                        "purch": purch.astype(int), "refi": refi.astype(int), "equity": equity.astype(int)})
    return out


def read_lar(path):
    zf = zipfile.ZipFile(path)
    name = max(zf.namelist(), key=lambda n: zf.getinfo(n).file_size)
    log(f"Reading {name} ({zf.getinfo(name).file_size / 1e9:.1f} GB uncompressed)")
    head = zf.open(name).readline().decode("utf-8", "replace")
    sep = "|" if head.count("|") > head.count(",") else ","
    have = [c.strip().strip('"') for c in head.strip().split(sep)]
    miss = [c for c in COLS if c not in have]
    if miss: sys.exit(f"HMDA file is missing expected columns {miss}; columns are {have[:30]}...")
    parts, n = [], 0
    for ch in pd.read_csv(zf.open(name), sep=sep, usecols=COLS, dtype=str, chunksize=2_000_000, low_memory=False):
        n += len(ch)
        ch = ch.rename(columns={"open-end_line_of_credit": "open_end"})
        for c in ("action_taken", "occupancy_type", "loan_purpose", "lien_status", "open_end"):
            ch[c] = pd.to_numeric(ch[c], errors="coerce")
        parts.append(classify(ch))
        log(f"  {n:,} records read")
    return pd.concat(parts, ignore_index=True), n


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--year", type=int); ap.add_argument("--lar"); ap.add_argument("--rel")
    a = ap.parse_args()
    if a.lar:
        y, lar = a.year or 0, a.lar
    else:
        y, url = find_lar(a.year)
        lar = download(url, "/tmp/hmda_lar.zip")
    rel_path = a.rel or download(REL_URL, "/tmp/zcta_tract_rel.txt")

    loans, nrec = read_lar(lar)
    if not a.lar: os.remove(lar)
    loans["tract"] = loans.tract.fillna("").str.replace(r"\.0$", "", regex=True).str.strip()
    ok = loans.tract.str.fullmatch(r"\d{11}")
    tot = loans[["purch", "refi", "equity"]].sum()
    log(f"Owner-occupied originations: purchase {tot.purch:,}, refinance {tot.refi:,}, equity {tot.equity:,}")
    no_tract = loans[~ok][["purch", "refi", "equity"]].sum().sum() / max(1, tot.sum())
    log(f"Loans with no census tract (not placed in a ZIP): {no_tract:.1%}")
    tr = loans[ok].groupby("tract")[["purch", "refi", "equity"]].sum()

    rel = pd.read_csv(rel_path, sep="|", dtype=str)
    rel.columns = [c.upper() for c in rel.columns]
    zc, tc = "GEOID_ZCTA5_20", "GEOID_TRACT_20"
    rel = rel[rel[zc].notna() & (rel[zc].str.len() == 5)]
    land = pd.to_numeric(rel["AREALAND_PART"], errors="coerce").fillna(0)
    tland = land.groupby(rel[tc]).transform("sum")
    rel["w"] = np.where(tland > 0, land / tland.replace(0, np.nan), 0)
    # tracts with no land in any ZCTA (all water): split evenly
    cnt = rel.groupby(tc)[zc].transform("count")
    rel.loc[tland == 0, "w"] = 1 / cnt[tland == 0]
    m = rel[[zc, tc, "w"]].merge(tr, left_on=tc, right_index=True, how="inner")
    for c in ("purch", "refi", "equity"): m[c] = m[c] * m.w
    z = m.groupby(zc)[["purch", "refi", "equity"]].sum()
    placed = z.sum().sum() / max(1, loans[ok][["purch", "refi", "equity"]].sum().sum())
    log(f"Share of tract-coded loans placed in ZIPs: {placed:.1%}")
    if placed < 0.97: sys.exit(f"Only {placed:.1%} of loans matched a ZIP; check the relationship file.")
    z.columns = ["hmda_purch", "hmda_refi", "hmda_equity"]
    z["hmda_total"] = z.sum(axis=1)
    z = z.round(2)
    z.index.name = "zip"
    os.makedirs(OUT, exist_ok=True)
    z.reset_index().to_csv(os.path.join(OUT, "zip_hmda.csv.gz"), index=False, compression="gzip")
    facts = {"year": y, "records": int(nrec), "purchase": int(tot.purch), "refinance": int(tot.refi), "equity": int(tot.equity),
             "no_tract_share": round(float(no_tract), 4), "placed_share": round(float(placed), 4), "zips": int(len(z)),
             "built": datetime.date.today().isoformat()}
    json.dump(facts, open(os.path.join(OUT, "hmda_facts.json"), "w"), indent=1)
    log(json.dumps(facts))
    # Sanity: national purchase originations on owner-occupied homes run roughly 2-5 million a year
    if not (1_000_000 <= tot.purch <= 6_000_000) and not a.lar:
        sys.exit(f"Purchase originations {tot.purch:,} are outside the expected 1-6 million; not saved as final.")


if __name__ == "__main__":
    main()
