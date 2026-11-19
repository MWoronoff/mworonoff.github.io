"""Compact each analyzer's county and metro ZIP files (Nov 2026).

Every ZIP's figures are the same whichever area it is listed under, except the ones ranked within that area:
score, demand, spend and underserved (score@x, demand@x, spend@x, under@x). DMA files keep full rows. County and
metro files keep, per ZIP, only those area-ranked fields plus "base": the DMA file(s) that hold the rest. The engine
(shared/engine.js, expandZips) rebuilds each full row when the file loads. ZIPs that are in no DMA file keep their
full row. Running it again on a compact file leaves it as is.

Usage: python3 data-build/compact_zip_files.py <analyzer folder> [<analyzer folder> ...]
Run it after an analyzer's build script writes data/zip/{county,metro,dma}.
"""
import json, os, re, sys, glob

AREA_KEY = re.compile(r'^(score|demand|spend|under)(@|$)')
LEVELS = ("county", "metro")


def compact(folder):
    zdir = os.path.join(folder, "data", "zip")
    base = {}
    for f in glob.glob(os.path.join(zdir, "dma", "*.json")):
        d = json.load(open(f))
        for r in d["rows"]:
            base[r["id"]] = (r, str(d["parent"]["id"]))
    before = after = done = 0
    for lv in LEVELS:
        for f in sorted(glob.glob(os.path.join(zdir, lv, "*.json"))):
            raw = open(f).read(); before += len(raw)
            d = json.loads(raw)
            if "base" in d:
                after += len(raw); continue
            rows, dmas = [], []
            for r in d["rows"]:
                b = base.get(r["id"])
                if b is None:
                    rows.append(r)          # outside every DMA: keep it whole
                    continue
                if b[1] not in dmas:
                    dmas.append(b[1])
                rows.append({"id": r["id"], "v": {k: v for k, v in r["v"].items() if AREA_KEY.match(k)}})
            out = {k: v for k, v in d.items() if k != "rows"}
            if dmas:
                out["base"] = {"level": "dma", "ids": dmas}
            out["rows"] = rows
            txt = json.dumps(out, separators=(",", ":"), ensure_ascii=False)
            after += len(txt)
            if txt != raw:                  # files whose ZIPs are all outside every DMA stay as they are
                open(f, "w").write(txt); done += 1
    print(f"{folder}: {done} files compacted, {before/1048576:.1f} MB -> {after/1048576:.1f} MB")


if __name__ == "__main__":
    for a in sys.argv[1:]:
        compact(a.rstrip("/"))
