# Legal data check report

Built 2026-10-28. Result: **PASSED**

| Check | Result | Detail |
| --- | --- | --- |
| Formula tests | PASS | percentile and weighted-average hand checks reproduce exactly |
| Land area source | INFO | Census 2026 Gazetteer ZCTA file (33,791 ZIPs) |
| Business Patterns years | INFO | 2023 (growth measured from 2022) |
| Published benchmark: offices of lawyers | PASS | 165,481 (expected 140,000–230,000) |
| ZIP detail coverage of county counts (cells under 3 businesses aren't published) | INFO | 96% |
| EASI legal fees: Palm Springs | INFO | EASI includes Palm Springs in Los Angeles; the provisional Palm Springs DMA uses the Riverside–San Bernardino metro's per-household spending |
| EASI U.S. legal fees per household | INFO | $54.93 |
| EASI legal fees matched to DMAs | PASS | 210 of 210 |
| EASI legal fees matched to metros | PASS | 387 of 387 |
| Score reality check, DMAs: rank correlation with law offices' employees per 1,000 households, score (without Competition) | INFO | Personal injury 0.10 (0.50); Family law and divorce 0.06 (0.51); Estate planning and elder law 0.33 (0.56); Bankruptcy and debt relief -0.47 (0.04); Employment law 0.19 (0.52). Weak (under 0.20 without Competition): Bankruptcy and debt relief |
| Score reality check, metros: rank correlation with law offices' employees per 1,000 households, score (without Competition) | INFO | Personal injury 0.07 (0.46); Family law and divorce -0.07 (0.39); Estate planning and elder law 0.21 (0.47); Bankruptcy and debt relief -0.41 (0.11); Employment law 0.06 (0.41). Weak (under 0.20 without Competition): Bankruptcy and debt relief |
| EASI legal fees total, DMAs vs. EASI's own total | PASS | 98.7% of EASI's $7.19B |
| DMA scores within 0–100 | PASS | 0 out of range; 1,050 scores computed, 0 not computed (missing input) |
| Metro scores within 0–100 | PASS | 0 out of range; 1,935 scores computed, 0 not computed (missing input) |
| DMA roll-up matches county totals: offices of lawyers | PASS | DMAs 165,401 vs counties 165,408 |
| U.S. share divorced or separated | PASS | 12.3% (expected 9%–16%) |
| U.S. unemployment rate | PASS | 5.2% (expected 3%–8%) |
| U.S. share of workers commuting by car | PASS | 77.3% (expected 65%–90%) |
| U.S. households below poverty | PASS | 12.6% (expected 9%–16%) |
| Counties built from ZIPs | PASS | 3,144 counties (2,400 with 10,000+ residents are ranked) |
| County scores within 0–100 | PASS | 0 out of range; 12,000 scores computed |
