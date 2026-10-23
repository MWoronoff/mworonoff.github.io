/* Zip Code Radius Tool settings for this analyzer (written by data-build/build_franchise_pages.py). */
window.ADTAXI_RADIUS = {
 "title": "Zip Code Radius Tool - Franchise Development: Stratus Clean",
 "subtitle": "Pick a center ZIP or town and a radius (or map a custom area), then choose the owner profile to see how many candidates live there and which ZIPs over-index.",
 "logo": "../../shared/adtaxi-logo.svg",
 "exportName": "franchise-stratus-radius",
 "links": [
  {
   "label": "Franchise Development Analyzer: Stratus Clean",
   "url": "./"
  },
  {
   "label": "Home",
   "url": "../../analyzers/"
  }
 ],
 "audienceData": "../../shared/audience/zip_audience.json",
 "extraData": [
  {
   "url": "../../shared/audience/zip_audience_fin.json",
   "label": "Tax return data",
   "source": "IRS Statistics of Income ZIP data"
  }
 ],
 "zipGeo": "../../shared/geo/zip/{level}/{id}.json",
 "planScript": "../../shared/media-plan.js?v=20261023f",
 "mediaMixUrl": "../../media-mix/",
 "planCategory": "none",
 "customArea": true,
 "ageSet": "adult",
 "radii": [
  5,
  10,
  15,
  25,
  50,
  100
 ],
 "radiusLabel": "Up to {r} miles",
 "filters": [
  "age",
  "income",
  "veterans"
 ],
 "profileLabel": "Best prospects for",
 "profiles": [
  {
   "id": "exec",
   "label": "Master franchise candidates",
   "note": "Adults 35 and older in households earning $100K+, including first-time franchise buyers (this tool's income ranges don't split at $125K). IRS shares of returns with $200K+ income and with capital gains show by ZIP.",
   "sel": {
    "age": [
     "35_44",
     "45_54",
     "55p"
    ],
    "income": [
     "100_150",
     "150_200",
     "200p"
    ]
   },
   "context": [
    "hi200",
    "cg"
   ]
  },
  {
   "id": "owner",
   "label": "First-time franchise buyers",
   "note": "Adults 25 and older in households earning $100K+: Millennial, Gen X and Boomer buyers making a career change. The IRS share of returns with $200K+ income shows by ZIP.",
   "sel": {
    "age": [
     "25_34",
     "35_44",
     "45_54",
     "55p"
    ],
    "income": [
     "100_150",
     "150_200",
     "200p"
    ]
   },
   "context": [
    "hi200"
   ]
  }
 ],
 "methodology": [
  {
   "title": "Who counts",
   "body": "Counts are adults by age and household income (Census). Census doesn't publish net worth or job titles by ZIP, so household income stands in for capital, and the profiles are planning estimates, not lists of people."
  },
  {
   "title": "Tax return rates",
   "body": "The $200K+ income, capital gains and self-employment figures are IRS shares of tax returns in each ZIP. They describe the ZIP, not individual households, so they show as columns and aren't applied to the count."
  },
  {
   "title": "Reaching these candidates",
   "body": "Job title, seniority and employer targeting is available on LinkedIn, not from these counts. Use the ZIPs here for channels that target by geography, such as streaming TV, programmatic display and direct mail, and to set the geography for LinkedIn and search campaigns."
  }
 ]
};
