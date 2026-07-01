import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('Practice page simplification', () => {
  it('uses one Advanced drawer instead of separate More and Setup drawers', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')

    expect(panel).toMatch(/title="Advanced"/)
    expect(panel).not.toMatch(/title="More"/)
    expect(panel).not.toMatch(/title="Setup"/)
    expect(panel).toMatch(/PracticeScoreCursorSection/)
    expect(panel).toMatch(/PracticeMetronomeAdvancedSettings/)
  })

  it('keeps custom marker management out of Practice setup', () => {
    const setup = readSrc('components', 'practice', 'PracticeSetupPanel.jsx')
    const scoreFollowControls = readSrc('components', 'pdf', 'ScoreFollowControls.jsx')

    expect(setup).toMatch(/showCursorToggle=\{false\}/)
    expect(scoreFollowControls).not.toMatch(/Adjust cursor/)
    expect(scoreFollowControls).not.toMatch(/View markers/)
    expect(scoreFollowControls).not.toMatch(/Clear manual markers/)
    expect(scoreFollowControls).not.toMatch(/Remove all markers/)
    expect(scoreFollowControls).not.toMatch(/Fix \/ add markers manually/)
    expect(setup).not.toMatch(/CalibrationDebugPanel/)
  })

  it('supports a simplified transport and basic metronome controls', () => {
    const transport = readSrc('components', 'practice', 'PracticeTransportSection.jsx')
    const transportTick = readSrc('components', 'practice', 'PracticeTransportTick.jsx')
    const midiControls = readSrc('components', 'practice', 'MidiTransportControls.jsx')
    const playbackSettings = readSrc('components', 'practice', 'PracticePlaybackSettings.jsx')

    expect(transport).toMatch(/showMetronomeDetails=\{false\}/)
    expect(transport).toMatch(/simple=\{compact\}/)
    expect(midiControls).toMatch(/simple \?/)
    expect(midiControls).toMatch(/isPlaying \? onPause : onPlay/)
    expect(midiControls).toContain('midi-transport__btn--text')
    expect(midiControls).toContain("{isPlaying ? 'Pause' : 'Play'}")
    expect(playbackSettings).toMatch(/showMetronomeDetails = true/)
    expect(transportTick).toMatch(/mappingWarning=\{stable\.isDemoPiece \? null : stable\.playback\.mappingWarning\}/)
    expect(transportTick).toContain('waitForYouActive={stable.waitForYou.active}')
    expect(transport).toContain('practice-transport__wfy-primary')
    expect(transport).toContain('Wait For You is active. Play the prompt below, or tap Continue.')
    expect(transport).toContain('onClick={onWaitForYouContinue}')
  })

  it('keeps the first Practice action path above stats and status', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    const transportIndex = panel.indexOf('<PracticeTransportTick />')
    const modeIndex = panel.indexOf('<PracticeModeSection')
    const waitForYouIndex = panel.indexOf('<WaitForYouSection')
    const cursorIndex = panel.indexOf('<PracticeScoreCursorSection')
    const statusIndex = panel.indexOf('<PracticeStatusStrip')
    const statsIndex = panel.indexOf('<PracticeStatsCard')

    expect(transportIndex).toBeGreaterThan(-1)
    expect(modeIndex).toBeGreaterThan(transportIndex)
    expect(waitForYouIndex).toBeGreaterThan(modeIndex)
    expect(cursorIndex).toBeGreaterThan(waitForYouIndex)
    expect(statusIndex).toBeGreaterThan(cursorIndex)
    expect(statsIndex).toBeGreaterThan(statusIndex)
  })

  it('uses beginner-facing Wait For You controls under Mode', () => {
    const waitForYou = readSrc('components', 'practice', 'WaitForYouSection.jsx')
    const practiceCss = readSrc('styles', 'practice.css')

    expect(waitForYou).toContain("[WFY_CHECKPOINT_MODE.BEAT]: 'Tap through beats'")
    expect(waitForYou).toContain("[WFY_CHECKPOINT_MODE.NOTE]: 'Play each note'")
    expect(waitForYou).toContain('wait-for-you__primary-action')
    expect(waitForYou).toContain('Play the note shown on the score, or tap Continue.')
    expect(waitForYou).toContain('Tap Continue to move through beats.')
    expect(practiceCss).toContain('.practice-control-panel__primary > .wait-for-you')
    expect(practiceCss).toMatch(/\.wait-for-you__btn--primary \{[\s\S]*#d8f5e4/)
  })

  it('keeps tempo sliders usable for touch and pointer users', () => {
    const practiceCss = readSrc('styles', 'practice.css')

    expect(practiceCss).toMatch(/\.practice-playback-settings__row input\[type='range'\] \{[\s\S]*height: 20px/)
    expect(practiceCss).toMatch(/::-webkit-slider-thumb \{[\s\S]*width: 14px[\s\S]*opacity: 1/)
    expect(practiceCss).toMatch(/::-moz-range-thumb \{[\s\S]*width: 14px[\s\S]*opacity: 1/)
  })
})
