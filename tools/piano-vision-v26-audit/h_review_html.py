"""H7-H11 - README, dependency-free HTML review tool, QC and projection.

Reads the BLIND manifest only. Writes:
  out/h_review/README.md
  out/h_review/review.html      (local, no server, no external dependency)
  out/h_review/h_qc.json
  out/h_review/h_projection.json
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402

PKT = Path(__file__).parent / "out/h_review"
BLIND_FORBIDDEN = ("residual", "d0", "true_d", "midi", "decoder", "mismatch",
                   "correct", "answer", "sign", "truepitch")

README = """# Structural correspondence review packet

You are adjudicating **whether a printed PDF measure and a MusicXML/Verovio measure
are the same music and whether their printed events correspond**. You are NOT judging
pitch, and nothing about pitch is shown to you.

## What is in each item

Each review item is **one mapped measure on one staff**.

* **LEFT — PDF raster.** The actual page image crop for that measure, with machine
  proposals labelled `P1, P2, ...`.
* **RIGHT — source structure.** The same measure rendered from the Verovio layout as
  **staff lines and notehead positions only**. No note names, no MIDI, no stems, no
  glyphs. Onset groups are labelled `X1, X2, ...`.

The two panels are drawn at different scales and are **not x-aligned**: the PDF and
Verovio engrave the same music with different spacing. Judge **counts, order and
cardinality**, never horizontal alignment between panels.

## Important caveat about the `P` labels

The `P` labels are **machine proposals from an unreliable raster detector**. That
detector was measured at roughly 0.22 precision on general notation. So expect:

* `P` labels on things that are not noteheads (clefs, time signatures, rests,
  accidentals),
* printed noteheads that carry **no** `P` label at all.

**Trust your eyes over the `P` labels.** If you see a printed onset that is not
listed, record it in the notes field for that item.

## Questions per item

**A.** Are the PDF and the source the same printed measure? `YES` / `NO` / `UNSURE`

**B.** For each source onset `Xn`: is it printed in the PDF?
`PRINTED_IN_PDF` / `NOT_PRINTED_IN_PDF` / `UNSURE`

**C.** For each PDF proposal `Pn`: does it match a source onset? Choose the `Xn` it
matches, or `NO_COUNTERPART`, or `UNSURE`.

**D.** Where onset correspondence is established, does notehead cardinality agree?
`YES` / `NO` / `UNSURE` / `N_A`

**E.** Your confidence in this item: `HIGH` / `MEDIUM` / `LOW`

Then, **only for items where you set E = HIGH**, the notehead second pass opens:
each matched onset pair is shown zoomed with noteheads numbered vertically
`P1a, P1b, ...` against `X1a, X1b, ...`. Decide whether top maps to top, second to
second, and so on, or mark the group `AMBIGUOUS`.

## How to use the HTML tool

Open `review.html` in any browser. It is fully local: no server, no network, no
install. Answers autosave to the browser, so you can stop and resume. Use
**Export JSON** when finished; save the file next to this README as
`review_answers.json`.

The PNG sheets in `sheets/` show the same items if you would rather work in an image
viewer; in that case record answers in any format that keeps the `item_id`.

## What happens next

Your answers are used to build a **structurally frozen correspondence manifest**
before any pitch or residual is inspected. Only after that freeze is anything
computed about pitch agreement. Proven source disagreements will be **refused, never
relabelled**.

## Do not

