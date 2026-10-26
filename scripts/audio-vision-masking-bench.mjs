#!/usr/bin/env node
/**
 * Paired causal benchmark: does MASKING (level imbalance, inner-voice quieting,
 * sustained overlap) reproduce the real failure shape (missed short notes,
 * dense-polyphony recall, octave errors), where timbre and performance did not?
 *
 * Same compositions across all modes; one mechanism changed at a time.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compositionSpec, renderComposition, maskComposition, performComposition } from './lib/synthCorpus.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { scoreEvents } from './lib/eventScore.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const jsonOut = args.includes('--json') ? args[args.indexOf('--json')+1] : 'benchmarks/audio-vision/masking-bench.json'
const resolveOut = (v) => v.startsWith('/') ? v : join(root, v)
const TEXTURES = ['single','melody','chords','dense','bass','innerVoices']
const regOf = (m) => m<48?'bass':m<72?'mid':'high'
const MODES = {
  clean:            (spec) => renderComposition(spec, { realistic:false, performance:false }),
  timbre:           (spec) => renderComposition(spec, { realistic:true,  performance:false }),
  performance:      (spec) => renderComposition(spec, { realistic:true,  performance:true, performanceOptions:{jitterMs:20,rollMs:32,velocitySpread:0.4,innerVoiceGain:0.4,staccato:0.25,legato:0.2,damping:0.15} }),
  levels:           (spec) => renderComposition(maskComposition(spec, {bassGain:0.32,midGain:0.85,highGain:1.15,innerVoiceGain:0.4,sustainExtra:0}), { realistic:true, performance:false }),
  sustain:           (spec) => renderComposition(maskComposition(spec, {bassGain:1,midGain:1,highGain:1,innerVoiceGain:1,sustainExtra:0.35}), { realistic:true, performance:false }),
  maskFull:         (spec) => renderComposition(maskComposition(spec, {bassGain:0.32,midGain:0.85,highGain:1.15,innerVoiceGain:0.4,sustainExtra:0.35}), { realistic:true, performance:false }),
  perfLevels:       (spec) => renderComposition(maskComposition(spec, {bassGain:0.32,midGain:0.85,highGain:1.15,innerVoiceGain:0.4,sustainExtra:0}), { realistic:true, performance:true, performanceOptions:{jitterMs:20,rollMs:32,velocitySpread:0.4,innerVoiceGain:0.4,staccato:0.25,legato:0.2,damping:0.15} }),
  perfSustain:      (spec) => renderComposition(maskComposition(spec, {bassGain:1,midGain:1,highGain:1,innerVoiceGain:1,sustainExtra:0.35}), { realistic:true, performance:true, performanceOptions:{jitterMs:20,rollMs:32,velocitySpread:0.4,innerVoiceGain:0.4,staccato:0.25,legato:0.2,damping:0.15} }),
  perfMask:         (spec) => renderComposition(maskComposition(spec, {bassGain:0.32,midGain:0.85,highGain:1.15,innerVoiceGain:0.4,sustainExtra:0.35}), { realistic:true, performance:true, performanceOptions:{jitterMs:20,rollMs:32,velocitySpread:0.4,innerVoiceGain:0.4,staccato:0.25,legato:0.2,damping:0.15} }),
}
const rows=[]
for(const instrument of ['piano','guitar']){
  for(const texture of TEXTURES){
    const spec = compositionSpec({id:`mask-${instrument}-${texture}`, instrument, texture, bars:2, bpm:96})
    for(const [mode,render] of Object.entries(MODES)){
      const rendered = render(spec)
      const bp = await predictBasicPitchNode(rendered.samples, {modelDir:join(root,'public/neural-model')})
      const pred = bp.notes.map(n=>({midi:n.midi,onset:n.startSeconds,duration:(n.endSeconds??n.startSeconds)-n.startSeconds}))
      const truth = rendered.notes.map(n=>({midi:n.midi,onset:n.audibleOnsetSeconds??n.onsetSeconds,offset:n.offsetSeconds,velocity:n.velocity}))
      const score = scoreEvents(pred, truth, {tolerance:0.12})
      const octave = (()=>{let c=0;for(const p of pred){const same=truth.filter(t=>Math.abs(t.onset-p.onset)<=0.12);if(same.length && !same.some(t=>t.midi===p.midi) && same.some(t=>Math.abs(t.midi-p.midi)%12===0)) c+=1}return c})()
      const reg={}
      for(const r of ['bass','mid','high']){const t=truth.filter(n=>regOf(n.midi)===r);const p=pred.filter(n=>regOf(n.midi)===r);const s=scoreEvents(p,t);reg[r]={notes:t.length,recall:s.pitchRecall,precision:s.pitchPrecision,f1:s.eventF1}}
      const shortTruth = truth.filter(n=> (n.offset-n.onset) < 0.2)
      const shortScore = scoreEvents(pred, shortTruth, {tolerance:0.12})
      const denseTruth = truth.filter((n,i)=> truth.filter(m=>Math.abs(m.onset-n.onset)<=0.08).length>=4)
      const denseScore = scoreEvents(pred, denseTruth, {tolerance:0.12})
      const quietTruth = truth.filter(n=> n.velocity<0.35)
      const quietScore = scoreEvents(pred, quietTruth, {tolerance:0.12})
      const falseNotes = score.falsePositives
      rows.push({id:`${instrument}/${texture}`,instrument,texture,mode,notes:truth.length,predCount:pred.length,
        f1:score.eventF1,precision:score.pitchPrecision,recall:score.pitchRecall,
        bassRecall:reg.bass.recall,midRecall:reg.mid.recall,highRecall:reg.high.recall,
        bassNotes:reg.bass.notes,midNotes:reg.mid.notes,highNotes:reg.high.notes,
        shortNotes:shortTruth.length,shortRecall:shortTruth.length?shortScore.pitchRecall:null,
        denseNotes:denseTruth.length,denseRecall:denseTruth.length?denseScore.pitchRecall:null,denseF1:denseTruth.length?denseScore.eventF1:null,
        quietNotes:quietTruth.length,quietRecall:quietTruth.length?quietScore.pitchRecall:null,
        octaveErrors:octave,falseNotes,onsetMaeMs:score.onsetMaeMs,durationMaeMs:score.durationMaeMs})
      console.log(`${(instrument+'/'+texture).padEnd(18)} ${mode.padEnd(12)} notes ${String(truth.length).padStart(3)} F1 ${score.eventF1} R ${score.pitchRecall} bass ${reg.bass.recall} short ${shortTruth.length?shortScore.pitchRecall:'-'} dense ${denseTruth.length?denseScore.pitchRecall:'-'} oct ${octave} false ${falseNotes}`)
    }
    if(global.gc) global.gc()
  }
}
await closeBasicPitchNode()
const mean=(v)=>{const x=v.filter(n=>Number.isFinite(n));return x.length?Math.round(x.reduce((a,b)=>a+b,0)/x.length*1000)/1000:null}
const summarise=(list)=>({
  recordings:list.length, microF1:mean(list.map(r=>r.f1)), precision:mean(list.map(r=>r.precision)), recall:mean(list.map(r=>r.recall)),
  bassRecall:mean(list.filter(r=>r.bassNotes>0).map(r=>r.bassRecall)), midRecall:mean(list.filter(r=>r.midNotes>0).map(r=>r.midRecall)),
  highRecall:mean(list.filter(r=>r.highNotes>0).map(r=>r.highRecall)),
  shortRecall:mean(list.filter(r=>r.shortNotes>0).map(r=>r.shortRecall)),
  denseRecall:mean(list.filter(r=>r.denseNotes>0).map(r=>r.denseRecall)),
  denseF1:mean(list.filter(r=>r.denseNotes>0).map(r=>r.denseF1)),
  quietRecall:mean(list.filter(r=>r.quietNotes>0).map(r=>r.quietRecall)),
  octaveErrors:list.reduce((a,r)=>a+r.octaveErrors,0), falseNotes:list.reduce((a,r)=>a+r.falseNotes,0),
  onsetMaeMs:mean(list.map(r=>r.onsetMaeMs)), durationMaeMs:mean(list.map(r=>r.durationMaeMs)),
})
const byMode={}
for(const mode of Object.keys(MODES)) byMode[mode]=summarise(rows.filter(r=>r.mode===mode))
const report={generatedAt:new Date().toISOString(), note:'paired: same 12 compositions, one mechanism at a time', modes:Object.keys(MODES), summary:byMode, recordings:rows}
writeFileSync(resolveOut(jsonOut), JSON.stringify(report,null,1))
console.log('\nMODE SUMMARY')
for(const [mode,s] of Object.entries(byMode)) console.log(`${mode.padEnd(12)} F1 ${s.microF1} R ${s.recall} bass ${s.bassRecall} mid ${s.midRecall} short ${s.shortRecall} denseR ${s.denseRecall} denseF1 ${s.denseF1} quiet ${s.quietRecall} oct ${s.octaveErrors} false ${s.falseNotes}`)
console.log('REAL (comp takes, from per-note analysis): short-note recall ~0.0-0.12, dense-cluster recall ~0.38-0.71, octave errors ~8/350 notes')
console.log('written', resolveOut(jsonOut))
