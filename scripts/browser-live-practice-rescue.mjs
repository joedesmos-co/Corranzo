import { chromium, webkit } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:5781'
const kind = process.env.BROWSER || 'chromium'
const out = `tmp/live-rescue/${kind}${base.includes('corranzo.com') ? '-before' : '-after'}`
await mkdir(out, { recursive: true })
const browser = await ({ chromium, webkit }[kind]).launch({headless:true})
const context = await browser.newContext({viewport:{width:1440,height:960},recordVideo:{dir:out,size:{width:1440,height:960}}})
const page = await context.newPage()
const errors=[];page.on('pageerror',e=>errors.push(e.message))
const checks=[]
const check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??''))}
const wait=ms=>page.waitForTimeout(ms)
const state=()=>page.evaluate(()=>({turn:document.querySelector('.workspace-your-turn')?.textContent,
 expected:(document.querySelector('[data-score-note-state="current"], [data-score-note-state="current-partial"], [data-score-note-state="wrong"]')?.dataset.scoreExpected||'').split(',').map(Number),
 dots:document.querySelectorAll('.cz-notehead').length,
 shapes:document.querySelectorAll('.score-follow-overlay__note-highlight, .score-follow-overlay__note-target').length,
 chips:[...document.querySelectorAll('.workspace-score-feedback__chip')].map(c=>({state:c.dataset.scoreFeedbackState,midi:Number(c.dataset.scoreFeedbackMidi),bg:getComputedStyle(c).backgroundColor})),
 x:document.querySelector('.score-follow-cursor')?.getBoundingClientRect().x,
 time:document.querySelector('.workspace-position')?.textContent}))
