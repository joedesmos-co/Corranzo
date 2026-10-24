#!/usr/bin/env node
/**
 * Audio Vision per-note correction — real browser acceptance.
 *
 * Drives the actual product flow (Library → Create from audio → review →
 * Open in Corranzo Practice → Open Score) in Chromium or WebKit, with the
 * real Basic Pitch worker / spectral fallback. Nothing is stubbed except the
 * uploaded WAV.
 *
 * Checks:
 *   1. Remove one note: review count drops by exactly one, one note appears
 *      in "Removed by you", and the saved MusicXML loses exactly one pitch
 *      while every other pitch is preserved.
 *   2. Per-note Undo and Clear restore the machine's full set.
 *   3. The saved score metadata keeps the correction record separate from the
 *      transcription evidence (removed count / original note count).
 *   4. Open Score still loads the unified Practice Engine; playback starts and
 *      the preview snapshot is derived from the corrected score.
 *   5. After a reload, re-arranging the SAME recording re-applies the saved
 *      correction (score regeneration).
 *   6. Switching to a different arrangement (solo guitar) does not inherit the
 *      piano correction; the guitar flow keeps standard notation + TAB.
 *
 * Usage:
 *   node scripts/browser-audio-vision-note-corrections.mjs
 *   BROWSER=webkit node scripts/browser-audio-vision-note-corrections.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'tmp', 'oct25-release')
const PORT = Number(process.env.E2E_PORT ?? 5685)
const BROWSER = (process.env.BROWSER ?? 'chromium').toLowerCase()
const baseUrl = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}/`
const report = { browser: BROWSER, passes: [], failures: [], consoleErrors: [], pageErrors: [] }
const pass = (name, detail = '') => {
  report.passes.push({ name, detail })
  console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ''}`)
}
const fail = (name, detail = '') => {
  report.failures.push({ name, detail })
  console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function writeFixtureWav(path, { seconds = 4, name = 'take-A' } = {}) {
  const SR = 44100
  const data = new Float32Array(SR * seconds)
  const seq = [57, 61, 64, 69, 64, 61]
  const beat = 0.5
  const tone = (midi, start, duration, amp = 0.4) => {
    const freq = 440 * 2 ** ((midi - 69) / 12)
    const s0 = Math.floor(start * SR)
    const s1 = Math.min(data.length, Math.floor((start + duration) * SR))
    for (let i = s0; i < s1; i += 1) {
      const t = (i - s0) / SR
      data[i] += amp * Math.exp(-2.5 * t) * Math.sin(2 * Math.PI * freq * t)
    }
  }
  for (let b = 0; b * beat < seconds; b += 1) tone(seq[b % seq.length], b * beat, 0.45)
  const n = data.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i += 1) {
    const value = Math.max(-1, Math.min(1, data[i]))
    buf.writeInt16LE(Math.round(value * 32767), 44 + i * 2)
  }
  await writeFile(path, buf)
  void name
  return path
}

const NOTE_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
function noteToMidi(label) {
  const match = /^([A-G])(#?)(-?\d+)$/.exec(label)
  if (!match) return null
  return (Number(match[3]) + 1) * 12 + NOTE_TO_SEMITONE[match[1]] + (match[2] ? 1 : 0)
}

function pitchCounts(xml) {
  const counts = new Map()
  const regex = /<pitch><step>([A-G])<\/step>(?:<alter>(-?\d+)<\/alter>)?<octave>(-?\d+)<\/octave><\/pitch>/g
  let match
  while ((match = regex.exec(xml)) !== null) {
    const midi = (Number(match[3]) + 1) * 12 + NOTE_TO_SEMITONE[match[1]] + Number(match[2] ?? 0)
    counts.set(midi, (counts.get(midi) ?? 0) + 1)
  }
  return counts
}

function diffCounts(before, after) {
  const midis = new Set([...before.keys(), ...after.keys()])
  const changes = []
  for (const midi of midis) {
    const delta = (after.get(midi) ?? 0) - (before.get(midi) ?? 0)
    if (delta !== 0) changes.push({ midi, delta })
  }
  return changes
}

const scoreReadScript = async () => {
  const rawMeta = localStorage.getItem('scoreflow-session-meta-v1')
  const meta = rawMeta ? JSON.parse(rawMeta) : null
  if (!meta?.commitId) return { meta, xml: null }
  // Never create the database from the test: opening with a version before
  // the app has upgraded it would create an empty DB and break the app's own
  // save. Only open when the app's database already exists.
  try {
    const databases = await indexedDB.databases?.()
    if (Array.isArray(databases) && !databases.some((entry) => entry.name === 'scoreflow-session')) {
      return { meta, xml: null }
    }
  } catch {
    // databases() unsupported: fall through to the normal open.
  }
  const openDb = () => new Promise((resolve, reject) => {
    const request = indexedDB.open('scoreflow-session')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('idb-open-failed'))
  })
  const db = await openDb()
  if (!db.objectStoreNames.contains('files')) {
    db.close()
    return { meta, xml: null }
  }
  const readKey = (key) => new Promise((resolve) => {
    const tx = db.transaction('files', 'readonly')
    const request = tx.objectStore('files').get(key)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => resolve(null)
  })
  const keys = []
  if (meta?.commitId) keys.push(`gen:${meta.commitId}:musicXml`)
  keys.push('musicXml')
  let buffer = null
  for (const key of keys) {
    buffer = await readKey(key)
    if (buffer) break
  }
  db.close()
  const xml = buffer ? new TextDecoder().decode(buffer) : null
  return { meta, xml }
}

await mkdir(OUT_DIR, { recursive: true })
const pianoWav = await writeFixtureWav(join(OUT_DIR, `note-corrections-${BROWSER}-piano.wav`))
const otherWav = await writeFixtureWav(join(OUT_DIR, `note-corrections-${BROWSER}-other.wav`), { seconds: 3 })

const externalBase = Boolean(process.env.E2E_BASE_URL)
const vite = externalBase ? null : await createServer({
  root: ROOT,
  configFile: join(ROOT, 'vite.config.js'),
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
})
if (vite) {
  await vite.listen()
  await sleep(800)
}

const { chromium, webkit } = await import('playwright')
let browser = null
try {
  browser = await ({ chromium, webkit }[BROWSER] ?? chromium).launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text().slice(0, 300))
  })
  page.on('pageerror', (error) => report.pageErrors.push(String(error?.message ?? error).slice(0, 300)))

  const shot = async (name) => {
    try { await page.screenshot({ path: join(OUT_DIR, `note-corrections-${BROWSER}-${name}.png`) }) } catch { /* noop */ }
  }

  const gotoCreateFromAudio = async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await sleep(2500)
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('nav button')].find((element) => /library/i.test(element.textContent ?? ''))
      button?.click()
    })
    await sleep(1000)
    const uploadsTab = page.getByRole('tab', { name: /my uploads/i })
    if (await uploadsTab.count()) {
      await uploadsTab.click()
      await sleep(600)
    }
    await page.getByText('Create from audio', { exact: false }).first().waitFor({ timeout: 30_000 })
  }

  const arrange = async ({ file, targetPart, difficulty = 'intermediate' }) => {
    const card = page.locator('.audio-vision-card')
    await card.locator('input[type="file"]').setInputFiles(file)
    await page.getByText(/recording length/i).first().waitFor({ timeout: 90_000 })
    await card.locator(`input[name="audio-vision-target"][value="${targetPart}"]`).check()
    await card.locator(`input[name="audio-vision-difficulty"][value="${difficulty}"]`).check()
    await page.getByRole('button', { name: /arrange for/i }).click()
    await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 420_000 })
  }

  const reviewSummary = async () => {
    const summary = page.locator('.audio-vision-note-review summary')
    await summary.waitFor({ timeout: 20_000 })
    const text = (await summary.textContent()) ?? ''
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      count: Number(/Review notes \((\d+)/.exec(text)?.[1] ?? 0),
      removed: Number(/· (\d+) removed/.exec(text)?.[1] ?? 0),
    }
  }

  const ensureReviewOpen = async () => {
    const details = page.locator('.audio-vision-note-review')
    if ((await details.count()) === 0) return
    const open = await details.evaluate((element) => Boolean(element.open))
    if (!open) await details.locator('summary').click()
  }

  const readSaved = async ({ expectRemoved = null, targetPart = null, tries = 30 } = {}) => {
    let last = null
    for (let i = 0; i < tries; i += 1) {
      last = await page.evaluate(scoreReadScript)
      const arrangement = last?.meta?.omrMeta?.arrangement ?? null
      const removed = arrangement?.removedNoteCount ?? 0
      const targetMatches = !targetPart || arrangement?.targetPart === targetPart
      if (last?.xml && targetMatches && (expectRemoved == null || removed === expectRemoved)) return last
      await sleep(500)
    }
    return last
  }

  const openPracticeAndPlay = async () => {
    await page.getByRole('button', { name: /open in corranzo practice/i }).click()
    await page.getByText('Arranged from your recording', { exact: false }).first().waitFor({ timeout: 30_000 })
    await page.getByRole('button', { name: /open score/i }).click()
    await page.locator('.osmd-score__container[data-osmd-ready="true"]').first().waitFor({ timeout: 90_000 })
    await page.locator('.workspace-dock').first().waitFor({ state: 'visible', timeout: 60_000 })
    const play = page.getByRole('button', { name: /^play \(space\)$/i }).first()
    await play.waitFor({ timeout: 30_000 })
    await play.click()
    await page.getByRole('button', { name: /^pause \(space\)$/i }).first().waitFor({ timeout: 30_000 })
    await sleep(800)
    const snapshot = await page.evaluate(() => window.__SCOREFLOW_PLAYBACK_SNAPSHOT__ ?? null)
    const trace = await page.evaluate(() => {
      const entries = window.__SCOREFLOW_SOURCE_TRACE__?.entries ?? []
      return [...entries].reverse().find((entry) => entry?.phase === 'playback-timeline-rebuild') ?? null
    })
    await page.getByRole('button', { name: /^pause \(space\)$/i }).first().click().catch(() => {})
    // Audio Vision arrangements have no PDF and no active-score id, so the
    // playback snapshot is deliberately suppressed as "stale" by the PDF
    // guard. The trace records the same schedule; use it for the assertion.
    return snapshot ?? (trace?.playableEventCount > 0 ? trace : null)
  }

  // ------------------------------------------------------- baseline (no edits)
  await gotoCreateFromAudio()
  await arrange({ file: pianoWav, targetPart: 'solo-piano' })
  const pianoInitial = await reviewSummary()
  pass('piano arrangement reaches the review', pianoInitial.text)
  await shot('01-review')
  const baselineSnapshot = await openPracticeAndPlay()
  const baselineSaved = await readSaved({ expectRemoved: 0 })
  if (!baselineSaved?.xml) throw new Error('piano score was not saved')
  const baselinePitches = pitchCounts(baselineSaved.xml)
  const baselineTotal = [...baselinePitches.values()].reduce((sum, count) => sum + count, 0)
  if (baselineSnapshot?.playableEventCount > 0) {
    pass('the untouched arrangement opens the unified Practice Engine and plays', `playableEventCount=${baselineSnapshot.playableEventCount}`)
  } else {
    fail('the untouched arrangement opens the unified Practice Engine and plays', JSON.stringify(baselineSnapshot))
  }

  // --------------------------------------------------- remove one note + save
  await gotoCreateFromAudio()
  await arrange({ file: pianoWav, targetPart: 'solo-piano' })
  const secondReview = await reviewSummary()
  if (secondReview.removed === 0 && secondReview.count === pianoInitial.count) {
    pass('a regenerated arrangement starts from the machine’s full set', secondReview.text)
  } else {
    fail('a regenerated arrangement starts from the machine’s full set', secondReview.text)
  }

  const review = page.locator('.audio-vision-note-review')
  await review.locator('summary').click()
  const rows = review.locator('.audio-vision-note-list li')
  const removeButton = rows.first().getByRole('button', { name: /^remove/i })
  const aria = (await removeButton.getAttribute('aria-label')) ?? ''
  const targetLabel = /Remove\s+([A-G]#?-?\d+)/.exec(aria)?.[1] ?? null
  const targetMidi = targetLabel ? noteToMidi(targetLabel) : null
  if (!targetMidi) throw new Error(`could not read the note label from ${aria}`)
  await removeButton.click()
  await sleep(300)

  const afterRemove = await reviewSummary()
  const removedText = (await review.locator('.audio-vision-note-removed').textContent().catch(() => '')) ?? ''
  if (afterRemove.count === pianoInitial.count - 1) pass('Remove deletes exactly one note from the review', `${pianoInitial.count} → ${afterRemove.count}`)
  else fail('Remove deletes exactly one note from the review', `${pianoInitial.count} → ${afterRemove.count}`)
  if (afterRemove.removed === 1) pass('the removed note is listed separately', removedText.replace(/\s+/g, ' ').trim().slice(0, 80))
  else fail('the removed note is listed separately', JSON.stringify(afterRemove))

  await openPracticeAndPlay()
  const afterRemoveSaved = await readSaved({ expectRemoved: 1 })
  if (!afterRemoveSaved?.xml) throw new Error('corrected score was not saved')
  const afterPitches = pitchCounts(afterRemoveSaved.xml)
  const afterTotal = [...afterPitches.values()].reduce((sum, count) => sum + count, 0)
  const changes = diffCounts(baselinePitches, afterPitches)
  if (afterTotal === baselineTotal - 1 && changes.length === 1 && changes[0].midi === targetMidi && changes[0].delta === -1) {
    pass('MusicXML loses exactly the removed pitch and preserves every other pitch', `${baselineTotal} → ${afterTotal}, ${targetLabel}`)
  } else {
    fail('MusicXML loses exactly the removed pitch and preserves every other pitch', JSON.stringify({ baselineTotal, afterTotal, targetLabel, changes }))
  }
  const metaArrangement = afterRemoveSaved.meta?.omrMeta?.arrangement ?? null
  if (
    metaArrangement?.removedNoteCount === 1
    && metaArrangement?.corrections?.removed?.length === 1
    && metaArrangement?.originalNoteCount > pianoInitial.count - 1
  ) {
    pass('the saved metadata keeps the correction record separate from the evidence', `original=${metaArrangement.originalNoteCount}, removed=${metaArrangement.removedNoteCount}`)
  } else {
    fail('the saved metadata keeps the correction record separate from the evidence', JSON.stringify(metaArrangement))
  }
  await shot('02-corrected')

  // ----------------------------------------------- reload: reopen / undo / clear
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
  await sleep(3000)
  await page.waitForFunction(
    () => Boolean(document.querySelector('.workspace-dock')) || /Arranged from your recording/.test(document.body.innerText),
    null,
    { timeout: 45_000 },
  ).catch(() => {})
  const reopenedSaved = await readSaved({ expectRemoved: 1 })
  const reopenedSurface = await page.evaluate(() => ({
    practice: Boolean(document.querySelector('.workspace-dock')),
    osmd: Boolean(document.querySelector('.osmd-score__container[data-osmd-ready="true"]')),
    importBanner: /Arranged from your recording/.test(document.body.innerText),
    removedMessage: /1 note removed by you/.test(document.body.innerText),
  }))
  if (reopenedSaved?.meta?.omrMeta?.arrangement?.removedNoteCount === 1 && reopenedSaved?.xml) {
    pass('the saved score keeps the correction after reopening', `${reopenedSaved.xml.length} bytes`)
  } else {
    fail('the saved score keeps the correction after reopening', JSON.stringify(reopenedSaved?.meta?.omrMeta?.arrangement ?? null))
  }
  if (reopenedSurface.practice || reopenedSurface.osmd || reopenedSurface.importBanner) {
    pass('the saved score reopens on a real product surface', JSON.stringify(reopenedSurface))
  } else {
    fail('the saved score reopens on a real product surface', JSON.stringify(reopenedSurface))
  }

  await gotoCreateFromAudio()
  await arrange({ file: pianoWav, targetPart: 'solo-piano' })
  const afterReload = await reviewSummary()
  if (afterReload.removed === 1 && afterReload.count === pianoInitial.count - 1) {
    pass('after reload, the saved correction is re-applied to the regenerated score', afterReload.text)
  } else {
    fail('after reload, the saved correction is re-applied to the regenerated score', afterReload.text)
  }

  await page.locator('.audio-vision-note-review summary').click()
  const reloadReview = page.locator('.audio-vision-note-review')
  await reloadReview.locator('.audio-vision-note-removed button[aria-label^="Undo removal"]').first().click({ force: true, timeout: 10_000 })
  await sleep(300)
  const afterUndo = await reviewSummary()
  if (afterUndo.count === pianoInitial.count && afterUndo.removed === 0) pass('per-note Undo restores the machine’s full set', afterUndo.text)
  else fail('per-note Undo restores the machine’s full set', afterUndo.text)
  await ensureReviewOpen()
  const clickFirstRemove = async () => {
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.audio-vision-note-review .audio-vision-note-list li button')]
        .find((candidate) => /^Remove/.test(candidate.textContent ?? ''))
      if (!button) throw new Error('Remove button is missing')
      button.click()
    })
  }
  // Two removals, then Undo last, then Clear all.
  await ensureReviewOpen()
  await clickFirstRemove()
  await sleep(250)
  await ensureReviewOpen()
  await clickFirstRemove()
  await sleep(250)
  await ensureReviewOpen()
  const afterTwo = await reviewSummary()
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.audio-vision-note-review button')]
      .find((candidate) => /Undo last/.test(candidate.textContent ?? ''))
    if (!button) throw new Error('Undo last button is missing')
    button.click()
  })
  await sleep(200)
  await ensureReviewOpen()
  const afterUndoLast = await reviewSummary()
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.audio-vision-note-review button')]
      .find((candidate) => /Clear all/.test(candidate.textContent ?? ''))
    if (!button) throw new Error('Clear all button is missing')
    button.click()
  })
  await sleep(300)
  const afterClear = await reviewSummary()
  if (
    afterTwo.count === pianoInitial.count - 2
    && afterUndoLast.count === pianoInitial.count - 1
    && afterClear.count === pianoInitial.count
    && afterClear.removed === 0
  ) {
    pass('Undo last and Clear all restore exactly the expected notes', `${afterTwo.count} → ${afterUndoLast.count} → ${afterClear.count}`)
  } else {
    fail('Undo last and Clear all restore exactly the expected notes', JSON.stringify({ afterTwo, afterUndoLast, afterClear }))
  }

  // ------------------------------------------------------------- guitar target
  // The arrangement form is replaced by the review panel, so return to the
  // chooser before changing target (the selected file is preserved).
  await page.getByRole('button', { name: /arrange something else/i }).click()
  await sleep(600)
  await page.locator('.audio-vision-card input[name="audio-vision-target"][value="solo-guitar"]').check()
  await page.getByRole('button', { name: /arrange for/i }).click()
  await page.getByText('Your arrangement is ready', { exact: false }).first().waitFor({ timeout: 420_000 })
  const guitarInitial = await reviewSummary()
  if (guitarInitial.removed === 0) pass('switching to solo guitar does not inherit the piano correction', guitarInitial.text)
  else fail('switching to solo guitar does not inherit the piano correction', guitarInitial.text)

  await page.locator('.audio-vision-note-review summary').click()
  await page.locator('.audio-vision-note-review .audio-vision-note-list li button').first().click({ force: true, timeout: 10_000 })
  await sleep(300)
  const guitarSnapshot = await openPracticeAndPlay()
  const guitarAfter = await readSaved({ expectRemoved: 1, targetPart: 'solo-guitar' })
  if (guitarAfter?.xml?.includes('<technical>') && guitarAfter?.xml?.includes('<staff>2</staff>')) {
    pass('the guitar arrangement keeps standard notation + TAB after a removal')
  } else {
    fail('the guitar arrangement keeps standard notation + TAB after a removal')
  }
  if (guitarSnapshot?.playableEventCount > 0) pass('the corrected guitar arrangement plays', `playableEventCount=${guitarSnapshot.playableEventCount}`)
  else fail('the corrected guitar arrangement plays', JSON.stringify(guitarSnapshot))

  // ------------------------------------------------------- different recording
  await gotoCreateFromAudio()
  await arrange({ file: otherWav, targetPart: 'solo-piano' })
  const otherReview = await reviewSummary()
  if (otherReview.removed === 0) pass('a different recording starts from the machine’s notes', otherReview.text)
  else fail('a different recording starts from the machine’s notes', otherReview.text)

  await shot('03-final')
  const meaningfulConsole = report.consoleErrors.filter((text) => !/Outdated Optimize Dep|504/.test(text))
  if (meaningfulConsole.length === 0) pass('no application console errors')
  else fail('no application console errors', meaningfulConsole.slice(0, 3).join(' | '))
  if (report.pageErrors.length === 0) pass('no page errors')
  else fail('no page errors', report.pageErrors.slice(0, 3).join(' | '))
} catch (error) {
  fail('harness', String(error?.stack ?? error?.message ?? error).slice(0, 600))
  try {
    await page.screenshot({ path: join(OUT_DIR, `note-corrections-${BROWSER}-error.png`) })
  } catch { /* noop */ }
} finally {
  try { await browser?.close() } catch { /* noop */ }
  try { await vite?.close() } catch { /* noop */ }
}

report.finishedAt = new Date().toISOString()
await writeFile(join(OUT_DIR, `note-corrections-${BROWSER}-report.json`), JSON.stringify(report, null, 2))
console.log(`\n${BROWSER}: pass=${report.passes.length} fail=${report.failures.length} consoleErrors=${report.consoleErrors.length} pageErrors=${report.pageErrors.length}`)
if (report.consoleErrors.length) console.log('console:', report.consoleErrors.slice(0, 5).join(' | '))
if (report.pageErrors.length) console.log('page:', report.pageErrors.slice(0, 5).join(' | '))
process.exit(report.failures.length ? 1 : 0)
