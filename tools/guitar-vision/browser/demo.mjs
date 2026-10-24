import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { recognizePdf } from './guitar-vision.mjs'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const input = document.getElementById('pdf')
const run = document.getElementById('run')
const status = document.getElementById('status')
const dl = document.getElementById('dl')
const score = document.getElementById('score')

run.addEventListener('click', async () => {
  const file = input.files && input.files[0]
  if (!file) { status.textContent = 'Choose a PDF first.'; return }
  run.disabled = true
  status.textContent = 'Reading PDF…'
  try {
    const data = new Uint8Array(await file.arrayBuffer())
    const t0 = performance.now()
    const res = await recognizePdf(data, { dpi: 150 })
    const dt = Math.round(performance.now() - t0)
    const s = res.summary
    status.textContent = JSON.stringify({
      file: file.name,
      events: s.events,
      measures: Object.keys(s.barlines || {}).length ? undefined : undefined,
      tab_staves: s.tab_staves.length,
      rhythm_recovered: s.rhythm_recovered,
      playable: s.playable,
      rhythm: s.rhythm,
      runtime_ms: dt,
    }, null, 1)
    const blob = new Blob([res.xml], { type: 'application/xml' })
    dl.href = URL.createObjectURL(blob)
    dl.style.display = 'inline'
    window.__gv = { xml: res.xml, summary: s, events: res.events }

    // Engrave the generated MusicXML (OSMD is a demo-only dependency).
    const mod = await import('opensheetmusicdisplay')
    const osmd = new mod.OpenSheetMusicDisplay(score, { autoResize: true })
    await osmd.load(res.xml)
    osmd.render()
    window.__engraved = score.querySelectorAll('svg').length > 0 ||
      score.textContent.trim().length > 0
    window.__done = true
  } catch (err) {
    status.textContent = 'Failed: ' + (err && err.stack ? err.stack : err)
    window.__done = true
  } finally {
    run.disabled = false
  }
})
