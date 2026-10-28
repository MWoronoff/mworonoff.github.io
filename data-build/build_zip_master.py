"""Builds the master ZIP dataset in data-build/master/ for the CRM analyzer and the other tools.

One file per source, each keyed by 5-digit ZIP, plus an index, a field dictionary and a check report:

  zip_index.csv.gz      every Deluxe ZIP: place, county, metro, DMA, coordinates, and which sources cover it
  zip_deluxe.csv.gz     Deluxe ZIP database (licensed vendor file, data-build/sources/deluxe/)
  zip_acs.csv.gz        Census ACS 5-year detailed tables by ZCTA (full tables, every line)
  zip_irs.csv.gz        IRS Statistics of Income, individual returns by ZIP (totals and income-size bands)
  zip_cbp.csv.gz        Census ZIP Code Business Patterns: totals and establishments by industry sector
  cbp_zip_naics.csv.gz  the same, establishments by detailed (6-digit) industry, one row per ZIP and industry
  zip_lodes.csv.gz      Census LEHD LODES: jobs located in the ZIP (workplace) and workers living there (residence)
  zip_ruca.csv.gz       USDA rural-urban commuting area codes for ZIPs
  zip_places.csv.gz     CDC PLACES model-based health estimates by ZCTA
  zip_fhfa.csv.gz       FHFA house price index for 5-digit ZIPs (annual appreciation)
  field_dictionary.csv  every column: file, source, release, label, universe notes
  master_report.md      what was built, from which release, coverage and checks

Every public source is found automatically (newest release first), so a re-run picks up new releases with no edits.
A source that can't be reached keeps its previous file and is marked in the report; the others still build.

  python3 data-build/build_zip_master.py               # all sources (GitHub Actions)
  python3 data-build/build_zip_master.py --only deluxe # one or more sources, comma-separated
"""
import argparse, datetime, glob, gzip, hashlib, io, json, os, re, sys, time, urllib.error, urllib.request, zipfile
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "master")
DELUXE_DIR = os.path.join(HERE, "sources", "deluxe")
GEO = os.path.join(HERE, "geo", "zip_geo.csv")
UA = {"User-Agent": "Mozilla/5.0 (Adtaxi analyzer data build; github.com/MWoronoff)"}
THIS_YEAR = datetime.date.today().year
DICT = []          # field dictionary rows
REPORT = {}        # source -> dict of report facts


def log(*a):
    print(*a, flush=True)


def get(url, timeout=600, tries=4, method="GET"):
    req = urllib.request.Request(url, headers=UA, method=method)
    for i in range(tries):
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code in (400, 403, 404, 410) or i == tries - 1:
                raise
        except Exception:
            if i == tries - 1:
                raise
        time.sleep(8 * (i + 1))


def exists(url):
    try:
        get(url, timeout=60, tries=2, method="HEAD")
        return True
    except Exception:
        try:   # some servers refuse HEAD; a ranged GET is just as cheap
            req = urllib.request.Request(url, headers={**UA, "Range": "bytes=0-0"})
            urllib.request.urlopen(req, timeout=60)
            return True
        except Exception:
            return False


def fetch_bytes(url, timeout=900):
    return get(url, timeout=timeout).read()


def z5(s):
    return s.astype(str).str.strip().str.replace(r"\.0$", "", regex=True).str.zfill(5)


def add_dict(file, cols, source, release, labels=None, notes=""):
    labels = labels or {}
    for c in cols:
        DICT.append({"file": file, "column": c, "source": source, "release": release,
                     "label": labels.get(c, ""), "notes": notes})


def save(df, name):
    path = os.path.join(OUT, name)
    df.to_csv(path, index=False, compression={"method": "gzip", "mtime": 0})
    log(f"  wrote {name}: {len(df):,} rows x {df.shape[1]} columns, {os.path.getsize(path) / 1e6:.1f} MB")


# ----------------------------------------------------------------------------------------------------------------
# Deluxe (licensed vendor file; replace the workbooks in data-build/sources/deluxe/ to refresh)
# ----------------------------------------------------------------------------------------------------------------
def build_deluxe():
    files = sorted(glob.glob(os.path.join(DELUXE_DIR, "*.xlsx")))
    if not files:
        raise RuntimeError("no Deluxe workbooks in data-build/sources/deluxe/")
    frames, sheets = [], set()
    for f in files:
        x = pd.ExcelFile(f, engine="openpyxl")
        sheets.update(x.sheet_names)
        d = x.parse(x.sheet_names[0], dtype={"ZipCode": str, "ZIP5": str})
        log(f"  {os.path.basename(f)}: {len(d):,} rows")
        frames.append(d)
    d = pd.concat(frames, ignore_index=True)
    d["ZipCode"] = z5(d["ZipCode"])
    if "PrimaryRecord" in d:
        d = d[d["PrimaryRecord"].astype(str).str.upper().eq("P")]
    dup = int(d["ZipCode"].duplicated().sum())
    d = d.drop_duplicates("ZipCode").drop(columns=[c for c in ("ZIP5",) if c in d])
    m = re.search(r"(\d{8})", " ".join(sheets))
    release = f"{m.group(1)[:2]}/{m.group(1)[2:4]}/{m.group(1)[4:]}" if m else "unknown"
    ren = {c: "dlx_" + re.sub(r"[^0-9a-z]+", "_", c.lower()).strip("_") for c in d.columns if c != "ZipCode"}
    labels = {v: k for k, v in ren.items()}
    d = d.rename(columns=ren).rename(columns={"ZipCode": "zip"})
    pop = pd.to_numeric(d["dlx_population"], errors="coerce").fillna(0)
    res = d[pop > 0]
    REPORT["deluxe"] = {"release": f"Deluxe ZIP database, update dated {release}", "rows": len(d),
                        "residential": len(res), "pop": int(pop.sum()), "dups_dropped": dup, "files": len(files)}
    cols = [c for c in d.columns if c != "zip"]
    add_dict("zip_deluxe.csv.gz", cols, "Deluxe ZIP database (licensed)", release, labels,
             "Demographic counts are Census ACS 5-year figures as repackaged by Deluxe. dlx_populationestimate "
             "is a vendor projection, not a Census count; keep it out of share and index calculations.")
    save(d, "zip_deluxe.csv.gz")
    return d


