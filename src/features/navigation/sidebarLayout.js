/**
 * Sidebar layout resolution — pure, unit-testable.
 *
 * Wide (>1100px): honor the persisted preference (expanded rail vs full).
 * Medium (<=1100px): force the compact rail so scores keep their space, but
 * the stored preference is preserved and restored when wide again.
 * Narrow (<=760px): the sidebar becomes a temporary drawer; open state is
 * ephemeral (never persisted, never covering content uninvited).
 */

export const SIDEBAR_RAIL_MAX_WIDTH = 1100
export const SIDEBAR_DRAWER_MAX_WIDTH = 760

export const SIDEBAR_MODE = {
  EXPANDED: 'expanded',
  RAIL: 'rail',
  DRAWER: 'drawer',
}

/**
 * @param {{ width: number, expanded: boolean }} input
 * viewport width in CSS px + persisted expanded preference
 * @returns {'expanded'|'rail'|'drawer'}
 */
export function resolveSidebarMode({ width, expanded }) {
  const safeWidth = Number.isFinite(width) ? width : SIDEBAR_RAIL_MAX_WIDTH + 1
  if (safeWidth <= SIDEBAR_DRAWER_MAX_WIDTH) {
    return SIDEBAR_MODE.DRAWER
  }
  if (safeWidth <= SIDEBAR_RAIL_MAX_WIDTH) {
    return SIDEBAR_MODE.RAIL
  }
  return expanded ? SIDEBAR_MODE.EXPANDED : SIDEBAR_MODE.RAIL
}

export function normalizeSidebarExpanded(value) {
  return value !== false
}
