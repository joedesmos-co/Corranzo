import { describe, expect, it } from 'vitest'
import {
  MIC_DIAGNOSTIC,
  micDiagnosticLabel,
  resolveMicDiagnostic,
} from '../src/features/microphone-input/micDiagnosticState.js'
import { MIC_CALIBRATION_STATUS } from '../src/features/microphone-input/micCalibration.js'
import { MIC_SIGNAL_QUALITY } from '../src/features/microphone-input/micSignalQuality.js'

describe('mic diagnostic state', () => {
  it('maps calibration and signal quality to user-facing diagnostics', () => {
    expect(
      resolveMicDiagnostic({
        calibrationStatus: MIC_CALIBRATION_STATUS.NO_INPUT,
        signalQuality: MIC_SIGNAL_QUALITY.SILENT,
      }),
    ).toBe(MIC_DIAGNOSTIC.NO_INPUT)

    expect(
      resolveMicDiagnostic({ signalQuality: MIC_SIGNAL_QUALITY.TOO_QUIET }),
    ).toBe(MIC_DIAGNOSTIC.TOO_QUIET)

    expect(
      resolveMicDiagnostic({ signalQuality: MIC_SIGNAL_QUALITY.TOO_NOISY }),
    ).toBe(MIC_DIAGNOSTIC.TOO_NOISY)

    expect(
      resolveMicDiagnostic({ signalQuality: MIC_SIGNAL_QUALITY.WEAK }),
    ).toBe(MIC_DIAGNOSTIC.UNCLEAR_PITCH)

    expect(
      resolveMicDiagnostic({
        signalQuality: MIC_SIGNAL_QUALITY.UNSTABLE,
        stabilizerPending: true,
      }),
    ).toBe(MIC_DIAGNOSTIC.UNSTABLE)

    expect(
      resolveMicDiagnostic({ wrongPitch: true, signalQuality: MIC_SIGNAL_QUALITY.GOOD }),
    ).toBe(MIC_DIAGNOSTIC.WRONG_PITCH)

    expect(resolveMicDiagnostic({ chordUnsupported: true })).toBe(
      MIC_DIAGNOSTIC.CHORD_UNSUPPORTED,
    )
  })

  it('returns readable labels', () => {
    expect(micDiagnosticLabel(MIC_DIAGNOSTIC.CHORD_UNSUPPORTED)).toContain('one note at a time')
    expect(micDiagnosticLabel(MIC_DIAGNOSTIC.UNSTABLE)).toContain('stable')
  })
})
