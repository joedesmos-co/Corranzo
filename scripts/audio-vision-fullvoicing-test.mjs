#!/usr/bin/env node
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compositionSpec, renderComposition, maskComposition } from './lib/synthCorpus.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { scoreEvents } from './lib/eventScore.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Full 6-string guitar voicing: open strings + fretted, dense
function fullVoicingSpec(id) {
  const rng = () => Math.random()
  const notes = []
  const strings = [40,45,50,55,59,64] // E2 A2 D3 G3 B3 E4
  for (let b = 0; b < 8; b += 1) {
    // strum all 6 strings with slight roll, some muted
    strings.forEach((s, i) => {
      if (Math.random() < 0.15) return // muted string
      const fret = Math.floor(Math.random()*5)
      const midi = s + fret
      const vel = i < 2 ? 0.5 + Math.random()*0.2 : 0.3 + Math.random()*0.4
      notes.push({ midi, onsetSeconds: Math.round((b + i*0.012)*60/120*1000)/1000, offsetSeconds: Math.round((b+0.9)*60/120*1000)/1000, velocity: Math.round(vel*100)/100, instrument:'guitar' })
    })
  }
  notes.sort((a,b)=>a.onsetSeconds-b.onsetSeconds||a.midi-b.midi)
  const last = notes.reduce((m,n)=>Math.max(m,n.offsetSeconds),0)
  return { id, instrument:'guitar', texture:'dense', bpm:120, seed:id, durationSeconds: Math.ceil((last+0.6)*10)/10, notes }
}
const spec = fullVoicingSpec('fullvoicing')
const variants = [
  ['clean', renderComposition(spec, {realistic:false,performance:false})],
  ['masked', renderComposition(maskComposition(spec, {bassGain:0.25,midGain:0.7,highGain:1.1,innerVoiceGain:0.35,sustainExtra:0.3}), {realistic:true,performance:true,performanceOptions:{jitterMs:20,rollMs:32,velocitySpread:0.4,innerVoiceGain:0.35,staccato:0.3,legato:0.2,damping:0.2}})],
]
for(const [name,rendered] of variants){
  const bp = await predictBasicPitchNode(rendered.samples, {modelDir:join(root,'public/neural-model')})
  const pred = bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds,duration:(n.endSeconds??n.startSeconds)-n.startSeconds}))
  const truth = rendered.notes.map(n=>({midi:n.midi,onset:n.audibleOnsetSeconds??n.onsetSeconds,offset:n.offsetSeconds}))
  const sc = scoreEvents(pred, truth, {tolerance:0.12})
  const oct = (()=>{let c=0;for(const p of pred){const same=truth.filter(t=>Math.abs(t.onset-p.onset)<=0.12);if(same.length&&!same.some(t=>t.midi===p.midi)&&same.some(t=>Math.abs(t.midi-p.midi)%12===0))c+=1}return c})()
  console.log(`fullvoicing ${name}: notes ${truth.length} pred ${pred.length} R ${sc.pitchRecall} P ${sc.pitchPrecision} F1 ${sc.eventF1} oct ${oct} false ${sc.falsePositives}`)
}
await closeBasicPitchNode()
