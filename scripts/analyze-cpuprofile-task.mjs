#!/usr/bin/env node
import { readFileSync } from 'node:fs'
const profile = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
function nodeName(id) {
  const cf = nodes.get(id)?.callFrame ?? {}
  return { fn: cf.functionName || '(anonymous)', url: cf.url || '', line: (cf.lineNumber ?? 0) + 1 }
}
function stackOf(id) {
  const out = []
  let cur = nodes.get(id)
  while (cur) {
    out.push(nodeName(cur.id).fn)
    cur = nodes.get(cur.parent)
  }
  return out
}
let t = 0
const samples = []
for (let i = 0; i < profile.samples.length; i += 1) {
  const dt = profile.timeDeltas?.[i] ?? 0
  t += dt
  samples.push({ i, t, id: profile.samples[i], name: nodeName(profile.samples[i]).fn, dt })
}
// longest contiguous active run
let best = { start: 0, end: 0, ms: 0 }
let runStart = null
for (let i = 0; i < samples.length; i += 1) {
  const s = samples[i]
  const idle = s.name === '(idle)'
  if (!idle && runStart == null) runStart = i
  if ((idle || i === samples.length - 1) && runStart != null) {
    const end = idle ? i - 1 : i
    const ms = samples[end].t - samples[runStart].t
    if (ms > best.ms) best = { start: runStart, end, ms }
    runStart = null
  }
}
console.log('longest active run', (best.ms / 1000).toFixed(1), 'ms, samples', best.start, '..', best.end)
const self = new Map()
for (let i = best.start; i <= best.end; i += 1) {
  self.set(samples[i].id, (self.get(samples[i].id) ?? 0) + samples[i].dt)
}
const rows = [...self.entries()].map(([id, us]) => ({ ...nodeName(id), us, ms: us / 1000 })).sort((a, b) => b.us - a.us)
for (const r of rows.slice(0, 25)) console.log(`${r.ms.toFixed(1).padStart(8)}ms ${r.fn} ${r.url}:${r.line}`)
// representative mid-run stack
const mid = samples[Math.floor((best.start + best.end) / 2)]
console.log('mid-run stack (top -> root):')
console.log(stackOf(mid.id).slice(0, 25).join('\n  '))