# ----------------------------------------------------------------------------------------------------------------
# Census ACS 5-year, full detailed tables by ZCTA, from the Census file server (no key needed)
# ----------------------------------------------------------------------------------------------------------------
ACS_TABLES = {
    "B01001": "Sex by age", "B01002": "Median age by sex", "B03002": "Hispanic or Latino origin by race",
    "B07003": "Geographic mobility in the past year (moved in the last year)", "B08301": "Means of transportation to work",
    "B08303": "Travel time to work", "B09001": "Population under 18 by age (children's ages)",
    "B11001": "Household type", "B11005": "Households with people under 18", "B11016": "Household type by household size",
    "B12001": "Sex by marital status", "B15003": "Educational attainment, 25+", "B17017": "Poverty status of households",
    "B18101": "Sex by age by disability status", "B19001": "Household income", "B19013": "Median household income",
    "B19037": "Age of householder by household income", "B19055": "Social Security income in households",
    "B19057": "Public assistance income in households", "B19059": "Retirement income in households",
    "B21001": "Veteran status, civilian 18+", "B22003": "Households receiving SNAP (food stamps)",
    "B23025": "Employment status, 16+", "B25003": "Tenure (own or rent)", "B25004": "Vacancy status",
    "B25007": "Tenure by age of householder", "B25024": "Units in structure", "B25034": "Year structure built",
    "B25038": "Tenure by year householder moved in", "B25044": "Tenure by vehicles available",
    "B25064": "Median gross rent", "B25070": "Gross rent as a percentage of household income",
    "B25075": "Value of owner-occupied homes", "B25077": "Median home value", "B25081": "Mortgage status",
    "B27010": "Health insurance coverage by age", "B28001": "Computers in the household",
    "B28002": "Internet subscriptions in the household", "C16002": "Household language and limited English",
    "C24010": "Occupation by sex, employed 16+", "C24030": "Industry by sex, employed 16+",
}
ACS_BULK = "https://www2.census.gov/programs-surveys/acs/summary_file/{y}/table-based-SF/data/5YRData/acsdt5y{y}-{t}.dat"
ACS_SHELLS = ["https://www2.census.gov/programs-surveys/acs/summary_file/{y}/table-based-SF/documentation/ACS{y}5YR_Table_Shells.txt",
              "https://www2.census.gov/programs-surveys/acs/summary_file/{y}/table-based-SF/documentation/ACS{y}5YR_Table_Shells.xlsx"]


def acs_year():
    for y in range(THIS_YEAR - 1, THIS_YEAR - 5, -1):
        if exists(ACS_BULK.format(y=y, t="b01001")):
            return y
    raise RuntimeError("no ACS 5-year release found on the Census file server")


def acs_labels(y):
    for u in ACS_SHELLS:
        url = u.format(y=y)
        try:
            raw = fetch_bytes(url, timeout=300)
        except Exception as e:
            log(f"  table shells not at {url}: {e}")
            continue
        if url.endswith(".xlsx"):
            sh = pd.read_excel(io.BytesIO(raw), dtype=str)
        else:
            sh = pd.read_csv(io.BytesIO(raw), sep="|", dtype=str, encoding="latin-1")
        sh.columns = [c.strip().lower() for c in sh.columns]
        idc = next((c for c in sh.columns if "unique" in c and "id" in c), None)
        lab = next((c for c in sh.columns if c in ("label", "stub")), None)
        if idc and lab:
            out = {}
            for i, l in zip(sh[idc], sh[lab]):
                if isinstance(i, str) and "_" in i:
                    t, n = i.split("_")
                    out[f"{t}_E{int(n):03d}"] = str(l).replace("!!", " > ").strip()
            log(f"  {len(out):,} ACS line labels from the table shells")
            return out
    return {}


ACS_API = "https://api.census.gov/data/{y}/acs/acs5?get=group({t})&for=zip%20code%20tabulation%20area:{z}"


def acs_fill_missing(merged, y):
    """ZCTAs with residents (per Deluxe) that the bulk summary file left out (Brentwood 11717 and Wyandanch 11798 in
    the 2020-2024 release), filled from the Census API one table at a time. Any that still fail stay missing."""
    REPORT.setdefault("acs_api", {"tried": [], "filled": []})
    try:
        dlx = pd.read_csv(os.path.join(OUT, FILES["deluxe"]), dtype={"zip": str}, usecols=["zip", "dlx_population"])
    except Exception as e:
        log(f"  ACS gap check skipped (no Deluxe file: {e})")
        return merged
    have = set(merged["zip"])
    # Puerto Rico and the territories (006-009, 96x) aren't in the ACS ZCTA file at all (Puerto Rico has its own survey)
    terr = lambda z: z[:3] in ("006", "007", "008", "009") or z[:2] == "96"
    miss = sorted(z for z, p in zip(z5(dlx["zip"]), pd.to_numeric(dlx["dlx_population"], errors="coerce").fillna(0))
                  if p >= 1000 and z not in have and not terr(z))[:300]
    REPORT["acs_api"]["tried"] = miss
    if not miss:
        return merged
    log(f"  {len(miss)} populated ZIPs missing from the bulk file; trying the Census API: {', '.join(miss[:20])}{'…' if len(miss) > 20 else ''}")
    parts, errs, used = [], [], None
    for yy in (y, y - 1):                           # this release, then the one before if this one has nothing for them
        for t in ACS_TABLES:
            frames = []
            for k in range(0, len(miss), 50):
                url = ACS_API.format(y=yy, t=t, z=",".join(miss[k:k + 50]))
                try:
                    resp = get(url, timeout=120, tries=3)
                    body = resp.read().decode("utf-8")
                    if not body.strip():
                        errs.append(f"{yy} {t}: empty response (HTTP {getattr(resp, 'status', '?')})"); continue
                    try: rows = json.loads(body)
                    except ValueError: errs.append(f"{yy} {t}: not data: {body.strip()[:90]!r}"); continue
                except Exception as e:
                    errs.append(f"{yy} {t}: {type(e).__name__}: {str(e)[:100]}"); continue
                if not rows or len(rows) < 2:
                    continue
                hdr = rows[0]
                zc = hdr.index("zip code tabulation area")
                cols = {i: f"{t}_E{int(m.group(1)):03d}" for i, h in enumerate(hdr) for m in [re.fullmatch(rf"{t}_(\d+)E", h)] if m}
                frames.append(pd.DataFrame([[r[zc]] + [r[i] for i in cols] for r in rows[1:]], columns=["zip"] + list(cols.values())))
            if frames:
                d = pd.concat(frames, ignore_index=True).drop_duplicates("zip")
                for c in d.columns[1:]:
                    d[c] = pd.to_numeric(d[c], errors="coerce")
                parts.append(d.set_index("zip"))
        if parts:
            used = yy; break
    REPORT["acs_api"]["year"] = used
    REPORT["acs_api"]["errors"] = errs[:5]
    msg = (f"Census API fill: {len(miss)} ZIPs tried; " + (f"data from ACS 5-year {used - 4}–{used}" if used else "no data returned") +
           (f"; first errors: {' | '.join(errs[:3])}" if errs else ""))
    if not parts:                                    # API unavailable: the prior release's bulk file, same server as above
        need = set(miss)
        for yy in (y - 1,):
            for t in ACS_TABLES:
                try:
                    resp = get(ACS_BULK.format(y=yy, t=t.lower()), timeout=900)
                    it = (b.decode("utf-8", "replace") for b in resp)
                    hdr = next(it).rstrip("\r\n").split("|")
                    gi = hdr.index("GEO_ID")
                    keep = [i for i, h in enumerate(hdr) if re.fullmatch(rf"{t}_E\d+", h)]
                    rows = []
                    for line in it:
                        if line.startswith("860Z200US") and line[9:14] in need:
                            f = line.rstrip("\r\n").split("|")
                            rows.append([f[gi][9:]] + [f[k] for k in keep])
                except Exception as e:
                    errs.append(f"bulk {yy} {t}: {type(e).__name__}: {str(e)[:80]}"); continue
                if rows:
                    d = pd.DataFrame(rows, columns=["zip"] + [hdr[k] for k in keep])
                    for c in d.columns[1:]:
                        d[c] = pd.to_numeric(d[c], errors="coerce")
                    parts.append(d.set_index("zip"))
            if parts:
                used = yy; break
        REPORT["acs_api"]["year"] = used
        msg += "; bulk file fallback: " + (f"ACS 5-year {used - 4}–{used}" if used else "no data")
    log("  " + msg)
    print(f"::notice title=ACS gap fill::{msg}")
    if not parts:
        return merged
    add = pd.concat(parts, axis=1).reset_index()
    add = add[[c for c in add.columns if c == "zip" or c in merged.columns]]
    add = add[add.drop(columns="zip").notna().any(axis=1)]
    REPORT["acs_api"]["filled"] = sorted(add["zip"])
    log(f"  filled: {', '.join(sorted(add['zip'])) or 'none'}")
    return pd.concat([merged, add], ignore_index=True)


