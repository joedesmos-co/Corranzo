#!/usr/bin/env node
// Long-arrangement engraving: a many-measure MusicXML with a mid-song tempo
// change, dense chords and repeated notes, loaded through the app's own
// import lane (not as an arrangement) to exercise the engraver against a
// score that is longer than the viewport.
//
// Usage: E2E_PORT=5670 node scripts/browser-long-arrangement-e2e.mjs
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'long-arrangement')
const PORT = Number(process.env.E2E_PORT ?? 5670)
const TARGET = process.env.AV_TARGET ?? 'piano'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = []
const pass = (name, detail = '') => { results.push({ name, ok: true, detail }); console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`) }
const fail = (name, detail = '') => { results.push({ name, ok: false, detail }); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }

/** 24 measures: single line + repeated-note runs, then dense chords. */
function buildLongMusicXml() {
  const names = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">\n`
  xml += `<work><work-title>Long Etude</work-title></work>\n`
  xml += `<part-list><score-part id="P1"><part-name>Solo Piano</part-name></score-part></part-list>\n`
  xml += `<part id="P1">\n`
  for (let m = 1; m <= 24; m += 1) {
    xml += `<measure number="${m}">\n`
    if (m === 1) {
      xml += `<attributes><divisions>32</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>` +
        `<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>\n`
      xml += `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction>\n`
    }
    if (m === 13) {
      // Mid-song tempo change: the engraver prints it, the clock must slow.
      xml += `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome></direction-type><sound tempo="60"/></direction>\n`
    }
    const step = names[(m - 1) % names.length]
    if (m % 4 === 0) {
      // Dense chord measure (grand-staff chord, all voices at one onset).
      const pitches = [
        { step: step, octave: 4 }, { step: step, octave: 5 },
        { step: step, octave: 3 },
      ]
      xml += `<note>${chordXml(pitches, 32, 1, 1)}</note>\n`
      xml += `<note>${chordXml(pitches, 32, 1, 2, true)}</note>\n`
    } else if (m % 3 === 0) {
      // Repeated same-pitch eighths.
      for (let i = 0; i < 8; i += 1) {
        xml += `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>eighth</type><stem>up</stem><staff>1</staff></note>\n`
      }
    } else {
      // Mixed treble melody (quarter notes) + bass half notes.
      const notes = [step, names[(m + 1) % names.length], names[(m + 2) % names.length], names[(m + 3) % names.length]]
      let treble = ''
      for (const n of notes) {
        treble += `<note><pitch><step>${n}</step><octave>4</octave></pitch><duration>32</duration><voice>1</voice><type>quarter</type><stem>up</stem><staff>1</staff></note>\n`
      }
      let bass = `<note><pitch><step>${step}</step><octave>2</octave></pitch><duration>64</duration><voice>2</voice><type>half</type><stem>down</stem><staff>2</staff></note>`
      bass += `<note><pitch><step>${names[(m + 4) % names.length]}</step><octave>2</octave></pitch><duration>64</duration><voice>2</voice><type>half</type><stem>down</stem><staff>2</staff></note>`
      xml += treble + bass + `<backup><duration>128</duration></backup>\n`
    }
    xml += `</measure>\n`
  }
  xml += `</part>\n</score-partwise>\n`
  return xml
}

