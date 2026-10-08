#!/usr/bin/env node
/**
 * Static server for the neural browser harness (Stage 6, N1/N6).
 * Test-only. Serves:
 *   /vendor/bp/*    -> $CORRANZO_NEURAL_VENDOR/@spotify/basic-pitch/{esm,model}
 *   /vendor/tfjs/*  -> $CORRANZO_NEURAL_VENDOR/@tensorflow/tfjs/dist
 *   /clip/*.wav    -> <worktree>/benchmarks/mic-real/clips
 *   /harness/*     -> this directory (page.html, page.js)
 * Nothing is uploaded anywhere; all traffic is loopback.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, normalize, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
// Project root = two levels up from scripts/neural-browser
const PROJECT_ROOT = join(HERE, '..', '..')
const VENDOR = process.env.CORRANZO_NEURAL_VENDOR ?? '/tmp/tfjs-probe/node_modules'
// Synthetic FP controls (silence/noise/speech), generated on demand into
// tmp/neural-controls (untracked); env-overridable like the vendor root.
const CONTROLS = process.env.CORRANZO_NEURAL_CONTROLS ?? join(PROJECT_ROOT, 'tmp', 'neural-controls')
// Patched vendor ESM copies (test setup rewrites bare imports to
// browser-resolvable URLs). Kept outside the repo: derived artifacts.
const TMPVENDOR = process.env.CORRANZO_NEURAL_TMPVENDOR ?? join(PROJECT_ROOT, 'tmp', 'neural-vendor')

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.wav': 'audio/wav' }

const ROOTS = [
  join(VENDOR, '@spotify', 'basic-pitch'),
  join(VENDOR, '@tensorflow', 'tfjs'),
  join(VENDOR, '@tensorflow', 'tfjs-backend-wasm'),
  join(PROJECT_ROOT, 'benchmarks', 'mic-real', 'clips'),
  CONTROLS,
  TMPVENDOR,
  HERE,
]

function resolve(urlPath) {
  let filePath = null
  if (urlPath.startsWith('/vendor/bp/')) {
    filePath = join(VENDOR, '@spotify/basic-pitch', urlPath.slice('/vendor/bp/'.length))
  } else   if (urlPath.startsWith('/vendor/tfjs/')) {
    filePath = join(VENDOR, '@tensorflow/tfjs', urlPath.slice('/vendor/tfjs/'.length))
  } else if (urlPath.startsWith('/vendor/wasm/')) {
    filePath = join(VENDOR, '@tensorflow/tfjs-backend-wasm', urlPath.slice('/vendor/wasm/'.length))
  } else if (urlPath.startsWith('/tmpvendor/')) {
    filePath = join(TMPVENDOR, urlPath.slice('/tmpvendor/'.length))
  } else if (urlPath.startsWith('/clip/')) {
    filePath = join(PROJECT_ROOT, 'benchmarks', 'mic-real', 'clips', urlPath.slice('/clip/'.length))
  } else if (urlPath.startsWith('/control/')) {
    filePath = join(CONTROLS, urlPath.slice('/control/'.length))
  } else if (urlPath.startsWith('/harness/')) {
    filePath = join(HERE, urlPath.slice('/harness/'.length))
  }
  if (!filePath) {
    return null
  }
  const normalized = normalize(filePath)
  if (!ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`))) {
    return null
  }
  return normalized
}

export function startNeuralBrowserServer(port = 0) {
  const server = createServer(async (request, response) => {
    try {
      const urlPath = decodeURIComponent(new URL(request.url, 'http://x').pathname)
      // Root-pinned: resolve() returns null for anything outside the
      // mapped roots (no directory traversal).
      const filePath = resolve(urlPath)
      if (!filePath) {
        response.writeHead(403)
        response.end()
        return
      }
      const body = await readFile(filePath)
      response.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  return new Promise((done) => {
    server.listen(port, '127.0.0.1', () => done(server))
  })
}

const directRun = process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1]
if (directRun) {
  const server = await startNeuralBrowserServer(8931)
  console.log(`neural browser harness on http://127.0.0.1:${server.address().port}`)
}
