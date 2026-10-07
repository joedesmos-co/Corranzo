# Corranzo: at the music stand

Base: `77424bd240` (`origin/codex/corranzo-ui-overhaul-v1`). Worktree: `/Users/ryland/Documents/scoreflow-ui-redesign`. Branch: `codex/corranzo-musician-ui-redesign`. No uncommitted source copied, no research branches merged.

## Audit before implementation

Inspected source and running Home, repertoire, import, score, tempo dialog, History, Settings and narrow score layout. Baseline screenshots are in `before/`.

The product already avoids most stock SaaS tropes: no dominant gradients, no pervasive glass, no rainbow of metrics. Keep the repertoire rows, original PDF, focus mode and understated feedback. The problems are a marketing-sized Home hero, decorative tilted paper, competing entry points, and disjoint surface systems. Settings repeats large brown cards and amber controls. History uses oversized padding and metric boxes. Uploaded works revert to file cards. Tiny supporting text and duplicate headings reduce useful density. Practice hardcodes an independent green palette and applies the same canvas filter to both paper choices.

## System

- Functional controls stay precise. Musical character comes from the work, its page, bar and tempo, and real user marks.
- Graphite studio `#242925`, warm page `#f3f0e7`, print white `#fffdf7`, vermilion `#a63c2d`; light vermilion for dark surfaces. Preserve Corranzo's mark. No new decorative colors.
- Native refined sans for interaction; Georgia/Iowan editorial voice for work titles and headings; mono only for bar/page references and timing. No handwriting font.
- 4/8/12/16/24/32/48 spacing rhythm. Page headings are compact; the score carries the visual weight.
- 4px control radius; 2px document framing; circles reserved for toggles/radio choices. Group with rules and margins, not nested cards.
- Paper for choosing and reflecting; dark desk for reading/playing. The score stays high contrast and its coordinate geometry is unchanged.
- One primary action per composition. Home leads with a real work; supporting practice prompts are explicitly guidance, never fictional personal history.
- Musical details: live bar reference, printed tempo, active passage bracket, factual completion check, actual annotation tools. No invented marks on score images.
- Motion only on interaction/state changes; respect reduced motion. Maintain 44px touch targets, visible keyboard focus, route focus and existing dialog traps.

## Priority

1. Replace Home's marketing hero with a working music stand.
2. Unify tokens and light-surface roles across Library, Import, History and Settings.
3. Give saved works ruled rows; reduce duplicate visual hierarchy.
4. Refine practice controls, paper choices and passage/tempo references without changing playback or recognition.
5. Turn History into a compact practice journal and Settings into open, ruled sections.

No new metrics, phrase scoring, OMR logic, models or research changes are part of this redesign.
