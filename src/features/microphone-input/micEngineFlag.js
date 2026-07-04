/**
 * Mic Engine V2 — runtime feature flag (Wait For You integration).
 *
 * V2 is now the only live Wait For You mic engine. The old flag identifiers are
 * kept as compatibility no-ops so saved QA/dev settings do not break startup.
 */

export const MIC_ENGINE_V2_FLAG = 'micEngineV2'

export const MIC_ENGINE_MODE = {
  V2: 'v2-score-informed',
}

export const MIC_ENGINE_V2_STORAGE_KEY = 'scoreflow.flags.micEngineV2'

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

export function resolveMicEngineMode(override = null) {
  void override
  return MIC_ENGINE_MODE.V2
}
