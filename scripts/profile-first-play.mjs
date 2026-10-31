#!/usr/bin/env node
/**
 * CPU-profile the first Play in a production build.
 *
 * Uses CDP Input to press Play (page.evaluate would wait for the main thread
 * and distort the measurement), then samples the V8 profiler for 2.5 s.
 *
 *   node scripts/profile-first-play.mjs --base http://localhost:5180 --out /tmp/first-play.cpuprofile
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
function arg(name, fallback) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
const baseUrl = arg('base', 'http://localhost:5180')
const out = arg('out', '/tmp/first-play.cpuprofile')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${baseUrl}/#library`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Open score: Hungarian Dance No\. 5/ }).click()
await page.waitForTimeout(8000)
const box = await page.locator('button.workspace-play').boundingBox()
const client = await page.context().newCDPSession(page)
await client.send('Profiler.enable')
await client.send('Profiler.setSamplingInterval', { interval: 1000 })
await client.send('Profiler.start')
const x = box.x + box.width / 2
const y = box.y + box.height / 2
await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
await new Promise((resolve) => setTimeout(resolve, 2500))
const { profile } = await client.send('Profiler.stop')
writeFileSync(out, JSON.stringify(profile))
console.log(`wrote ${out} (${profile.nodes.length} nodes, ${profile.samples?.length ?? 0} samples)`)
await browser.close()
