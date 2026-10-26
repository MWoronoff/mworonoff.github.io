/* Zip Code Radius Tool settings for this analyzer (opened from Geography > Radius on the analyzer page). */
window.ADTAXI_RADIUS = {
  title: "Zip Code Radius Tool - Healthcare",
  subtitle: "Pick a center ZIP or town and a radius, then choose the patients you want to reach to see how many live there and which ZIPs over-index.",
  logo: "../shared/adtaxi-logo.svg",
  exportName: "healthcare-radius",
  links: [ { label: "Healthcare Market Analyzer", url: "./" }, { label: "Home", url: "../analyzers/" } ],
  audienceData: "../shared/audience/zip_audience.json",
  extraData: [
    { url: "../shared/audience/zip_audience_health.json", label: "Insurance, hearing, vision and living-alone data" },
    { url: "data/zip_conditions.json", label: "Health condition data", source: "Health conditions: CDC PLACES",
      columns: ["diabetes", "bphigh", "arthritis", "obesity", "depression", "mhlth", "fairpoor", "nodental"] }
  ],
  zipGeo: "../shared/geo/zip/{level}/{id}.json",
  customArea: true,   // Geography > Custom area: a list or file of ZIPs, counties, towns or locations
  ageSet: "health",
  radii: [5, 10, 15, 25, 50, 100],
  radiusLabel: "Up to {r} miles",
  filters: ["gender", "age", "income5", "insurance", "hearing", "vision", "alone"],
  profileLabel: "Target audience",
  profiles: [
    { id: "urgent", label: "Urgent and emergency care", note: "Families: children and adults under 65 with health insurance.",
      sel: { age: ["u18", "18_34", "35_64"], insurance: ["ins"] } },
    { id: "pharmacy", label: "Pharmacy", note: "Adults 65 and older. Diabetes and high blood pressure rates (CDC) show by ZIP.",
      sel: { age: ["65_74", "75p"] }, context: ["diabetes", "bphigh"] },
    { id: "dental", label: "Dental", note: "Adults 18–64 with household income of $75K or more and health insurance. The share of adults with no dental visit in the past year (CDC) shows by ZIP.",
      sel: { age: ["18_34", "35_64"], income5: ["75_100", "100_150", "150p"], insurance: ["ins"] }, context: ["nodental"] },
    { id: "hearing", label: "Hearing and audiology", note: "Adults 65 and older with hearing difficulty.",
      sel: { age: ["65_74", "75p"], hearing: true } },
    { id: "eye", label: "Eye care", note: "Adults 35 and older with vision difficulty. Diabetes rates (CDC) show by ZIP.",
      sel: { age: ["35_64", "65_74", "75p"], vision: true }, context: ["diabetes"] },
    { id: "chiro", label: "Chiropractic and physical therapy", note: "Adults 35–64, with ZIPs ranked by the share of adults with arthritis (CDC). Obesity shows alongside.",
      sel: { age: ["35_64"] }, context: ["arthritis", "obesity"], sortBy: "arthritis" },
    { id: "behavioral", label: "Behavioral health", note: "Adults 18–64 with health insurance, with ZIPs ranked by the share of adults with depression (CDC). Frequent mental distress shows alongside.",
      sel: { age: ["18_34", "35_64"], insurance: ["ins"] }, context: ["depression", "mhlth"], sortBy: "depression" },
    { id: "medspa", label: "Med spa and aesthetics", note: "Women 35–64 with household income of $100K or more.",
      sel: { gender: ["f"], age: ["35_64"], income5: ["100_150", "150p"] } },
    { id: "senior", label: "Senior and home care", note: "Adults 75 and older living alone.",
      sel: { age: ["75p"], alone: true } }
  ],
  methodology: [
    { title: "Health condition rates", body: "Diabetes, high blood pressure, arthritis, obesity, depression, frequent mental distress and no dental visit are CDC PLACES estimates of the share of adults in each ZIP, the same rates the Healthcare Market Analyzer scores use (with its county and modeled values where CDC leaves a ZIP blank). They show as ZIP columns with the matching preset. They describe the ZIP, not individual people, so they aren't applied to the audience count, and ad platforms don't allow targeting by health condition." },
    { title: "Insurance, hearing and vision", body: "These come from Census tables published by age, so they use each age group's own rate. Census groups insurance ages slightly differently (under 19 and 19 to 34), so the under-18 and 18–34 rates are close approximations." },
    { title: "Lives alone", body: "Adults living alone in a household, from Census, using the 18–34, 35–64 and 65+ rates. People in nursing homes and other group quarters aren't counted as living alone." }
  ]
};
