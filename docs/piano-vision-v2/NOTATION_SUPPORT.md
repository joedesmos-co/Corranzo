# Piano Vision V2 notation support and supervision audit

This matrix answers four different questions: representable, labeled, learnable
with enough examples, exportable. None implies the next. **No V2 notation family
has demonstrated learned production accuracy yet.** The existing 24.8M labels
cover eleven families; they are not 24.8M examples of comprehensive notation.

Evidence: `tools/pdmx-factory/schemas/semantic-example.schema.json` leaves family
payloads generic; `tools/semantic-gold/assembler.mjs:parseWrittenNotation` parses
more raw XML than it emits into the eleven semantic families;
`piano_vision/data.py:_make_targets` reduces these further. The canonical
`semanticTargets.records` inspected in train is empty / MODEL_CONTRACT_PENDING.
The dedicated Python V1 model has no integrated MusicXML exporter. The table's
legacy export column refers to `src/features/omr/buildOmrMusicXml.js`; the separate
V3 exporter is narrower and also needs its own qualification, not automatic reuse.

V2 uses `notation-graph/2.0`: events, attributes, relations, spans, directions,
context, structure and unknown nodes. Ordered XML trees preserve tags, attributes,
text, child order and extension content. Node bindings are checked at export;
unbound nodes become review entries instead of disappearing. Structural preservation
is semantic XML roundtrip, not byte-identical formatting or engraved facsimile.

Legend: **C** = core categorical adapter has relevant supervision; **S** = shared
region-conditioned notation decoder can represent it, but aligned notation labels
are missing; **I** = lossless structured interchange/export can preserve it when
provided. I does not mean recognition exists. “More labels” includes source-region
alignment, positive *and verified negative* coverage, and retained uncertainty.
Existing corpus frequencies outside the current schema are **not measured**; raw
MXL prevalence cannot be inferred from dropped labels or a sample with no examples.

