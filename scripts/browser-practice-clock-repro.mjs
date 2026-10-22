#!/usr/bin/env node
/**
 * Practice-clock render-loop reproduction + dispatch attribution (M1).
 *
 * Drives the known trigger set (Play Along + playing + an active microphone,
 * plus mode-switch / seek / pause-resume perturbations) inside a bounded
 * wall-clock window and records:
 *   1. every console message verbatim, so React's own warning text is captured;
 *   2. with --trace, the app frames of EVERY React state dispatch's call stack.
 *
 * React logs "Maximum update depth exceeded" from `nestedPassiveUpdateCount >
 * 50` — a sustained chain of commits, each of which schedules an update from a
 * passive effect. The dispatch recording therefore points at the setter that
 * keeps the chain alive.
 *
 * Instrumentation is TEST-ONLY: product source is never modified on disk, React
 * is not patched to hide anything (the warning still fires unchanged), and the
 * traced setters keep a stable identity via a WeakMap on React's own dispatch
 * function, so no extra referential churn is introduced.
 *
 *   node scripts/browser-practice-clock-repro.mjs [--trace]
 *   WATCH_MS=60000 E2E_PORT=5611 node scripts/browser-practice-clock-repro.mjs --trace
 */
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'practice-clock-repro')
const PORT = Number(process.env.E2E_PORT ?? 5611)
const WATCH_MS = Number(process.env.WATCH_MS ?? 70_000)
const baseUrl = `http://127.0.0.1:${PORT}/?e2e-midi=1`
const TRACE = process.argv.includes('--trace')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function consoleCaptureScript() {
  return `
    (() => {
      const store = (window.__PRACTICE_REPRO__ = window.__PRACTICE_REPRO__ || [])
      const originalError = console.error.bind(console)
      const originalWarn = console.warn.bind(console)
      const push = (level, args) => {
        const parts = []
        for (const arg of args) parts.push(arg instanceof Error ? arg.message : String(arg))
        store.push({ level, at: Date.now(), text: parts.join(' | ').slice(0, 2000) })
      }
      console.error = (...args) => { push('error', args); originalError(...args) }
      console.warn = (...args) => { push('warn', args); originalWarn(...args) }
    })()
  `
}

function dispatchTracerScript() {
  return `
    (() => {
      const buffer = (window.__SETSTATE_TRACE__ = [])
      const counts = (window.__SETSTATE_SIGNATURES__ = {})
      window.__RECORD_DISPATCH__ = () => {
        const stack = new Error().stack || ''
        const frames = stack.split('\\n').slice(1)
          .map((line) => line.trim().replace(/^at\\s+/, ''))
          .filter((line) => /\\/src\\//.test(line))
          .slice(0, 4)
          .map((line) => line.replace(/\\(.*$/, ''))
        const signature = frames.join(' <- ') || '(no app frames)'
        counts[signature] = (counts[signature] ?? 0) + 1
        buffer.push({ signature, at: performance.now() })
        if (buffer.length > 8000) buffer.shift()
      }
    })()
  `
}

/**
 * Test-only transform: route every app `useState` setter through a recorder,
 * keeping a STABLE setter identity (WeakMap on React's own dispatch) so no
 * extra referential churn is introduced.
 *
 * Vite hands the browser two shapes for `import { useState } from 'react'`:
 *   - ESM: `import { useState } from "/node_modules/.vite/deps/react.js?v=..."`
 *   - CJS: `const useState = __vite__cjsImport0_react["useState"];`
 * Both are rewritten to bind the real hook as `ReactHooksUseState` and to expose
 * a traced `useState`. The original module specifier is preserved so the
 * rewritten module still resolves in the browser.
 */
