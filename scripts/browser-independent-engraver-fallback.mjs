/**
 * Independent engraver image-fallback harness.
 *
 * Uploads a non-SMuFL/Verovio PDF through the standard PDF import path, opens
 * the score, and compares the resulting MusicXML to a reference. This measures
 * the actual image OMR fallback; successful fallback routing alone is not
 * counted as successful transcription.
 *
 * Usage:
 *   E2E_BASE_URL=http://localhost:4173/ node scripts/browser-independent-engraver-fallback.mjs  *     benchmarks/omr-independent-verovio/piano-grand-voices-verovio/piano-grand-voices-verovio.pdf  *     benchmarks/omr-independent-verovio/piano-grand-voices-verovio/piano-grand-voices-verovio.musicxml
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { writeFileSync } from 'node:fs'

function gcd(a,b){let x=Math.abs(a),y=Math.abs(b);while(y){const r=x%y;x=y;y=r}return x||1}
function fraction(n,d){const g=gcd(n,d);const a=n/g,b=d/g;return b===1?String(a):`${a}/${b}`}
function counters(source){
  const byMeasure=new Map(); const mre=/<measure\b([^>]*)>([\s\S]*?)<\/measure>/g; let mm, mi=0, divisions=1;
  while((mm=mre.exec(source))!==null){mi++; const attrs=mm[1]??''; const body=mm[2]??''; const number=/number="([^"]+)"/.exec(attrs)?.[1]??String(mi);
    if(!byMeasure.has(number))byMeasure.set(number,{notes:new Map(),rests:new Map()});
    const fd=/<divisions>(\d+)<\/divisions>/.exec(body)?.[1]; if(fd)divisions=Number(fd);
    const nre=/<note\b[^>]*>([\s\S]*?)<\/note>/g; let nm;
    while((nm=nre.exec(body))!==null){const note=nm[1]??''; if(/<grace\b/.test(note))continue; const duration=Number(/<duration>(\d+)<\/duration>/.exec(note)?.[1]??0); if(!(duration>0))continue; const dots=(note.match(/<dot\s*\/?\s*>/g)??[]).length; const q=fraction(duration,Math.max(1,divisions)); const bucket=/<rest\b/.test(note)?byMeasure.get(number).rests:byMeasure.get(number).notes; let key;
      if(/<rest\b/.test(note))key=`${q}:${dots}`; else {const pitch=/<pitch>([\s\S]*?)<\/pitch>/.exec(note)?.[1]??'';const step=/<step>([A-G])<\/step>/.exec(pitch)?.[1]??'C';const alter=Number(/<alter>(-?\d+)<\/alter>/.exec(pitch)?.[1]??0);const octave=Number(/<octave>(-?\d+)<\/octave>/.exec(pitch)?.[1]??4);const semi={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step]??0;const midi=(octave+1)*12+semi+alter;key=`${midi}:${q}:${dots}`}
      bucket.set(key,(bucket.get(key)??0)+1)
    }
  }
  return byMeasure
}
function score(truth,pred){
  const t=counters(truth),p=counters(pred); const totals={notes:{tp:0,fp:0,fn:0},rests:{tp:0,fp:0,fn:0},full:{tp:0,fp:0,fn:0}};
  for(const m of new Set([...t.keys(),...p.keys()]))for(const kind of ['notes','rests']){const a=t.get(m)?.[kind]??new Map(),b=p.get(m)?.[kind]??new Map();for(const k of new Set([...a.keys(),...b.keys()])){const av=a.get(k)??0,bv=b.get(k)??0;const hit=Math.min(av,bv);totals[kind].tp+=hit;totals[kind].fp+=Math.max(0,bv-av);totals[kind].fn+=Math.max(0,av-bv)}}
  totals.full={tp:totals.notes.tp+totals.rests.tp,fp:totals.notes.fp+totals.rests.fp,fn:totals.notes.fn+totals.rests.fn};
  const ratio=(e)=>({...e,truth:e.tp+e.fn,predicted:e.tp+e.fp,precision:e.tp+e.fp?+(e.tp/(e.tp+e.fp)).toFixed(3):0,recall:e.tp+e.fn?+(e.tp/(e.tp+e.fn)).toFixed(3):0});
  return {notes:ratio(totals.notes),rests:ratio(totals.rests),full:ratio(totals.full)}
}

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:4173/'
const fixture = process.argv[2]
const referencePath = process.argv[3]
const ref = parseMusicXml(readFileSync(referencePath, 'utf8'), 'ref.musicxml')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(2000)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find((el) => el.textContent?.replace(/^\s*\d+/, '').replace(/\s+/g, ' ').trim() === 'Import')
    button?.click()
  })
  await sleep(900)
  await page.locator('input[type="file"][aria-label="Choose score PDF"]').first().setInputFiles(fixture)
  await page.getByText(/pages? · PDF|PDF selected/i).first().waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: /open score/i }).click()
  await sleep(2000)
  let state = null
  const deadline = Date.now() + 150000
  while (Date.now() < deadline) {
    state = await page.evaluate(() => ({
      workspace: Boolean(document.querySelector('.workspace-frame')),
      canvas: Boolean(document.querySelector('.workspace-frame canvas')),
      error: (document.querySelector('.score-import-message')?.textContent ?? document.querySelector('.score-import')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 500),
      body: (document.body?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 500),
    }))
    if (state.workspace || /could not|unreadable|error|no staves|rejected|failed/i.test(state.error)) break
    await sleep(1500)
  }
  const xml = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('scoreflow-session', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('files')) request.result.createObjectStore('files')
      }
    })
    if (!db.objectStoreNames.contains('files')) return null
    return await new Promise((resolve) => {
      try {
        const tx = db.transaction('files', 'readonly')
        const req = tx.objectStore('files').get('musicXml')
        req.onerror = () => resolve(null)
        req.onsuccess = () => {
          const value = req.result
          if (!value) return resolve(null)
          const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value)
          resolve(new TextDecoder().decode(bytes))
        }
      } catch { resolve(null) }
    })
  })
  let parsed = null
  if (xml) { parsed = parseMusicXml(xml, 'omr.musicxml'); writeFileSync(`tmp/verovio-omr-${fixture.split('/').slice(-2)[0]}.musicxml`, xml) }
  const refNotes = ref.notes.filter((n) => !n.isRest)
  const predNotes = parsed?.notes?.filter((n) => !n.isRest) ?? []
  const pitchSet = new Set(predNotes.map((n) => n.midi))
  const refPitchSet = new Set(refNotes.map((n) => n.midi))
  let pitchHits = 0
  for (const p of pitchSet) if (refPitchSet.has(p)) pitchHits += 1
  const scored = xml ? score(readFileSync(referencePath, 'utf8'), xml) : null
  console.log(JSON.stringify({
    fixture, state,
    hasXml: Boolean(xml), xmlLength: xml?.length ?? 0,
    refNotes: refNotes.length, predNotes: predNotes.length,
    refMeasures: new Set(refNotes.map((n) => n.measureNumber)).size,
    predMeasures: new Set(predNotes.map((n) => n.measureNumber)).size,
    pitchSetHits: pitchHits, predPitchSet: pitchSet.size,
    scored, consoleErrors,
  }, null, 2))
} catch (error) {
  console.log(JSON.stringify({ fixture, error: String(error?.message ?? error), consoleErrors }, null, 2))
} finally {
  await browser.close()
}