| Notation / MusicXML encoding | Current semantic dataset | V1 trained output path | Legacy export limits | V2 representation / export | Data/schema work before learned support |
|---|---|---|---|---|---|
| Ordinary pitched notes / note,pitch | Written step/octave/alter/staff known labels | Yes; source proposals required | Basic notes | C + I | Proposal recall qualification; full-score decoding |
| Grace note / grace | Boolean in DURATION | Boolean only | No grace element in noteXml | C boolean; S detailed grace; I | Retain slash/steal-time/make-time and ordering |
| Multiple-note grace group | Individual grace booleans; no complete group schema | No group identity | Lost | S event sequence + spans; I | Group anchors/order and principal-note attachment |
| Acciaccatura/appoggiatura | Grace subtype/slash/performance attrs dropped | No subtype | Lost | S grace attributes; I | Slash and context labels; do not overinterpret terminology |
| Cue notes / cue | Cue identity absent from semantic labels | No | Lost | S cue independent of grace; I | Explicit cue labels + difficult grace/cue negatives |
| Small ordinary / type@size,notehead@font-size | Size semantics absent | No | Lost | S size attribute independent of event role; I | Size/layout labels; unknown if ambiguous |
| Chord notes / chord | CHORD, ATTACK groups | Pair classification | Basic chord emission | C grouping; I | Allow legal unequal durations; preserve role identity |
| Beamed grace groups / grace,beam | Grace boolean; grouping missing | Unsupervised beam head | Beam support only normal path | S group/span; I | Grace beam-number, begin/continue/end/hook labels |
| Grace slurs / slur | Not a semantic family | No slur head | Limited ordinary start/stop | S span + endpoint IDs; I | Grace/main-note endpoints, placement, numbering |
| Grace accidentals / accidental | Sounding alter; printed form not complete | Accidental alter, unused glyph head | Printed normal accidentals conditional | C alter; S appearance; I | Printed/courtesy/editorial attributes and grace anchors |
| Stem direction / stem | Source evidence exists; target extraction absent | Head exists but no target | up/down only | S attribute; I | Up/down/none/double and cross-staff labels |
| Notehead variants / notehead,notehead-text | Physical kind only | No subtype | Lost | S attribute/text; I | Shape, filled/open, parentheses, SMuFL/name |
| Dots / dot | Dots in DURATION/REST | 0–3 class; clipping in V1 | Legacy boolean emits at most one; V3 differs | C 0–3; S arbitrary; I | Distribution by count; no clipping out-of-vocab |
| Ledger lines / print-leger | Source geometry/staff steps; appearance absent | Staff-step only | Renderer default | S appearance attribute; I | Explicit suppressed/visible ledger policy if fidelity required |
| Unpitched/percussion / unpitched,instrument | Piano filter; not supervised | No | Partial non-piano legacy paths | S event alternative; I | New domain labels/gate; no piano pitch coercion |
| All duration values / type,duration | Written type incl rare; raw rational duration | 13 classes through 256th; unknown fallback | Finite duration map | C common; S 512th/1024th etc.; I | Rare-type counts; arbitrary rational/type attributes |
| Tuplets 2,3,5,6,7,9,etc. / time-modification | Ratios and repaired tuplet labels | Eight explicit categories plus other | Basic ratio/start/stop | C common; S arbitrary integers; I | No unknown ratio→triplet coercion; ratio long tail |
| Nested/complex tuplets / multiple tuplet spans | Cumulative ratio partly; nested span metadata not complete | Single ratio/single flag | Lost numbering/nesting details | S separate temporal ratio + nested spans; I | Nested endpoint labels, numbering, brackets/number display |
| Beams / beam | Source graph evidence; semantic beam target absent | Untrained beam head | Limited numbered beams | S relation/span/attribute; I | Source spans + endpoint/order ground truth |
| Tremolo single/double / ornaments/tremolo | Raw parser sees count; not emitted to family targets | Untrained tremolo head | No comprehensive path | S attribute/span + time ratio; I | Type/count and two-note duration semantics |
| Printed rests / rest | Repaired REST durations | Yes, proposal-conditioned | Basic rests | C + I | Rest recall beyond frozen candidates |
| Whole-measure rests / rest@measure | Some duration/type labels; measure flag not modeled | No measure-rest distinction | Basic rest only | S event attribute; I | Retain measure flag and meter context |
| Multi-measure rests / measure-style/multiple-rest | Not represented as trained structure | No | Lost | S structural event; I | Range/count, layout and implied measures |
| Pickup/anacrusis / measure@implicit | Missing scope supervision | Untrained irregular head | Some duration heuristics | S structure + explicit metric policy; I | Target alignment + expected duration; preserve implicit semantics |
| Irregular/irrational measures / time,senza-misura | Missing scope supervision | No learned meter | Limited conventional meter | S context + rational time + free meter; I | General meter/context labels; no mandatory 4/4 defaults |
| Multiple voices / voice,backup,forward | LANE and continuation; role mapping | 8 lane classes | Polyphony supported with constraints | C core; S arbitrary voice IDs; I | Permutation-invariant role ownership and hidden timing |
| Clefs and changes / clef | KNOWN sign/line/octave-change in pitch context | Sign only note head | G/F plus octave change | C staff-measure context; I | Actual context changes/positions; other clefs and conflicts |
| Key signatures/changes / key | Fifths in pitch labels; nontraditional key missing | Fifths per note | Conventional fifths | C context fifths; S nontraditional key; I | Key-change anchors and key-step/alter/octave forms |
| Accidentals incl doubles/naturals / accidental,alter | Alter values; appearance partially raw | Integer alter -3..3, defaults/clipping | Common accidental names | C alter; S printed attributes; I | Explicit accidental appearance and noninteger alterations |
| Courtesy/editorial accidentals | Partial raw metadata, not targets | No attributes | Some attrs preserved when supplied | S independent appearance/meaning; I | Cautionary/editorial/parentheses/bracket/affects-pitch labels |
| Ottava 8va/8vb/15ma/etc. / octave-shift | Raw direction parsing; not target family | Untrained ottava head | Some legacy transposition logic | S span with size/type/number; I | Span endpoints and written vs sounding pitch consistency |
| Enharmonic spelling / pitch | Written step/octave/alter | Yes | Existing code may derive pitch in some paths | C + I | Preserve spelling; no MIDI-only reconstruction |
| Cross-staff / staff with voice/relations | CROSS_STAFF labels | Yes conditioned on mapping | Grand staff paths | C + S exact ownership; I | Coverage of cross-system/shared-role cases |
| Ties / tie,tied | TIE_SUSTAIN endpoints | Directed pair class | Basic starts/stops | C endpoint core; S visual span attrs; I | Distinguish sounding tie/printed tied, let-ring/discontinue etc. |
| Slurs / slur | Parsed raw; not semantic targets | No | Limited numbering/placement | S arbitrary span; I | Region and endpoint labels, nested/overlapping spans |
| Phrase marks | Usually slur/dashes/bracket depending encoding | No | Limited | S span or uninterpreted text; I | Preserve actual encoding; no invented semantic distinction |
| Glissandi / glissando | Missing | No | Missing | S span; I | Endpoints, line type, text/number |
| Slides / slide | Missing | No | Missing | S span; I | Endpoint/type labels |
| Arpeggiation / arpeggiate | Raw bool, family absent | Untrained arpeggio head | Limited/lost | S relation + direction/number; I | Chord/staff coverage, up/down/bracket distinctions |
| Non-arpeggiation / non-arpeggiate | Missing | No | Missing | S relation; I | Top/bottom and grouped chord anchors |
| Shared noteheads / note@print-object / multiple events | Count/partial relationships | Count class; ownership head untrained | Not comprehensively preserved | S physical object→multiple semantic events; I | Aligned role tuples/ownership; count alone is insufficient |
| Voice continuation | LANE_CONTINUATION | Directed pair class | Implicit voice sequence | C; S arbitrary roles; I | Score boundary consistency and endpoint recall |
| Articulations / articulations children | Raw parser names; semantic targets omit | Untrained articulation head | Limited subset; deletes staccato on ties | S attribute/list; I preserves unusual combinations | Region/event anchors, subtype/placement and verified negatives |
| Fermata / fermata | Not a trained family | No supervised path | Basic upright/inverted | S attribute; I | Shape/placement/type and rest/barline anchors |
| Trill, mordent, turn, inverted turn,etc. / ornaments | Raw names/count; omitted targets | Untrained ornament head | Missing comprehensive path | S ornament tree/span; I | Subtype/accidental-mark/wavy-line labels |
| Dynamics p,pp,mp,mf,f,ff,sfz,etc. / dynamics | Raw direction parser; omitted targets | Untrained dynamic head | Some dynamic strings | S direction tree; I | Source regions, anchor staff/time, uncommon/mixed dynamics |
| Hairpins / wedge | Not target family | No | Basic wedges, filtering | S span with endpoints/number; I | Niente/spread/line/placement and cross-system continuation |
| Expressive text / words | Raw text parsed; omitted targets | No OCR | Some tempo words only | S UTF-8 direction/text; I | Aligned text transcription; preserve wording/formatting |
| Tempo words / words | Not supervised | Untrained tempo_class | Limited tempo marking path | S text; I | OCR labels; never force a BPM |
| Metronome / metronome | Raw unit/BPM fields; omitted targets | No structured learned path | Simple beat unit, rounded BPM | S structured direction; I | Dotted units, ranges, equivalence/modulation and textual per-minute |
| rit./rall./accel./a tempo/tempo primo/rubato | Text/direction target missing | No | Partial text only | S exact text + optional span; I | Text plus anchors, preserve ambiguity of execution |
| Rehearsal marks / rehearsal | Missing | No | Missing | S direction/text; I | Mark shape/text/layout labels |
| Arbitrary text directions / words,other-direction | Missing aligned labels | No | Limited | S UTF-8 text/unknown; I | OCR + script/font coverage; no interpretation required |
| Sustain pedal / pedal start/stop/change/line | Raw partial pedal attrs; omitted targets | Untrained pedal head | Helper emits start line only | S span + change events; I | Down/up/change/continue/resume, symbol vs line and half-pedal text |
| Sostenuto/una corda / words,sound,other-direction | Missing | No | Missing | S text/direction; I | Preserve visible text; avoid inferring inaudible controller values |
| Fingering / technical/fingering | Missing | No | Guitar string/fret only | S attribute; I | Digits, placement, hand/voice anchors |
| Fingering substitutions / fingering@substitution | Missing | No | Missing | S attribute + multiple entries; I | Paired numbers/substitution/alternate attributes |
| Hand indications | Text/technical/principal-voice encoding varies | No | Missing | S text/attribute; I | Preserve encoded wording; no staff=hand assumption |
| Grand staff / staves,staff-details,part-symbol | Geometry/staff labels; declaration not trained | Staff class only | Conventional two-staff support | C geometry; S context/structure; I | Brace/layout changes and multiple parts/instruments |
| Repeats / barline/repeat | Raw parser partial; omitted targets | Untrained repeat head | Forward/backward basic | S structure; I | Repeat counts, winged/style, direction and timing |
| Endings/voltas 1,2,etc. / ending | Raw basic marking; omitted targets | Untrained repeat_ending | Basic start/stop; can omit number | S numbered span; I | Range lists, discontinue, multiple systems |
| D.C./D.S./Coda/Segno/Fine / segno,coda,words,sound | Missing trained targets | No | Not complete | S direction + navigation links; I | Visual symbol/text plus target reference labels |
| Measure numbers / measure@number,measure-numbering | IDs in metadata, not model truth input | No visual number head | Sequential numbering | S text/structure; I | Printed numbering OCR; preserve nonnumeric/implicit numbers |
| System/page breaks / print | Source page/system geometry only | No print-layout prediction | Not comprehensive | S structure/optional layout; I | Preserve source breaks as separate fidelity setting |
| Multiple movements / opus,movement-title/number | Corpus workflow primarily single score | No | No full movement path | S document collection/structure; I | Movement boundaries and score container ingestion |
| Lyrics / lyric | Not piano semantic target | No | Not comprehensive | S text/attribute; I | Rare piano-vocal domain policy + OCR alignment |
| Harmony/chord symbols / harmony | Not CHORD family (different meaning) | No | Not comprehensive | S direction/event; I | Root/kind/bass/degree text + anchor labels |
| Staff changes/transposition / staff-details,transpose | Missing | No | Limited | S context; I | Staff-line changes, instrument/transposition labels |
| Brackets/dashes/other spans | Missing | No | Limited | S span + arbitrary attrs; I | Endpoint/direction labels and text attachment |
| Credits/title/composer/rights / credit,work,identification | Metadata exists, visual OCR not taught | No | Generated title only | S structure/text; I | Page text regions and provenance distinction |
| Editorial footnote/level/other-notation/SMuFL | Missing or dropped | No | Mostly lost | S attributes/extension tree; I | Region labeling; preserve extensions without inventing meaning |
| Unrecognized printed marking | No generic region/unknown supervision | No reliable detection | May disappear | Unknown node + review sidecar/XML metadata | Residual-region recall qualification and labeled unknown examples |

