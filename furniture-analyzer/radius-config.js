/* Zip Code Radius Tool settings for this analyzer (opened from Geography > Radius on the analyzer page). */
window.ADTAXI_RADIUS = {
  title: "Zip Code Radius Tool - Furniture",
  subtitle: "Pick a center ZIP or town and a radius, then choose the buyers you want to reach to see how many live there and which ZIPs over-index.",
  logo: "../shared/adtaxi-logo.svg",
  exportName: "furniture-radius",
  links: [ { label: "Furniture Market Analyzer", url: "./" }, { label: "Home", url: "../analyzers/" } ],
  audienceData: "../shared/audience/zip_audience.json",
  extraData: [ { url: "../shared/audience/zip_audience_legal.json", label: "Home and home value data" } ],
  zipGeo: "../shared/geo/zip/{level}/{id}.json",
  customArea: true, countiesFirst: true, blendScore: true,   // Geography > Custom area: a list or file of ZIPs, counties, towns or locations
  ageSet: "adult",
  radii: [5, 10, 15, 25, 50, 100],
  radiusLabel: "Up to {r} miles",
  filters: ["age", "income5", "home"],
  profileLabel: "Target audience",
  profiles: [
    { id: "any", label: "Any furniture", note: "Adults 25–54 with household income of $50K or more. Furniture store customers typically come from within about 10 miles (AdMall).", sel: { age: ["25_34", "35_44", "45_54"], income5: ["50_75", "75_100", "100_150", "150p"] } },
    { id: "living", label: "Sofas and living room", note: "Adults 25–44 with household income of $50K or more. Furniture store customers typically come from within about 10 miles (AdMall).", sel: { age: ["25_34", "35_44"], income5: ["50_75", "75_100", "100_150", "150p"] } },
    { id: "bedroom", label: "Bedroom furniture", note: "Adults 25–44, the ages most often setting up a new home or a child's room. Furniture store customers typically come from within about 10 miles (AdMall).", sel: { age: ["25_34", "35_44"] } },
    { id: "mattress", label: "Mattresses", note: "Adults 18–34, the ages that move most often. Mattress store customers typically come from within about 20 miles (AdMall).", sel: { age: ["18_24", "25_34"] } },
    { id: "dining", label: "Kitchen and dining", note: "Homeowners 35–54. Furniture store customers typically come from within about 10 miles (AdMall).", sel: { age: ["35_44", "45_54"], home: ["ownlt200", "own200_400", "own400_750", "own750p"] } },
    { id: "outdoor", label: "Outdoor and patio", note: "Homeowners 35 and older with household income of $75K or more. Furniture store customers typically come from within about 10 miles (AdMall).", sel: { age: ["35_44", "45_54", "55p"], home: ["ownlt200", "own200_400", "own400_750", "own750p"], income5: ["75_100", "100_150", "150p"] } },
    { id: "baby", label: "Baby and nursery", note: "Adults 25–34, the main age for first-time parents. Furniture store customers typically come from within about 10 miles (AdMall).", sel: { age: ["25_34"] } }
  ],
  methodology: [
    { title: "Furniture audiences", body: "Each preset picks the Census ages, income and homeownership that fit its furniture line. You can change any selection after picking a preset." },
    { title: "Home and home value", body: "Owner and renter shares come from Census by the age of the head of household, so they use each age group's own rate. Home value bands are the share of owner-occupied homes in each value range in the ZIP." }
  ]
};
