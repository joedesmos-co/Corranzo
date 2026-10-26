#!/usr/bin/env node
/**
 * Soft-recall analysis: does the model actually DETECT the notes, even when
 * onset alignment is off? Compare strict (0.12s) vs soft (0.3s) vs pitch-only.
 * Uses aligned onsets. Helps separate model detection from extractor/scoring.
 */
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { scoreEvents } from './lib/eventScore.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SR=22050
const manifest=JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const alignProbe=JSON.parse(readFileSync(join(root,'benchmarks/audio-vision/align-probe.json'),'utf8'))
const deltaById=Object.fromEntries((alignProbe.rows||[]).map(r=>[r.id,r.bestDelta??0]))
// sample: 10 clips across instruments
const sample=manifest.clips.filter(c=>['eval-fresh','dev'].includes(c.split)).slice(0,12)
let strict=0,soft=0,pitchOnly=0, total=0
for(const c of sample){
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  const pred=bp.notes
  const delta=deltaById[c.id]??0
  const truth=(c.truth.notes||[]).map(n=>({midi:n.midi,onset:n.onset+delta,offset:(n.offset??n.onset+0.3)+delta})).filter(n=>n.onset>=0)
  // strict
  const s1=scoreEvents(pred.map(n=>({midi:n.midi,onset:n.startSeconds})), truth, {tolerance:0.12})
  // soft
  const s2=scoreEvents(pred.map(n=>({midi:n.midi,onset:n.startSeconds})), truth, {tolerance:0.30})
  // pitch-only: match by pitch ignoring onset (nearest within 1s)
  let pitchHits=0
  for(const t of truth){ if(pred.some(p=>p.midi===t.midi && Math.abs(p.startSeconds-t.onset)<=1.0)) pitchHits++ }
  strict+=s1.matched; soft+=s2.matched; pitchOnly+=pitchHits; total+=truth.length
  console.log(`${c.id.padEnd(28)} truth ${truth.length} strict ${s1.matched} soft ${s2.matched} pitchOnly ${pitchHits}`)
}
await closeBasicPitchNode()
console.log(`\nTOTAL truth ${total}: strict ${strict} (${Math.round(strict/total*1000)/1000}) soft ${soft} (${Math.round(soft/total*1000)/1000}) pitchOnly ${pitchOnly} (${Math.round(pitchOnly/total*1000)/1000})`)
