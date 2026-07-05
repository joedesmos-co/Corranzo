/** OMR / import messages that describe approximation — not blocking errors. */
export const APPROXIMATION_WARNING_PATTERN =
  /TAB notes detected|Dense TAB notes|Repeat\/coda|Capo marking|Chord sheet detected|rhythm is approximate|steady chord changes/i

export const IMPORT_WARNING_KIND = {
  CRITICAL: 'critical',
  APPROXIMATION: 'approximation',
  INFO: 'info',
}

export function isApproximationImportMessage(message) {
  return APPROXIMATION_WARNING_PATTERN.test(String(message ?? ''))
}

export function classifyImportWarning(warning) {
  const message = warning?.message ?? ''
  if (warning?.strength === 'strong' && !isApproximationImportMessage(message)) {
    return IMPORT_WARNING_KIND.CRITICAL
  }
  if (isApproximationImportMessage(message)) {
    return IMPORT_WARNING_KIND.APPROXIMATION
  }
  return IMPORT_WARNING_KIND.INFO
}

export function partitionImportWarnings(warnings = []) {
  const critical = []
  const disclosure = []

  for (const warning of warnings.filter((item) => item?.message)) {
    const kind = classifyImportWarning(warning)
    if (kind === IMPORT_WARNING_KIND.CRITICAL) {
      critical.push(warning)
    } else {
      disclosure.push(warning)
    }
  }

  return { critical, disclosure }
}
