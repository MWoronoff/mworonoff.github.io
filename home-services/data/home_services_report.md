# Home Services data check report

Built 2026-10-13. Result: **PASSED**

| Check | Result | Detail |
| --- | --- | --- |
| Formula tests | PASS | percentile, weighted-average, degree-day and NOAA state-code hand checks reproduce exactly |
| Land area source | INFO | Census 2026 Gazetteer ZCTA file (33,791 ZIPs) |
| Climate source | INFO | NOAA county degree-day files (climdiv-hddccy-v1.0.0-20261006, climdiv-cddccy-v1.0.0-20261006); years 2016–2025 |
| Hail source | INFO | NOAA Storm Events, hail 1-inch+ by county, 2016–2025; 35,459 county-days with hail |
| ZIPs with NOAA climate data | INFO | 99.3% of population; none for AK, HI (NOAA's county climate files skip Alaska and Hawaii) |
| Climate sense check: Miami-Dade has more cooling and less heating than Minneapolis (Hennepin) | PASS | cooling 4,708 vs 759; heating 122 vs 7,564 |
| Hail sense check: Dallas County has more 1-inch hail days than Los Angeles County | PASS | 5.5 vs 0.4 a year |
| Business Patterns years | INFO | 2023 (growth measured from 2022) |
| Published benchmark: roofing contractors | PASS | 24,373 (expected 15,000–45,000) |
| Published benchmark: electrical contractors | PASS | 82,499 (expected 50,000–110,000) |
| Published benchmark: plumbing, heating and air-conditioning contractors | PASS | 110,542 (expected 70,000–140,000) |
| Published benchmark: painting and wall covering contractors | PASS | 37,219 (expected 25,000–70,000) |
| Published benchmark: flooring contractors | PASS | 16,996 (expected 9,000–35,000) |
| EASI home spending markets matched | PASS | 925 metro and micro areas (expected 925) |
| EASI U.S. spending per household (metro and micro areas) | INFO | hvac $245.76; roof $186.34; plumb $125.78 |
| Households in an EASI metro or micro area | INFO | 94.4% (the rest are rural ZIPs outside any metro or micro area; DMA spending averages the covered households) |
| EASI painting and flooring DMAs matched | PASS | 209 of 209 |
| EASI Palm Springs (painting and flooring) | INFO | EASI includes Palm Springs in Los Angeles, so the provisional Palm Springs DMA uses the Los Angeles rate |
| EASI U.S. painting and flooring spending per household | INFO | paint $94.48; floor $51.73; paintsup $17.79 |
| HVAC validation, DMAs: rank correlation with contractor employees per 1,000 households | INFO | before (degree days summed, home age): 0.14 (without Competition 0.36); A: fixes, standard 40/25/15/20: 0.32 (without Competition 0.56); A2: fixes + climate x2, standard 40/25/15/20: 0.31 (without Competition 0.56); C: fixes + climate x2, 48/17/15/20: 0.29 (without Competition 0.56); B: fixes + climate x2, 55/10/15/20: 0.26 (without Competition 0.54) |
| HVAC validation, metros: rank correlation with contractor employees per 1,000 households | INFO | before (degree days summed, home age): 0.09 (without Competition 0.32); A: fixes, standard 40/25/15/20: 0.22 (without Competition 0.45); A2: fixes + climate x2, standard 40/25/15/20: 0.21 (without Competition 0.45); C: fixes + climate x2, 48/17/15/20: 0.20 (without Competition 0.45); B: fixes + climate x2, 55/10/15/20: 0.18 (without Competition 0.44) |
| Score reality check, DMAs: rank correlation with contractors' employees per 1,000 households, score (without Competition) | INFO | Any home service 0.02 (0.36); HVAC 0.33 (0.54); Roofing and gutters -0.08 (0.28); Plumbing 0.20 (0.42); Electrical 0.35 (0.52); Painting and wallpaper 0.38 (0.61); Flooring 0.01 (0.36). None weak. |
| Score reality check, metros: rank correlation with contractors' employees per 1,000 households, score (without Competition) | INFO | Any home service 0.00 (0.33); HVAC 0.24 (0.45); Roofing and gutters -0.09 (0.26); Plumbing 0.12 (0.34); Electrical 0.24 (0.42); Painting and wallpaper 0.22 (0.49); Flooring 0.01 (0.32). None weak. |
| DMA scores within 0–100 | PASS | 0 out of range; 1,470 scores computed, 0 not computed (missing input) |
| Metro scores within 0–100 | PASS | 0 out of range; 2,709 scores computed, 0 not computed (missing input) |
| EASI spending matched to metros | PASS | 387 of 387 |
| DMAs where under half the households are in an EASI area | INFO | 4: 537, 552, 631, 798 |
| EASI painting total, DMAs vs. EASI's own total | PASS | 96.7% |
| EASI heat, a/c and electrical total, metros vs. EASI's own metro totals | PASS | 96.7% |
| DMA roll-up matches county totals: Any home service | PASS | DMAs 271,541 vs counties 271,575 |
| DMA roll-up matches county totals: HVAC | PASS | DMAs 110,503 vs counties 110,521 |
| DMA roll-up matches county totals: Roofing and gutters | PASS | DMAs 24,369 vs counties 24,373 |
| DMA roll-up matches county totals: Plumbing | PASS | DMAs 110,503 vs counties 110,521 |
| DMA roll-up matches county totals: Electrical | PASS | DMAs 82,468 vs counties 82,472 |
| DMA roll-up matches county totals: Painting and wallpaper | PASS | DMAs 37,205 vs counties 37,213 |
| DMA roll-up matches county totals: Flooring | PASS | DMAs 16,996 vs counties 16,996 |
| U.S. own share | PASS | 65.2% (expected 58%–70%) |
| U.S. pre1980 share | PASS | 48.2% (expected 35%–56%) |
| U.S. sfd share | PASS | 82.3% (expected 74%–90%) |
| U.S. lt share | PASS | 48.2% (expected 30%–60%) |
| U.S. val300 share | PASS | 55.0% (expected 30%–65%) |
| U.S. household-weighted HDD | PASS | 3,954 (expected 3,000–6,000) |
| U.S. household-weighted CDD | PASS | 1,594 (expected 900–2,600) |
| U.S. household-weighted 1-inch hail days | INFO | 1.3 a year |
| U.S. households per square mile | PASS | 45.0 (expected 25–50) |
| Density sense check: New York DMA is far denser than the U.S. | PASS | 721 vs 45 households per square mile |
| Counties built from ZIPs | PASS | 3,144 counties (3,100 with 1,000+ residents are ranked) |
| County scores within 0–100 | PASS | 0 out of range; 21,700 scores computed |
