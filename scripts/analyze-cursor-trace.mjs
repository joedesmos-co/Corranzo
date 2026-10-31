#!/usr/bin/env node
import { readFileSync } from 'node:fs'
const path = process.argv[2]
const data = JSON.parse(readFileSync(path, 'utf8'))
const all = data.samples
// Estimate the Tone.now-derived clock offset against the app's displayed transport time.
const diffs = all.filter(s => s.playing && s.seek > 0.2).map(s => s.seek - s.scoreTime).sort((a,b)=>a-b)
const offset = diffs.length ? diffs[Math.floor(diffs.length/2)] : 0
const samples = all.filter(s => s.target?.visible && s.dom).map(s => ({...s, tCorr: s.scoreTime + offset}))
const jumps = [], back = [], mismatch = [], fallbacks = []
let prev = null
for (let i=0;i<samples.length;i++){
  const s=samples[i], t=s.target
  if (t.fallbackTier !== 'motion-timeline') fallbacks.push({i,tCorr:s.tCorr,tier:t.fallbackTier,source:t.interpolationSource,measure:t.measureNumber})
  if (Math.abs((s.dom.x??0)-t.x)>0.004 || Math.abs((s.dom.y??0)-t.y)>0.01) mismatch.push({i,tCorr:s.tCorr,targetX:t.x,domX:s.dom.x,targetY:t.y,domY:s.dom.y})
  if (prev){
    const p=prev.target, same=t.page===p.page && t.systemIndex===p.systemIndex
    const dxT=t.x-p.x, dxD=s.dom.x-prev.dom.x
    if (same && (dxT < -0.002 || dxD < -0.002)) back.push({i,tCorr:s.tCorr,dxT,dxD,measure:t.measureNumber,system:t.systemIndex,page:t.page})
    if (!same){
      // Ignore identity changes caused by a transport seek (score time jumps > 0.4s backward or > 1.5s forward vs wall).
      const wallDt=(s.wall-prev.wall)/1000
      const scoreDt=s.scoreTime-prev.scoreTime
      const seekLike=Math.abs(scoreDt)>Math.max(0.5, wallDt*3)
      jumps.push({i,seekLike,tCorr:s.tCorr,dxT,dxD,from:{page:p.page,system:p.systemIndex,measure:p.measureNumber,phrase:p.phraseIndex},to:{page:t.page,system:t.systemIndex,measure:t.measureNumber,phrase:t.phraseIndex},prevPhraseEnd:p.phraseEndTime,phraseStart:t.phraseStartTime,early:p.phraseEndTime!=null?p.phraseEndTime-s.tCorr:null})
    }
  }
  prev=s
}
const real=jumps.filter(j=>!j.seekLike)
console.log('file',path,'samples',samples.length,'offset',offset.toFixed(4))
console.log('fallback',fallbacks.length,fallbacks.slice(0,3))
console.log('target/dom mismatch',mismatch.length,mismatch.slice(0,3))
console.log('backward within identity',back.length,back.slice(0,5))
console.log('identity changes total',jumps.length,'seek-induced',jumps.length-real.length)
console.log('real identity changes:')
for(const j of real){
  console.log(`t=${j.tCorr.toFixed(4)} ${j.from.page}:${j.from.system} m${j.from.measure} -> ${j.to.page}:${j.to.system} m${j.to.measure} dx=${j.dxT.toFixed(3)} phraseStart=${j.phraseStart?.toFixed(4)} prevEnd=${j.prevPhraseEnd?.toFixed(4)} early=${j.early?.toFixed(4)}`)
}
