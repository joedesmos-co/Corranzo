#!/usr/bin/env node
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compositionSpec, renderComposition, maskComposition } from './lib/synthCorpus.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { scoreEvents } from './lib/eventScore.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseSpecs = [
  { id:'d-g', instrument:'guitar', texture:'dense', bars:2, bpm:110 },
  { id:'d-p', instrument:'piano',  texture:'dense', bars:2, bpm:110 },
  { id:'c-g', instrument:'guitar', texture:'chords', bars:2, bpm:110 },
]
function shorten(spec, durSec){ return { ...spec, notes: spec.notes.map(n => ({...n, offsetSeconds: Math.min(n.offsetSeconds, n.onsetSeconds + durSec)}) ) } }
function denseMask(spec){ return maskComposition(spec, {bassGain:0.3,midGain:0.7,highGain:1.1,innerVoiceGain:0.35,sustainExtra:0.25}) }
const combos = [
  ['dense-short', (s)=>renderComposition(shorten(s,0.15), {realistic:true,performance:false})],
  ['dense-short-masked', (s)=>renderComposition(denseMask(shorten(s,0.15)), {realistic:true,performance:false})],
  ['dense-short-perf-masked', (s)=>renderComposition(denseMask(shorten(s,0.15)), {realistic:true,performance:true,performanceOptions:{jitterMs:20,rollMs:32,velocitySpread:0.4,innerVoiceGain:0.35,staccato:0.7,legato:0,damping:0.6}})],
  ['dense-normal', (s)=>renderComposition(s, {realistic:true,performance:false})],
]
for(const bs of baseSpecs){
  const spec = compositionSpec(bs)
  for(const [name,render] of combos){
    const rendered = render(spec)
    const bp = await predictBasicPitchNode(rendered.samples, {modelDir:join(root,'public/neural-model')})
    const pred = bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds,duration:(n.endSeconds??n.startSeconds)-n.startSeconds}))
    const truth = rendered.notes.map(n=>({midi:n.midi,onset:n.audibleOnsetSeconds??n.onsetSeconds,offset:n.offsetSeconds}))
    const sc = scoreEvents(pred, truth, {tolerance:0.12})
    // short-note subset
    const shortT = truth.filter(n=> (n.offset-n.onset)<0.2)
    const shortSc = shortT.length? scoreEvents(pred, shortT, {tolerance:0.12}) : null
    console.log(`${bs.id} ${name}: notes ${truth.length} short ${shortT.length} R ${sc.pitchRecall} F1 ${sc.eventF1} shortR ${shortSc?shortSc.pitchRecall:'-'} oct ${(()=>{let c=0;for(const p of pred){const same=truth.filter(t=>Math.abs(t.onset-p.onset)<=0.12);if(same.length&&!same.some(t=>t.midi===p.midi)&&same.some(t=>Math.abs(t.midi-p.midi)%12===0))c+=1}return c})()}`)
  }
}
await closeBasicPitchNode()
