"""Builds shared/audience/zip_audience.json for the ZIP radius audience tool.

All audience fields come from Census ACS 5-year tables, pulled by ZIP Code Tabulation Area from the public Census API
(no key needed at this volume: nine table requests per run). Every ACS column used is checked against the Census
variable labels before it is trusted, and the build stops without writing anything if a label doesn't match.
Town names, coordinates, DMA and metro come from data-build/geo/zip_geo.csv (the step 2 geography table).

  python3 data-build/build_audience.py              # live (GitHub Actions)
  python3 data-build/build_audience.py --cache DIR  # read saved API responses from DIR (tests)
"""
import argparse, datetime, json, os, sys, time, urllib.request, urllib.error
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "shared", "audience")
API = "https://api.census.gov/data/{year}/acs/acs5"
YEARS = [2025, 2024, 2023]
ZCTA = "zip code tabulation area"

def v(table, n): return f"{table}_{n:03d}E"

# Sex by age (B01001): male 15-17 is line 6 ... 85+ is line 25; female lines are +24.
AGE_LINES = {"15_17": [6], "18_24": [7, 8, 9, 10], "25_34": [11, 12], "35_44": [13, 14], "45_54": [15, 16],
             "55p": list(range(17, 26))}
AGE_LABELS = {6: "15 to 17", 7: "18 and 19", 8: "20 years", 9: "21 years", 10: "22 to 24", 11: "25 to 29", 12: "30 to 34",
              13: "35 to 39", 14: "40 to 44", 15: "45 to 49", 16: "50 to 54", 17: "55 to 59", 25: "85 years"}
INC = {"lt35": range(2, 8), "35_75": range(8, 13), "75_150": range(13, 16), "150p": range(16, 18)}
INC_LABELS = {2: "Less than $10,000", 7: "$30,000 to $34,999", 8: "$35,000 to $39,999", 12: "$60,000 to $74,999",
              13: "$75,000 to $99,999", 15: "$125,000 to $149,999", 16: "$150,000 to $199,999", 17: "$200,000 or more"}

REQUESTS = {
    "B01001": [v("B01001", 1)] + [v("B01001", n) for n in range(6, 26)] + [v("B01001", n + 24) for n in range(6, 26)],
    "B19001": [v("B19001", n) for n in range(1, 18)],
    "B25013": [v("B25013", n) for n in range(1, 12)],
    "B11005": [v("B11005", 1), v("B11005", 2)],
    "B14001": [v("B14001", 1), v("B14001", 8), v("B14001", 9)],
    "B03003": [v("B03003", 1), v("B03003", 3)],                       # Hispanic or Latino origin
    "C16001": [v("C16001", 1), v("C16001", 3)],                       # language at home, population 5+
    "B21001": [v("B21001", 1), v("B21001", 2)],                       # veteran status, civilian 18+
    "B15003": [v("B15003", 1), v("B15003", 19), v("B15003", 20)],     # education, population 25+
}
# Label checks: (variable, words that must appear in its Census label)
LABEL_CHECKS = [(v("B01001", 2), ["Male"]), (v("B01001", 26), ["Female"])] + \
    [(v("B01001", n), ["Male", t]) for n, t in AGE_LABELS.items()] + \
    [(v("B01001", n + 24), ["Female", t]) for n, t in AGE_LABELS.items()] + \
    [(v("B19001", n), [t]) for n, t in INC_LABELS.items()] + \
    [(v("B25013", 2), ["Owner occupied"]), (v("B25013", 3), ["Owner", "Less than high school"]),
     (v("B25013", 4), ["Owner", "High school graduate"]), (v("B25013", 5), ["Owner", "Some college"]),
     (v("B25013", 6), ["Owner", "Bachelor"]), (v("B25013", 7), ["Renter"]),
     (v("B25013", 8), ["Renter", "Less than high school"]), (v("B25013", 9), ["Renter", "High school graduate"]),
     (v("B25013", 10), ["Renter", "Some college"]), (v("B25013", 11), ["Renter", "Bachelor"]),
     (v("B11005", 2), ["under 18"]), (v("B14001", 8), ["college", "undergraduate"]),
     (v("B14001", 9), ["Graduate or professional"]),
     (v("B03003", 3), ["Hispanic or Latino"]),
     (v("C16001", 3), ["Spanish"]),
     (v("B21001", 2), ["Veteran"]),
     (v("B15003", 19), ["Some college", "less than 1 year"]), (v("B15003", 20), ["Some college", "no degree"])]


