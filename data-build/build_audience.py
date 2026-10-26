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
    "B01001": [v("B01001", 1)] + [v("B01001", n) for n in range(3, 26)] + [v("B01001", n + 24) for n in range(3, 26)],
    "B19001": [v("B19001", n) for n in range(1, 18)],
    "B25013": [v("B25013", n) for n in range(1, 12)],
    "B11005": [v("B11005", 1), v("B11005", 2)],
    "B14001": [v("B14001", 1), v("B14001", 8), v("B14001", 9)],
    "B03003": [v("B03003", 1), v("B03003", 3)],                       # Hispanic or Latino origin
    "C16001": [v("C16001", 1), v("C16001", 3)],                       # language at home, population 5+
    "B21001": [v("B21001", 1), v("B21001", 2)],                       # veteran status, civilian 18+
    "B15003": [v("B15003", n) for n in (1, 17, 18, 19, 20, 21, 22, 23, 24, 25)],   # education, population 25+
    "B14004": [v("B14004", n) for n in range(1, 34)],                 # college or graduate school enrollment by sex by age, 15+
    # Legal analyzer
    "B12001": [v("B12001", n) for n in (1, 2, 3, 4, 7, 9, 10, 11, 12, 13, 16, 18, 19)],   # sex by marital status, 15+
    "B25007": [v("B25007", n) for n in range(1, 22)],                 # tenure by age of householder (owner 2-11, renter 12-21)
    "B17017": [v("B17017", 1), v("B17017", 2)],                        # households below poverty
    "B23025": [v("B23025", n) for n in range(1, 8)],                   # employment status, 16+
    "B08301": [v("B08301", 1), v("B08301", 2)],                        # means of transportation to work
    "B25075": [v("B25075", n) for n in range(1, 28)],                 # value of owner-occupied homes
    "C16002": [v("C16002", n) for n in (1, 2, 3, 4, 6, 7, 9, 10, 12, 13)],   # household language, limited English
    # Healthcare radius tool
    "B27001": [v("B27001", n) for n in range(1, 58)],                 # health insurance coverage by sex by age
    "B18102": [v("B18102", n) for n in range(1, 40)],                 # hearing difficulty by sex by age
    "B18103": [v("B18103", n) for n in range(1, 40)],                 # vision difficulty by sex by age
    "B09021": [v("B09021", n) for n in range(1, 29)],                 # living arrangements of adults by age
    # Higher Education analyzer: sex by age by educational attainment, 18+ (all 83 lines, so every age group can be checked)
    "B15001": [v("B15001", n) for n in range(1, 84)],
    # Home Services analyzer: owner homes by year built, units in structure and year moved in (all lines, so they can be added up)
    "B25036": [v("B25036", n) for n in range(1, 24)],                 # tenure by year structure built
    "B25032": [v("B25032", n) for n in range(1, 24)],                 # tenure by units in structure
    "B25038": [v("B25038", n) for n in range(1, 16)],                 # tenure by year householder moved into unit
    # Apartment analyzer: renter income, rent burden, rental vacancy, renters with children
    "B25118": [v("B25118", n) for n in range(1, 26)],                 # tenure by household income
    "B25070": [v("B25070", n) for n in range(1, 12)],                 # gross rent as a percentage of household income
    "B25004": [v("B25004", n) for n in range(1, 9)],                  # vacancy status
    "B25115": [v("B25115", n) for n in range(1, 28)],                 # tenure by household type and presence of own children
    # Franchise tools: management occupations (male line 5, female line 41) of civilian employed 16+ (line 1)
    "C24010": [v("C24010", n) for n in (1, 5, 41)],
}
# B25118 renter lines: 14 renter total, 15 under $5,000 ... 20 $25,000-$34,999, 21 $35-49K, 22 $50-74K, 23 $75-99K, 24 $100-149K, 25 $150K+
RINC = {"lt35": range(15, 21), "35_50": [21], "50_75": [22], "75_100": [23], "100_150": [24], "150p": [25]}
# B25070: 7 = 30.0 to 34.9 percent ... 10 = 50 percent or more; 11 = not computed
BURDEN30 = (7, 8, 9, 10)
# B25115 renter lines: 15 renter total; own children under 18 at 18 (married couple), 22 (male householder), 25 (female householder)
RENT_KIDS = (18, 22, 25)
# B25036 owner lines: 3 built 2020 or later, 4 2010-2019, 5 2000-2009, 6 1990s, 7 1980s, 8 1970s ... 12 1939 or earlier (renter = +11)
BUILT = {"2000p": (3, 4, 5), "80_99": (6, 7), "pre1980": (8, 9, 10, 11, 12)}
# B25038 owner lines: 3 newest group ("2023 or later" in 2020-2024), 4 the group before it ("2020 to 2022"),
# 5 2010-2019, 6 2000-2009, 7 1990s, 8 1989 or earlier. Lines 3+4 are "moved in 2020 or later" for 2020-2024; the
# group years shift with each release, so the label checks below look for "or later" rather than a fixed year.
MOVED_PRE2010 = (6, 7, 8)
# B15001 layout: male total 2, female total 43; each age group's total line, followed by its 7 education lines
# (less than 9th grade, 9th-12th no diploma, high school graduate, some college no degree, associate's, bachelor's, graduate)
B15001_GROUPS = {"18_24": (3, 44), "25_34": (11, 52), "35_44": (19, 60), "45_64": (27, 68), "65p": (35, 76)}
# B14004 (college enrollment by sex by age, 15+): male total 2; enrolled in public college 3 (ages 4-7), private 8 (9-12),
# not enrolled 13 (14-17); female lines are +16. Age lines in each block: 15-17, 18-24, 25-34, 35 and over.
ENR_AGES = {"15_17": 0, "18_24": 1, "25_34": 2, "35p": 3}
ENR_BLOCKS = {"public": 3, "private": 8, "not": 13}
# Healthcare radius age brackets (all ages), as B01001 lines for males (+24 for females)
HC_AGES = {"u18": range(3, 7), "18_34": range(7, 13), "35_64": range(13, 20), "65_74": range(20, 23), "75p": range(23, 26)}
# B18102 / B18103 (difficulty by sex by age): each age group is a total line then "with" and "without"; male groups start
# at these lines, female groups 19 lines later. Under 5 and 5-17 together make the under-18 bracket.
DIS_GROUPS = {"u5": 3, "5_17": 6, "18_34": 9, "35_64": 12, "65_74": 15, "75p": 18}
DIS_BRACKETS = {"u18": ("u5", "5_17"), "18_34": ("18_34",), "35_64": ("35_64",), "65_74": ("65_74",), "75p": ("75p",)}
# B27001 (insurance by sex by age): total line, then "with" and "no" coverage; male groups at these lines, female +28.
INS_GROUPS = {"u6": 3, "6_18": 6, "19_25": 9, "26_34": 12, "35_44": 15, "45_54": 18, "55_64": 21, "65_74": 24, "75p": 27}
INS_BRACKETS = {"u18": ("u6", "6_18"), "18_34": ("19_25", "26_34"), "35_64": ("35_44", "45_54", "55_64"),
                "65_74": ("65_74",), "75p": ("75p",)}
