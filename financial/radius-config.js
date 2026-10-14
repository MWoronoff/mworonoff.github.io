/* Zip Code Radius Tool settings for this analyzer (opened from Geography > Radius on the analyzer page). */
window.ADTAXI_RADIUS = {
  title: "Zip Code Radius Tool - Financial",
  subtitle: "Pick a center ZIP or town and a radius, then choose the prospects you want to reach to see how many live there and which ZIPs over-index.",
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
  ageSet: "adult",
  radii: [5, 10, 15, 25, 50, 100],
  radiusLabel: "Up to {r} miles",
  filters: ["age", "income", "taxprep", "eitc", "selfemp", "invest", "capgain", "ira", "pension", "renter", "rinc", "mover", "mortg", "ownval", "longten", "kids"],
  profileLabel: "Best prospects for",
  profiles: [
    { id: "tax", label: "Tax preparation", note: "Adults in households that pay a preparer to file their taxes.", sel: { taxprep: true } },
    { id: "wealth", label: "Wealth management", note: "Adults 45 and older in households with dividend income.", sel: { age: ["45_54", "55p"], invest: true } },
    { id: "retire", label: "Retirement planning", note: "Adults 55 and older with household income of $75K or more.", sel: { age: ["55p"], income: ["75_100", "100_150", "150_200", "200p"] } },
    { id: "purchase", label: "Home purchase mortgage", note: "Renters 25–44 with household income of $75K or more: likely first-time buyers.", sel: { age: ["25_34", "35_44"], rinc: ["75_100", "100_150", "150p"] } },
    { id: "refi", label: "Refinance and home equity", note: "Homeowners 35 and older with a mortgage or home equity loan.", sel: { age: ["35_44", "45_54", "55p"], mortg: ["with"] } }
  ],
  methodology: [
    { title: "Tax return traits", body: "Paid preparer, Earned Income Credit, self-employment, dividends, capital gains, IRA distributions and pension income come from IRS tax returns by ZIP: the share of returns in the ZIP with that item, applied to the adults selected. A return stands in for a household. The IRS publishes ZIP data about three years after the tax year, and doesn't publish ZIPs with very few returns, so those ZIPs show no data for these filters." },
    { title: "Combining traits", body: "Traits are combined as if they were independent within a ZIP. Traits that go together (high income and dividend income, for example) are more common together than that, so a selection that combines them is a conservative estimate." },
    { title: "Owners, mortgages and renters", body: "Owner and renter shares come from Census by the age of the head of household, so they use each age group's own rate. Mortgage status is the share of owner homes with or without a mortgage or home equity loan. Renter household income is the share of renter households in each income range." },
    { title: "Advertising rules", body: "Meta and Google don't allow ZIP, age or gender targeting for financial products in the U.S. Use these counts to plan channels that allow geographic targeting, such as streaming TV, programmatic display and direct mail." }
  ]
};
