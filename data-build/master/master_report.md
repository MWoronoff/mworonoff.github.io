# Master ZIP data report

Built 2026-10-13 in 3 minutes.

| Source | Status | Release | ZIPs in file | Residential ZIPs covered | Share of population covered |
| --- | --- | --- | --- | --- | --- |
| Deluxe ZIP database | kept previous file |  | 0 |  |  |
| Census ACS 5-year | kept previous file |  | 0 |  |  |
| IRS income tax statistics | kept previous file |  | 0 |  |  |
| Census ZIP Code Business Patterns | kept previous file |  | 0 |  |  |
| Census LEHD jobs (LODES) | built | 2021–2023 (latest available per state) | 33,497 | 33,371 | 99.0% |
| USDA rural-urban codes | kept previous file |  | 0 |  |  |
| CDC PLACES health estimates | kept previous file |  | 0 |  |  |
| FHFA house price index | FAILED (StopIteration: ) |  | 0 |  |  |

## Checks

- LODES: 150,573,256 jobs placed in ZIPs. States on an older year: MI wac 2021. States with no recent files (no jobs data): AK.

## Notes

- ACS, LODES and PLACES describe ZIP Code Tabulation Areas (Census areas built from ZIPs). Deluxe, IRS, Business Patterns and FHFA use USPS ZIP Codes. They join on the 5-digit code; PO-box-only and single-organization ZIPs have no ZCTA, so they show no ACS, LODES or PLACES data.
- Race and ethnicity fields are kept for description only. Don't use them to choose or exclude areas for housing, credit or employment advertising.
- To refresh Deluxe, replace the workbooks in data-build/sources/deluxe/ and run the action. The public sources refresh themselves on the monthly schedule.

## Problems

- Deluxe ZIP database: kept previous file
- Census ACS 5-year: kept previous file
- IRS income tax statistics: kept previous file
- Census ZIP Code Business Patterns: kept previous file
- USDA rural-urban codes: kept previous file
- CDC PLACES health estimates: kept previous file
- FHFA house price index: FAILED (StopIteration: )
