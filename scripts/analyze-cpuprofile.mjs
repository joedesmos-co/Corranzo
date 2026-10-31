#!/usr/bin/env node
import { readFileSync } from 'node:fs'
const profile = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
let total = 0
let t = 0
const times = []
for (let i = 0; i < profile.samples.length; i += 1) {
  const dt = profile.timeDeltas?.[i] ?? 0
  t += dt
  times.push(t)
  const id = profile.samples[i]
  self.set(id, (self.get(id) ?? 0) + dt)
  total += dt
}
const rows = [...self.entries()].map(([id, us]) => {
  const node = nodes.get(id)
  const cf = node?.callFrame ?? {}
  return {
    id,
    us,
    ms: us / 1000,
    pct: (us / total) * 100,
    fn: cf.functionName || '(anonymous)',
    url: cf.url || '',
    line: cf.lineNumber,
    col: cf.columnNumber,
  }
}).sort((a, b) => b.us - a.us)
console.log('total ms', (total / 1000).toFixed(1), 'samples', profile.samples.length)
for (const row of rows.slice(0, 40)) {
  console.log(`${row.ms.toFixed(1).padStart(8)}ms ${row.pct.toFixed(1).padStart(5)}% ${row.fn} ${row.url}:${row.line + 1}`)
}
// Largest gap between consecutive samples (the blocking task)
let maxGap = 0, maxIndex = -1
for (let i = 1; i < times.length; i += 1) {
  const gap = times[i] - times[i - 1]
  if (gap > maxGap) { maxGap = gap; maxIndex = i }
}
console.log('max sample gap', (maxGap / 1000).toFixed(1), 'ms at sample', maxIndex, 't', (times[maxIndex] / 1000).toFixed(1))
const windowStart = Math.max(0, maxIndex - 3)
const windowEnd = Math.min(profile.samples.length - 1, maxIndex + 3)
console.log('samples around gap:')
for (let i = windowStart; i <= windowEnd; i += 1) {
  const node = nodes.get(profile.samples[i])
  const cf = node?.callFrame ?? {}
  console.log(i, (times[i] / 1000).toFixed(1), cf.functionName || '(anon)', cf.url, cf.lineNumber + 1)
}
