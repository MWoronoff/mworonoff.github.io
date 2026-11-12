# Auto data check report

Built 2026-11-12. Result: **PASSED**

| Check | Result | Detail |
| --- | --- | --- |
| Formula tests | PASS | percentile and weighted-average hand checks reproduce exactly |
| Land area source | INFO | Census 2026 Gazetteer ZCTA file (33,791 ZIPs) |
| Business Patterns years | INFO | 2023 (growth measured from 2022) |
| Published benchmark: new establishments | PASS | 21,908 (expected 15,000–30,000) |
| Published benchmark: used establishments | PASS | 25,146 (expected 15,000–60,000) |
| EASI U.S. new cars per household | INFO | $513.14 |
| EASI U.S. new trucks per household | INFO | $1,359.92 |
| EASI U.S. used cars per household | INFO | $368.70 |
| EASI U.S. used trucks per household | INFO | $1,337.30 |
| EASI auto spending matched to DMAs | PASS | 210 of 210 |
| EASI auto spending matched to metros | PASS | 387 of 387 |
| Score reality check, DMAs: rank correlation with category businesses' employees per 1,000 households, score (without Competition) | INFO | New cars 0.05 (0.19); New trucks and SUVs 0.03 (0.13); Used cars -0.24 (0.17); Used trucks and SUVs -0.20 (0.15). None weak. Reviewed and kept (benchmark doesn't fit): New cars, New trucks and SUVs, Used cars, Used trucks and SUVs (dealers cluster in regional hubs and small towns and buyers travel to them; every score part, including EASI new-vehicle spending, runs against dealer density; same as new cars). |
| Score reality check, metros: rank correlation with category businesses' employees per 1,000 households, score (without Competition) | INFO | New cars -0.20 (0.02); New trucks and SUVs -0.16 (0.02); Used cars -0.36 (0.21); Used trucks and SUVs -0.21 (0.25). None weak. Reviewed and kept (benchmark doesn't fit): New cars, New trucks and SUVs (dealers cluster in regional hubs and small towns and buyers travel to them; every score part, including EASI new-vehicle spending, runs against dealer density; same as new cars). |
| EASI new cars, DMAs vs. EASI's own total | PASS | 98.7% |
| EASI new trucks, DMAs vs. EASI's own total | PASS | 98.7% |
| EASI used cars, DMAs vs. EASI's own total | PASS | 98.7% |
| EASI used trucks, DMAs vs. EASI's own total | PASS | 98.7% |
| U.S. households earning $35k+ | PASS | 78.7% (expected 70%–84%) |
| U.S. households earning under $50k | PASS | 31.4% (expected 20%–34%) |
| U.S. households earning under $75k | PASS | 46.9% (expected 34%–52%) |
| U.S. adults 18–54 (share of adults) | PASS | 61.7% (expected 52%–68%) |
| U.S. adults 18–44 (share of adults) | PASS | 46.1% (expected 40%–54%) |
| U.S. adults 25–54 (share of adults) | PASS | 50.0% (expected 42%–56%) |
| U.S. adults 45+ (share of adults) | PASS | 53.9% (expected 46%–58%) |
| U.S. households earning $100k+ | PASS | 40.5% (expected 30%–48%) |
| U.S. households earning $35k–$99k | PASS | 38.2% (expected 30%–45%) |
| U.S. share of workers commuting by car | PASS | 77.3% (expected 70%–90%) |
| U.S. households with 3+ vehicles | PASS | 21.9% (expected 18%–26%) |
| U.S. noveh_share | PASS | 8.4% (expected 6%–11%) |
| U.S. share of residents in small-town and rural zips | PASS | 16.7% (expected 12%–25%) |
| U.S. households with children | PASS | 29.5% (expected 25%–35%) |
| U.S. vehicles per household | PASS | 1.83 (expected 1.7–2.1) |
| DMA scores within 0–100 | PASS | 0 out of range; 840 computed, 0 not computed (missing input) |
| Metro scores within 0–100 | PASS | 0 out of range; 1,548 computed, 0 not computed (missing input) |
| Top DMAs: New cars | INFO | Washington, Dc-Hagrstwn, San Francisco-Oakland-San Jose, Dallas-Fort Worth, Houston, Los Angeles |
| Top DMAs: New trucks and SUVs | INFO | Salt Lake City, Denver, Phoenix, Monterey-Salinas, Reno |
| Top DMAs: Used cars | INFO | Fresno-Visalia, Denver, Bakersfield, Los Angeles, Corpus Christi |
| Top DMAs: Used trucks and SUVs | INFO | Denver, Fresno-Visalia, Portland, Or, Salt Lake City, Minneapolis-Saint Paul |
| Counties built from ZIPs | PASS | 3,144 counties (2,400 with 10,000+ residents are ranked) |
| County scores within 0–100 | PASS | 0 out of range; 9,600 scores computed |
