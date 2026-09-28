import { useEffect, useRef } from 'react'
import { focusFirstElement, handleFocusTrap } from '../../utils/focusTrap.js'
import Icon from '../../design/Icon.jsx'
import PracticeLoopControls from './PracticeLoopControls.jsx'
import MidiTrackList from './MidiTrackList.jsx'
import PracticeScopeSection from './PracticeScopeSection.jsx'
import PracticeSetupPanel from './PracticeSetupPanel.jsx'
import PracticeDiagnosticsPanel from './PracticeDiagnosticsPanel.jsx'
import PracticeFilesSummary from './PracticeFilesSummary.jsx'
import PracticeStatsCard from './PracticeStatsCard.jsx'
import MidiInputStatusPanel from './MidiInputStatusPanel.jsx'
import MicrophoneInputStatusPanel from './MicrophoneInputStatusPanel.jsx'
import { WFY_INPUT_SOURCE } from '../../features/microphone-input/micInputConstants.js'
import { isWebMidiSupported } from '../../features/midi-input/parseMidiMessage.js'
import { isMicrophoneSupported } from '../../features/microphone-input/micEnvironment.js'
import { METRONOME_COUNT_IN_OPTIONS, METRONOME_SUBDIVISION_OPTIONS } from '../../features/playback/metronomeConstants.js'

const TITLES = { tempo: 'Find your tempo', loop: 'Work a passage', sound: 'Sound & accompaniment', input: 'Hear your playing', settings: 'Workspace settings' }