async function sample(selector,ms=400){return page.evaluate(async({selector,ms})=>{
const values=[];const start=performance.now();await new Promise(resolve=>{const f=()=>{const r=document.querySelector(selector)?.getBoundingClientRect();values.push({t:performance.now()-start,x:r?.x,y:r?.y});if(performance.now()-start<ms)requestAnimationFrame(f);else resolve()};requestAnimationFrame(f)});return values},{selector,ms})}
/** The largest single-frame cursor step. A teleport shows up as one huge jump. */
function maxFrameJump(frames){let max=0;for(let i=1;i<frames.length;i+=1){max=Math.max(max,Math.abs(frames[i].x-frames[i-1].x))}return max}
try {
 await page.goto(base+'/?e2e-midi=1');await page.getByRole('button',{name:'Open featured score: Menuet in F, K.2'}).click()
 await page.locator('.react-pdf__Page canvas').waitFor();await wait(9500)
 await page.screenshot({path:out+'/pdf-preview.png'})
 await page.getByRole('radio',{name:'Wait For You',exact:true}).click();await wait(500)
 const first=await state();console.log('INITIAL',JSON.stringify(first));if(!base.includes('corranzo.com'))console.log('RUNTIME',await page.evaluate(async()=>({key:window.__SCOREFLOW_SCOREFOLLOW_KEY__,cursor:(await import('/src/features/score-follow/scoreFollowCursorRuntime.js')).getScoreFollowCursorSnapshot()})));await page.screenshot({path:out+'/pdf-waiting.png'})
 // Sample every frame across the checkpoint change. The window must cover the
 // click, the glide and the hold, so it is started BEFORE the click and runs
 // long after the cursor has settled.
 await page.evaluate(()=>{window.__motion=[];const start=performance.now();const tick=()=>{const el=document.querySelector('.score-follow-cursor');const r=el?.getBoundingClientRect();window.__motion.push({t:performance.now()-start,x:r?.x,y:r?.y,visible:el?getComputedStyle(el).display!=='none':false});if(performance.now()-start<2200)requestAnimationFrame(tick)};requestAnimationFrame(tick)})
 await wait(150)
 await page.getByRole('button',{name:'Continue (Enter)',exact:true}).click();await wait(2100)
 const motion=await page.evaluate(()=>window.__motion);const after=await state()
 await page.screenshot({path:out+'/pdf-after-continue.png'})
 check('PDF never draws replacement dots',after.dots===0,{dots:after.dots})
 check('PDF score surface draws no fabricated note shapes',after.shapes===0,{shapes:after.shapes})
 const frames=motion.filter(f=>f.visible&&f.x!=null).map(f=>({...f,x:Math.round(f.x*100)/100}))
 const xs=[...new Set(frames.map(f=>f.x))]
 const jump=maxFrameJump(frames)
 // A teleport covers the WHOLE gap in one frame. A glide never covers more
 // than half of it, and never more than 14 px in absolute terms.
 const travel=Math.abs((xs.at(-1)??0)-(xs[0]??0))
 const jumpBound=Math.max(8,travel*0.5)
 check('WFY moves through intermediate frames then settles',xs.length>=5,{positions:xs.length,first:xs[0],last:xs.at(-1)})
 check('WFY cursor does not teleport between checkpoints',jump<=jumpBound,{maxJump:jump,jumpBound,travel})
 const held=await sample('.score-follow-cursor',350);check('WFY waits without drifting',Math.max(...held.map(f=>f.x))-Math.min(...held.map(f=>f.x))<0.1)
 await writeFile(out+'/cursor-frames.json',JSON.stringify({motion,held},null,2))
 if(kind==='chromium' && !base.includes('corranzo.com')) {
  await page.getByRole('button',{name:'Practice input',exact:true}).click();await page.getByRole('button',{name:'MIDI keyboard',exact:true}).click();await page.keyboard.press('Escape');await wait(500)
  const before=await state();await page.evaluate(()=>window.__SCOREFLOW_MIDI_INJECT__(20));await wait(150);const wrong=await state()
  check('Wrong MIDI does not advance WFY',JSON.stringify(before.expected)===JSON.stringify(wrong.expected))
  for(const n of before.expected)await page.evaluate(n=>window.__SCOREFLOW_MIDI_INJECT__(n),n)
  await wait(350);check('Correct MIDI advances WFY',(await state()).turn!==before.turn)
  // The practice controls report the recognition result exactly.
  const played=await state()
  const blueChips=played.chips.filter(c=>c.state==='completed')
  check('Practice controls show the played note as blue',blueChips.length>0&&blueChips.every(c=>c.bg==='rgb(29, 78, 216)'),played.chips)
  check('Practice controls never colour an unplayed note blue',played.chips.filter(c=>c.bg==='rgb(29, 78, 216)').every(c=>c.state==='completed'),played.chips)
  await page.screenshot({path:out+'/pdf-controls-feedback.png'})
 }
 await page.getByRole('radio',{name:'Preview',exact:true}).click();await page.getByRole('button',{name:'Play (Space)',exact:true}).click();await wait(150)
 await page.getByRole('radio',{name:'Wait For You',exact:true}).click();await wait(1600)
 const t1=(await state()).time;await wait(1100);check('Play to WFY freezes transport',t1===(await state()).time,{t1,t2:(await state()).time})
 // Real OSMD, chord ownership, painted path pixels, tie mapping, transformed DOM.
 if(!base.includes('corranzo.com')) {
 const glyphs=await page.evaluate(async()=>{
  const {OpenSheetMusicDisplay}=await import('/node_modules/.vite/deps/opensheetmusicdisplay.js').then(m=>m.default||m)
  const {collectOsmdNotes}=await import('/src/features/practice/osmdEngraving.js')
  const {paintGraphicalNote,clearGraphicalNote}=await import('/src/features/practice/useOsmdEngraving.js')
  const {ownedNoteheadGlyphs}=await import('/src/features/practice/ownedNoteheadGlyphs.js')
  const {engravedNoteheadBox,noteheadPositionInContainer}=await import('/src/features/practice/engravedScoreCursor.js')
  const el=document.createElement('div');el.id='glyph-proof';el.style.cssText='position:fixed;inset:0;z-index:9999;background:white;overflow:auto;padding:30px;width:1000px';document.body.append(el)
  const xml=`<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note><note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>12</duration><type>half</type><dot/></note></measure></part></score-partwise>`
  const osmd=new OpenSheetMusicDisplay(el,{backend:'svg',autoResize:false,drawTitle:false});await osmd.load(xml);osmd.render()
  const notes=collectOsmdNotes(osmd);window.__glyphProof={notes,paintGraphicalNote,clearGraphicalNote,el}
  const c=notes.find(n=>n.midi===60);const head=ownedNoteheadGlyphs(c)[0];const bbox=head.getBoundingClientRect()
  const mapped=noteheadPositionInContainer(engravedNoteheadBox(c),head.ownerSVGElement,el)
  return {notes:notes.map(n=>({midi:n.midi,q:n.quarterInMeasure,index:n.graphicalNote.vfnote?.[1],heads:ownedNoteheadGlyphs(n).length})),bbox:bbox.toJSON(),mapped,origin:el.getBoundingClientRect().toJSON()}
 })
 check('OSMD chord members each own exactly one glyph',glyphs.notes.every(n=>n.heads===1),glyphs.notes)
 check('OSMD fractional timestamp converted to quarters',glyphs.notes.find(n=>n.midi===62)?.q===1)
 check('Cursor aligns to printed glyph within one pixel',Math.abs(glyphs.bbox.x-glyphs.origin.x-glyphs.mapped.left)<1,glyphs)
 await page.screenshot({path:out+'/glyph-black.png'})
 await page.evaluate(()=>{const p=window.__glyphProof;p.paintGraphicalNote(p.notes.find(n=>n.midi===60),'#1d4ed8')})
 await page.screenshot({path:out+'/glyph-partial-blue.png'})
 const painted=await page.locator('#glyph-proof [data-cz-painted]').evaluateAll(es=>es.map(e=>({midi:e.dataset.czMidi,fill:getComputedStyle(e).fill,tag:e.tagName})))
 check('Only played chord member has a blue printed path',painted.length===1&&painted[0].midi==='60'&&painted[0].tag==='path',painted)
 await page.evaluate(()=>{const p=window.__glyphProof;p.notes.forEach(n=>p.clearGraphicalNote(n))})
 check('Preview restores original glyph styles',await page.locator('#glyph-proof [data-cz-painted]').count()===0)
 }
 check('No page exceptions',errors.length===0,errors)
} catch(e){check('run completed',false,e.stack);await page.screenshot({path:out+'/failure.png'}).catch(()=>{})}
await writeFile(out+'/report.json',JSON.stringify({base,kind,checks,errors},null,2))
await context.close();await browser.close();process.exitCode=checks.some(c=>!c.pass)?1:0
