/* Zip Code Radius Tool settings for this analyzer (opened from Geography > Radius on the analyzer page). */
window.ADTAXI_RADIUS = {
  title: "Zip Code Radius Tool - Legal",
  subtitle: "Pick a center ZIP or town and a radius, then choose the clients you want to reach to see how many live there and which ZIPs over-index.",
  logo: "../shared/adtaxi-logo.svg",
  exportName: "legal-radius",
  links: [ { label: "Legal Market Analyzer", url: "./" }, { label: "Home", url: "../analyzers/" } ],
  audienceData: "../shared/audience/zip_audience.json",
  extraData: [ { url: "../shared/audience/zip_audience_legal.json", label: "Home, home value and employment data" } ],
  zipGeo: "../shared/geo/zip/{level}/{id}.json",
  customArea: true,   // Geography > Custom area: a list or file of ZIPs, counties, towns or locations
  ageSet: "adult",
  radii: [5, 10, 15, 25, 50, 100],
  radiusLabel: "Up to {r} miles",
  filters: ["age", "income5", "home", "employ", "car", "divsep", "poverty", "lep"],
  profileLabel: "Best prospects for",
  profiles: [
    { id: "pi", label: "Personal injury", note: "Employed adults who commute by car.", sel: { employ: ["emp"], car: true } },
    { id: "family", label: "Family law and divorce", note: "Adults 25–54 who are divorced or separated.", sel: { age: ["25_34", "35_44", "45_54"], divsep: true } },
    { id: "estate", label: "Estate planning and elder law", note: "Homeowners 55 and older.", sel: { age: ["55p"], home: ["ownlt200", "own200_400", "own400_750", "own750p"] } },
    { id: "bankruptcy", label: "Bankruptcy and debt relief", note: "Adults 25–54 with household income under $50K.", sel: { age: ["25_34", "35_44", "45_54"], income5: ["lt50"] } },
    { id: "employment", label: "Employment law", note: "Adults 25–54 in the workforce, employed or recently unemployed.", sel: { age: ["25_34", "35_44", "45_54"], employ: ["emp", "unemp"] } }
  ],
  methodology: [
    { title: "Family law prospects", body: "Census counts people who are already divorced or separated, not married couples heading toward divorce, so the Family law profile is strongest for custody, support and modification cases." },
    { title: "Home and home value", body: "Owner and renter shares come from Census by the age of the head of household, so they use each age group's own rate; a homeowner 55+ selection uses the share of households headed by someone 55 or older that own their home. Home value bands are the share of owner-occupied homes in each value range in the ZIP." },
    { title: "Employment and commuting", body: "Employment status is the share of people 16 and older. Everyone who commutes by car is employed, so combining Commutes by car with Employed doesn't count employment twice." }
  ]
};
