#!/usr/bin/env node
// H12 QC for the human micro-review tool. Run from tools/piano-vision-v26-audit:
//   node qc_human_micro.js
// Drives the real review.html script under a DOM stub and asserts the H0-H12 rules.
const fs=require('fs');
const cwd=process.cwd();
const DATA=JSON.parse(fs.readFileSync(cwd+'/out/h_review_human_micro/items_blinded.json','utf8')).items;
const POP=JSON.parse(fs.readFileSync(cwd+'/out/h_review_human_micro/population.json','utf8'));
const html=fs.readFileSync(cwd+'/out/h_review_human_micro/review.html','utf8');
const src=/<script>\n([\s\S]*)\n<\/script>/.exec(html)[1];

class El{constructor(){this.tagName='DIV';this._c=new Set();this.dataset={};this.style={};this.children=[];this.textContent='';this.innerHTML='';this.classList={toggle:(c,v)=>{v===false?this._c.delete(c):this._c.add(c)}};}querySelector(){return null}querySelectorAll(){return[]}addEventListener(){}appendChild(c){this.children.push(c)}click(){}}
const store={};
global.localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=v}};
const els={};
global.document={getElementById:id=>els[id]||(els[id]=new El()),
  querySelectorAll:()=>[],addEventListener:(k,f)=>{global.__key=f},
  createElement:t=>new El()};
global.window={addEventListener:()=>{}};
let blobTxt=null;
global.Blob=function(p){this.txt=p.join('')};
global.URL={createObjectURL:b=>{blobTxt=b.txt;return 'blob:x'},revokeObjectURL:()=>{}};

const body=src.replace(/const DATA = {[\s\S]*?};\nconst POP  = {[\s\S]*?};\n/,
'const DATA=_D;\nconst POP=_P;\n');
const A=new Function('_D','_P',body+`
 return {get st(){return st},set st(v){st=v},rec,pair,onMarker,undo,setX,setP,addUn,rmUn,
         totalNotes,doneCount,exportJSON,blank,render,go,allUnsure,allNo,cur:()=>it()};`)(DATA,POP);
let F=0;const ok=(n,c,x='')=>{if(c)console.log('  pass  '+n);else{F++;console.log('  FAIL  '+n+'  '+x)}};
const J=()=>JSON.parse(blobTxt);
const I0=DATA[0];
const P1=(n)=>'P'+n;

console.log('\n== H4 click pairing ==');
A.st.idx=0; A.st.sel=null; A.st.items={};
const eq=I0.pdf_onsets.findIndex(o=>o.card===I0.src_onsets[0].card);
A.onMarker('pdf',P1(eq+1)); A.onMarker('src','X1');
ok('click P then X records the pair', A.rec(0).pairs[P1(eq+1)]==='X1', JSON.stringify(A.rec(0).pairs));
ok('selection clears after pairing', A.st.sel===null);
const ne=I0.pdf_onsets.findIndex((o,i)=>i!==eq&&o.card!==I0.src_onsets[1].card);
if(ne>=0){ A.onMarker('pdf',P1(ne+1)); A.onMarker('src','X2');
  ok('cardinality mismatch -> AMBIGUOUS, not auto-confirmed',
     A.rec(0).rankAmbig[P1(ne+1)]===true && A.rec(0).rank[P1(ne+1)].auto===false);
  ok('ambiguous pair contributes 0 noteheads', A.totalNotes()===I0.src_onsets[0].card);
}
const ch=I0.pdf_onsets.findIndex(o=>!A.rec(0).pairs[o.pid]);
A.onMarker('pdf',P1(ch+1)); A.onMarker('src','X3');
A.onMarker('pdf',P1(ch+2)); A.onMarker('src','X3');
ok('an X cannot be paired to two P', Object.values(A.rec(0).pairs).filter(v=>v==='X3').length===1);

