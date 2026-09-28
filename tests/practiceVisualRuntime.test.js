import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { InstrumentProvider } from '../src/context/InstrumentContext.jsx'
import { ProfileStatsProvider } from '../src/context/ProfileStatsContext.jsx'
import {
  PracticeSessionProvider,
  usePracticeVisualSession,
} from '../src/context/PracticeSessionContext.jsx'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
globalThis.React = React

describe('Practice visual runtime integration', () => {
  let viteServer
  let browser
  let baseUrl

  beforeAll(async () => {
    viteServer = await createServer({
      root: projectRoot,
      configFile: resolve(projectRoot, 'vite.config.js'),
      logLevel: 'silent',
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
      },
    })
    await viteServer.listen()
    const address = viteServer.httpServer.address()
    baseUrl = `http://127.0.0.1:${address.port}`
    browser = await chromium.launch({ headless: true })
  }, 30_000)

  afterAll(async () => {
    await browser?.close()
    await viteServer?.close()
  })

  it('initializes the real provider and exposes the PDF page-size setter', () => {
    let visualValue = null

    function VisualContextProbe() {
      visualValue = usePracticeVisualSession()
      return createElement('output', null, typeof visualValue.setPdfPageSizes)
    }

    const markup = renderToStaticMarkup(
      createElement(
        InstrumentProvider,
        { initialInstrumentId: 'piano' },
        createElement(
          ProfileStatsProvider,
          null,
          createElement(
            PracticeSessionProvider,
            {
              activeView: 'library',
              midiSource: null,
              musicXmlSource: null,
              pdfMeta: null,
              pdfFile: null,
              pdfFileName: null,
              hasPdf: false,
              sessionFilesReady: false,
            },
            createElement(VisualContextProbe),
          ),
        ),
      ),
    )

    expect(markup).toContain('<output>function</output>')
    expect(visualValue.pdfPageSizes).toBeNull()
    expect(visualValue.setPdfPageSizes).toBeTypeOf('function')
  })

  it('opens Practice and survives Score -> Visual -> Score in a real browser', async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    const runtimeFailures = []

    page.on('pageerror', (error) => runtimeFailures.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeFailures.push(message.text())
    })
    await page.addInitScript(() => localStorage.clear())

    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
      const skipTutorial = page.getByRole('button', { name: 'Skip', exact: true })
      if (await skipTutorial.isVisible()) await skipTutorial.click()
      await page.getByRole('button', { name: 'Open score: Menuet in F, K.2' }).first().click()
      await page.getByRole('main', { name: 'Score workspace' }).waitFor()

      const inputChoice = page.getByRole('button', { name: 'Use MIDI Keyboard' })
      if (await inputChoice.isVisible()) await inputChoice.click()

      const scoreButton = page.getByRole('button', { name: 'Score', exact: true })
      const visualButton = page.getByRole('button', { name: 'Note guide', exact: true })
      await expect.poll(() => scoreButton.getAttribute('aria-pressed')).toBe('true')
      await page.locator('.pdf-page-window__slot--active canvas').first().waitFor({ timeout: 15_000 })
      expect(await page.getByRole('alert').count()).toBe(0)

      await visualButton.click()
      await expect.poll(() => visualButton.getAttribute('aria-pressed')).toBe('true')
      const reconstructedLane = page.locator('.staff-lane, .tab-lane')
      await reconstructedLane.waitFor()
      expect(await page.locator('.source-pdf-visual-lane').count()).toBe(0)
      expect(await reconstructedLane.locator('canvas').count()).toBe(0)
      expect(await reconstructedLane.locator('[data-score-follow-bar="true"]').count()).toBe(1)
      expect(await page.getByRole('alert').count()).toBe(0)

      const playAlong = page.getByRole('radio', { name: 'Play Along', exact: true })
      const waitForYou = page.getByRole('radio', { name: 'Wait For You', exact: true })
      if (!(await playAlong.isChecked())) {
        await page.getByRole('radiogroup', { name: 'Practice mode' }).getByText('Play Along', { exact: true }).click()
      }
      await expect.poll(() => playAlong.isChecked()).toBe(true)
      expect(await page.locator('[data-practice-note-mode="play-along"]').count()).toBe(0)
      expect(await page.locator('.source-pdf-visual-lane__highlight--play-along').count()).toBe(0)
      await page.getByRole('radiogroup', { name: 'Practice mode' }).getByText('Wait For You', { exact: true }).click()
      await expect.poll(() => waitForYou.isChecked()).toBe(true)

      await scoreButton.click()
      await expect.poll(() => scoreButton.getAttribute('aria-pressed')).toBe('true')
      await page.locator('.pdf-page-window__slot--active canvas').first().waitFor({ timeout: 15_000 })
      expect(await page.getByRole('alert').count()).toBe(0)

      expect(runtimeFailures).toEqual([])
    } finally {
      await context.close()
    }
  }, 45_000)
})
