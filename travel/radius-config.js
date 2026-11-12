/* Zip Code Radius Tool settings for this analyzer (opened from Geography > Radius on the analyzer page). */
window.ADTAXI_RADIUS = {
  title: "Zip Code Radius Tool - Travel",
  subtitle: "Pick a center ZIP or town and a radius, then choose the travelers you want to reach to see how many live there and which ZIPs over-index.",
  logo: "../shared/adtaxi-logo.svg",
  exportName: "travel-radius",
  links: [ { label: "Travel Market Analyzer", url: "./" }, { label: "Home", url: "../analyzers/" } ],
  audienceData: "../shared/audience/zip_audience.json",
  extraData: [
    { url: "../shared/audience/zip_audience_legal.json", label: "Home and employment data" }
  ],
  zipGeo: "../shared/geo/zip/{level}/{id}.json",
  customArea: true, countiesFirst: true, blendScore: true,   // Geography > Custom area: a list or file of ZIPs, counties, towns or locations
  ageSet: "adult",
  radii: [5, 10, 15, 25, 50, 100, 150, 200, 300, 400, 500],
  radiusLabel: "Up to {r} miles",
  filters: ["gender", "age", "income", "kids", "home"],
  profileLabel: "Target audience",
  profiles: [
    { id: "hotels", filters: ["gender", "age", "income", "kids", "home"], label: "Hotels and lodging",
      note: "Adults 25–54 with household income of $100K or more: hotel and motel guests over-index at ages 25–64 and $100K+ (Scarborough). Includes short-term rental and B&B guests, who skew younger and wealthier. Guests typically travel up to about 150 miles (AdMall).",
      sel: { age: ["25_34", "35_44", "45_54"], income: ["100_150", "150_200", "200p"] } },
    { id: "resorts", filters: ["gender", "age", "income", "kids", "home"], label: "Resorts",
      note: "Adults 45 and older with household income of $100K or more: baby boomers, honeymoon couples and affluent families. Guests typically travel about 284 miles (AdMall).",
      sel: { age: ["45_54", "55p"], income: ["100_150", "150_200", "200p"] } },
    { id: "cruises", filters: ["gender", "age", "income", "kids", "home"], label: "Cruises",
      note: "Adults 45 and older with household income of $75K or more: cruise passengers over-index at ages 45+ and $75K+, most of all married couples (Scarborough). Half of cruisers will drive up to 500 miles to a port (AdMall).",
      sel: { age: ["45_54", "55p"], income: ["75_100", "100_150", "150_200", "200p"] } },
    { id: "casinos", filters: ["gender", "age", "income", "home"], label: "Casinos",
      note: "Adults 35–54 with household income of $75K or more: casino visitors over-index at ages 35–64 and $75K+ (Scarborough). Most guests come from within 50 miles (AdMall).",
      sel: { age: ["35_44", "45_54"], income: ["75_100", "100_150", "150_200", "200p"] } },
    { id: "tours", filters: ["gender", "age", "income", "kids", "home"], label: "Tour operators",
      note: "Adults 35–54 with household income of $150K or more: foreign travelers over-index at ages 35–64 and climb with income (index 210 at $250K+; Scarborough). Customers typically travel up to about 300 miles (AdMall).",
      sel: { age: ["35_44", "45_54"], income: ["150_200", "200p"] } },
    { id: "cvb", filters: ["gender", "age", "income", "kids", "home"], label: "Visitors bureaus",
      note: "Adults 25–54 with household income of $75K or more: family travelers and weekend visitors in feeder markets. Visitors typically come from within about 150 miles (AdMall).",
      sel: { age: ["25_34", "35_44", "45_54"], income: ["75_100", "100_150", "150_200", "200p"] } }
  ],
  methodology: [
    { title: "Travel distance", body: "Each audience's note gives the typical distance guests travel for that category (AdMall). Travel businesses draw from far away, so radii run up to 500 miles; a large radius covers many ZIPs and takes a moment to load." },
    { title: "Combining traits", body: "Traits are combined as if they were independent within a ZIP. Traits that go together (higher income and older age, for example) are more common together than that, so a selection that combines them is a conservative estimate." }
  ]
};
