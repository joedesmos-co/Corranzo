/** Public demo fixture URLs (served from /public/fixtures in dev). */
export const DEMO_PIECE = {
  id: 'hungarian-dance-no5',
  title: 'Hungarian Dance No. 5',
  subtitle: 'Demo score · WoO 1, No. 5 in F♯ minor (public domain)',
  attribution: 'Johannes Brahms · piano arrangement',
  measureCount: 104,
  pageCount: 4,
}

/** Built-in demo paths (Hungarian Dance). */
export const FIXTURE_PATHS = {
  pdf: '/fixtures/hungarian-dance-no5/hungarian-dance-no5.pdf',
  midi: '/fixtures/hungarian-dance-no5/hungarian-dance-no5.mid',
  musicXml: '/fixtures/hungarian-dance-no5/hungarian-dance-no5.mxl',
  demoAnchors: '/fixtures/hungarian-dance-no5/hungarian-dance-no5.anchors.json',
}

export const FIXTURE_FILENAMES = {
  pdf: 'Hungarian Dance No. 5.pdf',
  midi: 'Hungarian Dance No. 5.mid',
  musicXml: 'Hungarian Dance No. 5.mxl',
}

/** Internal regression fixture (Minuet in G) — not the visible demo card. */
export const MINUET_FIXTURE_PATHS = {
  pdf: '/fixtures/demo-minuet-in-g.pdf',
  midi: '/fixtures/demo-minuet-in-g.mid',
  musicXml: '/fixtures/demo-minuet-in-g.musicxml',
  demoAnchors: '/fixtures/demo-minuet-in-g.anchors.json',
}

export const MINUET_FIXTURE_FILENAMES = {
  pdf: 'Minuet in G.pdf',
  midi: 'Minuet in G.mid',
  musicXml: 'Minuet in G.musicxml',
}
