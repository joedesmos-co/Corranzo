/**
 * The full notation surface Guitar Vision must cover.
 *
 * Every family is listed whether or not the corpus contains it, so a gap is
 * always visible rather than inferred from what the model happens to emit.
 *
 * Lives in its own module because the coverage inventory, the acquisition plan
 * and the architecture design all have to agree on exactly one list. Three
 * divergent lists would let each report a different coverage story.
 */
export const NOTATION_FAMILIES = [
  // Core music
  'note', 'rest', 'chord', 'stacked-notes', 'multi-voice', 'grace-note',
  'cue-note', 'ghost-note', 'dead-note', 'augmentation-dot', 'tuplet',
  'accidental', 'key-signature', 'time-signature', 'clef',
  'barline', 'repeat', 'first-ending', 'second-ending', 'segno', 'coda',
  'dc-ds', 'time-sig-change', 'key-change', 'clef-change', 'tempo-marking',
  'ritardando', 'accelerando', 'performance-text', 'lyrics',
  // Guitar-specific
  'tab-staff', 'fret-number', 'string-number', 'fret-position',
  'string-assignment', 'paired-staff-tab', 'capo', 'tuning-change',
  'alternate-tuning', 'scordatura', 'octave-shift',
  'bend', 'pre-bend', 'bend-release', 'bend-amount', 'bend-with-fret',
  'vibrato', 'hammer-on', 'pull-off', 'slide', 'glissando',
  'natural-harmonic', 'artificial-harmonic', 'pinch-harmonic',
  'tapping', 'palm-mute', 'let-ring', 'tremolo-picking', 'tremolo',
  'whammy-bar', 'arpeggio', 'ornament',
  // Articulations / expression
  'staccato', 'tenuto', 'marcato', 'accent', 'sforzando', 'fermata',
  'dynamic', 'hairpin', 'tie', 'slur', 'fingering', 'pick-direction',
  'barre', 'chord-symbol', 'chord-diagram', 'multi-staff',
]

