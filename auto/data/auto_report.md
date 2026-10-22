# Auto data check report

Built 2026-10-22. Result: **PASSED**

| Check | Result | Detail |
| --- | --- | --- |
| Formula tests | PASS | percentile and weighted-average hand checks reproduce exactly |
| Land area source | INFO | Census 2026 Gazetteer ZCTA file (33,791 ZIPs) |
| Business Patterns years | INFO | 2023 (growth measured from 2022) |
| Published benchmark: new establishments | PASS | 20,650 (expected 15,000–30,000) |
| Published benchmark: used establishments | PASS | 23,912 (expected 15,000–60,000) |
| EASI U.S. new cars per household | INFO | $513.14 |
| EASI U.S. new trucks per household | INFO | $1,359.92 |
| EASI U.S. used cars per household | INFO | $368.70 |
| EASI U.S. used trucks per household | INFO | $1,337.30 |
| EASI auto spending matched to DMAs | PASS | 210 of 210 |
| EASI auto spending matched to metros | PASS | 387 of 387 |
| Score reality check, DMAs: rank correlation with category businesses' employees per 1,000 households, score (without Competition) | INFO | New cars 0.09 (0.25); New trucks and SUVs -0.05 (0.14); Used cars -0.28 (0.16); Used trucks and SUVs -0.24 (0.11). Weak (under 0.20 without Competition): New trucks and SUVs, Used cars, Used trucks and SUVs |
| Score reality check, metros: rank correlation with category businesses' employees per 1,000 households, score (without Competition) | INFO | New cars -0.12 (0.06); New trucks and SUVs -0.17 (0.03); Used cars -0.27 (0.26); Used trucks and SUVs -0.20 (0.25). Weak (under 0.20 without Competition): New cars, New trucks and SUVs |
| EASI new cars, DMAs vs. EASI's own total | PASS | 96.8% |
| EASI new trucks, DMAs vs. EASI's own total | PASS | 96.8% |
| EASI used cars, DMAs vs. EASI's own total | PASS | 96.8% |
| EASI used trucks, DMAs vs. EASI's own total | PASS | 96.8% |
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
| Top DMAs: New trucks and SUVs | INFO | Salt Lake City, Monterey-Salinas, Sacramento-Stockton-Modesto, Denver, Boise |
| Top DMAs: Used cars | INFO | Traverse City-Cadillac, Green Bay-Appleton, Flint-Saginaw-Bay City, La Crosse-Eau Claire, Charleston-Huntington |
| Top DMAs: Used trucks and SUVs | INFO | Glendive, Traverse City-Cadillac, Sioux Falls (Mitchell), Denver, La Crosse-Eau Claire |
| Counties built from ZIPs | PASS | 3,144 counties (2,399 with 10,000+ residents are ranked) |
| County scores within 0–100 | PASS | 0 out of range; 9,596 scores computed |
