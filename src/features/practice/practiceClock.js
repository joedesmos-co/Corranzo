export const PRACTICE_SYNC_STATUS = {
  NONE: 'none',
  MIDI_ONLY: 'midi-only',
  MUSICXML_ONLY: 'musicxml-only',
  BOTH_LOADED: 'both-loaded',
  FOLLOWING_MIDI: 'following-midi',
}

export const PRACTICE_SYNC_LABELS = {
  [PRACTICE_SYNC_STATUS.NONE]: 'No timing sources',
  [PRACTICE_SYNC_STATUS.MIDI_ONLY]: 'Playback file only',
  [PRACTICE_SYNC_STATUS.MUSICXML_ONLY]: 'Score timing file only',
  [PRACTICE_SYNC_STATUS.BOTH_LOADED]: 'Playback + timing file loaded',
  [PRACTICE_SYNC_STATUS.FOLLOWING_MIDI]: 'Following playback time',
}

export function getPracticeSyncStatus({ hasMidi, hasMusicXml, isPlaying }) {
  if (hasMusicXml && isPlaying) {
    return hasMidi ? PRACTICE_SYNC_STATUS.FOLLOWING_MIDI : PRACTICE_SYNC_STATUS.MUSICXML_ONLY
  }
  if (hasMidi && hasMusicXml) {
    return PRACTICE_SYNC_STATUS.BOTH_LOADED
  }
  if (hasMidi) {
    return PRACTICE_SYNC_STATUS.MIDI_ONLY
  }
  if (hasMusicXml) {
    return PRACTICE_SYNC_STATUS.MUSICXML_ONLY
  }
  return PRACTICE_SYNC_STATUS.NONE
}

export function canManualScrubMusicXml({ isPlaying }) {
  return !isPlaying
}

export function resolvePracticeTime({
  hasMusicXml,
  isPlaying,
  playbackCurrentTime,
  manualTime,
}) {
  if (!hasMusicXml) {
    return 0
  }

  if (isPlaying) {
    return playbackCurrentTime
  }

  return manualTime
}
