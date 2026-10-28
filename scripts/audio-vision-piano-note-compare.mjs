#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const SR=22050
const m=JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const id=process.argv[2]||'piano-mozart-dyad'
const c=m.clips.find(x=>x.id===id)
const wav=readWavPcm(join(root,'benchmarks/mic-real',c.audio.file))
const samples=resampleLinear(Float32Array.from(wav.samples),wav.sampleRate,SR)
const bp=await predictBasicPitchNode(samples,{modelDir:join(root,'public/neural-model')})
const ref=(c.truth.notes||[]).filter(n=>n.onset>=0).sort((a,b)=>a.onset-b.onset)
const model=[...bp.notes].sort((a,b)=>a.startSeconds-b.startSeconds)
console.log('REFERENCE (midi onset dur):')
for(const r of ref) console.log(`  ${String(r.midi).padStart(3)} ${r.onset.toFixed(3)} ${((r.offset??r.onset+0.3)-r.onset).toFixed(3)}`)
console.log('MODEL (midi onset dur amp):')
for(const p of model) console.log(`  ${String(p.midi).padStart(3)} ${p.startSeconds.toFixed(3)} ${(p.endSeconds-p.startSeconds).toFixed(3)} ${p.amplitude?.toFixed?.(2)??'-'}`)
await closeBasicPitchNode()
