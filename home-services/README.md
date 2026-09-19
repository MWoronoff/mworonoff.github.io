# Home Services Market Analyzer v1.7.0 Production

Validated production baseline for the GitHub Pages Home Services Market Analyzer.

## Locked analysis levels
- Media Market - DMA — The Ad Shop
- Market Expansion - Metro — The Operator
- Local Opportunity - County — The Branch
- Neighborhood Targeting - ZIP — The Local Pro
- Categories: HVAC, Roofing, Windows & Doors

## Validated map behavior
- DMA uses the working Leaflet HTML/DOM-marker architecture and a national U.S. view.
- Metro focuses dynamically on the selected metro at a regional scale.
- County focuses dynamically on the selected county/metro context.
- ZIP preserves the localized neighborhood/service-area behavior.
- The complete validated 83-market DMA universe and deterministic coordinate crosswalk are retained.

## Production freeze
The source data, scoring formulas, rankings, controls, terminology, branding, and ZIP-radius calculations are frozen in this baseline. Future optimization or accessibility work should be developed as a separate release and tested against this package before production replacement.

Upload the six files in this package together: `index.html`, `app.js`, `styles.css`, `logo.png`, `README.md`, and `VERSION.txt`.
