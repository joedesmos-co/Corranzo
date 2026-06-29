/**
 * Multi-page layout consistency checks for experimental OMR.
 */
export function validateOmrMultiPageLayout(pageDiagnostics = []) {
  const pagesWithSystems = pageDiagnostics.filter((page) => page.systems?.length > 0)
  if (pagesWithSystems.length < 2) {
    return { inconsistent: false, pagesCompared: pagesWithSystems.length }
  }

  const systemCounts = pagesWithSystems.map((page) => page.systems.length)
  const minSystems = Math.min(...systemCounts)
  const maxSystems = Math.max(...systemCounts)
  const avgConfidence =
    pagesWithSystems.reduce((sum, page) => {
      const pageConfidence =
        page.systems.reduce((inner, system) => inner + (system.confidence ?? 0), 0) /
        Math.max(1, page.systems.length)
      return sum + pageConfidence
    }, 0) / pagesWithSystems.length

  const spread = maxSystems - minSystems
  const inconsistent = spread > 2 && avgConfidence < 0.62

  return {
    inconsistent,
    pagesCompared: pagesWithSystems.length,
    minSystems,
    maxSystems,
    spread,
    avgConfidence,
    warning: inconsistent
      ? `System count varies widely across pages (${minSystems}–${maxSystems}).`
      : null,
  }
}