* judge pitch, name notes, or infer octave;
* consult any corpus residual, `d0`, `true_d` or decoder output while reviewing;
* assume the `P` labels are correct.
"""

HTML_HEAD = """<!doctype html><html><head><meta charset="utf-8">
<title>Structural correspondence review</title><style>
body{font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f4f5f7;color:#15171a}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #d8dbe0;padding:10px 16px;z-index:5}
h1{font-size:16px;margin:0 0 4px}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
button{font:inherit;padding:6px 12px;border:1px solid #b9bfc7;border-radius:6px;background:#fff;cursor:pointer}
button:hover{background:#eef1f5}
button.pri{background:#1f6feb;color:#fff;border-color:#1f6feb}
.wrap{max-width:1500px;margin:0 auto;padding:16px}
.meta{background:#fff;border:1px solid #d8dbe0;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px}
.meta b{font-weight:600}
img.sheet{width:100%;background:#fff;border:1px solid #d8dbe0;border-radius:8px}
fieldset{border:1px solid #d8dbe0;border-radius:8px;background:#fff;margin:0 0 12px;padding:10px 12px}
legend{font-weight:600;font-size:13px;padding:0 4px}
label{display:inline-flex;gap:5px;align-items:center;margin-right:12px}
table{border-collapse:collapse;width:100%;font-size:13px}
td,th{border-bottom:1px solid #eceef1;padding:4px 6px;text-align:left}
select{font:inherit;padding:3px 6px;border:1px solid #b9bfc7;border-radius:5px;background:#fff}
textarea{width:100%;min-height:52px;font:inherit;padding:6px;border:1px solid #b9bfc7;border-radius:6px}
.hint{color:#5b6270;font-size:12px}
.prog{font-size:13px;color:#5b6270}
.zwrap{margin-top:8px}
.zwrap img{width:100%;border:1px solid #d8dbe0;border-radius:6px;background:#fff}
</style></head><body>
<header><h1>Structural correspondence review &mdash; blinded</h1>
<div class="bar">
<button id="prev">&larr; Prev</button><button id="next" class="pri">Next &rarr;</button>
<span class="prog" id="prog"></span>
<button id="exp">Export JSON</button>
<button id="clr">Clear this item</button>
<span class="hint">autosaves locally &middot; no pitch anywhere</span>
</div></header><div class="wrap" id="wrap"></div>
<script>
const DATA = __DATA__;
const KEY='piano_review_v1';
let idx=0, ans=JSON.parse(localStorage.getItem(KEY)||'{}');
function save(){localStorage.setItem(KEY,JSON.stringify(ans));}
function cur(){return DATA[idx];}
function get(id){return ans[id]||(ans[id]={});}
function render(){
  const it=cur(), a=get(it.item_id), w=document.getElementById('wrap');
  const opt=(v,l)=>'<option value="'+v+'">'+l+'</option>';
  let h='<div class="meta"><b>'+it.item_id+'</b> &middot; score <b>'+it.score+'</b>'
    +' &middot; page '+it.page+' &middot; system '+it.system+' &middot; staff <b>'+it.staff+'</b>'
    +' &middot; PDF measure <b>'+it.pdf_ord+'</b> &middot; source measure <b>'+it.xml_ord+'</b>'
    +' &middot; map class '+it.mapping_class+'</div>';
  h+='<img class="sheet" src="'+it.sheet+'">';
  h+='<p class="hint">Left = PDF raster with machine proposals P*. Right = source staff lines + notehead positions only, X*. '
    +'Panels are NOT x-aligned. P labels are unreliable &mdash; trust your eyes.</p>';
  h+='<fieldset><legend>A. Same printed measure?</legend>';
  ['YES','NO','UNSURE'].forEach(v=>{h+='<label><input type="radio" name="A" value="'+v+'"'+(a.A===v?' checked':'')+'>'+v+'</label>';});
  h+='</fieldset>';
  h+='<fieldset><legend>B. For each source onset: printed in the PDF?</legend><table><tr><th>onset</th><th>answer</th></tr>';
  it.source_onsets.forEach(o=>{const cur2=(a.B&&a.B[o.sid])||'';
    h+='<tr><td><b>'+o.sid+'</b></td><td><select data-B="'+o.sid+'"><option value=""></option>'
      +opt('PRINTED_IN_PDF','PRINTED_IN_PDF')+opt('NOT_PRINTED_IN_PDF','NOT_PRINTED_IN_PDF')
      +opt('UNSURE','UNSURE')+'</select></td></tr>';});
  h+='</table></fieldset>';
  h+='<fieldset><legend>C. For each PDF proposal: which source onset does it match?</legend><table><tr><th>proposal</th><th>match</th></tr>';
  it.pdf_onsets.forEach(o=>{const cur2=(a.C&&a.C[o.pid])||'';
    h+='<tr><td><b>'+o.pid+'</b></td><td><select data-C="'+o.pid+'"><option value="'+cur2+'"></option>';
    it.source_onsets.forEach(s=>{h+='<option value="'+s.sid+'"'+(cur2===s.sid?' selected':'')+'>'+s.sid+'</option>';});
    h+=opt('NO_COUNTERPART','NO_COUNTERPART')+opt('UNSURE','UNSURE')+'</select></td></tr>';});
  h+='</table></fieldset>';
  h+='<fieldset><legend>D. Notehead cardinality agrees?</legend>';
  ['YES','NO','UNSURE','N_A'].forEach(v=>{h+='<label><input type="radio" name="D" value="'+v+'"'+(a.D===v?' checked':'')+'>'+v+'</label>';});
  h+='</fieldset><fieldset><legend>E. Confidence</legend>';
  ['HIGH','MEDIUM','LOW'].forEach(v=>{h+='<label><input type="radio" name="E" value="'+v+'"'+(a.E===v?' checked':'')+'>'+v+'</label>';});
  h+='</fieldset>';
  h+='<fieldset><legend>Notes (e.g. printed onsets you can see that carry no P label)</legend>'
    +'<textarea data-N="1">'+((a.notes||'').replace(/</g,'&lt;'))+'</textarea></fieldset>';
  h+='<div id="zp"></div>';
  w.innerHTML=h;
  w.querySelectorAll('input[type=radio]').forEach(r=>{r.onchange=()=>{a[r.name]=r.value;save();if(r.name==='E')loadZoom();};});
  w.querySelectorAll('[data-B]').forEach(s=>{s.value=(a.B&&a.B[s.dataset.B])||'';s.onchange=()=>{a.B=a.B||{};a.B[s.dataset.B]=s.value;save();};});
  w.querySelectorAll('[data-C]').forEach(s=>{s.value=(a.C&&a.C[s.dataset.C])||'';s.onchange=()=>{a.C=a.C||{};a.C[s.dataset.C]=s.value;save();};});
  w.querySelector('[data-N]').oninput=e=>{a.notes=e.target.value;save();};
  document.getElementById('prog').textContent='item '+(idx+1)+' / '+DATA.length
    +(Object.keys(ans).length?'   answered '+Object.keys(ans).length:'');
  loadZoom();
}
function loadZoom(){
  const it=cur(), a=get(it.item_id), z=document.getElementById('zp');
  if(!z) return;
  if(a.E!=='HIGH'){z.innerHTML='<p class="hint">Notehead second pass unlocks when confidence = HIGH.</p>';return;}
  const zs=a.Z||{};
  let h='<fieldset><legend>Notehead second pass (HIGH confidence items only)</legend>'
    +'<p class="hint">For each matched onset pair, decide whether noteheads pair by vertical rank '
    +'(top&#8594;top, second&#8594;second) or are AMBIGUOUS. No pitch.</p><table><tr><th>pair</th><th>verdict</th></tr>';
  Object.keys(a.C||{}).forEach(pid=>{
    const sid=a.C[pid]; if(!sid||sid==='NO_COUNTERPART'||sid==='UNSURE') return;
    h+='<tr><td><b>'+pid+'</b> &#8594; '+sid+'</td><td><select data-Z="'+pid+'"><option value="'+(zs[pid]||'')+'"></option>'
      +'<option value="RANK_OK">RANK_OK (top&#8594;top)</option><option value="AMBIGUOUS">AMBIGUOUS</option></select></td></tr>';
  });
  h+='</table></fieldset>';
  z.innerHTML=h;
  z.querySelectorAll('[data-Z]').forEach(s=>{s.onchange=()=>{a.Z=a.Z||{};a.Z[s.dataset.Z]=s.value;save();};});
}
document.getElementById('prev').onclick=()=>{if(idx>0){idx--;render();}};
document.getElementById('next').onclick=()=>{if(idx<DATA.length-1){idx++;render();}};
document.getElementById('clr').onclick=()=>{delete ans[cur().item_id];save();render();};
document.getElementById('exp').onclick=()=>{
  const blob=new Blob([JSON.stringify({reviewer:'__NAME__',items:ans},null,1)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='review_answers.json'; a.click();
};
document.addEventListener('keydown',e=>{
  if(e.key==='ArrowRight'&&!e.shiftKey){document.getElementById('next').click();}
  if(e.key==='ArrowLeft'){document.getElementById('prev').click();}
});
render();
</script></body></html>"""


def main():
    man = json.loads((PKT.parent / "h_review_manifest.json").read_text())
    items = man["items"]
    # ---------------- QC (H10): programmatic over every item + blinding audit
    qc = {"items": len(items), "checked": [], "problems": []}
    for it in items:
        probs = []
        for f in ("item_id", "score", "page", "system", "pdf_ord", "xml_ord",
                  "mapping_class", "staff", "sheet", "pdf_onsets",
                  "source_onsets", "questions"):
            if f not in it or it[f] in (None, "", []):
                if f not in ("pdf_onsets",):
                    probs.append("missing %s" % f)
        sp = PKT.parent / it["sheet"]
        if not Path(sp).is_file():
            probs.append("sheet missing")
        else:
            from PIL import Image
            with Image.open(sp) as im:
                w, h = im.size
            if w < 400 or h < 80:
                probs.append("sheet too small %dx%d" % (w, h))
        pids = [o["pid"] for o in it["pdf_onsets"]]
        sids = [o["sid"] for o in it["source_onsets"]]
        if pids != ["P%d" % (i + 1) for i in range(len(pids))]:
            probs.append("P ids not sequential")
        if sids != ["X%d" % (i + 1) for i in range(len(sids))]:
            probs.append("X ids not sequential")
        qc["checked"].append({"item_id": it["item_id"], "score": it["score"],
                              "page": it["page"], "staff": it["staff"],
                              "n_P": len(pids), "n_X": len(sids),
                              "problems": probs})
        if probs:
            qc["problems"].append({"item_id": it["item_id"], "problems": probs})
    blob = json.dumps(items).lower()
    leaks = [b for b in BLIND_FORBIDDEN if b in blob]
    qc["blinding_leaks"] = leaks
    qc["pass"] = (not qc["problems"]) and (not leaks)
    (PKT / "h_qc.json").write_text(json.dumps(qc, indent=1))

    # ---------------- README + HTML
    (PKT / "README.md").write_text(README)
    slim = [{k: it[k] for k in ("item_id", "score", "page", "system", "pdf_ord",
                                "xml_ord", "mapping_class", "staff", "sheet",
                                "pdf_onsets", "source_onsets")} for it in items]
    html = HTML_HEAD.replace("__DATA__", json.dumps(slim, separators=(",", ":")))
    (PKT / "review.html").write_text(html)

    # ---------------- H11 projection
    internal = json.loads((PKT.parent / "h_review_lookup_INTERNAL.json").read_text())["items"]
    wo = json.load(open(Path(__file__).parent / "out/L2_measure_workorder.json"))
    wmap = {(w["score"], w["page"], w["system"], w["xml_ord"]): w for w in wo}
    pot = catA = catB = 0
    per_item = []
    for it, iv in zip(items, internal):
        k = (it["score"], it["page"], it["system"], it["xml_ord"])
        w = wmap.get(k)
        n_src = sum(o["card"] for o in it["source_onsets"])
        # per-ROLE, otherwise each measure is counted once for its upper item and
        # again for its lower item, doubling the covered totals.
        rr = (w or {}).get("roles", {}).get(it["staff"], {})
        a = rr.get("missing", 0)
        b = rr.get("ambiguous", 0)
        catA += a
        catB += b
        pot += n_src
        per_item.append({"item_id": it["item_id"], "score": it["score"],
                         "n_source_noteheads": n_src, "catA_missing": a,
                         "catB_ambiguous": b})
    proj = {}
    for frac in (0.5, 0.75, 1.0):
        proj["%.0f%%" % (frac * 100)] = {
            "high_confidence_matches_estimate": int(round(pot * frac)),
            "clean_gate_N_if_all_matched": int(round(pot * frac))}
    payload = {
        "review_measures": len(items),
        "review_onset_groups": sum(len(i["pdf_onsets"]) + len(i["source_onsets"])
                                   for i in items),
        "potential_paired_noteheads": pot,
        "pdf_proposals": sum(len(i["pdf_onsets"]) for i in items),
        "scores": sorted({i["score"] for i in items}),
        "n_scores": len({i["score"] for i in items}),
        "category_A_missing_covered": catA,
        "category_B_ambiguous_covered": catB,
        "mapping_classes": dict(Counter(i["mapping_class"] for i in items)),
        "staff_split": dict(Counter(i["staff"] for i in items)),
        "per_item": per_item,
        "projection": proj,
        "human_decisions_estimate": {
            "per_item": 1 + len("B") and 5,
            "A": len(items), "D": len(items), "E": len(items),
            "B_selects": sum(len(i["source_onsets"]) for i in items),
            "C_selects": sum(len(i["pdf_onsets"]) for i in items),
            "notehead_second_pass_pairs": "only HIGH-confidence items"},
    }
    (PKT / "h_projection.json").write_text(json.dumps(payload, indent=1))

    print("H7-H11  packet artifacts + QC + projection")
    print("  items=%d  onset groups=%d  potential paired noteheads=%d"
          % (payload["review_measures"], payload["review_onset_groups"],
             payload["potential_paired_noteheads"]))
    print("  pdf proposals=%d  scores=%d" % (payload["pdf_proposals"],
                                             payload["n_scores"]))
    print("  QC: %s  (problems=%d  blinding leaks=%s)"
          % ("PASS" if qc["pass"] else "FAIL", len(qc["problems"]), leaks or "none"))
    print("  README : out/h_review/README.md")
    print("  HTML   : out/h_review/review.html")
    print("  QC     : out/h_review/h_qc.json")
    print("  proj   : out/h_review/h_projection.json")


if __name__ == "__main__":
    main()