def build_acs():
    y = acs_year()
    log(f"  ACS 5-year {y - 4}-{y}")
    merged = None
    for t in ACS_TABLES:
        url = ACS_BULK.format(y=y, t=t.lower())
        resp = get(url, timeout=900)
        it = (b.decode("utf-8", "replace") for b in resp)
        hdr = next(it).rstrip("\r\n").split("|")
        gi = hdr.index("GEO_ID")
        keep = [i for i, h in enumerate(hdr) if re.fullmatch(rf"{t}_E\d+", h)]
        rows = []
        for line in it:
            if line.startswith("860Z200US"):
                f = line.rstrip("\r\n").split("|")
                rows.append([f[gi][9:]] + [f[k] for k in keep])
        d = pd.DataFrame(rows, columns=["zip"] + [hdr[k] for k in keep])
        for c in d.columns[1:]:
            d[c] = pd.to_numeric(d[c], errors="coerce")
        log(f"  {t}: {len(d):,} ZCTAs x {len(keep)} lines")
        merged = d if merged is None else merged.merge(d, on="zip", how="outer")
    merged = acs_fill_missing(merged, y)
    # Census marks medians it can't compute with negative codes (-666666666 etc.); blank them
    for c in merged.columns[1:]:
        merged.loc[merged[c] < -1, c] = pd.NA
    # checks: age lines add up to the total, income bands add up to households
    f = [c for c in merged if re.fullmatch(r"B01001_E0(0[3-9]|1\d|2[0-5])", c)] + \
        [c for c in merged if re.fullmatch(r"B01001_E0(2[7-9]|[34]\d)", c)]
    age_bad = int((merged[f].sum(axis=1) != merged["B01001_E001"]).sum())
    inc_bad = int((merged[[f"B19001_E{n:03d}" for n in range(2, 18)]].sum(axis=1) != merged["B19001_E001"]).sum())
    labels = acs_labels(y)
    lab = {c: f"{ACS_TABLES[c.split('_')[0]]}: {labels.get(c, 'line ' + str(int(c.split('_E')[1])))}"
           for c in merged.columns[1:]}
    REPORT["acs"] = {"release": f"ACS 5-year {y - 4}–{y}", "rows": len(merged), "tables": len(ACS_TABLES),
                     "columns": merged.shape[1] - 1, "age_bad": age_bad, "inc_bad": inc_bad,
                     "labels": "table shells" if labels else "line numbers only (table shells not found)"}
    add_dict("zip_acs.csv.gz", list(merged.columns[1:]), "U.S. Census Bureau, American Community Survey",
             f"5-year {y - 4}–{y}", lab, "ZCTA geography, estimates only (margins of error not included).")
    save(merged, "zip_acs.csv.gz")
    return merged


# ----------------------------------------------------------------------------------------------------------------
# IRS Statistics of Income, individual income tax ZIP Code data
# ----------------------------------------------------------------------------------------------------------------
IRS_STUBS = {1: "$1 to under $25,000", 2: "$25,000 to under $50,000", 3: "$50,000 to under $75,000",
             4: "$75,000 to under $100,000", 5: "$100,000 to under $200,000", 6: "$200,000 or more"}
IRS_NAMES = {"N1": "Number of returns (approximates households)", "N2": "Number of individuals (approximates population)",
             "A00100": "Adjusted gross income ($000)", "N00200": "Returns with salaries and wages",
             "A00200": "Salaries and wages ($000)", "N00300": "Returns with taxable interest", "A00300": "Taxable interest ($000)",
             "N00600": "Returns with ordinary dividends", "A00600": "Ordinary dividends ($000)",
             "N00900": "Returns with business or professional net income", "A00900": "Business or professional net income ($000)",
             "N01000": "Returns with net capital gain", "A01000": "Net capital gain ($000)",
             "N01700": "Returns with taxable pensions and annuities", "A01700": "Taxable pensions and annuities ($000)",
             "N02500": "Returns with taxable Social Security benefits", "A02500": "Taxable Social Security benefits ($000)",
             "N18500": "Returns with real estate taxes", "A18500": "Real estate taxes ($000)",
             "N19300": "Returns with mortgage interest paid", "A19300": "Mortgage interest paid ($000)",
             "N59660": "Returns with earned income credit", "A59660": "Earned income credit ($000)",
             "NUMDEP": "Number of dependents", "ELDERLY": "Number of elderly returns", "MARS1": "Single returns",
             "MARS2": "Joint returns", "MARS4": "Head of household returns", "PREP": "Returns with paid preparer",
             "N04470": "Returns with itemized deductions", "N02650": "Returns with total income", "A02650": "Total income ($000)"}


