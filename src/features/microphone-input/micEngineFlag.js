/**
 * Mic Engine V2 — runtime feature flag (Wait For You integration).
 *
 * V2 is now the only live Wait For You mic engine. The old flag identifiers are
 * kept as compatibility no-ops so saved QA/dev settings do not break startup.
 */

export const MIC_ENGINE_V2_FLAG = 'micEngineV2'
export const MIC_ENGINE_V3_FLAG = 'micEngineV3'

/**
 * Blind polyphonic prototype (Stage 2, S3) — EXPERIMENTAL, default OFF.
 * Explicit opt-in only (override, global flag, or localStorage). The live
 * listening path never consults this flag yet; the prototype runs offline
 * in benchmarks and the dev recording harness until real-recording
 * validation justifies a gated rollout.
 */
export const MIC_BLIND_POLY_FLAG = 'micBlindPoly'

export const MIC_ENGINE_MODE = {
  V2: 'v2-score-informed',
  V3: 'v3-performance-expectation',
}

export const MIC_ENGINE_V2_STORAGE_KEY = 'scoreflow.flags.micEngineV2'
export const MIC_ENGINE_V3_STORAGE_KEY = 'scoreflow.flags.micEngineV3'
export const MIC_BLIND_POLY_STORAGE_KEY = 'scoreflow.flags.micBlindPoly'

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
 * @param {object} [sources]
 * @returns {boolean}
 */
export function decideMicEngineV2Enabled({
  override = null,
  globalValue = null,
  storageValue = null,
  devDefault = false,
} = {}) {
  // Read arguments deliberately to preserve the public signature while making
  // false/opt-out values harmless. V2 is the production path.
  void override
  void globalValue
  void storageValue
  void devDefault
  return true
}

function readGlobalFlag() {
  try {
    return globalThis.__SCOREFLOW_FLAGS__?.[MIC_ENGINE_V2_FLAG] ?? null
  } catch {
    return null
  }
}

function readStoredFlag() {
  try {
    return globalThis.localStorage?.getItem(MIC_ENGINE_V2_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export function isMicEngineV2Enabled(override = null) {
  return decideMicEngineV2Enabled({
    override,
    globalValue: readGlobalFlag(),
    storageValue: readStoredFlag(),
    devDefault: Boolean(import.meta.env?.DEV),
  })
}

/**
 * V3 is enabled by default after replay/browser gates, with an immediate local
 * or global rollback switch. V2 remains the audio-evidence provider underneath.
 */
export function decideMicEngineV3Enabled({
  override = null,
  globalValue = null,
  storageValue = null,
  defaultEnabled = true,
} = {}) {
  for (const value of [override, globalValue, storageValue]) {
    const resolved = resolveFlagOverride(value)
    if (resolved != null) return resolved
  }
  return Boolean(defaultEnabled)
}

function readGlobalV3Flag() {
  try {
    return globalThis.__SCOREFLOW_FLAGS__?.[MIC_ENGINE_V3_FLAG] ?? null
  } catch {
    return null
  }
}

function readStoredV3Flag() {
  try {
    return globalThis.localStorage?.getItem(MIC_ENGINE_V3_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export function isMicEngineV3Enabled(override = null) {
  return decideMicEngineV3Enabled({
    override,
    globalValue: readGlobalV3Flag(),
    storageValue: readStoredV3Flag(),
    defaultEnabled: true,
  })
}

export function resolveMicEngineMode(override = null) {
  return isMicEngineV3Enabled(override) ? MIC_ENGINE_MODE.V3 : MIC_ENGINE_MODE.V2
}

/**
 * Blind polyphonic prototype gate. Default OFF in every environment —
 * production, dev, and tests — until real-recording validation (Stage 2
 * S10/S12) justifies a rollout. Unlike V2/V3, explicit false values are
 * honored here: this flag must never turn itself on.
 */
export function decideMicBlindPolyEnabled({
  override = null,
  globalValue = null,
  storageValue = null,
  defaultEnabled = false,
} = {}) {
  for (const value of [override, globalValue, storageValue]) {
    const resolved = resolveFlagOverride(value)
    if (resolved != null) return resolved
  }
  return Boolean(defaultEnabled)
}

function readGlobalBlindPolyFlag() {
  try {
    return globalThis.__SCOREFLOW_FLAGS__?.[MIC_BLIND_POLY_FLAG] ?? null
  } catch {
    return null
  }
}

function readStoredBlindPolyFlag() {
  try {
    return globalThis.localStorage?.getItem(MIC_BLIND_POLY_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export function isMicBlindPolyEnabled(override = null) {
  return decideMicBlindPolyEnabled({
    override,
    globalValue: readGlobalBlindPolyFlag(),
    storageValue: readStoredBlindPolyFlag(),
    defaultEnabled: false,
  })
}
