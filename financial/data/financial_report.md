# Financial data check report

Built 2026-10-28. Result: **PASSED**

| Check | Result | Detail |
| --- | --- | --- |
| Formula tests | PASS | percentile and weighted-average hand checks reproduce exactly |
| Bank and credit union branches | INFO | FDIC 2026: 75,859 bank branches; NCUA 2026-06: 22,827 credit union branches |
| HMDA mortgage data | INFO | 2025: 2,984,541 purchase, 1,175,299 refinance and 1,896,690 home equity loans on owner-occupied homes; 0.2% had no census tract and aren't placed |
| IRS tax year | INFO | unknown |
| Land area source | INFO | Census 2026 Gazetteer ZCTA file (33,791 ZIPs) |
| Business Patterns years | INFO | 2023 (growth measured from 2022) |
| Published benchmark: tax establishments | PASS | 28,761 (expected 18,000–60,000) |
| Published benchmark: advice establishments | PASS | 67,802 (expected 25,000–90,000) |
| Published benchmark: mortgage establishments | PASS | 26,374 (expected 10,000–40,000) |
| EASI U.S. value of retirement plans per household | INFO | $112,816.19 |
| EASI U.S. change in value of retirement plans per household | INFO | $1,141.34 |
| EASI finance matched to DMAs | PASS | 210 of 210 |
| EASI finance matched to metros | PASS | 387 of 387 |
| Score reality check, DMAs: rank correlation with category businesses' employees per 1,000 households, score (without Competition) | INFO | Tax preparation -0.37 (0.14); Wealth management 0.73 (0.83); Retirement planning 0.40 (0.68); Home purchase mortgage 0.33 (0.67); Refinance and home equity 0.35 (0.63). None weak. Reviewed and kept (benchmark doesn't fit): Tax preparation (offices follow market size; the score uses IRS counts of returns filed through paid preparers, the direct measure of customers). |
| Score reality check, metros: rank correlation with category businesses' employees per 1,000 households, score (without Competition) | INFO | Tax preparation -0.29 (0.20); Wealth management 0.51 (0.68); Retirement planning 0.13 (0.47); Home purchase mortgage 0.29 (0.62); Refinance and home equity 0.29 (0.56). None weak. Reviewed and kept (benchmark doesn't fit): Tax preparation (offices follow market size; the score uses IRS counts of returns filed through paid preparers, the direct measure of customers). |
| EASI value of retirement plans, DMAs vs. EASI's own total | PASS | 98.7% |
| EASI change in value of retirement plans, DMAs vs. EASI's own total | PASS | 98.8% |
| U.S. share of returns with a paid preparer | PASS | 53.0% (expected 40%–65%) |
| U.S. share of returns claiming the earned income credit | PASS | 15.1% (expected 10%–22%) |
| U.S. share of returns with dividends | PASS | 20.4% (expected 12%–30%) |
| U.S. share of returns with capital gains | PASS | 18.9% (expected 10%–28%) |
| U.S. share of returns with income of $200k+ | PASS | 7.9% (expected 4%–12%) |
| U.S. share of returns with ira distributions | PASS | 10.4% (expected 8%–20%) |
| U.S. share of returns with pension or annuity income | PASS | 18.9% (expected 12%–25%) |
| U.S. share who moved in the past year | PASS | 12.3% (expected 8%–16%) |
| U.S. share of owner homes with a mortgage | PASS | 60.6% (expected 55%–70%) |
| U.S. inc75_share | PASS | 53.1% (expected 40%–60%) |
| U.S. share of adults who are 50–64 | PASS | 24.2% (expected 20%–30%) |
| IRS returns vs. households | PASS | 1.19 returns per household (expected 1.0–1.4) |
| HMDA purchase loans placed in ZIPs vs. national total | PASS | 98.5% |
| DMA scores within 0–100 | PASS | 0 out of range; 1,050 computed, 0 not computed (missing input) |
| Metro scores within 0–100 | PASS | 0 out of range; 1,935 computed, 0 not computed (missing input) |
| Top DMAs: Tax preparation | INFO | Jackson, Ms, Columbus-Tupelo-West Point, Monroe-El Dorado, Paducah-Cape Girardeau-Harrisburg, Shreveport |
| Top DMAs: Wealth management | INFO | Washington, Dc-Hagrstwn, New York, Seattle-Tacoma, San Francisco-Oakland-San Jose, Honolulu |
| Top DMAs: Retirement planning | INFO | Harrisburg-Lancaster-Lebanon-York, Wilkes Barre-Scranton, Albany-Schenectady-Troy, Hartford-New Haven, Portland-Auburn |
| Top DMAs: Home purchase mortgage | INFO | Madison, Houston, Austin, Omaha, Columbus, Oh |
| Top DMAs: Refinance and home equity | INFO | Madison, Milwaukee, Boston, Harrisburg-Lancaster-Lebanon-York, Omaha |
| Counties built from ZIPs | PASS | 3,144 counties (2,400 with 10,000+ residents are ranked) |
| County scores within 0–100 | PASS | 0 out of range; 12,000 scores computed |