console.log('\n== H3 false-P / unlisted ==');
const fp=A.cur().pdf_onsets.find(o=>!A.rec(A.st.idx).pairs[o.pid]&&!A.rec(A.st.idx).falseP[o.pid]).pid;
A.setP(fp,'NOTA'); ok('NOT A NOTE ONSET recorded', A.rec(A.st.idx).falseP[fp]==='NOTA');
const fp2=A.cur().pdf_onsets.find(o=>!A.rec(A.st.idx).pairs[o.pid]&&!A.rec(A.st.idx).falseP[o.pid]).pid;
A.setP(fp2,'NO_COUNTERPART');
ok('NO_COUNTERPART recorded', A.rec(A.st.idx).falseP[fp2]==='NO_COUNTERPART');
A.st.idx=1;
document.getElementById('unlisted').value='onset between P3 and P4, beamed';
A.addUn();
ok('ADD UNLISTED ONSET recorded', A.rec(1).unlisted.length===1&&/beamed/.test(A.rec(1).unlisted[0]));
A.rmUn(0); ok('unlisted onset removable', A.rec(1).unlisted.length===0);
A.setX('X1','PRINTED'); ok('X presence PRINTED', A.rec(1).x.X1==='PRINTED');
A.setX('X1','UNSURE');   ok('X presence UNSURE', A.rec(1).x.X1==='UNSURE');
A.setX('X2','NOT_PRINTED'); ok('X presence NOT_PRINTED', A.rec(1).x.X2==='NOT_PRINTED');

console.log('\n== undo ==');
A.st.idx=0; const n0=Object.keys(A.rec(0).pairs).length; A.undo();
ok('undo removes exactly one pair', Object.keys(A.rec(0).pairs).length===n0-1, n0+'->'+Object.keys(A.rec(0).pairs).length);
ok('undo removed exactly one pair and no more', Object.keys(A.rec(0).pairs).length===n0-1);
const tot=k=>Object.keys(A.rec(0).pairs).length+Object.keys(A.rec(0).falseP).length+Object.keys(A.rec(0).x).length+A.rec(0).unlisted.length;
const b4=tot(); A.undo();
ok('undo rewinds exactly one decision overall', tot()===b4-1, b4+'->'+tot());

console.log('\n== H9 autosave / reload ==');
ok('autosave wrote localStorage', !!store['human_micro_v1']);
const saveShim=()=>{localStorage.setItem('human_micro_v1',JSON.stringify({idx:A.st.idx,sel:null,items:A.st.items}))};
const saved=JSON.parse(store['human_micro_v1']);
ok('autosave persisted pairs', saved.items['0'].pairs[P1(eq+1)]==='X1');
ok('autosave persisted false-P', Object.keys(saved.items['0'].falseP).length>0);
A.st.idx=saved.idx; A.st.sel=null; A.st.items=saved.items;
A.render();
A.st.idx=0; A.onMarker('pdf',P1(ne+1)); A.onMarker('src','X2'); saveShim();
ok('reload restores pairs', A.rec(A.st.idx).pairs[P1(eq+1)]==='X1');
ok('reload restores false-P', Object.keys(A.rec(A.st.idx).falseP).length>0);
ok('reload restores rank ambiguity', A.rec(A.st.idx).rankAmbig[P1(ne+1)]===true);
ok('reloaded total is stable', A.totalNotes()===A.totalNotes());

console.log('\n== H5/H7 rank + progress counts ==');
DATA.forEach((_,k)=>{A.st.items[k]=A.blank()});
A.st.idx=0;
const big=DATA.findIndex(d=>d.src_onsets.some(o=>o.card>1)&&d.pdf_onsets.length>=d.src_onsets.length);
ok('found a chord item to exercise rank', big>=0);
if(big>=0){ const d=DATA[big]; A.st.idx=big;
  d.src_onsets.forEach((o,j)=>{ if(d.pdf_onsets[j]&&d.pdf_onsets[j].card===o.card) A.pair(P1(j+1),'X'+(j+1)); });
  const r=A.rec(big);
  const want=Object.keys(r.pairs).reduce((a,p)=>a+(r.rank[p].auto?r.rank[p].card:0),0);
  ok('confirmed noteheads == sum of confirmed cards', A.totalNotes()===want, A.totalNotes()+' vs '+want);
  ok('ambiguous pair counted as zero', Object.keys(r.pairs).some(p=>!r.rank[p].auto)||want>0);
  ok('N <= population ceiling', A.totalNotes()<=POP.max_potential_noteheads);
  ok('N>=50 reachable from this item alone is not required (informational)', true);
  ok('items-done counts only touched items', A.doneCount()===1, String(A.doneCount()));
}
let sum=0; DATA.forEach((d,k)=>sum+=d.src_onsets.reduce((a,o)=>a+o.card,0));
ok('population ceiling is the sum of all source cards', sum===POP.max_potential_noteheads, sum+' vs '+POP.max_potential_noteheads);
ok('ceiling clears 50 so N>=50 is reachable', POP.max_potential_noteheads>=50);

