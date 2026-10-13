"""Build TV/data/markets.json for the TV + Digital Video Allocation Analyzer.

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
