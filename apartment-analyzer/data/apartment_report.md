# Apartment data check report

Built 2026-10-13. Result: **PASSED**

| Check | Result | Detail |
| --- | --- | --- |
| Formula tests | PASS | percentile and weighted-average hand checks reproduce exactly |
| Land area source | INFO | Census 2026 Gazetteer ZCTA file (33,791 ZIPs) |
| Renters in ZIPs with a published median rent | PASS | 99.6% |
| Business Patterns years | INFO | 2023 (growth measured from 2022) |
| Published benchmark: residential landlords and property managers | PASS | 133,096 (expected 60,000–250,000) |
| ZIP detail coverage of county counts (cells under 3 businesses aren't published) | INFO | 89% |
| Building permits: new units in 5+ unit buildings | PASS | 2025: 463,972 units in 3,029 counties (expected 150,000–800,000 nationally) |
| Zillow rent index matched to metros | PASS | 380 of 387 metros; 2025-08 to 2026-08; median change +3.0% |
| EASI rent: Palm Springs | INFO | EASI includes Palm Springs in Los Angeles; the provisional Palm Springs DMA uses the Riverside–San Bernardino metro's per-household spending |
| EASI U.S. rent per household | INFO | $4,370 a year |
| EASI rent matched to DMAs | PASS | 210 of 210 |
| EASI rent matched to metros | PASS | 387 of 387 |
| Score reality check, DMAs: rank correlation with residential landlords and property managers' employees per 1,000 households, score (without Competition) | INFO | All apartments 0.65 (0.80); Luxury / Class A 0.65 (0.78); Mid-market / workforce 0.64 (0.79); Affordable housing 0.21 (0.54); Student housing 0.49 (0.69); Active adult / 55+ 0.40 (0.62). None weak. |
| Score reality check, metros: rank correlation with residential landlords and property managers' employees per 1,000 households, score (without Competition) | INFO | All apartments 0.61 (0.76); Luxury / Class A 0.55 (0.69); Mid-market / workforce 0.53 (0.69); Affordable housing 0.21 (0.52); Student housing 0.52 (0.70); Active adult / 55+ 0.24 (0.43). None weak. |
| EASI rent total, DMAs vs. EASI's own total | PASS | 96.9% of EASI's $571.7B |
| DMA scores within 0–100 | PASS | 0 out of range; 1,260 scores computed, 0 not computed (missing input) |
| Metro scores within 0–100 | PASS | 0 out of range; 2,322 scores computed, 0 not computed (missing input) |
| DMA roll-up matches county totals: landlords and property managers | PASS | DMAs 133,029 vs counties 133,047 |
| U.S. share of households renting | PASS | 34.8% (expected 30.0%–40.0%) |
| U.S. rent | PASS | $1,446 (expected $1,150–$1,750) |
| U.S. vacancy | PASS | 5.5% (expected 3.5%–9.0%) |
| U.S. renters paying 30%+ of income in rent | PASS | 51.1% (expected 42.0%–58.0%) |
| U.S. renters in buildings with 5+ units | PASS | 46.8% (expected 35.0%–52.0%) |
| Census rent per household vs. EASI rent per household, DMAs | INFO | rank correlation 0.49 (EASI's per-household rent varies little between markets, so it isn't scored) |
| Census rent per household vs. EASI rent per household, metros | INFO | rank correlation 0.47 (EASI's per-household rent varies little between markets, so it isn't scored) |
| Counties built from ZIPs | PASS | 3,144 counties (3,100 with 1,000+ residents are ranked) |
| County scores within 0–100 | PASS | 0 out of range; 18,600 scores computed |
