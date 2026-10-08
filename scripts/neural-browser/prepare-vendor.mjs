/**
 * Patched vendor ESM for the neural browser harness (Stage 6/7) — test-only.
 *
 * The vendor ESM uses bundler-style imports browsers cannot resolve
 * (extensionless relatives, bare '@tensorflow/tfjs' into a UMD build).
 * This copies the two needed modules into tmp/neural-vendor with
 * mechanical rewrites (reviewable, regenerable, never committed):
 * TensorFlow.js arrives via the classic UMD bundle as window.tf.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function preparePatchedVendor(projectRoot) {
  const vendor = process.env.CORRANZO_NEURAL_VENDOR
  if (!vendor) {
    throw new Error('preparePatchedVendor requires CORRANZO_NEURAL_VENDOR')
  }
  const outDir = join(projectRoot, 'tmp', 'neural-vendor')
  mkdirSync(outDir, { recursive: true })
  const inference = readFileSync(join(vendor, '@spotify/basic-pitch/esm/inference.js'), 'utf8')
    .replaceAll("from '@tensorflow/tfjs'", "from '/tmpvendor/tf-global.js'")
    .replaceAll('import * as tf', 'import tf')
  const toMidi = readFileSync(join(vendor, '@spotify/basic-pitch/esm/toMidi.js'), 'utf8')
    .replaceAll("from '@tonejs/midi'", "from '/harness/tonejs-stub.js'")
  writeFileSync(join(outDir, 'inference.js'), inference)
  writeFileSync(join(outDir, 'toMidi.js'), toMidi)
  writeFileSync(join(outDir, 'tf-global.js'), 'export default globalThis.tf;\n')
  return outDir
}
