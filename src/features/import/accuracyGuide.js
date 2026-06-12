/**
 * Help users understand which file combinations give reliable Practice features.
 */

export const ACCURACY_TIERS = [
  {
    id: 'best',
    label: 'Best',
    summary: 'Source notation or MusicXML / MXL',
    detail:
      'Timing from your notation app (MusicXML, MXL, or future MuseScore .mscz/.mscx) — powers Wait For You, loops, and accurate score follow.',
  },
  {
    id: 'good',
    label: 'Good',
    summary: 'PDF + MusicXML / MXL',
    detail:
      'The PDF is what you read; the timing file tells ScoreFlow where measures and beats are. This is the recommended Practice setup today.',
  },
  {
    id: 'basic',
    label: 'Basic',
    summary: 'PDF only',
    detail:
      'Read and annotate the score, but without a timing file ScoreFlow cannot follow measures or notes exactly.',
  },
]

export function evaluateAccuracySetup({ hasPdf, hasMusicXml }) {
  if (hasPdf && hasMusicXml) {
    return {
      tierId: 'good',
      tier: ACCURACY_TIERS.find((item) => item.id === 'good'),
      headline: 'Ready for Practice',
      detail: 'PDF and score timing are loaded — you are set for accurate follow-along.',
    }
  }

  if (hasPdf) {
    return {
      tierId: 'basic',
      tier: ACCURACY_TIERS.find((item) => item.id === 'basic'),
      headline: 'PDF only so far',
      detail: 'Add MusicXML or MXL next — that is what makes Practice interactive.',
    }
  }

  if (hasMusicXml && !hasPdf) {
    return {
      tierId: 'partial',
      tier: null,
      headline: 'Timing loaded — add your PDF',
      detail: 'Upload the matching sheet music PDF so you can see the score while practicing.',
    }
  }

  return {
    tierId: 'empty',
    tier: null,
    headline: 'Start here',
    detail: 'Upload a PDF, then MusicXML/MXL from your notation app.',
  }
}

export function buildLibraryAccuracyWarnings({ hasPdf, hasMusicXml, hasMidi }) {
  const warnings = []

  if (hasPdf && !hasMusicXml) {
    warnings.push({
      id: 'pdf-only',
      strength: 'strong',
      message:
        'PDF alone cannot provide exact measure timing or note-following. Add MusicXML/MXL (or MuseScore export when supported) for accurate Practice features.',
    })
  }

  if (hasMidi && !hasMusicXml) {
    warnings.push({
      id: 'midi-only-timing',
      strength: 'strong',
      message:
        'MIDI is for optional playback sound only — it does not place measures on your PDF or power Wait For You.',
    })
  }

  if (hasMidi && !hasPdf && hasMusicXml) {
    warnings.push({
      id: 'midi-without-pdf',
      strength: 'mild',
      message: 'Add a PDF of the same piece so you can see the score while practicing.',
    })
  }

  return warnings
}
