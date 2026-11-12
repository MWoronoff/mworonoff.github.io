# Travel data check report

Built 2026-11-12. Result: **PASSED**

| Check | Result | Detail |
| --- | --- | --- |
| Formula tests | PASS | percentile and weighted-average hand checks reproduce exactly |
| Land area source | INFO | Census 2026 Gazetteer ZCTA file (33,791 ZIPs) |
| EASI U.S. lodging on out-of-town trips per household | INFO | $912.17 |
| EASI U.S. other lodging per household | INFO | $1,448.38 |
| EASI U.S. public and other transportation per household | INFO | $1,240.24 |
| State gambling spending per U.S. household | INFO | $1,622.28 (from per-person figures x population) |
| EASI travel spending matched to DMAs | PASS | 210 of 210 |
| EASI travel spending matched to metros | PASS | 387 of 387 |
| State gambling spending, U.S. total vs. the file's own U.S. total | PASS | 97.9% |
| EASI lodging on out-of-town trips, DMAs vs. EASI's own total | PASS | 98.7% |
| EASI other lodging, DMAs vs. EASI's own total | PASS | 98.7% |
| EASI public and other transportation, DMAs vs. EASI's own total | PASS | 98.7% |
| U.S. share of households earning $100k+ | PASS | 40.5% (expected 30%–48%) |
| U.S. share of households earning $75k+ | PASS | 53.1% (expected 42%–62%) |
| U.S. share of households earning $150k+ | PASS | 23.0% (expected 14%–26%) |
| U.S. households with children | PASS | 29.5% (expected 25%–35%) |
| U.S. adults 35–64 (share of adults) | PASS | 48.7% (expected 44%–56%) |
| U.S. adults 55+ (share of adults) | PASS | 38.3% (expected 30%–42%) |
| U.S. adults 45+ (share of adults) | PASS | 53.9% (expected 46%–58%) |
| U.S. adults 25–54 (share of adults) | PASS | 50.0% (expected 42%–56%) |
| U.S. adults 25–64 (share of adults) | PASS | 66.2% (expected 60%–72%) |
| DMA scores within 0–100 | PASS | 0 out of range; 1,260 computed, 0 not computed (missing input) |
| Metro scores within 0–100 | PASS | 0 out of range; 2,322 computed, 0 not computed (missing input) |
| Top DMAs: Hotels and lodging | INFO | San Francisco-Oakland-San Jose, Washington, Dc-Hagrstwn, Los Angeles, Seattle-Tacoma, New York |
| Top DMAs: Resorts | INFO | Los Angeles, Washington, Dc-Hagrstwn, Dallas-Fort Worth, San Francisco-Oakland-San Jose, Houston |
| Top DMAs: Cruises | INFO | New York, Boston, San Francisco-Oakland-San Jose, Philadelphia, Hartford-New Haven |
| Top DMAs: Casinos | INFO | Washington, Dc-Hagrstwn, Atlanta, San Francisco-Oakland-San Jose, Los Angeles, Seattle-Tacoma |
| Top DMAs: Tour operators | INFO | Boston, New York, Philadelphia, West Palm Beach-Ft Pierce, Honolulu |
| Top DMAs: Visitors bureaus | INFO | Los Angeles, Washington, Dc-Hagrstwn, Dallas-Fort Worth, Salt Lake City, San Francisco-Oakland-San Jose |
| Counties built from ZIPs | PASS | 3,144 counties (2,400 with 10,000+ residents are ranked) |
| County scores within 0–100 | PASS | 0 out of range; 14,400 scores computed |
