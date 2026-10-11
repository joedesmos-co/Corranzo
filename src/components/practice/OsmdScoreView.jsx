/**
 * Engraved score surface for MusicXML-only practice (arrangements).
 *
 * Presentation of the canonical PracticeSession: it paints engine per-note
 * states onto real OSMD noteheads and moves the OSMD cursor with the
 * canonical practice clock. It contains no evaluator, no matching and no
 * scheduling.
 *
 * States come from the same pure engine helpers the PDF overlay uses
 * (resolveWfyScoreNoteStates / play along lane outcomes) — never from
 * geometry, so this surface works without a PDF or source visual map.
 */
import { useEffect, useMemo, useRef } from 'react'
import useOsmdEngraving from '../../features/practice/useOsmdEngraving.js'
import {
  OSMD_NOTE_COLORS,
  cursorPositionFor,
  matchCheckpointNotes,
  measureStartsByNumber,
  moveOsmdCursor,
  musicalQuartersAtTime,
  pairOsmdNotes,
  timingUsesRepeats,
} from '../../features/practice/osmdEngraving.js'
import { buildNoteCheckpoints } from '../../features/practice/waitForYouCheckpoints.js'
import {
  SCORE_NOTE_STATE,
  findScoreEventIndexAtTime,
  mapPlayAlongOutcomeToScoreState,
  resolveChordToneStates,
  resolveWfyScoreNoteStates,
} from '../../features/practice/scoreNoteStates.js'
import { usePracticeTick } from '../../context/PracticeTickContext.jsx'
import { usePracticeSessionContext } from '../../context/PracticeSessionContext.jsx'

function stateColor(state) {
  switch (state) {
    case SCORE_NOTE_STATE.COMPLETED:
      return OSMD_NOTE_COLORS.completed
    case SCORE_NOTE_STATE.WRONG:
      return OSMD_NOTE_COLORS.wrong
    case SCORE_NOTE_STATE.MISSED:
      return OSMD_NOTE_COLORS.missed
    default:
      return OSMD_NOTE_COLORS.current
  }
}

/** Group whose onset is within 11 ms of a checkpoint (same rule as the PDF lane). */
function groupAtOnset(groups, timeSeconds) {
  let best = null
  let bestDelta = 0.011
  for (const group of groups ?? []) {
    const delta = Math.abs(Number(group.timeSeconds) - Number(timeSeconds))
    if (delta < bestDelta) {
      best = group
      bestDelta = delta
    }
  }
  return best
}

