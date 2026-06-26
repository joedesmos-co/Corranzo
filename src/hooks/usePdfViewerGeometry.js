import { useCallback, useMemo } from 'react'
import { usePracticeSessionContextOptional } from '../context/PracticeSessionContext.jsx'
import { computeDocumentDisplayReference } from '../utils/pdfFit.js'
import {
  getPageViewRotation as resolveStoredPageViewRotation,
  normalizeViewRotation,
} from '../utils/pdfPageViewRotation.js'

function resolvePageViewRotationFromSources(pageNumber, pageViewRotations, orientation) {
  if (pageViewRotations?.[pageNumber] != null) {
    return resolveStoredPageViewRotation(pageViewRotations, pageNumber)
  }

  const orientPage = orientation?.pages?.find((entry) => entry.page === pageNumber)
  return normalizeViewRotation(orientPage?.rotation ?? 0)
}

export function serializePageViewRotations(pageViewRotations = {}) {
  return Object.keys(pageViewRotations)
    .map(Number)
    .sort((a, b) => a - b)
    .map((page) => `${page}:${normalizeViewRotation(pageViewRotations[page])}`)
    .join('|')
}

/**
 * Shared PDF viewer rotation + document scale reference from score-follow auto-setup.
 * Used by Library and Practice viewers so both apply the same page geometry.
 */
export default function usePdfViewerGeometry({
  pageSizesByPage = {},
  pageSizesVersion = 0,
  currentPageSize = null,
}) {
  const scoreFollow = usePracticeSessionContextOptional()?.scoreFollow ?? null
  const orientation =
    scoreFollow?.calibrationDebugSnapshot?.orientation ??
    scoreFollow?.semiAutoSetup?.preview?.orientation ??
    null
  const pageViewRotations = scoreFollow?.pageViewRotations ?? {}

  const referenceDisplaySize = useMemo(
    () => computeDocumentDisplayReference(pageSizesByPage, pageViewRotations, orientation),
    [pageSizesByPage, pageSizesVersion, pageViewRotations, orientation, currentPageSize],
  )

  const getPageViewRotation = useCallback(
    (pageNumber) =>
      resolvePageViewRotationFromSources(pageNumber, pageViewRotations, orientation),
    [orientation, pageViewRotations],
  )

  const viewerRotationKey = useMemo(
    () => serializePageViewRotations(pageViewRotations),
    [pageViewRotations],
  )

  return {
    orientation,
    pageViewRotations,
    referenceDisplaySize,
    getPageViewRotation,
    viewerRotationKey,
  }
}
