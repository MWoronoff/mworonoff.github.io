# Master ZIP data report

Built 2026-10-13 in 13 minutes.

| Source | Status | Release | ZIPs in file | Residential ZIPs covered | Share of population covered |
| --- | --- | --- | --- | --- | --- |
| Deluxe ZIP database | built | Deluxe ZIP database, update dated 10/01/2025 | 41,558 |  |  |
| Census ACS 5-year | built | ACS 5-year 2020–2024 | 33,772 | 33,621 | 100.0% |
| IRS income tax statistics | built | tax year 2022 | 27,588 | 27,585 | 98.0% |
| Census ZIP Code Business Patterns | built | 2023 | 34,954 | 30,797 | 98.8% |
| Census LEHD jobs (LODES) | built | 2021–2023 (latest available per state) | 33,497 | 33,371 | 99.0% |
| USDA rural-urban codes | built | 2020 codes | 41,146 | 33,623 | 100.0% |
| CDC PLACES health estimates | built | PLACES: ZCTA Data (GIS Friendly Format), 2025 release | 32,520 | 32,517 | 99.0% |
| FHFA house price index | built | annual index through 2025 | 15,772 | 15,769 | 87.8% |

## Checks

- Deluxe: 10 workbooks, 41,558 ZIPs (33,623 residential, 334,723,696 people); 0 duplicate rows dropped.
- ACS: 41 tables, 835 columns. Age lines that don't add up to total population: 0 ZCTAs. Income bands that don't add up to households: 0 ZCTAs. Labels: table shells.
- IRS: 153,922,620 returns across 27,588 ZIPs.
- Business Patterns: 8,356,295 establishments; 772,314 ZIP-by-industry rows.
- LODES: 150,573,256 jobs placed in ZIPs. States on an older year: MI wac 2021. States with no recent files (no jobs data): AK.
- PLACES: 40 measures.

## Notes

- ACS, LODES and PLACES describe ZIP Code Tabulation Areas (Census areas built from ZIPs). Deluxe, IRS, Business Patterns and FHFA use USPS ZIP Codes. They join on the 5-digit code; PO-box-only and single-organization ZIPs have no ZCTA, so they show no ACS, LODES or PLACES data.
- Race and ethnicity fields are kept for description only. Don't use them to choose or exclude areas for housing, credit or employment advertising.
- To refresh Deluxe, replace the workbooks in data-build/sources/deluxe/ and run the action. The public sources refresh themselves on the monthly schedule.
