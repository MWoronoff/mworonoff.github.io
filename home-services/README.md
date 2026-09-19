# Home Services Market Analyzer v1.6.0

Production-stabilized GitHub Pages build.

## Locked interface
- Media Market - DMA — The Ad Shop
- Market Expansion - Metro — The Operator
- Local Opportunity - County — The Branch
- Neighborhood Targeting - ZIP — The Local Pro
- Categories: HVAC, Roofing, Windows & Doors

## Stabilization fixes
- DMA national map uses a deterministic 83-market representative-centroid crosswalk instead of fuzzy name matching.
- DMA map plots the complete validated DMA universe; Top/Bottom and Show controls continue to govern rankings/charts.
- Metro, County and ZIP maps retain their progressive local focus and ZIP-radius behavior.
- Approved Adtaxi logo is a standalone transparent PNG: round green circle, white knockout letters, no black/white box or crescent.
- Existing scoring formulas, source data, rankings and analysis labels are preserved.

Upload all runtime files (`index.html`, `app.js`, `styles.css`, `logo.png`) together. `README.md` and `VERSION.txt` document the release.


## v1.6.2
- DMA national map uses Leaflet HTML divIcon markers in the standard marker pane, bypassing SVG/Canvas overlay issues.
- All 83 DMA coordinate mappings retained; selected DMA is visually emphasized.
- Approved Adtaxi logo enlarged in the header.
- No scoring, data, ranking, Metro/County/ZIP, or radius logic changed.

## v1.6.3
- Freezes the working DMA DOM-marker architecture.
- Strengthens DMA marker visibility and selected-market emphasis.
- Tightens Metro framing around the selected metro.
- Tightens County framing around the selected county/metro context.
- Preserves the approved ZIP/service-area map behavior.
- Enlarges the approved Adtaxi logo treatment without changing the asset.
- Standardizes user-facing score labels across DMA, Metro, County and ZIP.
- No source data, scoring formulas, rankings, or ZIP-radius calculations changed.


## v1.6.4 viewport correction
Metro and County views now re-apply their selected-geography viewport after Leaflet container sizing settles. DMA and ZIP map behavior are unchanged. No data or scoring changes.
