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
const layout = get('--layout', 'standard')
const tag = layout === 'standard' ? '' : `-${layout}`
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const svgPattern = new RegExp(`^render${tag}(-p\\d+)?\\.svg$`)
const svgs = readdirSync(workDir).filter((f) => svgPattern.test(f))
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
  const pageTag = svgFile === `render${tag}.svg` ? 'page1' : `page${svgFile.match(/-p(\d+)\.svg/)[1]}`
  // Standard layout keeps historical filenames (<sample>-pageN.png,
  // <sample>-manifest.json); other layouts prefix with the layout name.
  const namePrefix = layout === 'standard' ? basename(workDir) : `${basename(workDir)}-${layout}`
  const out = resolve(outDir, `${namePrefix}-${pageTag}.png`)
  await page.screenshot({ path: out, fullPage: false })
  await page.close()
  manifest[pageTag] = { file: out, cssWidth, viewBox: [vbw, vbh], height, layout }
  console.log(`wrote ${out}`)
}
await browser.close()
const manifestName = layout === 'standard' ? `${basename(workDir)}-manifest.json` : `${basename(workDir)}-${layout}-manifest.json`
writeFileSync(resolve(outDir, manifestName), JSON.stringify(manifest, null, 1))
