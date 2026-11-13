/* Zip Code Radius Tool settings for this analyzer (opened from Geography > Radius on the analyzer page). */
window.ADTAXI_RADIUS = {
  title: "Zip Code Radius Tool - Financial",
  subtitle: "Pick a center ZIP or town and a radius, then choose the customers you want to reach to see how many live there and which ZIPs over-index.",
  logo: "../shared/adtaxi-logo.svg",
  exportName: "financial-radius",
  links: [ { label: "Financial Market Analyzer", url: "./" }, { label: "Home", url: "../analyzers/" } ],
  audienceData: "../shared/audience/zip_audience.json",
  extraData: [
    { url: "../shared/audience/zip_audience_legal.json", label: "Home and home value data" },
    { url: "../shared/audience/zip_audience_apt.json", label: "Renter data" },
    { url: "../shared/audience/zip_audience_home.json", label: "Years in home data" },
    { url: "../shared/audience/zip_audience_fin.json", label: "Tax return and mortgage data", source: "IRS Statistics of Income ZIP data" }
  ],
  zipGeo: "../shared/geo/zip/{level}/{id}.json",
  customArea: true, countiesFirst: true, blendScore: true,   // Geography > Custom area: a list or file of ZIPs, counties, towns or locations
  ageSet: "adult",
  radii: [5, 10, 15, 25, 50, 100],
  radiusLabel: "Up to {r} miles",
  filters: ["age", "income", "mortg", "renter", "mover", "kids"],
  profileLabel: "Target audience",
  profiles: [
    { id: "tax", filters: ["age", "income", "kids"], label: "Tax preparation", note: "Adults 45 and older with household income of $75K or more: tax preparation service users over-index at 45+ (index 107–135) and $75K+ (110–145; Scarborough). ZIPs are ranked by the share of tax returns filed by a paid preparer (IRS); the Earned Income Credit share shows alongside.", sel: { age: ["45_54", "55p"], income: ["75_100", "100_150", "150_200", "200p"] }, context: ["prep", "eitc"], sortBy: "prep" },
    { id: "wealth", filters: ["age", "income"], label: "Wealth management", note: "Adults 55 and older with household income of $100K or more: financial planner clients over-index at 55+ (index 137–177) and $250K+ (203; Scarborough). Dividend and capital gains shares (IRS) show by ZIP. Financial advisory clients typically come from within about 65 miles (AdMall).", sel: { age: ["55p"], income: ["100_150", "150_200", "200p"] }, context: ["div", "cg"] },
    { id: "retire", filters: ["age", "income"], label: "Retirement planning", note: "Adults 55 and older with household income of $75K or more. IRA and pension income shares (IRS) show by ZIP. Financial advisory clients typically come from within about 65 miles (AdMall).", sel: { age: ["55p"], income: ["75_100", "100_150", "150_200", "200p"] }, context: ["ira", "pens"] },
    { id: "purchase", filters: ["age", "income", "renter", "mover", "kids"], label: "Home purchase mortgage", note: "Adults 25–44 with household income of $100K or more, owners or renters: adults planning to buy a home in the next 12 months over-index at 25–44 (index 134–174), $100K+ (117–138), renters (159) and parents (139; Scarborough). Mortgage customers typically come from within about 80 miles (AdMall).", sel: { age: ["25_34", "35_44"], income: ["100_150", "150_200", "200p"] } },
    { id: "refi", filters: ["age", "income", "mortg"], label: "Refinance and home equity", note: "Homeowners 25–54 with a mortgage or home equity loan and household income of $100K or more: adults planning to refinance in the next 12 months over-index at 25–54 (index 127–163; 55+ only 47–86), $100K+ (151–189), owners (147) and parents (175; Scarborough). Mortgage customers typically come from within about 80 miles (AdMall).", sel: { age: ["25_34", "35_44", "45_54"], income: ["100_150", "150_200", "200p"], mortg: ["with"] } },
    { id: "bank", filters: ["age", "income", "mover", "kids"], label: "Banks", note: "Adults 18–54 with household income of $75K or more: potential bank switchers lean 25–44 (+32–34% vs. all adults) and 45–54 (+25%), while 65+ run 64% below; they also lean $150K+ (+18%), male (+17%), parents of children 2–9 (+56–66%) and city dwellers (+30%; AudienceSCAN 2026). Recent movers, who often choose a new bank, and the children filter narrow it further. Customers typically bank within about 5 miles of home or work (AdMall).", sel: { age: ["18_24", "25_34", "35_44", "45_54"], income: ["75_100", "100_150", "150_200", "200p"] }, context: ["selfemp"] },
    { id: "cu", filters: ["age", "income", "mover", "kids"], label: "Credit unions", note: "Adults 45 and older with household income of $75K or more: credit union members over-index at 45+ (index 106–113) and $75K+ (110–123; Scarborough). Members typically come from within about 5 miles (AdMall).", sel: { age: ["45_54", "55p"], income: ["75_100", "100_150", "150_200", "200p"] } }
  ],
  methodology: [
    { title: "Tax return rates", body: "Paid preparer, Earned Income Credit, dividend, capital gains, IRA and pension figures come from IRS tax returns by ZIP: the share of returns in each ZIP with that item. They show as ZIP columns with the matching preset. They describe the ZIP, not individual households, so they aren't applied to the audience count. The IRS publishes ZIP data about three years after the tax year and leaves out ZIPs with very few returns." },
    { title: "Combining traits", body: "Traits are combined as if they were independent within a ZIP. Traits that go together (higher income and owning a home, for example) are more common together than that, so a selection that combines them is a conservative estimate." },
    { title: "Owners, mortgages and renters", body: "Owner and renter shares come from Census by the age of the head of household, so they use each age group's own rate. Mortgage status is the share of owner homes with or without a mortgage or home equity loan." },
    { title: "Advertising rules", body: "Meta and Google don't allow ZIP, age or gender targeting for financial products in the U.S. Use these counts to plan channels that allow geographic targeting, such as streaming TV, programmatic display and direct mail." }
  ]
};
