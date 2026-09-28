import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  buildVisualMeasureLayoutIndex,
  buildSourceFidelityLaneLayout,
  SOURCE_FIDELITY_SYSTEM_GAP,
  SOURCE_FIDELITY_SYSTEM_WIDTH,
  resolveSourceFidelityLaneX,
} from '../src/features/practice/sourceFidelityLayout.js'
import { buildVisualRenderingInstructions } from '../src/features/practice/visualRenderingInstructions.js'
import { buildVisualLaneGroups, resolveVisualLaneTransform } from '../src/features/practice/visualPracticeLane.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import * as F from './helpers/buildXml.js'

const PAGE_WIDTH = 1224
const MARGIN = 100
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2 // 1024 tenths
const SCALE = SOURCE_FIDELITY_SYSTEM_WIDTH / CONTENT_WIDTH

function lane(xml) {
  const timingMap = parseMusicXml(xml, 'page-box.musicxml')
  const groups = buildVisualRenderingInstructions(timingMap)
  return {
    timingMap,
    groups,
    layout: buildSourceFidelityLaneLayout(groups),
    fallback: buildSourceFidelityLaneLayout(groups, { pageTransform: 'off' }),
  }
}

function tenthsOf(units, layout) {
  return units / layout.pageTransform.tenthsToUnits
}

