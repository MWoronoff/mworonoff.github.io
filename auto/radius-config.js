/* Zip Code Radius Tool settings for this analyzer (opened from Geography > Radius on the analyzer page). */
window.ADTAXI_RADIUS = {
  title: "Zip Code Radius Tool - Auto",
  subtitle: "Pick a center ZIP or town and a radius, then choose the vehicle buyers you want to reach to see how many live there and which ZIPs over-index.",
  logo: "../shared/adtaxi-logo.svg",
  exportName: "auto-radius",
  links: [ { label: "Auto Market Analyzer", url: "./" }, { label: "Home", url: "../analyzers/" } ],
  audienceData: "../shared/audience/zip_audience.json",
  extraData: [
    { url: "../shared/audience/zip_audience_legal.json", label: "Home and employment data" },
    { url: "../shared/audience/zip_audience_auto.json", label: "Vehicle data", source: "Census ACS vehicles available (B25044)" }
  ],
  zipGeo: "../shared/geo/zip/{level}/{id}.json",
  customArea: true,   // Geography > Custom area: a list or file of ZIPs, counties, towns or locations
  ageSet: "adult",
  radii: [5, 10, 15, 25, 50, 100],
  radiusLabel: "Up to {r} miles",
  filters: ["gender", "age", "income", "vehicles", "car", "kids", "home"],
  profileLabel: "Target audience",
  profiles: [
    { id: "newcar", label: "New cars", note: "Adults 35 and older with household income of $100K or more.", sel: { age: ["35_44", "45_54", "55p"], income: ["100_150", "150_200", "200p"] } },
    { id: "newtruck", label: "New trucks and SUVs", note: "Adults 25–54 with household income of $75K or more in households with 2 or more vehicles.", sel: { age: ["25_34", "35_44", "45_54"], income: ["75_100", "100_150", "150_200", "200p"], vehicles: ["2", "3p"] } },
    { id: "usedcar", label: "Used cars", note: "Adults 18–44 with household income of $35K–$99K.", sel: { age: ["18_24", "25_34", "35_44"], income: ["35_50", "50_75", "75_100"] } },
    { id: "usedtruck", label: "Used trucks and SUVs", note: "Adults 25–54 with household income of $35K–$99K in households with 2 or more vehicles.", sel: { age: ["25_34", "35_44", "45_54"], income: ["35_50", "50_75", "75_100"], vehicles: ["2", "3p"] } }
  ],
  methodology: [
    { title: "Vehicles in household", body: "The share of households in the ZIP with no vehicle, 1, 2, or 3 or more vehicles available (Census), applied to the adults selected." },
    { title: "Combining traits", body: "Traits are combined as if they were independent within a ZIP. Traits that go together (higher income and more vehicles, for example) are more common together than that, so a selection that combines them is a conservative estimate." }
  ]
};
