/**
 * Legacy entry — delegates to semi-auto analysis + immediate apply.
 * Prefer analyzeSemiAutoScoreSetup + user confirmation in the UI.
 */
import { analyzeSemiAutoScoreSetup } from './semiAutoScoreAlignment.js'

export async function generateAutoScoreAlignment(options) {
  const result = await analyzeSemiAutoScoreSetup(options)
  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      confidence: 0,
    }
  }

  const { preview } = result
  if (preview.lowConfidence) {
    return {
      ok: false,
      message:
        preview.validationMessage ||
        'Could not align this score reliably enough to apply automatically. Review staff systems in Setup, or mark manually.',
      confidence: preview.confidence,
      diagnostics: preview,
    }
  }

  return {
    ok: true,
    anchors: preview.proposedAnchors,
    confidence: preview.confidence,
    diagnostics: preview,
  }
}
