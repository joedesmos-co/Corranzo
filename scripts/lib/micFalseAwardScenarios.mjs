/**
 * Shared false-award scenario generator.
 *
 * Both the neural scorer and the production-spectral benchmark must score
 * the SAME scenarios, otherwise the A/B comparison is not apples-to-apples.
 * Kept in scripts/lib so it ships with the harnesses, not the app.
 *
 * A scenario is only meaningful when its MUTATED pitches never sound in
 * the clip: otherwise a "false" complete is just the piece's own true
 * notes matching (dense performances contain dozens of pitches).
 */
export function wrongExpectations(expected, truthMidis = null) {
  const truth = truthMidis ? new Set(truthMidis) : null
  const scenarios = []
  const consider = (name, mutated) => {
    if (truth && mutated.some((midi) => truth.has(midi))) {
      return
    }
    scenarios.push({ name, expected: mutated })
  }
  for (const midi of expected) {
    consider(`neighbor+1-of-${midi}`, expected.map((value) => (value === midi ? value + 1 : value)))
    consider(`neighbor-1-of-${midi}`, expected.map((value) => (value === midi ? value - 1 : value)))
    consider(`octave-up-of-${midi}`, expected.map((value) => (value === midi ? value + 12 : value)))
  }
  if (expected.length > 1) {
    consider('wrong-chord-same-count', expected.map((value) => value + 2))
  } else {
    consider('wrong-single-plus-2', expected.map((value) => value + 2))
  }
  return scenarios
}