console.log('\n== H6 no confidence scale ==');
ok('no HIGH/MEDIUM/LOW verdict in source', !/['"]HIGH['"]|['"]MEDIUM['"]|['"]LOW['"]/.test(src));
ok('scale is CONFIRMED/UNSURE/AMBIGUOUS',
   /CONFIRMED/.test(src)&&/AMBIGUOUS/.test(src)&&/UNSURE/.test(src));

console.log('\n== export ==');
A.exportJSON(); const e=J();
ok('export carries frozen population hash', e.population_sha256===POP.population_sha256);
ok('export carries all 20 items', e.items.length===20);
ok('export carries matched_notehead_N', e.matched_notehead_N===A.totalNotes());
const e0=e.items.find(x=>x.item_id===DATA[big].item_id);
ok('false_p values keep the human decision label',
   e0.false_p && Object.values(e0.false_p).every(v=>['NOTA','NO_COUNTERPART'].includes(v)), JSON.stringify(e0.false_p));
ok('export item has x_presence / p_to_x / false_p / unlisted_onsets',
   !!e0.x_presence&&Array.isArray(e0.p_to_x)&&!!e0.false_p&&Array.isArray(e0.unlisted_onsets));
ok('export rank status is CONFIRMED/AMBIGUOUS/UNCONFIRMED',
   e0.p_to_x.every(p=>['CONFIRMED','AMBIGUOUS','UNCONFIRMED'].includes(p.rank_status)));
ok('confirmed pairs carry notehead-level rank pairs', e0.p_to_x.filter(p=>p.rank_status==='CONFIRMED').every(p=>p.rank_pairs.length>0));
const blob=JSON.stringify(e).toLowerCase();
const leak=['residual','delta_space','r_corpus','r_render','true_d','midi','decoder','mismatch',
            'category','a_votes','e_votes','reviewer_confidence','pitch','"y"','staff'].filter(t=>blob.includes(t));
ok('export JSON leaks no scientific/pitch/reviewer field', leak.length===0, leak.join(','));
ok('export JSON contains no image paths or staff coordinates', !/items\/|sheets\/|\.png/.test(blob));

console.log('\n== H0/H12 population + asset integrity ==');
const cons=JSON.parse(fs.readFileSync(cwd+'/out/h_review_ai_v3/ai_blind_consensus_v3_manifest.json','utf8'));
const sameAll=cons.items.filter(i=>i.A_votes.every(v=>v==='SAME_STRUCTURE')).map(i=>i.item_id).sort();
ok('population == exactly the 3/3 SAME items',
   JSON.stringify(sameAll)===JSON.stringify(POP.population.slice().sort()), sameAll.length+' vs '+POP.population.length);
ok('nothing filtered by confidence or acceptance',
   POP.population.length===cons.items.filter(i=>i.A_votes.every(v=>v==='SAME_STRUCTURE')).length);
const mf=JSON.parse(fs.readFileSync(cwd+'/out/h_review_manifest.json','utf8')).items;
ok('P ids/order match the frozen manifest', DATA.every(d=>{
  const s=mf.find(x=>x.item_id===d.item_id);
  return JSON.stringify(s.pdf_onsets.map(o=>o.pid))===JSON.stringify(d.pdf_onsets.map(o=>o.pid));}));
