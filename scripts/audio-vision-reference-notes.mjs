#!/usr/bin/env node
/**
 * Milestone 2: compact, independently auditable reference-note set.
 * For each truth note in a small set of clips, record source, pitch, onset,
 * energy-attack evidence, model prediction, extractor decision, classification.
 */
import { readFileSync, writeFileSync } from 'node:fs'
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

function energyNearest(samples, t, windowSec=0.3){
  const frame=256,hop=128
  let best=null,bestv=-1
  const s0=Math.floor((t-windowSec)*SR), s1=Math.floor((t+windowSec)*SR)
  for(let i=Math.max(0,s0);i+frame<s1 && i+frame<samples.length;i+=hop){
    let s=0;for(let j=0;j<frame;j++)s+=samples[i+j]*samples[i+j];const v=Math.sqrt(s/frame)
    if(v>bestv){bestv=v;best=i/SR}
  }
  return best===null?null:{t:best, offsetMs:Math.round((best-t)*1000), strength:Math.round(bestv*10000)/10000}
}

const clipIds=['acoustic-bossa-single','acoustic-rock-dyad','electric-eg07-single','piano-schubert-single','piano-mozart-dyad','piano-schubert-triad']
const all=[]
for(const id of clipIds){
  const c=manifest.clips.find(x=>x.id===id); if(!c) continue
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  const pred=bp.notes
  const delta=deltaById[id]??0
  const truth=(c.truth.notes||[]).map(n=>({midi:n.midi,onset:n.onset,offset:n.offset??n.onset+0.3}))
  // match
  const used=new Set()
  const matchIdx=new Map() // pred index -> truth index
  for(let pi=0;pi<pred.length;pi++){
    let best=-1,bestd=0.12
    truth.forEach((t,i)=>{if(used.has(i))return;const d=Math.abs((t.onset+delta)-pred[pi].startSeconds);if(t.midi===pred[pi].midi && d<bestd){bestd=d;best=i}})
    if(best>=0){used.add(best);matchIdx.set(pi,best)}
  }
  // invert: truth index -> pred
  const truthToPred=new Map()
  for(const [pi,ti] of matchIdx) truthToPred.set(ti,pi)
  for(let ti=0;ti<truth.length;ti++){
    const t=truth[ti]
    const alignedOnset=t.onset+delta
    const ev=energyNearest(samples,alignedOnset,0.3)
    const pi=truthToPred.get(ti)
    const p=pi!==undefined?pred[pi]:null
    const dur=t.offset-t.onset
    const stratum = t.onset<0?'negative-onset' : dur<0.1?'grace-short' : dur<0.2?'short' : (ev===null||Math.abs(ev.offsetMs)>100)?'misaligned' : 'clear'
    all.push({
      clip:id, instrument:c.instrument, split:c.split, rights:c.license,
      midi:t.midi, refOnset:Math.round(t.onset*1000)/1000, refOffset:Math.round(t.offset*1000)/1000, durationMs:Math.round(dur*1000),
      alignedOnset:Math.round(alignedOnset*1000)/1000, alignDelta:delta,
      energyAttackOffsetMs: ev?ev.offsetMs:null, energyAttackStrength: ev?ev.strength:null,
      stratum,
      modelPredicted: pi!==undefined, modelOnset: p?p.startSeconds:null, modelOffset: p?p.endSeconds:null, modelAmplitude: p?p.amplitude:null,
      onsetErrorMs: (p && alignedOnset>=0)?Math.round(Math.abs(p.startSeconds-alignedOnset)*1000):null,
      durationErrorMs: (p && alignedOnset>=0)?Math.round(Math.abs((p.endSeconds-p.startSeconds)-dur)*1000):null,
      classification: pi!==undefined ? (Math.abs((p.startSeconds-alignedOnset))<=0.12?'hit':'onset-mismatch') : 'miss',
    })
  }
}
await closeBasicPitchNode()
writeFileSync(join(root,'benchmarks/audio-vision/reference-notes.json'), JSON.stringify({generatedAt:new Date().toISOString(), description:'Compact auditable reference-note set: 6 clips, per-note waveform/model/extractor evidence.', notes:all},null,2))
// summary
const byStrat={}
for(const n of all){byStrat[n.stratum]=byStrat[n.stratum]||{n:0,hit:0};byStrat[n.stratum].n++;if(n.classification==='hit')byStrat[n.stratum].hit++}
console.log('notes:',all.length)
for(const [k,v] of Object.entries(byStrat)) console.log(`  ${k}: n=${v.n} hit=${v.hit} recall=${Math.round(v.hit/v.n*1000)/1000}`)
console.log('modelPredicted:', all.filter(n=>n.modelPredicted).length, '/', all.length)
console.log('written')
