#!/usr/bin/env node
/**
 * Hi-res staging raster for the supervised proof (NOT committed).
 *
 * Renders each page SVG with CSS scaling so glyphs get real pixels
 * (committed viewport screenshots keep the SVG at natural size).
 * Mapping: PNG_px = canonical * (cssWidth / viewBoxWidth).
 *
 * Usage: node tools/guitar-vision/proof-raster-hires.mjs --work <scoreDir> --out <dir> --width 2100
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const get = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : fallback
}

const workDir = resolve(ROOT, get('--work'))
const outDir = resolve(ROOT, get('--out'))
const cssWidth = Number(get('--width', 2100))
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const svgs = readdirSync(workDir).filter((f) => /^render(-p\d+)?\.svg$/.test(f))
const manifest = {}
for (const svgFile of svgs) {
  const svg = readFileSync(resolve(workDir, svgFile), 'utf8')
  const vb = svg.match(/class="definition-scale"[^>]*viewBox="([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)"/)
  if (!vb) throw new Error(`no definition viewBox in ${svgFile}`)
  const [, , , vbw, vbh] = vb.map(Number)
  const height = Math.round(cssWidth * (vbh / vbw))
  const page = await browser.newPage({ viewport: { width: cssWidth, height } })
  await page.setContent(
    `<!DOCTYPE html><html><body style="margin:0;background:white"><style>svg{width:${cssWidth}px;height:auto;display:block}</style>${svg}</body></html>`,
    { waitUntil: 'load' },
  )
  const tag = svgFile === 'render.svg' ? 'page1' : `page${svgFile.match(/-p(\d+)\.svg/)[1]}`
  const out = resolve(outDir, `${basename(workDir)}-${tag}.png`)
  await page.screenshot({ path: out, fullPage: false })
  await page.close()
  manifest[tag] = { file: out, cssWidth, viewBox: [vbw, vbh], height }
  console.log(`wrote ${out}`)
}
await browser.close()
writeFileSync(resolve(outDir, `${basename(workDir)}-manifest.json`), JSON.stringify(manifest, null, 1))
