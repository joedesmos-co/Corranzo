/** Shared room-bed generator for polyphony clip scripts. */

export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function synthRoomBed(sampleRate, { seconds = 1, level = 0.006, seed = 11 } = {}) {
  const length = Math.floor(sampleRate * seconds)
  const buffer = new Float32Array(length)
  const rng = mulberry32(seed)
  for (let index = 0; index < length; index += 1) {
    buffer[index] = (rng() * 2 - 1) * level
  }
  return buffer
}
