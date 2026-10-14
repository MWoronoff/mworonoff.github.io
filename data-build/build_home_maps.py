"""Build the county map data for the analyzer home page (analyzers/home-maps.json).

Draws every lower-48 county once as a compact SVG path (Albers equal-area projection, simplified), plus state
outlines, and stores each category's county Market Potential Score as a class 0-4 (fifths of counties) so the page
can color the same shapes for any category. Rerun after the analyzers' county data is rebuilt.
"""
import json, math, os
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SKIP = {"02", "15", "60", "66", "69", "72", "78"}   # Alaska, Hawaii and territories: not drawn on this map
CATS = [  # (key used by the page, analyzer folder, score field)
    ("healthcare", "healthcare", "score@hearing"),
    ("legal", "legal", "score@estate"),
    ("higher-ed", "higher-ed", "score@fouryear"),
    ("home-services", "home-services", "score@any"),
    ("furniture", "furniture-analyzer", "score@any"),
    ("apartments", "apartment-analyzer", "score@student"),
    ("financial", "financial", "score@wealth"),
]

def albers(lon, lat):
    p0, l0, p1, p2 = map(math.radians, (37.5, -96.0, 29.5, 45.5))
    n = (math.sin(p1) + math.sin(p2)) / 2
    C = math.cos(p1) ** 2 + 2 * n * math.sin(p1)
    r0 = math.sqrt(C - 2 * n * math.sin(p0)) / n
    p, l = math.radians(lat), math.radians(lon)
    r = math.sqrt(C - 2 * n * math.sin(p)) / n
    t = n * (l - l0)
    return r * math.sin(t), r0 - r * math.cos(t)

def decode(topo, objname):
    sc, tr = topo["transform"]["scale"], topo["transform"]["translate"]
    arcs = []
    for a in topo["arcs"]:
        x = y = 0; pts = []
        for dx, dy in a:
            x += dx; y += dy; pts.append((x * sc[0] + tr[0], y * sc[1] + tr[1]))
        arcs.append(pts)
    def ring(ids):
        out = []
        for i in ids:
            pts = arcs[i] if i >= 0 else arcs[~i][::-1]
            out.extend(pts if not out else pts[1:])
        return out
    for g in topo["objects"][objname]["geometries"]:
        polys = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"] if g["type"] == "MultiPolygon" else []
        yield g.get("properties") or {}, [[ring(r) for r in poly] for poly in polys]

def project(polys):
    shapes = []
    for poly in polys:
        rings = [[albers(lon, lat) for lon, lat in r] for r in poly if len(r) >= 4]
        if rings:
            p = Polygon(rings[0], rings[1:]).buffer(0)
            if not p.is_empty: shapes.append(p)
    return unary_union(shapes) if shapes else None

