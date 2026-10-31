#!/usr/bin/env node
/**
 * Musical preservation: OLD vs NEW guitar arrangement on the same transcription.
 * Measures melody (highest note), bass (lowest note), note retention, onset
 * coverage and chroma similarity. New must not "pass" by dropping the music.
 */
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { quantizeToBeats } from '../src/features/audio-vision/arrangementModel.js'
import { STANDARD_GUITAR_TUNING } from '../src/features/instruments/instruments.js'
import { assignChordPositions } from '../src/features/instruments/fretboard.js'
import { arrangeSoloGuitar } from '../src/features/audio-vision/soloGuitar.js'
import { validateGuitarArrangement } from '../src/features/audio-vision/guitarPlayability.js'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const m=JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const strings={count:6,tuning:STANDARD_GUITAR_TUNING,fretCount:19,preferredMaxFret:12}
const ids=[...m.clips.filter(c=>c.instrument==='piano').slice(0,6),...m.clips.filter(c=>c.instrument!=='piano').slice(0,6)].map(c=>c.id)
const round=(x)=>Math.round(x*1000)/1000
function groupByOnset(notes){const by=new Map();for(const n of notes){const k=Math.round(n.quantizedStartBeat*4)/4;if(!by.has(k))by.set(k,[]);by.get(k).push(n)}return by}
function chroma(notes){const h=new Array(12).fill(0);for(const n of notes){h[((n.midi%12)+12)%12]+=Math.max(0.25,n.durBeats??1)}const t=h.reduce((a,b)=>a+b,0)||1;return h.map(v=>v/t)}
function cosine(a,b){let d=0,na=0,nb=0;for(let i=0;i<12;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i]}return d/Math.sqrt(na*nb||1)}
function preservation(inputArr,outputArr){
  const inBy=groupByOnset(inputArr)
  const outBy=groupByOnset(outputArr)
  let melody=0,bass=0,onsetCoverage=0,retained=0,totalIn=0
  for(const [onset,group] of inBy){
    totalIn+=group.length
    const sorted=[...group].sort((a,b)=>a.midi-b.midi)
    const top=sorted[sorted.length-1], bottom=sorted[0]
    const out=outBy.get(onset)??[]
    if(out.length)onsetCoverage++
    if(out.some(n=>n.midi===top.midi))melody++
    if(out.some(n=>n.midi===bottom.midi))bass++
    for(const n of group) if(out.some(o=>o.midi===n.midi)) retained++
  }
  const n=inBy.size||1
  return {melody:round(melody/n),bass:round(bass/n),onsetCoverage:round(onsetCoverage/n),noteRetention:round(retained/(totalIn||1)),chroma:round(cosine(chroma(inputArr),chroma(outputArr)))}
}
const rows=[]
for(const id of ids){
  const c=m.clips.find(x=>x.id===id); if(!c)continue
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=Float32Array.from(wav.samples)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  const period=0.6; const beats=[]; for(let t=0;t<=samples.length/wav.sampleRate;t+=period) beats.push(t)
  const quantized=quantizeToBeats(bp.notes.map(n=>({midi:n.midi,startSeconds:n.startSeconds,endSeconds:n.endSeconds,strength:n.amplitude??0.5})),beats)
  // OLD: per onset, top 4, assignChordPositions
  const oldBy=groupByOnset(quantized); const old=[]
  for(const [onset,group] of oldBy){const top=[...group].sort((a,b)=>b.midi-a.midi).slice(0,4);const a=assignChordPositions(strings,top.map(n=>n.midi),{handFret:null});for(const n of top){const p=a.get(n.midi);if(p)old.push({midi:n.midi,startBeat:onset,durBeats:n.quantizedDurBeats??0.5,string:p.string,fret:p.fret})}}
  // NEW
  const arranged=arrangeSoloGuitar({quantizedNotes:quantized,chords:[],difficulty:'intermediate'})
  const inputEvents=quantized.map(n=>({midi:n.midi,startBeat:n.quantizedStartBeat,durBeats:n.quantizedDurBeats??0.5}))
  const oldP=preservation(inputEvents,old), newP=preservation(inputEvents,arranged.events)
  const oldGate=validateGuitarArrangement(old,{maxSpan:4}), newGate=validateGuitarArrangement(arranged.events,{maxSpan:4})
  rows.push({id,old,new:arranged.events.length,oldP,newP,oldViolations:oldGate.violations.length,newViolations:newGate.violations.length})
  console.log(`${id.padEnd(28)} OLD mel ${oldP.melody} bass ${oldP.bass} keep ${oldP.noteRetention} chroma ${oldP.chroma} viol ${oldGate.violations.length} | NEW mel ${newP.melody} bass ${newP.bass} keep ${newP.noteRetention} chroma ${newP.chroma} viol ${newGate.violations.length} dropped ${arranged.droppedNotes.length}`)
}
await closeBasicPitchNode()
const mean=(k,side)=>round(rows.reduce((a,r)=>a+r[side][k],0)/Math.max(1,rows.length))
console.log('\nMEAN OLD',JSON.stringify({melody:mean('melody','oldP'),bass:mean('bass','oldP'),keep:mean('noteRetention','oldP'),chroma:mean('chroma','oldP')}))
console.log('MEAN NEW',JSON.stringify({melody:mean('melody','newP'),bass:mean('bass','newP'),keep:mean('noteRetention','newP'),chroma:mean('chroma','newP')}))
