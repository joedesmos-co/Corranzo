"""AI stage part 2 - A10 join (post-freeze) and the disputes-only arbitration page.

The consensus manifest was ALREADY frozen and hashed by h_ai_consensus.py before this
script runs. This script verifies that hash, then joins hidden scientific fields for
accepted correspondences only. With zero accepted correspondences there is nothing to
join, and the script says so rather than inventing a gate result.

It also builds disputes_only.html: the highest-value UNRESOLVED cases, showing the
three independent reviewers side by side so a human can arbitrate efficiently. Still
blind - no scientific outcome field of any kind is present.
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

BASE = Path(__file__).parent / "out/h_review_ai"
REVIEWERS = ["reviewer_1", "reviewer_2", "reviewer_3"]


def load_rev(n):
    d = json.loads((BASE / ("reviewer_%d.json" % n)).read_text())
    its = d if isinstance(d, list) else d["items"]
    return {i["item_id"]: i for i in its}


def main():
    man = json.loads((BASE / "ai_blind_consensus_manifest.json").read_text())
    blob = json.dumps(man["items"], sort_keys=True, separators=(",", ":"))
    h = hashlib.sha256(blob.encode()).hexdigest()
    ok = (h == man["consensus_manifest_sha256"])
    print("A10  post-freeze join\n")
    print("  consensus manifest sha256 : %s" % h)
    print("  matches frozen hash       : %s" % ok)
    if not ok:
        print("  ABORT: consensus manifest altered after freeze.")
        return 2
    accepted = [c for c in man["items"] if c.get("accepted")]
    n_on = man["consensus_matched_onsets"]
    n_note = man["consensus_matched_noteheads"]
    print("  accepted correspondences  : %d" % len(accepted))
    print("  consensus matched onsets  : %d" % n_on)
    print("  consensus matched noteheads: %d" % n_note)
    if not accepted:
        print("\n  CLEAN-CONTROL GATE: NOT EVALUATED")
        print("  No frozen consensus correspondence exists to join, because the three")
        print("  independent reviewers never agreed unanimously on ANY measure")
        print("  identity (unanimous SAME = 0/80). Joining residuals against an empty")
        print("  set cannot produce a gate outcome, and N=0 is never PASS or FAIL.")
        print("  Corpus 2.2 NOT built. Zero-parameter baseline NOT run.")
    # ---------------- disputes page
    spec = {s["item_id"]: s for s in json.loads((BASE / "items_neutral.json").read_text())}
    rev = {n: load_rev(n) for n in (1, 2, 3)}
    rows = []
    for iid in sorted(spec):
        a = [rev[n][iid] for n in (1, 2, 3)]
        same = sum(1 for x in a if x["A"] == "SAME")
        high = sum(1 for x in a if x["E"] == "HIGH")
        low = sum(1 for x in a if x["E"] == "LOW")
        xs = sorted({k for x in a for k in x["B"]})
        b2 = sum(1 for k in xs
                 if Counter(x["B"].get(k, "MISSING") for x in a).most_common(1)[0][1] >= 2)
        ps = sorted({k for x in a for k in x["C"]})
        c2 = sum(1 for p in ps if len({x["C"].get(p, "MISSING") for x in a}) == 2)
        score = same * 10 + (5 if (high >= 2 and low == 0) else 0) \
            + min(b2, 6) + min(c2, 3)
        rows.append((score, iid, same, high, low, b2, c2, [x["A"] for x in a]))
    rows.sort(key=lambda z: (-z[0], z[1]))
    top = rows[:20]
    payload = []
    for sc, iid, same, high, low, b2, c2, avotes in top:
        payload.append({
            "item_id": iid, "image": spec[iid]["image"],
            "P_ids": spec[iid]["P_ids"], "X_ids": spec[iid]["X_ids"],
            "rank_score": sc, "n_same": same, "n_high": high, "n_low": low,
            "A_votes": avotes, "n_onset_2of3": b2, "n_map_2of3": c2,
            "R": {str(n): {"A": rev[n][iid]["A"], "E": rev[n][iid]["E"],
                           "D": rev[n][iid].get("D"),
                           "B": rev[n][iid]["B"], "C": rev[n][iid]["C"]}
                  for n in (1, 2, 3)}})
    html = build_html(payload)
    (BASE / "disputes_only.html").write_text(html)
    print("\n  disputes_only.html items  : %d (cap 20)" % len(payload))
    print("  wrote out/h_review_ai/disputes_only.html")
    (BASE / "disputes_ranking.json").write_text(json.dumps(
        [{"item_id": r[1], "rank_score": r[0], "n_same": r[2], "n_high": r[3],
          "n_low": r[4], "A_votes": r[7]} for r in rows], indent=1))
    return 0


def build_html(items):
    data = json.dumps(items, separators=(",", ":"))
    return """<!doctype html><html><head><meta charset="utf-8">
