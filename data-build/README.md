# Analyzer data build

Step 2: shared geography layer.

- `geo/` holds the built geography tables (ZIP, county, DMA and metro) and `geography_report.md`, the check report.
- `build_geography.py` rebuilds `geo/` from the Deluxe ZIP workbooks:
  `python3 data-build/build_geography.py --deluxe-dir data-build/sources/deluxe`.
- `sources/` holds the public DMA lists and `dma_overrides.csv` (provisional Palm Springs ZIPs).
- `build_boundaries.sh` and `assign_leftovers.js` build the map shapes into `shared/geo/`. Run them through the
  "Build geography boundaries" action on GitHub; it downloads Census boundary files, so no key is needed.

## Master ZIP data

`build_zip_master.py` builds `master/`: one file per source keyed by 5-digit ZIP (Deluxe, Census ACS 5-year, IRS income
tax statistics, Census ZIP Code Business Patterns, Census LODES jobs, USDA rural-urban codes, CDC PLACES, FHFA house
prices), plus `zip_index.csv.gz`, `field_dictionary.csv` and `master_report.md`. Run it through the "Build master ZIP
data" action; it also runs on the 5th of every month and finds each public source's newest release by itself.

To refresh Deluxe, replace the ten workbooks in `sources/deluxe/` (keep one file per leading digit) and run the action.

## Local newspapers (on hold)

Newspaper coverage by ZIP is off until all circulation and web data is in. The full feature (build script, NMS workbook,
`shared/media/newspapers.json` and the page code) is saved on the `newspaper-coverage` branch. That branch's last commit is
already in main, so merging it changes nothing: re-add the feature by hand from it (commit b136ecef removed it on Nov 11, 2026),
fitting it to the compact ZIP files below.

## Compact ZIP files (Nov 2026)

Each analyzer's `data/zip/` has three sets: by DMA, by county and by metro. Only the DMA files hold full ZIP rows. County
and metro files keep, per ZIP, just the fields ranked within that area (`score@`, `demand@`, `spend@`, `under@`) and name
their DMA file(s) in `base`; the engine rebuilds the full rows when a file loads (`expandZips` in `shared/engine.js`).
ZIPs outside every DMA keep full rows. This cut about 300 MB from the site with no change to any figure.

The "Build analyzer data" action runs `compact_zip_files.py` before committing. After running an analyzer's build script
by hand, run it yourself: `python3 data-build/compact_zip_files.py <analyzer folder>`. It is safe to run twice.

## National ZIP view (Nov 2026)

`build_us_top_zips.py` writes `<analyzer>/data/zip_us.json`: for every line, the 50 highest-scoring ZIPs in the
country, scored with the line's own ZIP formula (`cfg.zipScore` in the analyzer page) but with each input ranked against
all ranked U.S. ZIPs instead of within one market. The analyzer's **ZIP** button (level `uszip`, between County and
ZIPs in market) lists them: Top 10, 25 or 50, a dot per ZIP on the map, and Open in its market. It reads only the published DMA ZIP files and page configs, needs no
downloads, and runs in the analyzer data action after the builds (about 10 seconds). By hand:
`python3 data-build/build_us_top_zips.py [analyzer folder ...]`.
