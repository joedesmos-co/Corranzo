#!/usr/bin/env node
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
const args = process.argv.slice(2)
function arg(name, fallback) { const i=args.indexOf(`--${name}`); return i>=0?args[i+1]:fallback }
const browserName = arg('browser','chromium')
const baseUrl = arg('base','http://localhost:5179')
const scoreTitle = arg('score','Hungarian Dance No. 5')
const instrument = arg('instrument','piano')
const outPath = arg('out','tmp/cursor-trace/score-data.json')
const browser = await chromium.launch({headless:true})
const page = await browser.newPage({viewport:{width:1440,height:900}})
await page.goto(`${baseUrl}/#library`, {waitUntil:'networkidle'})
if (instrument==='guitar') { await page.getByText('Acoustic Guitar',{exact:true}).first().click(); await page.waitForTimeout(500) }
await page.getByRole('button',{name:new RegExp(`Open score: ${scoreTitle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`)}).click()
await page.waitForTimeout(8000)
await page.waitForSelector('.score-follow-cursor',{state:'attached',timeout:30000})
const data = await page.evaluate(() => {
  const overlay = document.querySelector('.score-follow-overlay')
  const key = Object.keys(overlay).find((k)=>k.startsWith('__reactFiber$'))
  let fiber = key ? overlay[key] : null
  while (fiber && fiber.memoizedProps?.anchors == null) fiber = fiber.return
  const anchors = fiber?.memoizedProps?.anchors ?? []
  return {
    anchors,
    playback: window.__SCOREFLOW_PLAYBACK_SNAPSHOT__ ?? null,
    activeScore: window.__SCOREFLOW_ACTIVE_SCORE__ ?? null,
  }
})
await mkdir(dirname(outPath),{recursive:true})
await writeFile(outPath, JSON.stringify({scoreTitle,instrument,...data},null,2))
console.log(`wrote ${outPath} anchors=${data.anchors.length}`)
await browser.close()