describe('Visual page coordinate transform', () => {
  it('retains the written page box and per-system engraved extents through the parser', () => {
    const timingMap = parseMusicXml(F.pageBoxScore(), 'page-box.musicxml')

    expect(timingMap.pageLayout).toEqual({
      pageWidth: PAGE_WIDTH,
      pageHeight: 1584,
      margins: {
        odd: { left: MARGIN, right: MARGIN, top: 80, bottom: 80 },
      },
    })
    const systemStarts = timingMap.measures.filter((measure) => measure.systemLayout)
    expect(systemStarts).toHaveLength(2)
    expect(systemStarts[0].systemLayout).toEqual({
      leftMargin: 72,
      rightMargin: 0,
      topSystemDistance: null,
    })
    expect(systemStarts[1].systemLayout).toEqual({
      leftMargin: 16,
      rightMargin: 0,
      topSystemDistance: null,
    })
  })

  it('exposes the page content box and system extents on the measure layout index', () => {
    const timingMap = parseMusicXml(F.pageBoxScore(), 'page-box.musicxml')
    const index = buildVisualMeasureLayoutIndex(timingMap)

    expect(index.get(1)).toMatchObject({
      pageContentWidthTenths: CONTENT_WIDTH,
      pageWidthTenths: PAGE_WIDTH,
      systemLeftMargin: 72,
      systemRightMargin: 0,
    })
    // Only the first measure of a written system carries the declaration.
    expect(index.get(2).systemLeftMargin).toBeNull()
    expect(index.get(3).systemLeftMargin).toBeNull()
    expect(index.get(4).systemLeftMargin).toBe(16)
    expect(index.get(5).systemLeftMargin).toBeNull()
  })

  it('projects every measure width as its exact engraved tenths', () => {
    const { layout } = lane(F.pageBoxScore())

    expect(layout.pageTransform).toEqual({
      mode: 'page-affine',
      source: 'musicxml-page-layout',
      pageContentWidthTenths: CONTENT_WIDTH,
      tenthsToUnits: SCALE,
      systemCount: 2,
    })
    expect(layout.measures.map((measure) => measure.layout.engravedWidth)).toEqual([
      300, 300, 352, 504, 504,
    ])
    for (const measure of layout.measures) {
      expect(tenthsOf(measure.xEnd - measure.xStart, layout)).toBeCloseTo(
        measure.layout.engravedWidth,
        9,
      )
    }
  })

  it('keeps the printed indentation of each system instead of a uniform band', () => {
    const { layout, fallback } = lane(F.pageBoxScore())
    const [opening, following] = layout.systems

    // The opening system is inset 72 tenths; the next by only 16.
    expect(tenthsOf(opening.xStart, layout)).toBeCloseTo(72, 9)
    expect(tenthsOf(following.xStart - opening.xEnd - SOURCE_FIDELITY_SYSTEM_GAP, layout)).toBeCloseTo(
      16,
      9,
    )
    // Extents are the declared ones, so the two systems are not the same width.
    expect(tenthsOf(opening.xEnd - opening.xStart, layout)).toBeCloseTo(952, 9)
    expect(tenthsOf(following.xEnd - following.xStart, layout)).toBeCloseTo(1008, 9)
    expect(following.xEnd - following.xStart).toBeGreaterThan(opening.xEnd - opening.xStart)

    // Previous behaviour renormalised every system onto the same nominal band
    // and dropped the indentation entirely.
    expect(fallback.pageTransform).toBeNull()
    for (const system of fallback.systems) {
      expect(system.xEnd - system.xStart).toBeCloseTo(SOURCE_FIDELITY_SYSTEM_WIDTH, 9)
    }
    expect(fallback.systems[0].xStart).toBe(0)
    expect(fallback.systems[1].xStart).toBeCloseTo(
      SOURCE_FIDELITY_SYSTEM_WIDTH + SOURCE_FIDELITY_SYSTEM_GAP,
      9,
    )
  })

  it('keeps the inter-system break a structural gap, never a page crop', () => {
    const { layout } = lane(F.pageBoxScore())
    const [opening, following] = layout.systems

    expect(following.xStart - opening.xEnd).toBeGreaterThan(SOURCE_FIDELITY_SYSTEM_GAP)
    expect(following.xStart - opening.xEnd).toBeCloseTo(
      SOURCE_FIDELITY_SYSTEM_GAP + 16 * SCALE,
      9,
    )
  })

  it('keeps lane time-to-x mapping monotonic across the page-affine transform', () => {
    const { layout } = lane(F.pageBoxScore())
    const anchors = layout.timeAnchors

    expect(anchors.length).toBeGreaterThan(1)
    for (let index = 1; index < anchors.length; index += 1) {
      expect(anchors[index].timeSeconds).toBeGreaterThanOrEqual(anchors[index - 1].timeSeconds)
      expect(anchors[index].x).toBeGreaterThan(anchors[index - 1].x)
    }
    // Lane X between two anchors stays inside the systems they belong to.
    for (const anchor of anchors) {
      const x = resolveSourceFidelityLaneX(layout, anchor.timeSeconds)
      expect(Number.isFinite(x)).toBe(true)
    }
  })

  it('aligns every rendered event with the playhead at its own score time', () => {
    const { layout } = lane(F.pageBoxScore())
    const viewWidth = 900

    for (const anchor of layout.timeAnchors) {
      // Mirror the lane camera: the bar sits at playheadX and the lane is
      // translated by playheadX - laneX(t).
      const { playheadX } = resolveVisualLaneTransform({
        frameTime: anchor.timeSeconds,
        viewWidth,
        durationSeconds: 20,
      })
      const scrollX = playheadX - resolveSourceFidelityLaneX(layout, anchor.timeSeconds)
      expect(scrollX + anchor.x).toBeCloseTo(playheadX, 9)
      expect(anchor.x).toBe(layout.groupXById.get(anchor.groupId))
    }
  })

  it('leaves note timing, playback grouping and Wait For You untouched', () => {
    const xml = F.pageBoxScore()
    const { timingMap } = lane(xml)

    const groups = buildVisualLaneGroups(timingMap, null)
    const checkpoints = buildNoteCheckpoints(timingMap)
    const after = parseMusicXml(xml, 'page-box.musicxml')

    expect(groups.map((group) => group.timeSeconds)).toEqual(
      after.notes.filter((note) => !note.isRest).map((note) => note.timeSeconds),
    )
    expect(checkpoints).toHaveLength(20)
    expect(checkpoints[0]).toMatchObject({ measureNumber: 1, timeSeconds: 0 })
    expect(timingMap.notes).toHaveLength(after.notes.length)
    // The transform is horizontal layout only: no note gained or lost geometry.
    const withTransform = lane(xml).layout
    const withoutTransform = lane(xml).fallback
    expect(withTransform.objectXById.size).toBe(withoutTransform.objectXById.size)
    expect(withTransform.systemOccurrenceByObjectId.size).toBe(
      withoutTransform.systemOccurrenceByObjectId.size,
    )
  })

  describe('falls back to per-system band normalisation', () => {
    /** Every system is stretched onto the nominal band and starts unindented. */
    function expectUniformBands(layout, systemCount) {
      expect(layout.pageTransform).toBeFalsy()
      expect(layout.systems).toHaveLength(systemCount)
      for (const system of layout.systems) {
        expect(system.xEnd - system.xStart).toBeCloseTo(SOURCE_FIDELITY_SYSTEM_WIDTH, 9)
      }
      expect(layout.systems[0].xStart).toBe(0)
    }

    it('when the score declares no page box', () => {
      expectUniformBands(lane(F.pageBoxScore({ omitPageLayout: true })).layout, 2)
    })

    it('when measures carry no engraved width', () => {
      expectUniformBands(lane(F.pageBoxScore({ omitMeasureWidths: true })).layout, 2)
    })

    it('when a system is declared wider than the page it was drawn on', () => {
      const { layout } = lane(
        F.pageBoxScore({
          systems: [
            { leftMargin: 0, rightMargin: 0, widths: [1200] },
            { leftMargin: 0, rightMargin: 0, widths: [1200] },
          ],
        }),
      )

      // 1200 tenths cannot fit a 1024-tenths page, so the declarations conflict
      // and the widths are renormalised rather than projected.
      expectUniformBands(layout, 2)
    })

    it('when measures on two pages declare conflicting content boxes', () => {
      const { layout, timingMap } = lane(
        F.pageBoxScore({
          evenMarginLeft: 300,
          evenMarginRight: 100,
          systems: [
            { leftMargin: 72, rightMargin: 0, widths: [300, 300, 352] },
            { leftMargin: 16, rightMargin: 0, widths: [504, 504], newPage: true },
          ],
        }),
      )

      // Page 1 (odd) and page 2 (even) disagree about the content box.
      const index = buildVisualMeasureLayoutIndex(timingMap)
      expect(index.get(1).pageContentWidthTenths).toBe(CONTENT_WIDTH)
      expect(index.get(4).pageContentWidthTenths).toBe(PAGE_WIDTH - 300 - 100)
      expectUniformBands(layout, 2)
    })
  })

  it('applies the transform only to written layout, never to note coordinates', () => {
    const { layout } = lane(F.pageBoxScore())
    const { layout: fallback } = lane(F.pageBoxScore())
    const off = lane(F.pageBoxScore()).fallback

    // Same object count and same system assignment; only horizontal position moves.
    expect(layout.objectXById.size).toBe(off.objectXById.size)
    expect(fallback.mode).toBe('source-fidelity')
    const movedIds = [...layout.objectXById.keys()].filter(
      (id) => Math.abs(layout.objectXById.get(id) - off.objectXById.get(id)) > 1e-9,
    )
    expect(movedIds.length).toBeGreaterThan(0)
  })
})
