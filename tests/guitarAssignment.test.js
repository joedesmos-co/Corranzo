import { describe, expect, it } from 'vitest'
import { assignOptimal } from '../src/features/omr/guitar/assignment.js'

describe('assignOptimal', () => {
  it('handles the empty cases', () => {
    expect(assignOptimal([]).length).toBe(0)
    expect([...assignOptimal([[]])].every((v) => v === -1)).toBe(true)
  })

  it('finds the obvious pairing', () => {
    // Row 0 prefers column 1, row 1 prefers column 0.
    const cost = [
      [5, 1],
      [1, 5],
    ]
    expect([...assignOptimal(cost)]).toEqual([1, 0])
  })

  it('beats greedy where greedy cascades into a worse total cost', () => {
    // Row 0's cheapest option (col 0, cost 1) strands row 1 on a very expensive
    // column, for a greedy total of 101. Optimal assignment re-pairs them for 4.
    const cost = [
      [1, 2],
      [2, 100],
    ]
    const assignment = assignOptimal(cost)
    const total = [...assignment].reduce((sum, col, row) => sum + cost[row][col], 0)
    expect(total).toBe(4)
    expect([...assignment]).toEqual([1, 0])
  })

  it('never assigns the same column twice', () => {
    const cost = [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ]
    const assignment = assignOptimal(cost)
    const used = [...assignment].filter((v) => v >= 0)
    expect(new Set(used).size).toBe(used.length)
  })

  it('supports rectangular matrices in both directions', () => {
    // Fewer columns than rows: some rows must go unassigned.
    const wide = assignOptimal([
      [1, 2],
      [3, 4],
      [5, 6],
    ])
    expect([...wide].filter((v) => v >= 0).length).toBe(2)
    expect([...wide].filter((v) => v === -1).length).toBe(1)

    // More columns than rows: every row should get its best available column.
    const tall = assignOptimal([
      [9, 9, 1, 9],
      [9, 1, 9, 9],
    ])
    expect([...tall]).toEqual([2, 1])
  })
  it('leaves a row unassigned when every column is forbidden for it', () => {
    const cost = [
      [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      [2, 3],
    ]
    const assignment = assignOptimal(cost)
    expect(assignment[0]).toBe(-1)
    expect(assignment[1]).not.toBe(-1)
  })

  it('does not let a padded row capture a real column', () => {
    // Four columns, two rows: both real rows must reach their best column even
    // though the solver runs on a padded square problem.
    const cost = [
      [9, 9, 1, 9],
      [9, 1, 9, 9],
    ]
    expect([...assignOptimal(cost)]).toEqual([2, 1])
  })

  it('does not assign a real row to a padded column when rows exceed columns', () => {
    const cost = [
      [1, 2],
      [3, 4],
      [5, 6],
    ]
    const assignment = assignOptimal(cost)
    expect([...assignment].filter((col) => col >= 0).length).toBe(2)
    expect(assignment[2]).toBe(-1)
  })

  it('minimises total cost on a larger random instance', () => {
    // Deterministic pseudo-random costs so the test cannot flake.
    let seed = 12345
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const m = 6
    const n = 6
    const cost = Array.from({ length: m }, () =>
      Array.from({ length: n }, () => Math.floor(next() * 20)),
    )
    const assignment = assignOptimal(cost)
    const chosen = [...assignment].reduce((sum, col, row) => sum + cost[row][col], 0)

    // Compare against every permutation of the rows.
    const permute = (items, k = 0) => {
      if (k === items.length) {
        return items.reduce((sum, row, col) => sum + cost[row][col], 0)
      }
      let best = Number.POSITIVE_INFINITY
      for (let i = k; i < items.length; i += 1) {
        const next2 = [...items]
        ;[next2[k], next2[i]] = [next2[i], next2[k]]
        best = Math.min(best, permute(next2, k + 1))
      }
      return best
    }
    expect(chosen).toBe(permute([0, 1, 2, 3, 4, 5]))
  })
})