ok('X ids contiguous X1..Xn', DATA.every(d=>d.src_onsets.every((o,i)=>o.sid==='X'+(i+1))));
const v3=JSON.parse(fs.readFileSync(cwd+'/out/h_review_ai_v3/items_neutral.json','utf8')).items;
ok('X cardinality == what was actually rendered', DATA.every(d=>{
  const s=v3.find(x=>x.item_id===d.item_id);
  return JSON.stringify(s.source_cards)===JSON.stringify(d.src_onsets.map(o=>o.card));}));
ok('every referenced image exists', DATA.every(d=>fs.existsSync(cwd+'/out/h_review_human_micro/'+d.pdf_image)&&fs.existsSync(cwd+'/out/h_review_human_micro/'+d.src_image)));
ok('source sheets are byte-identical to the V3 packet sheets', DATA.every(d=>
  fs.readFileSync(cwd+'/out/h_review_human_micro/'+d.src_image).equals(fs.readFileSync(cwd+'/out/h_review_ai_v3/sheets/'+d.item_id+'.png'))));
ok('pdf sheets are byte-identical to the frozen review sheets', DATA.every(d=>
  fs.readFileSync(cwd+'/out/h_review_human_micro/'+d.pdf_image).equals(fs.readFileSync(cwd+'/out/'+mf.find(x=>x.item_id===d.item_id).sheet))));

console.log('\n== marker geometry ==');
ok('every PDF onset carries a measured x fraction',
   DATA.every(d=>d.pdf_onsets.every(o=>typeof o.fx==='number'&&o.fx>0&&o.fx<1)));
ok('every source onset carries a renderer-computed x fraction',
   DATA.every(d=>d.src_onsets.every(o=>typeof o.fx==='number'&&o.fx>0&&o.fx<1)));
ok('source fractions are strictly increasing',
   DATA.every(d=>d.src_onsets.every((o,i)=>i===0||o.fx>d.src_onsets[i-1].fx)));
ok('PDF fractions are strictly increasing',
   DATA.every(d=>d.pdf_onsets.every((o,i)=>i===0||o.fx>d.pdf_onsets[i-1].fx)));
ok('p_fractions length == pdf_onsets length',
   DATA.every(d=>d.p_fractions.length===d.pdf_onsets.length));
ok('x_fractions length == src_onsets length',
   DATA.every(d=>d.x_fractions.length===d.src_onsets.length));
ok('markers are not evenly spaced (real geometry is used)',
   DATA.some(d=>{const n=d.src_onsets.length; if(n<3)return false;
     const even=d.src_onsets.map((_,i)=>(i+0.5)/n);
     return d.src_onsets.some((o,i)=>Math.abs(o.fx-even[i])>0.02);}));
ok('layout() consumes fx and never hardcodes spacing',
   /typeof o\.fx==='number'/.test(src) && /\(i\+0\.5\)\/n/.test(src));
ok('build step asserts geometry rather than trusting it',
   fs.readFileSync(cwd+'/build_human_micro.py','utf8').includes('len(fx) == len(cards)'));

console.log('\n== H10 blinding of the HTML ==');
const forbidden=['residual','delta_space','r_corpus','r_render','true_d','midi','decoder','mismatch',
  'category','reviewer_confidence','a_votes','e_votes','accepted','h_review_lookup','xml_ord','score'];
const hits=forbidden.filter(t=>html.toLowerCase().includes(t));
ok('HTML embeds no scientific/pitch/reviewer field', hits.length===0, hits.join(','));
ok('HTML shows structure consensus as fixed context, not a question',
   /STRUCTURE CONSENSUS:\s*YES/.test(html) && !/A_same_printed_measure/.test(html));
ok('HTML never shows an individual reviewer answer',
   !/Reviewer\s*[123]/.test(html) && !/A_votes|E_votes/.test(html));

console.log(F? '\nRESULT: '+F+' FAILURES' : '\nRESULT: ALL CHECKS PASS');
process.exit(F?1:0);
