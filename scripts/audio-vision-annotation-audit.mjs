#!/usr/bin/env node
/**
 * Annotation-quality audit of the mic-real corpus. For each truth note, measure
 * waveform properties and classify into a stratum. Reports per-stratum BP recall
 * (using the production model) and counts. Does NOT rewrite labels.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SR=22050
const manifest=JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const alignProbe=JSON.parse(readFileSync(join(root,'benchmarks/audio-vision/align-probe.json'),'utf8'))
const deltaById=Object.fromEntries((alignProbe.rows||[]).map(r=>[r.id,r.bestDelta??0]))

function rms(samples,start,end){let s=0,n=0;for(let i=Math.max(0,start);i<Math.min(samples.length,end);i++){s+=samples[i]*samples[i];n++}return n?Math.sqrt(s/n):0}
function energyOnset(samples,sr,truthOnset){
  // find energy rise in [onset-0.1, onset+0.2]
  const s0=Math.floor((truthOnset-0.1)*sr); const e0=Math.floor((truthOnset+0.2)*sr)
  const win=64; const vals=[]
  for(let i=s0;i+win<e0;i+=win){let s=0;for(let j=0;j<win;j++)s+=samples[i+j]*samples[i+j];vals.push({t:i/sr,rms:Math.sqrt(s/win)})}
  if(!vals.length) return null
  const peak=Math.max(...vals.map(v=>v.rms)); const thr=peak*0.25
  const hit=vals.find(v=>v.rms>=thr)
  return hit? (hit.t - truthOnset) : null
}

const strataCounts={}
const strataRecall={} // stratum -> {total, hit}
const allNotes=[]
for(const c of manifest.clips){
  const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  const pred=bp.notes
  const delta=deltaById[c.id]??0
  const truth=(c.truth.notes||[]).map(n=>({midi:n.midi,onset:n.onset,offset:n.offset??n.onset+0.3}))
  // matched truth indices (exact pitch, onset within 0.12, using aligned onset)
  const used=new Set()
  for(const p of pred){
    let best=-1,bestd=0.12
    truth.forEach((t,i)=>{if(used.has(i))return;const d=Math.abs((t.onset+delta)-p.startSeconds);if(t.midi===p.midi && d<bestd){bestd=d;best=i}})
    if(best>=0) used.add(best)
  }
  for(let i=0;i<truth.length;i++){
    const t=truth[i]
    const dur=t.offset-t.onset
    const alignedOnset=t.onset+delta
    const eShift= (alignedOnset>=0 && alignedOnset<3) ? energyOnset(samples,SR,alignedOnset) : null
    // classify
    let stratum='clear'
    if(t.onset<0) stratum='negative-onset'
    else if(dur<0.1) stratum='grace-short'
    else if(dur<0.2) stratum='short'
    else if(eShift===null || Math.abs(eShift)>0.1) stratum='misaligned'
    else {
      const localRms=rms(samples, Math.floor(alignedOnset*SR), Math.floor((alignedOnset+0.1)*SR))
      if(localRms < 0.01) stratum='weak'
    }
    strataCounts[stratum]=(strataCounts[stratum]||0)+1
    strataRecall[stratum]=strataRecall[stratum]||{total:0,hit:0}
    strataRecall[stratum].total++
    if(used.has(i)) strataRecall[stratum].hit++
    allNotes.push({clip:c.id,instrument:c.instrument,stratum,midi:t.midi,dur:Math.round(dur*1000),eShift:eShift===null?null:Math.round(eShift*1000),hit:used.has(i)})
  }
}
await closeBasicPitchNode()
console.log('STRATUM COUNTS:')
for(const k of Object.keys(strataCounts).sort()) console.log(`  ${k}: ${strataCounts[k]}`)
console.log('\nSTRATUM RECALL (aligned onset):')
for(const k of Object.keys(strataRecall).sort()){
  const v=strataRecall[k]; console.log(`  ${k}: n=${v.total} recall=${Math.round(v.hit/v.total*1000)/1000}`)
}
// by instrument x stratum
const byInst={}
for(const n of allNotes){
  byInst[n.instrument]=byInst[n.instrument]||{}
  byInst[n.instrument][n.stratum]=byInst[n.instrument][n.stratum]||{total:0,hit:0}
  byInst[n.instrument][n.stratum].total++
  if(n.hit) byInst[n.instrument][n.stratum].hit++
}
console.log('\nBY INSTRUMENT x STRATUM:')
for(const inst of Object.keys(byInst)){
  console.log(' ',inst)
  for(const st of Object.keys(byInst[inst])){
    const v=byInst[inst][st]; console.log(`    ${st}: n=${v.total} recall=${Math.round(v.hit/v.total*1000)/1000}`)
  }
}
writeFileSync(join(root,'benchmarks/audio-vision/annotation-audit.json'), JSON.stringify({
  generatedAt:new Date().toISOString(),
  note:'Per-truth-note waveform stratum classification. Strata: clear, short (<0.2s), grace-short (<0.1s), misaligned (energy onset >100ms from truth), weak (low RMS), negative-onset (started before clip). BP recall measured per stratum using aligned onsets.',
  strataCounts, strataRecall, byInstrument:byInst, notes:allNotes
},null,1))
console.log('written')