export default function WorkspaceTools({ tool, onClose, returnFocusTo, session: s, scoreFollow, fileName, pageNumber, practiceStats, pieceId, onReport }) {
  const ref = useRef(null)
  useEffect(() => {
    const prior = returnFocusTo.current || document.activeElement
    const background = [...document.querySelectorAll('.cz-shell__sidewrap, .cz-shell__header')]
    const previousInert = background.map(el => el.inert)
    background.forEach(el => { el.inert = true })
    focusFirstElement(ref.current)
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      else handleFocusTrap(ref.current, event)
    }
    const panel = ref.current
    panel.addEventListener('keydown', onKey)
    return () => { background.forEach((el, i) => { el.inert = previousInert[i] }); panel.removeEventListener('keydown', onKey); if (prior?.isConnected) prior.focus() }
  }, [onClose, returnFocusTo])
  const p = s.playback
  const input = s.wfyInputSourceReady ? s.wfyInputSource : WFY_INPUT_SOURCE.MANUAL
  return (
    <>
      <button className="workspace-tool-scrim" tabIndex={-1} aria-label="Dismiss tools" onClick={onClose} />
      <section ref={ref} className={`workspace-tool-panel workspace-tool-panel--${tool}`} role="dialog" aria-label={TITLES[tool]} aria-modal="true">
        <header><h2>{TITLES[tool]}</h2><button className="workspace-icon" aria-label="Close tools" onClick={onClose}><Icon name="close" size={18} /></button></header>
        {tool === 'tempo' && <>
          <div className="workspace-tempo-number">{p.effectiveTempo ?? '—'}<span>BPM</span></div>
          <label className="workspace-field">Playback speed <output>{Math.round(p.playbackRate * 100)}%</output><input id="playback-rate" aria-label="Playback speed" type="range" min="0.25" max="1.5" step="0.05" value={p.playbackRate} disabled={p.controlsDisabled} onChange={e => p.setPlaybackRate(Number(e.target.value))} /></label>
          <div className="workspace-presets">{[.5, .75, 1].map(rate => <button key={rate} aria-pressed={p.playbackRate === rate} onClick={() => p.setPlaybackRate(rate)} disabled={p.controlsDisabled}>{rate * 100}%</button>)}</div>
          <p>Adjust the pace without changing the notes. Use − / + from the score.</p>
        </>}
        {tool === 'loop' && <>
          <p>Set the start and end at your current position, or choose bars below.</p>
          <label className="workspace-check"><input type="checkbox" checked={s.loop.enabled} disabled={!s.loop.canEnable} onChange={e => s.loop.setLoopEnabled(e.target.checked)} /> Repeat passage</label>
          <PracticeLoopControls disabled={s.timingDisabled} region={s.loop.region} hasLoop={s.loop.hasLoop} canEnable={s.loop.canEnable} enabled={s.loop.enabled} snapMode={s.loop.snapMode} hasMidi={s.hasMusicXml} hideHeaderToggle onSnapModeChange={s.loop.setLoopSnapMode} onSetStart={s.loop.setStartFromCurrent} onSetEnd={s.loop.setEndFromCurrent} onClear={s.loop.clearLoop} />
          {s.loop.snapMode === 'measure' && <div className="workspace-range-fields">
            <label className="workspace-field">From bar<input aria-label="Loop start bar" type="number" min={s.measure.bounds?.min ?? 1} max={s.measure.bounds?.max} value={s.loop.startMeasureNumber ?? ''} onChange={e => s.loop.setStartMeasure(Number(e.target.value))} /></label>
            <label className="workspace-field">Through bar<input aria-label="Loop end bar" type="number" min={s.loop.startMeasureNumber ?? 1} max={s.measure.bounds?.max} value={s.loop.endMeasureNumber ?? ''} onChange={e => s.loop.setEndMeasure(Number(e.target.value))} /></label>
          </div>}
          <p className="workspace-hint">L opens this panel. The marked section on the position line shows your loop.</p>
        </>}
        {tool === 'sound' && <>
          <label className="workspace-field">Count-in<select aria-label="Count-in" value={p.metronomeCountIn} onChange={e => p.setMetronomeCountIn(Number(e.target.value))}>{METRONOME_COUNT_IN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
          <label className="workspace-field">Click rhythm<select aria-label="Click rhythm" value={p.metronomeSubdivision} onChange={e => p.setMetronomeSubdivision(e.target.value)}>{METRONOME_SUBDIVISION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
          <label className="workspace-field">Click volume<input aria-label="Metronome volume" type="range" min="0" max="1" step=".05" value={p.metronomeLevel} onChange={e => p.setMetronomeLevel(Number(e.target.value))} /></label>
          <h3>Accompaniment</h3><p>Uncheck a part to play it yourself.</p>
          <MidiTrackList tracks={p.tracks.map((track, index) => ({ ...track, name: /^\d+Apart|^\d+:|^untitled/i.test(track.name) ? `Part ${index + 1}` : track.name }))} disabled={p.controlsDisabled} onToggleMute={s.handleToggleMute} />
          <button onClick={p.testSound}>Test sound</button>
        </>}
        {tool === 'input' && <>
          <p>{s.isWaitForYou ? 'Play a note to move on, or use Continue at your own pace.' : 'Optional feedback while the score keeps moving. Choose how to hear your instrument.'}</p>
          <div className="workspace-input-options" role="group" aria-label="Practice input">
            {[[WFY_INPUT_SOURCE.MANUAL, 'Use Continue', true], [WFY_INPUT_SOURCE.MIDI, 'MIDI keyboard', isWebMidiSupported()], [WFY_INPUT_SOURCE.MICROPHONE, 'Microphone', isMicrophoneSupported()]].map(([id, label, available]) => <button key={id} disabled={!available} aria-pressed={input === id} onClick={() => s.setWfyInputSource(id)}>{id === WFY_INPUT_SOURCE.MANUAL && !s.isWaitForYou ? 'Without listening' : label}</button>)}
          </div>
          {input === WFY_INPUT_SOURCE.MIDI && <MidiInputStatusPanel {...s.webMidi} onRequestAccess={s.webMidi.requestAccess} onRefreshDevices={s.webMidi.refreshDevices} onSelectDevice={s.webMidi.selectDevice} compact />}
          {input === WFY_INPUT_SOURCE.MICROPHONE && <MicrophoneInputStatusPanel {...s.microphone} {...s.waitForYouMic} onRequestAccess={s.microphone.requestAccess} onDisable={() => s.setWfyInputSource(WFY_INPUT_SOURCE.MANUAL)} onRetryCalibration={s.waitForYouMic.retryCalibration} compact />}
          <PracticeScopeSection visible={s.practiceScopeAvailable} practiceScope={s.rawPracticeScope} onPracticeScopeChange={s.setPracticeScope} disabled={s.timingDisabled} compact />
        </>}
        {tool === 'settings' && <>
          <label className="workspace-check"><input type="checkbox" checked={scoreFollow.enabled} onChange={e => scoreFollow.setEnabled(e.target.checked)} /> Follow the score</label>
          <p>Keep the current phrase in view as you play.</p>
          <details><summary>Advanced practice & score setup</summary>
            <PracticeSetupPanel session={s} scoreFollow={scoreFollow} />
            <PracticeFilesSummary pdfFileName={fileName} hasMidi={s.hasMidi} hasMusicXml={s.hasMusicXml} playbackFileName={s.sources.playbackFileName} timingFileName={s.sources.timingFileName} timingError={s.timing.error} timingLoading={s.timing.isLoading} />
            <PracticeDiagnosticsPanel session={s} scoreFollow={scoreFollow} pieceName={fileName} pdfPageNumber={pageNumber} />
          </details>
          <details><summary>This practice session</summary><PracticeStatsCard pieceId={pieceId} liveSession={practiceStats?.liveSession} compact /></details>
          <details><summary>Keyboard shortcuts</summary><dl className="workspace-shortcuts"><dt>Space</dt><dd>Play / pause</dd><dt>Enter / N</dt><dd>Continue in Wait For You</dd><dt>1 · 2 · 3</dt><dd>Preview · Play Along · Wait For You</dd><dt>− / +</dt><dd>Slower / faster</dd><dt>L</dt><dd>Loop tools</dd><dt>F</dt><dd>Enter / exit focus</dd><dt>Esc</dt><dd>Close tool, end annotation, exit focus</dd><dt>← / →</dt><dd>Previous / next page</dd><dt>Shift + ← / →</dt><dd>Previous / next bar</dd></dl></details>
          <button onClick={onReport}>Report a score problem</button>
        </>}
      </section>
    </>
  )
}
