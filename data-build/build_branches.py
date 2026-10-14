"""Builds data-build/master/zip_branches.csv.gz: bank and credit union branches by ZIP, for the Financial analyzer's
map toggles.

Sources (public downloads, no key):
  - FDIC Summary of Deposits (BankFind Suite API): every FDIC-insured bank branch as of June 30 of the newest year,
    with its ZIP and deposits.
  - NCUA quarterly Call Report data: every federally insured credit union's branch list ("Credit Union Branch
    Information"), the newest quarter published, with each site's physical ZIP.

Columns: zip, bank_br (bank branches), bank_dep ($000 deposits booked at those branches), cu_br (credit union branches).

  python3 data-build/build_branches.py
"""
import datetime, io, json, os, sys, time, urllib.request, urllib.parse, zipfile

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "master")
UA = {"User-Agent": "Mozilla/5.0 (Adtaxi analyzer data build; github.com/MWoronoff)"}
FDIC_BASES = ["https://api.fdic.gov/banks/sod", "https://banks.data.fdic.gov/api/sod"]
NCUA = "https://ncua.gov/files/publications/analysis/call-report-data-{y}-{m:02d}.zip"


def log(*a): print(*a, flush=True)


def get(url, tries=4, timeout=600):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (400, 403, 404) or i == tries - 1: raise RuntimeError(f"HTTP {e.code} for {url}")
        except Exception as e:
            if i == tries - 1: raise RuntimeError(f"{type(e).__name__} for {url}: {e}")
        time.sleep(10 * (i + 1))


def z5(s):
    return s.astype(str).str.extract(r"(\d{5})")[0]


def fdic():
    this = datetime.date.today().year
    for base in FDIC_BASES:
        for y in range(this, this - 3, -1):
            q = {"filters": f"YEAR:{y}", "fields": "ZIPBR,DEPSUMBR,UNINUMBR", "limit": 10000, "offset": 0, "format": "json"}
            try:
                first = json.loads(get(base + "?" + urllib.parse.urlencode(q), tries=2))
            except Exception as e:
                log(f"FDIC {y} at {base}: {e}"); continue
            total = first.get("meta", {}).get("total", 0)
            if not total: log(f"FDIC {y} at {base}: no rows"); continue
            log(f"FDIC Summary of Deposits {y}: {total:,} branches ({base})")
            rows, off = [r["data"] for r in first["data"]], 10000
            while off < total:
                q["offset"] = off
                rows += [r["data"] for r in json.loads(get(base + "?" + urllib.parse.urlencode(q)))["data"]]
                off += 10000
            d = pd.DataFrame(rows)
            d["zip"] = z5(d.ZIPBR.astype(str).str.zfill(5))
            d["dep"] = pd.to_numeric(d.DEPSUMBR, errors="coerce").fillna(0)
            if len(d) < 0.95 * total: sys.exit(f"FDIC download incomplete: {len(d):,} of {total:,}")
            return y, d.groupby("zip").agg(bank_br=("dep", "size"), bank_dep=("dep", "sum"))
    sys.exit("FDIC Summary of Deposits could not be downloaded.")


def ncua():
    t = datetime.date.today()
    qs = []
    for y in range(t.year, t.year - 2, -1):
        for m in (12, 9, 6, 3):
            if (y, m) < (t.year, t.month): qs.append((y, m))
    for y, m in qs:
        url = NCUA.format(y=y, m=m)
        try:
            blob = get(url, tries=2)
        except Exception as e:
            log(f"NCUA {y}-{m:02d}: {e}"); continue
        zf = zipfile.ZipFile(io.BytesIO(blob))
        name = next((n for n in zf.namelist() if "branch" in n.lower()), None)
        if not name: log(f"NCUA {y}-{m:02d}: no branch file in {zf.namelist()[:12]}"); continue
        d = pd.read_csv(zf.open(name), dtype=str, encoding="latin-1", low_memory=False)
        d.columns = [c.strip() for c in d.columns]
        zc = next((c for c in d.columns if "physical" in c.lower() and ("postal" in c.lower() or "zip" in c.lower())), None)
        tc = next((c for c in d.columns if c.lower() in ("sitetypename", "site_type_name", "sitetype")), None)
        if not zc: sys.exit(f"NCUA branch file has no physical ZIP column: {list(d.columns)[:30]}")
        if tc:
            log("NCUA site types: " + ", ".join(f"{k} {v:,}" for k, v in d[tc].value_counts().items()))
            d = d[~d[tc].fillna("").str.contains("ATM|Administrative|Shared", case=False)]
        d["zip"] = z5(d[zc])
        log(f"NCUA {y}-{m:02d}: {len(d):,} credit union branches ({name})")
        return f"{y}-{m:02d}", d.groupby("zip").size().rename("cu_br").to_frame()
    sys.exit("NCUA call report branch data could not be downloaded.")


def main():
    fy, b = fdic()
    nq, c = ncua()
    out = b.join(c, how="outer").fillna(0)
    for k in ("bank_br", "cu_br"): out[k] = out[k].astype(int)
    out["bank_dep"] = out.bank_dep.round().astype("int64")
    out = out[out.index.notna()]
    nb, nc = int(out.bank_br.sum()), int(out.cu_br.sum())
    log(f"Bank branches {nb:,}; credit union branches {nc:,}; ZIPs {len(out):,}")
    if not (60000 <= nb <= 95000): sys.exit(f"Bank branch total {nb:,} outside 60,000–95,000")
    if not (15000 <= nc <= 30000): sys.exit(f"Credit union branch total {nc:,} outside 12,000–30,000")
    os.makedirs(OUT, exist_ok=True)
    out.reset_index().to_csv(os.path.join(OUT, "zip_branches.csv.gz"), index=False, compression="gzip")
    json.dump({"fdicYear": fy, "ncuaQuarter": nq, "bankBranches": nb, "cuBranches": nc, "built": datetime.date.today().isoformat()},
              open(os.path.join(OUT, "branches_facts.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