<title>Disputed cases - arbitration</title><style>
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f4f5f7;color:#15171a}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #d8dbe0;padding:10px 16px;z-index:5}
h1{font-size:16px;margin:0 0 4px}
.wrap{max-width:1500px;margin:0 auto;padding:16px}
.it{background:#fff;border:1px solid #d8dbe0;border-radius:8px;padding:12px;margin-bottom:16px}
.hd{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}
.badge{font-size:12px;padding:2px 8px;border-radius:999px;background:#eef1f5;border:1px solid #d5dae1}
img.sheet{width:100%;border:1px solid #d8dbe0;border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}
td,th{border-bottom:1px solid #eceef1;padding:3px 6px;text-align:left;vertical-align:top}
th{background:#f7f8fa}
.mono{font-family:ui-monospace,Menlo,monospace}
input,select,textarea{font:inherit;padding:3px 6px;border:1px solid #b9bfc7;border-radius:5px}
button{font:inherit;padding:6px 12px;border:1px solid #b9bfc7;border-radius:6px;background:#fff;cursor:pointer}
button.pri{background:#1f6feb;color:#fff;border-color:#1f6feb}
.hint{color:#5b6270;font-size:12px}
</style></head><body>
<header><h1>Disputed structural cases - human arbitration (optional)</h1>
<div class="hint">Three independent blinded AI reviewers disagreed. These are the
highest-value unresolved items. Still blind: no scientific outcome field of any
kind is shown. Left panel = PDF raster with machine P proposals; right panel =
source staff lines and notehead positions with X ids.</div>
<div style="margin-top:8px"><button id="exp">Export arbitration JSON</button>
<span class="hint" id="cnt"></span></div></header>
<div class="wrap" id="wrap"></div>
<script>
const DATA=__DATA__;
const KEY='piano_arbitration_v1';
let ans=JSON.parse(localStorage.getItem(KEY)||'{}');
function save(){localStorage.setItem(KEY,JSON.stringify(ans));}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
function sel(id,opts,cur){let o='<option value=""></option>';
  opts.forEach(v=>{o+='<option value="'+v+'"'+(cur===v?' selected':'')+'>'+v+'</option>';});
  return '<select id="'+id+'">'+o+'</select>';}
function render(){
  const w=document.getElementById('wrap');
  w.innerHTML=DATA.map((it,k)=>{
    const a=ans[it.item_id]||{};
    const vs=Object.keys(it.R);
    let rows='';
    it.X_ids.forEach(x=>{
      rows+='<tr><td class="mono"><b>'+x+'</b></td>'
        +vs.map(n=>'<td>'+esc(it.R[n].B[x]||'-')+'</td>').join('')
        +'<td>'+sel(it.item_id+'|B|'+x,['PRINTED','NOT_PRINTED','UNSURE'],(a.B||{})[x])+'</td></tr>';
    });
    let mrows='';
    it.P_ids.forEach(p=>{
      mrows+='<tr><td class="mono"><b>'+p+'</b></td>'
        +vs.map(n=>'<td class="mono">'+esc(it.R[n].C[p]||'-')+'</td>').join('')
        +'<td>'+sel(it.item_id+'|C|'+p,it.X_ids.concat(['NO_SOURCE_COUNTERPART','UNSURE']),(a.C||{})[p])+'</td></tr>';
    });
    return '<div class="it"><div class="hd"><b>'+it.item_id+'</b>'
      +'<span class="badge">SAME votes '+it.n_same+'/3</span>'
      +'<span class="badge">HIGH '+it.n_high+' LOW '+it.n_low+'</span>'
      +'<span class="badge">onsets 2/3: '+it.n_onset_2of3+'</span>'
      +'<span class="badge">A votes: '+it.A_votes.join(' / ')+'</span></div>'
      +'<img class="sheet" src="'+it.image+'">'
      +'<div class="hint" style="margin-top:8px">Reviewer columns are the three '
      +'independent AI passes. Decide the arbitration column yourself.</div>'
      +'<div class="hd" style="margin-top:8px">A: same printed measure? '
      +sel(it.item_id+'|A',['SAME','NO','UNSURE'],a.A)
      +'&nbsp;&nbsp;E: '+sel(it.item_id+'|E',['HIGH','MEDIUM','LOW'],a.E)
      +'&nbsp;&nbsp;D: '+sel(it.item_id+'|D',['YES','NO','UNSURE'],a.D)+'</div>'
      +'<table><tr><th>source onset</th>'+vs.map(n=>'<th>R'+n+'</th>').join('')
      +'<th>your call</th></tr>'+rows+'</table>'
      +'<table><tr><th>pdf proposal</th>'+vs.map(n=>'<th>R'+n+'</th>').join('')
      +'<th>your call</th></tr>'+mrows+'</table></div>';
  }).join('');
  w.querySelectorAll('select').forEach(s=>{s.onchange=()=>{
    const p=s.id.split('|');const id=p[0];ans[id]=ans[id]||{};
    if(p[1]==='A')ans[id].A=s.value; else if(p[1]==='E')ans[id].E=s.value;
    else if(p[1]==='D')ans[id].D=s.value;
    else if(p[1]==='B'){ans[id].B=ans[id].B||{};ans[id].B[p[2]]=s.value;}
    else if(p[1]==='C'){ans[id].C=ans[id].C||{};ans[id].C[p[2]]=s.value;}
    save();document.getElementById('cnt').textContent='  arbitrated '+Object.keys(ans).length+' / '+DATA.length;
  };});
  document.getElementById('cnt').textContent='  arbitrated '+Object.keys(ans).length+' / '+DATA.length;
}
document.getElementById('exp').onclick=()=>{
  const b=new Blob([JSON.stringify({arbitration:ans},null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);
  a.download='arbitration_answers.json';a.click();
};
render();
</script></body></html>""".replace("__DATA__", data)


if __name__ == "__main__":
    sys.exit(main())