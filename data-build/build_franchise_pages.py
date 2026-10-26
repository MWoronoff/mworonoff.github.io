"""Writes the Franchise Development Analyzer pages from one template:
  franchise/index.html + radius-config.js            national page (DMAs, metros, counties, ZIPs)
  franchise/<client>/index.html + radius-config.js   each client in data-build/franchise/<client>.json (its territories)
Run after build_franchise.py and build_franchise_geo.js:  python3 data-build/build_franchise_pages.py
"""
import glob, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
V = "20261026b"   # version tag for the shared engine files on these pages (keep in step with the other analyzers)

SUBS = [{"id": "exec", "label": "Master franchise candidates"}, {"id": "owner", "label": "First-time franchise buyers"}]
# AudienceSCAN 2026, Small Business Owners (4.5% of U.S. adults): saw or heard an ad of each type that led them to take
# action in the past 30 days, vs. all U.S. adults. The closest AudienceSCAN group to franchise candidates.
SBO_ROWS = [
    ["Ad on a social network", 41.2, 35.9],
    ["Streaming TV advertising (such as Hulu, Pluto TV or YouTube TV)", 41.3, 36.7],
    ["Ad on search results pages (like on Google, Yahoo or Bing)", 39.2, 35.8],
    ["Television (traditional, including cable or satellite subscription)", 38.9, 34.7],
    ["Mobile phone app or text message", 38.8, 36.6],
    ["Ad that plays before or during the video you want to watch", 37.5, 31.1],
    ["Ads/Coupons in your mailbox", 34.3, 29.9],
    ["Emailed ad or newsletter", 33.7, 28.6],
    ["Online display ads (banners and pop-up ads)", 33.0, 30.0],
    ["Text link ad on a website", 31.6, 27.3],
    ["Ad on a podcast", 30.4, 22.7],
    ["Outdoor ad/sign/billboard/transit", 29.7, 23.6],
    ["Newspaper (print, online, mobile or tablet)", 29.2, 23.5],
    ["Advertising circulars in your mailbox or inserted in the newspaper", 29.1, 27.2],
    ["Radio (over-the-air, online, mobile or tablet)", 28.1, 25.5],
    ["Magazine (print, online, mobile or on tablet)", 26.5, 21.5],
    ["Ads at movie theater", 24.7, 21.5],
]
SBO = {"short": "Small business owners", "audience": "small business owners", "rows": SBO_ROWS}
AD_RESPONSE = {
    "title": "How small business owners respond to advertising",
    "source": "2026 AudienceSCAN® study",
    "note": "National survey data: the percent who saw or heard an ad of each type that led them to take action in the past 30 days. Percentages are based on all U.S. adults and on everyone in the target group, not on users of each medium. Small business owners (4.5% of U.S. adults) are the closest AudienceSCAN group to franchise candidates, so the same figures show for both owner profiles. \"Vs. average\" is how much more likely the group is to have responded than all U.S. adults (a percent difference, not percentage points). The same national figures apply to every market.",
    "subs": {"exec": SBO, "owner": SBO},
}
# Proposal wording for franchise development (shared/radius.js reads cfg.proposal)
PROPOSAL = {
    "nouns": {"exec": "adults who fit the master franchise candidate profile", "owner": "adults who fit the first-time franchise buyer profile"},
    "goals": {"awareness": "Awareness among prospective franchise owners in the top candidate ZIPs",
              "leads": "Qualified franchise inquiries and discovery calls",
              "online": "Visits to the franchise opportunity site and completed inquiry forms",
              "offline": "Discovery calls and Discovery Day attendance",
              "growth": "New prospective owners plus captured franchise searches"},
    "jobs": {"search": "Captures people already researching franchise ownership, such as \"franchise opportunities\" and searches for the concept's category.",
             "social": "Reaches the owner profile by age, income and location in the top candidate ZIPs, with lead forms that pre-qualify on capital and timeline.",
             "ctv": "Tells the ownership story on the big screen to households in the top candidate ZIPs.",
             "youtube": "Video that explains the opportunity to people researching business ownership, targeted by interest and ZIP.",
             "display": "Keeps the opportunity in front of the owner profile across websites and apps in the top candidate ZIPs.",
             "retarget": "Brings back visitors to the franchise site who haven't inquired yet; franchise decisions take months.",
             "audio": "Reaches commuting professionals with the ownership message during podcasts and streaming audio.",
             "dooh": "Builds local presence for the brand where candidates work and commute."},
    "drives": "visits to the franchise site and branded searches",
    "note": "Franchise leads: the 2026 Annual Franchise Development Report puts average cost per lead at $142 to $802 and average cost per franchise sale at $6,700 to $25,145, depending on the sector; this proposal doesn't forecast sales.",
}
SOURCES = [
    {"label": "Census American Community Survey 5-year (age of householder by household income, educational attainment, veterans)", "url": "https://www.census.gov/programs-surveys/acs"},
    {"label": "IRS Statistics of Income, individual income tax ZIP Code data", "url": "https://www.irs.gov/statistics/soi-tax-stats-individual-income-tax-statistics-zip-code-data-soi"},
    {"label": "Census ZIP Code Business Patterns", "url": "https://www.census.gov/programs-surveys/cbp.html"},
    {"label": "Census LEHD Origin-Destination Employment Statistics (jobs by industry)", "url": "https://lehd.ces.census.gov/data/"},
]


