"""Ad response one-sheets for the Research Library, in the Adtaxi slide design used by shared/slides
(teal top rule, uppercase title, dark green stat banner, chart with a callout box, adtaxi circle).
The callout box shows the biggest lift among the digital media Adtaxi sells (DIGITAL below), or Newspaper when it posts a
strong over-index (at least NEWS_MIN and above the best digital lift); never another traditional medium;
no Marketers' Note line (Nov 2026). The banner's top three stay the top three of all 17 media.

One slide per AudienceSCAN 2026 audience in shared/media/ad-response.json (run data-build/build_ad_response.js first).
Writes shared/slides/ar-<category>-<audience>.png (1467x825) and .pdf (13.333 x 7.5 in), and adds each audience's
file name to ad-response.json for the library page.

Run from the repo root: python3 data-build/build_ad_response_slides.py
Needs Playwright with Chrome and the Inter font installed.
"""
import html, json, os, re, sys
from playwright.sync_api import sync_playwright

ROOT = os.getcwd()
DATA = os.path.join(ROOT, "shared/media/ad-response.json")
OUT = os.path.join(ROOT, "shared/slides")
LOGO = open(os.path.join(ROOT, "shared/adtaxi-logo.svg"), encoding="utf-8").read()
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")

SHORT = {
    "Ad on a social network": "Social",
    "Streaming TV advertising (such as Hulu, Pluto TV or YouTube TV)": "Streaming TV",
    "Ad on search results pages (like on Google, Yahoo or Bing)": "Search",
    "Mobile phone app or text message": "Mobile app or text",
    "Television (traditional, including cable or satellite subscription)": "TV, cable or satellite",
    "Ad that plays before or during the video you want to watch": "Pre-roll video",
    "Online display ads (banners and pop-up ads)": "Online display",
    "Emailed ad or newsletter": "Email",
    "Text link ad on a website": "Text link",
    "Ads/Coupons in your mailbox": "Direct mail",
    "Advertising circulars in your mailbox or inserted in the newspaper": "Circulars",
    "Radio (over-the-air, online, mobile or tablet)": "Radio",
    "Outdoor ad/sign/billboard/transit": "Outdoor",
    "Newspaper (print, online, mobile or tablet)": "Newspaper",
    "Ads at movie theater": "Movie theater",
    "Ad on a podcast": "Podcast",
    "Magazine (print, online, mobile or on tablet)": "Magazine",
}
# How each medium reads inside a sentence ("a magazine ad")
IN_SENTENCE = {"Social": "social", "Search": "search", "Mobile app or text": "mobile app or text", "TV, cable or satellite": "TV, cable or satellite",
               "Pre-roll video": "pre-roll video", "Online display": "online display", "Email": "email", "Text link": "text link", "Direct mail": "direct mail",
               "Circulars": "circular", "Radio": "radio", "Outdoor": "outdoor", "Newspaper": "newspaper", "Movie theater": "movie theater",
               "Podcast": "podcast", "Magazine": "magazine", "Streaming TV": "streaming TV"}

IN_LIST = dict(IN_SENTENCE, Circulars="circulars")

# Media eligible for the callout box (digital platforms Adtaxi sells; podcast left out)
DIGITAL = {"Social", "Mobile app or text", "Streaming TV", "Search", "Pre-roll video", "Online display", "Email", "Text link"}
# Newspaper takes the box only with a strong over-index: at least this many points above U.S. adults and above the best digital lift
NEWS_MIN = 25


def art(w):
    return ("an " if w[0] in "aeiou" else "a ") + w


def plain(t):
    """The audience without its qualifier ("drug store customers, who shop..." -> "drug store customers")."""
    return re.split(r", who | [(]", t)[0]


def slug(t):
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")


def pct(v):
    return f"{v:.1f}%"


def lift(t, a):
    return round((t / a - 1) * 100)


def join3(xs):
    return ", ".join(xs[:-1]) + " and " + xs[-1] if len(xs) > 1 else xs[0]


