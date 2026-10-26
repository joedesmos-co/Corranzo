#!/usr/bin/env node
/**
 * Measure masking/mixture properties of REAL recordings (rights-cleared):
 * GuitarSet (CC BY 4.0) and Vienna piano clips. For each onset cluster we
 * report density, onset spread, bass/upper level ratio, sustained overlap,
 * and the spectral energy split. This is the evidence base for the level
 * choices in maskComposition().
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { existsSync } from 'node:fs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const jsonOut = args.includes('--json') ? args[args.indexOf('--json')+1] : 'benchmarks/audio-vision/real-masking.json'
const resolveOut = (v) => v.startsWith('/') ? v : join(root, v)
const SR = 22050

function fftMag(samples, start) {
  const N = 2048; const re = new Float64Array(N), im = new Float64Array(N)
  for (let i = 0; i < N; i++) { const s = samples[start+i] ?? 0; re[i] = s*(0.5-0.5*Math.cos(2*Math.PI*i/(N-1))) }
  // Cooley-Tukey
  for (let i=1,j=0;i<N;i++){let b=N>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]]}}
  for(let len=2;len<=N;len<<=1){const a=-2*Math.PI/len;for(let i=0;i<N;i+=len)for(let k=0;k<len/2;k++){const wr=Math.cos(a*k),wi=Math.sin(a*k);const ur=re[i+k],ui=im[i+k];const vr=re[i+k+len/2]*wr-im[i+k+len/2]*wi;const vi=re[i+k+len/2]*wi+im[i+k+len/2]*wr;re[i+k]=ur+vr;im[i+k]=ui+vi;re[i+k+len/2]=ur-vr;im[i+k+len/2]=ui-vi}}
  const mag=new Float64Array(N/2); for(let i=0;i<N/2;i++) mag[i]=Math.hypot(re[i],im[i]); return mag
}
function bandEnergy(mag, loHz, hiHz) { const binHz=SR/2048; let s=0; for(let i=1;i<mag.length;i++){const f=i*binHz; if(f>=loHz&&f<hiHz) s+=mag[i]*mag[i]} return s }

function jamsNotes(base) {
  const p = `/tmp/guitarset/jams/${base}.jams`
  if (!existsSync(p)) return []
  const d = JSON.parse(readFileSync(p,'utf8')); const out=[]
  for (const a of d.annotations) {
    if (a.namespace !== 'note_midi' || !a.data) continue
    for (const o of a.data) { const m=Math.round(Number(o.value)); const t=Number(o.time); if (m>=21&&m<=108) out.push({ midi:m, onset:t, offset:t+Math.max(0.05,Number(o.duration||0.1)) }) }
  }
  return out.sort((a,b)=>a.onset-b.onset)
}

function clusters(notes, gapSec=0.08) {
  const out=[]; let cur=[]
  for (const n of notes.sort((a,b)=>a.onset-b.onset)) {
    if (cur.length && n.onset - cur[cur.length-1].onset > gapSec) { out.push(cur); cur=[] }
    cur.push(n)
  }
  if (cur.length) out.push(cur)
  return out
}

const fs = await import('node:fs')
const takes = fs.readdirSync('/tmp/guitarset').filter(f=>/^02_.*_mic\.wav$/.test(f)).slice(0,6)
const sources = []
for (const f of takes) {
  const base = f.replace('_mic.wav','')
  const wav = readWavPcm(`/tmp/guitarset/${f}`)
  const samples = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, SR)
  sources.push({ id: base, kind:'real-guitar', samples, notes: jamsNotes(base) })
}
// piano
const manifest = JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const probe = JSON.parse(readFileSync(join(root,'benchmarks/audio-vision/align-probe.json'),'utf8'))
const deltaById = Object.fromEntries((probe.rows||[]).map(r=>[r.id,r.bestDelta??0]))
for (const c of manifest.clips.filter(x=>x.instrument==='piano' && (x.truth?.notes?.length||0)>0).slice(0,4)) {
  const delta = deltaById[c.id] ?? 0
  const wav = readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, SR)
  sources.push({ id: c.id, kind:'real-piano', samples, notes: c.truth.notes.map(n=>({midi:n.midi,onset:n.onset+delta,offset:(n.offset??n.onset+0.3)+delta})) })
}

const perSource = []
for (const src of sources) {
  const cls = clusters(src.notes)
  const clusterRows = []
  for (let ci=0; ci<cls.length; ci++) {
    const c = cls[ci]
    const onset = c[0].onset
    const s0 = Math.floor(onset*SR)
    const mag = fftMag(src.samples, Math.max(0,s0))
    const bassE = bandEnergy(mag, 40, 260)
    const midE = bandEnergy(mag, 260, 2000)
    const highE = bandEnergy(mag, 2000, 8000)
    const total = bassE+midE+highE || 1
    // sustained overlap: notes from previous clusters still sounding
    const prevSounding = src.notes.filter(n => n.onset < onset && n.offset > onset).length
    clusterRows.push({
      notes: c.length,
      lowestMidi: Math.min(...c.map(n=>n.midi)),
      highestMidi: Math.max(...c.map(n=>n.midi)),
      hasBass: c.some(n=>n.midi<48),
      onsetSpreadMs: Math.round((Math.max(...c.map(n=>n.onset))-Math.min(...c.map(n=>n.onset)))*1000),
      bassToTotal: Math.round(bassE/total*1000)/1000,
      highToTotal: Math.round(highE/total*1000)/1000,
      prevSounding,
      minVelocityProxy: null,
    })
  }
  const nClusters = clusterRows.length
  const withBass = clusterRows.filter(r=>r.hasBass).length
  const density = clusterRows.map(r=>r.notes)
  const overlap = clusterRows.map(r=>r.prevSounding)
  perSource.push({
    id: src.id, kind: src.kind,
    clusters: nClusters,
    avgNotesPerCluster: Math.round(density.reduce((a,b)=>a+b,0)/Math.max(1,nClusters)*100)/100,
    bassClusters: withBass,
    bassClusterShare: Math.round(withBass/Math.max(1,nClusters)*1000)/1000,
    avgOnsetSpreadMs: Math.round(clusterRows.reduce((a,r)=>a+r.onsetSpreadMs,0)/Math.max(1,nClusters)),
    avgBassToTotal: Math.round(clusterRows.reduce((a,r)=>a+r.bassToTotal,0)/Math.max(1,nClusters)*1000)/1000,
    avgHighToTotal: Math.round(clusterRows.reduce((a,r)=>a+r.highToTotal,0)/Math.max(1,nClusters)*1000)/1000,
    avgPrevSounding: Math.round(overlap.reduce((a,b)=>a+b,0)/Math.max(1,nClusters)*100)/100,
    clustersWithOverlap: clusterRows.filter(r=>r.prevSounding>0).length,
    overlapShare: Math.round(clusterRows.filter(r=>r.prevSounding>0).length/Math.max(1,nClusters)*1000)/1000,
  })
  console.log(`${src.id.padEnd(30)} clusters ${nClusters} avgNotes ${perSource[perSource.length-1].avgNotesPerCluster} bassShare ${perSource[perSource.length-1].bassClusterShare} bassEnergy ${perSource[perSource.length-1].avgBassToTotal} overlap ${perSource[perSource.length-1].overlapShare}`)
}

const agg = (kind) => {
  const list = perSource.filter(r=>r.kind===kind)
  const m = (k) => Math.round(list.reduce((a,r)=>a+r[k],0)/Math.max(1,list.length)*1000)/1000
  return { recordings: list.length, avgNotesPerCluster: m('avgNotesPerCluster'), bassClusterShare: m('bassClusterShare'), avgBassToTotal: m('avgBassToTotal'), avgHighToTotal: m('avgHighToTotal'), avgOnsetSpreadMs: Math.round(list.reduce((a,r)=>a+r.avgOnsetSpreadMs,0)/Math.max(1,list.length)), overlapShare: m('overlapShare'), avgPrevSounding: m('avgPrevSounding') }
}
const report = { generatedAt: new Date().toISOString(), sources: perSource, summary: { 'real-guitar': agg('real-guitar'), 'real-piano': agg('real-piano') } }
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 1))
console.log('\nSUMMARY', JSON.stringify(report.summary, null, 1))
console.log('written', resolveOut(jsonOut))
