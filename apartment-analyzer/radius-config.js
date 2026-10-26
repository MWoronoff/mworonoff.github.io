/* Zip Code Radius Tool settings for this analyzer (opened from Geography > Radius on the analyzer page). */
window.ADTAXI_RADIUS = {
  title: "Zip Code Radius Tool - Apartments",
  subtitle: "Pick a property's ZIP or town and a radius, then choose the renters you want to reach to see how many live there and which ZIPs over-index.",
  logo: "../shared/adtaxi-logo.svg",
  exportName: "apartment-radius",
  links: [ { label: "Apartment Market Analyzer", url: "./" }, { label: "Home", url: "../analyzers/" } ],
  audienceData: "../shared/audience/zip_audience.json",
  extraData: [ { url: "../shared/audience/zip_audience_legal.json", label: "Renter and owner households by age" },
                { url: "../shared/audience/zip_audience_enroll.json", label: "College enrollment by age" },
               { url: "../shared/audience/zip_audience_apt.json", label: "Renter household data" } ],
  zipGeo: "../shared/geo/zip/{level}/{id}.json",
  customArea: true, countiesFirst: true, blendScore: true,   // Geography > Custom area: a list or file of ZIPs, counties, towns or locations
  ageSet: "adult",
  radii: [5, 10, 15, 25, 100],
  radiusLabels: { 100: "50+ miles (covers up to 100)" },
  radiusLabel: "Up to {r} miles",
  filters: ["age", "renter", "rinc", "rtype", "rmoved", "rburden", "enrolled"],
  profileLabel: "Target audience",
  profiles: [
    { id: "all", filters: ["age", "renter", "rinc", "rtype", "rmoved", "rburden"], label: "All apartments", note: "Adults renting in apartment buildings with 5 or more units.", sel: { rtype: ["apt"] } },
    { id: "luxury", filters: ["age", "rinc", "rtype", "rmoved"], label: "Luxury / Class A", note: "Adults renting in apartment buildings, in renter households earning $100K+.", sel: { rinc: ["100_150", "150p"], rtype: ["apt"] } },
    { id: "mid", filters: ["age", "rinc", "rtype", "rmoved", "rburden"], label: "Mid-market / workforce", note: "Adults renting in apartment buildings, in renter households earning $35K–$99K.", sel: { rinc: ["35_50", "50_75", "75_100"], rtype: ["apt"] } },
    { id: "affordable", filters: ["age", "rinc", "rtype", "rburden"], label: "Affordable housing", note: "Adults in renter households earning under $35K.", sel: { rinc: ["lt35"] } },
    { id: "student", filters: ["age", "renter", "rtype", "enrolled"], label: "Student housing", note: "Renters 18–24 enrolled in college or graduate school.", sel: { age: ["18_24"], renter: true, enrolled: true } },
    { id: "senior", filters: ["age", "renter", "rinc", "rtype"], label: "Active adult / 55+", note: "Renters 55 and older.", sel: { age: ["55p"], renter: true } }
  ],
  methodology: [
    { title: "Renter rate by age", body: "Census reports whether a household rents by the age of the head of household, so the tool uses each age group's own renter rate. Counts are adults living in renter households." },
    { title: "Advertising rules", body: "Housing ads fall under fair housing rules: Meta and Google don't allow age, gender or ZIP targeting for them, and family status can't be used to select renters. Use these counts to size the market and plan channels that allow geographic targeting, such as streaming TV, programmatic display and direct mail. Age-restricted (55+) communities are an exception for age." },
    { title: "Student housing", body: "College enrollment uses the ZIP's own enrollment rate for 18–24 year-olds (Census counts everyone in college or graduate school, including students in dorms), combined with the renter rate for that age as an estimate of students renting off campus." }
  ]
};
