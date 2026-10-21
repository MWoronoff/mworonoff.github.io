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
  filters: ["gender", "age", "income5", "insurance", "conditions", "nodental", "hearing", "vision", "alone"],
  profileLabel: "Best prospects for",
  profiles: [
    { id: "urgent", label: "Urgent and emergency care", note: "Families: children and adults under 65 with health insurance.",
      sel: { age: ["u18", "18_34", "35_64"], insurance: ["ins"] } },
    { id: "pharmacy", label: "Pharmacy", note: "Adults 65 and older, or adults with diabetes or high blood pressure.",
      sel: { age: ["18_34", "35_64", "65_74", "75p"] },
      either: [ { text: "age 65+", sel: { age: ["65_74", "75p"] } }, { text: "diabetes or high blood pressure", sel: { conditions: ["diabetes", "bphigh"] } } ] },
    { id: "dental", label: "Dental", note: "Adults 18–64 with household income of $75K or more and health insurance. Add \u201cNo dental visit in the past year\u201d to find patients overdue for care.",
      sel: { age: ["18_34", "35_64"], income5: ["75_100", "100_150", "150p"], insurance: ["ins"] } },
    { id: "hearing", label: "Hearing and audiology", note: "Adults 65 and older with hearing difficulty.",
      sel: { age: ["65_74", "75p"], hearing: true } },
    { id: "eye", label: "Eye care", note: "Adults 35 and older with vision difficulty or diabetes.",
      sel: { age: ["35_64", "65_74", "75p"] },
      either: [ { text: "vision difficulty", sel: { vision: true } }, { text: "diabetes", sel: { conditions: ["diabetes"] } } ] },
    { id: "chiro", label: "Chiropractic and physical therapy", note: "Adults 35–64 with arthritis or obesity.",
      sel: { age: ["35_64"], conditions: ["arthritis", "obesity"] } },
    { id: "behavioral", label: "Behavioral health", note: "Adults 18–64 with depression or frequent mental distress, with health insurance.",
      sel: { age: ["18_34", "35_64"], conditions: ["depression", "mhlth"], insurance: ["ins"] } },
    { id: "medspa", label: "Med spa and aesthetics", note: "Women 35–64 with household income of $100K or more.",
      sel: { gender: ["f"], age: ["35_64"], income5: ["100_150", "150p"] } },
    { id: "senior", label: "Senior and home care", note: "Adults 75 and older living alone.",
      sel: { age: ["75p"], alone: true } }
  ],
  methodology: [
    { title: "No dental visit", body: "The CDC PLACES share of adults who haven't seen a dentist in the past year, from the same release and with the same fills as the condition rates. Children are never counted." },
    { title: "Health conditions", body: "Condition rates are CDC PLACES estimates of the share of adults with each condition in the ZIP. They're the same rates the Healthcare Market Analyzer scores use, including its county and modeled values where CDC leaves a ZIP blank (most of Pennsylvania and Kentucky). Children are never counted, and choosing more than one condition counts adults with any of them, treating the conditions as independent. CDC publishes one rate for all adults, so a condition combined with an age group uses the all-adult rate; for conditions that rise with age, such as arthritis and high blood pressure, seniors are undercounted and younger adults overcounted." },
    { title: "Insurance, hearing and vision", body: "These come from Census tables published by age, so they use each age group's own rate. Census groups insurance ages slightly differently (under 19 and 19 to 34), so the under-18 and 18–34 rates are close approximations." },
    { title: "Lives alone", body: "Adults living alone in a household, from Census, using the 18–34, 35–64 and 65+ rates. People in nursing homes and other group quarters aren't counted as living alone." }
  ]
};
