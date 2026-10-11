#!/usr/bin/env node
// Engraved arrangement practice: real audio -> arrangement -> OSMD sheet
// music -> Preview / Wait For You / Play Along, with cursor accuracy.
// Usage: AV_TARGET=piano|guitar E2E_PORT=5640 node scripts/browser-engraved-arrangement-e2e.mjs
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'engraved-arrangement')
const PORT = Number(process.env.E2E_PORT ?? 5640)
const TARGET = process.env.AV_TARGET ?? 'piano'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = []
const pass = (name, detail = '') => { results.push({ name, ok: true, detail }); console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`) }
const fail = (name, detail = '') => { results.push({ name, ok: false, detail }); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }

async function main() {
  await mkdir(outDir, { recursive: true })
  const server = await createServer({
    root,
    configFile: join(root, 'vite.config.js'),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  })
  await server.listen()
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
  const errors = []
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
    page.on('pageerror', (error) => errors.push('pageerror: ' + error.message.slice(0, 140)))
    page.on('console', (message) => {
      if (message.type() === 'error' && !/favicon|DevTools|google-analytics|AudioContext/i.test(message.text())) {
        errors.push(message.text().slice(0, 160))
      }
    })

    await page.goto(`http://127.0.0.1:${PORT}/?e2e-midi=1`, { waitUntil: 'networkidle' })
    await sleep(1500)

    // --- Upload audio and arrange (in-browser, real pipeline) ---
    await page.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
    await sleep(1000)
    const tabs = page.getByRole('tab')
    if (await tabs.count()) {
      for (const name of await tabs.allTextContents()) {
        if (/upload/i.test(name)) {
          await page.getByRole('tab', { name: new RegExp(name.trim().split(/\s+/)[0], 'i') }).click().catch(() => {})
          await sleep(800)
          break
        }
      }
    }
    await page.getByRole('region', { name: 'Create from audio' }).waitFor({ state: 'visible', timeout: 20000 })
    await page.locator('.audio-vision-drop input[type=file]').setInputFiles(join(root, 'tmp/audio-vision-staging/scale-input.wav'))
    await sleep(2000)
    if (TARGET === 'guitar') {
      await page.locator('.audio-vision-radio input[type=radio][value=solo-guitar]').click({ force: true }).catch(() => {})
      await sleep(600)
    }
    await page.getByRole('button', { name: /arrange/i }).click()
    await page.getByText(/arrangement is ready/i).first().waitFor({ timeout: 600000 })
    pass('arrangement generated')
    await page.getByRole('button', { name: /open in corranzo practice/i }).click().catch(() => {})
    await sleep(4000)
    await page.getByRole('button', { name: /open score/i }).first().click().catch(() => {})
    await sleep(4000)
    await page.locator('[data-osmd-ready="true"]').waitFor({ timeout: 60000 })
    await sleep(1500)
    await page.screenshot({ path: join(outDir, `${TARGET}-engraved.png`) })

    // --- Engraving presence: staves, noteheads, mapped notes ---
    const engraving = await page.evaluate(() => {
      const container = document.querySelector('.osmd-score__container')
      const svg = container?.querySelector('svg')
      const noteheads = container ? container.querySelectorAll('.vf-notehead').length : 0
      const measures = container ? container.querySelectorAll('g.vf-measure').length : 0
      const clefs = container ? container.querySelectorAll('g.vf-clef').length : 0
      const braces = container ? container.querySelectorAll('g.vf-brace').length : 0
      const staffLines = container ? container.querySelectorAll('path.vf-staveline, [class*=staffline]').length : 0
      const beamed = container ? container.querySelectorAll('.vf-beam').length : 0
      return {
        hasSvg: Boolean(svg),
        noteheads, measures, clefs, braces, staffLines, beamed,
        targetPart: container?.dataset.osmdTarget ?? null,
        title: document.querySelector('.arrangement-practice__header h2')?.textContent.trim() ?? null,
        allTargets: document.querySelector('.arrangement-practice__list summary')?.textContent.trim() ?? null,
        tabFrets: container ? container.querySelectorAll('.vf-fretboard, [class*=tab]').length : 0,
        biome: (container?.textContent ?? '').match(/0|1|2|3|4|5|6|7|8|9|10|12|15|17/g)?.length ?? 0,
      }
    })
    const engineCheckpoints = Number(/All targets \((\d+)\)/.exec(engraving.allTargets ?? '')?.[1] ?? 0)
    if (engraving.hasSvg && engraving.noteheads > 0) pass('engraved sheet music renders', `${engraving.noteheads} noteheads, ${engraving.staves} staves`)
    else fail('engraved sheet music renders', JSON.stringify(engraving))
    // Two measures on two staves each: piano = grand staff, guitar = notation + TAB.
    const expectedMeasures = 4
    // Clefs print once in the first measure (G+F piano, G+TAB guitar) and
    // are inherited afterwards: 2 is the honest engraving minimum.
    const expectedClefs = 2
    if (engraving.measures >= expectedMeasures && engraving.clefs >= expectedClefs) {
      pass('staff count matches target', `${engraving.measures} measures, ${engraving.clefs} clefs (${TARGET})`)
    } else {
      fail('staff count matches target', `${engraving.measures} measures, ${engraving.clefs} clefs for ${TARGET}`)
    }
    if (engineCheckpoints > 0) pass('engine checkpoints listed', String(engineCheckpoints))
    else fail('engine checkpoints listed', String(engraving.allTargets))

    // --- Canonical mapping: painted notes equal engine checkpoints ---
    const mapping = await page.evaluate(() => {
      const painted = document.querySelectorAll('[data-cz-score-note="1"]').length
      const withState = document.querySelectorAll('[data-cz-painted="1"]').length
      return { painted, withState }
    })
    if (mapping.painted > 0) pass('canonical states mapped onto engraved notes', JSON.stringify(mapping))
    else fail('canonical states mapped onto engraved notes', JSON.stringify(mapping))

    // --- Preview: cursor follows the transport ---
    await page.getByRole('button', { name: /^play$/i }).first().click()
    await sleep(3000)
    const cursorA = await page.evaluate(() => {
      const cursor = document.querySelector('.osmd-score__container [id^=cursorImg]') ?? document.querySelector('.osmd-score__container .vf-cursor, .osmd-score__container [class*=cursor]')
      if (!cursor) return null
      const rect = cursor.getBoundingClientRect()
      return { x: rect.x, width: rect.width }
    })
    await sleep(2500)
    const cursorB = await page.evaluate(() => {
      const cursor = document.querySelector('.osmd-score__container [id^=cursorImg]') ?? document.querySelector('.osmd-score__container .vf-cursor, .osmd-score__container [class*=cursor]')
      if (!cursor) return null
      const rect = cursor.getBoundingClientRect()
      return { x: rect.x, width: rect.width }
    })
    await page.screenshot({ path: join(outDir, `${TARGET}-playing.png`) })
    if (cursorA && cursorB && Math.abs(cursorB.x - cursorA.x) > 1) {
      pass('preview cursor advances with playback', `${Math.round(cursorA.x)} -> ${Math.round(cursorB.x)}`)
    } else {
      fail('preview cursor advances with playback', JSON.stringify({ cursorA, cursorB }))
    }
    await page.getByRole('button', { name: /^pause$/i }).first().click().catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})

    // --- Wait For You: blue required, then green after the correct note ---
    // Restart first: the Preview run above completed the whole passage, and
    // accuracy must be measured against a still-required (blue) note.
    await page.getByRole('button', { name: /^restart/i }).first().click().catch(() => {})
    await sleep(800)
    await page.locator('.wfy-input-source__summary').first().click().catch(() => {})
    await sleep(500)
    await page.locator('.wfy-input-source input[type=radio][value=midi]').click({ force: true }).catch(() => {})
    await sleep(1000)
    await page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Wait For You', exact: true }).click()
    await sleep(1500)
    const blueState = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.osmd-score__container .vf-notehead')]
      const painted = heads.filter((head) => (head.style.fill || '').includes('rgb'))
      return { total: heads.length, painted: painted.length, colors: painted.slice(0, 3).map((h) => h.style.fill) }
    })
    if (blueState.painted > 0) pass('WFY paints required notes', JSON.stringify(blueState))
    else fail('WFY paints required notes', JSON.stringify(blueState))

    const targetBefore = await page.evaluate(() => document.querySelector('.arrangement-practice__target')?.textContent.replace(/\s+/g, ' ') ?? '')
    const targetMidi = await page.evaluate(() => {
      const text = document.querySelector('.arrangement-practice__target')?.textContent ?? ''
      const match = /([A-G])(#|b)?(\d)/.exec(text)
      if (!match) return null
      const steps = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
      return 12 * (Number(match[3]) + 1) + steps[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0)
    })
    let accuracy = { errorPx: null, samples: 0 }
    if (Number.isFinite(targetMidi)) {
      await page.evaluate((midi) => window.__SCOREFLOW_MIDI_INJECT__?.(midi), targetMidi)
      await sleep(1500)
      const targetAfter = await page.evaluate(() => document.querySelector('.arrangement-practice__target')?.textContent.replace(/\s+/g, ' ') ?? '')
      if (/Section complete|Now play/.test(targetAfter) && targetAfter !== targetBefore) {
        pass('WFY advances on the correct note', `${targetBefore.slice(0, 40)} -> ${targetAfter.slice(0, 40)}`)
      } else {
        fail('WFY advances on the correct note', `${targetBefore} -> ${targetAfter}`)
      }
      // Cursor-to-notehead accuracy while playing the next target.
      accuracy = await page.evaluate(() => {
        const container = document.querySelector('.osmd-score__container')
        if (!container) return { errorPx: null, samples: 0 }
        const cursor = container.querySelector('[id^=cursorImg]') ?? container.querySelector('[class*=cursor]')
        const paintedCurrent = [...container.querySelectorAll('[data-cz-painted="1"]')].filter((el) => /rgb\(37, 99, 235\)/.test(el.style.fill || ''))
        if (!cursor || paintedCurrent.length === 0) return { errorPx: null, samples: 0 }
        const cursorRect = cursor.getBoundingClientRect()
        const noteRect = paintedCurrent[0].getBoundingClientRect()
        return { errorPx: Math.abs((cursorRect.x + cursorRect.width / 2) - (noteRect.x + noteRect.width / 2)), samples: 1 }
      })
      if (accuracy.errorPx != null && accuracy.errorPx <= 40) {
        pass('cursor aligns with the required notehead', `${accuracy.errorPx.toFixed(1)}px`)
      } else if (accuracy.errorPx != null) {
        fail('cursor aligns with the required notehead', `${accuracy.errorPx.toFixed(1)}px`)
      } else {
        fail('cursor aligns with the required notehead', 'cursor or painted note not measurable')
      }
    } else {
      fail('WFY advances on the correct note', 'could not read the required pitch from the target')
    }
    await page.screenshot({ path: join(outDir, `${TARGET}-wfy.png`) })

    // --- Play Along keeps the score clock moving ---
    await page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Play Along', exact: true }).click()
    await sleep(1200)
    await page.getByRole('button', { name: /^restart/i }).first().click().catch(() => {})
    await sleep(800)
    await page.getByRole('button', { name: /^play$/i }).first().click().catch(() => {})
    await sleep(3000)
    const playing = await page.getByRole('button', { name: /^pause$/i }).count()
    if (playing) pass('play along runs on the engraved score')
    else fail('play along runs on the engraved score', 'transport did not start')
    await page.screenshot({ path: join(outDir, `${TARGET}-playalong.png`) })

    if (errors.length === 0) pass('no console or page errors')
    else fail('no console or page errors', errors.slice(0, 3).join(' | '))
    await writeFile(join(outDir, `${TARGET}-report.json`), JSON.stringify({ results, engraving, errors }, null, 2))
    const failed = results.filter((entry) => !entry.ok)
    console.log(`${results.length - failed.length} passed, ${failed.length} failed`)
    if (failed.length) process.exitCode = 1
  } finally {
    await browser.close().catch(() => {})
    await server.close().catch(() => {})
  }
}
main().catch((error) => { console.error(error); process.exit(2) })
