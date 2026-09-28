# Corranzo — Design Directions

Three meaningfully different concepts against the brief (minimal, unique, polished, modern, intentional, music-first; no generic AI SaaS, no clutter, no neon/AI-slop; approachable for non-technical musicians). Recommendation at the end.

---

## Direction A — "Print Room" (editorial paper)

**Philosophy.** Corranzo as a beautiful object of print culture: the app is a quiet gallery and the score is the artwork. Warm paper tones, generous margins, serif display type for headings paired with a neutral grotesk for UI. The interface whispers; the notation sings. Closest to "unique + intentional."

**Typography.** Display serif (e.g. a Source Serif / Newsreader-style face) for Home headings, piece titles, numbers-as-editorial-details; Inter-like grotesk for controls/labels; tabular mono only for time. Strong size contrast: large airy titles, tiny uppercase kickers ("NOW PRACTICING", "MEASURE 12").

**Color.** Warm paper: ink `#1a1815`, paper `#f7f4ec`, panel `#efe9db`, muted sepia borders; dark "evening practice" theme inverts to deep espresso `#14110d` with amber-ink accents. Single accent: oxblood/amber (`#9a5b2e`-ish) used sparingly (active mode, record of progress). No gradients except a faint paper grain. Status colors stay muted/earthy (sage ok, clay warn, oxblood error).

**Surfaces/depth.** Flat paper cards with 1px hairlines and soft, large-radius (10–14px) corners; depth only via layered paper (score sheet floats on a slightly darker desk surface with a soft, short shadow). Selective 3D: subtle page curl/shadow on the score; page-turn motion on navigation.

**Navigation.** Slim left rail with word-mark top, stacked serif labels (Home, Library, Practice, Import as a round "+" seal, Settings bottom). Collapses to a monogram rail. Feels like chapters of a book.

**Home.** Magazine cover: giant "Good evening. Continue the Minuet?" headline, current piece as a framed score excerpt, starter pieces as a reading list. Capability primer reads as a table of contents, not feature cards.

**Score workspace.** Notation on a paper sheet centered on a desk-tinted canvas; transport is a thin "conductor's baton" bar beneath the score (play, time, tempo-as-metronome-marking ♩=96); mode selector is three serif words (Preview · Play Along · Wait For You) with an ink underline sliding between them. Panels are paper slips that slide over the desk edge.

**Motion.** Slow, physical: 240–320ms ease-out, page-settle on mode change, underline glide, gentle cursor. Reduced-motion falls back to fades.

**Strengths.** Instantly distinctive; matches "music-first, not SaaS"; older/classical musicians feel at home; print metaphor justifies restraint.
**Weaknesses.** Serif + sepia risks "old-fashioned" for younger pop/guitar users; dark-theme credibility must be proven (most practice happens at night); dense practice controls (MIDI devices, calibration) fight the quiet aesthetic; amber accent has contrast traps.
**Distinctiveness.** Very high — nothing in the practice-app space looks like this.

---

## Direction B — "Studio Console" (precision instrument)

**Philosophy.** Corranzo as a finely machined instrument — think Teenage Engineering / Braun: dark, exact, tactile. Every control feels like hardware with perfect detents. Appeals to the "modern, polished, intentional" half of the brief and to guitar/pop producers.

**Typography.** All-grotesk, technical: medium-weight UI face with tight tracking for labels in uppercase micro (`LOOP · BAR 4–8`), large light numerals for time/tempo/BPM as the hero numbers. Mono for device/data readouts.

**Color.** Near-black `#0b0c0e` canvas, panel `#14161a`, hairline `#23262c`; white primary text; single signal accent — restrained warm amber `#e8b34b` (metronome pulse, active mode pip, cursor). Status: cool green ok, amber warn, red error — all desaturated. No gradients, no glow (a faint LED-style dot is the only "light").

**Surfaces/depth.** Beveled control clusters: transport as a machined "deck" with chunked buttons, segmented mode switch (3-position hardware switch metaphor), sliders with tick detents. Depth = 1px top highlight + short shadow on the deck only. Score area stays matte so notation has zero competition.

**Navigation.** Icon rail (custom 1.5px line icons) + fly-out labels; Import is a prominent square "+" key. Bottom status strip (like studio meters): sound / follow / input as LED-labeled modules — evolves today's status chips honestly.

**Home.** "Session desk": Continue card styled as a channel strip (piece, position fader showing progress through piece, tempo knob readout), library as patch bays. Capability primer as labeled input jacks (Import → Listen → Play → Wait) — playful but could tip into gimmick; needs restraint.