def build_irs():
    for y in range(THIS_YEAR - 1, THIS_YEAR - 7, -1):
        url = f"https://www.irs.gov/pub/irs-soi/{str(y)[2:]}zpallagi.csv"
        if exists(url):
            break
    else:
        raise RuntimeError("no IRS ZIP Code file found")
    log(f"  IRS tax year {y}")
    d = pd.read_csv(io.BytesIO(fetch_bytes(url)), dtype={"zipcode": str}, low_memory=False)
    d.columns = [c.strip() for c in d.columns]
    zc = next(c for c in d.columns if c.lower() == "zipcode")
    d["zip"] = z5(d[zc])
    d = d[~d["zip"].isin(["00000", "99999"])]
    stub = next(c for c in d.columns if c.lower() == "agi_stub")
    num = [c for c in d.columns if c not in ("zip", zc, stub, "STATEFIPS", "STATE") and pd.api.types.is_numeric_dtype(d[c])]
    tot = d.groupby("zip")[num].sum()
    tot.columns = [f"irs_{c.lower()}" for c in tot.columns]
    by = d.pivot_table(index="zip", columns=stub, values=["N1", "A00100"], aggfunc="sum")
    by.columns = [f"irs_{v.lower()}_stub{int(s)}" for v, s in by.columns]
    out = tot.join(by).reset_index()
    labels = {f"irs_{k.lower()}": v for k, v in IRS_NAMES.items()}
    for s, t in IRS_STUBS.items():
        labels[f"irs_n1_stub{s}"] = f"Number of returns, AGI {t}"
        labels[f"irs_a00100_stub{s}"] = f"Adjusted gross income ($000), AGI {t}"
    REPORT["irs"] = {"release": f"tax year {y}", "rows": len(out), "columns": out.shape[1] - 1,
                     "returns": int(out["irs_n1"].sum())}
    add_dict("zip_irs.csv.gz", list(out.columns[1:]), "Internal Revenue Service, Statistics of Income", f"tax year {y}",
             labels, "Keyed by the ZIP on the return. Columns without a label follow the IRS record layout "
                     "(N = number of returns, A = amount in $000). ZIPs with very few returns are not published.")
    save(out, "zip_irs.csv.gz")
    return out


# ----------------------------------------------------------------------------------------------------------------
# Census ZIP Code Business Patterns
# ----------------------------------------------------------------------------------------------------------------
SECTORS = {"11": "Agriculture, forestry, fishing", "21": "Mining, oil and gas", "22": "Utilities", "23": "Construction",
           "31": "Manufacturing", "42": "Wholesale trade", "44": "Retail trade", "48": "Transportation and warehousing",
           "51": "Information", "52": "Finance and insurance", "53": "Real estate, rental and leasing",
           "54": "Professional, scientific and technical services", "55": "Management of companies",
           "56": "Administrative, support and waste services", "61": "Educational services",
           "62": "Health care and social assistance", "71": "Arts, entertainment and recreation",
           "72": "Accommodation and food services", "81": "Other services (repair, personal care, etc.)",
           "99": "Industries not classified"}


def read_zip_csv(url):
    zf = zipfile.ZipFile(io.BytesIO(fetch_bytes(url)))
    name = next(n for n in zf.namelist() if n.lower().endswith((".txt", ".csv")))
    d = pd.read_csv(zf.open(name), dtype=str, encoding="latin-1")
    d.columns = [c.strip().lower() for c in d.columns]
    return d


def build_cbp():
    base = "https://www2.census.gov/programs-surveys/cbp/datasets/{y}/zbp{yy}{kind}.zip"
    for y in range(THIS_YEAR - 1, THIS_YEAR - 6, -1):
        if exists(base.format(y=y, yy=str(y)[2:], kind="totals")):
            break
    else:
        raise RuntimeError("no ZIP Code Business Patterns release found")
    log(f"  ZIP Code Business Patterns {y}")
    t = read_zip_csv(base.format(y=y, yy=str(y)[2:], kind="totals"))
    t["zip"] = z5(t["zip"])
    tot = pd.DataFrame({"zip": t["zip"]})
    for c, n in (("est", "cbp_establishments"), ("emp", "cbp_employees"), ("ap", "cbp_annual_payroll_000"),
                 ("qp1", "cbp_q1_payroll_000")):
        if c in t:
            tot[n] = pd.to_numeric(t[c], errors="coerce")
    det = read_zip_csv(base.format(y=y, yy=str(y)[2:], kind="detail"))
    det["zip"] = z5(det["zip"])
    det["est"] = pd.to_numeric(det["est"], errors="coerce").fillna(0).astype(int)
    sec = det[det["naics"].str.fullmatch(r"\d\d-+")].copy()
    sec["s"] = sec["naics"].str[:2]
    sw = sec.pivot_table(index="zip", columns="s", values="est", aggfunc="sum").fillna(0).astype(int)
    sw.columns = [f"cbp_est_{c}" for c in sw.columns]
    out = tot.merge(sw.reset_index(), on="zip", how="outer")
    six = det[det["naics"].str.fullmatch(r"\d{6}")][["zip", "naics", "est"]]
    size_cols = [c for c in det.columns if re.fullmatch(r"n.*\d", c)]
    six = six.join(det.loc[six.index, size_cols].apply(pd.to_numeric, errors="coerce"))
    labels = {"cbp_establishments": "Establishments with paid employees", "cbp_employees": "Paid employees (week of March 12)",
              "cbp_annual_payroll_000": "Annual payroll ($000)", "cbp_q1_payroll_000": "First-quarter payroll ($000)"}
    labels.update({f"cbp_est_{k}": f"Establishments: {v}" for k, v in SECTORS.items()})
    REPORT["cbp"] = {"release": f"{y}", "rows": len(out), "naics_rows": len(six), "est": int(out["cbp_establishments"].sum())}
    add_dict("zip_cbp.csv.gz", list(out.columns[1:]), "U.S. Census Bureau, ZIP Code Business Patterns", str(y), labels,
             "Employment and payroll may be blank where Census withholds them to protect individual businesses.")
    add_dict("cbp_zip_naics.csv.gz", list(six.columns[1:]), "U.S. Census Bureau, ZIP Code Business Patterns", str(y),
             {"naics": "6-digit NAICS industry code", "est": "Establishments"},
             "One row per ZIP and industry; size columns count establishments by number of employees.")
    save(out, "zip_cbp.csv.gz")
    save(six, "cbp_zip_naics.csv.gz")
    return out


