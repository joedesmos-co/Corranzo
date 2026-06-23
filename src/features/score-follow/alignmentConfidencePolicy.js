/**
 * Next-gen automatic score alignment — Phase 1: confidence → action policy.
 *
 * Turns a layout-confidence grade + reconciliation result into one of three
 * safe actions (Objective 5). The guiding rule is "never confidently show a
 * wrong cursor": any hard reconciliation conflict downgrades to manual setup.
 *
 *   high   → auto-follow
 *   medium → quick user confirmation
 *   low    → simple manual setup
 *
 * Pure function; no side effects, no engine coupling.
 */
import { LAYOUT_CONFIDENCE } from './layoutAssessment.js'

export const FOLLOW_ACTION = {
  AUTO: 'auto',
  CONFIRM: 'confirm',
  MANUAL: 'manual',
}

export const FOLLOW_ACTION_LABEL = {
  [FOLLOW_ACTION.AUTO]: 'Auto-follow',
  [FOLLOW_ACTION.CONFIRM]: 'Quick confirmation',
  [FOLLOW_ACTION.MANUAL]: 'Manual setup',
}

// Per-system confidence thresholds (see alignmentReconciliation.systemConfidence).
export const HIGH_SYSTEM_CONFIDENCE = 0.8
export const MEDIUM_SYSTEM_CONFIDENCE = 0.55

function fmt(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '—'
}

/**
 * @param {object} params
 * @param {string|null} [params.layoutConfidence] one of LAYOUT_CONFIDENCE.*
 * @param {object|null} [params.reconciliation]   result of reconcilePdfLayoutWithScore
 * @returns {{ action: string, reasons: string[] }}
 */
export function decideFollowAction({ layoutConfidence = null, reconciliation = null } = {}) {
  const totals = reconciliation?.totals ?? null
  const flags = reconciliation?.flags ?? null
  const minConfidence = totals?.minConfidence ?? null
  const weakCount = flags?.weakSystems?.length ?? 0

  // 1. Hard stops — always fall back to manual setup.
  if (layoutConfidence === LAYOUT_CONFIDENCE.NEEDS_SETUP) {
    return manual(['Layout confidence: quick setup recommended.'])
  }
  if (flags?.barlineTotalMismatch) {
    return manual(['Detected barline total does not match the score measure count.'])
  }
  if (totals && totals.systemCount > 0 && minConfidence != null && minConfidence < MEDIUM_SYSTEM_CONFIDENCE) {
    return manual([`A system is too weak to follow automatically (min confidence ${fmt(minConfidence)}).`])
  }
  if (weakCount >= 2) {
    return manual([`${weakCount} systems have weak detection — manual setup is safer.`])
  }

  // 2. High confidence — auto-follow.
  if (layoutConfidence === LAYOUT_CONFIDENCE.EXACT) {
    return auto(['Exact follow: PDF staff/barlines agree with the score.'])
  }
  if (
    layoutConfidence === LAYOUT_CONFIDENCE.GOOD &&
    (minConfidence == null || minConfidence >= HIGH_SYSTEM_CONFIDENCE)
  ) {
    return auto(['Good follow: every detected system is confident.'])
  }

  // 3. Medium confidence — ask for a quick confirmation.
  const reasons = []
  if (layoutConfidence === LAYOUT_CONFIDENCE.APPROXIMATE) {
    reasons.push('Approximate layout — confirm the first system to enable follow.')
  }
  if (flags?.layoutMismatch) {
    reasons.push(`Printed layout differs from score data (${(flags.layoutMismatchReasons ?? []).join('; ') || 'layout differs'}).`)
  }
  if (minConfidence != null && minConfidence < HIGH_SYSTEM_CONFIDENCE) {
    reasons.push(`Lowest system confidence is ${fmt(minConfidence)}.`)
  }
  if (reasons.length === 0) {
    reasons.push('Medium confidence — a quick confirmation is recommended.')
  }
  return { action: FOLLOW_ACTION.CONFIRM, reasons }
}

function auto(reasons) {
  return { action: FOLLOW_ACTION.AUTO, reasons }
}

function manual(reasons) {
  return { action: FOLLOW_ACTION.MANUAL, reasons }
}
