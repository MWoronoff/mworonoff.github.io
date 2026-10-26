/* Zip Code Radius Tool settings for this analyzer (written by data-build/build_franchise_pages.py). */
window.ADTAXI_RADIUS = {
 "title": "Zip Code Radius Tool - Franchise Development",
 "subtitle": "Pick a center ZIP or town and a radius (or map a custom area), then choose the owner profile to see how many candidates live there and which ZIPs over-index.",
 "logo": "../shared/adtaxi-logo.svg",
 "exportName": "franchise-radius",
 "links": [
  {
   "label": "Franchise Development Analyzer",
   "url": "./"
  },
  {
   "label": "Home",
   "url": "../analyzers/"
  }
 ],
 "audienceData": "../shared/audience/zip_audience.json",
 "extraData": [
  {
   "url": "../shared/audience/zip_audience_fin.json",
   "label": "Tax return data",
   "source": "IRS Statistics of Income ZIP data"
  },
  {
   "url": "../shared/audience/zip_audience_inc.json",
   "label": "Household income at $125K",
   "source": "Census ACS household income (B19001)"
  }
 ],
 "zipGeo": "../shared/geo/zip/{level}/{id}.json",
 "planScript": "../shared/media-plan.js?v=20261026h",
 "mediaMixUrl": "../media-mix/",
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
  "income8",
  "veterans"
 ],
 "profileLabel": "Owner profile",
 "proposal": {
  "nouns": {
   "exec": "adults who fit the master franchise candidate profile",
   "owner": "adults who fit the first-time franchise buyer profile"
  },
  "goals": {
   "awareness": "Awareness among potential franchise owners in the top candidate ZIPs",
   "leads": "Qualified franchise inquiries and discovery calls",
   "online": "Visits to the franchise opportunity site and completed inquiry forms",
   "offline": "Discovery calls and Discovery Day attendance",
   "growth": "New potential owners plus captured franchise searches"
  },
  "jobs": {
   "search": "Captures people already researching franchise ownership, such as \"franchise opportunities\" and searches for the concept's category.",
   "social": "Reaches the owner profile by age, income and location in the top candidate ZIPs, with lead forms that pre-qualify on capital and timeline.",
   "ctv": "Tells the ownership story on the big screen to households in the top candidate ZIPs.",
   "youtube": "Video that explains the opportunity to people researching business ownership, targeted by interest and ZIP.",
   "display": "Keeps the opportunity in front of the owner profile across websites and apps in the top candidate ZIPs.",
   "retarget": "Brings back visitors to the franchise site who haven't inquired yet; franchise decisions take months.",
   "audio": "Reaches commuting professionals with the ownership message during podcasts and streaming audio.",
   "dooh": "Builds local presence for the brand where candidates work and commute."
  },
  "drives": "visits to the franchise site and branded searches",
  "note": "Franchise leads: the 2026 Annual Franchise Development Report puts average cost per lead at $142 to $802 and average cost per franchise sale at $6,700 to $25,145, depending on the sector; this proposal doesn't forecast sales."
 },
 "audienceNoun": "Qualified adults",
 "audienceFit": "fit the {profile} profile by age and income",
 "leadWithIndex": true,
 "summaryNote": "A planning pool, not a buyer count: only a small fraction of qualified adults buy a franchise in any year. The index shows where candidates are most concentrated, so use it to decide where to spend.",
 "profiles": [
  {
   "id": "exec",
   "label": "Master franchise candidates",
   "note": "Adults 35 and older in households earning $125K+, including first-time franchise buyers. IRS shares of returns with $200K+ income and with capital gains, and the share of adults with a bachelor's degree or higher, show by ZIP.",
   "sel": {
    "age": [
     "35_44",
     "45_54",
     "55p"
    ],
    "income8": [
     "125_150",
     "150_200",
     "200p"
    ]
   },
   "context": [
    "hi200",
    "cg",
    "ba"
   ]
  },
  {
   "id": "owner",
   "label": "First-time franchise buyers",
   "note": "Adults 35 and older in households earning $100K+: most people who buy a business are 40 to 60, often making a career change. The IRS share of returns with $200K+ income shows by ZIP.",
   "sel": {
    "age": [
     "35_44",
     "45_54",
     "55p"
    ],
    "income8": [
     "100_125",
     "125_150",
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
   "title": "Qualified adults vs. buyers",
   "body": "Qualified adults are everyone who fits the owner profile's age and income, the pool that ads can reach. Only a small fraction buy a franchise in any year (the industry adds roughly 12,000 to 13,000 net new units a year, and many go to existing multi-unit owners), so the count sizes the reachable audience, not the number of buyers. The index is the better guide to where to spend."
  },
  {
   "title": "Age",
   "body": "First-time buyers start at 35: most people who buy a business are 40 to 60 (BizBuySell Small Business Study). Census age groups end at 55 and older, so that group includes some retirees."
  },
  {
   "title": "ZIP-wide rates",
   "body": "The $200K+ income, capital gains and self-employment figures are IRS shares of tax returns in each ZIP, and Bachelor's+ is the Census share of adults 25+ with a bachelor's degree or higher. They describe the ZIP, not individual households, so they show as columns and aren't applied to the count. Census doesn't publish education by age and income for ZIPs, and degrees are far more common among high earners than among all adults, so applying the ZIP rate would badly undercount."
  },
  {
   "title": "Reaching these candidates",
   "body": "Census doesn't publish job titles or net worth by ZIP, so these counts describe the owner profile by age and household income. Use the top ZIPs to set the geography for search, Meta, streaming TV, programmatic display and direct mail, and to pick where a franchise's markets have the most candidates."
  }
 ]
};
