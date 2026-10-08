# Analyzer data build

Step 2: shared geography layer.

- `geo/` holds the built geography tables (ZIP, county, DMA and metro) and `geography_report.md`, the check report.
- `build_geography.py` rebuilds `geo/` from the Deluxe ZIP workbooks. The workbooks are licensed vendor files and are
  not stored in this repo; run it locally with `python3 data-build/build_geography.py --deluxe-dir <folder>`.
- `sources/` holds the public DMA lists and `dma_overrides.csv` (provisional Palm Springs ZIPs).
- `build_boundaries.sh` and `assign_leftovers.js` build the map shapes into `shared/geo/`. Run them through the
  "Build geography boundaries" action on GitHub; it downloads Census boundary files, so no key is needed.
