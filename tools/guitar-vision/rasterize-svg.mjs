#!/usr/bin/env node
/**
 * Rasterize one Verovio SVG to PNG(s) via headless Chromium.
 * Deterministic given the same SVG + viewport widths.
 *
 * Usage: node tools/guitar-vision/rasterize-svg.mjs --in render.svg --out page --widths 1050,2100
 * Writes page-w1050.png, page-w2100.png next to --out prefix.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const get = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : fallback
}

const svgPath = resolve(ROOT, get('--in'))
const outPrefix = resolve(ROOT, get('--out'))
const widths = String(get('--widths', '1050,2100')).split(',').map(Number)
const svg = readFileSync(svgPath, 'utf8')
const widthMatch = svg.match(/width="([\d.]+)(px)?"/)
const heightMatch = svg.match(/height="([\d.]+)(px)?"/)
const aspect = widthMatch && heightMatch ? Number(heightMatch[1]) / Number(widthMatch[1]) : Math.SQRT2

const browser = await chromium.launch()
for (const width of widths) {
  const height = Math.round(width * aspect)
  const page = await browser.newPage({ viewport: { width, height } })
  await page.setContent(
    `<!DOCTYPE html><html><body style="margin:0;background:white">${svg}</body></html>`,
    { waitUntil: 'load' },
  )
  await page.screenshot({ path: `${outPrefix}-w${width}.png`, fullPage: false })
  await page.close()
  console.log(`wrote ${outPrefix}-w${width}.png`)
}
await browser.close()
