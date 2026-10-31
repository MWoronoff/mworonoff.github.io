/* Zip Code Radius Tool settings for this analyzer (written by data-build/build_franchise_pages.py). */
window.ADTAXI_RADIUS = {
 "title": "Zip Code Radius Tool - Franchise Development",
 "subtitle": "Pick a center ZIP or town and a radius (or map a custom area), then choose the owner profile to see how many candidate households live there and which ZIPs over-index.",
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
   "label": "Household income at $125K and ages 55–64",
   "source": "Census ACS household income (B19001) and sex by age (B01001)"
  },
  {
   "url": "../shared/audience/zip_audience_hh.json",
   "label": "Households by householder age and income",
   "source": "Census ACS age of householder by household income (B19037) and home value (B25075)"
  }
 ],
 "zipGeo": "../shared/geo/zip/{level}/{id}.json",
 "planScript": "../shared/media-plan.js?v=20261031d",
 "mediaMixUrl": "../media-mix/",
 "planCategory": "none",
 "customArea": true,
 "countiesFirst": true,
 "blendScore": true,
 "planExtend": {
  "channels": {
   "linkedin": {
    "label": "LinkedIn",
    "short": "LinkedIn",
    "role": "consideration",
    "prog": false,
    "term": 3,
    "color": "#0a66c2",
    "placeholder": true,
    "job": "Reaches professionals by job title, seniority, industry and company size: the closest match to the executives and business owners who buy franchises, with lead forms that fill from their profiles."
   }
  },
  "weights": {
   "leads": {
    "linkedin": 28
   },
   "awareness": {
    "linkedin": 10
   },
   "growth": {
    "linkedin": 15
   }
  },
  "minimums": {
   "linkedin": 3000
  },
  "mgmtPct": {
   "linkedin": 0.2
  },
  "cpm": {
   "linkedin": 45
  },
  "tiers": [
   "Tier 3",
   "Tier 2",
   "Strategic"
  ]
 },
 "ageSet": "householder",
 "hhCount": true,
 "spreadBy": "score",
 "persona": {
  "titles": {
   "exec": "The established executive household",
   "owner": "The established professional household"
  },
  "kickers": {
   "exec": "Master franchise candidate household",
   "owner": "First-time franchise buyer household"
  },
  "rates": [
   "ba",
   "grad",
   "mgmt",
   "hi200",
   "cg",
   "married",
   "kids",
   "sfd",
   "val500",
   "vets"
  ],
  "national": {
   "exec": {
    "tag": "National survey · blended AudienceSCAN groups",
    "weights": "blended executive managers 50%, financial planning clients 25%, small business owners 25%",
    "items": [
     [
      "Men",
      59.9,
      50.0
     ],
     [
      "Age 25–44",
      47.5,
      34.4
     ],
     [
      "Age 45–64",
      34.6,
      30.9
     ],
     [
      "Household income $150K+",
      44.2,
      24.0
     ],
     [
      "Own their home",
      83.2,
      63.0
     ],
     [
      "Live in a city",
      53.9,
      38.9
     ],
     [
      "Live in a suburb",
      34.8,
      41.8
     ]
    ],
    "mindset": {
     "title": "Small business owners' plans (national)",
     "items": [
      [
       "Want to start a business in the next year",
       14.7,
       9.5
      ],
      [
       "Want to invest more",
       23.9,
       18.7
      ],
      [
       "Plan to buy an investment property",
       8.8,
       5.7
      ]
     ]
    }
   },
   "owner": {
    "tag": "National survey · blended AudienceSCAN groups",
    "weights": "blended executive managers 25%, financial planning clients 25%, small business owners 50%",
    "items": [
     [
      "Men",
      57.2,
      50.0
     ],
     [
      "Age 25–44",
      43.8,
      34.4
     ],
     [
      "Age 45–64",
      34.7,
      30.9
     ],
     [
      "Household income $150K+",
      39.0,
      24.0
     ],
     [
      "Own their home",
      78.8,
      63.0
     ],
     [
      "Live in a city",
      47.3,
      38.9
     ],
     [
      "Live in a suburb",
      38.3,
      41.8
     ]
    ],
    "mindset": {
     "title": "Small business owners' plans (national)",
     "items": [
      [
       "Want to start a business in the next year",
       14.7,
       9.5
      ],
      [
       "Want to invest more",
       23.9,
       18.7
      ],
      [
       "Plan to buy an investment property",
       8.8,
       5.7
      ]
     ]
    }
   }
  },
  "source": "Sources: Census ACS 5-year 2020–2024, IRS Statistics of Income 2022, 2026 AudienceSCAN® (Executive Managers, Financial/Retirement Planning Clients and Small Business Owners)."
 },
 "audienceUnit": "households",
 "shareLabel": "Share of households",
 "shareShort": "Share",
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
   "exec": "households that fit the master franchise candidate profile",
   "owner": "households that fit the first-time franchise buyer profile"
  },
  "audCol": "Prospect households",
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
 "audienceNoun": "Qualified households",
 "audienceFit": "fit the {profile} profile by householder age and household income",
 "leadWithIndex": true,
 "summaryNote": "A planning pool, not a buyer count: only a small fraction of qualified households buy a franchise in any year. The index shows where candidates are most concentrated, so use it to decide where to spend.",
 "profiles": [
  {
   "id": "exec",
   "label": "Master franchise candidates",
   "note": "Households headed by someone 45–64 earning $125K+, counted directly by Census, including first-time franchise buyers (add 25–44 to widen). ZIP-wide signals feed the Score in two equal groups: affluence ($200K+ income, capital gains) and background (bachelor's degrees, managers). Self-employment and $500K+ homes show for context.",
   "sel": {
    "age": [
     "4564"
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
    "selfemp",
    "ba",
    "mgmt",
    "val500"
   ],
   "scoreGroups": [
    [
     "hi200",
     "cg"
    ],
    [
     "ba",
     "mgmt"
    ]
   ]
  },
  {
   "id": "owner",
   "label": "First-time franchise buyers",
   "note": "Households headed by someone 25–64 earning $100K+, counted directly by Census: most people who buy a business are 40 to 60, often making a career change. The ZIP-wide $200K+ income share feeds the Score; self-employment and $500K+ homes show for context.",
   "sel": {
    "age": [
     "2544",
     "4564"
    ],
    "income8": [
     "100_125",
     "125_150",
     "150_200",
     "200p"
    ]
   },
   "context": [
    "hi200",
    "selfemp",
    "val500"
   ],
   "scoreGroups": [
    [
     "hi200"
    ]
   ]
  }
 ],
 "methodology": [
  {
   "title": "Who counts",
   "body": "Counts are households, by the householder's age and the household's income, taken directly from one Census table (age of householder by household income), so an age and income selection is a count, not an estimate. One household is one potential buyer. Census groups householders as 25 to 44, 45 to 64 and 65 and older. Share and index compare qualified households with all households. Census doesn't publish net worth or job titles by ZIP, so household income stands in for capital, and the ZIP-wide signals in the Score add the rest."
  },
  {
   "title": "Qualified households vs. buyers",
   "body": "Qualified households are every household that fits the owner profile's age and income, the pool that ads can reach. Only a small fraction buy a franchise in any year (the industry adds roughly 12,000 to 13,000 net new units a year, and many go to existing multi-unit owners), so the count sizes the reachable audience, not the number of buyers. The index is the better guide to where to spend."
  },
  {
   "title": "Age",
   "body": "Most people who buy a business are 40 to 60 (BizBuySell Small Business Study). Census reports householders only as 25 to 44, 45 to 64 and 65 and older, so master franchise candidates use 45 to 64 (the same group as the market scores) and first-time buyers use 25 to 64."
  },
  {
   "title": "ZIP-wide rates",
   "body": "The $200K+ income, capital gains and self-employment figures are IRS shares of tax returns in each ZIP, and $500K+ homes is the Census share of owner-occupied homes valued at $500,000 or more. Bachelor's+ is the Census share of adults 25+ with a bachelor's degree or higher, and Managers is the Census share of employed people in management occupations. They describe the ZIP, not individual households, so they aren't applied to the count; they count toward the Score instead. Census doesn't publish education by age and income for ZIPs, and degrees are far more common among high earners than among all adults, so applying the ZIP rate would badly undercount."
  },
  {
   "title": "Score",
   "body": "The Score (0–100) ranks the trade area's counties and ZIPs against each other: 40% index (how concentrated candidates are), 30% estimated audience (how many there are) and 30% the profile's ZIP-wide signals (master franchise candidates: two equal groups, affluence = $200K+ income and capital gains, background = bachelor's+ and managers; first-time buyers: $200K+ income). Grouping keeps overlapping signals from counting twice: across ZIPs, $200K+ income, capital gains and bachelor's+ rise and fall together. Self-employment shows for context only: the IRS count mixes gig and side income with business owners, so it barely varies with income across ZIPs and, in market scores, would lift border and Gulf Coast markets with much gig work rather than places with more franchise candidates. Dividends (which track capital gains almost exactly) and homes owned free and clear (most common in older, rural, lower-value areas, so it ran opposite to candidate concentration) were tested and left out. $500K+ homes shows for context only: it mostly repeats income and tilts toward high-cost areas. Each part is a percentile among the area's counties or ZIPs, so the same ZIP can score differently in a different trade area. Counties come first, then ZIPs. ZIPs and county parts under 1,000 residents aren't scored."
  },
  {
   "title": "Reaching these candidates",
   "body": "Census doesn't publish job titles or net worth by ZIP, so these counts describe the owner profile by age and household income. Use the top ZIPs to set the geography for search, Meta, streaming TV, programmatic display and direct mail, and to pick where a franchise's markets have the most candidates."
  }
 ]
};
