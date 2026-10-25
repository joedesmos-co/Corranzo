#!/usr/bin/env node
/**
 * Audio Vision v3 note editor — real browser acceptance.
 *
 * Exercises the visible Review notes UI: pitch/octave/onset/duration edits,
 * remove + undo, add + remove + undo, clear, tempo rebuild, save/open and
 * reload persistence. Checks the persisted MusicXML and the correction record,
 * not just the data model.
 *
 * Usage: E2E_PORT=5622 node scripts/browser-audio-vision-note-editor.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium, webkit } from 'playwright'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'audio-vision-note-editor')
const profileDir = join(outDir, 'profile')
const PORT = Number(process.env.E2E_PORT ?? 5622)
const baseUrl = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}/`
const report = { passes: [], failures: [], consoleErrors: [], pageErrors: [] }
const pass = (name, detail = null) => { report.passes.push({ name, detail }); console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ''}`) }
const fail = (name, detail = null) => { report.failures.push({ name, detail }); console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function noteNameToMidi(text) {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(String(text ?? '').replace(/[−–]/g, '-').trim())
  if (!match) return null
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]]
  return (Number(match[3]) + 1) * 12 + base + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0)
}
function noteName(midi) {
  const value = Math.round(Number(midi))
  return `${NOTE_NAMES[((value % 12) + 12) % 12]}${Math.floor(value / 12) - 1}`
}

async function writeFigureWav(path) {
  const SR = 44100
  const seconds = 4
  const seq = [60, 64, 67, 72, 67, 64, 60, 55]
  const data = new Float32Array(SR * seconds)
  const beat = 0.5
  const tone = (midi, start, dur, amp = 0.42) => {
    const freq = 440 * 2 ** ((midi - 69) / 12)
    const s0 = Math.floor(start * SR)
    const s1 = Math.min(data.length, Math.floor((start + dur) * SR))
    for (let i = s0; i < s1; i += 1) {
      const t = (i - s0) / SR
      data[i] += amp * Math.exp(-2.6 * t) * Math.sin(2 * Math.PI * freq * t)
    }
  }
  for (let b = 0; b * beat < seconds; b += 1) {
    tone(seq[b % seq.length], b * beat, 0.46)
    const s0 = Math.floor(b * beat * SR)
    for (let i = 0; i < 260 && s0 + i < data.length; i += 1) {
      data[s0 + i] += 0.3 * Math.exp(-i / 42) * Math.sin((2 * Math.PI * 150 * i) / SR)
    }
  }
  const n = data.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i += 1) {
    const value = Math.max(-1, Math.min(1, data[i]))
    buf.writeInt16LE(Math.round(value * 32767), 44 + i * 2)
  }
  await writeFile(path, buf)
  return path
}

async function goToLibraryUploads(page) {
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find((el) => /library/i.test(el.textContent ?? ''))
    button?.click()
  })
  await sleep(900)
  const uploads = page.getByRole('tab', { name: /my uploads/i })
  if (await uploads.count()) { await uploads.click(); await sleep(600) }
}

async function generatePiano(page, wavPath) {
  await goToLibraryUploads(page)
  await page.getByText('Create from audio', { exact: false }).first().waitFor({ timeout: 20000 })
  await page.locator('.audio-vision-card input[type="file"]').setInputFiles(wavPath)
  await page.getByText(/recording length/i).first().waitFor({ timeout: 60000 })
  await page.locator('.audio-vision-card input[name="audio-vision-target"][value="solo-piano"]').check()
  await page.locator('.audio-vision-card input[name="audio-vision-difficulty"][value="easy"]').check()
  await page.getByRole('button', { name: /arrange for/i }).click()
  await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 300000 })
}

async function openReview(page) {
  const details = page.locator('.audio-vision-note-review')
  await details.waitFor({ timeout: 30000 })
  if (!(await details.getAttribute('open'))) {
    await details.locator('summary').click()
  }
  await details.locator('.audio-vision-note-list-tall').waitFor({ timeout: 10000 })
  return details
}

async function readPersistedMusicXml(page, waitMs = 10000) {
  const deadline = Date.now() + waitMs
  for (;;) {
    const xml = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('scoreflow-session', 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('files')) request.result.createObjectStore('files')
        }
      })
      if (!db.objectStoreNames.contains('files')) return null
      const value = await new Promise((resolve) => {
        try {
          const tx = db.transaction('files', 'readonly')
          const req = tx.objectStore('files').get('musicXml')
          req.onerror = () => resolve(null)
          req.onsuccess = () => resolve(req.result ?? null)
        } catch {
          resolve(null)
        }
      })
      if (!value) return null
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value)
      const text = new TextDecoder().decode(bytes)
      return text.includes('<score-partwise') ? text : null
    })
    if (xml) return xml
    if (Date.now() > deadline) return xml
    await sleep(400)
  }
}

async function readArrangementMeta(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('scoreflow-session-meta-v1')
    if (!raw) return null
    const meta = JSON.parse(raw)
    const seen = new Set()
    const find = (value) => {
      if (!value || typeof value !== 'object' || seen.has(value)) return null
      seen.add(value)
      if (value.arrangement && value.corrections !== undefined) return value.arrangement
      if (value.arrangement) return value.arrangement
      for (const child of Object.values(value)) {
        const found = find(child)
        if (found) return found
      }
      return null
    }
    return find(meta)
  })
}

async function openPractice(page) {
  await page.getByRole('button', { name: /open in corranzo practice/i }).click()
  await page.getByText('Arranged from your recording', { exact: false }).first().waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: /^open score$/i }).first().waitFor({ timeout: 90000 })
  await page.getByRole('button', { name: /^open score$/i }).first().click()
  await page.locator('.workspace-frame .workspace-dock').first().waitFor({ state: 'visible', timeout: 90000 })
  await page.locator('.osmd-score__container[data-osmd-ready="true"]').first().waitFor({ state: 'visible', timeout: 90000 })
}

await mkdir(outDir, { recursive: true })
await rm(profileDir, { recursive: true, force: true })
const wavPath = join(outDir, 'note-editor.wav')
await writeFigureWav(wavPath)

const server = await createServer({
  root,
  server: { port: PORT, strictPort: true, host: '127.0.0.1' },
  logLevel: 'error',
})
await server.listen()
const browserType = process.env.BROWSER === 'webkit' ? webkit : chromium
const browser = await browserType.launchPersistentContext(profileDir, {
  headless: true,
  viewport: { width: 1440, height: 1000 },
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
page.on('console', (message) => {
  if (message.type() === 'error') {
    const text = message.text()
    if (!/favicon|DevTools|AudioContext was not allowed|The AudioContext|google-analytics|googletagmanager|gstatic|fonts\.googleapis/i.test(text)) {
      report.consoleErrors.push(text)
    }
  }
})
page.on('pageerror', (error) => report.pageErrors.push(error.message))

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await sleep(800)
  await generatePiano(page, wavPath)
  const review = await openReview(page)
  const rows = review.locator('.audio-vision-note-list-tall > li')
  const initialRows = await rows.count()
  if (initialRows > 0) pass('editor: review list is visible', `${initialRows} active notes`)
  else fail('editor: review list is visible', 'no rows')

  const first = rows.first()
  const before = (await first.textContent() ?? '').replace(/\s+/g, ' ').trim()
  await first.getByRole('button', { name: /^Edit / }).click()
  await first.getByRole('button', { name: '+1', exact: true }).click()
  await sleep(300)
  const afterPitch = (await rows.first().textContent() ?? '').replace(/\s+/g, ' ').trim()
  if (afterPitch !== before && /edited/.test(afterPitch)) pass('editor: pitch +1 changes exactly the selected row', afterPitch.slice(0, 100))
  else fail('editor: pitch +1 changes exactly the selected row', `${before} -> ${afterPitch}`)

  await rows.first().getByRole('button', { name: '+8va', exact: true }).click()
  await sleep(300)
  const afterOctave = (await rows.first().textContent() ?? '').replace(/\s+/g, ' ').trim()
  if (afterOctave !== afterPitch) pass('editor: octave +12 is accessible', afterOctave.slice(0, 100))
  else fail('editor: octave +12 is accessible', afterOctave)

  await rows.first().getByRole('button', { name: '+0.25', exact: true }).first().click()
  await sleep(300)
  await rows.first().getByRole('button', { name: '+0.25', exact: true }).last().click()
  await sleep(300)
  pass('editor: onset and duration controls are accessible')

  const editedName = (afterOctave.match(/^\S+/) ?? [])[0]
  await rows.first().getByRole('button', { name: /^Remove / }).click()
  await sleep(300)
  const removed = review.locator('.audio-vision-note-removed')
  if (await removed.count()) pass('editor: removing an edited note records it')
  else fail('editor: removing an edited note records it', 'no removed section')
  await removed.getByRole('button', { name: /Undo removal/i }).first().click()
  await sleep(300)
  const restored = (await rows.first().textContent() ?? '').replace(/\s+/g, ' ').trim()
  if (restored.includes('edited')) pass('editor: undo restores the edited note', restored.slice(0, 100))
  else fail('editor: undo restores the edited note', restored)

  await page.getByLabel('New note pitch').fill('C7')
  await page.getByLabel('New note bar').fill('5')
  await page.getByLabel('New note beat').fill('1')
  await page.getByLabel('New note duration in beats').fill('0.5')
  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  await sleep(500)
  const addedRow = rows.filter({ hasText: 'added by you' }).first()
  if (await addedRow.count()) {
    pass('editor: add missing note appears in the active list', (await addedRow.textContent() ?? '').replace(/\s+/g, ' ').trim())
    await addedRow.getByRole('button', { name: /^Remove / }).click()
  } else {
    const text = (await review.textContent() ?? '').replace(/\s+/g, ' ').trim()
    fail('editor: add missing note appears in the active list', text.slice(0, 500))
  }
  await sleep(300)
  const addedRemoved = review.locator('.audio-vision-note-removed li').filter({ hasText: 'added note' }).first()
  if (await addedRemoved.count()) {
    pass('editor: added note can be removed')
    await addedRemoved.getByRole('button', { name: /Undo removal/i }).click()
  } else {
    fail('editor: added note can be removed', 'no removed added note')
  }
  await sleep(300)
  if (await rows.filter({ hasText: 'added by you' }).count()) pass('editor: undo restores the added note')
  else fail('editor: undo restores the added note', 'not restored')

  await review.getByRole('button', { name: /Clear all corrections/i }).last().click()
  await sleep(500)
  const summaryAfterClear = (await review.locator('summary').textContent() ?? '').replace(/\s+/g, ' ').trim()
  if (!/edited|added/.test(summaryAfterClear)) pass('editor: clear all resets edits and additions', summaryAfterClear)
  else fail('editor: clear all resets edits and additions', summaryAfterClear)

  // Final durable edits: one pitch correction and one missing note.
  if (!(await rows.first().getByRole('button', { name: '+1', exact: true }).count())) {
    await rows.first().getByRole('button', { name: /^Edit / }).click()
  }
  await rows.first().getByRole('button', { name: '+1', exact: true }).click()
  await sleep(300)
  const finalEditedText = (await rows.first().textContent() ?? '').replace(/\s+/g, ' ').trim()
  const finalEditedMidi = noteNameToMidi((finalEditedText.match(/^(\S+)/) ?? [])[1])
  await page.getByLabel('New note pitch').fill('C7')
  await page.getByLabel('New note bar').fill('5')
  await page.getByLabel('New note beat').fill('1')
  await page.getByLabel('New note duration in beats').fill('0.5')
  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  await sleep(500)

  const tempoInput = page.locator('#audio-vision-tempo')
  const oldTempo = Number(await tempoInput.inputValue())
  await tempoInput.fill(String(Math.max(30, Math.min(300, oldTempo + 8))))
  await page.getByRole('button', { name: /Rebuild with this tempo/i }).click()
  await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 300000 })
  const reviewAfterTempo = await openReview(page)
  const summaryAfterTempo = (await reviewAfterTempo.locator('summary').textContent() ?? '').replace(/\s+/g, ' ').trim()
  const staleAfterTempo = await reviewAfterTempo.getByText(/no longer match/i).count()
  if (!staleAfterTempo && /edited/.test(summaryAfterTempo) && /added/.test(summaryAfterTempo)) {
    pass('editor: corrections survive a tempo rebuild', summaryAfterTempo)
  } else {
    fail('editor: corrections survive a tempo rebuild', `stale=${staleAfterTempo} summary=${summaryAfterTempo}`)
  }

  await page.screenshot({ path: join(outDir, 'review-editor.png') }).catch(() => {})
  await openPractice(page)
  const modes = await page.evaluate(() => [...document.querySelectorAll('.workspace-modes [role="radio"]')].map((el) => el.textContent?.trim()).filter(Boolean))
  if (['Preview', 'Play Along', 'Wait For You'].every((name) => modes.includes(name))) pass('editor: corrected score offers all three practice modes', JSON.stringify(modes))
  else fail('editor: corrected score offers all three practice modes', JSON.stringify(modes))
  const play = page.getByRole('button', { name: /^play \(space\)$/i }).first()
  if (await play.count()) {
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find((el) => /^play \(space\)$/i.test(el.getAttribute('aria-label') ?? ''))
      return button && !button.disabled
    }, null, { timeout: 30000 }).catch(() => {})
    await play.click()
    const paused = await page.getByRole('button', { name: /^pause \(space\)$/i }).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
    if (paused) {
      pass('editor: corrected score playback starts')
      await page.getByRole('button', { name: /^pause \(space\)$/i }).first().click().catch(() => {})
    } else {
      fail('editor: corrected score playback starts', 'no pause state')
    }
  } else {
    fail('editor: corrected score playback starts', 'no Play button')
  }
  const engraving = await page.evaluate(() => {
    const container = document.querySelector('.osmd-score__container[data-osmd-ready="true"]')
    const svg = container?.querySelector('svg')
    return {
      svg: Boolean(svg),
      staveNotes: svg?.querySelectorAll('g.vf-stavenote').length ?? 0,
      measures: svg?.querySelectorAll('g.vf-measure').length ?? 0,
    }
  })
  if (engraving.svg && engraving.staveNotes > 0) pass('editor: corrected score is engraved by OSMD', JSON.stringify(engraving))
  else fail('editor: corrected score is engraved by OSMD', JSON.stringify(engraving))
  await page.screenshot({ path: join(outDir, 'practice-edited.png') }).catch(() => {})
  await page.getByRole('radio', { name: /wait for you/i }).first().click()
  await sleep(1200)
  const wfy = await page.evaluate(() => ({
    mode: document.querySelector('.practice-workspace')?.getAttribute('data-mode'),
    yourTurn: Boolean(document.querySelector('.workspace-your-turn')),
  }))
  if (wfy.mode === 'wait-for-you' && wfy.yourTurn) pass('editor: Wait For You initializes with a corrected-score target')
  else fail('editor: Wait For You initializes with a corrected-score target', JSON.stringify(wfy))
  await page.getByRole('radio', { name: /preview/i }).first().click().catch(() => {})
  await sleep(300)
  const xml = await readPersistedMusicXml(page)
  const arrangement = await readArrangementMeta(page)
  if (xml) {
    const parsed = parseMusicXml(xml, 'note-editor.musicxml')
    const midis = parsed.notes.filter((note) => !note.isRest).map((note) => note.midi)
    const checkpoints = buildNoteCheckpoints(parsed).length
    if (midis.includes(96)) pass('editor: added C7 is in the persisted MusicXML', `midis=${midis.length} checkpoints=${checkpoints}`)
    else fail('editor: added C7 is in the persisted MusicXML', JSON.stringify(midis.slice(0, 40)))
    if (finalEditedMidi != null && midis.includes(finalEditedMidi)) pass('editor: pitch-edited note is in the persisted MusicXML', `midi=${finalEditedMidi}`)
    else fail('editor: pitch-edited note is in the persisted MusicXML', `expected=${finalEditedMidi} midis=${JSON.stringify(midis.slice(0, 40))}`)
    if (checkpoints > 0) pass('editor: persisted score has practice checkpoints', String(checkpoints))
    else fail('editor: persisted score has practice checkpoints', '0')
  } else {
    fail('editor: persisted MusicXML is readable', 'no XML')
  }
  if (arrangement?.corrections) {
    const notes = Object.keys(arrangement.corrections.notes ?? {}).length
    const added = arrangement.corrections.added?.length ?? 0
    if (notes > 0 && added > 0 && (arrangement.correctionsEdited ?? 0) > 0 && (arrangement.correctionsAdded ?? 0) > 0) {
      pass('editor: correction record travels with the saved score', JSON.stringify({ notes, added, editedCount: arrangement.correctionsEdited, addedCount: arrangement.correctionsAdded }))
    } else {
      fail('editor: correction record travels with the saved score', JSON.stringify(arrangement))
    }
  } else {
    fail('editor: correction record travels with the saved score', 'no arrangement metadata')
  }

  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.osmd-score__container[data-osmd-ready="true"]').first().waitFor({ state: 'visible', timeout: 90000 })
  const xmlAfterReload = await readPersistedMusicXml(page)
  const arrangementAfterReload = await readArrangementMeta(page)
  if (xmlAfterReload && arrangementAfterReload?.corrections?.added?.length > 0) {
    pass('editor: corrected score and correction record survive reload')
  } else {
    fail('editor: corrected score and correction record survive reload', `xml=${Boolean(xmlAfterReload)} added=${arrangementAfterReload?.corrections?.added?.length ?? 0}`)
  }

  if (!report.consoleErrors.length && !report.pageErrors.length) pass('editor: no application console or page errors')
  else fail('editor: no application console or page errors', JSON.stringify({ console: report.consoleErrors.slice(0, 3), page: report.pageErrors.slice(0, 3) }))
} catch (error) {
  fail('editor flow completed', error?.stack ?? String(error))
} finally {
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  await server.close()
}

console.log(`\npass=${report.passes.length} fail=${report.failures.length} consoleErrors=${report.consoleErrors.length} pageErrors=${report.pageErrors.length}`)
process.exit(report.failures.length ? 1 : 0)
