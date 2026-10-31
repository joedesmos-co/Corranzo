#!/usr/bin/env node
import { chromium } from 'playwright'
const args = process.argv.slice(2)
function arg(name, fallback) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
const baseUrl = arg('base', 'http://localhost:5180')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${baseUrl}/#library`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Open score: Hungarian Dance No\. 5/ }).click()
await page.waitForTimeout(8000)
const client = await page.context().newCDPSession(page)
await client.send('HeapProfiler.enable')
await client.send('Performance.enable')
const heap = async () => {
  await client.send('HeapProfiler.collectGarbage')
  await client.send('HeapProfiler.collectGarbage')
  const { metrics } = await client.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
}
const before = await heap()
await page.locator('button.workspace-play').click()
await page.waitForTimeout(3000)
const after = await heap()
const result = {
  heapBeforeMB: before.JSHeapUsedSize / 1048576,
  heapAfterMB: after.JSHeapUsedSize / 1048576,
  deltaMB: (after.JSHeapUsedSize - before.JSHeapUsedSize) / 1048576,
  nodesBefore: before.Nodes,
  nodesAfter: after.Nodes,
  documents: after.Documents,
}
console.log(JSON.stringify(result, null, 2))
await browser.close()
