"""Writes shared/geo/market_names.json: DMA and metro (CBSA) names by code, so the Trade area tool's Custom area can
read lines such as "Raleigh-Durham DMA" or "Charlotte metro", and the analyzers can hand a set of markets to it.
Names come from an analyzer's national DMA and metro files (the same names the rankings show).
Run:  python3 data-build/build_market_names.py"""
import json, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
def names(level):
    for folder in ("healthcare", "franchise", "legal"):
        p = os.path.join(ROOT, folder, "data", level + ".json")
        if os.path.exists(p):
            return {r["id"]: r["name"] for r in json.load(open(p))["rows"]}
    raise SystemExit("no " + level + " file found")
out = {"dma": names("dma"), "metro": names("metro")}
json.dump(out, open(os.path.join(ROOT, "shared", "geo", "market_names.json"), "w"), separators=(",", ":"), ensure_ascii=False)
print("market names:", len(out["dma"]), "DMAs,", len(out["metro"]), "metros")
