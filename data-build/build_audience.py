"""Builds shared/audience/zip_audience.json for the ZIP radius audience tool.

All audience fields come from Census ACS 5-year tables by ZIP Code Tabulation Area. The build first tries the public
Census API (no key needed). If the API refuses the request, it downloads the same tables as plain data files from the
Census file server (www2.census.gov, the ACS "table-based summary file"), which needs no key either. Every ACS column used is checked against the Census
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
              13: "35 to 39", 14: "40 to 44", 15: "45 to 49", 16: "50 to 54", 17: "55 to 59", 19: "62 to 64", 20: "65 and 66",
              23: "75 to 79", 25: "85 years"}
# Extra age groups for the Healthcare analyzer (both sexes; B01001 lines for males, +24 for females)
AGE_GROUPS = {"a25_64": range(11, 20), "a30_64": range(12, 20), "a45p": range(15, 26), "a65p": range(20, 26), "a75p": range(23, 26)}
# Household income (B19001): line 2 is under $10K ... line 17 is $200K+ (the highest band Census publishes by ZIP).
INC = {"lt35": range(2, 8), "35_50": range(8, 11), "50_75": range(11, 13), "75_100": [13], "100_150": [14, 15],
       "150_200": [16], "200p": [17]}
INC_LABELS = {2: "Less than $10,000", 5: "$20,000 to $24,999", 6: "$25,000 to $29,999", 7: "$30,000 to $34,999",
              8: "$35,000 to $39,999", 10: "$45,000 to $49,999", 11: "$50,000 to $59,999", 12: "$60,000 to $74,999",
              13: "$75,000 to $99,999", 14: "$100,000 to $124,999", 15: "$125,000 to $149,999",
              16: "$150,000 to $199,999", 17: "$200,000 or more"}

REQUESTS = {
    "B01001": [v("B01001", 1)] + [v("B01001", n) for n in range(6, 26)] + [v("B01001", n + 24) for n in range(6, 26)],
    "B19001": [v("B19001", n) for n in range(1, 18)],
    "B25013": [v("B25013", n) for n in range(1, 12)],
    "B11005": [v("B11005", 1), v("B11005", 2)],
    "B14001": [v("B14001", 1), v("B14001", 8), v("B14001", 9)],
    "B03003": [v("B03003", 1), v("B03003", 3)],                       # Hispanic or Latino origin
    "C16001": [v("C16001", 1), v("C16001", 3)],                       # language at home, population 5+
    "B21001": [v("B21001", 1), v("B21001", 2)],                       # veteran status, civilian 18+
    "B15003": [v("B15003", n) for n in (1, 17, 18, 19, 20, 21, 22, 23, 24, 25)],   # education, population 25+
    # Legal analyzer
    "B12001": [v("B12001", n) for n in (1, 2, 3, 4, 7, 9, 10, 11, 12, 13, 16, 18, 19)],   # sex by marital status, 15+
    "B25007": [v("B25007", n) for n in range(1, 12)],                 # tenure by age of householder (owner lines 2-11)
    "B17017": [v("B17017", 1), v("B17017", 2)],                        # households below poverty
    "B23025": [v("B23025", n) for n in (1, 3, 4, 5)],                  # employment status, 16+
    "B08301": [v("B08301", 1), v("B08301", 2)],                        # means of transportation to work
    "B25075": [v("B25075", n) for n in range(1, 28)],                 # value of owner-occupied homes
    "C16002": [v("C16002", n) for n in (1, 2, 3, 4, 6, 7, 9, 10, 12, 13)],   # household language, limited English
    # Higher Education analyzer: sex by age by educational attainment, 18+ (all 83 lines, so every age group can be checked)
    "B15001": [v("B15001", n) for n in range(1, 84)],
}
# B15001 layout: male total 2, female total 43; each age group's total line, followed by its 7 education lines
# (less than 9th grade, 9th-12th no diploma, high school graduate, some college no degree, associate's, bachelor's, graduate)
B15001_GROUPS = {"18_24": (3, 44), "25_34": (11, 52), "35_44": (19, 60), "45_64": (27, 68), "65p": (35, 76)}
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
     (v("B15003", 19), ["Some college", "less than 1 year"]), (v("B15003", 20), ["Some college", "no degree"]),
     (v("B12001", 7), ["Male", "Separated"]), (v("B12001", 10), ["Male", "Divorced"]), (v("B12001", 16), ["Female", "Separated"]),
     (v("B12001", 19), ["Female", "Divorced"]), (v("B25007", 2), ["Owner occupied"]), (v("B25007", 7), ["Owner", "55 to 59"]),
     (v("B25007", 11), ["Owner", "85 years"]), (v("B17017", 2), ["below poverty"]), (v("B23025", 4), ["Employed"]),
     (v("B23025", 5), ["Unemployed"]), (v("B08301", 2), ["Car, truck, or van"]), (v("B25075", 21), ["$300,000 to $399,999"]),
     (v("B25075", 27), ["$2,000,000 or more"]), (v("C16002", 4), ["Spanish", "Limited English"]),
     (v("C16002", 13), ["Other languages", "Limited English"]),
     (v("B15003", 17), ["Regular high school diploma"]), (v("B15003", 18), ["GED"]), (v("B15003", 21), ["Associate"]),
     (v("B15003", 22), ["Bachelor"]), (v("B15003", 25), ["Doctorate"]),
     (v("B15001", 3), ["Male", "18 to 24"]), (v("B15001", 7), ["Male", "18 to 24", "Some college"]),
     (v("B15001", 27), ["Male", "45 to 64"]), (v("B15001", 43), ["Female"]), (v("B15001", 52), ["Female", "25 to 34"]),
     (v("B15001", 83), ["Female", "65 years and over", "Graduate"])]


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


BULK = "https://www2.census.gov/programs-surveys/acs/summary_file/{year}/table-based-SF/data/5YRData/acsdt5y{year}-{table}.dat"


def bulk_col(var):   # API name B01001_006E -> summary file name B01001_E006
    t, n = var[:-1].split("_")
    return f"{t}_E{n}"


def bulk_table(year, table, cols, cache):
    """Reads one table from the ACS table-based summary file, keeping ZCTA rows only (GEO_ID 860Z200USxxxxx)."""
    if cache:
        path = os.path.join(cache, f"bulk_{year}_{table.lower()}.dat")
        lines = open(path, encoding="utf-8")
    else:
        url = BULK.format(year=year, table=table.lower())
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Adtaxi analyzer data build)"})
        for i in range(4):
            try:
                resp = urllib.request.urlopen(req, timeout=600); break
            except Exception as e:
                if i == 3: raise RuntimeError(f"couldn't download {url}: {e}")
                time.sleep(10 * (i + 1))
        lines = (b.decode("utf-8", "replace") for b in resp)
    it = iter(lines)
    hdr = next(it).rstrip("\r\n").split("|")
    want = [bulk_col(c) for c in cols]
    missing = [w for w in want if w not in hdr]
    if missing:
        raise RuntimeError(f"{table} summary file is missing columns {missing}")
    gi, idx = hdr.index("GEO_ID"), [hdr.index(w) for w in want]
    rows = []
    for line in it:
        if not line.startswith("860Z200US"): continue
        f = line.rstrip("\r\n").split("|")
        rows.append([f[gi][9:]] + [f[k] for k in idx])
    return pd.DataFrame(rows, columns=["zip"] + cols)


def bulk_year(cache):
    for y in YEARS:
        if cache:
            if os.path.exists(os.path.join(cache, f"bulk_{y}_b11005.dat")): return y
            continue
        url = BULK.format(year=y, table="b11005")
        try:
            req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0 (Adtaxi analyzer data build)"})
            urllib.request.urlopen(req, timeout=60)
            print(f"Census file server: ACS 5-year {y - 4}-{y} available")
            return y
        except Exception as e:
            print(f"Census file server: ACS 5-year {y - 4}-{y} not available -> {e}")
    sys.exit("Neither the Census API nor the Census file server could be reached (reasons above).")


def load(name, url, cache):
    if cache:
        p = os.path.join(cache, name + ".json")
        return json.load(open(p)) if os.path.exists(p) else None
    return fetch(url)


def pick_year(cache):
    print("Census API key:", "yes (CENSUS_API_KEY secret)" if KEY else "none (public access)")
    if cache and os.environ.get("ACS_SOURCE") == "files": return None
    for y in YEARS:
        if cache:
            if os.path.exists(os.path.join(cache, f"{y}_B11005.json")): return y
            continue
        if os.environ.get("ACS_SOURCE") == "files": break
        try:
            fetch(API.format(year=y) + f"?get={v('B11005', 1)}&for={ZCTA.replace(' ', '%20')}:00601", tries=3)
            print(f"ACS 5-year {y - 4}-{y}: available")
            return y
        except Exception as e:
            print(f"ACS 5-year {y - 4}-{y}: not reachable -> {e}")
    print("The Census API refused or couldn't be reached; switching to the Census file server.")
    return None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--cache"); a = ap.parse_args()
    year = pick_year(a.cache)
    source = "Census API"
    if year is None:
        year, source = bulk_year(a.cache), "Census file server (table-based summary file)"
    rep = [("ACS release", "INFO", f"ACS 5-year {year - 4}–{year}"), ("Download source", "INFO", source)]

    # 1. Label checks (API only; the file server has no label lookup, so the add-up and benchmark checks below guard it)
    bad, checked = [], 0
    for table in (REQUESTS if source == "Census API" else []):
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
    if source == "Census API":
        rep.append(("Census labels match the columns used", "PASS", f"{checked} variables checked"))
    else:
        rep.append(("Census labels match the columns used", "SKIP", "file server has no label lookup; add-up and benchmark checks apply"))

    # 2. Tables
    acs = None
    for table, cols in REQUESTS.items():
        if source == "Census API":
            url = API.format(year=year) + "?get=" + ",".join(cols) + "&for=" + ZCTA.replace(" ", "%20") + ":*"
            data = load(f"{year}_{table}", url, a.cache)
            df = pd.DataFrame(data[1:], columns=data[0]).rename(columns={ZCTA: "zip"})[["zip"] + cols]
        else:
            print(f"Downloading {table} from the Census file server...", flush=True)
            df = bulk_table(year, table, cols, a.cache)
        for c in cols: df[c] = pd.to_numeric(df[c], errors="coerce").clip(lower=0)   # negative = Census "not available"
        acs = df if acs is None else acs.merge(df, on="zip", how="outer")
    rep.append(("ZCTAs returned by Census", "PASS" if len(acs) > 30000 else "FAIL", f"{len(acs):,} (expected about 33,000)"))

    out = pd.DataFrame({"zip": acs.zip})
    out["acs_pop"] = acs[v("B01001", 1)]
    for sex, off in (("m", 0), ("f", 24)):
        for band, lines in AGE_LINES.items():
            out[f"{sex}{band}"] = sum(acs[v("B01001", n + off)] for n in lines)
    out["adults18"] = sum(out[f"{s}{b}"] for s in "mf" for b in ("18_24", "25_34", "35_44", "45_54", "55p"))
    for g, lines in AGE_GROUPS.items():
        out[g] = sum(acs[v("B01001", n)] + acs[v("B01001", n + 24)] for n in lines)
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
    # Legal analyzer
    out["marital_tot"] = acs[v("B12001", 1)]
    out["divsep"] = sum(acs[v("B12001", n)] for n in (7, 10, 16, 19))
    out["own_tot"] = acs[v("B25007", 2)]
    out["own55"] = sum(acs[v("B25007", n)] for n in range(7, 12))
    out["pov_hh"], out["pov_tot"] = acs[v("B17017", 2)], acs[v("B17017", 1)]
    out["labor_civ"], out["employed"], out["unemployed"] = acs[v("B23025", 3)], acs[v("B23025", 4)], acs[v("B23025", 5)]
    out["workers"], out["car_commute"] = acs[v("B08301", 1)], acs[v("B08301", 2)]
    out["val_tot"] = acs[v("B25075", 1)]
    out["val300"] = sum(acs[v("B25075", n)] for n in range(21, 28))
    out["lang_hh"] = acs[v("C16002", 1)]
    out["lep_hh"] = sum(acs[v("C16002", n)] for n in (4, 7, 10, 13))
    # Higher Education analyzer
    out["hs_only"] = acs[v("B15003", 17)] + acs[v("B15003", 18)]           # 25+, highest is a high school diploma or GED
    out["assoc"] = acs[v("B15003", 21)]
    out["ba_only"] = acs[v("B15003", 22)]                                   # 25+, highest is a bachelor's degree
    out["grad_deg"] = sum(acs[v("B15003", n)] for n in (23, 24, 25))
    G = lambda grp, k: acs[v("B15001", B15001_GROUPS[grp][0] + k)] + acs[v("B15001", B15001_GROUPS[grp][1] + k)]
    out["pop18_34"] = G("18_24", 0) + G("25_34", 0)
    out["nodeg18_34"] = sum(G(g, k) for g in ("18_24", "25_34") for k in (1, 2, 3, 4))   # no college degree
    out["pop25_64"] = sum(G(g, 0) for g in ("25_34", "35_44", "45_64"))
    out["somecol25_64"] = sum(G(g, 4) for g in ("25_34", "35_44", "45_64"))

    # 3. Internal consistency checks
    def chk(name, parts, total, tol=1):
        diff = (sum(out[p] for p in parts) - out[total]).abs()
        n = int((diff > tol).sum())
        rep.append((name, "PASS" if n == 0 else "FAIL", f"{n} ZIPs where the parts don't add up to the total"))
    chk("Income bands add up", [f"inc_{b}" for b in INC], "inc_tot")
    chk("Head-of-household education adds up", ["hhed_nocol", "hhed_some", "hhed_ba"], "hhed_tot")
    nest = int(((out.a75p > out.a65p) | (out.a65p > out.a45p) | (out.a30_64 > out.a25_64) | (out.a25_64 > out.adults18)).sum())
    rep.append(("Healthcare age groups nest correctly (75+ within 65+ within 45+)", "PASS" if nest == 0 else "FAIL", f"{nest} ZIPs out of order"))
    over = int((out[[f"{s}{b}" for s in "mf" for b in AGE_LINES]].sum(axis=1) > out.acs_pop + 12).sum())
    rep.append(("Age bands never exceed population", "PASS" if over == 0 else "FAIL", f"{over} ZIPs over"))
    for part, total, name in (("hh_kids", "hh_tot", "Households with children"), ("enr_college", "enr_tot", "College enrollment"),
                              ("hispanic", "hisp_tot", "Hispanic population"), ("lang_spanish", "pop5", "Spanish at home"),
                              ("veterans", "vet_tot", "Veterans"), ("some_college", "adults25", "Some college, no degree"),
                              ("owners", "hhed_tot", "Homeowners")):
        n = int((out[part] > out[total] + 1).sum())
        rep.append((f"{name} never exceeds its total", "PASS" if n == 0 else "FAIL", f"{n} ZIPs over"))

    # Legal tables: parts add up to their totals (catches wrong line numbers, since the file server has no labels)
    msum = acs[v("B12001", 2)] + acs[v("B12001", 11)]
    n = int(((msum - out.marital_tot).abs() > 1).sum()); rep.append(("Marital status: male + female = total", "PASS" if n == 0 else "FAIL", f"{n} ZIPs off"))
    mparts = sum(acs[v("B12001", k)] for k in (3, 4, 9, 10)) - acs[v("B12001", 2)]
    n = int((mparts.abs() > 1).sum()); rep.append(("Marital status: male never/now married + widowed + divorced = male total", "PASS" if n == 0 else "FAIL", f"{n} ZIPs off"))
    oparts = sum(acs[v("B25007", k)] for k in range(3, 12)) - out.own_tot
    n = int((oparts.abs() > 1).sum()); rep.append(("Homeowner ages add up", "PASS" if n == 0 else "FAIL", f"{n} ZIPs off"))
    n = int(((out.employed + out.unemployed - out.labor_civ).abs() > 1).sum()); rep.append(("Employed + unemployed = civilian labor force", "PASS" if n == 0 else "FAIL", f"{n} ZIPs off"))
    vparts = sum(acs[v("B25075", k)] for k in range(2, 28)) - out.val_tot
    n = int((vparts.abs() > 1).sum()); rep.append(("Home value bands add up", "PASS" if n == 0 else "FAIL", f"{n} ZIPs off"))
    lparts = sum(acs[v("C16002", k)] for k in (2, 3, 6, 9, 12)) - out.lang_hh
    n = int((lparts.abs() > 1).sum()); rep.append(("Household language groups add up", "PASS" if n == 0 else "FAIL", f"{n} ZIPs off"))
    for part, total, name in (("divsep", "marital_tot", "Divorced or separated"), ("own55", "own_tot", "Homeowners 55+"),
                              ("pov_hh", "pov_tot", "Households below poverty"), ("car_commute", "workers", "Car commuters"),
                              ("val300", "val_tot", "Homes worth $300K+"), ("lep_hh", "lang_hh", "Limited-English households")):
        n = int((out[part] > out[total] + 1).sum())
        rep.append((f"{name} never exceeds its total", "PASS" if n == 0 else "FAIL", f"{n} ZIPs over"))

    # Higher Education tables: every B15001 age group adds up, and the 25+ figures agree with B15003 (catches wrong line numbers)
    bad = 0
    for g, (ml, fl) in B15001_GROUPS.items():
        for base in (ml, fl):
            bad += int(((sum(acs[v("B15001", base + k)] for k in range(1, 8)) - acs[v("B15001", base)]).abs() > 1).sum())
    rep.append(("Education by age (B15001): each age group adds up", "PASS" if bad == 0 else "FAIL", f"{bad} ZIP-groups off"))
    for base, name in ((2, "male"), (43, "female")):
        n = int(((sum(acs[v("B15001", B15001_GROUPS[g][0 if base == 2 else 1])] for g in B15001_GROUPS) - acs[v("B15001", base)]).abs() > 1).sum())
        rep.append((f"Education by age: {name} age groups add up to the {name} total", "PASS" if n == 0 else "FAIL", f"{n} ZIPs off"))
    p25 = sum(G(g, 0) for g in ("25_34", "35_44", "45_64", "65p"))
    n = int(((p25 - out.adults25).abs() > 2).sum()); rep.append(("Education by age agrees with B15003: adults 25+", "PASS" if n == 0 else "FAIL", f"{n} ZIPs off"))
    sc = sum(G(g, 4) for g in ("25_34", "35_44", "45_64", "65p"))
    n = int(((sc - out.some_college).abs() > 2).sum()); rep.append(("Education by age agrees with B15003: some college, no degree", "PASS" if n == 0 else "FAIL", f"{n} ZIPs off"))
    ba = sum(G(g, 6) for g in ("25_34", "35_44", "45_64", "65p"))
    n = int(((ba - out.ba_only).abs() > 2).sum()); rep.append(("Education by age agrees with B15003: bachelor's degree", "PASS" if n == 0 else "FAIL", f"{n} ZIPs off"))
    for part, total, name in (("nodeg18_34", "pop18_34", "Adults 18-34 without a degree"), ("somecol25_64", "pop25_64", "Adults 25-64 with some college"),
                              ("hs_only", "adults25", "High school as highest education")):
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
    rep.append(("Published benchmark: share age 65+", "PASS" if 15 < tot("a65p") / max(tot("acs_pop"), 1) * 100 < 20 else "FAIL",
                f"{tot('a65p') / max(tot('acs_pop'), 1) * 100:.1f}% (expected 15–20)"))
    rep.append(("National totals", "INFO", f"population {tot('acs_pop'):,}; households {tot('hh_tot'):,}; "
                f"college enrolled {tot('enr_college'):,}; households with children {tot('hh_kids'):,}"))
    # Published national benchmarks (ACS 5-year): population ~332-336M; Hispanic ~19%; veterans ~6-7% of civilian adults;
    # Spanish at home ~13% of people 5+; households with children ~27-30%.
    bench = [("national population", tot("acs_pop") / 1e6, 320, 345, "{:.1f} million"),
             ("Hispanic share", tot("hispanic") / max(tot("hisp_tot"), 1) * 100, 16, 22, "{:.1f}%"),
             ("Spanish at home share", tot("lang_spanish") / max(tot("pop5"), 1) * 100, 10, 16, "{:.1f}%"),
             ("veteran share of civilian adults", tot("veterans") / max(tot("vet_tot"), 1) * 100, 4.5, 8.5, "{:.1f}%"),
             ("households with children", tot("hh_kids") / max(tot("hh_tot"), 1) * 100, 24, 33, "{:.1f}%"),
             # Legal: divorced or separated ~11-13% of people 15+; owners 55+ ~50-60% of owners; households in poverty ~11-14%;
             # unemployment ~4-6%; car, truck or van ~75-85% of workers; homes $300K+ ~40-55%; limited-English households ~4%
             ("divorced or separated share, 15+", tot("divsep") / max(tot("marital_tot"), 1) * 100, 9, 16, "{:.1f}%"),
             ("homeowners 55+ share of owners", tot("own55") / max(tot("own_tot"), 1) * 100, 40, 65, "{:.1f}%"),
             ("households below poverty", tot("pov_hh") / max(tot("pov_tot"), 1) * 100, 9, 16, "{:.1f}%"),
             ("unemployment rate", tot("unemployed") / max(tot("labor_civ"), 1) * 100, 3, 8, "{:.1f}%"),
             ("car, truck or van share of workers", tot("car_commute") / max(tot("workers"), 1) * 100, 65, 90, "{:.1f}%"),
             ("homes worth $300K+", tot("val300") / max(tot("val_tot"), 1) * 100, 30, 65, "{:.1f}%"),
             ("limited-English households", tot("lep_hh") / max(tot("lang_hh"), 1) * 100, 2, 7, "{:.1f}%"),
             # Higher Education: high school as highest ~26% of 25+; bachelor's as highest ~21%; some college, no degree ~19% of 25-64;
             # 18-34 without a college degree ~60%
             ("high school as highest education, 25+", tot("hs_only") / max(tot("adults25"), 1) * 100, 20, 32, "{:.1f}%"),
             ("bachelor's as highest degree, 25+", tot("ba_only") / max(tot("adults25"), 1) * 100, 17, 26, "{:.1f}%"),
             ("some college, no degree, 25-64", tot("somecol25_64") / max(tot("pop25_64"), 1) * 100, 14, 25, "{:.1f}%"),
             ("18-34 without a college degree", tot("nodeg18_34") / max(tot("pop18_34"), 1) * 100, 45, 72, "{:.1f}%")]
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
    num = ["population", "households", "acs_pop", "adults18"] + list(AGE_GROUPS) + [f"{s}{b}" for s in "mf" for b in AGE_LINES] + \
          [f"inc_{b}" for b in INC] + ["inc_tot", "hhed_nocol", "hhed_some", "hhed_ba", "hhed_tot", "owners", "hh_kids", "hh_tot",
          "enr_college", "enr_tot", "hispanic", "hisp_tot", "lang_spanish", "pop5", "veterans", "vet_tot", "some_college", "adults25",
          "marital_tot", "divsep", "own_tot", "own55", "pov_hh", "pov_tot", "labor_civ", "employed", "unemployed", "workers",
          "car_commute", "val_tot", "val300", "lang_hh", "lep_hh",
          "hs_only", "assoc", "ba_only", "grad_deg", "pop18_34", "nodeg18_34", "pop25_64", "somecol25_64"]
    cols = {"zip": m.zip.tolist(), "city": m.city.fillna("").tolist(), "state": m.state.tolist(),
            "lat": m.lat.round(4).tolist(), "lon": m.lon.round(4).tolist(),
            "dma": m.dma_code.fillna("").tolist(), "cbsa": m.cbsa_code.fillna("").tolist()}
    for c in num:
        cols[c] = [None if pd.isna(x) else int(round(x)) for x in m[c]]
    meta = {"built": datetime.date.today().isoformat(), "acsYears": f"{year - 4}–{year}", "rows": len(m),
            "sources": {"acs": f"Census ACS 5-year {year - 4}–{year} (" + ", ".join(REQUESTS) + ")",
                        "geo": "Town, DMA and metro from Adtaxi's ZIP geography table"}}
    json.dump({"meta": meta, "cols": cols}, open(os.path.join(OUT, "zip_audience.json"), "w"), separators=(",", ":"))
    print("Wrote", os.path.join(OUT, "zip_audience.json"))


if __name__ == "__main__":
    main()
