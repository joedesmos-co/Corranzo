import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ANCHOR_SOURCE,
  filterAutoAnchorsReplacedByManual,
  isAutomaticAnchorSource,
  isManualAnchorSource,
  mergeAutomaticAnchors,
} from './anchorUtils.js'
import {
  createAnchorId,
  loadScoreFollowAnchors,
  saveScoreFollowAnchors,
} from './scoreFollowStorage.js'

function sortAnchors(anchors) {
  return [...anchors].sort((left, right) => left.measureNumber - right.measureNumber)
}

const KNOWN_SOURCES = new Set(Object.values(ANCHOR_SOURCE))

function normalizeAnchorSourceValue(source, meta) {
  if (KNOWN_SOURCES.has(source)) {
    if (source === ANCHOR_SOURCE.AUTO) {
      return ANCHOR_SOURCE.AUTO_SYSTEM
    }
    return source
  }
  if (meta?.role === 'system-start' || meta?.role === 'system-end') {
    return ANCHOR_SOURCE.AUTO_SYSTEM
  }
  return ANCHOR_SOURCE.MANUAL
}

function normalizeAnchor(anchor) {
  const source = normalizeAnchorSourceValue(anchor.source, anchor.meta)
  return {
    ...anchor,
    page: Number(anchor.page),
    x: Math.min(1, Math.max(0, anchor.x)),
    y: Math.min(1, Math.max(0, anchor.y)),
    measureNumber: Number(anchor.measureNumber),
    source,
  }
}

function anchorsForPersistence(anchors) {
  return anchors.filter((anchor) => anchor.source !== ANCHOR_SOURCE.DEMO)
}

function splitManualAndAutomatic(anchors) {
  const manual = []
  const automatic = []
  for (const anchor of anchors) {
    if (isManualAnchorSource(anchor.source)) {
      manual.push(anchor)
    } else if (isAutomaticAnchorSource(anchor.source)) {
      automatic.push(anchor)
    }
  }
  return { manual, automatic }
}

export default function useScoreFollowAnchors({ fingerprint, fileName }) {
  const [anchors, setAnchors] = useState([])
  const [hydratedKey, setHydratedKey] = useState(null)
  const [storageWarning, setStorageWarning] = useState(null)
  const storageKeyRef = useRef(null)

  const storageKey = fingerprint || fileName || null

  useEffect(() => {
    storageKeyRef.current = storageKey

    if (!storageKey) {
      setAnchors([])
      setHydratedKey(null)
      setStorageWarning(null)
      return
    }

    const loaded = loadScoreFollowAnchors({ fingerprint, fileName }).map(normalizeAnchor)
    setAnchors(loaded)
    setHydratedKey(storageKey)
    setStorageWarning(null)
  }, [storageKey, fingerprint, fileName])

  useEffect(() => {
    if (!fingerprint || !storageKey || hydratedKey !== storageKey) {
      return
    }
    const result = saveScoreFollowAnchors(fingerprint, anchorsForPersistence(anchors))
    if (result?.ok === false && result.reason === 'quota') {
      setStorageWarning(
        'Score-follow anchors could not be saved in this browser (storage full). They will work until you refresh.',
      )
    } else {
      setStorageWarning(null)
    }
  }, [fingerprint, storageKey, hydratedKey, anchors])

  const addAnchor = useCallback(({ page, x, y, measureNumber, source = ANCHOR_SOURCE.MANUAL }) => {
    const anchor = normalizeAnchor({
      id: createAnchorId(),
      page,
      x,
      y,
      measureNumber,
      source,
    })
    setAnchors((previous) => sortAnchors([...previous, anchor]))
    return anchor
  }, [])

  const placeManualAnchor = useCallback(({ page, x, y, measureNumber }) => {
    let created = null
    setAnchors((previous) => {
      const withoutReplaced = filterAutoAnchorsReplacedByManual(previous, {
        page,
        x,
        y,
        measureNumber,
      })
      created = normalizeAnchor({
        id: createAnchorId(),
        page,
        x,
        y,
        measureNumber,
        source: ANCHOR_SOURCE.MANUAL,
      })
      return sortAnchors([...withoutReplaced, created])
    })
    return created
  }, [])

  const setAutoAnchors = useCallback((autoAnchors) => {
    setAnchors((previous) => {
      const { manual } = splitManualAndAutomatic(previous)
      const normalizedAuto = autoAnchors.map((anchor) =>
        normalizeAnchor({
          ...anchor,
          id: anchor.id ?? createAnchorId(),
          source:
            anchor.source === ANCHOR_SOURCE.AUTO_MEASURE
              ? ANCHOR_SOURCE.AUTO_MEASURE
              : ANCHOR_SOURCE.AUTO_SYSTEM,
        }),
      )
      return sortAnchors(
        mergeAutomaticAnchors([manual, normalizedAuto]),
      )
    })
  }, [])

  const setSupplementalAnchors = useCallback((supplementalAnchors) => {
    setAnchors((previous) => {
      const { manual, automatic } = splitManualAndAutomatic(previous)
      const systemAnchors = automatic.filter(
        (anchor) =>
          anchor.source === ANCHOR_SOURCE.AUTO_SYSTEM ||
          anchor.source === ANCHOR_SOURCE.AUTO ||
          anchor.meta?.role === 'system-start' ||
          anchor.meta?.role === 'system-end',
      )
      const normalized = supplementalAnchors.map((anchor) =>
        normalizeAnchor({
          ...anchor,
          id: anchor.id ?? createAnchorId(),
        }),
      )
      return sortAnchors(
        mergeAutomaticAnchors([manual, systemAnchors, normalized]),
      )
    })
  }, [])

  const clearAutoAnchors = useCallback(() => {
    setAnchors((previous) =>
      previous.filter((anchor) => !isAutomaticAnchorSource(anchor.source)),
    )
  }, [])

  const deleteAnchor = useCallback((anchorId) => {
    setAnchors((previous) => previous.filter((anchor) => anchor.id !== anchorId))
  }, [])

  const clearAnchors = useCallback(() => {
    setAnchors([])
  }, [])

  const clearManualAnchors = useCallback(() => {
    setAnchors((previous) =>
      previous.filter((anchor) => !isManualAnchorSource(anchor.source)),
    )
  }, [])

  const setBundledDemoAnchors = useCallback((demoAnchors) => {
    setAnchors((previous) => {
      const manual = previous.filter((anchor) => isManualAnchorSource(anchor.source))
      const bundled = demoAnchors.map((anchor) =>
        normalizeAnchor({
          ...anchor,
          source: ANCHOR_SOURCE.DEMO,
        }),
      )
      return sortAnchors([...manual, ...bundled])
    })
  }, [])

  const clearBundledDemoAnchors = useCallback(() => {
    setAnchors((previous) =>
      previous.filter((anchor) => anchor.source !== ANCHOR_SOURCE.DEMO),
    )
  }, [])

  return {
    anchors,
    addAnchor,
    placeManualAnchor,
    setAutoAnchors,
    setSupplementalAnchors,
    clearAutoAnchors,
    deleteAnchor,
    clearAnchors,
    clearManualAnchors,
    setBundledDemoAnchors,
    clearBundledDemoAnchors,
    isHydrated: hydratedKey === storageKey,
    storageWarning,
  }
}