# ----------------------------------------------------------------------------------------------------------------
# Census LEHD LODES: jobs by workplace ZIP and workers by home ZIP (block data rolled up with the LODES crosswalk)
# ----------------------------------------------------------------------------------------------------------------
STATES = ("al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd "
          "oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy").split()
LODES = "https://lehd.ces.census.gov/data/lodes/LODES8/{st}"
LODES_VARS = {"C000": "All jobs", "CA01": "Workers age 29 or younger", "CA02": "Workers age 30 to 54",
              "CA03": "Workers age 55 or older", "CE01": "Earnings $1,250/month or less", "CE02": "Earnings $1,251 to $3,333/month",
              "CE03": "Earnings over $3,333/month", "CS01": "Male workers", "CS02": "Female workers",
              "CNS01": "Agriculture", "CNS02": "Mining", "CNS03": "Utilities", "CNS04": "Construction", "CNS05": "Manufacturing",
              "CNS06": "Wholesale trade", "CNS07": "Retail trade", "CNS08": "Transportation and warehousing",
              "CNS09": "Information", "CNS10": "Finance and insurance", "CNS11": "Real estate", "CNS12": "Professional services",
              "CNS13": "Management of companies", "CNS14": "Administrative and support", "CNS15": "Educational services",
              "CNS16": "Health care and social assistance", "CNS17": "Arts and recreation", "CNS18": "Accommodation and food",
              "CNS19": "Other services", "CNS20": "Public administration"}


def build_lodes():
    parts, years = [], {}
    for st in STATES:
        xw = pd.read_csv(io.BytesIO(fetch_bytes(f"{LODES.format(st=st)}/{st}_xwalk.csv.gz")), compression="gzip",
                         usecols=["tabblk2020", "zcta"], dtype=str)
        xw = xw[xw["zcta"].notna() & ~xw["zcta"].isin(["99999", ""])]
        for kind, geo in (("wac", "w_geocode"), ("rac", "h_geocode")):
            for y in range(THIS_YEAR - 1, THIS_YEAR - 7, -1):
                url = f"{LODES.format(st=st)}/{kind}/{st}_{kind}_S000_JT00_{y}.csv.gz"
                try:
                    raw = fetch_bytes(url)
                    break
                except Exception:
                    continue
            else:
                years[(st, kind)] = None
                log(f"  {st.upper()}: no recent LODES {kind} file; skipped")
                continue
            years[(st, kind)] = y
            d = pd.read_csv(io.BytesIO(raw), compression="gzip", dtype={geo: str},
                            usecols=[geo] + [v for v in LODES_VARS])
            d = d.merge(xw, left_on=geo, right_on="tabblk2020", how="inner")
            g = d.groupby("zcta")[list(LODES_VARS)].sum()
            g.columns = [f"lodes_{kind}_{c.lower()}" for c in g.columns]
            parts.append(g)
        log(f"  {st.upper()}: workplace {years[(st, 'wac')]}, residence {years[(st, 'rac')]}")
    missing = sorted({s.upper() for (s, k), y in years.items() if y is None})
    years = {k: y for k, y in years.items() if y is not None}
    if not years:
        raise RuntimeError("no LODES files found for any state")
    allp = pd.concat(parts)
    out = allp.groupby(level=0).sum(min_count=1).reset_index().rename(columns={"zcta": "zip"})
    yrs = sorted(set(years.values()))
    rel = f"{yrs[-1]}" if len(yrs) == 1 else f"{yrs[0]}–{yrs[-1]} (latest available per state)"
    labels = {}
    for kind, txt in (("wac", "Jobs located in the ZIP"), ("rac", "Workers living in the ZIP")):
        for k, v in LODES_VARS.items():
            labels[f"lodes_{kind}_{k.lower()}"] = f"{txt}: {v}"
    lag = [f"{s.upper()} {k} {y}" for (s, k), y in years.items() if y != yrs[-1]]
    REPORT["lodes"] = {"release": rel, "rows": len(out), "jobs": int(out["lodes_wac_c000"].sum()), "lagging": lag,
                       "missing": missing}
    add_dict("zip_lodes.csv.gz", list(out.columns[1:]), "U.S. Census Bureau, LEHD Origin-Destination Employment Statistics (LODES 8)",
             rel, labels, "Census blocks rolled up to 2020 ZCTAs with the LODES crosswalk. Primary and secondary jobs "
                          "(JT00), all workers (S000). Puerto Rico is not covered. Excludes self-employed and military.")
    save(out, "zip_lodes.csv.gz")
    return out


# ----------------------------------------------------------------------------------------------------------------
# USDA ERS rural-urban commuting area codes (ZIP file)
# ----------------------------------------------------------------------------------------------------------------
RUCA_URL = "https://www.ers.usda.gov/media/5444/2020-rural-urban-commuting-area-codes-zip-codes.csv"
RUCA_PAGE = "https://www.ers.usda.gov/data-products/rural-urban-commuting-area-codes"
RUCA_TEXT = {1: "Metropolitan core", 2: "Metropolitan high commuting", 3: "Metropolitan low commuting",
             4: "Micropolitan core", 5: "Micropolitan high commuting", 6: "Micropolitan low commuting",
             7: "Small town core", 8: "Small town high commuting", 9: "Small town low commuting", 10: "Rural"}


def build_ruca():
    url = RUCA_URL
    try:   # follow the newest ZIP-code CSV linked from the ERS page, so a future release is picked up
        page = fetch_bytes(RUCA_PAGE, timeout=120).decode("utf-8", "replace")
        links = re.findall(r'href="([^"]*rural-urban-commuting-area-codes-zip-code[^"]*\.csv[^"]*)"', page)
        links = [l if l.startswith("http") else "https://www.ers.usda.gov" + l for l in links]
        def yr(l):
            m = re.search(r"/(\d{4})-rural", l); return int(m.group(1)) if m else 0
        if links:
            url = max(links, key=yr)
    except Exception as e:
        log(f"  ERS page not read ({e}); using the known 2020 file")
    d = pd.read_csv(io.BytesIO(fetch_bytes(url)), dtype=str)
    d.columns = [c.strip() for c in d.columns]
    zc = next(c for c in d.columns if c.lower().startswith("zip") and "type" not in c.lower())
    out = pd.DataFrame({"zip": z5(d[zc])})
    pc = next(c for c in d.columns if "primary" in c.lower())
    sc = next((c for c in d.columns if "secondary" in c.lower()), None)
    out["ruca_primary"] = pd.to_numeric(d[pc], errors="coerce")
    if sc:
        out["ruca_secondary"] = pd.to_numeric(d[sc], errors="coerce")
    out["ruca_class"] = out["ruca_primary"].map(RUCA_TEXT)
    out["ruca_group"] = pd.cut(out["ruca_primary"], [0, 3, 6, 9, 10], labels=["Metro", "Micropolitan", "Small town", "Rural"])
    tc = next((c for c in d.columns if "type" in c.lower()), None)
    if tc:
        out["ruca_zip_type"] = d[tc].values
    out = out.drop_duplicates("zip")
    m = re.search(r"/(\d{4})-rural", url)
    rel = m.group(1) if m else "2020"
    REPORT["ruca"] = {"release": f"{rel} codes", "rows": len(out)}
    add_dict("zip_ruca.csv.gz", list(out.columns[1:]), "USDA Economic Research Service, Rural-Urban Commuting Area Codes",
             rel, {"ruca_primary": "Primary RUCA code (1 metro core to 10 rural)", "ruca_secondary": "Secondary RUCA code",
                   "ruca_class": "Primary code description", "ruca_group": "Metro / micropolitan / small town / rural",
                   "ruca_zip_type": "ZIP code area, or post office / large-volume customer"},
             "Updated once per decade (after each census).")
    save(out, "zip_ruca.csv.gz")
    return out