def main():
    counties, states = [], []
    for props, polys in decode(json.load(open(os.path.join(ROOT, "shared/geo/county.topo.json"))), "county"):
        f = props.get("fips")
        if not f or f[:2] in SKIP: continue
        g = project(polys)
        if g is not None: counties.append((f, g))
    for props, polys in decode(json.load(open(os.path.join(ROOT, "shared/geo/states.topo.json"))), "states"):
        if props.get("st") in SKIP: continue
        g = project(polys)
        if g is not None: states.append(g)
    allg = unary_union([g for _, g in counties])
    minx, miny, maxx, maxy = allg.bounds
    W = 975; k = W / (maxx - minx); H = round((maxy - miny) * k)
    def path(g, tol):
        g = g.simplify(tol / k, preserve_topology=True)
        parts = []
        for p in (g.geoms if isinstance(g, MultiPolygon) else [g]):
            for r in [p.exterior] + list(p.interiors):
                pts = [(round((x - minx) * k, 1), round((maxy - y) * k, 1)) for x, y in r.coords]
                if len(pts) < 4: continue
                d = "M%g %g" % pts[0]; px, py = pts[0]
                for x, y in pts[1:-1]:
                    dx, dy = round(x - px, 1), round(y - py, 1)
                    if dx or dy: d += "l%g %g" % (dx, dy); px, py = px + dx, py + dy
                parts.append(d + "z")
        return "".join(parts)
    out = {"w": W, "h": H, "fips": [f for f, _ in counties], "paths": [path(g, 0.55) for _, g in counties],
           "states": path(unary_union(states), 0.4), "cats": {},
           "cx": [round((g.centroid.x - minx) * k) for _, g in counties]}
    for key, folder, field in CATS:
        rows = json.load(open(os.path.join(ROOT, folder, "data/county.json")))["rows"]
        vals = {r["id"]: r["v"].get(field) for r in rows}
        have = sorted(v for f, v in vals.items() if v is not None and f[:2] not in SKIP)
        cuts = [have[int(len(have) * q / 5)] for q in (1, 2, 3, 4)]
        cls = []
        for f in out["fips"]:
            v = vals.get(f)
            cls.append(-1 if v is None else sum(v >= c for c in cuts))
        out["cats"][key] = "".join("x" if c < 0 else str(c) for c in cls)
    # TV + Digital Video: outline of the DMAs the allocation analyzer covers
    tv = {m["dma_code"] for m in json.load(open(os.path.join(ROOT, "TV/data/markets.json")))["markets"]}
    dt = json.load(open(os.path.join(ROOT, "shared/geo/dma.topo.json")))
    dmas = [project(polys) for props, polys in decode(dt, list(dt["objects"])[0]) if str(props.get("dma_code") or "") in tv]
    dmas = [g for g in dmas if g is not None]
    out["tv"] = path(unary_union(dmas), 0.5); out["tvCount"] = len(dmas)
    # ZIP radius illustration: Denver-area ZIPs around 80222, shaded by distance band (local flat projection)
    zj = json.load(open(os.path.join(ROOT, "crm-analyzer/data/zips.json")))
    zc = {r[zj["cols"].index("zip")]: (r[zj["cols"].index("lon")], r[zj["cols"].index("lat")]) for r in zj["rows"]}
    clon, clat = zc["80222"]; kx = 69.17 * math.cos(math.radians(clat)); ky = 69.0
    zt = json.load(open(os.path.join(ROOT, "shared/geo/zip/dma/751.json")))
    zips = []
    for props, polys in decode(zt, list(zt["objects"])[0]):
        z = props.get("zip")
        if z not in zc: continue
        d = math.hypot((zc[z][0] - clon) * kx, (zc[z][1] - clat) * ky)
        if d > 30: continue
        shapes = [Polygon([((lon - clon) * kx, (clat - lat) * ky) for lon, lat in poly[0]]).buffer(0) for poly in polys if len(poly[0]) >= 4]
        g = unary_union(shapes)
        if not g.is_empty: zips.append((d, g))
    R = 26.0; rk = 200 / R   # 26-mile window drawn in a 400 x 400 box centered on the store
    def lpath(g):
        g = g.simplify(0.08, preserve_topology=True); parts = []
        for pg in (g.geoms if hasattr(g, "geoms") else [g]):
            if not hasattr(pg, "exterior"): continue
            pts = [(round(x * rk + 200, 1), round(y * rk + 200, 1)) for x, y in pg.exterior.coords]
            parts.append("M" + "L".join("%g %g" % q for q in pts[:-1]) + "z")
        return "".join(parts)
    out["radius"] = [[min(3, int(d // 5)), lpath(g)] for d, g in zips if d <= 32]
    dest = os.path.join(ROOT, "analyzers/home-maps.json")
    json.dump(out, open(dest, "w"), separators=(",", ":"))
    print("wrote", dest, os.path.getsize(dest) // 1024, "KB,", len(out["fips"]), "counties,", W, "x", H)

if __name__ == "__main__":
    main()
