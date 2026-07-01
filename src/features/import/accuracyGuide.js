/**
 * Help users understand which file combinations give reliable Practice features.
 */

export const ACCURACY_TIERS = [
  {
    id: 'best',
    label: 'Best',
    summary: 'Sheet music + timing file',
    detail:
      'Timing from your notation app powers Wait For You, loops, and an accurate score cursor.',
  },
  {
    id: 'good',
    label: 'Ready',
    summary: 'PDF + timing file',
    detail:
      'The PDF is what you read; the timing file tells Corranzo where measures and beats are. This is the recommended Practice setup today.',
  },
  {
    id: 'basic',
    label: 'Basic',
    summary: 'PDF only',
    detail:
      'Read and annotate the score, but without a timing file Corranzo cannot follow measures or notes exactly.',
  },
]

export function evaluateAccuracySetup({ hasPdf, hasMusicXml }) {
  if (hasPdf && hasMusicXml) {
    return {
      tierId: 'good',
      tier: ACCURACY_TIERS.find((item) => item.id === 'good'),
      headline: 'Ready for Practice',
      detail: 'Sheet music and timing are loaded — you are set for accurate follow-along.',
    }
  }

  if (hasPdf) {
    return {
      tierId: 'basic',
      tier: ACCURACY_TIERS.find((item) => item.id === 'basic'),
      headline: 'PDF only so far',
      detail: 'Add a timing file next — that is what makes Practice interactive.',
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
    detail: 'Upload your sheet music PDF, then add a timing file from your notation app.',
  }
}

export function buildLibraryAccuracyWarnings({ hasPdf, hasMusicXml, hasMidi }) {
  const warnings = []

  if (hasPdf && !hasMusicXml) {
    warnings.push({
      id: 'pdf-only',
      strength: 'strong',
      message:
        'PDF alone cannot provide exact measure timing or note-following. Add a timing file for accurate Practice features.',
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
