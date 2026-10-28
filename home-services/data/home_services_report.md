# Home Services data check report

Built 2026-10-28. Result: **PASSED**

| Check | Result | Detail |
| --- | --- | --- |
| Formula tests | PASS | percentile, weighted-average, degree-day and NOAA state-code hand checks reproduce exactly |
| Land area source | INFO | Census 2026 Gazetteer ZCTA file (33,791 ZIPs) |
| Climate source | INFO | NOAA county degree-day files (climdiv-hddccy-v1.0.0-20261006, climdiv-cddccy-v1.0.0-20261006); years 2016–2025 |
| Hail source | INFO | NOAA Storm Events, hail 1-inch+ by county, 2016–2025; 35,459 county-days with hail |
| Alaska and Hawaii climate normals | PASS | NOAA 1991-2020 station normals: Honolulu 0 HDD / 4,767 CDD; Hilo 0 HDD / 3,283 CDD; Kahului 0 HDD / 4,423 CDD; Lihue 0 HDD / 4,124 CDD; Anchorage 9,979 HDD / 8 CDD; Fairbanks 13,420 HDD / 68 CDD; Juneau 8,335 HDD / 3 CDD; 35 counties filled |
| ZIPs with NOAA climate data | INFO | 100.0% of population; none for nobody (Alaska and Hawaii come from NOAA station normals when available) |
| Climate sense check: Miami-Dade has more cooling and less heating than Minneapolis (Hennepin) | PASS | cooling 4,708 vs 759; heating 122 vs 7,564 |
| Hail sense check: Dallas County has more 1-inch hail days than Los Angeles County | PASS | 5.5 vs 0.4 a year |
| Business Patterns years | INFO | 2023 (growth measured from 2022) |
| Published benchmark: roofing contractors | PASS | 25,519 (expected 15,000–45,000) |
| Published benchmark: electrical contractors | PASS | 83,335 (expected 50,000–110,000) |
| Published benchmark: plumbing, heating and air-conditioning contractors | PASS | 111,206 (expected 70,000–140,000) |
| Published benchmark: painting and wall covering contractors | PASS | 38,280 (expected 25,000–70,000) |
| Published benchmark: flooring contractors | PASS | 17,989 (expected 9,000–35,000) |
| EASI home spending markets matched | PASS | 925 metro and micro areas (expected 925) |
| EASI U.S. spending per household (metro and micro areas) | INFO | hvac $245.76; roof $186.34; plumb $125.78 |
| Households in an EASI metro or micro area | INFO | 94.5% (the rest are rural ZIPs outside any metro or micro area; DMA spending averages the covered households) |
| EASI painting and flooring DMAs matched | PASS | 209 of 209 |
| EASI Palm Springs (painting and flooring) | INFO | EASI includes Palm Springs in Los Angeles, so the provisional Palm Springs DMA uses the Los Angeles rate |
| EASI U.S. painting and flooring spending per household | INFO | paint $94.48; floor $51.73; paintsup $17.79 |
| HVAC validation, DMAs: rank correlation with contractor employees per 1,000 households | INFO | before (degree days summed, home age): 0.16 (without Competition 0.36); A: fixes, standard 40/25/15/20: 0.33 (without Competition 0.55); A2: fixes + climate x2, standard 40/25/15/20: 0.32 (without Competition 0.55); C: fixes + climate x2, 48/17/15/20: 0.30 (without Competition 0.55); B: fixes + climate x2, 55/10/15/20: 0.27 (without Competition 0.53) |
| HVAC validation, metros: rank correlation with contractor employees per 1,000 households | INFO | before (degree days summed, home age): 0.10 (without Competition 0.32); A: fixes, standard 40/25/15/20: 0.22 (without Competition 0.43); A2: fixes + climate x2, standard 40/25/15/20: 0.21 (without Competition 0.44); C: fixes + climate x2, 48/17/15/20: 0.19 (without Competition 0.44); B: fixes + climate x2, 55/10/15/20: 0.18 (without Competition 0.43) |
| Score reality check, DMAs: rank correlation with contractors' employees per 1,000 households, score (without Competition) | INFO | Any home service 0.07 (0.37); HVAC 0.33 (0.54); Roofing and gutters -0.05 (0.28); Plumbing 0.21 (0.42); Electrical 0.36 (0.51); Painting and wallpaper 0.38 (0.61); Flooring 0.05 (0.37). None weak. |
| Score reality check, metros: rank correlation with contractors' employees per 1,000 households, score (without Competition) | INFO | Any home service 0.02 (0.34); HVAC 0.24 (0.44); Roofing and gutters -0.08 (0.26); Plumbing 0.13 (0.34); Electrical 0.24 (0.41); Painting and wallpaper 0.22 (0.48); Flooring 0.03 (0.33). None weak. |
| DMA scores within 0–100 | PASS | 0 out of range; 1,470 scores computed, 0 not computed (missing input) |
| Metro scores within 0–100 | PASS | 0 out of range; 2,709 scores computed, 0 not computed (missing input) |
| EASI spending matched to metros | PASS | 387 of 387 |
| DMAs where under half the households are in an EASI area | INFO | 4: 537, 552, 631, 798 |
| EASI painting total, DMAs vs. EASI's own total | PASS | 98.6% |
| EASI heat, a/c and electrical total, metros vs. EASI's own metro totals | PASS | 98.8% |
| DMA roll-up matches county totals: Any home service | PASS | DMAs 276,202 vs counties 276,241 |
| DMA roll-up matches county totals: HVAC | PASS | DMAs 111,157 vs counties 111,176 |
| DMA roll-up matches county totals: Roofing and gutters | PASS | DMAs 25,510 vs counties 25,515 |
| DMA roll-up matches county totals: Plumbing | PASS | DMAs 111,157 vs counties 111,176 |
| DMA roll-up matches county totals: Electrical | PASS | DMAs 83,293 vs counties 83,298 |
| DMA roll-up matches county totals: Painting and wallpaper | PASS | DMAs 38,260 vs counties 38,269 |
| DMA roll-up matches county totals: Flooring | PASS | DMAs 17,981 vs counties 17,983 |
| U.S. own share | PASS | 65.2% (expected 58%–70%) |
| U.S. pre1980 share | PASS | 48.2% (expected 35%–56%) |
| U.S. sfd share | PASS | 82.3% (expected 74%–90%) |
| U.S. lt share | PASS | 48.2% (expected 30%–60%) |
| U.S. val300 share | PASS | 55.0% (expected 30%–65%) |
| U.S. household-weighted HDD | PASS | 3,948 (expected 3,000–6,000) |
| U.S. household-weighted CDD | PASS | 1,607 (expected 900–2,600) |
| U.S. household-weighted 1-inch hail days | INFO | 1.3 a year |
| U.S. households per square mile | PASS | 45.8 (expected 25–50) |
| Density sense check: New York DMA is far denser than the U.S. | PASS | 725 vs 46 households per square mile |
| Counties built from ZIPs | PASS | 3,144 counties (2,400 with 10,000+ residents are ranked) |
| County scores within 0–100 | PASS | 0 out of range; 16,800 scores computed |
