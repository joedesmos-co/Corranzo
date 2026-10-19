/**
 * Regression guard for the idle-neural-mic effect.
 *
 * useNeuralMicInput is permanently idle in production (useMicNeuralFlag is
 * hard false outside DEV), so both instances in usePracticeSession never read
 * the confirmation/chord state they reset. The reset effect used to run on
 * every checkpoint change anyway and called setInputFeedback, dispatching
 * React state ~3.8 times per second across the two idle instances and
 * re-rendering the whole practice tree for outputs that are never consumed.
 *
 * The guard makes the effect early-return while inactive. Hook ordering is
 * preserved (the useEffect call site is unchanged) and the neural path is
 * byte-identical when active.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hook = readFileSync(
  join(root, 'src/features/practice/useNeuralMicInput.js'),
  'utf8',
)

describe('useNeuralMicInput idle effect guard', () => {
  const effectMatch = hook.match(
    /\/\/ Reset per-checkpoint confirmation[\s\S]*?\}, \[active, checkpointId, resetFeedback\]\)/,
  )

  it('keeps the reset effect gated on active', () => {
    expect(effectMatch).not.toBeNull()
    const body = effectMatch[0]
    const guardIndex = body.indexOf('if (!active)')
    const checkpointIndex = body.indexOf('checkpointIdRef.current === checkpointId')
    expect(guardIndex).toBeGreaterThanOrEqual(0)
    expect(checkpointIndex).toBeGreaterThan(guardIndex)
  })

  it('includes active in the dependency array', () => {
    expect(hook).toContain('}, [active, checkpointId, resetFeedback])')
  })

  it('leaves the model-load effect gated on active (unchanged)', () => {
    expect(hook).toContain("if (!active) {\n      return undefined\n    }")
  })
})