def slide_html(cat, g):
    rows = sorted(g["rows"], key=lambda r: -r[1])
    rows = [{"name": SHORT.get(r[0], r[0]), "t": r[1], "a": r[2], "d": lift(r[1], r[2])} for r in rows]
    top = rows[:3]
    big = sorted([r for r in rows if r["name"] in DIGITAL], key=lambda r: (-r["d"], -r["t"]))[0]
    news = [r for r in rows if r["name"] == "Newspaper"]
    if news and news[0]["d"] >= NEWS_MIN and news[0]["d"] > big["d"]:
        big = news[0]
    box_head = "Strong newspaper lift" if big["name"] == "Newspaper" else "Biggest digital lift"
    avg_lift = round(sum(r["d"] for r in rows) / len(rows))
    scale = max(r["t"] for r in rows) * 1.08
    who = g["short"]
    title = "Ad response: " + who
    bars = []
    for r in rows:
        w = r["t"] / scale * 100
        m = r["a"] / scale * 100
        bars.append(f'''<div class="row"><span class="lab">{html.escape(r["name"])}</span><span class="track">
          <i class="bar" style="width:{w:.2f}%"><b>{pct(r["t"])}</b></i><i class="avg" style="left:{m:.2f}%"></i></span></div>''')
    stats = "".join(f'<div class="st"><div class="big">{pct(r["t"])}</div><div class="cap">#{i + 1} {html.escape(r["name"])}</div></div>' for i, r in enumerate(top))
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
  @page {{ size: 1280px 720px; margin: 0; }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{ width: 1280px; height: 720px; }}
  body {{ font-family: "Inter", sans-serif; color: #222727; background: #fff; position: relative; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  .rule {{ position: absolute; left: 0; top: 0; width: 1280px; height: 10px; background: #157968; box-shadow: 0 3px 4px rgba(0,0,0,.18); }}
  .season {{ position: absolute; right: 66px; top: 32px; font-size: 14.5px; font-weight: 700; color: #197b6a; letter-spacing: .02em; }}
  h1 {{ position: absolute; left: 62px; top: 38px; font-size: 33px; font-weight: 700; letter-spacing: -.005em; text-transform: uppercase; line-height: 1.1; white-space: nowrap; }}
  .for {{ position: absolute; left: 63px; top: 82px; width: 1100px; font-size: 14.5px; color: #5c6564; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
  .for b {{ color: #197b6a; font-weight: 700; }}
  .banner {{ position: absolute; left: 53px; top: 113px; width: 1174px; height: 130px; background: #0d4a44; border-radius: 18px; color: #fff;
             box-shadow: 0 4px 8px rgba(0,0,0,.22); }}
  .banner .lead {{ position: absolute; left: 38px; top: 26px; }}
  .banner .lead .big {{ font-size: 44px; }}
  .banner .lead .cap {{ white-space: nowrap; }}
  .banner .sub {{ position: absolute; left: 400px; right: 30px; top: 14px; text-align: center; font-style: italic; font-size: 17px; color: #e6efed; }}
  .banner .stats {{ position: absolute; left: 430px; right: 30px; top: 50px; display: flex; justify-content: space-between; }}
  .big {{ font-size: 40px; font-weight: 700; line-height: 1.05; }}
  .cap {{ font-size: 14.5px; font-weight: 700; text-transform: uppercase; margin-top: 8px; letter-spacing: .01em; }}
  .st {{ min-width: 210px; }}
  .chart-title {{ position: absolute; left: 64px; top: 268px; font-size: 15px; font-weight: 700; color: #197b6a; text-transform: uppercase; }}
  .legend {{ position: absolute; left: 470px; top: 268px; font-size: 13.5px; color: #3f4746; display: flex; gap: 34px; align-items: center; }}
  .legend span {{ display: inline-flex; align-items: center; gap: 10px; }}
  .legend .sw {{ width: 13px; height: 13px; background: #157968; }}
  .legend .mk {{ width: 3px; height: 15px; background: #222727; }}
  .chart {{ position: absolute; left: 50px; top: 298px; width: 830px; }}
  .row {{ display: flex; align-items: center; height: 17.6px; }}
  .lab {{ width: 150px; flex: none; text-align: right; padding-right: 8px; font-size: 11.5px; color: #3f4746; white-space: nowrap; }}
  .track {{ position: relative; flex: 1; height: 13px; background: #eef1f2; }}
  .bar {{ position: absolute; left: 0; top: 0; bottom: 0; background: #157968; display: flex; align-items: center; justify-content: flex-end; }}
  .bar b {{ font-size: 10px; font-weight: 700; color: #fff; padding-right: 5px; font-style: normal; }}
  .avg {{ position: absolute; top: -2px; bottom: -2px; width: 3px; margin-left: -1.5px; background: #222727; }}
  .box {{ position: absolute; left: 930px; top: 300px; width: 297px; height: 278px; background: #f2f8f6; border-radius: 26px; padding: 28px 26px;
          box-shadow: 0 4px 8px rgba(0,0,0,.18); }}
  .box h2 {{ font-size: 13.5px; font-weight: 700; color: #0d4a44; text-transform: uppercase; }}
  .box .med {{ font-size: 30px; font-weight: 700; color: #0d4a44; margin-top: 14px; line-height: 1.1; }}
  .box .num {{ font-size: 30px; font-weight: 700; color: #0d4a44; margin-top: 26px; }}
  .box p {{ font-size: 15.5px; font-weight: 600; color: #0d4a44; margin-top: 4px; line-height: 1.3; }}
  .src {{ position: absolute; left: 65px; top: 674px; width: 980px; font-size: 10.5px; color: #3f4746; }}
  .logo {{ position: absolute; left: 1110px; top: 613px; width: 81px; height: 81px; }}
  .logo svg {{ width: 100%; height: 100%; display: block; }}
</style></head><body>
<div class="rule"></div>
<div class="season">AUDIENCESCAN 2026</div>
<h1 id="t">{html.escape(title)}</h1>
<div class="for"><b>{html.escape(cat["name"])}</b> &nbsp;·&nbsp; Used for {html.escape(", ".join(g["for"]))}</div>
<div class="banner">
  <div class="lead"><div class="big">{'+' if avg_lift >= 0 else ''}{avg_lift}%</div><div class="cap">Ad response vs. U.S. adults</div></div>
  <div class="sub">acted on an ad in the past 30 days</div>
  <div class="stats">{stats}</div>
</div>
<div class="chart-title">Ad response by medium</div>
<div class="legend"><span><i class="sw"></i>{html.escape(who)}</span><span><i class="mk"></i>U.S. adults</span></div>
<div class="chart">{"".join(bars)}</div>
<div class="box"><h2>{box_head}</h2><div class="med">{html.escape(big["name"])}</div>
  <div class="num">{'+' if big['d'] >= 0 else ''}{big["d"]}%</div><p>more likely than U.S. adults to act on {art(IN_SENTENCE.get(big["name"], big["name"].lower()))} ad</p></div>
<div class="src">2026 AudienceSCAN® study. Percent who saw or heard an ad of each type that led them to take action in the past 30 days, based on everyone in the group, not just users of each medium. “More likely” figures are percent differences vs. all U.S. adults; the banner figure averages all 17 media.</div>
<div class="logo">{LOGO}</div>
</body></html>'''


def main():
    data = json.load(open(DATA, encoding="utf-8"))
    only = sys.argv[1] if len(sys.argv) > 1 else None   # optional: one file name to rebuild, for checking
    jobs = []
    for cat in data["cats"]:
        for g in cat["groups"]:
            g["file"] = f"ar-{cat['id']}-{slug(g['short'])}"
            if not only or g["file"] == only:
                jobs.append((cat, g))
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        page = b.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=1467 / 1280)
        for cat, g in jobs:
            page.set_content(slide_html(cat, g))
            # Long audience names: once Inter has loaded, shrink the title until it clears the AudienceSCAN label
            page.evaluate("""() => document.fonts.ready.then(() => { const t = document.getElementById("t"); let s = 33;
              while (t.getBoundingClientRect().right > 1040 && s > 22) { s -= 1; t.style.fontSize = s + "px"; } })""")
            base = os.path.join(OUT, g["file"])
            page.screenshot(path=base + ".png", clip={"x": 0, "y": 0, "width": 1280, "height": 720})
            page.pdf(path=base + ".pdf", width="1280px", height="720px", print_background=True, page_ranges="1")
            print(g["file"])
        b.close()
    if not only:
        json.dump(data, open(DATA, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    main()
