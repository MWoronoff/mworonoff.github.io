# Healthcare data check report

Built 2026-10-10. Result: **PASSED**

| Check | Result | Detail |
| --- | --- | --- |
| Formula tests | PASS | percentile and weighted-average hand checks reproduce exactly |
| Business Patterns years | INFO | 2023 (growth measured from 2022) |
| Business ZIPs matched to the ZIP geography | PASS | 815 of 563,924 healthcare businesses sit in ZIPs not in the geography table |
| ZIP detail coverage of county counts (cells under 3 businesses aren't published) | INFO | Urgent and emergency care 57%; Pharmacy 78%; Dental 96%; Hearing and audiology 81%; Eye care 69%; Chiropractic and physical therapy 85%; Behavioral health 83%; Med spa and aesthetics 96%; Senior and home care 80% |
| Published benchmark: dentist offices | PASS | 134,662 (expected 110,000–150,000) |
| Published benchmark: pharmacies | PASS | 40,402 (expected 35,000–50,000) |
| County businesses outside the ZIP geography | INFO | 632 of 639,106 (mostly Census 'statewide' records with no county); counted in U.S. totals only |
| CDC PLACES release | INFO | 2025; measures found: fairpoor, diabetes, bphigh, nodental, hearing, vision, arthritis, obesity, depression, mhlth, indeplive |
| CDC PLACES ZCTA gaps filled with county values | INFO | Fair or poor health 10,764 ZIPs; Diabetes 10,764 ZIPs; High blood pressure 10,764 ZIPs; No dental visit in past year 8,227 ZIPs; Hearing disability 10,764 ZIPs; Vision disability 10,764 ZIPs; Arthritis 10,764 ZIPs; Obesity 10,764 ZIPs; Depression 10,764 ZIPs; Frequent mental distress 10,764 ZIPs; Independent-living disability 10,764 ZIPs |
| Adults covered by CDC PLACES | PASS | 94.7% |
| Filling CDC 2025 gaps: Fair or poor health | PASS | used; tested average county error (pts): prev region 0.99; prev local 1.05; neighbors 3.14; model 1.38. Best: prev region (Ohio 1.69, West Virginia 1.08, New York 0.60, Maryland 1.33, Tennessee 0.68, Indiana 0.56); 3,104 ZIPs |
| Filling CDC 2025 gaps: Diabetes | PASS | used; tested average county error (pts): prev region 0.42; prev local 0.58; neighbors 1.94; model 1.02. Best: prev region (Ohio 0.40, West Virginia 0.35, New York 0.38, Maryland 0.29, Tennessee 0.53, Indiana 0.57); 3,104 ZIPs |
| Filling CDC 2025 gaps: High blood pressure | PASS | used; tested average county error (pts): prev region 1.12; prev local 1.35; neighbors 4.20; model 3.30. Best: prev region (Ohio 1.10, West Virginia 1.14, New York 0.94, Maryland 1.05, Tennessee 0.76, Indiana 1.70); 3,104 ZIPs |
| Filling CDC 2025 gaps: No dental visit in past year | PASS | used; tested average county error (pts): prev region 0.00; prev local 0.00; neighbors 5.59; model 2.24. Best: prev region (Ohio 0.00, West Virginia 0.00, New York 0.00, Maryland 0.00, Tennessee 0.00, Indiana 0.00); 1 ZIPs |
| Filling CDC 2025 gaps: Hearing disability | PASS | used; tested average county error (pts): prev region 0.33; prev local 0.25; neighbors 1.06; model 0.69. Best: prev local (Ohio 0.21, West Virginia 0.32, New York 0.24, Maryland 0.16, Tennessee 0.36, Indiana 0.21); 3,104 ZIPs |
| Filling CDC 2025 gaps: Vision disability | PASS | used; tested average county error (pts): prev region 0.18; prev local 0.26; neighbors 0.81; model 0.80. Best: prev region (Ohio 0.28, West Virginia 0.16, New York 0.12, Maryland 0.09, Tennessee 0.11, Indiana 0.31); 3,104 ZIPs |
| Filling CDC 2025 gaps: Arthritis | PASS | used; tested average county error (pts): prev region 0.80; prev local 1.14; neighbors 4.26; model 3.99. Best: prev region (Ohio 0.57, West Virginia 0.97, New York 0.67, Maryland 0.67, Tennessee 1.10, Indiana 0.81); 3,104 ZIPs |
| Filling CDC 2025 gaps: Obesity | PASS | used, lower confidence (error 1.5–3 pts); tested average county error (pts): prev region 2.32; prev local 2.66; neighbors 4.12; model 3.68. Best: prev region (Ohio 2.45, West Virginia 2.34, New York 1.81, Maryland 2.83, Tennessee 2.37, Indiana 2.13); 3,104 ZIPs |
| Filling CDC 2025 gaps: Depression | PASS | used, lower confidence (error 1.5–3 pts); tested average county error (pts): prev region 1.56; prev local 1.53; neighbors 3.01; model 4.65. Best: prev local (Ohio 1.67, West Virginia 3.19, New York 0.78, Maryland 0.90, Tennessee 1.27, Indiana 1.38); 3,104 ZIPs |
| Filling CDC 2025 gaps: Frequent mental distress | PASS | used; tested average county error (pts): prev region 0.63; prev local 0.96; neighbors 1.72; model 1.50. Best: prev region (Ohio 0.80, West Virginia 1.10, New York 0.33, Maryland 0.46, Tennessee 0.36, Indiana 0.73); 3,104 ZIPs |
| Filling CDC 2025 gaps: Independent-living disability | PASS | used; tested average county error (pts): prev region 0.46; prev local 0.59; neighbors 1.24; model 0.54. Best: prev region (Ohio 1.06, West Virginia 0.32, New York 0.13, Maryland 0.23, Tennessee 0.59, Indiana 0.46); 3,104 ZIPs |
| Adults covered by CDC PLACES plus estimates | INFO | 100.0% |
| EASI healthcare spending: Palm Springs | INFO | EASI includes Palm Springs in Los Angeles; the provisional Palm Springs DMA uses the Riverside–San Bernardino metro's per-household spending |
| EASI U.S. healthcare spending per household | INFO | Medical services $1,215.73; Prescription drugs $215.68 |
| EASI healthcare spending matched to DMAs | PASS | 210 of 210 |
| EASI healthcare spending matched to metros | PASS | 387 of 387 |
| EASI medical services total, DMAs vs. EASI's own total | PASS | 96.9% of EASI's $159.0B |
| EASI prescription drugs total, DMAs vs. EASI's own total | PASS | 96.9% of EASI's $28.2B |
| Cross-check vs. EASI: Hearing disability | INFO | correlation with EASI hearing trouble: 0.49 across 22 metros with estimated values; 0.71 across 365 metros with CDC values |
| Cross-check vs. EASI: Vision disability | INFO | correlation with EASI vision trouble: 0.37 across 22 metros with estimated values; 0.52 across 365 metros with CDC values |
| EASI layer matched to metros | PASS | 387 of 387 metros |
| DMA scores within 0–100 | PASS | 0 out of range; 1,890 scores computed, 0 not computed (missing input) |
| DMA business counts never negative | PASS | 0 |
| Metro scores within 0–100 | PASS | 0 out of range; 3,483 scores computed, 0 not computed (missing input) |
| Metro business counts never negative | PASS | 0 |
| DMA roll-up matches county totals: Urgent and emergency care | PASS | DMAs 9,117 vs counties 9,117 |
| DMA roll-up matches county totals: Pharmacy | PASS | DMAs 40,397 vs counties 40,402 |
| DMA roll-up matches county totals: Dental | PASS | DMAs 134,641 vs counties 134,648 |
| DMA roll-up matches county totals: Hearing and audiology | PASS | DMAs 59,862 vs counties 59,865 |
| DMA roll-up matches county totals: Eye care | PASS | DMAs 32,221 vs counties 32,221 |
| DMA roll-up matches county totals: Chiropractic and physical therapy | PASS | DMAs 89,478 vs counties 89,481 |
| DMA roll-up matches county totals: Behavioral health | PASS | DMAs 60,918 vs counties 60,925 |
| DMA roll-up matches county totals: Med spa and aesthetics | PASS | DMAs 203,457 vs counties 203,466 |
| DMA roll-up matches county totals: Senior and home care | PASS | DMAs 59,098 vs counties 59,098 |
| U.S. population (Deluxe) | INFO | 331,438,416 |
