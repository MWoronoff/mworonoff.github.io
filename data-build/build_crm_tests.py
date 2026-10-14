"""Builds crm-analyzer/test/: synthetic customer files with known answers, for testing the Customer Market Analyzer.

Each file plants a pattern (which kinds of ZIPs buy more, and how fast customers fall off with distance) on real ZIP
data from crm-analyzer/data/. tests.json lists each test's setup and its hidden answer.

  python3 data-build/build_crm_tests.py
"""
import csv, json, math, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(os.path.dirname(HERE), "crm-analyzer", "data")
OUT = os.path.join(os.path.dirname(HERE), "crm-analyzer", "test")

z = json.load(open(os.path.join(D, "zips.json")))
Z = {r[0]: dict(zip(z["cols"], r)) for r in z["rows"]}
F = {}
for st in os.listdir(os.path.join(D, "st")):
    j = json.load(open(os.path.join(D, "st", st)))
    for k, v in j["rows"].items():
        F[k] = dict(zip(j["keys"], v))


def miles(a, b):
    t = math.pi / 180
    s = math.sin((b["lat"] - a["lat"]) * t / 2) ** 2 + math.cos(a["lat"] * t) * math.cos(b["lat"] * t) * math.sin((b["lon"] - a["lon"]) * t / 2) ** 2
    return 2 * 3958.8 * math.asin(min(1, math.sqrt(s)))


def pois(lam, rnd):
    if lam > 30:
        return max(0, int(round(rnd.gauss(lam, math.sqrt(lam)))))
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rnd.random()
        if p <= L:
            return k
        k += 1


g = lambda f, k: f.get(k) or 0
TESTS = [
    dict(id="phoenix-family", title="Phoenix family entertainment center", stores=["85018", "85226", "85383"], maxd=40, half=7,
         rate=0.004, aff=lambda f: (g(f, "hh_kids") / 30) ** 2, amount=(25, 220), n=None, seed=11,
         setup="A family entertainment business with three Phoenix-area locations. Enter all three ZIPs as locations.",
         answer="Customers come from ZIPs with many households with children (affinity rises with the square of the share). "
                "Customer rates halve about every 7 miles from the nearest location.",
         look="The strongest-ZIP profile should lead with households with children, kids' age groups or larger households, and "
              "the top look-alikes should be family-heavy suburbs."),
    dict(id="montana-rural", title="Helena, Montana farm and ranch supply", stores=["59601"], maxd=120, half=24,
         rate=0.01, aff=lambda f: (g(f, "own") / 70) ** 1.5 * ((g(f, "veh_3plus") + 5) / 30), amount=(80, 1500), n=None, seed=12,
         setup="A rural supply store in Helena (59601) with customers spread over long distances.",
         answer="Customers come from ZIPs with high homeownership and many households with 3+ vehicles. "
                "Customer rates halve about every 24 miles.",
         look="Expect many ZIPs marked 'too few to judge'; that's normal for a sparse rural market. The profile should "
              "feature 3+ vehicles and homeownership."),
    dict(id="atlanta-small", title="Atlanta tutoring service (small list)", stores=["30319"], maxd=30, half=5.5,
         rate=0.003, aff=lambda f: (g(f, "ed_bachelors") / 40) ** 1.5, amount=(150, 900), n=150, seed=13,
         setup="A tutoring business in Brookhaven (30319) with only 150 customers.",
         answer="Customers come from ZIPs with many college-educated adults. Customer rates halve about every 5.5 miles.",
         look="With only 150 customers the tool uses the top-performing fifth of ZIPs for the profile. Expect education, "
              "income or home value near the top; they move together."),
    dict(id="florida-retirees", title="Palm Beach County hearing clinic", stores=["33480"], maxd=35, half=7,
         rate=0.005, aff=lambda f: (g(f, "age_65p") / 20) ** 1.5 * (g(f, "own") / 65), amount=(500, 4500), n=None, seed=14,
         setup="A hearing clinic in Palm Beach (33480). Try 'Adults 65+' as the potential, then 'Households', and compare.",
         answer="Customers come from ZIPs with many adults 65+ who own their homes. Customer rates halve about every 7 miles.",
         look="With 'Households' as potential, the profile should lead with age 65+, median age or Social Security income. "
              "With 'Adults 65+' as potential, the age effect is already built into expected customers, so fewer ZIPs "
              "over-perform and homeownership stands out more."),
    dict(id="dallas-no-pattern", title="Dallas delivery service (no pattern)", stores=["75201"], maxd=30, half=None,
         rate=0.002, aff=lambda f: 1.0, amount=(20, 120), n=None, seed=15,
         setup="A delivery business in downtown Dallas (75201).",
         answer="There is no pattern: customers were spread purely by household count, with no distance effect.",
         look="The tool should say distance makes little difference, mark only a handful of ZIPs over or under (chance), and "
              "label the strongest-ZIP profile as tentative."),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    for t in TESTS:
        rnd = random.Random(t["seed"])
        rows = []
        for zz, zr in Z.items():
            f = F.get(zz)
            if not f:
                continue
            d = min(miles(zr, Z[s]) for s in t["stores"])
            if d > t["maxd"]:
                continue
            decay = math.exp(-d * math.log(2) / t["half"]) if t["half"] else 1.0
            lam = zr["hh"] * t["rate"] * decay * t["aff"](f)
            for _ in range(pois(lam, rnd)):
                rows.append([f"Customer {len(rows) + 1}", zz, round(rnd.uniform(*t["amount"]), 2)])
        if t["n"] and len(rows) > t["n"]:
            rnd.shuffle(rows)
            rows = rows[: t["n"]]
        rnd.shuffle(rows)
        with open(os.path.join(OUT, t["id"] + ".csv"), "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["Customer", "ZIP", "Sales"])
            w.writerows(rows)
        manifest.append({k: t[k] for k in ("id", "title", "stores", "setup", "answer", "look")} | {"customers": len(rows), "file": t["id"] + ".csv"})
        print(f"{t['id']}: {len(rows)} customers")
    json.dump({"tests": manifest}, open(os.path.join(OUT, "tests.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
