"""Build TV/data/markets.json for the TV-to-Digital Analyzer.

Source: Scarborough USA+ 2026 Release 1 broadcast audience data (ABC, CBS, CW, FOX, NBC,
635 network/half-hour observations per market) as embedded in the archived tool pages:
  archive/tv-2026-10/index.html   gender, age-band and HHI shares/compositions, planning CPMs
  archive/tv-2026-10/Gindex.html  measured gender x age demos (A18-34, M25-54, W18-49, ...)
Run from the repo root: python3 data-build/tv/build_markets.py
"""
import json, re

def grab(path, name):
    s = open(path, encoding="utf-8").read()
    m = re.search(r"const " + name + r"=(\{.*?\});\n", s, re.S)
    return json.loads(m.group(1))

DIM = grab("archive/tv-2026-10/index.html", "DIM_DATA")

# Planning CPMs keep the old rank-based curve, rescaled so Denver (DMA 17) = $7.00 for adults 18+
# (Oct 2026: the old curve put Denver at $15.61, an average :30 spot near $691).
CPM_SCALE = 7.0 / DIM["Denver"]["planning_cpm"]
MEAS = grab("archive/tv-2026-10/Gindex.html", "DATA")

DMA_CODES = {
    "Albany-Schenectady-Troy": "532", "Boston": "506", "Chicago": "602", "Columbus": "535",
    "Denver": "751", "Detroit": "505", "Flint-Saginaw-Bay City": "513", "Hartford-New Haven": "533",
    "Los Angeles": "803", "Miami-Ft. Lauderdale": "528", "Minneapolis-St. Paul": "613",
    "New York": "501", "Orlando-Daytona Beach-Melbourne": "534", "Philadelphia": "504",
    "Sacramento-Stockton-Modesto": "862", "San Diego": "825", "San Francisco-Oakland-San Jose": "807",
    "Syracuse": "555", "Tampa-St. Petersburg": "539", "West Palm Beach-Ft. Pierce": "548",
    "Wilkes-Barre-Scranton": "577",
}

out = {"source": "Scarborough USA+ 2026 Release 1", "markets": []}
for name, d in sorted(DIM.items()):
    meas = {}
    for demo, v in MEAS[name].items():
        if demo.startswith("_"):
            continue
        meas[demo] = {"universe": round(v["universe"]), "composition": round(v["composition"], 6)}
    out["markets"].append({
        "name": name,
        "dma_code": DMA_CODES[name],
        "dma_rank": d["dma_rank"],
        "adults": round(d["base"]),
        "avg_a18": round(d["avg_a18"], 1),
        "obs": d["obs"],
        "planning_cpm": round(d["planning_cpm"] * CPM_SCALE, 2),
        "measured": meas,
        "gender": {k: {"share": round(v["share"], 6), "composition": round(v["composition"], 6)} for k, v in d["gender"].items() if k != "A"},
        "age": {k: {"share": round(v["share"], 6), "composition": round(v["composition"], 6)} for k, v in d["age"].items() if k != "18+"},
        "hhi": {k: {"share": round(v["share"], 6), "composition": round(v["composition"], 6)} for k, v in d["hhi"].items()},
    })

json.dump(out, open("TV/data/markets.json", "w"), separators=(",", ":"))
print(len(out["markets"]), "markets written")

# ---- Streaming and connected TV by DMA (Scarborough USA+ 2026 Release 1, DMA profile reports) ----
# Sources (Oct 2026, supplied by the user): adults 18+ and adults 55+ in each DMA who streamed video
# (adults 18-54 is derived by subtracting the 55+ counts from the 18+ counts)
# in the past 7 / 30 days and who have any connected-TV device. The antenna column is not used.
import pandas as pd

def norm(n):
    n = n.replace(" DMA", "").lower()
    for a, b in [("ft.", "ft "), ("st.", "st "), ("/", "-"), (".", " "), ("saint", "st"), ("fort ", "ft ")]:
        n = n.replace(a, b)
    return " ".join(n.replace("-", " ").split())

def streaming(path):
    # Projected counts: column 1 = adults in the group, 3 = streamed past 7 days, 6 = past 30 days, 12 = any connected-TV device
    df = pd.read_excel(path, header=None)
    cnt = lambda r: {"n": r[1], "w7": r[3], "m30": r[6], "ctv": r[12]}
    out = {"_us": cnt(df.iloc[7])}
    for _, r in df.iloc[10:].iterrows():
        if isinstance(r[0], str) and r[0].endswith("DMA") and r[1] == r[1]:
            out[norm(r[0])] = cnt(r)
    return out

S18 = streaming("data-build/tv/sources/streaming_adults18.xls")
S55 = streaming("data-build/tv/sources/streaming_adults55.xls")
def rates(c): return {k: round(c[k] / c["n"], 4) for k in ("w7", "m30", "ctv")}
def minus(a, b): return {k: a[k] - b[k] for k in a}   # adults 18-54 = adults 18+ minus adults 55+ (counts, then rates)
def groups(k): return {"a18": rates(S18[k]), "a1854": rates(minus(S18[k], S55[k])), "a55": rates(S55[k])}
out["streaming_us"] = groups("_us")
for m in out["markets"]:
    m["streaming"] = groups(norm(m["name"]))
json.dump(out, open("TV/data/markets.json", "w"), separators=(",", ":"))
print("streaming added for", len(out["markets"]), "markets")
