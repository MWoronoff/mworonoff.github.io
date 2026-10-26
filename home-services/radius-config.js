/* Zip Code Radius Tool settings for this analyzer (opened from Geography > Radius on the analyzer page). */
window.ADTAXI_RADIUS = {
  title: "Zip Code Radius Tool - Home Services",
  subtitle: "Pick a center ZIP or town and a radius, then choose the homeowners you want to reach to see how many live there and which ZIPs over-index.",
  logo: "../shared/adtaxi-logo.svg",
  exportName: "home-services-radius",
  links: [ { label: "Home Services Market Analyzer", url: "./" }, { label: "Home", url: "../analyzers/" } ],
  audienceData: "../shared/audience/zip_audience.json",
  extraData: [ { url: "../shared/audience/zip_audience_legal.json", label: "Homeowner and home value data" },
               { url: "../shared/audience/zip_audience_home.json", label: "Year built, home type and years in the home data" } ],
  zipGeo: "../shared/geo/zip/{level}/{id}.json",
  ageSet: "adult",
  radii: [5, 10, 15, 25, 50, 100],
  radiusLabel: "Up to {r} miles",
  customArea: true, countiesFirst: true, blendScore: true,   // Geography > Custom area: a list or file of ZIPs, counties, towns or locations (pilot, Oct 2026)
  filters: ["age", "income4", "built", "ownval", "sfd", "longten"],
  profileLabel: "Target audience",
  profiles: [
    { id: "any", label: "Any home service", note: "Homeowners 35 and older in single-family detached homes built before 2000.", sel: { age: ["35_44", "45_54", "55p"], built: ["pre1980", "80_99"], sfd: true } },
    { id: "hvac", label: "HVAC", note: "Homeowners 35 and older in homes built before 2000, when original systems are due for replacement.", sel: { age: ["35_44", "45_54", "55p"], built: ["pre1980", "80_99"] } },
    { id: "roof", label: "Roofing and gutters", note: "Owners of single-family detached homes built before 2000.", sel: { built: ["pre1980", "80_99"], sfd: true } },
    { id: "plumb", label: "Plumbing", note: "Homeowners in homes built before 1980, when aging pipes and water heaters drive repairs.", sel: { built: ["pre1980"] } },
    { id: "elec", label: "Electrical", note: "Owners of homes built before 1980 worth $200K or more, the likeliest to update wiring and panels.", sel: { built: ["pre1980"], ownval: ["200_400", "400_750", "750p"] } },
    { id: "paint", label: "Painting and wallpaper", note: "Owners of homes worth $200K or more who have lived there since before 2010, the likeliest to hire out repainting.", sel: { ownval: ["200_400", "400_750", "750p"], longten: true } },
    { id: "floor", label: "Flooring", note: "Owners of homes built before 2000 who have lived there since before 2010, when original floors get replaced.", sel: { built: ["pre1980", "80_99"], longten: true } },
  ],
  methodology: [
    { title: "Year built and home type", body: "Census publishes year built, units in the building and the year the owner moved in for owner-occupied homes in each ZIP, but not by the owner's age. So an owner selection applies each age group's homeownership rate, and the home traits apply the ZIP's share among all owner homes." },
    { title: "Income and home traits", body: "Household income comes from a separate table covering every household, so combining income with homeowner traits assumes they're independent within the ZIP. Owners tend to earn more than renters, so counts of higher-income owners are likely conservative." }
  ]
};
