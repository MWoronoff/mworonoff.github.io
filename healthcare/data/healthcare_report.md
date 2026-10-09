# Healthcare data check report

Built 2026-10-09. Result: **PASSED**

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
| EASI layer matched to metros | PASS | 387 of 387 metros |
| DMA scores within 0–100 | PASS | 0 out of range; 1,853 scores computed, 37 not computed (missing input) |
| DMA business counts never negative | PASS | 0 |
| Metro scores within 0–100 | PASS | 0 out of range; 3,409 scores computed, 74 not computed (missing input) |
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
