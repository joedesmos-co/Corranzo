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

/**
 * Phase 4 (flag-gated, diagnostics-only) next-gen alignment summary. Surfaces
 * the new reconciliation / confidence-decision / anchor-coverage view-model.
 * Rendered ONLY when `nextGen` is supplied (the score-follow hook supplies it
 * only when the feature flag is enabled), so default behavior is unchanged.
 */
function NextGenAlignmentBlock({ nextGen, showCandidates, onToggleCandidates }) {
  if (!nextGen?.available) {
    return null
  }
  const { decision, layoutConfidenceLabel, coverage, model, pageSystem } = nextGen
  const missing = coverage?.missingMeasures ?? []
  const weak = coverage?.weakSystems ?? []
  return (
    <details className="alignment-diagnostics__nextgen">
      <summary>Alignment engine (diagnostics)</summary>
      <p className="alignment-diagnostics__nextgen-note">
        Experimental next-gen alignment. Diagnostics only — does not drive the
        cursor or change setup.
      </p>
      <dl className="alignment-diagnostics__grid">
        <div>
          <dt>Recommended action</dt>
          <dd>{decision?.label ?? decision?.action ?? '—'}</dd>
        </div>
        <div>
          <dt>Layout confidence</dt>
          <dd>{layoutConfidenceLabel ?? nextGen.layoutConfidence ?? '—'}</dd>
        </div>
        <div>
          <dt>Anchor coverage</dt>
          <dd>
            {coverage
              ? `${coverage.measuresCovered}/${coverage.measuresExpected} (${coverage.trust})`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Missing measures</dt>
          <dd>{missing.length ? `${missing.length} (m${missing.join(', m')})` : 'none'}</dd>
        </div>
        <div>
          <dt>Weak systems</dt>
          <dd>{weak.length ? weak.map((index) => index + 1).join(', ') : 'none'}</dd>
        </div>
        <div>
          <dt>Page/system</dt>
          <dd>{pageSystem?.label ?? '—'}</dd>
        </div>
      </dl>

      {(decision?.reasons ?? []).length > 0 && (
        <ul className="alignment-diagnostics__nextgen-reasons">
          {decision.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      {(model ?? []).length > 0 && (
        <ul className="alignment-diagnostics__nextgen-model">
          {model.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {onToggleCandidates && (
        <label className="alignment-diagnostics__nextgen-toggle">
          <input
            type="checkbox"
            checked={Boolean(showCandidates)}
            onChange={(event) => onToggleCandidates(event.target.checked)}
          />
          Show candidate anchors on the score (debug overlay)
        </label>
      )}
    </details>
  )
}

export default function AlignmentDiagnosticsSection({
  diagnostics,
  isLoading,
  error,
  nextGen = null,
  showCandidates = false,
  onToggleCandidates = null,
}) {
  const nextGenBlock = (
    <NextGenAlignmentBlock
      nextGen={nextGen}
      showCandidates={showCandidates}
      onToggleCandidates={onToggleCandidates}
    />
  )
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
        {nextGenBlock}
      </section>
    )
  }

  if (!diagnostics) {
    if (!nextGen?.available) {
      return null
    }
    return (
      <section className="alignment-diagnostics" aria-label="Alignment diagnostics">
        <h4 className="alignment-diagnostics__title">Alignment diagnostics</h4>
        {nextGenBlock}
      </section>
    )
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
      {nextGenBlock}
    </section>
  )
}
