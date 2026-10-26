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
    { id: "tax", filters: ["age", "income", "kids"], label: "Tax preparation", note: "All adults, with ZIPs ranked by the share of tax returns filed by a paid preparer (IRS). The Earned Income Credit share shows alongside.", sel: {}, context: ["prep", "eitc"], sortBy: "prep" },
    { id: "wealth", filters: ["age", "income"], label: "Wealth management", note: "Adults 45 and older with household income of $100K or more. Dividend and capital gains shares (IRS) show by ZIP.", sel: { age: ["45_54", "55p"], income: ["100_150", "150_200", "200p"] }, context: ["div", "cg"] },
    { id: "retire", filters: ["age", "income"], label: "Retirement planning", note: "Adults 55 and older with household income of $75K or more. IRA and pension income shares (IRS) show by ZIP.", sel: { age: ["55p"], income: ["75_100", "100_150", "150_200", "200p"] }, context: ["ira", "pens"] },
    { id: "purchase", filters: ["age", "income", "renter", "mover", "kids"], label: "Home purchase mortgage", note: "Adults 25–54 with household income of $75K or more, owners or renters: the buyers most likely to need a purchase mortgage.", sel: { age: ["25_34", "35_44", "45_54"], income: ["75_100", "100_150", "150_200", "200p"] } },
    { id: "refi", filters: ["age", "income", "mortg"], label: "Refinance and home equity", note: "Homeowners 35 and older with a mortgage or home equity loan.", sel: { age: ["35_44", "45_54", "55p"], mortg: ["with"] } }
  ],
  methodology: [
    { title: "Tax return rates", body: "Paid preparer, Earned Income Credit, dividend, capital gains, IRA and pension figures come from IRS tax returns by ZIP: the share of returns in each ZIP with that item. They show as ZIP columns with the matching preset. They describe the ZIP, not individual households, so they aren't applied to the audience count. The IRS publishes ZIP data about three years after the tax year and leaves out ZIPs with very few returns." },
    { title: "Combining traits", body: "Traits are combined as if they were independent within a ZIP. Traits that go together (higher income and owning a home, for example) are more common together than that, so a selection that combines them is a conservative estimate." },
    { title: "Owners, mortgages and renters", body: "Owner and renter shares come from Census by the age of the head of household, so they use each age group's own rate. Mortgage status is the share of owner homes with or without a mortgage or home equity loan." },
    { title: "Advertising rules", body: "Meta and Google don't allow ZIP, age or gender targeting for financial products in the U.S. Use these counts to plan channels that allow geographic targeting, such as streaming TV, programmatic display and direct mail." }
  ]
};