def page(cfg, title, depth):
    up = "../" * depth
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="robots" content="noindex">
<link rel="icon" href="{up}shared/adtaxi-logo.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
<link rel="stylesheet" href="{up}shared/engine.css?v={V}">
</head>
<body>
<div id="app"><p class="az-loading">Loading the {title}…</p></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script src="https://unpkg.com/topojson-client@3.1.0/dist/topojson-client.min.js" crossorigin=""></script>
<script src="{up}shared/engine.js?v={V}"></script>
<script src="radius-config.js?v={V}"></script>
<script>
AdtaxiAnalyzer.start({json.dumps(cfg, indent=1, ensure_ascii=False)});
</script>
</body>
</html>
"""


def radius_cfg(title, export, depth, links):
    up = "../" * depth
    return {
        "title": title, "subtitle": "Pick a center ZIP or town and a radius (or map a custom area), then choose the owner profile to see how many candidates live there and which ZIPs over-index.",
        "logo": f"{up}shared/adtaxi-logo.svg", "exportName": export, "links": links,
        "audienceData": f"{up}shared/audience/zip_audience.json",
        "extraData": [{"url": f"{up}shared/audience/zip_audience_fin.json", "label": "Tax return data", "source": "IRS Statistics of Income ZIP data"},
                      {"url": f"{up}shared/audience/zip_audience_inc.json", "label": "Household income at $125K", "source": "Census ACS household income (B19001)"}],
        "zipGeo": f"{up}shared/geo/zip/{{level}}/{{id}}.json",
        "planScript": f"{up}shared/media-plan.js?v={V}", "mediaMixUrl": f"{up}media-mix/", "planCategory": "none",
        "customArea": True, "ageSet": "adult", "radii": [5, 10, 15, 25, 50, 100], "radiusLabel": "Up to {r} miles",
        "filters": ["age", "income8", "veterans"],
        "profileLabel": "Owner profile", "proposal": PROPOSAL,
        # The count is a planning pool (everyone who fits the age and income box), not a count of likely buyers
        "audienceNoun": "Qualified adults", "audienceFit": "fit the {profile} profile by age and income", "leadWithIndex": True,
        "summaryNote": "A planning pool, not a buyer count: only a small fraction of qualified adults buy a franchise in any year. The index shows where candidates are most concentrated, so use it to decide where to spend.",
        "profiles": [
            {"id": "exec", "label": "Master franchise candidates", "note": "Adults 35 and older in households earning $125K+, including first-time franchise buyers. IRS shares of returns with $200K+ income and with capital gains, and the share of adults with a bachelor's degree or higher, show by ZIP.",
             "sel": {"age": ["35_44", "45_54", "55p"], "income8": ["125_150", "150_200", "200p"]}, "context": ["hi200", "cg", "ba"]},
            {"id": "owner", "label": "First-time franchise buyers", "note": "Adults 35 and older in households earning $100K+: most people who buy a business are 40 to 60, often making a career change. The IRS share of returns with $200K+ income shows by ZIP.",
             "sel": {"age": ["35_44", "45_54", "55p"], "income8": ["100_125", "125_150", "150_200", "200p"]}, "context": ["hi200"]}],
        "methodology": [
            {"title": "Who counts", "body": "Counts are adults by age and household income (Census). Census doesn't publish net worth or job titles by ZIP, so household income stands in for capital, and the profiles are planning estimates, not lists of people."},
            {"title": "Qualified adults vs. buyers", "body": "Qualified adults are everyone who fits the owner profile's age and income, the pool that ads can reach. Only a small fraction buy a franchise in any year (the industry adds roughly 12,000 to 13,000 net new units a year, and many go to existing multi-unit owners), so the count sizes the reachable audience, not the number of buyers. The index is the better guide to where to spend."},
            {"title": "Age", "body": "First-time buyers start at 35: most people who buy a business are 40 to 60 (BizBuySell Small Business Study). Census age groups end at 55 and older, so that group includes some retirees."},
            {"title": "ZIP-wide rates", "body": "The $200K+ income, capital gains and self-employment figures are IRS shares of tax returns in each ZIP, and Bachelor's+ is the Census share of adults 25+ with a bachelor's degree or higher. They describe the ZIP, not individual households, so they show as columns and aren't applied to the count. Census doesn't publish education by age and income for ZIPs, and degrees are far more common among high earners than among all adults, so applying the ZIP rate would badly undercount."},
            {"title": "Reaching these candidates", "body": "Census doesn't publish job titles or net worth by ZIP, so these counts describe the owner profile by age and household income. Use the top ZIPs to set the geography for search, Meta, streaming TV, programmatic display and direct mail, and to pick where a franchise's markets have the most candidates."}],
    }


def measures(client):
    L_ALL = ["territory", "dma", "metro", "county", "zip"] if client else ["dma", "metro", "county", "zip"]
    L_MKT = [l for l in L_ALL if l != "zip"]
    buyers = client["buyers"]["label"] if client else "Businesses with employees"
    bhelp = client["buyers"]["help"] if client else "All businesses with paid employees (Census ZIP Code Business Patterns): the base of potential customers for a business-to-business franchise."
    score_help = ("0–100. Candidates 50%, Territory Opportunity 30%, Competition 20%, each a percentile among areas at the same level. ZIPs use Candidates only."
                  if client else "0–100. Candidates 62.5%, Market Opportunity 37.5% (each a percentile among areas at the same level). ZIPs use Candidates only.")
    m = [
        {"key": "score", "label": "Franchise Opportunity Score", "short": "Score", "format": "score", "perSub": True, "levels": L_ALL, "help": score_help},
        {"key": "demand", "label": "Candidates", "short": "Candidates", "format": "score", "perSub": True, "levels": L_ALL,
         "help": "Average of the percentiles for this owner profile's inputs (see How scores work)."},
        {"key": "category", "label": "Territory Opportunity" if client else "Market Opportunity", "short": "Opportunity", "format": "score", "perSub": True, "levels": L_MKT,
         "help": f"Average of the percentiles for {buyers.lower()}, the jobs at them, and those businesses per 1,000 residents: the customers a franchisee would sell to."},
    ]
    if client:
        m += [{"key": "comp", "label": "Competition", "short": "Compete", "format": "score", "perSub": True, "levels": L_MKT,
               "help": f"Percentile of {client['competitors']['label'].lower()} per 1,000 buyer businesses, reversed: fewer competitors scores higher."},
              {"key": "under", "label": "Underserved", "short": "Underserved", "format": "text", "perSub": True, "levels": L_MKT,
               "help": "Strong candidate supply (70th percentile or higher) with few competitors per buyer business (30th percentile or lower). Shown, not scored."}]
    m += [
        {"key": "x125", "label": "Householders 45–64 earning $125K+", "short": "Execs 45–64", "format": "int", "subs": ["exec"],
         "help": "Households headed by someone 45–64 with income of $125K or more (Census ACS): the established, capitalized candidates for a master or multi-unit franchise."},
        {"key": "x125_share", "label": "Share of householders 45–64 earning $125K+", "format": "pct", "subs": ["exec"]},
        {"key": "hi200_share", "label": "Share of tax returns with income of $200K+", "format": "pct", "subs": ["exec"], "help": "IRS, area-level: how common high incomes are here."},
        {"key": "cg_share", "label": "Share of tax returns with capital gains", "format": "pct", "subs": ["exec"], "help": "IRS, area-level: a sign of investable assets beyond salary."},
        {"key": "o100", "label": "Householders 25–64 earning $100K+", "short": "Buyers 25–64", "format": "int", "subs": ["owner"],
         "help": "Households headed by someone 25–64 with income of $100K or more (Census ACS)."},
        {"key": "o100_share", "label": "Share of householders 25–64 earning $100K+", "format": "pct", "subs": ["owner"]},
        {"key": "avg_wage", "label": "Average salary per wage earner", "format": "money", "help": "IRS wages divided by returns with wages, area-level: higher where more corporate and professional earners live."},
        {"key": "ba_share", "label": "Share of adults 25+ with a bachelor's degree or higher", "format": "pct", "subs": ["exec"],
         "help": "Census ACS, area-level. A master franchisee recruits and supports sub-franchisees, so a professional and management background matters; education is the best public stand-in for it."},
        {"key": "married_share", "label": "Share of households that are married couples", "format": "pct", "subs": ["owner"], "help": "Census ACS. Most new franchise buyers are married, often with a spouse's income covering household costs while the business starts."},
        {"key": "vets", "label": "Veterans", "format": "int", "help": "Civilian veterans 18+ (Census ACS). Many franchise systems offer veteran discounts (VetFran). Shown, not scored."},
        {"key": "vet_share", "label": "Share of adults who are veterans", "format": "pct"},
        {"key": "buyers", "label": buyers, "short": "Buyers", "format": "int", "help": bhelp},
        {"key": "buyer_jobs", "label": "Jobs at those businesses", "short": "Jobs", "format": "int", "help": "Jobs located in these industries (Census LODES): a measure of facility size and activity."},
        {"key": "buyers_per1k", "label": f"{buyers} per 1,000 residents", "format": "dec1"},
    ]
    if client:
        cl = client["competitors"]["label"]
        m += [{"key": "est", "label": cl, "short": "Competitors", "format": "int", "perSub": True, "help": client["competitors"]["help"]},
              {"key": "per1k", "label": f"{cl} per 1,000 buyer businesses", "format": "dec1", "perSub": True}]
    m += [{"key": "population", "label": "Population", "format": "int"},
          {"key": "households", "label": "Households", "format": "int"},
          {"key": "density", "label": "Households per square mile", "short": "HH/sq mi", "format": "int"}]
    return m


def methodology(client):
    out = [{"title": "Franchise Opportunity Score", "body": [
        "Where are a franchise system's best owner candidates, and which " + ("territories" if client else "markets") + " deserve the most franchise-development ad dollars?",
        ("Score = 50% Candidates + 30% Territory Opportunity + 20% Competition." if client else "Score = 62.5% Candidates + 37.5% Market Opportunity .")
        + " Each part is a percentile (0–100) against areas at the same level. No score is shown when a part has no data."]},
        {"title": "Candidates", "body": [
            "Master franchise candidates, first-time or not: householders 45–64 earning $125K+ (count and share), the IRS shares of returns with income of $200K+ and with capital gains, the IRS average salary per wage earner, and the share of adults 25+ with a bachelor's degree or higher (a master franchisee recruits and supports sub-franchisees, so professional and management background matters). Each input counts equally.",
            "First-time franchise buyers: householders 25–64 earning $100K+ (count and share), the IRS average salary per wage earner (corporate earners, who make up most first-time buyers) and the share of married-couple households (the dual-income cushion many new owners rely on). Education isn't used here: many good single-unit buyers are career changers without a degree. Census groups householders 25–44 together, so the market score can't start at 35 the way the Trade area audience does.",
            "Census doesn't publish net worth, liquid capital or job titles for areas, so household income and investment income stand in for them. IRS figures are area-level rates, not facts about individuals."]},
        {"title": "Territory Opportunity" if client else "Market Opportunity", "body":
            (client["buyers"]["help"] + " " if client else "All businesses with paid employees. ") +
            "Half count, half concentration: establishments and the jobs at them (count), and establishments per 1,000 residents."}]
    if client:
        out.append({"title": "Competition", "body": client["competitors"]["help"] + " Reversed, so fewer competitors scores higher. Other franchise systems recruiting the same candidates aren't separable in Census data."})
        out.append({"title": "Territories", "body": [client["territorySource"],
            "Each territory is drawn from Census geography: a whole state, a Census metro area (only the part in the listed state), or a county. These are provisional until " + client["client"] + "'s own county lists are in; see each territory's note.",
            client["pendingNote"] + " " + ", ".join(client["pending"]) + "."]})
    out.append({"title": "ZIPs in market", "body": "Pick a " + ("territory" if client else "DMA, metro or county") + ", then ZIPs in market to rank its ZIPs by Candidates, for geographic targeting. ZIPs under 500 residents, or mostly group quarters, are shown but not ranked."})
    return out


def analyzer_cfg(client):
    depth = 2 if client else 1
    up = "../" * depth
    nat = "../" if client else ""
    title = client["title"] if client else "Franchise Development Analyzer"
    links = ([{"label": "All U.S. markets", "url": "../"}] if client else []) + [{"label": "Home", "url": f"{up}analyzers/"}]
    if client:
        levels = {"us": {"label": "U.S.", "data": "data/us.json"},
                  "territory": {"label": "Territory", "data": "data/territory.json", "geo": "geo/territory.topo.json", "idField": "territory_id"},
                  "zip": {"label": "ZIPs in territory", "data": "data/zip/{level}/{id}.json", "geo": "geo/zip/{level}/{id}.json", "idField": "zip"}}
    else:
        levels = {"us": {"label": "U.S.", "data": "data/us.json"},
                  "dma": {"label": "DMA", "data": "data/dma.json", "geo": "../shared/geo/dma.topo.json", "idField": "dma_code"},
                  "metro": {"label": "Metro", "data": "data/metro.json", "geo": "../shared/geo/metro.topo.json", "idField": "cbsa_code"},
                  "county": {"label": "County", "data": "data/county.json", "geo": "../shared/geo/county.topo.json", "idField": "fips"},
                  "zip": {"label": "ZIPs in market", "data": "data/zip/{level}/{id}.json", "geo": "../shared/geo/zip/{level}/{id}.json", "idField": "zip"}}
    cfg = {
        "title": title,
        "subtitle": (f"Where {client['client']}'s best owner candidates are: Franchise Opportunity Scores for its available {client['territoryNounPlural']} and the ZIPs inside them, to focus franchise-development ad dollars."
                     if client else "Where franchise systems' best owner candidates are: Franchise Opportunity Scores for DMAs, metros, counties and ZIPs, by owner profile, to focus franchise-development ad dollars."),
        "logo": f"{up}shared/adtaxi-logo.svg", "exportName": "franchise-" + client["id"] if client else "franchise", "links": links,
        "radiusDefault": 25, "radiusProfiles": True, "defaultLevel": "us", "usMapLevel": "territory" if client else "dma",
        "levels": levels, "statesGeo": f"{up}shared/geo/states.topo.json", "zipIndex": f"{up}shared/geo/zip_market.json",
        "radiusScript": f"{up}shared/radius.js?v={V}", "benchmarks": False, "timing": False,
        "subcategoryLabel": "Owner profile", "subcategories": SUBS,
        "measures": measures(client),
        "rankBy": ["score", "x125", "x125_share", "hi200_share", "ba_share", "o100", "o100_share", "avg_wage", "buyers", "buyer_jobs", "vets", "population"],
        "defaultRank": "score",
        "components": ["demand", "category", "comp"] if client else ["demand", "category"],
        "detailMeasures": ["x125", "x125_share", "hi200_share", "cg_share", "ba_share", "o100", "o100_share", "avg_wage", "married_share", "buyers", "buyer_jobs", "buyers_per1k"]
                          + (["est", "per1k", "under"] if client else []) + ["vets", "vet_share", "population", "households", "density"],
        "tableColumns": ["score", "population", "buyers"] + (["under"] if client else []),
        "methodology": methodology(client),
        "sources": SOURCES,
        "sourcesNote": "Candidates: Census ACS and IRS. Businesses: Census Business Patterns. Jobs: Census LODES." + (f" Territories: {client['client']}." if client else ""),
        "radius": True,
        "adResponse": AD_RESPONSE,
    }
    if client: cfg["compBasis"] = "per buyer business"
    if client:
        cl = client["competitors"]["label"]
        cfg["pointLayers"] = [{"key": "est", "label": f"Show {cl.lower()}", "unit": cl.lower(), "legend": f"{cl} (circle size = count)", "color": "#1f6f8b",
                               "zipNote": "Census counts establishments with paid employees."}]
    rc = radius_cfg(("Zip Code Radius Tool - Franchise Development" + (f": {client['client']}" if client else "")),
                    ("franchise-" + client["id"] if client else "franchise") + "-radius", depth, [{"label": title, "url": "./"}, {"label": "Home", "url": f"{up}analyzers/"}])
    return cfg, rc, title, depth


def write(folder, client):
    cfg, rc, title, depth = analyzer_cfg(client)
    os.makedirs(folder, exist_ok=True)
    open(os.path.join(folder, "index.html"), "w").write(page(cfg, title, depth))
    open(os.path.join(folder, "radius-config.js"), "w").write(
        "/* Zip Code Radius Tool settings for this analyzer (written by data-build/build_franchise_pages.py). */\n"
        "window.ADTAXI_RADIUS = " + json.dumps(rc, indent=1, ensure_ascii=False) + ";\n")
    print("wrote", os.path.relpath(folder, ROOT))


if __name__ == "__main__":
    write(os.path.join(ROOT, "franchise"), None)
    for p in sorted(glob.glob(os.path.join(HERE, "franchise", "*.json"))):
        c = json.load(open(p))
        write(os.path.join(ROOT, "franchise", c["id"]), c)