function chordXml(pitches, divisions, staff, voice, withBackup = false) {
  let s = `<pitch><step>${pitches[0].step}</step><octave>${pitches[0].octave}</octave></pitch><duration>${divisions}</duration><voice>${voice}</voice><type>quarter</type><staff>${staff}</staff>`
  if (withBackup) s += `</note>`
  return s
}

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
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  })
  const errors = []
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
    page.on('pageerror', (error) => errors.push('pageerror: ' + error.message.slice(0, 140)))
    page.on('console', (message) => {
      if (message.type() === 'error' && !/favicon|DevTools|google-analytics|AudioContext/i.test(message.text())) {
        errors.push(message.text().slice(0, 160))
      }
    })
    await page.goto(`http://127.0.0.1:${PORT}/?e2e-midi=1`, { waitUntil: 'networkidle' })
    await sleep(1500)
    // Upload a LONG recording and let the real in-browser pipeline
    // (Basic Pitch -> arrangement) build the score; the app then engraves it.
    await page.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
    await sleep(1000)
    const tabs = page.getByRole('tab')
    if (await tabs.count()) {
      for (const name of await tabs.allTextContents()) {
        if (/upload/i.test(name)) { await page.getByRole('tab', { name: new RegExp(name.trim().split(/\s+/)[0], 'i') }).click().catch(() => {}); await sleep(800); break }
      }
    }
    await page.getByRole('region', { name: 'Create from audio' }).waitFor({ state: 'visible', timeout: 20000 })
    if (TARGET === 'guitar') {
      await page.locator('.audio-vision-radio input[type=radio][value=solo-guitar]').click({ force: true }).catch(() => {})
      await sleep(600)
    }
    await page.locator('.audio-vision-drop input[type=file]').setInputFiles(join(root, 'tmp', 'long-arrangement', 'long-scale.wav'))
    await sleep(2500)
    await page.getByRole('button', { name: /arrange/i }).click()
    console.log('arranging long clip (real transcription)…')
    await page.getByText(/arrangement is ready/i).first().waitFor({ timeout: Number(process.env.LONG_TIMEOUT_MS ?? 900000) })
    await page.getByRole('button', { name: /open in corranzo practice/i }).click().catch(() => {})
    await sleep(4000)
    await page.getByRole('button', { name: /open score/i }).first().click().catch(() => {})
    await sleep(5000)
    await page.locator('[data-osmd-ready="true"]').waitFor({ timeout: 120000 }).catch(() => {})
    // Preview playback on the arrangement surface.
    await page.getByRole('button', { name: /^play$/i }).first().click().catch(() => {})
    const samples = []
    for (let i = 0; i < 8; i += 1) {
      await sleep(2500)
      samples.push(await page.evaluate(() => {
        const cursor = document.querySelector('.osmd-score__container [id^=cursorImg]') ?? document.querySelector('.osmd-score__container [class*=cursor]')
        const rect = cursor?.getBoundingClientRect?.()
        const scroll = document.querySelector('.osmd-score__container')
        return {
          x: rect ? Math.round(rect.x) : null,
          scrollTop: scroll ? Math.round(scroll.scrollTop) : null,
          target: document.querySelector('.arrangement-practice__target')?.textContent?.replace(/\s+/g, ' ').slice(0, 60) ?? null,
          allTargets: document.querySelector('.arrangement-practice__list summary')?.textContent?.trim() ?? null,
        }
      }))
    }
    await page.getByRole('button', { name: /^pause$/i }).first().click().catch(() => {})
    const info = await page.evaluate(() => {
      const container = document.querySelector('.osmd-score__container') ?? document.querySelector('.workspace-frame')
      const measures = container ? container.querySelectorAll('g.vf-measure').length : 0
      const noteheads = container ? container.querySelectorAll('.vf-notehead').length : 0
      const scrollable = container ? container.scrollHeight > container.clientHeight + 20 : false
      return { measures, noteheads, scrollable, hasOsmd: Boolean(document.querySelector('[data-osmd-ready]')) }
    })
    console.log('score: ' + JSON.stringify(info))
    if (info.measures >= 12 && info.noteheads > 40) pass('long score engraves with many systems', JSON.stringify(info))
    else fail('long score engraves with many systems', JSON.stringify(info))
    if (info.scrollable) pass('score is scrollable')
    else fail('score is scrollable', 'content fits the viewport')

    console.log('samples: ' + JSON.stringify(samples))
    const moved = samples.some((s) => s.x != null) && new Set(samples.map((s) => s.x)).size > 1
    if (moved) pass('cursor advances across systems during long playback', samples.map((s) => s.x).join(' → '))
    else fail('cursor advances across systems during long playback', JSON.stringify(samples.map((s) => s.x)))
    const scrolled = samples.some((s) => typeof s.scrollTop === 'number' && s.scrollTop > 10)
    if (scrolled) pass('auto-scroll follows the cursor', samples.map((s) => s.scrollTop).join(' → '))
    else fail('auto-scroll follows the cursor', JSON.stringify(samples.map((s) => s.scrollTop)))
    await page.locator('.workspace-play').first().click().catch(() => {})
    await page.screenshot({ path: join(outDir, 'playing.png') })

    // WFY lock + highlight on a repeated-note measure.
    await page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Wait For You', exact: true }).click()
    await sleep(1500)
    await page.locator('.wfy-input-source__summary').first().click().catch(() => {})
    await sleep(500)
    await page.locator('.wfy-input-source input[type=radio][value=midi]').click({ force: true }).catch(() => {})
    await sleep(1000)
    await page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Wait For You', exact: true }).click()
    await sleep(1500)
    const target = await page.evaluate(() => document.querySelector('.arrangement-practice__target')?.textContent?.replace(/\s+/g, ' ').slice(0, 80) ?? null)
    console.log('wfy target: ' + target)
    const painted = await page.evaluate(() => document.querySelectorAll('[data-cz-painted="1"]').length)
    if (painted > 0) pass('WFY highlights on the long score', String(painted))
    else fail('WFY highlights on the long score', 'none')
    const label = await page.evaluate(() => document.querySelector('.arrangement-practice__target strong')?.textContent?.trim() ?? null)
    const match = /([A-G])(#|b)?(\d)/.exec(label ?? '')
    const steps = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
    if (match) {
      const midi = 12 * (Number(match[3]) + 1) + steps[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0)
      await page.evaluate((value) => window.__SCOREFLOW_MIDI_INJECT__?.(value), midi)
      await sleep(1500)
      const after = await page.evaluate(() => document.querySelector('.arrangement-practice__target')?.textContent?.replace(/\s+/g, ' ').slice(0, 80) ?? null)
      if (after !== target) pass('WFY advances on the long score', `${target?.slice(0, 40)} -> ${after?.slice(0, 40)}`)
      else fail('WFY advances on the long score', `${target} -> ${after}`)
    }
    await page.screenshot({ path: join(outDir, 'wfy.png') })
    if (errors.length === 0) pass('no console or page errors')
    else fail('no console or page errors', errors.slice(0, 3).join(' | '))
    await writeFile(join(outDir, 'report.json'), JSON.stringify({ results, info, samples, errors }, null, 2))
    const failed = results.filter((entry) => !entry.ok)
    console.log(`${results.length - failed.length} passed, ${failed.length} failed`)
    if (failed.length) process.exitCode = 1
  } finally {
    await browser.close().catch(() => {})
    await server.close().catch(() => {})
  }
}
main().catch((error) => { console.error(error); process.exit(2) })
