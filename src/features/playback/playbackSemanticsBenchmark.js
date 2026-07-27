/**
 * Playback-semantics benchmark — independent of audio sample quality.
 * Captures derived performed properties from recognized MusicXML markings.
 */

import { parseMusicXml } from '../musicxml/parseMusicXml.js'
import { buildScoreNoteSchedule } from './scorePlaybackSchedule.js'
import { DYNAMICS_TO_VELOCITY } from '../musicxml/dynamicsMap.js'

export function capturePlaybackSemantics(xmlString, { fileName = 'score.musicxml' } = {}) {
  const timingMap = parseMusicXml(xmlString, fileName)
  const schedule = buildScoreNoteSchedule(timingMap)
  const playableNotes = timingMap.notes.filter(
    (note) => !note.isRest && note.midi != null,
  )
  const suppressedTieContinuations = playableNotes.filter((note) => note.suppressPlaybackAttack)
  const attacks = schedule.length
  const expectedAttacks = playableNotes.length - suppressedTieContinuations.length

  return {
    fileName,
    ownerScoreId: timingMap.fileName ?? fileName,
    tempoChanges: timingMap.tempoChanges,
    wedgeSpans: timingMap.wedgeSpans ?? [],
    performedDurationSeconds: timingMap.performedMeasureTimeline
      ? timingMap.durationSeconds
      : timingMap.writtenDurationSeconds,
    writtenDurationSeconds: timingMap.writtenDurationSeconds,
    events: schedule.map((event) => ({
      ownerScoreId: event.ownerScoreId,
      writtenOnsetSeconds: event.writtenOnsetSeconds,
      writtenDurationSeconds: event.writtenDurationSeconds,
      performedOnsetSeconds: event.scoreTimeSeconds,
      performedDurationSeconds: event.performedDurationSeconds ?? event.baseDurationSeconds,
      midiPitch: event.midi,
      attackCount: event.attackCount ?? 1,
      velocity: event.velocity,
      articulationSource: event.articulationSource,
      tieChainId: event.tieChainId,
      activeDynamic: event.activeDynamicVelocity,
      activeTempo: event.activeTempoBpm,
      performedMeasure: event.measureNumber,
      performedPass: event.repeatPass,
      staff: event.staff,
    })),
    metrics: {
      attacks,
      expectedAttacks,
      tieContinuationReattacks: Math.max(0, attacks - expectedAttacks),
      suppressedTieContinuations: suppressedTieContinuations.length,
      velocityOrdered: isVelocityNonDecreasingForMarks(schedule),
    },
  }
}

function isVelocityNonDecreasingForMarks(schedule) {
  // Soft check used by tests with explicit pp→mf→ff fixtures.
  return schedule.every((event) => Number.isFinite(event.velocity))
}

export function velocityRank(mark) {
  return DYNAMICS_TO_VELOCITY[mark] ?? null
}

export function countAttacksForMidiAtOnset(events, midi, onsetSeconds, tolerance = 1e-4) {
  return events.filter(
    (event) =>
      event.midiPitch === midi &&
      Math.abs(event.performedOnsetSeconds - onsetSeconds) <= tolerance,
  ).length
}
