// QC for review.html: drives the REAL page script with DOM stubs.
// Verifies autosave, export schema, reload restore, counter recomputation,
// next-unanswered, and that no forbidden field ever reaches the DOM.
const fs = require('fs');
const path = process.argv[2];
const html = fs.readFileSync(path, 'utf8');

const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('FAIL: no script block'); process.exit(1); }
const js = m[1];

const store = {};
const dom = {};
function mkEl(id) {
  return dom[id] || (dom[id] = {
    id, _html: '', _text: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    querySelectorAll: () => [],
    querySelector: () => ({ set oninput(v) {}, set value(v) {} }),
    click() { if (this.onclick) this.onclick(); },
    set onclick(v) { this._onclick = v; },
    get onclick() { return this._onclick; },
  });
}
global.document = {
  getElementById: (id) => mkEl(id),
  createElement: () => ({ set href(v) {}, set download(v) {}, click() {} }),
  addEventListener: () => {},
};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
let exported = null;
global.Blob = function (parts) { exported = parts[0]; };
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
global.window = global;

let fails = 0, passes = 0;
function check(name, cond, extra) {
  if (cond) { passes++; console.log('  PASS  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

// eval() keeps let/const in its own scope, so expose what the harness needs.
const EPILOGUE = `
;globalThis.__t={DATA:DATA,get ans(){return ans;},recompute:recompute,save:save,
  render:render,setIdx:function(v){idx=v;},getIdx:function(){return idx;},
  setAns:function(k,v){ans[k]=v;},getKey:function(){return KEY;}};`;
function load() { (0, eval)(js + EPILOGUE); return globalThis.__t; }

// ---- load page
let T = load();
const DATA = T.DATA;
check('page script evaluated', Array.isArray(DATA) && DATA.length === 80,
      'len=' + (DATA && DATA.length));
check('summary container exists after load', !!dom['sum']);
check('summary rendered at load', dom['sum'].innerHTML.length > 200);
check('milestone chips present',
      /review volume N/.test(dom['sum'].innerHTML) &&
      (dom['sum'].innerHTML.match(/review volume N/g) || []).length === 4);
check('gate text present with both >98% criteria',
      /&gt;98% \|delta_space\| &lt; 0\.25/.test(dom['sum'].innerHTML) &&
      /&gt;98% r_render = 0/.test(dom['sum'].innerHTML));
check('milestones never use the word PASS',
      !/\bPASS\b/.test(dom['sum'].innerHTML));

// ---- leakage scan across every DOM-visible string
const FORBIDDEN = ['residual', 'true_d', 'd0"', 'decoder', 'mismatch', 'midi', 'pitch name'];
function scanAllDom() {
  let blob = '';
  for (const k of Object.keys(dom)) blob += ' ' + dom[k]._html + ' ' + dom[k]._text;
  return blob.toLowerCase();
}
let leak = FORBIDDEN.filter((f) => scanAllDom().includes(f.toLowerCase()));
check('no forbidden field in DOM at load', leak.length === 0, leak.join(','));

// ---- helpers to act like the reviewer
function setAnswers(itemId, a) {
  const cur = T.ans[itemId] || {};
  T.ans[itemId] = Object.assign(cur, a);
  T.save();
}

// ---- exercise counters on the first item
const it0 = DATA[0];
const X0 = it0.source_onsets[0].sid;
const P0 = it0.pdf_onsets[0].pid;
setAnswers(it0.item_id, { A: 'YES', E: 'HIGH',
  B: { [it0.source_onsets[0].sid]: 'PRINTED_IN_PDF' },
  C: { [P0]: X0 } });
let s = dom['sum'].innerHTML;
check('item counted as completed', /items completed<\/span><b>1 \/ 80/.test(s));
check('A: SAME counted', /A: SAME<\/span><b>1/.test(s));
check('B: printed counted', /B: printed<\/span><b>1/.test(s));
check('C: matched counted', /C: matched<\/span><b>1/.test(s));
check('E: HIGH counted', /E: HIGH<\/span><b>1/.test(s));
check('HIGH-conf onset match counted', /HIGH-conf onset matches<\/span><b>1/.test(s));
// noteheads must still be 0 until second pass is completed
check('notehead N is 0 before second pass',
      /HIGH-CONFIDENCE MATCHED NOTEHEAD N<\/span><b>0<\/b>/.test(s));

// ---- complete the second pass
setAnswers(it0.item_id, { Z: { [P0]: 'RANK_OK' } });
s = dom['sum'].innerHTML;
const expectNH = Math.min(it0.pdf_onsets[0].card, it0.source_onsets.find(o => o.sid === X0).card);
check('notehead N counted ONLY from completed RANK_OK',
      new RegExp('HIGH-CONFIDENCE MATCHED NOTEHEAD N</span><b>' + expectNH + '</b>').test(s),
      'expected ' + expectNH);
check('rank-paired onsets counted', /rank-paired onsets<\/span><b>1/.test(s));

// ---- RANK_OK without a valid C match must NOT count
const it1 = DATA[1];
if (it1.pdf_onsets.length && it1.source_onsets.length) {
  setAnswers(it1.item_id, { A: 'YES', E: 'HIGH',
    C: { [it1.pdf_onsets[0].pid]: 'NO_COUNTERPART' },
    Z: { [it1.pdf_onsets[0].pid]: 'RANK_OK' } });
  s = dom['sum'].innerHTML;
  check('RANK_OK with NO_COUNTERPART adds no noteheads',
        new RegExp('HIGH-CONFIDENCE MATCHED NOTEHEAD N</span><b>' + expectNH + '</b>').test(s));
}

// ---- AMBIGUOUS verdict must not count
setAnswers(it0.item_id, { Z: { [P0]: 'AMBIGUOUS' } });
s = dom['sum'].innerHTML;
check('AMBIGUOUS verdict adds no noteheads',
      /HIGH-CONFIDENCE MATCHED NOTEHEAD N<\/span><b>0<\/b>/.test(s));
setAnswers(it0.item_id, { Z: { [P0]: 'RANK_OK' } });

// ---- MEDIUM item must not count toward the headline
setAnswers(it1.item_id, { A: 'YES', E: 'MEDIUM',
  C: { [it1.pdf_onsets[0].pid]: it1.source_onsets[0].sid } });
s = dom['sum'].innerHTML;
check('MEDIUM item excluded from headline',
      new RegExp('HIGH-CONFIDENCE MATCHED NOTEHEAD N</span><b>' + expectNH + '</b>').test(s));

// ---- autosave + reload restore
const saved = store[T.getKey()];
check('answers written to localStorage', !!saved && saved.indexOf(it0.item_id) >= 0);
check('localStorage key unchanged (autosave compatible)', T.getKey() === 'piano_review_v1', T.getKey());
T = load(); // simulate reload with the same store
s = dom['sum'].innerHTML;
check('reload restores counters from saved answers',
      new RegExp('HIGH-CONFIDENCE MATCHED NOTEHEAD N</span><b>' + expectNH + '</b>').test(s),
      'headline after reload');
check('reload restores completed count', /items completed<\/span><b>2 \/ 80/.test(s));

// ---- export schema UNCHANGED
document.getElementById('exp').click();
check('export produced JSON', exported !== null);
const ex = JSON.parse(exported);
check('export top-level keys unchanged',
      JSON.stringify(Object.keys(ex).sort()) === JSON.stringify(['items', 'reviewer']),
      Object.keys(ex).join(','));
check('export carries no extra answer keys',
      Object.keys(ex.items[it0.item_id]).every((k) =>
        ['A', 'B', 'C', 'D', 'E', 'notes', 'Z'].indexOf(k) >= 0),
      Object.keys(ex.items[it0.item_id]).join(','));

// ---- no forbidden field after all of the above
leak = FORBIDDEN.filter((f) => scanAllDom().includes(f.toLowerCase()));
check('no forbidden field in DOM after interaction', leak.length === 0, leak.join(','));

// ---- no scientific thresholds changed in the page
check('gate wording still >98% both criteria',
      />98%/.test(dom['sum'].innerHTML) || /&gt;98%/.test(dom['sum'].innerHTML));
check('milestones are 50/100/150/250',
      ['50', '100', '150', '250'].every((t) => s.indexOf('N \\u2265 ' + t) >= 0 ||
                                          s.indexOf('N ≥ ' + t) >= 0 ||
                                          dom['sum'].innerHTML.indexOf(t) >= 0));

console.log('\nQC SUMMARY: ' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);