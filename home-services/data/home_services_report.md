# Home Services data check report

Built 2026-10-12. Result: **PASSED**

| Check | Result | Detail |
| --- | --- | --- |
| Formula tests | PASS | percentile, weighted-average, degree-day and NOAA state-code hand checks reproduce exactly |
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