# B09021 (living arrangements, adults 18+): age-group total lines, each followed by "lives alone" and five other lines
LIV_GROUPS = {"18_34": 8, "35_64": 15, "65p": 22}
# B25007 (tenure by age of householder) mapped to the Legal radius adult age brackets: owner line, renter line = +10
TEN_BRACKETS = {"18_24": [3], "25_34": [4], "35_44": [5], "45_54": [6], "55p": [7, 8, 9, 10, 11]}
AGE_TEXT = {"u18": "under 18", "18_34": "18–34", "35_64": "35–64", "65_74": "65–74", "75p": "75+", "65p": "65+"}
# B25075 (value of owner-occupied homes) bands
VAL_BANDS = {"lt200": range(2, 19), "200_400": range(19, 22), "400_750": range(22, 24), "750p": range(24, 28)}
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
     (v("B14004", 2), ["Male"]), (v("B14004", 3), ["Male", "public college"]), (v("B14004", 5), ["Male", "public college", "18 to 24"]),
     (v("B14004", 8), ["Male", "private college"]), (v("B14004", 13), ["Male", "Not enrolled"]), (v("B14004", 17), ["Male", "Not enrolled", "35 years"]),
     (v("B14004", 18), ["Female"]), (v("B14004", 21), ["Female", "public college", "18 to 24"]), (v("B14004", 33), ["Female", "Not enrolled", "35 years"]),
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
     (v("B15001", 83), ["Female", "65 years and over", "Graduate"]),
     (v("B01001", 3), ["Male", "Under 5"]), (v("B01001", 27), ["Female", "Under 5"]),
     (v("B27001", 3), ["Male", "Under 6"]), (v("B27001", 5), ["Male", "Under 6", "No health insurance"]),
     (v("B27001", 27), ["Male", "75 years"]), (v("B27001", 30), ["Female"]), (v("B27001", 57), ["Female", "75 years", "No health insurance"]),
     (v("B18102", 4), ["Male", "Under 5", "With a hearing difficulty"]), (v("B18102", 18), ["Male", "75 years"]),
     (v("B18102", 21), ["Female"]), (v("B18102", 38), ["Female", "75 years", "With a hearing difficulty"]),
     (v("B18103", 4), ["Male", "Under 5", "With a vision difficulty"]), (v("B18103", 38), ["Female", "75 years", "With a vision difficulty"]),
     (v("B09021", 2), ["Lives alone"]), (v("B09021", 8), ["18 to 34"]), (v("B09021", 23), ["65 years and over", "Lives alone"]),
     (v("B25007", 12), ["Renter occupied"]), (v("B25007", 13), ["Renter", "15 to 24"]), (v("B25007", 21), ["Renter", "85 years"]),
     (v("B25075", 18), ["$175,000 to $199,999"]), (v("B25075", 23), ["$500,000 to $749,999"]), (v("B25075", 24), ["$750,000 to $999,999"]),
     (v("B23025", 6), ["Armed Forces"]), (v("B23025", 7), ["Not in labor force"]),
     (v("B25036", 2), ["Owner occupied"]), (v("B25036", 3), ["Owner", "2020 or later"]), (v("B25036", 6), ["Owner", "1990 to 1999"]),
     (v("B25036", 8), ["Owner", "1970 to 1979"]), (v("B25036", 12), ["Owner", "1939 or earlier"]), (v("B25036", 13), ["Renter occupied"]),
     (v("B25032", 2), ["Owner"]), (v("B25032", 3), ["Owner", "1, detached"]), (v("B25032", 13), ["Renter"]),
     (v("B25038", 2), ["Owner occupied"]), (v("B25038", 6), ["Owner", "2000 to 2009"]), (v("B25038", 8), ["Owner", "1989 or earlier"]),
     (v("B25038", 9), ["Renter occupied"]),
     (v("B25038", 10), ["Renter", "or later"]),
     (v("B25032", 14), ["Renter", "1, detached"]), (v("B25032", 18), ["Renter", "5 to 9"]), (v("B25032", 20), ["Renter", "20 to 49"]),
     (v("B25032", 21), ["Renter", "50 or more"]),
     (v("B25118", 2), ["Owner occupied"]), (v("B25118", 14), ["Renter occupied"]), (v("B25118", 15), ["Renter", "Less than $5,000"]),
     (v("B25118", 20), ["Renter", "$25,000 to $34,999"]), (v("B25118", 21), ["Renter", "$35,000 to $49,999"]),
     (v("B25118", 24), ["Renter", "$100,000 to $149,999"]), (v("B25118", 25), ["Renter", "$150,000 or more"]),
     (v("B25070", 7), ["30.0 to 34.9 percent"]), (v("B25070", 10), ["50.0 percent or more"]), (v("B25070", 11), ["Not computed"]),
     (v("B25004", 2), ["For rent"]), (v("B25004", 3), ["Rented, not occupied"]),
     (v("B25115", 15), ["Renter occupied"]), (v("B25115", 18), ["Renter", "Married-couple", "With own children"]),
     (v("B25115", 22), ["Renter", "Male householder", "With own children"]), (v("B25115", 25), ["Renter", "Female householder", "With own children"])]


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
    for sex, off in (("m", 0), ("f", 24)):   # franchise tools: 55+ split into 55-64 (lines 17-19) and 65+ (lines 20-25)
        out[f"{sex}55_64"] = sum(acs[v("B01001", n + off)] for n in (17, 18, 19))
        out[f"{sex}65p"] = sum(acs[v("B01001", n + off)] for n in range(20, 26))
    out["occ_tot"], out["mgmt"] = acs[v("C24010", 1)], acs[v("C24010", 5)] + acs[v("C24010", 41)]   # franchise tools: management occupations
    for g, lines in AGE_GROUPS.items():
        out[g] = sum(acs[v("B01001", n)] + acs[v("B01001", n + 24)] for n in lines)
    for band, lines in INC.items():
        out[f"inc_{band}"] = sum(acs[v("B19001", n)] for n in lines)
    out["inc_tot"] = acs[v("B19001", 1)]
    out["inc_100_125"], out["inc_125_150"] = acs[v("B19001", 14)], acs[v("B19001", 15)]   # franchise tools split $100K-$149K at $125K
    out["hhed_nocol"] = acs[v("B25013", 3)] + acs[v("B25013", 4)] + acs[v("B25013", 8)] + acs[v("B25013", 9)]
    out["hhed_some"] = acs[v("B25013", 5)] + acs[v("B25013", 10)]
    out["hhed_ba"] = acs[v("B25013", 6)] + acs[v("B25013", 11)]
    out["hhed_tot"] = acs[v("B25013", 1)]
    out["owners"] = acs[v("B25013", 2)]
    out["hh_kids"], out["hh_tot"] = acs[v("B11005", 2)], acs[v("B11005", 1)]
    out["enr_college"] = acs[v("B14001", 8)] + acs[v("B14001", 9)]
    out["enr_tot"] = acs[v("B14001", 1)]
    # College enrollment by age (both sexes): enrolled and everyone, per B14004 age group, so the radius tool applies each
    # age group's own enrollment rate (about 4 in 10 at 18-24, far fewer at 35+) instead of one rate for all ages
    for b, k in ENR_AGES.items():
        out[f"enr_{b}"] = sum(acs[v("B14004", ENR_BLOCKS[t] + 1 + k + off)] for t in ("public", "private") for off in (0, 16))
        out[f"ent_{b}"] = out[f"enr_{b}"] + sum(acs[v("B14004", ENR_BLOCKS["not"] + 1 + k + off)] for off in (0, 16))
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
    out["pop16"], out["nilf"] = acs[v("B23025", 1)], acs[v("B23025", 7)]
    for b, lines in TEN_BRACKETS.items():                                  # owner and renter householders by age
        out[f"o{b}"] = sum(acs[v("B25007", n)] for n in lines)
        out[f"r{b}"] = sum(acs[v("B25007", n + 10)] for n in lines)
    for b, lines in VAL_BANDS.items():
        out[f"val_{b}"] = sum(acs[v("B25075", n)] for n in lines)
    # Healthcare radius tool: people by sex and age bracket, and insurance, hearing, vision and living alone by age bracket
    for sex, off in (("m", 0), ("f", 24)):
        for b, lines in HC_AGES.items():
            out[f"{sex}h{b}"] = sum(acs[v("B01001", n + off)] for n in lines)
    for b, groups in DIS_BRACKETS.items():
        out[f"civ_{b}"] = sum(acs[v("B18102", DIS_GROUPS[g] + off)] for g in groups for off in (0, 19))
        out[f"hear_{b}"] = sum(acs[v("B18102", DIS_GROUPS[g] + off + 1)] for g in groups for off in (0, 19))
        out[f"vis_{b}"] = sum(acs[v("B18103", DIS_GROUPS[g] + off + 1)] for g in groups for off in (0, 19))
    for b, groups in INS_BRACKETS.items():
        out[f"inst_{b}"] = sum(acs[v("B27001", INS_GROUPS[g] + off)] for g in groups for off in (0, 28))
        out[f"unins_{b}"] = sum(acs[v("B27001", INS_GROUPS[g] + off + 2)] for g in groups for off in (0, 28))
    for b, line in LIV_GROUPS.items():
        out[f"liv_{b}"], out[f"alone_{b}"] = acs[v("B09021", line)], acs[v("B09021", line + 1)]
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
    # Home Services analyzer
    out["hb_tot"] = acs[v("B25036", 2)]                                     # owner homes (year built table)
    for b, lines in BUILT.items(): out[f"hb_{b}"] = sum(acs[v("B25036", n)] for n in lines)
    out["hu_tot"], out["sfd_own"] = acs[v("B25032", 2)], acs[v("B25032", 3)]   # owner homes; single-family detached
    out["hm_tot"] = acs[v("B25038", 2)]                                     # owner homes (year moved in table)
    out["lt_own"] = sum(acs[v("B25038", n)] for n in MOVED_PRE2010)         # owners in the home since before 2010
    # Furniture: households that moved in 2020 or later. In the 2020-2024 ACS the newest brackets are "2023 or later"
    # (line 3 owners, 10 renters) and "2020 to 2022" (line 4 owners, 11 renters).
    out["o_moved20"] = acs[v("B25038", 3)] + acs[v("B25038", 4)]
    out["r_moved20"] = acs[v("B25038", 10)] + acs[v("B25038", 11)]
    # Apartment analyzer: renter households and their traits
    out["r_tot"] = acs[v("B25032", 13)]                                       # renter households (units in structure table)
    out["r_sfd"] = acs[v("B25032", 14)]                                       # renting a single-family detached house
    out["r_5p"] = sum(acs[v("B25032", n)] for n in (18, 19, 20, 21))          # renting in a building with 5+ units
    out["r_20p"] = acs[v("B25032", 20)] + acs[v("B25032", 21)]                # renting in a building with 20+ units
    out["r_mtot"], out["r_moved21"] = acs[v("B25038", 9)], acs[v("B25038", 10)]   # renters in the newest move-in group (not shown on any page)
    out["rinc_tot"] = acs[v("B25118", 14)]
    for b, lines in RINC.items(): out[f"rinc_{b}"] = sum(acs[v("B25118", n)] for n in lines)
    out["rb_base"] = acs[v("B25070", 1)] - acs[v("B25070", 11)]              # renters whose burden can be computed
    out["rb_30p"] = sum(acs[v("B25070", n)] for n in BURDEN30)               # paying 30%+ of income in rent
    out["vac_rent"], out["vac_rented"] = acs[v("B25004", 2)], acs[v("B25004", 3)]   # vacant for rent; rented, not yet occupied
    out["rk_tot"], out["r_kids"] = acs[v("B25115", 15)], sum(acs[v("B25115", n)] for n in RENT_KIDS)

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

    # College enrollment by age (B14004): every block adds up, and its enrolled total agrees with B14001 (catches wrong lines)
    bad = 0
    for off in (0, 16):
        for t, start in ENR_BLOCKS.items():
            bad += int(((sum(acs[v("B14004", start + off + 1 + k)] for k in range(4)) - acs[v("B14004", start + off)]).abs() > 1).sum())
        bad += int(((sum(acs[v("B14004", start + off)] for start in ENR_BLOCKS.values()) - acs[v("B14004", 2 + off)]).abs() > 1).sum())
    bad += int(((acs[v("B14004", 2)] + acs[v("B14004", 18)] - acs[v("B14004", 1)]).abs() > 1).sum())
    rep.append(("College enrollment by age adds up (B14004)", "PASS" if bad == 0 else "FAIL", f"{bad} ZIP-blocks off"))
    e_age, e_all = sum(out[f"enr_{b}"].sum() for b in ENR_AGES), out.enr_college.sum()
    rep.append(("College enrollment: by-age total vs. B14001", "PASS" if abs(e_age / e_all - 1) < 0.03 else "FAIL", f"{e_age:,.0f} vs {e_all:,.0f}"))
    r1824 = out.enr_18_24.sum() / out.ent_18_24.sum() * 100
    rep.append(("Published benchmark: college enrollment rate, ages 18-24", "PASS" if 30 < r1824 < 50 else "FAIL", f"{r1824:.1f}% (expected 30–50)"))

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

    # Legal and Healthcare radius tables: parts add up (catches wrong line numbers, since the file server has no labels)
    def add_up(name, table, total, parts, tol=1):
        diff = sum(acs[v(table, k)] for k in parts) - acs[v(table, total)]
        return int((diff.abs() > tol).sum())
    def rep_add(name, n, unit="ZIPs off"): rep.append((name, "PASS" if n == 0 else "FAIL", f"{n} {unit}"))
    rep_add("Employment: labor force + not in labor force = population 16+", add_up("", "B23025", 1, (2, 7)))
    rep_add("Employment: civilian employed + unemployed + armed forces = labor force", add_up("", "B23025", 2, (4, 5, 6)))
    rep_add("Renter ages add up", add_up("", "B25007", 12, range(13, 22)))
    rep_add("Owners + renters = occupied homes (by age of householder)", add_up("", "B25007", 1, (2, 12)))
    # Home Services tables: every owner and renter group adds up, and all three agree on the number of owner homes
    rep_add("Year built: owner years add up", add_up("", "B25036", 2, range(3, 13)))
    rep_add("Year built: renter years add up", add_up("", "B25036", 13, range(14, 24)))
    rep_add("Year built: owners + renters = occupied homes", add_up("", "B25036", 1, (2, 13)))
    rep_add("Units in structure: owner types add up", add_up("", "B25032", 2, range(3, 13)))
    rep_add("Units in structure: renter types add up", add_up("", "B25032", 13, range(14, 24)))
    rep_add("Year moved in: owner years add up", add_up("", "B25038", 2, range(3, 9)))
    rep_add("Year moved in: renter years add up", add_up("", "B25038", 9, range(10, 16)))
    rep_add("Renter income: bands add up to renters", add_up("", "B25118", 14, range(15, 26)))
    rep_add("Owner income: bands add up to owners", add_up("", "B25118", 2, range(3, 14)))
    rep_add("Rent burden: bands add up", add_up("", "B25070", 1, range(2, 12)))
    rep_add("Household type: owners + renters = occupied homes", add_up("", "B25115", 1, (2, 15)))
    for t, line in (("B25118", 14), ("B25070", 1), ("B25115", 15), ("B25032", 13), ("B25038", 9)):
        n = int(((acs[v(t, line)] - acs[v("B25007", 12)]).abs() > 1).sum())
        rep_add(f"{t} renter households agree with B25007", n)
    for t in ("B25036", "B25032", "B25038"):
        n = int(((acs[v(t, 2)] - acs[v("B25007", 2)]).abs() > 1).sum())
        rep_add(f"{t} owner homes agree with B25007", n)
    n = int(((sum(out[f"{s}h{b}"] for s in "mf" for b in HC_AGES) - out.acs_pop).abs() > 1).sum())
    rep_add("Healthcare age brackets add up to population", n)
    for table, word in (("B18102", "Hearing"), ("B18103", "Vision")):
        bad = 0
        for base in (2, 21):
            bad += add_up("", table, base, [base + DIS_GROUPS[g] - 2 for g in DIS_GROUPS])
            for g in DIS_GROUPS:
                gl = base + DIS_GROUPS[g] - 2
                bad += add_up("", table, gl, (gl + 1, gl + 2))
        bad += add_up("", table, 1, (2, 21))
        rep_add(f"{word} difficulty by age: every group adds up", bad, "ZIP-groups off")
    n = int(((acs[v("B18102", 1)] - acs[v("B18103", 1)]).abs() > 1).sum())
    rep_add("Hearing and vision tables cover the same people", n)
    bad = add_up("", "B27001", 1, (2, 30))
    for base in (2, 30):
        bad += add_up("", "B27001", base, [base + INS_GROUPS[g] - 2 for g in INS_GROUPS])
        for g in INS_GROUPS:
            gl = base + INS_GROUPS[g] - 2
            bad += add_up("", "B27001", gl, (gl + 1, gl + 2))
    rep_add("Health insurance by age: every group adds up", bad, "ZIP-groups off")
    bad = add_up("", "B09021", 1, LIV_GROUPS.values()) + add_up("", "B09021", 1, range(2, 8))
    for line in LIV_GROUPS.values(): bad += add_up("", "B09021", line, range(line + 1, line + 7))
    rep_add("Living arrangements by age: every group adds up", bad, "ZIP-groups off")
    for part, total, name in (("nilf", "pop16", "Not in labor force"),) + tuple(
            (f"{t}_{b}", f"civ_{b}", f"{w} difficulty, {AGE_TEXT[b]}") for t, w in (("hear", "Hearing"), ("vis", "Vision")) for b in DIS_BRACKETS) + tuple(
            (f"unins_{b}", f"inst_{b}", f"Uninsured, {AGE_TEXT[b]}") for b in INS_BRACKETS) + tuple(
            (f"alone_{b}", f"liv_{b}", f"Living alone, {AGE_TEXT[b]}") for b in LIV_GROUPS):
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
             ("18-34 without a college degree", tot("nodeg18_34") / max(tot("pop18_34"), 1) * 100, 45, 72, "{:.1f}%"),
             # Healthcare radius: uninsured ~8-9%, under 2% at 65+; hearing difficulty ~3.5-4%, 13-16% at 75+; vision ~2.5%;
             # adults 65+ living alone ~25-29%; renters ~35%; homes $750K+ ~10-14%
             ("uninsured share, all ages", sum(tot(f"unins_{b}") for b in INS_BRACKETS) / max(sum(tot(f"inst_{b}") for b in INS_BRACKETS), 1) * 100, 5.5, 12, "{:.1f}%"),
             ("uninsured share, 65-74", tot("unins_65_74") / max(tot("inst_65_74"), 1) * 100, 0.2, 3, "{:.1f}%"),
             ("hearing difficulty, all ages", sum(tot(f"hear_{b}") for b in DIS_BRACKETS) / max(sum(tot(f"civ_{b}") for b in DIS_BRACKETS), 1) * 100, 2.5, 5, "{:.1f}%"),
             ("hearing difficulty, 75+", tot("hear_75p") / max(tot("civ_75p"), 1) * 100, 9, 22, "{:.1f}%"),
             ("vision difficulty, all ages", sum(tot(f"vis_{b}") for b in DIS_BRACKETS) / max(sum(tot(f"civ_{b}") for b in DIS_BRACKETS), 1) * 100, 1.5, 3.8, "{:.1f}%"),
             ("adults 65+ living alone", tot("alone_65p") / max(tot("liv_65p"), 1) * 100, 20, 34, "{:.1f}%"),
             ("renter share of households", sum(tot(f"r{b}") for b in TEN_BRACKETS) / max(tot("hhed_tot"), 1) * 100, 28, 42, "{:.1f}%"),
             ("homes worth $750K+", tot("val_750p") / max(tot("val_tot"), 1) * 100, 5, 20, "{:.1f}%"),
             # Home Services: about half of owner homes were built before 1980 (median year built is about 1980), about 82% are single-family detached,
             # and about 45% of owners moved in before 2010
             ("owner homes built before 1980", tot("hb_pre1980") / max(tot("hb_tot"), 1) * 100, 35, 56, "{:.1f}%"),
             ("owner homes that are single-family detached", tot("sfd_own") / max(tot("hu_tot"), 1) * 100, 74, 90, "{:.1f}%"),
             ("owners in the home since before 2010", tot("lt_own") / max(tot("hm_tot"), 1) * 100, 30, 60, "{:.1f}%"),
             # Apartment: about half of renters pay 30%+ of income in rent; about 40-45% rent in 5+ unit buildings; about a third of
             # renter households have children; national rental vacancy about 5-7%; renters $100K+ about 15-20%
             ("renters paying 30%+ of income in rent", tot("rb_30p") / max(tot("rb_base"), 1) * 100, 42, 58, "{:.1f}%"),
             ("renters in buildings with 5+ units", tot("r_5p") / max(tot("r_tot"), 1) * 100, 35, 52, "{:.1f}%"),
             ("renter households with children", tot("r_kids") / max(tot("rk_tot"), 1) * 100, 22, 40, "{:.1f}%"),
             ("rental vacancy rate", tot("vac_rent") / max(tot("vac_rent") + tot("vac_rented") + tot("r_tot"), 1) * 100, 3.5, 9, "{:.1f}%"),
             ("renters earning $100K+", (tot("rinc_100_150") + tot("rinc_150p")) / max(tot("rinc_tot"), 1) * 100, 10, 26, "{:.1f}%")]
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
    # Columns only one site's radius tool uses go in their own file, so every page doesn't load them
    extra = {"zip_audience_health.json": [f"{s}h{b}" for s in "mf" for b in HC_AGES] + [f"{t}_{b}" for t in ("civ", "hear", "vis") for b in DIS_BRACKETS] +
                                         [f"{t}_{b}" for t in ("inst", "unins") for b in INS_BRACKETS] + [f"{t}_{b}" for t in ("liv", "alone") for b in LIV_GROUPS],
             "zip_audience_legal.json": ["pop16", "nilf"] + [f"{t}{b}" for t in "or" for b in TEN_BRACKETS] + [f"val_{b}" for b in VAL_BANDS],
             "zip_audience_apt.json": ["r_tot", "r_sfd", "r_5p", "r_20p", "r_mtot", "r_moved21", "r_moved20", "rinc_tot"] + [f"rinc_{b}" for b in RINC] +
                                      ["rb_base", "rb_30p", "vac_rent", "vac_rented", "rk_tot", "r_kids"],
             "zip_audience_enroll.json": [f"{t}_{b}" for t in ("enr", "ent") for b in ENR_AGES],
             "zip_audience_inc.json": ["inc_100_125", "inc_125_150", "m55_64", "m65p", "f55_64", "f65p", "occ_tot", "mgmt"],
             "zip_audience_home.json": ["hb_tot"] + [f"hb_{b}" for b in BUILT] + ["hu_tot", "sfd_own", "hm_tot", "lt_own", "o_moved20"]}
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
    for name, ecols in extra.items():
        ec = {"zip": cols["zip"]}
        for c in ecols: ec[c] = [None if pd.isna(x) else int(round(x)) for x in m[c]]
        json.dump({"meta": {"built": meta["built"], "acsYears": meta["acsYears"]}, "cols": ec},
                  open(os.path.join(OUT, name), "w"), separators=(",", ":"))
        print("Wrote", os.path.join(OUT, name))


if __name__ == "__main__":
    main()
