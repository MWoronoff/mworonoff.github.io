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

## Local newspapers

`build_newspapers.py` builds `shared/media/newspapers.json` from the NMS circulation-by-ZIP export
(`sources/newspapers/nms_circulation_by_zip.xlsx`, sheet "By ZIP"): every paper and edition, copies by reported day for each
ZIP, with county, metro and DMA totals (ZIPs assigned through `shared/geo/zip_market.json`). Copies with no ZIP (e-edition
"Digital Replica" and "all other" lines) are kept per paper and shown only as a note at the paper's home DMA. Papers under 50%
paid copies are labeled "Mostly non-paid". The analyzers work out % of households on the page from their own household counts.

Web: add CSV files to `sources/newspapers/web/` with columns `paper` (the display name, e.g. The Denver Post, or the NMS
member name), `zip`, `uniques` (monthly unique visitors) and optional `month`. Gross = the main print day (Sunday) + web uniques.

To refresh: replace the workbook (and web files), run `python3 data-build/build_newspapers.py`, and commit.