export default function OsmdScoreView({ musicXmlSource = null }) {
  const xml = musicXmlSource?.data ? new TextDecoder().decode(musicXmlSource.data) : null
  const targetPart = musicXmlSource?.omrMeta?.arrangement?.targetPart ?? null
  const { session } = usePracticeSessionContext()
  const timingMap = session?.timing?.timingMap ?? null
  const tick = usePracticeTick()
  const { containerRef, ready, error, noteIndex, paint, clearAll, scrollToNote, osmdRef } =
    useOsmdEngraving({ xml, targetPart })

  const measureStarts = useMemo(() => measureStartsByNumber(timingMap), [timingMap])
  // Ordered pairing between canonical notes and engraved notes, rebuilt only
  // when either side changes (score render / new timing map).
  const pairs = useMemo(
    () => (timingMap && noteIndex ? pairOsmdNotes(timingMap, noteIndex.allNotes) : null),
    [timingMap, noteIndex],
  )
  // Engine states, geometry-free: [{ checkpoint, state, toneStates }].
  const scoreStates = useMemo(() => {
    if (!timingMap) return []
    const loopRegion = session.isWaitForYou && session.loop?.enabled ? session.loop.region : null
    const checkpoints = session.isWaitForYou
      ? session.waitForYou.checkpoints ?? []
      : buildNoteCheckpoints(timingMap, loopRegion, { practiceScope: session.practiceScope })
    const practiceTime = Number(tick?.practiceTime ?? 0)

    if (session.isWaitForYou) {
      const states = resolveWfyScoreNoteStates({
        checkpoints,
        checkpointIndex: session.waitForYou.checkpointIndex ?? -1,
        status: session.waitForYou.status,
        inputFeedback: session.waitForYouInput?.inputFeedback ?? null,
      })
      const currentIndex = session.waitForYou.checkpointIndex ?? -1
      const currentCheckpoint = checkpoints[currentIndex] ?? null
      const matched = session.waitForYouInput?.inputFeedback?.matchedIndices
      const toneStates =
        currentCheckpoint?.isChord && matched != null
          ? resolveChordToneStates(currentCheckpoint, matched)
          : null
      const ordered = [...states.keys()].sort((a, b) => a - b).slice(-101)
      return ordered.map((index) => ({
        checkpoint: checkpoints[index] ?? null,
        state: states.get(index),
        toneStates: index === currentIndex ? toneStates : null,
      }))
    }

    const index = findScoreEventIndexAtTime(checkpoints, practiceTime)
    if (session.isPlayAlong) {
      const groups = session.playAlongLaneGroups ?? []
      const outcomes = session.playAlongFeedback?.outcomes ?? new Map()
      const entries = []
      if (index >= 0 && checkpoints[index]) {
        const group = groupAtOnset(groups, checkpoints[index].timeSeconds)
        const outcome = group ? outcomes.get(group.id) ?? null : null
        entries.push({
          checkpoint: checkpoints[index],
          state: outcome ? mapPlayAlongOutcomeToScoreState(outcome) : SCORE_NOTE_STATE.CURRENT,
          toneStates: null,
        })
        // Decided trail (bounded) so past misses stay visible but muted.
        let resolved = 0
        for (let i = index - 1; i >= 0 && resolved < 48; i -= 1) {
          const checkpoint = checkpoints[i]
          if (!checkpoint) continue
          const groupAt = groupAtOnset(groups, checkpoint.timeSeconds)
          const outcomeAt = groupAt ? outcomes.get(groupAt.id) ?? null : null
          if (!outcomeAt) continue
          entries.push({
            checkpoint,
            state: mapPlayAlongOutcomeToScoreState(outcomeAt),
            toneStates: null,
          })
          resolved += 1
        }
      }
      return entries
    }

    // Preview: highlight the note currently sounding.
    return index >= 0 && checkpoints[index]
      ? [{ checkpoint: checkpoints[index], state: SCORE_NOTE_STATE.CURRENT, toneStates: null }]
      : []
  }, [
    timingMap,
    session.isWaitForYou,
    session.isPlayAlong,
    session.waitForYou,
    session.waitForYouInput,
    session.playAlongLaneGroups,
    session.playAlongFeedback,
    session.loop?.enabled,
    session.loop?.region,
    session.practiceScope,
    tick?.practiceTime,
  ])

  // Paint canonical per-note states. Repaint only when the state signature
  // changes so the score is not touched on every clock tick.
  const lastSignatureRef = useRef('')
  const resolvedRef = useRef(new Map())
  useEffect(() => {
    if (!ready || !pairs) return
    const signature = scoreStates
      .map((entry) => {
        const tones = Array.isArray(entry.toneStates)
          ? entry.toneStates.map((tone) => `${tone.midi}:${tone.completed ? 1 : 0}`).join(',')
          : ''
        return `${entry.checkpoint?.id ?? 'none'}:${entry.state}:${tones}`
      })
      .join('|')
    if (signature === lastSignatureRef.current) return
    lastSignatureRef.current = signature
    clearAll()
    for (const entry of scoreStates) {
      const matched = matchCheckpointNotes(pairs, entry.checkpoint)
      if (matched.notes.length === 0) continue
      resolvedRef.current.set(entry.checkpoint?.id ?? '', matched)
      if (Array.isArray(entry.toneStates) && entry.toneStates.length > 0) {
        // Partial chords split per tone: each notehead carries its own state.
        const colorFor = new Map()
        for (const tone of entry.toneStates) {
          colorFor.set(
            Number(tone.midi),
            tone.completed ? OSMD_NOTE_COLORS.toneDone : OSMD_NOTE_COLORS.toneNeeded,
          )
        }
        for (const note of matched.notes) {
          paint([note], colorFor.get(note.midi) ?? stateColor(entry.state))
        }
      } else {
        paint(matched.notes, stateColor(entry.state))
      }
    }
  }, [ready, noteIndex, scoreStates, pairs, clearAll, paint])

  if (typeof window !== 'undefined') {
  }

  // Cursor: canonical practice clock -> written musical quarters -> OSMD cursor.
  const practiceTime = Number(tick?.practiceTime ?? 0)
  const lastQuarterRef = useRef(Number.NaN)
  useEffect(() => {
    if (!ready || !osmdRef.current?.cursor) return
    const { quarter } = musicalQuartersAtTime(timingMap, practiceTime, measureStarts)
    if (!Number.isFinite(quarter)) return
    const rounded = Math.round(quarter * 1000) / 1000
    if (rounded === lastQuarterRef.current) return
    lastQuarterRef.current = rounded
    const position = cursorPositionFor(quarter, measureStarts)
    moveOsmdCursor(osmdRef.current.cursor, position)
  }, [ready, practiceTime, timingMap, measureStarts, osmdRef])

  // Keep the current musical position visible while playing.
  const isPlaying = Boolean(tick?.playbackIsPlaying)
  useEffect(() => {
    if (!ready || !isPlaying || !resolvedRef.current.size) return
    const entry = scoreStates[0]
    const matched = entry ? resolvedRef.current.get(entry.checkpoint?.id ?? '') : null
    if (matched?.notes?.length) scrollToNote(matched.notes[0])
  }, [isPlaying, practiceTime, ready, scoreStates, scrollToNote])

  if (!xml) return null
  if (error) {
    return (
      <div className="osmd-score osmd-score--error" role="status">
        <p>This arrangement could not be engraved on this device.</p>
        <p className="audio-vision-hint">Timing, sound and practice still work from the notation.</p>
      </div>
    )
  }
  return (
    <div className="osmd-score">
      <div
        ref={containerRef}
        className={`osmd-score__container${ready ? ' osmd-score__container--ready' : ''}`}
        data-osmd-ready={ready ? 'true' : 'false'}
        data-osmd-target={targetPart ?? 'unknown'}
        role="img"
        aria-label={ready ? 'Engraved sheet music with practice highlights. The target list below states every note.' : 'Engraving sheet music…'}
      />
      {pairs?.approximate && (
        <p className="audio-vision-hint osmd-score__approx" role="note">
          Highlight position is approximate on this score (repeats). Timing and practice are exact.
        </p>
      )}
    </div>
  )
}
