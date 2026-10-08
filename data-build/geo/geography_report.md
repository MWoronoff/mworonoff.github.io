# Geography layer check report

Result: **PASSED** (8 pass, 1 for review, 0 fail)

| Check | Result | Detail |
| --- | --- | --- |
| One row per ZIP | PASS | 41,558 ZIPs, 0 duplicates |
| Scope | INFO | Kept 40,745 ZIPs in 50 states + DC; excluded 599 military and 214 territory ZIPs |
| Every ZIP has exactly one county, metro status and DMA | PASS | 99.3% of population matched to a DMA by ZIP; 216 ZIPs filled from their county; 0 without a DMA |
| Each county sits in one metro (OMB metros are whole counties) | PASS | 0 counties have ZIPs pointing to more than one CBSA; 0 people (0.00%) sit in the minority part. Counties use their majority CBSA. |
| Metro definitions are current (OMB Bulletin 23-01) | PASS | Whole file: 393 metros and 542 micros, matching OMB 2023's 393 and 542 (including Puerto Rico); 387 metros fall in 50 states + DC |
| Split counties | INFO | 26 counties are divided between DMAs by ZIP; largest: Riverside CA, Santa Clara CA, Kern CA, Monroe NY, Western Ct CT |
| All 210 DMAs present | PASS | 210 DMAs; 145,693 people in remote Alaska boroughs Nielsen leaves outside any DMA |
| Manual DMA overrides | REVIEW | 28 Coachella Valley ZIPs moved from Los Angeles to Palm Springs (804), which the public list omits; 468,943 people. Provisional until checked against a Nielsen source |
| Spot check: top 10 DMAs by households match Nielsen's published top 10 markets | PASS | 1. New York; 2. Los Angeles; 3. Chicago; 4. Philadelphia; 5. Dallas-Fort Worth; 6. San Francisco-Oakland-San Jose; 7. Atlanta; 8. Washington, Dc-Hagrstwn; 9. Boston; 10. Houston |
| Roll-up totals: ZIP = county = DMA = national | PASS | Population 331,438,416; households 126,815,211 |
| Published benchmark: national population | PASS | 331.4 million vs. about 332 million in the Census ACS 5-year national total |
| Cross-check against the 2021 county list | INFO | 3,066 counties compared; 80 disagree, holding 1,623,922 people (0.49%). The 2026 list is used; all are in dma_disagreements.csv |

## Largest DMA disagreements with the 2021 list

| County | 2026 list (used) | 2021 list | Population |
| --- | --- | --- | --- |
| Solano, CA | Sacramento-Stockton-Modesto | San Francisco-Oakland-San Jose | 452,078 |
| Franklin, PA | Harrisburg-Lancaster-Lebanon-York | Washington, Dc-Hagrstwn | 145,577 |
| Athens, OH | Columbus, Oh | Charleston-Huntington | 67,967 |
| Gibson, TN | Jackson, Tn | Memphis | 56,041 |
| Orange, VA | Charlottesville | Richmond-Petersburg | 46,654 |
| Phelps, MO | Saint Louis | Springfield, Mo | 46,106 |
| Auglaize, OH | Lima | Dayton | 45,348 |
| Guernsey, OH | Columbus, Oh | Wheeling-Steubenville | 39,085 |
| Putnam, OH | Lima | Toledo | 35,849 |
| Nicollet, MN | Mankato | Minneapolis-Saint Paul | 33,696 |
| Dorchester, MD | Salisbury | Baltimore | 31,372 |
| Fluvanna, VA | Charlottesville | Richmond-Petersburg | 27,224 |
| Gillespie, TX | Austin | San Antonio | 26,836 |
| Fannin, GA | Atlanta | Chattanooga | 25,501 |
| Johnson, AR | Fort Smith-Fay-Sprngdl | Little Rock-Pine Bluff | 24,554 |

Sources: Deluxe ZIP file (Q4 2025); ZIP-level DMA list, github.com/BritCrit/dma_county_zip (March 2026); county DMA list, github.com/alex-patton/US-TVDMA-BY-COUNTY (2021, cross-check only).
