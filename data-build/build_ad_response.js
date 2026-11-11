// Builds shared/media/ad-response.json for the Research Library's Ad Response view from each analyzer's
// adResponse block (AudienceSCAN 2026). Subcategories that share one survey group are listed under that group.
// Run from the repo root: node data-build/build_ad_response.js
const fs = require("fs");
const CATS = [["apartments", "Apartments", "apartment-analyzer"], ["auto", "Auto", "auto"], ["financial", "Financial", "financial"],
  ["furniture", "Furniture", "furniture-analyzer"], ["healthcare", "Healthcare", "healthcare"], ["higher-ed", "Higher Education", "higher-ed"],
  ["home-services", "Home Services", "home-services"], ["legal", "Legal", "legal"]];
function block(s, key) {
  const i = s.indexOf('"' + key + '"'); if (i < 0) return null;
  const open = s.slice(i).search(/[\[{]/) + i, o = s[open], c = o === "{" ? "}" : "]";
  let d = 0, k = open;
  for (; k < s.length; k++) { if (s[k] === o) d++; else if (s[k] === c && !--d) break; }
  return JSON.parse(s.slice(open, k + 1));
}
const out = { source: "2026 AudienceSCAN® study", cats: [] };
for (const [id, name, dir] of CATS) {
  const s = fs.readFileSync(dir + "/index.html", "utf8"), ar = block(s, "adResponse"), subs = block(s, "subcategories") || [];
  const label = {}; subs.forEach(x => { label[x.id] = x.label; });
  const groups = [];
  Object.keys(ar.subs).forEach(sid => {
    const g = ar.subs[sid], sig = JSON.stringify(g.rows);
    let hit = groups.find(x => x.sig === sig && x.short === g.short);
    if (!hit) { hit = { sig, short: g.short, audience: g.audience, rows: g.rows, for: [] }; groups.push(hit); }
    hit.for.push(label[sid] || sid);
  });
  out.cats.push({ id, name, groups: groups.map(g => ({ short: g.short, audience: g.audience, for: g.for, rows: g.rows })) });
}
fs.writeFileSync("shared/media/ad-response.json", JSON.stringify(out));
out.cats.forEach(c => console.log(c.name + ": " + c.groups.map(g => g.short + " [" + g.for.join(", ") + "]").join("; ")));
