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
| Estimated where CDC doesn't publish: Fair or poor health | PASS | used; average county error 1.38 pts (Ohio 1.74, West Virginia 1.18, New York 1.83, Maryland 1.14, Tennessee 1.27, Indiana 1.10); 2,385 ZIPs |
| Estimated where CDC doesn't publish: Diabetes | PASS | used; average county error 1.02 pts (Ohio 0.73, West Virginia 1.04, New York 1.11, Maryland 1.53, Tennessee 0.96, Indiana 0.72); 2,385 ZIPs |
| Estimated where CDC doesn't publish: High blood pressure | WARN | not used (error above 1.5 pts); average county error 3.30 pts (Ohio 1.50, West Virginia 4.55, New York 2.40, Maryland 4.59, Tennessee 3.76, Indiana 2.98); 2,385 ZIPs |
| Estimated where CDC doesn't publish: Hearing disability | PASS | used; average county error 0.69 pts (Ohio 0.48, West Virginia 0.78, New York 1.22, Maryland 0.59, Tennessee 0.75, Indiana 0.31); 2,385 ZIPs |
| Estimated where CDC doesn't publish: Vision disability | PASS | used; average county error 0.80 pts (Ohio 0.94, West Virginia 1.42, New York 0.42, Maryland 0.40, Tennessee 0.71, Indiana 0.91); 2,385 ZIPs |
| Estimated where CDC doesn't publish: Arthritis | WARN | not used (error above 1.5 pts); average county error 3.99 pts (Ohio 3.49, West Virginia 8.64, New York 1.89, Maryland 2.37, Tennessee 4.70, Indiana 2.84); 2,385 ZIPs |
| Estimated where CDC doesn't publish: Obesity | WARN | not used (error above 1.5 pts); average county error 3.68 pts (Ohio 2.53, West Virginia 4.05, New York 4.10, Maryland 5.23, Tennessee 2.36, Indiana 3.78); 2,385 ZIPs |
| Estimated where CDC doesn't publish: Depression | WARN | not used (error above 1.5 pts); average county error 4.65 pts (Ohio 3.58, West Virginia 8.87, New York 3.73, Maryland 1.82, Tennessee 6.52, Indiana 3.36); 2,385 ZIPs |
| Estimated where CDC doesn't publish: Frequent mental distress | PASS | used; average county error 1.50 pts (Ohio 0.79, West Virginia 3.82, New York 0.99, Maryland 0.71, Tennessee 2.22, Indiana 0.47); 2,385 ZIPs |
| Estimated where CDC doesn't publish: Independent-living disability | PASS | used; average county error 0.54 pts (Ohio 0.47, West Virginia 0.90, New York 0.31, Maryland 0.26, Tennessee 0.77, Indiana 0.56); 2,385 ZIPs |
| Adults covered by CDC PLACES plus estimates | INFO | 100.0% |
| EASI healthcare spending: Palm Springs | INFO | EASI includes Palm Springs in Los Angeles; the provisional Palm Springs DMA uses the Riverside–San Bernardino metro's per-household spending |
| EASI U.S. healthcare spending per household | INFO | Medical services $1,215.73; Prescription drugs $215.68 |
| EASI healthcare spending matched to DMAs | PASS | 210 of 210 |
| EASI healthcare spending matched to metros | PASS | 387 of 387 |
| EASI medical services total, DMAs vs. EASI's own total | PASS | 96.9% of EASI's $159.0B |
| EASI prescription drugs total, DMAs vs. EASI's own total | PASS | 96.9% of EASI's $28.2B |
| Cross-check vs. EASI: Hearing disability | INFO | correlation with EASI hearing trouble: 0.72 across 22 metros with estimated values; 0.71 across 365 metros with CDC values |
| Cross-check vs. EASI: Vision disability | INFO | correlation with EASI vision trouble: 0.64 across 22 metros with estimated values; 0.52 across 365 metros with CDC values |
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
