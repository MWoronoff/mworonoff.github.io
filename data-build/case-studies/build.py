"""Adtaxi case study builder: JSON data -> letter-size PDF in the restyled Adtaxi design (Poppins, black header with photo,
results cards, challenges/solutions table, teal Key Insights, "The full story" pages with the narrative in two columns).
Usage: python3 build.py data/<name>.json out/"""
import json, sys, os, html, base64, asyncio
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
def uri(p):
    p = p if os.path.isabs(p) else os.path.join(HERE, p)
    ext = os.path.splitext(p)[1].lower().lstrip('.'); ext = 'jpeg' if ext in ('jpg', 'jpeg') else ext
    return 'data:image/%s;base64,%s' % (ext, base64.b64encode(open(p, 'rb').read()).decode())
E = html.escape

CSS = """
@page { size: 612pt 792pt; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
body { font-family: Poppins; color: #1f2a2e; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.page { width: 612pt; height: 792pt; position: relative; overflow: hidden; page-break-after: always; background: #fff }
.page:last-child { page-break-after: auto }
.lbl { font-weight: 700; font-size: 8.5pt; letter-spacing: .16em; text-transform: uppercase; color: #0b7e71 }
.hdr { position: absolute; left: 0; top: 0; width: 612pt; background: #000 }
.hdr .photo { position: absolute; left: 255.6pt; top: 0; width: 356.4pt; height: 100%; object-fit: cover; object-position: left top }
.hdr .ring { position: absolute; left: 385.9pt; top: 0; width: 226.1pt; height: 210.9pt }
.hdr .logo { position: absolute; left: 500.4pt; top: 18pt; width: 79.2pt; height: 79.2pt }
.hdr .txt { position: relative; padding: 40pt 0 0 36pt; width: 360pt }
.hdr .lbl { color: #9ed8d2 }
.hdr h1 { font-weight: 700; font-size: 28pt; line-height: 1.12; color: #fff; margin-top: 4pt }
.hdr .sub { font-size: 11pt; line-height: 1.4; color: #d5dee0; margin-top: 7pt; width: 270pt }
.tags { margin-top: 12pt; display: flex; gap: 7pt; flex-wrap: wrap }
.tags span { border: .74pt solid #9e9e9e; color: #fff; font-size: 7.5pt; padding: 3.2pt 8.6pt }
.body1 { position: absolute; left: 36pt; width: 540pt }
.cards { display: flex; gap: 13.3pt; margin-top: 6pt }
.card { flex: 1; background: #f2f6f5; border-top: 4.3pt solid #0b7e71; padding: 9pt 13pt 11pt }
.card .n { font-weight: 700; font-size: 30pt; line-height: 1.2; color: #000 }
.card .n.w { font-size: 17pt; line-height: 1.25; padding: 6pt 0 2pt }
.card .t { font-size: 8pt; line-height: 1.45; margin-top: 2pt }
table.cs { width: 540pt; border-collapse: collapse; margin-top: 19pt; font-size: 9pt; line-height: 1.45 }
table.cs th { background: #000; color: #fff; font-weight: 700; font-size: 10pt; text-align: left; padding: 6.5pt 11.5pt }
table.cs td { padding: 7pt 11.5pt 9pt; vertical-align: top; width: 50% }
table.cs tr:nth-child(odd) td { background: #fff } table.cs tr:nth-child(even) td { background: #f2f6f5 }
table.cs tr:last-child td { border-bottom: .7pt solid #dce4e8 }
.ki { background: #0b7e71; color: #fff; margin-top: 18pt; padding: 17pt 18pt 18pt }
.ki .lbl { color: #9ed8d2; margin-bottom: 6pt }
.ki p { font-size: 9.5pt; line-height: 1.5; margin-top: 5pt }
.ki p.b { font-weight: 700 }
.top2 { position: absolute; left: 36pt; top: 32.8pt; width: 480pt }
.top2 h2 { font-weight: 700; font-size: 18pt; line-height: 1.25; color: #000; margin-top: 4pt }
.logo2 { position: absolute; left: 532.8pt; top: 27.3pt; width: 43.2pt; height: 43.2pt }
.col { position: absolute; overflow: hidden }
.col p { font-size: var(--fs, 9pt); line-height: var(--lh, 13pt); margin-bottom: 5pt }
.col p b { color: #0b7e71; font-weight: 700 }
.col h3 { font-weight: 700; font-size: calc(var(--fs, 9pt) + 1.5pt); line-height: 1.3; color: #0b7e71; margin: 6pt 0 3pt }
.col h3:first-child { margin-top: 0 }
.col img { display: block; width: 100%; margin-bottom: 10pt }
.foot { position: absolute; left: 0; top: 734.4pt; width: 612pt; height: 57.6pt; background: #000; overflow: hidden }
.foot .r { position: absolute; left: 439.2pt; top: 0; width: 172.8pt; height: 57.5pt }
.foot .h { position: absolute; left: 36pt; top: 14pt; font-weight: 700; font-size: 12pt; color: #fff }
.foot .c { position: absolute; left: 36pt; top: 36pt; font-size: 8.5pt; color: #d5dee0 }
"""

