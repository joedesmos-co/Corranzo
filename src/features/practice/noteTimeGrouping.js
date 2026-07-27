/**
 * Shared onset window for grouping notes that belong to one attack /
 * checkpoint / chord placement decision.
 *
 * Guitar fret derivation and Wait-For-You checkpoints must use the same
 * window so simultaneous practice targets receive distinct strings.
 */
export const NOTE_TIME_GROUP_SECONDS = 0.18
