#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SR=22050
function jamsNotes(base){const d=JSON.parse(readFileSync(`/tmp/guitarset/jams/${base}.jams`,'utf8'));const out=[];for(const a of d.annotations){if(a.namespace!=='note_midi'||!a.data)continue;for(const o of a.data){const m=Math.round(Number(o.value));const t=Number(o.time);if(m>=21&&m<=108)out.push({midi:m,onset:t,offset:t+Math.max(0.05,Number(o.duration||0.1))})}}return out.sort((a,b)=>a.onset-b.onset)}
for(const base of ['02_BN1-129-Eb_comp','02_BN1-147-Gb_comp']){
  const wav=readWavPcm(`/tmp/guitarset/${base}_mic.wav`)
  const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
  const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
  const pred=bp.notes
  const truth=jamsNotes(base)
  // matched truth indices (exact pitch, onset within 0.12)
  const used=new Set()
  for(const p of pred){
    let best=-1,bestd=0.12
    truth.forEach((t,i)=>{if(used.has(i))return;const d=Math.abs(t.onset-p.startSeconds);if(t.midi===p.midi && d<bestd){bestd=d;best=i}})
    if(best>=0) used.add(best)
  }
  // bucket by simultaneous sounding count
  const buckets={}
  for(let i=0;i<truth.length;i++){
    const t=truth[i]
    const sc=truth.filter((n,j)=>j!==i && n.onset<=t.onset && n.offset>t.onset).length
    const key = sc>=6?'6+' : (sc>=3?'3-5':(sc>=1?'1-2':'0'))
    buckets[key]=buckets[key]||{total:0,missed:0}
    buckets[key].total++
    if(!used.has(i)) buckets[key].missed++
  }
  console.log(base,'recall by simultaneous-sounding count:')
  for(const k of ['0','1-2','3-5','6+']) if(buckets[k]) console.log('  sounding',k,'total',buckets[k].total,'missed',buckets[k].missed,'recall',Math.round((1-buckets[k].missed/buckets[k].total)*1000)/1000)
  // bucket by duration
  const db={}
  for(let i=0;i<truth.length;i++){
    const t=truth[i]; const dur=t.offset-t.onset
    const key = dur<0.15?'short':dur<0.4?'mid':'long'
    db[key]=db[key]||{total:0,missed:0}; db[key].total++
    if(!used.has(i)) db[key].missed++
  }
  console.log('  by duration:')
  for(const k of ['short','mid','long']) if(db[k]) console.log('   ',k,'total',db[k].total,'missed',db[k].missed,'recall',Math.round((1-db[k].missed/db[k].total)*1000)/1000)
}
await closeBasicPitchNode()