FLOW_JS = """
(function () {
  // Fill the story into columns: col boxes are listed in order; paragraphs split word by word across boxes.
  var items = window.STORY, boxes = [].slice.call(document.querySelectorAll('.col[data-flow]'));
  var bi = 0, box = boxes[0];
  function fits() { return box.scrollHeight <= box.clientHeight + 0.5; }
  function next() { bi++; box = boxes[bi]; if (!box) throw new Error('OVERFLOW'); }
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (it[0] === 'h') {
      var h = document.createElement('h3'); h.textContent = it[1]; box.appendChild(h);
      // a heading needs two lines of text after it in the same column
      var probe = document.createElement('p'); probe.innerHTML = 'x<br>x'; box.appendChild(probe);
      var ok = fits(); box.removeChild(probe);
      if (!ok) { box.removeChild(h); next(); box.appendChild(h); }
      continue;
    }
    if (it[0] === 'img') { var im = document.createElement('img'); im.src = it[1]; box.appendChild(im); if (!fits()) { box.removeChild(im); next(); box.appendChild(im); } continue; }
    var p = document.createElement('p'); p.innerHTML = it[1]; box.appendChild(p);
    if (fits()) continue;
    // split: keep as many words here as fit (at least two lines), carry the rest
    var tokens = it[1].match(/<b>.*?<\\/b>|[^\\s<]+(?:<[^>]+>)?|\\s+/g) || [];
    var words = []; tokens.forEach(function (t) {
      var m = t.match(/^<b>(.*)<\\/b>$/); if (m) m[1].split(/(\\s+)/).forEach(function (w) { if (w) words.push(/^\\s+$/.test(w) ? w : '<b>' + w + '</b>'); }); else words.push(t); });
    var lo = 0, hi = words.length;
    while (lo < hi) { var mid = Math.ceil((lo + hi) / 2); p.innerHTML = words.slice(0, mid).join(''); if (fits()) lo = mid; else hi = mid - 1; }
    var lines = Math.round(p.getBoundingClientRect().height / (parseFloat(getComputedStyle(p).lineHeight)/(96/72)*96/72));
    if (lo === 0 || lines < 2) { box.removeChild(p); next(); i--; continue; }
    p.innerHTML = words.slice(0, lo).join('');
    var rest = words.slice(lo).join('').replace(/^\\s+/, '');
    next(); items.splice(i + 1, 0, ['p', rest]);
  }
  window.USED = bi + 1;
  // how full the last box is
  var last = boxes[bi], kids = last.children, bottom = 0;
  for (var k = 0; k < kids.length; k++) bottom = Math.max(bottom, kids[k].offsetTop + kids[k].offsetHeight);
  window.LASTFILL = bottom / last.clientHeight;
})();
"""

def footer(A):
    return ('<div class="foot"><img class="r" src="%s"><div class="h">SOLVING YOUR MOST COMPLEX MARKETING CHALLENGES</div>'
            '<div class="c">www.adtaxi.com &nbsp;·&nbsp; info@adtaxi.com &nbsp;·&nbsp; 877.856.4668</div></div>') % A['rings']

