import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  GUIDED_TUTORIAL_STEPS,
  resolveNextAvailableTutorialIndex,
} from '../../features/onboarding/guidedTutorial.js'

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function targetSelector(targetId) {
  const escaped =
    typeof window !== 'undefined' && window.CSS?.escape
      ? window.CSS.escape(targetId)
      : String(targetId).replace(/"/g, '\\"')
  return `[data-tour-id="${escaped}"]`
}

function getTargetSnapshot(targetId) {
  if (!targetId || typeof document === 'undefined') {
    return null
  }
  const element = document.querySelector(targetSelector(targetId))
  if (!element) {
    return null
  }
  const rect = element.getBoundingClientRect()
  if (rect.width < 4 || rect.height < 4) {
    return null
  }
  return {
    element,
    rect: {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    },
  }
}

function getCardStyle(rect) {
  if (!rect || typeof window === 'undefined') {
    return undefined
  }
  const margin = 16
  const gap = 14
  const maxWidth = Math.min(360, window.innerWidth - margin * 2)
  const estimatedHeight = 220
  const left = clamp(rect.left, margin, window.innerWidth - maxWidth - margin)
  const below = rect.bottom + gap
  const top =
    below + estimatedHeight <= window.innerHeight
      ? below
      : clamp(rect.top - estimatedHeight - gap, margin, window.innerHeight - estimatedHeight - margin)

  return {
    left,
    top,
    width: maxWidth,
  }
}

export default function GuidedTutorial({
  activeView,
  practiceReady = false,
  canStartDemo = false,
  demoLoading = false,
  onStartDemo,
  onAddSheetMusic,
  onNavigate,
  onSkip,
  onDone,
  steps = GUIDED_TUTORIAL_STEPS,
}) {
  const [stepIndex, setStepIndex] = useState(0)
  const [targetSnapshot, setTargetSnapshot] = useState(null)
  const step = steps[stepIndex] ?? steps[steps.length - 1]
  const isLastStep = stepIndex >= steps.length - 1
  const isChoiceStep = step?.id === 'welcome' && !practiceReady
  const practiceStepNeedsScore = step?.view === 'practice' && !practiceReady
  const showDemoPrompt =
    !isChoiceStep &&
    !practiceReady &&
    canStartDemo &&
    typeof onStartDemo === 'function' &&
    (step?.id === 'welcome' || practiceStepNeedsScore)
  const showChoiceActions = isChoiceStep && (
    (canStartDemo && typeof onStartDemo === 'function') ||
    typeof onAddSheetMusic === 'function'
  )
  const canAdvance = !practiceStepNeedsScore && !isChoiceStep
  const displayTitle = isChoiceStep
    ? 'Start with Corranzo'
    : practiceStepNeedsScore
      ? 'Try the demo first'
      : step?.title
  const displayBody = isChoiceStep
    ? 'Choose the demo for a quick tour, or add your own sheet music.'
    : practiceStepNeedsScore
    ? 'Open the demo piece so the tour can show Play, Wait For You, and the score cursor on the real Practice screen.'
    : step?.body
  const progressLabel = `${Math.min(stepIndex + 1, steps.length)} of ${steps.length}`

  const targetAvailable = useCallback((targetId) => Boolean(getTargetSnapshot(targetId)), [])

  const stepAvailable = useCallback(
    (candidate) => {
      if (candidate?.view && candidate.view !== activeView) {
        return candidate.view === 'practice' ? true : false
      }
      if (!candidate?.targetId) {
        return true
      }
      return targetAvailable(candidate.targetId)
    },
    [activeView, practiceReady, targetAvailable],
  )

  const findNextAvailableIndex = useCallback(
    (startIndex) =>
      resolveNextAvailableTutorialIndex(
        steps,
        startIndex,
        (targetId) => {
          const candidate = steps.find((item) => item.targetId === targetId)
          return stepAvailable(candidate)
        },
      ),
    [stepAvailable, steps],
  )

  const goToNextAvailable = useCallback(
    (startIndex) => {
      setStepIndex(findNextAvailableIndex(startIndex))
    },
    [findNextAvailableIndex],
  )

  useEffect(() => {
    if (!step?.view || activeView === step.view) {
      return undefined
    }
    if (step.view === 'practice' && !practiceReady) {
      setTargetSnapshot(null)
      return undefined
    }
    onNavigate?.(step.view)
    return undefined
  }, [activeView, onNavigate, practiceReady, step])

  useEffect(() => {
    if (!step?.targetId) {
      return undefined
    }
    if (practiceStepNeedsScore) {
      setTargetSnapshot(null)
      return undefined
    }
    if (step.view && activeView !== step.view) {
      return undefined
    }

    let cancelled = false
    let frame = 0

    function measureOrSkip() {
      if (cancelled) {
        return
      }
      const snapshot = getTargetSnapshot(step.targetId)
      if (!snapshot) {
        goToNextAvailable(stepIndex + 1)
        return
      }
      snapshot.element.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' })
      setTargetSnapshot({ targetId: step.targetId, rect: snapshot.rect })
    }

    frame = window.requestAnimationFrame(measureOrSkip)
    window.addEventListener('resize', measureOrSkip)
    window.addEventListener('scroll', measureOrSkip, true)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', measureOrSkip)
      window.removeEventListener('scroll', measureOrSkip, true)
    }
  }, [activeView, goToNextAvailable, practiceStepNeedsScore, step, stepIndex])

  const visibleTargetRect =
    step?.targetId &&
    (!step.view || activeView === step.view) &&
    targetSnapshot?.targetId === step.targetId
      ? targetSnapshot.rect
      : null
  const cardStyle = useMemo(() => getCardStyle(visibleTargetRect), [visibleTargetRect])
  const highlightStyle = visibleTargetRect
    ? {
        left: visibleTargetRect.left - 6,
        top: visibleTargetRect.top - 6,
        width: visibleTargetRect.width + 12,
        height: visibleTargetRect.height + 12,
      }
    : undefined

  if (!step) {
    return null
  }

  function handleSkip() {
    onSkip?.()
  }

  function handleDone() {
    onDone?.()
  }

  function handleAddSheetMusic() {
    onAddSheetMusic?.()
  }

  function handleNext() {
    if (isLastStep) {
      handleDone()
      return
    }
    setStepIndex((index) => Math.min(steps.length - 1, index + 1))
  }

  function handleBack() {
    setStepIndex((index) => Math.max(0, index - 1))
  }

  return (
    <div
      className={`guided-tour${isChoiceStep ? ' guided-tour--choice' : ''}`}
      role="dialog"
      aria-modal={isChoiceStep ? undefined : 'true'}
      aria-labelledby="guided-tour-title"
    >
      {!isChoiceStep && <div className="guided-tour__backdrop" />}
      {visibleTargetRect && <div className="guided-tour__highlight" style={highlightStyle} />}
      <section
        className={`guided-tour__card${visibleTargetRect || isChoiceStep ? '' : ' guided-tour__card--center'}${isChoiceStep ? ' guided-tour__card--choice' : ''}`}
        style={visibleTargetRect ? cardStyle : undefined}
      >
        <p className="guided-tour__step">{progressLabel}</p>
        <h2 id="guided-tour-title" className="guided-tour__title">
          {displayTitle}
        </h2>
        <p className="guided-tour__body">{displayBody}</p>
        {showChoiceActions && (
          <div className="guided-tour__choice-actions" aria-label="Choose how to start">
            {canStartDemo && typeof onStartDemo === 'function' && (
              <button
                type="button"
                className="guided-tour__btn guided-tour__btn--primary guided-tour__btn--choice"
                onClick={onStartDemo}
                disabled={demoLoading}
              >
                {demoLoading ? 'Opening demo…' : 'Try Demo Piece'}
              </button>
            )}
            {typeof onAddSheetMusic === 'function' && (
              <button
                type="button"
                className="guided-tour__btn guided-tour__btn--choice guided-tour__btn--secondary"
                onClick={handleAddSheetMusic}
              >
                Add My Sheet Music
              </button>
            )}
          </div>
        )}
        {showDemoPrompt && (
          <div className="guided-tour__demo">
            <p className="guided-tour__demo-copy">
              New here? Open the demo first so the tour can point to real Practice controls.
            </p>
            <button
              type="button"
              className="guided-tour__btn guided-tour__btn--primary guided-tour__btn--demo"
              onClick={onStartDemo}
              disabled={demoLoading}
            >
              {demoLoading ? 'Opening demo…' : 'Try Demo Piece'}
            </button>
          </div>
        )}
        <div className="guided-tour__actions">
          <button type="button" className="guided-tour__btn guided-tour__btn--ghost" onClick={handleSkip}>
            Skip
          </button>
          <button
            type="button"
            className="guided-tour__btn guided-tour__btn--ghost"
            onClick={handleBack}
            disabled={stepIndex === 0}
          >
            Back
          </button>
          {isLastStep && (
            <button type="button" className="guided-tour__btn" onClick={handleDone}>
              Done
            </button>
          )}
          {!isLastStep && canAdvance && (
            <button type="button" className="guided-tour__btn guided-tour__btn--primary" onClick={handleNext}>
              Next
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