# ----------------------------------------------------------------------------------------------------------------
# CDC PLACES, ZCTA data (GIS-friendly, one row per ZCTA)
# ----------------------------------------------------------------------------------------------------------------
PLACES_FALLBACK = "kee5-23sr"
PLACES_MEASURES = {"ACCESS2": "No health insurance, 18-64", "ARTHRITIS": "Arthritis", "BINGE": "Binge drinking",
                   "BPHIGH": "High blood pressure", "BPMED": "Taking blood pressure medication", "CANCER": "Cancer (non-skin)",
                   "CASTHMA": "Current asthma", "CHD": "Coronary heart disease", "CHECKUP": "Routine checkup in past year",
                   "CHOLSCREEN": "Cholesterol screening", "COGNITION": "Cognitive disability", "COLON_SCREEN": "Colorectal cancer screening",
                   "COPD": "COPD", "CSMOKING": "Current smoking", "DENTAL": "Dental visit in past year", "DEPRESSION": "Depression",
                   "DIABETES": "Diabetes", "DISABILITY": "Any disability", "EMOTIONSPT": "Lack of social and emotional support",
                   "FOODINSECU": "Food insecurity", "FOODSTAMP": "Received food stamps", "GHLTH": "Fair or poor general health",
                   "HEARING": "Hearing disability", "HIGHCHOL": "High cholesterol", "HOUSINSECU": "Housing insecurity",
                   "INDEPLIVE": "Independent living disability", "ISOLATION": "Loneliness", "KIDNEY": "Chronic kidney disease",
                   "LACKTRPT": "Lack of reliable transportation", "LPA": "No leisure-time physical activity",
                   "MAMMOUSE": "Mammography use", "MHLTH": "Frequent mental distress", "MOBILITY": "Mobility disability",
                   "OBESITY": "Obesity", "PHLTH": "Frequent physical distress", "SELFCARE": "Self-care disability",
                   "SHUTUTILITY": "Utility services shut-off threat", "SLEEP": "Short sleep duration", "STROKE": "Stroke",
                   "TEETHLOST": "All teeth lost, 65+", "VISION": "Vision disability"}


def places_dataset():
    url = ("https://api.us.socrata.com/api/catalog/v1?domains=data.cdc.gov&only=datasets&limit=50&q="
           + urllib.request.quote("PLACES ZCTA GIS Friendly Format"))
    try:
        res = json.load(get(url, timeout=120))["results"]
        best = None
        for r in res:
            name = r["resource"]["name"]
            m = re.search(r"PLACES: ZCTA Data \(GIS Friendly Format\),? (\d{4}) [Rr]elease", name)
            if m and (best is None or int(m.group(1)) > best[0]):
                best = (int(m.group(1)), r["resource"]["id"], name)
        if best:
            return best[1], best[2]
    except Exception as e:
        log(f"  CDC catalog not read ({e})")
    return PLACES_FALLBACK, "PLACES ZCTA (GIS-friendly) dataset " + PLACES_FALLBACK


def build_places():
    did, name = places_dataset()
    log(f"  {name} ({did})")
    d = pd.read_csv(io.BytesIO(fetch_bytes(f"https://data.cdc.gov/api/views/{did}/rows.csv?accessType=DOWNLOAD")), dtype=str)
    zc = next(c for c in d.columns if c.upper().startswith("ZCTA"))
    keep = [c for c in d.columns if c.endswith("_CrudePrev")]
    out = pd.DataFrame({"zip": z5(d[zc])})
    for c in keep:
        out["places_" + c[:-len("_CrudePrev")].lower()] = pd.to_numeric(d[c], errors="coerce")
    if not keep:
        raise RuntimeError(f"no *_CrudePrev columns in {name}")
    labels = {f"places_{k.lower()}": f"{v} (% of adults, crude prevalence)" for k, v in PLACES_MEASURES.items()}
    m = re.search(r"(\d{4})", name)
    REPORT["places"] = {"release": name, "rows": len(out), "measures": len(keep)}
    add_dict("zip_places.csv.gz", list(out.columns[1:]), "Centers for Disease Control and Prevention, PLACES",
             m.group(1) + " release" if m else name, labels,
             "Model-based estimates from the BRFSS survey, not counts. Use as context, not as audience size.")
    save(out.drop_duplicates("zip"), "zip_places.csv.gz")
    return out


# ----------------------------------------------------------------------------------------------------------------
# FHFA house price index, 5-digit ZIP (annual, developmental)
# ----------------------------------------------------------------------------------------------------------------
FHFA_PAGE = "https://www.fhfa.gov/data/hpi/datasets?tab=additional-data"
FHFA_URLS = ["https://www.fhfa.gov/hpi/download/annual/hpi_at_zip5.xlsx",
             "https://www.fhfa.gov/hpi/download/annually/hpi_at_bdl_zip5.xlsx"]


