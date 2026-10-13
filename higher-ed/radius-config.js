/* Zip Code Radius Tool settings for this analyzer (opened from Geography > Radius on the analyzer page). */
window.ADTAXI_RADIUS = {
  title: "Zip Code Radius Tool - Higher Education",
  subtitle: "Pick a center ZIP or town and a radius, then choose the audience to see how many people it reaches and which ZIPs over-index.",
  logo: "../shared/adtaxi-logo.svg",
  exportName: "higher-ed-radius",
  links: [ { label: "Higher Education Market Analyzer", url: "./" }, { label: "All analyzers", url: "../analyzers/" } ],
  audienceData: "../shared/audience/zip_audience.json",
  zipGeo: "../shared/geo/zip/{level}/{id}.json",
  radii: [5, 10, 15, 25, 50, 100, 200, 300],
  radiusLabel: "Up to {r} miles",
  filters: ["age", "income5", "parented", "enrolled", "somecollege", "veterans", "hispanic"],
  profileLabel: "Best prospects for",
  profiles: [
    { id: "fouryear", label: "Four-year colleges and universities", note: "Ages 15–24 in households with income of $75K or more.", sel: { age: ["15_17", "18_24"], income5: ["75_100", "100_150", "150p"] } },
    { id: "community", label: "Community colleges", note: "Ages 18–34 in households with income under $75K.", sel: { age: ["18_24", "25_34"], income5: ["lt50", "50_75"] } },
    { id: "trade", label: "Trade and career schools", note: "Ages 18–34 in households whose head has no college.", sel: { age: ["18_24", "25_34"], parented: ["nocol"] } },
    { id: "graduate", label: "Graduate and professional programs", note: "Ages 25–44 in households whose head has a bachelor's degree or higher.", sel: { age: ["25_34", "35_44"], parented: ["ba"] } },
    { id: "adult", label: "Adult and online degree completion", note: "Ages 25–54 who started college but didn't finish.", sel: { age: ["25_34", "35_44", "45_54"], somecollege: true } }
  ],
  methodology: [
    { title: "Graduate program prospects", body: "Census doesn't publish, by ZIP, how many people of each age hold a bachelor's degree, so the Graduate profile uses the household head's education. For adults 25–44, who usually head their own household, this is a close stand-in." }
  ]
};
