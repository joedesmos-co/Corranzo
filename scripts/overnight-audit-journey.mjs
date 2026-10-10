#!/usr/bin/env node
// P2/P3 overnight audit: 15-step user journey with evidence capture.
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'overnight-audit')
const PORT = Number(process.env.E2E_PORT ?? 5598)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function scoreState(page) {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-score-note-state]')]
    const byState = {}
    for (const b of boxes) {
      const s = b.getAttribute('data-score-note-state')
      byState[s] = (byState[s] ?? 0) + 1
    }
    const cur = boxes.find((b) => ['current', 'current-partial', 'wrong'].includes(b.getAttribute('data-score-note-state')))
    const cursor = document.querySelector('.score-follow-cursor')
    const yourTurn = document.querySelector('.workspace-your-turn')
    const btn = document.querySelector('.workspace-play')
    return {
      total: boxes.length, byState,
      currentKey: cur?.getAttribute('data-practice-note-target-key') ?? null,
      currentState: cur?.getAttribute('data-score-note-state') ?? null,
      currentLabel: cur?.getAttribute('aria-label')?.slice(0, 160) ?? null,
      cursorVisible: Boolean(cursor) && cursor?.style.display !== 'none',
      yourTurn: yourTurn ? yourTurn.textContent.slice(0, 200) : null,
      transport: btn ? btn.getAttribute('aria-label') : null,
      modes: [...document.querySelectorAll('[role=radiogroup][aria-label="Practice mode"] [role=radio]')].map((r) => `${r.textContent.trim()}:${r.getAttribute('aria-checked')}`),
    }
  })
}
async function dismissTools(page) {
  const scrim = page.getByRole('button', { name: 'Dismiss tools' })
  if (await scrim.isVisible().catch(() => false)) {
    await scrim.click()
    await sleep(400)
  }
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(200)
}
async function pressTransport(page) {
  await dismissTools(page)
  await page.locator('.workspace-play').first().click()
}
async function inject(page, midi) {
  return page.evaluate((v) => window.__SCOREFLOW_MIDI_INJECT__?.(v) ?? false, midi)
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const log = []
  const note = (s) => { log.push(s); console.log(s) }
  const server = await createServer({ root, configFile: join(root, 'vite.config.js'), logLevel: 'silent', server: { host: '127.0.0.1', port: PORT, strictPort: true } })
  await server.listen()
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 120)))
  const base = `http://127.0.0.1:${PORT}/?e2e-midi=1`
  try {
    await page.goto(base, { waitUntil: 'networkidle' })
    await sleep(1500)
    await page.screenshot({ path: join(outDir, '01-home.png') })
    note('1 home ok')
    await page.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
    await sleep(800)
    await page.locator('.cz-piece-row').first().waitFor({ state: 'visible', timeout: 20000 })
    await page.screenshot({ path: join(outDir, '02-library.png') })
    note('2 library ok')
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const t = buttons.find((b) => {
        if (!/open score|start practice/i.test(b.textContent)) return false
        return (b.closest('.cz-piece-row')?.textContent ?? '').includes('Prelude')
      })
      t?.click()
    })
    await sleep(8000)
    // 3 Preview playback
    let s = await scoreState(page)
    note(`3 preview boxes=${s.total} transport=${s.transport}`)
    await page.screenshot({ path: join(outDir, '03-preview.png') })
    await pressTransport(page)
    await sleep(4000)
    s = await scoreState(page)
    note(`4 playing transport=${s.transport} cursor=${s.cursorVisible}`)
    await page.screenshot({ path: join(outDir, '04-playing.png') })
    // 5 pause / seek / loop
    await pressTransport(page)
    await sleep(800)
    s = await scoreState(page)
    note(`5 paused transport=${s.transport}`)
    const seekbar = page.locator('input[type=range]').first()
    if (await seekbar.count()) { await seekbar.fill('30').catch(() => {}); await sleep(1000); note('5 seek ok') }
    const loopBtn = page.getByRole('button', { name: /loop/i }).first()
    if (await loopBtn.count()) { await loopBtn.click(); await sleep(500); note('5 loop toggled') }
    await pressTransport(page)
    await sleep(2000)
    await pressTransport(page)
    await sleep(800)
    // 6 WFY + MIDI
    await page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Wait For You', exact: true }).click()
    await sleep(1500)
    await page.getByRole('button', { name: 'Practice input' }).click()
    await sleep(600)
    await page.getByRole('button', { name: 'MIDI keyboard' }).click()
    await sleep(600)
    await page.keyboard.press('Escape').catch(() => {})
    s = await scoreState(page)
    note(`6 wfy current=${s.currentKey} state=${s.currentState} label=${s.currentLabel}`)
    note(`6 yourTurn=${s.yourTurn}`)
    await page.screenshot({ path: join(outDir, '06-wfy.png') })
    // 8 correct note (expected pitches exposed on the box)
    const exp = await page.evaluate(() => {
      const cur = [...document.querySelectorAll('[data-score-note-state]')]
        .find((b) => ['current', 'current-partial', 'wrong'].includes(b.getAttribute('data-score-note-state')))
      return cur?.getAttribute('data-score-expected')?.split(',').map(Number).filter(Number.isFinite) ?? []
    })
    note(`8 expected midis=${JSON.stringify(exp)}`)
    const firstMidi = exp[0]
    await inject(page, firstMidi)
    await sleep(1200)
    s = await scoreState(page)
    const greenCount = s.byState.done ?? 0
    note(`8 correct injected=${firstMidi} done=${greenCount} now-current=${s.currentKey} state=${s.currentState}`)
    await page.screenshot({ path: join(outDir, '08-correct.png') })
    // 10 wrong note (a pitch not in the expected set)
    const curExp = await page.evaluate(() => {
      const cur = [...document.querySelectorAll('[data-score-note-state]')]
        .find((b) => ['current', 'current-partial', 'wrong'].includes(b.getAttribute('data-score-note-state')))
      return cur?.getAttribute('data-score-expected')?.split(',').map(Number).filter(Number.isFinite) ?? []
    })
    let wrongMidi = 30
    while (curExp.includes(wrongMidi)) wrongMidi += 1
    await inject(page, wrongMidi)
    await sleep(1000)
    s = await scoreState(page)
    note(`10 wrong injected=${wrongMidi} states=${JSON.stringify(s.byState)} current=${s.currentKey}:${s.currentState}`)
    note(`10 yourTurn=${s.yourTurn}`)
    await page.screenshot({ path: join(outDir, '10-wrong.png') })
    // 12 chord: walk correct notes until a partial/current-partial appears (max 14 notes)
    let sawPartial = false
    for (let i = 0; i < 14; i++) {
      s = await scoreState(page)
      if (s.currentState === 'current-partial') { sawPartial = true; break }
      const want = await page.evaluate(() => {
        const cur = [...document.querySelectorAll('[data-score-note-state]')]
          .find((b) => ['current', 'current-partial', 'wrong'].includes(b.getAttribute('data-score-note-state')))
        return cur?.getAttribute('data-score-expected')?.split(',').map(Number).filter(Number.isFinite) ?? []
      })
      if (!want.length) break
      for (const m of want) { await inject(page, m); await sleep(250) }
      await sleep(500)
    }
    s = await scoreState(page)
    note(`12 chord walk sawPartial=${sawPartial} state=${s.currentState} key=${s.currentKey}`)
    await page.screenshot({ path: join(outDir, '12-chord.png') })
    // 14 Play Along
    await page.getByRole('radiogroup', { name: 'Practice mode' }).getByRole('radio', { name: 'Play Along', exact: true }).click()
    await sleep(1200)
    await pressTransport(page)
    await sleep(5000)
    s = await scoreState(page)
    note(`14 playalong transport=${s.transport} cursor=${s.cursorVisible} states=${JSON.stringify(s.byState)}`)
    await page.screenshot({ path: join(outDir, '14-playalong.png') })
    // 15 restart (stop + play again)
    await pressTransport(page)
    await sleep(600)
    await pressTransport(page)
    await sleep(2500)
    s = await scoreState(page)
    note(`15 restarted transport=${s.transport}`)
    await writeFile(join(outDir, 'audit.json'), JSON.stringify({ log, errors }, null, 2))
    note(`errors: ${errors.length ? JSON.stringify(errors) : 'none'}`)
  } finally {
    await browser.close().catch(() => {})
    await server.close().catch(() => {})
  }
}
main().catch((e) => { console.error(e); process.exit(2) })