def build_fhfa():
    urls = list(FHFA_URLS)
    try:   # use whatever five-digit ZIP file the downloads page links to now
        page = fetch_bytes(FHFA_PAGE, timeout=120).decode("utf-8", "replace")
        found = re.findall(r'href="([^"]*zip5[^"]*\.xlsx)"', page, flags=re.I)
        urls = [u if u.startswith("http") else "https://www.fhfa.gov" + u for u in found] + urls
    except Exception as e:
        log(f"  FHFA page not read ({e}); trying known addresses")
    raw = None
    for u in urls:
        try:
            raw = fetch_bytes(u); log(f"  {u}"); break
        except Exception as e:
            log(f"  not at {u}: {e}")
    if raw is None:
        raise RuntimeError("FHFA ZIP5 file not found")
    probe = pd.read_excel(io.BytesIO(raw), header=None, nrows=30, dtype=str)
    log("  first rows of the FHFA file:")
    for i in range(min(8, len(probe))):
        log("   ", [str(v)[:40] for v in probe.iloc[i].tolist()])
    norm = lambda v: re.sub(r"\s+", " ", str(v)).strip().lower()
    hdr = next((i for i in range(len(probe)) if any(norm(v) == "year" for v in probe.iloc[i])), None)
    if hdr is None:
        raise RuntimeError("no header row with a 'Year' column in the FHFA file")
    d = pd.read_excel(io.BytesIO(raw), header=hdr, dtype=str)
    d.columns = [norm(c) for c in d.columns]
    pick = lambda test, what: next((c for c in d.columns if test(c)), None) or (_ for _ in ()).throw(
        RuntimeError(f"FHFA file has no {what} column; columns are {list(d.columns)}"))
    zc = pick(lambda c: "zip" in c, "ZIP")
    yc = pick(lambda c: c == "year", "Year")
    chg = pick(lambda c: "change" in c, "annual change")
    hpi = pick(lambda c: c == "hpi", "HPI")
    d["zip"] = z5(d[zc])
    d["year"] = pd.to_numeric(d[yc], errors="coerce")
    d["chg"] = pd.to_numeric(d[chg], errors="coerce")
    d["hpi"] = pd.to_numeric(d[hpi], errors="coerce")
    last = int(d["year"].max())
    w = d.pivot_table(index="zip", columns="year", values="hpi")
    out = pd.DataFrame(index=w.index)
    out[f"fhfa_change_1yr"] = d[d["year"] == last].set_index("zip")["chg"]
    for n in (5, 10):
        if last - n in w:
            out[f"fhfa_change_{n}yr"] = (w[last] / w[last - n] - 1) * 100
    out["fhfa_hpi_latest"] = w[last]
    out["fhfa_latest_year"] = last
    out = out.reset_index()
    out = out[out["fhfa_hpi_latest"].notna()]
    REPORT["fhfa"] = {"release": f"annual index through {last}", "rows": len(out)}
    add_dict("zip_fhfa.csv.gz", list(out.columns[1:]), "Federal Housing Finance Agency, House Price Index (ZIP5, developmental)",
             f"through {last}", {"fhfa_change_1yr": f"Home price change, {last - 1} to {last} (%)",
                                 "fhfa_change_5yr": f"Home price change, {last - 5} to {last} (%)",
                                 "fhfa_change_10yr": f"Home price change, {last - 10} to {last} (%)",
                                 "fhfa_hpi_latest": f"House price index, {last}", "fhfa_latest_year": "Latest index year"},
             "Repeat-sales index for single-family homes; published only for ZIPs with enough sales.")
    save(out, "zip_fhfa.csv.gz")
    return out


# ----------------------------------------------------------------------------------------------------------------
SOURCES = {"deluxe": build_deluxe, "acs": build_acs, "irs": build_irs, "cbp": build_cbp, "lodes": build_lodes,
           "ruca": build_ruca, "places": build_places, "fhfa": build_fhfa}
FILES = {"deluxe": "zip_deluxe.csv.gz", "acs": "zip_acs.csv.gz", "irs": "zip_irs.csv.gz", "cbp": "zip_cbp.csv.gz",
         "lodes": "zip_lodes.csv.gz", "ruca": "zip_ruca.csv.gz", "places": "zip_places.csv.gz", "fhfa": "zip_fhfa.csv.gz"}
NAMES = {"deluxe": "Deluxe ZIP database", "acs": "Census ACS 5-year", "irs": "IRS income tax statistics",
         "cbp": "Census ZIP Code Business Patterns", "lodes": "Census LEHD jobs (LODES)", "ruca": "USDA rural-urban codes",
         "places": "CDC PLACES health estimates", "fhfa": "FHFA house price index"}


def build_index(status):
    dlx = pd.read_csv(os.path.join(OUT, FILES["deluxe"]), dtype={"zip": str},
                      usecols=["zip", "dlx_population", "dlx_householdsperzipcode", "dlx_classificationcode",
                               "dlx_citymixedcase", "dlx_state", "dlx_countymixedcase", "dlx_statefips", "dlx_countyfips",
                               "dlx_latitude", "dlx_longitude"])
    geo = pd.read_csv(GEO, dtype=str).drop(columns=["population", "households"], errors="ignore")
    idx = dlx.merge(geo, on="zip", how="left")
    # ZIPs outside the geography table (Puerto Rico and other territories, a few new ZIPs): fill from Deluxe
    fips = (pd.to_numeric(idx["dlx_statefips"], errors="coerce") * 1000 + pd.to_numeric(idx["dlx_countyfips"], errors="coerce"))
    for c, f in (("city", idx["dlx_citymixedcase"]), ("state", idx["dlx_state"]), ("county", idx["dlx_countymixedcase"]),
                 ("county_fips", fips.astype("Int64").astype(str).str.zfill(5).where(fips.notna())),
                 ("lat", idx["dlx_latitude"]), ("lon", idx["dlx_longitude"])):
        idx[c] = idx[c].where(idx[c].notna(), f)
    idx = idx.drop(columns=[c for c in idx if c.startswith("dlx_") and c not in
                            ("dlx_population", "dlx_householdsperzipcode", "dlx_classificationcode")])
    idx = idx.rename(columns={"dlx_population": "population", "dlx_householdsperzipcode": "households",
                              "dlx_classificationcode": "zip_class"})
    idx["residential"] = pd.to_numeric(idx["population"], errors="coerce").fillna(0) > 0
    for s, f in FILES.items():
        if s == "deluxe" or not os.path.exists(os.path.join(OUT, f)):
            continue
        z = set(pd.read_csv(os.path.join(OUT, f), dtype={"zip": str}, usecols=["zip"])["zip"])
        idx[f"has_{s}"] = idx["zip"].isin(z)
        res = idx[idx["residential"]]
        pop = pd.to_numeric(res["population"], errors="coerce").fillna(0)
        if s in REPORT:
            REPORT[s]["cover_zips"] = int(res[f"has_{s}"].sum())
            REPORT[s]["cover_pop"] = float(pop[res[f"has_{s}"]].sum() / pop.sum() * 100)
    keep = [c for c in ("zip", "city", "state", "county", "county_fips", "cbsa_code", "cbsa_name", "cbsa_type", "dma_code",
                        "dma_name", "lat", "lon", "zip_class", "population", "households", "residential") if c in idx] + \
           [c for c in idx if c.startswith("has_")]
    idx = idx[keep]
    add_dict("zip_index.csv.gz", keep[1:], "Built from the Deluxe ZIP list and data-build/geo/zip_geo.csv", "",
             {"zip_class": "Deluxe ZIP classification (blank = standard, P = PO box only, U = unique/single organization, M = military)",
              "residential": "Has residents (Deluxe population above zero)"}, "has_* columns show which sources cover the ZIP.")
    save(idx, "zip_index.csv.gz")


