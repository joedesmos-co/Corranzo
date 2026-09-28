/**
 * Guitar Vision — provenance classification.
 *
 * ## The failure this prevents
 *
 * The repository tracks ~670 `.musicxml` files under `tmp/`. Almost all of them
 * are **OMR engine output** from past experiments — the model's own
 * transcriptions, stored with names indistinguishable from truth. Any corpus
 * builder that globs recursively for `.musicxml` therefore reads the engine's
 * own mistakes as ground truth, and training on that teaches the model to
 * reproduce its errors with increased confidence. The Phase 0 coverage
 * inventory did exactly this before it was noticed.
 *
 * ## Layered policy
 *
 * Classification is layered strongest-first, and every decision records which
 * rule fired so a reviewer can audit it:
 *
 *   1. **Declared manifest** — the practice-library and benchmark manifests
 *      state provenance and licence explicitly. Highest trust, because it is a
 *      human assertion about the file rather than a guess from its contents.
 *   2. **Path policy** — anything inside a scratch directory is machine output
 *      *by policy*, regardless of what it contains. A working area is not an
 *      authority, and this rule needs no content inspection, so it cannot be
 *      defeated by a missing marker.
 *   3. **Content signals** — the OMR disclaimer, engine note ids, `.omr.`
 *      suffixes and shadow-IR names.
 *   4. **Ambiguous** — anything unrecognised is `unlabelled`, never
 *      `real-printed`. Defaulting an unknown file to "real" is the exact
 *      inversion that caused the original problem.
 *
 * `labelable` is derived from provenance and is the only field a data engine
 * should branch on.
 */

import { PROVENANCE } from './corpusSplits.js'

// Re-exported so consumers have one obvious import site for provenance, rather
// than having to know which module defines the vocabulary.
export { PROVENANCE }

/**
 * Directories that hold working output rather than authoritative data.
 *
 * `tmp/` is committed to git and holds 2.3 GB of experiment artifacts. It is
 * listed here because directory semantics are a stronger statement of intent
 * than any in-file marker, and because content markers are routinely absent
 * (144 tracked `tmp/` scores carry no disclaimer at all).
 */
export const SCRATCH_DIRECTORIES = Object.freeze([
  'tmp/',
  '.cache/',
  'node_modules/',
  'dist/',
  'coverage/',
  '.tmp/',
])

/** In-content markers written by the OMR emitter. */
export const CONTENT_SIGNALS = Object.freeze([
  { id: 'omr-disclaimer', test: (text) => text.includes('Generated from PDF') },
  { id: 'omr-note-ids', test: (text) => /id="sfnh-/.test(text) },
  { id: 'omr-suffix', test: (_text, path) => /\.omr\./.test(path) || /\.after\.omr\./.test(path) },
  { id: 'shadow-ir', test: (_text, path) => /live-v3i\.musicxml$/.test(path) },
  { id: 'experiment-dir', test: (_text, path) => /\/generated\/|\/attempt[s]?\//.test(path) },
])

/** Filename patterns that identify an extracted fragment rather than a score. */
export const FRAGMENT_PATTERNS = Object.freeze([
  /musicxml-snippets\//,
  /\/p1-m\d+-/,
  /-control\.musicxml$/,
  /-snippet\.musicxml$/,
])

/**
 * @typedef {object} ProvenanceVerdict
 * @property {string} provenance     one of PROVENANCE
 * @property {string} rule           which rule decided it
 * @property {boolean} labelable     may this file be used as a supervised label
 * @property {string[]} reasons      human-readable justification
 * @property {boolean} requiresHumanReview
 */

/**
 * Classify one score file.
 *
 * @param {object} input
 * @param {string} input.path              repository-relative path
 * @param {string} [input.text]            file contents, when available
 * @param {object} [input.declared]        manifest-declared provenance, if any
 */
export function classifyProvenance({ path, text = '', declared = null }) {
  const reasons = []

  // 1. An explicit human assertion outranks every heuristic.
  if (declared?.provenance) {
    const provenance = declared.provenance
    reasons.push(`manifest declares provenance=${provenance}`)
    if (declared.licence ?? declared.license) {
      reasons.push(`licence=${declared.licence ?? declared.license}`)
    }
    return verdict(provenance, 'declared-manifest', reasons, false)
  }

  const normalized = `/${String(path).replace(/^\/+/, '')}`

  // 2. Scratch directories are machine output by policy.
  const scratch = SCRATCH_DIRECTORIES.find((directory) => normalized.includes(`/${directory}`))
  if (scratch) {
    reasons.push(`path is inside scratch directory "${scratch}"`)
    return verdict(PROVENANCE.GENERATED, 'scratch-path-policy', reasons, false)
  }

  // 3. Content signals.
  if (text) {
    const fired = CONTENT_SIGNALS.filter((signal) => signal.test(text, normalized))
    if (fired.length) {
      reasons.push(`content signals: ${fired.map((signal) => signal.id).join(', ')}`)
      return verdict(PROVENANCE.GENERATED, 'content-signal', reasons, false)
    }
  }

  // 4. Fragments are not whole scores and must not stand in for one.
  if (FRAGMENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    reasons.push('path identifies an extracted fragment rather than a complete score')
    return verdict(PROVENANCE.GENERATED, 'fragment-path', reasons, true)
  }

  // 5. Unknown is never real. Defaulting to "real" is the inversion that let
  //    engine output masquerade as truth in the first place.
  reasons.push('no declared provenance and no generated-output signal')
  return verdict(PROVENANCE.UNLABELLED, 'unrecognised', reasons, true)
}

function verdict(provenance, rule, reasons, requiresHumanReview) {
  return {
    provenance,
    rule,
    labelable:
      provenance === PROVENANCE.REAL_PRINTED || provenance === PROVENANCE.SYNTHETIC_CC0,
    reasons,
    requiresHumanReview,
  }
}

/**
 * Classify a whole corpus, returning a summary and the ambiguous entries.
 *
 * Ambiguity is surfaced rather than resolved, because a file nobody can account
 * for is a question for a person, not a default to be guessed.
 */
export function classifyCorpus(entries) {
  const classified = entries.map((entry) => ({
    path: entry.path,
    ...classifyProvenance(entry),
  }))

  const counts = {}
  for (const entry of classified) {
    counts[entry.provenance] = (counts[entry.provenance] ?? 0) + 1
  }

  const labelableCount = classified.filter((entry) => entry.labelable).length
  const generatedPaths = classified
    .filter((entry) => entry.provenance === PROVENANCE.GENERATED)
    .map((entry) => entry.path)

  return {
    total: classified.length,
    counts,
    labelableCount,
    generatedCount: generatedPaths.length,
    requiresReview: classified.filter((entry) => entry.requiresHumanReview),
    classified,
  }
}