function instrumentModuleSource(source) {
  const importPattern =
    /import\s+(?:([A-Za-z0-9_$]+)\s*,\s*)?(\{[^}]*\})?\s*from\s*(['"])([^'"]*)\3\s*;?/g
  const cjsPattern =
    /(^|[;\s])(?:const\s+)?([A-Za-z0-9_$]+)\s*=\s*(__vite__cjsImport\w*_react)\[(["'])useState\4\]/gm

  const tracer = [
    `const __dispatchTraceCache = new WeakMap()`,
    `const __dispatchLatestValue = new WeakMap()`,
    `const useState = (initial) => {`,
    `  const result = ReactHooksUseState(initial)`,
    `  const raw = result[1]`,
    `  __dispatchLatestValue.set(raw, result[0])`,
    `  let tracedSetter = __dispatchTraceCache.get(raw)`,
    `  if (!tracedSetter) {`,
    `    tracedSetter = (next) => {`,
    `      const previous = __dispatchLatestValue.get(raw)`,
    `      const nextValue = typeof next === 'function' ? next(previous) : next`,
    `      __dispatchLatestValue.set(raw, nextValue)`,
    `      if (!Object.is(previous, nextValue)) {`,
    `        try { if (globalThis.__RECORD_DISPATCH__) globalThis.__RECORD_DISPATCH__('useState') } catch (error) {}`,
    `      }`,
    `      return raw(nextValue)`,
    `    }`,
    `    __dispatchTraceCache.set(raw, tracedSetter)`,
    `  }`,
    `  return [result[0], tracedSetter]`,
    `}`,
  ].join('\n')

  let traced = false

  const rewritten = source.replace(
    importPattern,
    (match, defaultName, named, quote, specifier) => {
      if (!named || !/react/.test(specifier)) {
        return match
      }
      const names = named
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
      if (!names.includes('useState')) {
        return match
      }
      const kept = names.filter((name) => name !== 'useState')
      const parts = []
      if (defaultName) {
        parts.push(defaultName)
      }
      parts.push(`{ useState as ReactHooksUseState${kept.length ? `, ${kept.join(', ')}` : ''} }`)
      traced = true
      return `import ${parts.join(', ')} from ${quote}${specifier}${quote}`
    },
  )

  const cjsRewritten = rewritten.replace(cjsPattern, (match, prefix, name, accessor) => {
    traced = true
    void name
    return `${prefix}const ReactHooksUseState = ${accessor}["useState"]; const useState$raw = ReactHooksUseState`
  })

  if (!traced) {
    return source
  }
  return `${cjsRewritten}\n${tracer}`
}

async function main() {
  await mkdir(outDir, { recursive: true })

  const clip = join(root, 'tmp/unified-practice-mic/mic-melody8.wav')
  try {
    await access(clip)
  } catch {
    console.error('FAIL  missing mic fixture — run node scripts/render-unified-mic-clips.mjs first')
    process.exit(2)
  }

  const viteServer = await createServer({
    root,
    configFile: join(root, 'vite.config.js'),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  })
  await viteServer.listen()
  console.log(`dev server at ${baseUrl}`)

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--use-file-for-fake-audio-capture=${clip}`,
    ],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.grantPermissions(['microphone'], { origin: `http://127.0.0.1:${PORT}` })
  const page = await context.newPage()
  await page.addInitScript(consoleCaptureScript())
  if (TRACE) {
    await page.addInitScript(dispatchTracerScript())
  }

  const counters = { intercepted: 0, instrumented: 0 }
  if (TRACE) {
    // Instrument app modules only (never node_modules / react itself).
    for (const pattern of ['**/src/**/*.js', '**/src/**/*.jsx']) {
      await page.route(pattern, async (route) => {
        const response = await route.fetch()
        const body = await response.text()
        counters.intercepted += 1
        const patched = instrumentModuleSource(body)
        if (patched !== body) {
          counters.instrumented += 1
        }
        await route.fulfill({
          response,
          headers: { ...response.headers(), 'content-type': 'application/javascript' },
          body: patched,
        })
      })
    }
  }

  page.on('pageerror', (error) => {
    console.error(`PAGEERROR ${error.message.slice(0, 200)}`)
  })

  const events = []
  const mark = (label) => {
    events.push({ label, at: Date.now() })
    console.log(`  step: ${label}`)
  }

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.evaluate(async () => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await sleep(1500)
    mark('loaded')

    await page.getByRole('button', { name: 'Library', exact: true }).click().catch(() => {})
    await sleep(800)
    await page.locator('.cz-piece-row').first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const target = buttons.find((button) => {
        if (!/open score|start practice/i.test(button.textContent)) return false
        const row = button.closest('.cz-piece-row')
        return (row ? row.textContent : '').includes('Prelude')
      })
      if (target) target.click()
    })
    await sleep(8000)
    mark('practice-open')

    await page.getByRole('radiogroup', { name: 'Practice mode' })
      .getByRole('radio', { name: 'Wait For You', exact: true }).click()
    await sleep(1500)
    mark('wfy-mode')
    await page.getByRole('button', { name: 'Practice input' }).click()
    await sleep(800)
    await page.getByRole('button', { name: 'Microphone', exact: true }).click()
    await sleep(1000)
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(3000)
    mark('mic-armed')

    await page.getByRole('radiogroup', { name: 'Practice mode' })
      .getByRole('radio', { name: 'Play Along', exact: true }).click()
    await sleep(1500)
    mark('play-along-mode')

    await page.locator('.workspace-play').first().click()
    await sleep(2000)
    const playLabel = await page.evaluate(() => {
      const button = document.querySelector('.workspace-play')
      return button ? button.getAttribute('aria-label') : null
    })
    const playing = /pause/i.test(playLabel ?? '')
    mark(playing ? 'playing' : 'not-playing')

    const deadline = Date.now() + WATCH_MS
    let tick = 0
    while (Date.now() < deadline) {
      tick += 1
      await sleep(2000)
      if (tick % 11 === 0) {
        await page.getByRole('radiogroup', { name: 'Practice mode' })
          .getByRole('radio', { name: 'Wait For You', exact: true }).click().catch(() => {})
        await sleep(900)
        await page.getByRole('radiogroup', { name: 'Practice mode' })
          .getByRole('radio', { name: 'Play Along', exact: true }).click().catch(() => {})
        await sleep(900)
        await page.locator('.workspace-play').first().click().catch(() => {})
        await sleep(600)
        mark(`mode-switch-${tick}`)
      }
      if (tick % 5 === 0) {
        const seekTo = 10 + (tick % 7) * 4
        await page.evaluate((seconds) => {
          const input = document.querySelector('input[aria-label="Score position"]')
          if (!input) return
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          setter?.call(input, String(seconds))
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
        }, seekTo)
        mark(`seek-${tick}`)
      }
      if (tick % 8 === 0) {
        await page.locator('.workspace-play').first().click().catch(() => {})
        await sleep(400)
        await page.locator('.workspace-play').first().click().catch(() => {})
        mark(`pause-resume-${tick}`)
      }
    }

    const heard = await page.evaluate(() => {
      const debug = window.__SCOREFLOW_MIC_DEBUG__
      return (debug?.lastDetectedMidis ?? []).join(',') || null
    })
    mark(`done heard=${heard}`)

    const captured = await page.evaluate(() => window.__PRACTICE_REPRO__ ?? [])
    const depthWarnings = captured.filter((entry) => /Maximum update depth/.test(entry.text))
    const otherErrors = captured.filter(
      (entry) => entry.level === 'error' && !/Maximum update depth/.test(entry.text),
    )

    const trace = TRACE
      ? await page.evaluate(() => ({
          signatures: window.__SETSTATE_SIGNATURES__ ?? {},
          recent: window.__SETSTATE_TRACE__ ?? [],
          recorderPresent: typeof window.__RECORD_DISPATCH__,
        }))
      : null
    if (TRACE) {
      console.log(
        `[trace] intercepted=${counters.intercepted} instrumented=${counters.instrumented} recorder=${trace?.recorderPresent}`,
      )
    }

    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl,
      watchMs: WATCH_MS,
      trace: TRACE,
      playing,
      heard,
      steps: events,
      depthWarningCount: depthWarnings.length,
      depthWarnings: depthWarnings.slice(0, 10).map((entry) => ({
        at: entry.at,
        text: entry.text,
      })),
      otherErrorCount: otherErrors.length,
      otherErrors: otherErrors.slice(0, 10).map((entry) => entry.text.slice(0, 200)),
      dispatchSignatures: trace?.signatures ?? null,
    }
    await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
    await writeFile(
      join(outDir, 'console.jsonl'),
      captured.map((entry) => JSON.stringify(entry)).join('\n'),
    )
    if (trace) {
      await writeFile(join(outDir, 'dispatches.json'), JSON.stringify(trace.recent, null, 2))
      const ranked = Object.entries(trace.signatures).sort((a, b) => b[1] - a[1])
      await writeFile(
        join(outDir, 'signatures.txt'),
        ranked.map(([sig, count]) => `${count}x  ${sig}`).join('\n'),
      )
      console.log('\n--- dispatch signatures (caller app frames) ---')
      for (const [sig, count] of ranked.slice(0, 20)) {
        console.log(`${String(count).padStart(6)}x  ${sig}`)
      }
    }

    console.log(`\ndepthWarnings=${report.depthWarningCount} otherErrors=${report.otherErrorCount} heard=${heard}`)
    if (depthWarnings.length) {
      console.error(`REPRODUCED  ${depthWarnings.length}x Maximum update depth exceeded`)
      process.exitCode = 3
    } else {
      console.log('NOT REPRODUCED  zero update-depth warnings in this window')
    }
  } finally {
    await page.screenshot({ path: join(outDir, 'state.png') }).catch(() => {})
    await browser.close().catch(() => {})
    await viteServer.close().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
