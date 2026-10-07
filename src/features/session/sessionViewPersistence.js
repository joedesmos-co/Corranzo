import { loadSessionMeta, saveSessionMeta } from './sessionPersistence.js'

/** Save navigation immediately without rewriting files or another score's metadata. */
export function updateSavedSessionView(activeView, pdfMeta, instrumentId) {
  const saved = loadSessionMeta()
  if (!saved || !saved.meta || !pdfMeta?.fileName || !Number.isFinite(pdfMeta.size)) return false
  const meta = saved.meta
  const sameFile = meta.pdfMeta?.fileName === pdfMeta.fileName && meta.pdfMeta?.size === pdfMeta.size && meta.pdfMeta?.lastModified === pdfMeta.lastModified
  if (!sameFile || (meta.instrumentId ?? 'piano') !== (instrumentId ?? 'piano')) return false
  if (meta.activeView === activeView) return true
  return saveSessionMeta({ ...meta, activeView, savedAt: Date.now() })
}
