# Adtaxi Home Services Market Analyzer

Production candidate build, September 18, 2026.

## Analysis layers
- Media Market — DMA / The Ad Shop
- Market Expansion — Metro / The Operator
- Local Opportunity — County / The Branch
- Neighborhood Targeting — ZIP / The Local Pro

## Locked scoring
DMA Opportunity Score = 30% Replacement-Ready Households + 25% Category Demand + 25% Structural Category Need + 20% Market Scale.

County and ZIP Opportunity Score = 40% Replacement-Ready Households + 35% Structural Category Need + 25% Addressable Scale.

Metro Expansion uses the validated CBSA employer/contractor model.

## Service Area Radius
The user enters a center ZIP and chooses 10, 25 or 50 miles. The analyzer uses great-circle distance between ZIP centroids and includes all residential ZIPs in range, regardless of County, Metro or DMA boundaries.

## Market Conditions
Market Conditions and Industry Pulse are descriptive context and do not alter Opportunity Scores unless explicitly identified as a score input. Census Building Permits Survey is referenced as residential construction context; it measures new privately owned residential construction and is not a direct replacement-services measure. NOAA/SPC severe-weather history is contextual for roofing risk and is not currently scored.

## Deployment
Upload the contents of this package to the `/home-services/` GitHub Pages folder as one replacement set after backing up the current folder.