## What must happen to the data

The broad ontology is implemented without rewriting the production dataset. Add an
immutable **notation sidecar** dataset keyed by semantic source ID, original split,
source page digest, source region and event/span anchors. Its label states are
KNOWN / AMBIGUOUS / UNAVAILABLE / UNSUPPORTED, not absent=negative. Existing XML can
supply semantics; visible-region alignment must be validated independently. The
upload PDF+MXL workflow is a natural provider, but file matching alone is not proof
that a symbol is visible or correctly aligned. Source archives remain untouched.

Schema work is required for role expansion, generic direction/text/attribute
labels, spans with multiple/nested endpoints, source region coverage, meter,
context-change anchors and exact complete-score truth. New examples alone suffice
only for already represented fields (e.g. an existing tuplet ratio category or
ordinary accidental class). Unsupported ratios and grace/cue distinctions need
schema/adapter work as well as examples. Adequacy must be assessed per subtype,
font/engraver/source score and context, with rare-family validation confidence
intervals; total family counts are insufficient.

The shared decoder represents unseen future type names through a stable UTF-8
alphabet. Adding an ontology type therefore need not replace the visual backbone,
hierarchy or training/checkpoint interfaces. It still requires an ontology version,
validated export binding, labels, targeted tests and learned accuracy evaluation.
This is an extensibility path, not a claim that byte generation is the final best
notation decoder: latency and learning efficiency for long text remain unmeasured.

## Unknown and verifier safety

Unknown markings survive as page-local regions with alternatives/reasons and
provenance. Draft MusicXML carries review metadata; the sidecar is authoritative
for regions that MusicXML cannot semantically describe. A third-party importer
may discard miscellaneous metadata: ship the sidecar with the XML and never claim
unknown semantics were exported as recognized notation. No system can promise to
flag every unknown glyph before detector recall is measured.

Hard invariants need declared semantics. Voice gaps, uncommon ratios, grace timing,
free meter, unusual articulation combinations, engraving conventions and staff
position heuristics never justify destructive repair. An explicit complete metric
contract permits exact-fill checks; otherwise they remain review signals. A soft
prior cannot remove a candidate during reranking. Each attempted candidate and
rule decision is retained. XML chord tones can be shorter than the lead note;
notated accidentals and sounding alteration are distinct; nested tuplets can have
different cumulative ratios. These exceptions are covered by tests.

Primary references: [MusicXML 4.0 reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/),
[note/grace/cue content](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/note/),
[chord semantics](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/chord/),
[time modification and nested tuplets](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/time-modification/),
[printed accidentals](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/accidental/).