**Score workspace.** Score on matte dark easel (light paper preserved! notation always renders on paper, never inverted — accessibility + fidelity). Transport dock pinned bottom-center, always visible, mode switch as the deck's centerpiece: three detented positions with distinct deck configurations morphing around it (Preview: minimal deck; Play Along: full deck; WFY: target readout module). This direction answers the "mode clarity" problem most literally.

**Motion.** Snappy and mechanical: 120–180ms, stepped slider ticks, LED blinks, spring-less. Metronome pulse drives a tiny beat LED. Reduced-motion: static states only.

**Strengths.** Mode clarity is structural, not cosmetic; control density feels native (good for the panel-heavy reality of WFY/MIDI/mic); dark-first suits evening practice; distinctive without being weird.
**Weaknesses.** Risks reading "pro-audio geeky" — intimidating for casual/beginner musicians (the brief's core audience); hardware metaphors can become gimmicky (jack-plug primer); amber-on-black needs care to avoid the "neon" trap; serif-lovers will find it cold.
**Distinctiveness.** High within music-ed (Simply Piano/Yousician are rounded/friendly; this is the Dieter Rams alternative).

---

## Direction C — "Quiet Atelier" (soft minimal)

**Philosophy.** The safe-beautiful option: calm, rounded, Apple-notes-like softness. Off-white/light-first with a true dark mode, gentle grays, one confident accent (deep green `#1f6f4a` or classic blue). Approachability maximized; personality carried by copy, illustration, and motion rather than visual daring.

**Typography.** Single friendly grotesk throughout, generous line-height, sentence-case everything, numerals proportional. Titles are calm statements, not headlines.

**Color.** Light: `#fafafa` bg, white cards, `#e5e5e5` borders, ink `#171717`; Dark: zinc scale (close to today's tokens — deliberate continuity). Accent green for primary actions + progress; amber/red reserved for warn/error. Feels trustworthy, slightly familiar.

**Surfaces/depth.** Soft cards (12–16px radius, hairline borders, whisper shadows), segmented controls (iOS-style) for Score/Visual and modes, sheets/popovers with springy ease. Depth is ambient, never dramatic.

**Navigation.** Standard sidebar (icons + labels, 240px) collapsing to icons; bottom tab bar on mobile. Import as a friendly filled button. Nobody has to learn anything — which is both the point and the problem.

**Home.** Friendly dashboard: greeting, continue card with progress ring, "Things you can do" cards with small illustrations (import, listen, play along, wait), starter pieces. Pleasant, clear, forgettable.

**Score workspace.** Clean toolbar top (mode segmented control centered), score maximized, floating mini-player bottom-right collapsible; right inspector panel for tempo/loops/tracks/cursor with disclosure rows. Basically "today's layout, executed excellently."

**Motion.** Gentle springs (200–280ms), crossfades, progress-ring animations. Lovely but generic.

**Strengths.** Lowest risk; fastest to build on current tokens; most approachable for non-technical users; light-first differentiates from dark practice apps; accessibility (contrast, targets) easiest here.
**Weaknesses.** Least distinctive — risks the "generic AI SaaS" look the brief forbids; segmented-everything + cards is exactly the pattern the brief calls "a collection of random tools"; personality must be manufactured via illustration/copy, an ongoing cost.
**Distinctiveness.** Low. It would look *good* and *familiar* — which is the failure mode.

---

## Recommendation: Direction B (Studio Console), warmed with A

**Pick B as the structural direction, borrow A's editorial voice.**

Rationale:
1. The product's hardest problem is **mode + control clarity** (Preview / Play Along / Wait For You + transport that never vanishes + progressive disclosure). B solves it structurally with the deck metaphor; A and C solve it cosmetically.
2. The brief's "unique, not generic SaaS" rules out C as a lead — C is the fallback if B tests as intimidating.
3. The brief's "approachable for normal musicians" is B's real risk — mitigated by A's contribution: plain musician-language copy, serif or warm display accents for piece titles/Home headlines, paper-warm surfaces in Home/Library, while the Score workspace keeps B's precision. Warmth in words and welcome; precision in tools.
4. Constraints fit: monochrome-plus-one-accent evolves today's tokens (no rewrite); dark-first matches practice reality; hardware restraint ("one LED, no glow") enforces the no-neon rule better than a rule document.
5. Selective depth has a defined home: the transport deck + score sheet shadow. Everywhere else stays flat — gimmick-proof by construction.

Concretely: sidebar rail + deck transport + detented mode switch + LED status modules (B); editorial Home headlines, piece-title typography, plain-language copy, paper textures in non-score areas (A); C contributes only its accessibility discipline (targets, contrast, sentence-case) and its honest segmented control for the Score/Guide view toggle.

Next step after approval: visual exploration of the mode switch + deck + sidebar in static mockups (code or Figma — proposer's choice) before Phase A tokens are frozen.
