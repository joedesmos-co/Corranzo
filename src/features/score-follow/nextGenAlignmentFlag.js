/**
 * Next-generation automatic score alignment — Phase 4 feature flag.
 *
 * Gates the *diagnostics-only* surfacing of the new reconciliation / confidence
 * decision / unified anchor-generation pipeline. When OFF (the public default),
 * NOTHING about runtime score-follow changes: the live cursor, auto-setup,
 * manual setup, and bundled demo anchors all behave exactly as before.
 *
 * Resolution order (first decisive wins):
 *   1. explicit `override`           (tests / callers)
 *   2. global override               (globalThis.__SCOREFLOW_FLAGS__[KEY])
 *   3. persisted override            (localStorage KEY = '1' | '0' | …)
 *   4. dev/debug default             (import.meta.env.DEV) → ON in dev, OFF in prod
 *
 * The flag never enables generated anchors to drive the cursor — it only
 * reveals diagnostics + an opt-in candidate-anchor debug overlay.
 */
export const ENABLE_NEXTGEN_ALIGNMENT_DIAGNOSTICS = 'nextgenAlignmentDiagnostics'

export const NEXTGEN_ALIGNMENT_DIAGNOSTICS_STORAGE_KEY =
  'scoreflow.flags.nextgenAlignmentDiagnostics'

/** Coerce a raw flag value to a tri-state: true / false / null (undecided). */
export function resolveFlagOverride(rawValue) {
  if (rawValue === true || rawValue === 1) {
    return true
  }
  if (rawValue === false || rawValue === 0) {
    return false
  }
  if (typeof rawValue === 'string') {
    const normalized = rawValue.trim().toLowerCase()
    if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') {
      return true
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
      return false
    }
  }
  return null
}

/**
 * Pure decision function (fully injectable → unit-testable). Prefer this in
 * logic; use {@link isNextGenAlignmentDiagnosticsEnabled} at call sites that can
 * read the ambient environment.
 *
 * @param {object} [sources]
 * @param {*} [sources.override]    explicit caller override
 * @param {*} [sources.globalValue] value from a global flag bag
 * @param {*} [sources.storageValue] value persisted in storage
 * @param {boolean} [sources.devMode] whether running in a dev/debug build
 * @returns {boolean}
 */
export function decideNextGenAlignmentDiagnostics({
  override = null,
  globalValue = null,
  storageValue = null,
  devMode = false,
} = {}) {
  const explicit = resolveFlagOverride(override)
  if (explicit !== null) {
    return explicit
  }
  const global = resolveFlagOverride(globalValue)
  if (global !== null) {
    return global
  }
  const stored = resolveFlagOverride(storageValue)
  if (stored !== null) {
    return stored
  }
  return Boolean(devMode)
}

function readDevMode() {
  try {
    return Boolean(import.meta.env?.DEV)
  } catch {
    return false
  }
}

function readGlobalFlag() {
  try {
    return globalThis.__SCOREFLOW_FLAGS__?.[ENABLE_NEXTGEN_ALIGNMENT_DIAGNOSTICS] ?? null
  } catch {
    return null
  }
}

function readStoredFlag() {
  try {
    return globalThis.localStorage?.getItem(NEXTGEN_ALIGNMENT_DIAGNOSTICS_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

/**
 * Ambient-environment resolution used by the app. Safe in non-browser/test
 * contexts (each source is guarded). Pass `override` to force a value.
 */
export function isNextGenAlignmentDiagnosticsEnabled(override = null) {
  return decideNextGenAlignmentDiagnostics({
    override,
    globalValue: readGlobalFlag(),
    storageValue: readStoredFlag(),
    devMode: readDevMode(),
  })
}