def merge_previous_facts(status):
    """On a partial run, carry the previous report facts forward for sources that kept their file."""
    path = os.path.join(OUT, "source_facts.json")
    old = json.load(open(path)) if os.path.exists(path) else {}
    for s, v in status.items():
        if v.startswith("kept") and s in old.get("facts", {}) and s not in REPORT:
            REPORT[s] = old["facts"][s]
            status[s] = f"kept from {old['built'].get(s, 'an earlier run')}"
    built = old.get("built", {})
    for s, v in status.items():
        if v == "built":
            built[s] = datetime.date.today().isoformat()
    json.dump({"facts": {k: v for k, v in REPORT.items()}, "built": built}, open(path, "w"), indent=1, default=str)


def write_report(status, started):
    L = ["# Master ZIP data report", "",
         f"Built {datetime.date.today().isoformat()} in {(time.time() - started) / 60:.0f} minutes.", "",
         "| Source | Status | Release | ZIPs in file | Residential ZIPs covered | Share of population covered |",
         "| --- | --- | --- | --- | --- | --- |"]
    for s in SOURCES:
        r = REPORT.get(s, {})
        st = status.get(s, "not run")
        cz = f"{r['cover_zips']:,}" if "cover_zips" in r else ""
        cp = f"{r['cover_pop']:.1f}%" if "cover_pop" in r else ""
        L.append(f"| {NAMES[s]} | {st} | {r.get('release', '')} | {r.get('rows', 0):,} | {cz} | {cp} |")
    L += ["", "## Checks", ""]
    d = REPORT.get("deluxe")
    if d:
        L.append(f"- Deluxe: {d['files']} workbooks, {d['rows']:,} ZIPs ({d['residential']:,} residential, "
                 f"{d['pop']:,} people); {d['dups_dropped']} duplicate rows dropped.")
    a = REPORT.get("acs")
    if a:
        L.append(f"- ACS: {a['tables']} tables, {a['columns']:,} columns. Age lines that don't add up to total population: "
                 f"{a['age_bad']} ZCTAs. Income bands that don't add up to households: {a['inc_bad']} ZCTAs. Labels: {a['labels']}.")
    g = REPORT.get("acs_api")
    if g and g.get("tried"):
        left = [z for z in g["tried"] if z not in g["filled"]]
        L.append(f"- ACS gaps: {len(g['tried'])} populated ZIPs missing from the bulk file; filled: "
                 f"{', '.join(g['filled']) or 'none'}" + (f" (ACS 5-year {g['year'] - 4}–{g['year']})" if g.get('year') else "") +
                 (f"; still missing: {len(left)}" if left else "") + (f"; API errors: {' | '.join(g.get('errors') or [])}" if g.get("errors") else "") + ".")
    i = REPORT.get("irs")
    if i:
        L.append(f"- IRS: {i['returns']:,} returns across {i['rows']:,} ZIPs.")
    c = REPORT.get("cbp")
    if c:
        L.append(f"- Business Patterns: {c['est']:,} establishments; {c['naics_rows']:,} ZIP-by-industry rows.")
    l = REPORT.get("lodes")
    if l:
        L.append(f"- LODES: {l['jobs']:,} jobs placed in ZIPs." + (f" States on an older year: {', '.join(l['lagging'])}." if l["lagging"] else "")
                 + (f" States with no recent files (no jobs data): {', '.join(l['missing'])}." if l["missing"] else ""))
    p = REPORT.get("places")
    if p:
        L.append(f"- PLACES: {p['measures']} measures.")
    L += ["", "## Notes", "",
          "- ACS, LODES and PLACES describe ZIP Code Tabulation Areas (Census areas built from ZIPs). Deluxe, IRS, Business "
          "Patterns and FHFA use USPS ZIP Codes. They join on the 5-digit code; PO-box-only and single-organization ZIPs have "
          "no ZCTA, so they show no ACS, LODES or PLACES data.",
          "- Race and ethnicity fields are kept for description only. Don't use them to choose or exclude areas for housing, "
          "credit or employment advertising.",
          "- To refresh Deluxe, replace the workbooks in data-build/sources/deluxe/ and run the action. The public sources "
          "refresh themselves on the monthly schedule."]
    failed = [s for s, v in status.items() if not v.startswith(("built", "kept"))]
    if failed:
        L += ["", "## Problems", ""] + [f"- {NAMES[s]}: {status[s]}" for s in failed]
    open(os.path.join(OUT, "master_report.md"), "w").write("\n".join(L) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated sources: " + ",".join(SOURCES))
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    started = time.time()
    run = a.only.split(",") if a.only else list(SOURCES)
    status = {}
    for s in SOURCES:
        if s not in run:
            status[s] = "kept previous file" if os.path.exists(os.path.join(OUT, FILES[s])) else "not built"
            continue
        log(f"== {NAMES[s]}")
        try:
            SOURCES[s]()
            status[s] = "built"
        except Exception as e:
            kept = os.path.exists(os.path.join(OUT, FILES[s]))
            status[s] = f"FAILED ({type(e).__name__}: {str(e)[:200]})" + ("; previous file kept" if kept else "")
            log(f"  {status[s]}")
            print(f"::warning title={NAMES[s]}::{status[s]}")
    if not os.path.exists(os.path.join(OUT, FILES["deluxe"])):
        sys.exit("The Deluxe file is required for the index; stopping.")
    merge_previous_facts(status)
    build_index(status)
    # merge this run's dictionary rows with the previous dictionary rows for sources that weren't rebuilt
    dpath = os.path.join(OUT, "field_dictionary.csv")
    new = pd.DataFrame(DICT)
    if os.path.exists(dpath):
        old = pd.read_csv(dpath, dtype=str)
        old = old[~old["file"].isin(new["file"].unique())]
        new = pd.concat([old, new], ignore_index=True)
    new.to_csv(dpath, index=False)
    write_report(status, started)
    log(open(os.path.join(OUT, "master_report.md")).read())
    if any(not v.startswith(("built", "kept")) for v in status.values()):
        print("::warning title=Master ZIP build::Some sources failed; see master_report.md")


if __name__ == "__main__":
    main()
