/**
 * Corranzo icon registry — pure data, no DOM.
 *
 * One 24x24 stroke set (1.7px default, round caps) replaces ad-hoc unicode
 * glyphs (▶ ❚❚ ■ ♪ ‹ › ⤢ ✎ ⋯ …). Shapes are intentionally geometric and
 * restrained: "studio console" means precision, not decoration.
 *
 * Each entry is a list of shapes: { d } for paths, { c: [cx, cy, r] } for
 * circles, optional w (stroke width override) and f (fill instead of stroke).
 */

export const iconShapes = {
  home: [{ d: 'M4 11l8-7 8 7' }, { d: 'M6.5 9.5V20h11V9.5' }],
  library: [{ d: 'M12 3l9 5-9 5-9-5 9-5Z' }, { d: 'M3.5 12.5L12 17l8.5-4.5' }, { d: 'M3.5 16.5L12 21l8.5-4.5' }],
  practice: [{ c: [12, 12, 8] }, { c: [12, 12, 3.5] }],
  import: [{ d: 'M12 16V4' }, { d: 'M7 9l5-5 5 5' }, { d: 'M4.5 20h15' }],
  settings: [
    { d: 'M4 8h9' },
    { d: 'M17.5 8H20' },
    { c: [15.2, 8, 2.3] },
    { d: 'M4 16h1.5' },
    { d: 'M10 16h10' },
    { c: [8, 16, 2.3] },
  ],
  play: [{ d: 'M8.5 5.5v13l10-6.5-10-6.5Z' }],
  pause: [{ d: 'M9.5 5.5v13', w: 2.8 }, { d: 'M14.5 5.5v13', w: 2.8 }],
  stop: [{ d: 'M8 8h8v8H8z' }],
  metronome: [{ d: 'M7.5 20.5h9L18 6.5H6L7.5 20.5Z' }, { d: 'M12 20.5l4.5-9' }, { c: [15, 13.4, 1.4], f: 1 }],
  loop: [
    { d: 'M4.5 12a7.5 7.5 0 0 1 12.8-5.3L19.5 8.8' },
    { d: 'M19.5 4v4.8h-4.8' },
    { d: 'M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4.5 15.2' },
    { d: 'M4.5 20v-4.8h4.8' },
  ],
  tracks: [{ d: 'M4 10v4h3l4 4V6l-4 4H4Z' }, { d: 'M15.5 9.5a3.5 3.5 0 0 1 0 5' }, { d: 'M18 7a7 7 0 0 1 0 10' }],
  mic: [{ d: 'M9 4h6v9H9z' }, { d: 'M6.5 11.5a5.5 5.5 0 0 0 11 0' }, { d: 'M12 17v4' }],
  keyboard: [
    { d: 'M3.5 7.5h17v9h-17z' },
    { d: 'M7.5 7.5V12' },
    { d: 'M12 7.5V12' },
    { d: 'M16.5 7.5V12' },
  ],
  pen: [{ d: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z' }],
  highlighter: [{ d: 'M4 20l1.2-4.2L15.5 5.5l3 3L8.2 18.8 4 20Z' }, { d: 'M13.5 7.5l3 3', w: 2.6 }],
  eraser: [{ d: 'M6.5 20.5h11' }, { d: 'M4.8 14.6L12 7.4l5.6 5.6-4.7 4.7H8.4l-3.6-3.1Z' }],
  undo: [{ d: 'M8.5 7H4.5V3' }, { d: 'M4.8 7.2c.4 4.8 4.2 7.8 9.2 7.8h6' }, { d: 'M16.5 11.5L20 15l-3.5 3.5' }],
  zoom: [{ c: [11, 11, 6] }, { d: 'M11 8.5v5M8.5 11h5' }, { d: 'M15.8 15.8L20 20' }],
  prev: [{ d: 'M14.5 5.5L8 12l6.5 6.5' }],
  next: [{ d: 'M9.5 5.5L16 12l-6.5 6.5' }],
  follow: [{ c: [12, 12, 6.5] }, { d: 'M12 2.5V6M12 18v3.5M2.5 12H6M18 12h3.5' }, { c: [12, 12, 1], f: 1 }],
  check: [{ d: 'M4.5 12.5l5 5L19.5 7' }],
  warn: [{ d: 'M12 3.5L2.5 20h19L12 3.5Z' }, { d: 'M12 10v4.5' }, { d: 'M12 17.5h.01', w: 2.6 }],
  error: [{ c: [12, 12, 8.5] }, { d: 'M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6' }],
  info: [{ c: [12, 12, 8.5] }, { d: 'M12 11v5' }, { d: 'M12 7.8h.01', w: 2.6 }],
  'chevron-down': [{ d: 'M6 9.5l6 6 6-6' }],
  search: [{ c: [11, 11, 6] }, { d: 'M15.8 15.8L20 20' }],
  close: [{ d: 'M6 6l12 12M18 6L6 18' }],
  pin: [{ d: 'M9.5 4h5l.8 6.5 2.7 3v2H6v-2l2.7-3 .8-6.5Z' }, { d: 'M12 15.5V21' }],
  panel: [{ d: 'M4 5h16v14H4z' }, { d: 'M9.5 5v14' }],
  fullscreen: [{ d: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5' }],
  music: [{ c: [6.8, 18, 2.6] }, { c: [17.2, 15.5, 2.6] }, { d: 'M9.4 18V6l10.4-2.6V15.5' }],
  clock: [{ c: [12, 12, 8.5] }, { d: 'M12 7.5V12l3 2' }],
  tempo: [{ d: 'M4.5 19a8.5 8.5 0 1 1 15 0' }, { d: 'M12 15l4.2-5.3' }, { c: [12, 15, 1.2], f: 1 }],
  dot: [{ c: [12, 12, 5], f: 1 }],
}

export const ICON_NAMES = Object.keys(iconShapes)

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(iconShapes, name)
}
