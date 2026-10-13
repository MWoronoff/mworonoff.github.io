# Furniture data check report

Built 2026-10-13. Result: **PASSED**

| Check | Result | Detail |
| --- | --- | --- |
| Formula tests | PASS | percentile and weighted-average hand checks reproduce exactly |
| Land area source | INFO | Census 2026 Gazetteer ZCTA file (33,791 ZIPs) |
| Business Patterns years | INFO | 2023 (growth measured from 2022) |
| Furniture retailers counted (County Business Patterns) | PASS | 20,672 establishments in 2023; codes found: ['442110'] |
| ZIP detail coverage of county counts (cells under 3 businesses aren't published) | INFO | 73% |
| EASI furniture spending: Palm Springs | INFO | EASI includes Palm Springs in Los Angeles; the provisional Palm Springs DMA uses the Riverside–San Bernardino metro's per-household spending |
| EASI U.S. spending per household | INFO | Any furniture $647.29; Sofas and living room $220.50; Bedroom furniture $74.67; Mattresses $93.23; Kitchen and dining $22.38; Outdoor and patio $37.66; Baby and nursery $5.93 |
| EASI furniture spending matched to DMAs | PASS | 210 of 210 |
| EASI furniture spending matched to metros | PASS | 387 of 387 |
| Score reality check, DMAs: rank correlation with furniture retailers' employees per 1,000 households, score (without Competition) | INFO | Any furniture 0.10 (0.28); Sofas and living room 0.10 (0.29); Bedroom furniture 0.05 (0.29); Mattresses 0.09 (0.26); Kitchen and dining 0.04 (0.27); Outdoor and patio -0.00 (0.19); Baby and nursery 0.08 (0.30). Weak (under 0.20 without Competition): Outdoor and patio |
| Score reality check, metros: rank correlation with furniture retailers' employees per 1,000 households, score (without Competition) | INFO | Any furniture -0.04 (0.15); Sofas and living room -0.04 (0.16); Bedroom furniture -0.08 (0.18); Mattresses -0.04 (0.13); Kitchen and dining -0.09 (0.14); Outdoor and patio -0.11 (0.10); Baby and nursery -0.04 (0.19). Weak (under 0.20 without Competition): Any furniture, Sofas and living room, Bedroom furniture, Mattresses, Kitchen and dining, Outdoor and patio, Baby and nursery |
| EASI furniture total, DMAs vs. EASI's own total | PASS | 96.9% of EASI's $84.68B |
| DMA scores within 0–100 | PASS | 0 out of range; 1,470 scores computed, 0 not computed (missing input) |
| Metro scores within 0–100 | PASS | 0 out of range; 2,709 scores computed, 0 not computed (missing input) |
| DMA roll-up matches county totals: furniture retailers | PASS | DMAs 20,669 vs counties 20,669 |
| U.S. share of households that moved in 2020 or later | PASS | 24.8% (expected 20%–45%) |
| U.S. own_share | PASS | 65.2% (expected 58%–72%) |
| U.S. households with children | PASS | 29.5% (expected 22%–36%) |
| U.S. share of owner homes that are single-family detached | PASS | 82.3% (expected 74%–90%) |
| U.S. inc75_share | PASS | 53.1% (expected 35%–60%) |
| Counties built from ZIPs | PASS | 3,144 counties (2,399 with 10,000+ residents are ranked) |
| County scores within 0–100 | PASS | 0 out of range; 16,793 scores computed |
