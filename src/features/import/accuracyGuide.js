/**
 * Help users understand which file combinations give reliable Practice features.
 */

export const ACCURACY_TIERS = [
  {
    id: 'best',
    label: 'Best',
    summary: 'Sheet music + timing file',
    detail:
      'Timing powers Wait For You, loops, and the score cursor.',
  },
  {
    id: 'good',
    label: 'Ready',
    summary: 'PDF + timing file',
    detail:
      'Recommended Practice setup: PDF to read, timing file for measures and beats.',
  },
  {
    id: 'basic',
    label: 'Basic',
    summary: 'PDF only',
    detail:
      'PDF-only generated scores are experimental — use PDF + a timing file for reliable Practice.',
  },
]

export function evaluateAccuracySetup({ hasPdf, hasMusicXml }) {
  if (hasPdf && hasMusicXml) {
    return {
      tierId: 'good',
      tier: ACCURACY_TIERS.find((item) => item.id === 'good'),
      headline: 'Ready for Practice',
      detail: 'Sheet music and timing loaded.',
    }
  }

  if (hasPdf) {
    return {
      tierId: 'basic',
      tier: ACCURACY_TIERS.find((item) => item.id === 'basic'),
      headline: 'Setting up your music',
      detail: 'Corranzo is generating practice timing from your PDF.',
    }
  }

  if (hasMusicXml && !hasPdf) {
    return {
      tierId: 'partial',
      tier: null,
      headline: 'Timing loaded — add your PDF',
      detail: 'Upload the matching sheet music PDF.',
    }
  }

  return {
    tierId: 'empty',
    tier: null,
    headline: 'Start here',
    detail: 'Upload a PDF to set up your music automatically.',
  }
}

export function buildLibraryAccuracyWarnings({ hasPdf, hasMusicXml, hasMidi }) {
  const warnings = []

  if (hasPdf && !hasMusicXml) {
    warnings.push({
      id: 'pdf-only',
      strength: 'strong',
      message:
        'PDF alone cannot time measures. Add a timing file for accurate Practice.',
    })
  }

  if (hasMidi && !hasMusicXml) {
    warnings.push({
      id: 'midi-only-timing',
      strength: 'strong',
      message:
        'MIDI is optional sound only — it does not time the PDF or Wait For You.',
    })
  }

  if (hasMidi && !hasPdf && hasMusicXml) {
    warnings.push({
      id: 'midi-without-pdf',
      strength: 'mild',
      message: 'Add the matching PDF to see the score while practicing.',
    })
  }

  return warnings
}
