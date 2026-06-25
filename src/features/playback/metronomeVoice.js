/**
 * Short woodblock-style metronome clicks (no sample files).
 * Accent downbeats are brighter and louder; weak beats are softer.
 */
export function createMetronomeVoice(tone) {
  const bus = new tone.Gain(1)
  const master = new tone.Volume(-10)

  const accentFilter = new tone.Filter({ type: 'bandpass', frequency: 3200, Q: 1.4 })
  const weakFilter = new tone.Filter({ type: 'bandpass', frequency: 1900, Q: 1.1 })

  const accentClick = new tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.09, release: 0.04 },
    harmonicity: 5.2,
    modulationIndex: 22,
    oscillator: { type: 'square' },
    volume: -17,
  })

  const weakClick = new tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.06, release: 0.03 },
    harmonicity: 4.4,
    modulationIndex: 14,
    oscillator: { type: 'square' },
    volume: -24,
  })

  accentClick.connect(accentFilter)
  weakClick.connect(weakFilter)
  accentFilter.connect(bus)
  weakFilter.connect(bus)
  bus.connect(master)

  return {
    volume: master,
    triggerClick(accent, time) {
      const synth = accent ? accentClick : weakClick
      const note = accent ? 'C6' : 'G5'
      synth.triggerAttackRelease(note, accent ? '32n' : '64n', time)
    },
    releaseAll(time) {
      accentClick.triggerRelease?.(time)
      weakClick.triggerRelease?.(time)
    },
    toDestination() {
      master.toDestination()
      return master
    },
    dispose() {
      accentClick.dispose()
      weakClick.dispose()
      accentFilter.dispose()
      weakFilter.dispose()
      bus.dispose()
      master.dispose()
    },
  }
}

/** Map 0–1 UI level to dB for the metronome master. */
export function metronomeLevelToDb(level) {
  const clamped = Math.max(0, Math.min(1, level))
  return -28 + clamped * 22
}
