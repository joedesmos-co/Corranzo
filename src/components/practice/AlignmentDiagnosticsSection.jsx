import { ALIGNMENT_ASSESSMENT } from '../../features/practice/computeAlignmentDiagnostics.js'
import { formatTime } from '../../features/playback/formatTime.js'

function formatNoteRef(note) {
  if (!note) {
    return '—'
  }
  if (note.label) {
    return `${note.label} @ ${formatTime(note.timeSeconds)}`
  }
  return `MIDI ${note.midi} @ ${formatTime(note.timeSeconds)}`
}

export default function AlignmentDiagnosticsSection({
  diagnostics,
  isLoading,
  error,
}) {
  if (isLoading) {
    return (
      <section className="alignment-diagnostics" aria-label="Alignment diagnostics">
        <h4 className="alignment-diagnostics__title">Alignment diagnostics</h4>
        <p className="alignment-diagnostics__status">Comparing MIDI and MusicXML…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="alignment-diagnostics" aria-label="Alignment diagnostics">
        <h4 className="alignment-diagnostics__title">Alignment diagnostics</h4>
        <p className="alignment-diagnostics__error">{error}</p>
      </section>
    )
  }

  if (!diagnostics) {
    return null
  }

  const assessmentClass =
    diagnostics.assessment === ALIGNMENT_ASSESSMENT.LIKELY_MATCH
      ? 'alignment-diagnostics__verdict--ok'
      : diagnostics.assessment === ALIGNMENT_ASSESSMENT.UNLIKELY_MATCH
        ? 'alignment-diagnostics__verdict--warn'
        : 'alignment-diagnostics__verdict--caution'

  return (
    <section className="alignment-diagnostics" aria-label="Alignment diagnostics">
      <h4 className="alignment-diagnostics__title">Alignment diagnostics</h4>
      <p className="alignment-diagnostics__disclaimer">{diagnostics.disclaimer}</p>

      <p className={`alignment-diagnostics__verdict ${assessmentClass}`}>
        {diagnostics.assessmentMessage}
      </p>

      <dl className="alignment-diagnostics__grid">
        <div>
          <dt>Note count (MIDI)</dt>
          <dd>{diagnostics.midiNoteCount}</dd>
        </div>
        <div>
          <dt>Note count (MusicXML)</dt>
          <dd>{diagnostics.musicXmlNoteCount}</dd>
        </div>
        <div>
          <dt>Note count delta</dt>
          <dd>{diagnostics.noteCountDelta >= 0 ? '+' : ''}{diagnostics.noteCountDelta}</dd>
        </div>
        <div>
          <dt>Duration (MIDI)</dt>
          <dd>{formatTime(diagnostics.midiDurationSeconds)}</dd>
        </div>
        <div>
          <dt>Duration (MusicXML)</dt>
          <dd>{formatTime(diagnostics.musicXmlDurationSeconds)}</dd>
        </div>
        <div>
          <dt>Duration delta</dt>
          <dd>{diagnostics.durationDeltaLabel}</dd>
        </div>
        <div className="alignment-diagnostics__wide">
          <dt>MIDI tempo map</dt>
          <dd>{diagnostics.midiTempoSummary}</dd>
        </div>
        <div className="alignment-diagnostics__wide">
          <dt>MusicXML tempo map</dt>
          <dd>{diagnostics.musicXmlTempoSummary}</dd>
        </div>
        <div className="alignment-diagnostics__wide">
          <dt>First note (MIDI)</dt>
          <dd>{formatNoteRef(diagnostics.firstMidiNote)}</dd>
        </div>
        <div className="alignment-diagnostics__wide">
          <dt>First note (MusicXML)</dt>
          <dd>{formatNoteRef(diagnostics.firstMusicXmlNote)}</dd>
        </div>
        <div>
          <dt>First note delta</dt>
          <dd>{diagnostics.firstNoteDeltaLabel}</dd>
        </div>
        <div>
          <dt>Pitch onset overlap</dt>
          <dd>
            {diagnostics.pitchOverlapPercent}%
            <span className="alignment-diagnostics__hint">
              {' '}
              (±{Math.round(diagnostics.onsetToleranceSeconds * 1000)} ms)
            </span>
          </dd>
        </div>
      </dl>
    </section>
  )
}
