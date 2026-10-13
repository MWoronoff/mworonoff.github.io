/* Zip Code Radius Tool settings for this analyzer (opened from Geography > Radius on the analyzer page). */
window.ADTAXI_RADIUS = {
  title: "Zip Code Radius Tool - Apartments",
  subtitle: "Pick a property's ZIP or town and a radius, then choose the renters you want to reach to see how many live there and which ZIPs over-index.",
  logo: "../shared/adtaxi-logo.svg",
  exportName: "apartment-radius",
  links: [ { label: "Apartment Market Analyzer", url: "./" }, { label: "All analyzers", url: "../analyzers/" } ],
  audienceData: "../shared/audience/zip_audience.json",
  extraData: [ { url: "../shared/audience/zip_audience_legal.json", label: "Renter and owner households by age" },
               { url: "../shared/audience/zip_audience_apt.json", label: "Renter household data" } ],
  zipGeo: "../shared/geo/zip/{level}/{id}.json",
  ageSet: "adult",
  radii: [5, 10, 15, 25, 100],
  radiusLabels: { 100: "50+ miles (covers up to 100)" },
  radiusLabel: "Up to {r} miles",
  filters: ["age", "renter", "rinc", "rtype", "rmoved", "rburden", "rkids", "enrolled"],
  profileLabel: "Best prospects for",
  profiles: [
    { id: "all", label: "All apartments", note: "Adults renting in apartment buildings with 5 or more units.", sel: { rtype: ["apt"] } },
    { id: "luxury", label: "Luxury / Class A", note: "Adults 25–44 renting in apartment buildings, in renter households earning $100K+.", sel: { age: ["25_34", "35_44"], rinc: ["100_150", "150p"], rtype: ["apt"] } },
    { id: "mid", label: "Mid-market / workforce", note: "Adults renting in apartment buildings, in renter households earning $35K–$99K.", sel: { rinc: ["35_50", "50_75", "75_100"], rtype: ["apt"] } },
    { id: "affordable", label: "Affordable housing", note: "Adults in renter households earning under $35K.", sel: { rinc: ["lt35"] } },
    { id: "student", label: "Student housing", note: "Renters 18–24 enrolled in college or graduate school.", sel: { age: ["18_24"], renter: true, enrolled: true } },
    { id: "senior", label: "Active adult / 55+", note: "Renters 55 and older.", sel: { age: ["55p"], renter: true } }
  ],
  methodology: [
    { title: "Renter rate by age", body: "Census reports whether a household rents by the age of the head of household, so the tool uses each age group's own renter rate. Counts are adults living in renter households." },
    { title: "Student housing", body: "College enrollment covers everyone in college or graduate school in the ZIP, including students in dorms, so it's combined with the renter rate for 18–24 year-olds as an estimate of students renting off campus." }
  ]
};
