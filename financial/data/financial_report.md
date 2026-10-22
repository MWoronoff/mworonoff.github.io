# Financial data check report

Built 2026-10-22. Result: **PASSED**

| Check | Result | Detail |
| --- | --- | --- |
| Formula tests | PASS | percentile and weighted-average hand checks reproduce exactly |
| Bank and credit union branches | INFO | FDIC 2026: 75,859 bank branches; NCUA 2026-06: 22,827 credit union branches |
| HMDA mortgage data | INFO | 2025: 2,984,541 purchase, 1,175,299 refinance and 1,896,690 home equity loans on owner-occupied homes; 0.2% had no census tract and aren't placed |
| IRS tax year | INFO | 2022 |
| Land area source | INFO | Census 2026 Gazetteer ZCTA file (33,791 ZIPs) |
| Business Patterns years | INFO | 2023 (growth measured from 2022) |
| Published benchmark: tax establishments | PASS | 27,455 (expected 18,000–60,000) |
| Published benchmark: advice establishments | PASS | 65,888 (expected 25,000–90,000) |
| Published benchmark: mortgage establishments | PASS | 24,884 (expected 10,000–40,000) |
| EASI U.S. value of retirement plans per household | INFO | $112,816.19 |
| EASI U.S. change in value of retirement plans per household | INFO | $1,141.34 |
| EASI finance matched to DMAs | PASS | 210 of 210 |
| EASI finance matched to metros | PASS | 387 of 387 |
| Score reality check, DMAs: rank correlation with category businesses' employees per 1,000 households, score (without Competition) | INFO | Tax preparation -0.43 (0.12); Wealth management 0.74 (0.84); Retirement planning 0.39 (0.68); Home purchase mortgage 0.33 (0.67); Refinance and home equity 0.34 (0.63). Weak (under 0.20 without Competition): Tax preparation |
| Score reality check, metros: rank correlation with category businesses' employees per 1,000 households, score (without Competition) | INFO | Tax preparation -0.29 (0.18); Wealth management 0.53 (0.70); Retirement planning 0.14 (0.48); Home purchase mortgage 0.30 (0.63); Refinance and home equity 0.28 (0.55). Weak (under 0.20 without Competition): Tax preparation |
| EASI value of retirement plans, DMAs vs. EASI's own total | PASS | 96.8% |
| EASI change in value of retirement plans, DMAs vs. EASI's own total | PASS | 96.8% |
| U.S. share of returns with a paid preparer | PASS | 53.0% (expected 40%–65%) |
| U.S. share of returns claiming the earned income credit | PASS | 15.1% (expected 10%–22%) |
| U.S. share of returns with dividends | PASS | 20.4% (expected 12%–30%) |
| U.S. share of returns with capital gains | PASS | 18.9% (expected 10%–28%) |
| U.S. share of returns with income of $200k+ | PASS | 7.9% (expected 4%–12%) |
| U.S. share of returns with ira distributions | PASS | 10.4% (expected 8%–20%) |
| U.S. share of returns with pension or annuity income | PASS | 18.9% (expected 12%–25%) |
| U.S. share who moved in the past year | PASS | 12.3% (expected 8%–16%) |
| U.S. share of owner homes with a mortgage | PASS | 62.4% (expected 55%–70%) |
| U.S. inc75_share | PASS | 53.1% (expected 40%–60%) |
| U.S. share of adults who are 50–64 | PASS | 24.2% (expected 20%–30%) |
| IRS returns vs. households | PASS | 1.21 returns per household (expected 1.0–1.4) |
| HMDA purchase loans placed in ZIPs vs. national total | PASS | 98.5% |
| DMA scores within 0–100 | PASS | 0 out of range; 1,050 computed, 0 not computed (missing input) |
| Metro scores within 0–100 | PASS | 0 out of range; 1,935 computed, 0 not computed (missing input) |
| Top DMAs: Tax preparation | INFO | Paducah-Cape Girardeau-Harrisburg, Jackson, Ms, Monroe-El Dorado, Columbus-Tupelo-West Point, Lexington |
| Top DMAs: Wealth management | INFO | Washington, Dc-Hagrstwn, New York, San Francisco-Oakland-San Jose, Seattle-Tacoma, Boston |
| Top DMAs: Retirement planning | INFO | Harrisburg-Lancaster-Lebanon-York, Wilkes Barre-Scranton, Albany-Schenectady-Troy, Hartford-New Haven, Portland-Auburn |
| Top DMAs: Home purchase mortgage | INFO | Odessa-Midland, Austin, Madison, Houston, Columbus, Oh |
| Top DMAs: Refinance and home equity | INFO | Madison, Milwaukee, Boston, Harrisburg-Lancaster-Lebanon-York, Columbus, Oh |
| Counties built from ZIPs | PASS | 3,144 counties (2,399 with 10,000+ residents are ranked) |
| County scores within 0–100 | PASS | 0 out of range; 11,993 scores computed |
