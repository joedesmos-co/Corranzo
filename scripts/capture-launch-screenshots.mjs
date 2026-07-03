#!/usr/bin/env node
/**
 * Capture key Corranzo screens for launch review (headless Chromium).
 * Usage: npm run preview &  node scripts/capture-launch-screenshots.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'launch-screenshots')
const baseUrl = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:4173'

async function waitForServer(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) {
        return
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Server not ready at ${url}`)
}

async function ensurePreview() {
  if (process.env.SCREENSHOT_BASE_URL) {
    await waitForServer(baseUrl)
    return null
  }

  const preview = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173'], {
    cwd: root,
    stdio: 'ignore',
  })

  await waitForServer(baseUrl)
  return preview
}

async function main() {
  await mkdir(outDir, { recursive: true })

  const { chromium } = await import('playwright')
  const preview = await ensurePreview()

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
  })
  const page = await context.newPage()

  const shots = [
    { name: '01-library-welcome', setup: async () => {} },
    { name: '02-practice-empty', setup: async () => {
      await page.getByRole('button', { name: 'Practice' }).click()
    }},
    { name: '03-profile-progress', setup: async () => {
      await page.getByRole('button', { name: 'Progress' }).click()
    }},
  ]

  for (const shot of shots) {
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await shot.setup()
    await page.waitForTimeout(700)
    await page.screenshot({
      path: join(outDir, `${shot.name}.png`),
      fullPage: true,
    })
  }

  // Dismiss tutorial if present for library workspace shot
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  const skipBtn = page.getByRole('button', { name: 'Skip' })
  if (await skipBtn.isVisible().catch(() => false)) {
    await skipBtn.click()
    await page.waitForTimeout(400)
  }
  const demoBtn = page.getByRole('button', { name: 'Try Demo Piece' })
  if (await demoBtn.isVisible().catch(() => false)) {
    await demoBtn.click()
    await page.waitForTimeout(6000)
    await page.screenshot({
      path: join(outDir, '04-library-demo-loaded.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Practice' }).click()
    await page.waitForTimeout(2000)
    await page.screenshot({
      path: join(outDir, '05-practice-demo.png'),
      fullPage: true,
    })
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    files: shots.map((s) => `${s.name}.png`),
  }
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  await browser.close()
  if (preview) {
    preview.kill('SIGTERM')
  }

  console.log(`Wrote screenshots to ${outDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
