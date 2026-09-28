import { METRONOME_SUBDIVISION, METRONOME_COUNT_IN } from './metronomeConstants.js'
const clamp = (value, min, max, fallback) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
export function normalizePlaybackPreferences(prefs = {}) {
  prefs = prefs && typeof prefs === 'object' ? prefs : {}
  return {
    playbackRate: clamp(prefs.playbackRate, .25, 1.5, 1),
    metronomeEnabled: prefs.metronomeEnabled === true,
    metronomeLevel: clamp(prefs.metronomeLevel, 0, 1, .6),
    metronomeSubdivision: Object.values(METRONOME_SUBDIVISION).includes(prefs.metronomeSubdivision) ? prefs.metronomeSubdivision : METRONOME_SUBDIVISION.QUARTER,
    metronomeCountIn: Object.values(METRONOME_COUNT_IN).includes(prefs.metronomeCountIn) ? prefs.metronomeCountIn : METRONOME_COUNT_IN.OFF,
  }
}
