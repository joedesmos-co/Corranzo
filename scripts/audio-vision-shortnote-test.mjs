#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compositionSpec, renderComposition, maskComposition } from './lib/synthCorpus.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { scoreEvents } from './lib/eventScore.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Build compositions with very short note durations (muted/staccato style)
const specs = [
  { id:'short-guitar', instrument:'guitar', texture:'melody', bars:2, bpm:120 },
  { id:'short-piano',  instrument:'piano',  texture:'melody', bars:2, bpm:120 },
]
// monkey: force short durations by post-processing notes
function shorten(spec, durSec) {
  return { ...spec, notes: spec.notes.map(n => ({...n, offsetSeconds: n.onsetSeconds + durSec})) }
}
const modes = {
  staccato01: (spec) => renderComposition(shorten(spec, 0.10), { realistic:true, performance:false }),
  staccato015:(spec) => renderComposition(shorten(spec, 0.15), { realistic:true, performance:false }),
  staccato02: (spec) => renderComposition(shorten(spec, 0.20), { realistic:true, performance:false }),
  staccato01_perf:(spec) => renderComposition(shorten(spec, 0.10), { realistic:true, performance:true, performanceOptions:{jitterMs:20,rollMs:32,velocitySpread:0.4,innerVoiceGain:0.4,staccato:0.6,legato:0,damping:0.5} }),
  muted: (spec) => renderComposition(maskComposition(shorten(spec,0.12), {bassGain:0.5,midGain:0.7,highGain:1.0,innerVoiceGain:0.35,sustainExtra:0}), { realistic:true, performance:true, performanceOptions:{jitterMs:20,rollMs:32,velocitySpread:0.4,innerVoiceGain:0.4,staccato:0.7,legato:0,damping:0.6} }),
}
for(const s of specs){
  const spec = compositionSpec(s)
  for(const [mode,render] of Object.entries(modes)){
    const rendered = render(spec)
    const bp = await predictBasicPitchNode(rendered.samples, {modelDir:join(root,'public/neural-model')})
    const pred = bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds,duration:(n.endSeconds??n.startSeconds)-n.startSeconds}))
    const truth = rendered.notes.map(n=>({midi:n.midi,onset:n.audibleOnsetSeconds??n.onsetSeconds,offset:n.offsetSeconds}))
    const sc = scoreEvents(pred, truth, {tolerance:0.12})
    console.log(`${s.instrument} ${mode}: notes ${truth.length} pred ${pred.length} R ${sc.pitchRecall} P ${sc.pitchPrecision} F1 ${sc.eventF1} onsetMAE ${sc.onsetMaeMs}`)
  }
}
await closeBasicPitchNode()
