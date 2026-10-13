# Legal data check report

Built 2026-10-13. Result: **PASSED**

| Check | Result | Detail |
| --- | --- | --- |
| Formula tests | PASS | percentile and weighted-average hand checks reproduce exactly |
| Land area source | INFO | Census 2026 Gazetteer ZCTA file (33,791 ZIPs) |
| Business Patterns years | INFO | 2023 (growth measured from 2022) |
| Published benchmark: offices of lawyers | PASS | 164,612 (expected 140,000–230,000) |
| ZIP detail coverage of county counts (cells under 3 businesses aren't published) | INFO | 96% |
| EASI legal fees: Palm Springs | INFO | EASI includes Palm Springs in Los Angeles; the provisional Palm Springs DMA uses the Riverside–San Bernardino metro's per-household spending |
| EASI U.S. legal fees per household | INFO | $54.93 |
| EASI legal fees matched to DMAs | PASS | 210 of 210 |
| EASI legal fees matched to metros | PASS | 387 of 387 |
| Score reality check, DMAs: rank correlation with law offices' employees per 1,000 households, score (without Competition) | INFO | Personal injury 0.10 (0.51); Family law and divorce 0.06 (0.53); Estate planning and elder law 0.35 (0.57); Bankruptcy and debt relief -0.29 (0.37); Employment law 0.19 (0.53). None weak. |
| Score reality check, metros: rank correlation with law offices' employees per 1,000 households, score (without Competition) | INFO | Personal injury 0.08 (0.47); Family law and divorce -0.06 (0.40); Estate planning and elder law 0.22 (0.48); Bankruptcy and debt relief -0.30 (0.33); Employment law 0.06 (0.42). None weak. |
| EASI legal fees total, DMAs vs. EASI's own total | PASS | 96.8% of EASI's $7.19B |
| DMA scores within 0–100 | PASS | 0 out of range; 1,050 scores computed, 0 not computed (missing input) |
| Metro scores within 0–100 | PASS | 0 out of range; 1,935 scores computed, 0 not computed (missing input) |
| DMA roll-up matches county totals: offices of lawyers | PASS | DMAs 164,543 vs counties 164,549 |
| U.S. share divorced or separated | PASS | 12.3% (expected 9%–16%) |
| U.S. unemployment rate | PASS | 5.2% (expected 3%–8%) |
| U.S. share of workers commuting by car | PASS | 77.3% (expected 65%–90%) |
| U.S. households below poverty | PASS | 12.6% (expected 9%–16%) |