def page_html(d, npages, A):
    hdr = ('<div class="hdr" id="hdr"><img class="photo" src="%s"><img class="ring" src="%s"><img class="logo" src="%s">'
           '<div class="txt"><div class="lbl">Case study</div><h1>%s</h1>%s<div class="tags">%s</div></div></div>') % (
        uri(d['photo']), A['ring'], A['logo'], E(d['title']),
        ('<div class="sub">%s</div>' % E(d['subtitle'])) if d.get('subtitle') else '',
        ''.join('<span>%s</span>' % E(t) for t in d['tags']))
    cards = ''.join('<div class="card"><div class="n%s">%s</div><div class="t">%s</div></div>' % (' w' if len(r[0]) > 7 else '', E(r[0]), '<br>'.join(E(x) for x in r[1:])) for r in d['results'])
    rows = ''.join('<tr><td>%s</td><td>%s</td></tr>' % (E(c), E(s)) for c, s in d['table'])
    th = d.get('table_head', ['Challenges', 'Solutions'])
    ki = ''.join('<p%s>%s</p>' % (' class="b"' if (isinstance(p, list)) else '', E(p[0] if isinstance(p, list) else p)) for p in d['insights'])
    p1 = ('<div class="page">%s<div class="body1" id="b1"><div class="lbl">Results</div><div class="cards">%s</div>'
          '<table class="cs"><tr><th>%s</th><th>%s</th></tr>%s</table><div class="ki"><div class="lbl">Key insights</div>%s</div></div></div>') % (
        hdr, cards, E(th[0]), E(th[1]), rows, ki)
    pages = [p1]
    for n in range(2, npages + 1):
        last = n == npages
        top = 90.5 if n == 2 else 36
        bottom = 720 if last else 756
        head = ('<div class="top2"><div class="lbl">The full story</div><h2>%s</h2></div>' % E(d['story_head'])) if n == 2 else ''
        cols = ('<div class="col" data-flow style="left:36pt;top:%spt;width:252pt;height:%spt"></div>'
                '<div class="col" data-flow style="left:318.6pt;top:%spt;width:257.4pt;height:%spt"></div>') % (top, bottom - top, top, bottom - top)
        pages.append('<div class="page">%s<img class="logo2" src="%s">%s%s</div>' % (head, A['logo_s'], cols, footer(A) if last else ''))
    story = [['p', s] if isinstance(s, str) else s for s in d['story']]
    # the illustration opens the second column of page 2
    story_js = json.dumps(story)
    return ('<!doctype html><html><head><meta charset="utf-8"><style>%s</style></head><body>%s'
            '<script>window.STORY=%s; window.ILL=%s;</script></body></html>') % (CSS, ''.join(pages), story_js, json.dumps(uri(d['ill'])) if d.get('ill') else 'null')

async def render(d, out):
    A = {k: uri('assets/%s.png' % v) for k, v in [('logo', 'logo_big'), ('logo_s', 'logo_small'), ('ring', 'ring'), ('rings', 'footer_rings')]}
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page()
        tries = d.get('tries') and [tuple(t) for t in d['tries']] or [(2, 9.0), (2, 8.6), (2, 8.2), (3, 9.0)]
        for npages, fs in tries:
            await pg.set_content(page_html(d, npages, A)); await pg.evaluate('document.fonts.ready')
            await pg.evaluate("fs => { document.body.style.setProperty('--fs', fs + 'pt'); document.body.style.setProperty('--lh', (fs * 13 / 9).toFixed(2) + 'pt'); }", fs)
            # header height follows its text; the body starts 20pt below it
            await pg.evaluate("""() => { var h = document.getElementById('hdr'), t = h.querySelector('.txt');
                var px = Math.max(t.offsetHeight + 40*96/72, 230.3*96/72); h.style.height = px + 'px';
                var b = document.getElementById('b1'); b.style.top = (px + 20*96/72) + 'px'; }""")
            # place the illustration as the first item of page 2's second column
            await pg.evaluate("""() => { if (!window.ILL) return; var s = window.STORY, cols = document.querySelectorAll('.col[data-flow]');
                var im = document.createElement('img'); im.src = window.ILL; cols[1].appendChild(im); }""")
            await pg.wait_for_timeout(200)
            try:
                await pg.evaluate(FLOW_JS)
            except Exception as e:
                if 'OVERFLOW' in str(e): continue
                raise
            used, fill = await pg.evaluate('[window.USED, window.LASTFILL]')
            if npages == 3 and used < 5 or (npages == 3 and used == 5 and fill < 0.15):
                print('warning: third page would be nearly empty')
            p1 = await pg.evaluate("() => { var b=document.getElementById('b1'); return (b.offsetTop+b.offsetHeight)*72/96; }")
            print('pages', npages, 'font', fs, 'columns used', used, 'last column fill %.0f%%' % (fill * 100), 'page 1 bottom %.0fpt' % p1)
            await pg.pdf(path=out, width='8.5in', height='11in', print_background=True, prefer_css_page_size=True)
            break
        else:
            raise SystemExit('story does not fit in 3 pages')
        await b.close()

if __name__ == '__main__':
    d = json.load(open(sys.argv[1])); os.makedirs(sys.argv[2], exist_ok=True)
    out = os.path.join(sys.argv[2], os.path.basename(sys.argv[1]).replace('.json', '.pdf'))
    asyncio.run(render(d, out)); print(out)