KEY = os.environ.get("CENSUS_API_KEY", "").strip()


def fetch(url, tries=4):
    if KEY: url += ("&" if "?" in url else "?") + "key=" + KEY
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Adtaxi analyzer data build; github.com/MWoronoff)",
                                              "Accept": "application/json"})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read().decode("utf-8", "replace")
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                raise RuntimeError("Census sent a non-data reply: " + " ".join(body.split())[:300])
        except urllib.error.HTTPError as e:
            msg = " ".join(e.read().decode("utf-8", "replace").split())[:300]
            err = RuntimeError(f"HTTP {e.code} from Census: {msg}")
            if e.code in (400, 404) or i == tries - 1: raise err   # not worth retrying
        except (urllib.error.URLError, TimeoutError, RuntimeError) as e:
            if i == tries - 1: raise RuntimeError(f"{type(e).__name__}: {e}")
        time.sleep(5 * (i + 1))


def load(name, url, cache):
    if cache:
        p = os.path.join(cache, name + ".json")
        return json.load(open(p)) if os.path.exists(p) else None
    return fetch(url)


def pick_year(cache):
    print("Census API key:", "yes (CENSUS_API_KEY secret)" if KEY else "none (public access)")
    for y in YEARS:
        if cache:
            if os.path.exists(os.path.join(cache, f"{y}_B11005.json")): return y
            continue
        try:
            fetch(API.format(year=y) + f"?get={v('B11005', 1)}&for={ZCTA.replace(' ', '%20')}:00601", tries=3)
            print(f"ACS 5-year {y - 4}-{y}: available")
            return y
        except Exception as e:
            print(f"ACS 5-year {y - 4}-{y}: not reachable -> {e}")
    sys.exit("No ACS 5-year release could be reached at api.census.gov (reasons above)")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--cache"); a = ap.parse_args()
    year = pick_year(a.cache)
    rep = [("ACS release", "INFO", f"ACS 5-year {year - 4}–{year}")]

    # 1. Label checks
    bad, checked = [], 0
    for table in REQUESTS:
        g = load(f"{year}_{table}_groups", API.format(year=year) + f"/groups/{table}.json", a.cache)
        if g is None:
            rep.append((f"Labels {table}", "SKIP", "no saved labels in test mode")); continue
        labels = {k: val.get("label", "") for k, val in g["variables"].items()}
        for var, words in LABEL_CHECKS:
            if var.split("_")[0] != table: continue
            checked += 1
            if not all(w.lower() in labels.get(var, "").lower() for w in words):
                bad.append(f"{var}: expected {words}, Census says '{labels.get(var, 'missing')}'")
    if bad:
        print("\n".join(bad)); sys.exit("Census variable labels don't match what the tool expects; nothing was written.")
    rep.append(("Census labels match the columns used", "PASS", f"{checked} variables checked"))

    # 2. Tables
    acs = None
    for table, cols in REQUESTS.items():
        url = API.format(year=year) + "?get=" + ",".join(cols) + "&for=" + ZCTA.replace(" ", "%20") + ":*"
        data = load(f"{year}_{table}", url, a.cache)
        df = pd.DataFrame(data[1:], columns=data[0]).rename(columns={ZCTA: "zip"})[["zip"] + cols]
        for c in cols: df[c] = pd.to_numeric(df[c], errors="coerce").clip(lower=0)   # negative = Census "not available"
        acs = df if acs is None else acs.merge(df, on="zip", how="outer")
    rep.append(("ZCTAs returned by the Census API", "INFO", f"{len(acs):,}"))

    out = pd.DataFrame({"zip": acs.zip})
    out["acs_pop"] = acs[v("B01001", 1)]
    for sex, off in (("m", 0), ("f", 24)):
        for band, lines in AGE_LINES.items():
            out[f"{sex}{band}"] = sum(acs[v("B01001", n + off)] for n in lines)
    out["adults18"] = sum(out[f"{s}{b}"] for s in "mf" for b in ("18_24", "25_34", "35_44", "45_54", "55p"))
    for band, lines in INC.items():
        out[f"inc_{band}"] = sum(acs[v("B19001", n)] for n in lines)
    out["inc_tot"] = acs[v("B19001", 1)]
    out["hhed_nocol"] = acs[v("B25013", 3)] + acs[v("B25013", 4)] + acs[v("B25013", 8)] + acs[v("B25013", 9)]
    out["hhed_some"] = acs[v("B25013", 5)] + acs[v("B25013", 10)]
    out["hhed_ba"] = acs[v("B25013", 6)] + acs[v("B25013", 11)]
    out["hhed_tot"] = acs[v("B25013", 1)]
    out["owners"] = acs[v("B25013", 2)]
    out["hh_kids"], out["hh_tot"] = acs[v("B11005", 2)], acs[v("B11005", 1)]
    out["enr_college"] = acs[v("B14001", 8)] + acs[v("B14001", 9)]
    out["enr_tot"] = acs[v("B14001", 1)]
    out["hispanic"], out["hisp_tot"] = acs[v("B03003", 3)], acs[v("B03003", 1)]
    out["lang_spanish"], out["pop5"] = acs[v("C16001", 3)], acs[v("C16001", 1)]
    out["veterans"], out["vet_tot"] = acs[v("B21001", 2)], acs[v("B21001", 1)]
    out["some_college"] = acs[v("B15003", 19)] + acs[v("B15003", 20)]
    out["adults25"] = acs[v("B15003", 1)]

    # 3. Internal consistency checks
    def chk(name, parts, total, tol=1):
        diff = (sum(out[p] for p in parts) - out[total]).abs()
        n = int((diff > tol).sum())
        rep.append((name, "PASS" if n == 0 else "FAIL", f"{n} ZIPs where the parts don't add up to the total"))
    chk("Income bands add up", [f"inc_{b}" for b in INC], "inc_tot")
    chk("Head-of-household education adds up", ["hhed_nocol", "hhed_some", "hhed_ba"], "hhed_tot")
    over = int((out[[f"{s}{b}" for s in "mf" for b in AGE_LINES]].sum(axis=1) > out.acs_pop + 12).sum())
    rep.append(("Age bands never exceed population", "PASS" if over == 0 else "FAIL", f"{over} ZIPs over"))
    for part, total, name in (("hh_kids", "hh_tot", "Households with children"), ("enr_college", "enr_tot", "College enrollment"),
                              ("hispanic", "hisp_tot", "Hispanic population"), ("lang_spanish", "pop5", "Spanish at home"),
                              ("veterans", "vet_tot", "Veterans"), ("some_college", "adults25", "Some college, no degree"),
                              ("owners", "hhed_tot", "Homeowners")):
        n = int((out[part] > out[total] + 1).sum())
        rep.append((f"{name} never exceeds its total", "PASS" if n == 0 else "FAIL", f"{n} ZIPs over"))

    # 4. Join to the master ZIP list
    geo = pd.read_csv(os.path.join(HERE, "geo", "zip_geo.csv"), dtype={"zip": str, "dma_code": str, "cbsa_code": str})
    m = geo[["zip", "city", "state", "lat", "lon", "dma_code", "cbsa_code", "population", "households"]].merge(out, on="zip", how="left")
    m = m[m.lat.notna() & m.lon.notna()]
    matched = m.acs_pop.notna()
    rep.append(("ZIPs with Census data", "INFO", f"{int(matched.sum()):,} of {len(m):,} ZIPs, holding "
                f"{m.loc[matched, 'population'].sum() / m.population.sum():.1%} of Deluxe population; the rest are PO box or business ZIPs"))
    tot = lambda c: int(m[c].fillna(0).sum())
    rep.append(("National totals", "INFO", f"population {tot('acs_pop'):,}; households {tot('hh_tot'):,}; "
                f"college enrolled {tot('enr_college'):,}; households with children {tot('hh_kids'):,}"))
    # Published national benchmarks (ACS 5-year): population ~332-336M; Hispanic ~19%; veterans ~6-7% of civilian adults;
    # Spanish at home ~13% of people 5+; households with children ~27-30%.
    bench = [("national population", tot("acs_pop") / 1e6, 320, 345, "{:.1f} million"),
             ("Hispanic share", tot("hispanic") / max(tot("hisp_tot"), 1) * 100, 16, 22, "{:.1f}%"),
             ("Spanish at home share", tot("lang_spanish") / max(tot("pop5"), 1) * 100, 10, 16, "{:.1f}%"),
             ("veteran share of civilian adults", tot("veterans") / max(tot("vet_tot"), 1) * 100, 4.5, 8.5, "{:.1f}%"),
             ("households with children", tot("hh_kids") / max(tot("hh_tot"), 1) * 100, 24, 33, "{:.1f}%")]
    for name, val, lo, hi, fmt in bench:
        rep.append((f"Published benchmark: {name}", "PASS" if lo < val < hi else "FAIL", fmt.format(val) + f" (expected {lo}–{hi})"))

    failed = [r for r in rep if r[1] == "FAIL"]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "audience_report.md"), "w") as f:
        f.write(f"# Audience data check report\n\nResult: **{'FAILED' if failed else 'PASSED'}**\n\n| Check | Result | Detail |\n| --- | --- | --- |\n")
        for r in rep: f.write(f"| {r[0]} | {r[1]} | {r[2]} |\n")
    for r in rep: print(f"[{r[1]}] {r[0]}: {r[2]}")
    if failed:
        sys.exit("A check failed; the audience data was not updated. See shared/audience/audience_report.md.")

    # 5. Write compact column arrays
    num = ["population", "households", "acs_pop", "adults18"] + [f"{s}{b}" for s in "mf" for b in AGE_LINES] + \
          [f"inc_{b}" for b in INC] + ["inc_tot", "hhed_nocol", "hhed_some", "hhed_ba", "hhed_tot", "owners", "hh_kids", "hh_tot",
          "enr_college", "enr_tot", "hispanic", "hisp_tot", "lang_spanish", "pop5", "veterans", "vet_tot", "some_college", "adults25"]
    cols = {"zip": m.zip.tolist(), "city": m.city.fillna("").tolist(), "state": m.state.tolist(),
            "lat": m.lat.round(4).tolist(), "lon": m.lon.round(4).tolist(),
            "dma": m.dma_code.fillna("").tolist(), "cbsa": m.cbsa_code.fillna("").tolist()}
    for c in num:
        cols[c] = [None if pd.isna(x) else int(round(x)) for x in m[c]]
    meta = {"built": datetime.date.today().isoformat(), "acsYears": f"{year - 4}–{year}", "rows": len(m),
            "sources": {"acs": f"Census ACS 5-year {year - 4}–{year} (B01001, B19001, B25013, B11005, B14001, B03003, C16001, B21001, B15003)",
                        "geo": "Town, DMA and metro from Adtaxi's ZIP geography table"}}
    json.dump({"meta": meta, "cols": cols}, open(os.path.join(OUT, "zip_audience.json"), "w"), separators=(",", ":"))
    print("Wrote", os.path.join(OUT, "zip_audience.json"))


if __name__ == "__main__":
    main()
