# Auto data check report

Built 2026-10-28. Result: **PASSED**

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
| Score reality check, DMAs: rank correlation with category businesses' employees per 1,000 households, score (without Competition) | INFO | New cars 0.11 (0.21); New trucks and SUVs 0.00 (0.10); Used cars -0.22 (0.15); Used trucks and SUVs -0.21 (0.09). None weak. Reviewed and kept (benchmark doesn't fit): New trucks and SUVs, Used cars, Used trucks and SUVs (same as new cars). |
| Score reality check, metros: rank correlation with category businesses' employees per 1,000 households, score (without Competition) | INFO | New cars -0.14 (0.03); New trucks and SUVs -0.19 (-0.01); Used cars -0.27 (0.25); Used trucks and SUVs -0.20 (0.23). None weak. Reviewed and kept (benchmark doesn't fit): New cars, New trucks and SUVs (dealers cluster in regional hubs and small towns and buyers travel to them; every score part, including EASI new-vehicle spending, runs against dealer density; same as new cars). |
| EASI new cars, DMAs vs. EASI's own total | PASS | 98.7% |
| EASI new trucks, DMAs vs. EASI's own total | PASS | 98.7% |
| EASI used cars, DMAs vs. EASI's own total | PASS | 98.7% |
| EASI used trucks, DMAs vs. EASI's own total | PASS | 98.7% |
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
| Top DMAs: New cars | INFO | San Francisco-Oakland-San Jose, New York, Washington, Dc-Hagrstwn, Los Angeles, Houston |
| Top DMAs: New trucks and SUVs | INFO | Salt Lake City, Sacramento-Stockton-Modesto, Monterey-Salinas, Denver, Boise |
| Top DMAs: Used cars | INFO | Green Bay-Appleton, Flint-Saginaw-Bay City, Traverse City-Cadillac, La Crosse-Eau Claire, Toledo |
| Top DMAs: Used trucks and SUVs | INFO | Glendive, Denver, Spokane, Fresno-Visalia, La Crosse-Eau Claire |
| Counties built from ZIPs | PASS | 3,144 counties (2,400 with 10,000+ residents are ranked) |
| County scores within 0–100 | PASS | 0 out of range; 9,600 scores computed |
