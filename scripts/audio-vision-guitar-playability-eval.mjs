#!/usr/bin/env node
/**
 * Real-music playability before/after:
 *  OLD: per-onset assignChordPositions (the previous algorithm, soft span only)
 *  NEW: arrangeSoloGuitar with the hard playability model
 * Measures impossible shapes (span > difficulty max), same-string conflicts,
 * and the share of onsets that pass the validator.
 */
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { quantizeToBeats } from '../src/features/audio-vision/arrangementModel.js'
import { buildBeatGrid } from '../src/features/audio-vision/dsp.js'
import { paramsForDifficulty } from '../src/features/audio-vision/difficulty.js'
import { assignChordPositions } from '../src/features/instruments/fretboard.js'
import { STANDARD_GUITAR_TUNING } from '../src/features/instruments/instruments.js'
import { arrangeSoloGuitar } from '../src/features/audio-vision/soloGuitar.js'
import { validateGuitarArrangement } from '../src/features/audio-vision/guitarPlayability.js'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const SR=22050
const m=JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const strings={count:6,tuning:STANDARD_GUITAR_TUNING,fretCount:19,preferredMaxFret:12}
const ids=[...m.clips.filter(c=>c.instrument==='piano').slice(0,6), ...m.clips.filter(c=>c.instrument!=='piano').slice(0,4)].map(c=>c.id)
const maxSpan=paramsForDifficulty('intermediate').maxFretSpan
function spans(events){const by=new Map();for(const e of events){const k=String(e.startBeat);if(!by.has(k))by.set(k,[]);by.get(k).push(e)}const out=[];for(const [,g] of by){const frets=g.map(e=>e.fret).filter(f=>f>0);out.push(frets.length>1?Math.max(...frets)-Math.min(...frets):0)}return out}
for(const id of ids){
  const c=m.clips.find(x=>x.id===id); if(!c)continue
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=Float32Array.from(wav.samples)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  // quantize against a simple grid at 100 BPM (same for old/new)
  const period=0.6; const total=samples.length/wav.sampleRate
  const beats=[]; for(let t=0;t<=total;t+=period) beats.push(t)
  const quantized=quantizeToBeats(bp.notes.map(n=>({midi:n.midi,startSeconds:n.startSeconds,endSeconds:n.endSeconds,strength:n.amplitude??0.5})),beats)
  // OLD: group by quantized onset, max 4 voices, assignChordPositions
  const byOnset=new Map()
  for(const n of quantized){const k=Math.round(n.quantizedStartBeat*4)/4;if(!byOnset.has(k))byOnset.set(k,[]);byOnset.get(k).push(n)}
  const oldEvents=[]
  for(const [onset,group] of byOnset){
    const top=[...group].sort((a,b)=>b.midi-a.midi).slice(0,4)
    const assignment=assignChordPositions(strings,top.map(n=>n.midi),{handFret:null})
    for(const n of top){const p=assignment.get(n.midi);if(p)oldEvents.push({midi:n.midi,startBeat:onset,string:p.string,fret:p.fret})}
  }
  const oldSpans=spans(oldEvents)
  const oldBad=oldSpans.filter(s=>s>maxSpan).length
  const oldSame=oldEvents.length-new Set(oldEvents.map(e=>e.startBeat+':'+e.string)).size
  // NEW
  const arranged=arrangeSoloGuitar({quantizedNotes:quantized,chords:[],difficulty:'intermediate'})
  const newGate=validateGuitarArrangement(arranged.events,{maxSpan})
  const newSpans=spans(arranged.events)
  const newBad=newSpans.filter(s=>s>maxSpan).length
  console.log(`${id.padEnd(30)} OLD onsets ${oldSpans.length} wide ${oldBad} sameString ${oldSame} | NEW onsets ${newSpans.length} wide ${newBad} violations ${newGate.violations.length} dropped ${arranged.droppedNotes.length}`)
}
await closeBasicPitchNode()
