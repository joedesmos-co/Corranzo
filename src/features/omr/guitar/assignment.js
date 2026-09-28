/**
 * Optimal rectangular assignment (Jonker-Volgenant / Hungarian, O(n^3)).
 *
 * ## Why not greedy
 *
 * Per-object OMR metrics are only as trustworthy as the identity assignment
 * behind them. Greedy matching resolves each truth note to its cheapest
 * remaining candidate, so one early mistake can cascade: a duplicated or
 * misread notehead consumes a partner that a later, correct note needed, and the
 * error is then reported against two objects instead of one. The Phase 0 audit
 * showed exactly this pathology — a bag metric reporting 100% pitch accuracy
 * while order-sensitive recovery was 0%.
 *
 * Optimal assignment minimises total cost over the whole measure, so the score
 * reflects the best possible pairing and any residual error is a real
 * recognition error rather than an artefact of pairing order.
 *
 * Pure and dependency-free so it can be unit tested directly.
 */

/**
 * Solve `min sum(cost[i][j])` over a selection of n columns for m rows.
 *
 * @param {number[][]} cost  m x n matrix of finite costs. Use a large sentinel
 *                           for forbidden pairs rather than Infinity, so the
 *                           algorithm terminates.
 * @returns {Int32Array} length m, or -1 for rows left unassigned.
 */
export function assignOptimal(cost) {
  const rows = cost.length
  if (rows === 0) return new Int32Array(0)
  const cols = cost[0]?.length ?? 0
  if (cols === 0) return new Int32Array(rows).fill(-1)

  // Columns are padded to reach a square problem when rows exceed columns, so
  // that every real row can be augmented. Rows are never padded: a padded row
  // costs 0 against every column and would capture a column a real row needs.
  const n = Math.max(rows, cols)
  const at = (row, col) => {
    if (row >= rows || col >= cols) return 0 // padded column
    const value = cost[row][col]
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
  }

  // 1-indexed potentials, as in the classic formulation.
  const u = new Float64Array(n + 1)
  const v = new Float64Array(n + 1)
  const p = new Int32Array(n + 1) // p[j] = row assigned to column j (0 = none)
  const way = new Int32Array(n + 1)

  for (let row = 1; row <= rows; row += 1) {
    p[0] = row
    let j0 = 0
    let freeColumn = -1
    const minv = new Float64Array(n + 1).fill(Number.POSITIVE_INFINITY)
    const used = new Uint8Array(n + 1)

    // Augmenting search for one free column. On failure nothing outside
    // minv/used has been touched (the potential update below is skipped), so the
    // row can simply be skipped without disturbing the rows already assigned.
    searching: while (true) {
      used[j0] = 1
      const i0 = p[j0]
      let delta = Number.POSITIVE_INFINITY
      let j1 = -1
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue
        const current = at(i0 - 1, j - 1) - u[i0] - v[j]
        if (current < minv[j]) {
          minv[j] = current
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      if (j1 < 0 || !Number.isFinite(delta)) break searching
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else {
          minv[j] -= delta
        }
      }
      j0 = j1
      if (p[j0] === 0) {
        freeColumn = j0
        break searching
      }
    }

    if (freeColumn < 0) continue // no reachable column; leave this row unassigned

    // Walk the predecessor chain back to the source, flipping the assignment.
    let j = freeColumn
    do {
      const j1 = way[j]
      p[j] = p[j1]
      j = j1
    } while (j)
  }

  // A row that landed on a padded column has no real counterpart.
  const assignment = new Int32Array(rows).fill(-1)
  for (let j = 1; j <= n; j += 1) {
    const row = p[j] - 1
    if (row >= 0 && row < rows && j - 1 < cols) {
      assignment[row] = j - 1
    }
  }
  return assignment
}
