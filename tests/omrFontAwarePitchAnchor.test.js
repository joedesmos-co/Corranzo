import { describe, expect, it } from "vitest";
import {
  midiFromStaffPosition,
  resolveNoteheadAnchor,
} from "../src/features/omr/pitchFromStaffPosition.js";
import {
  applyNoteheadFallbackCalibration,
  buildNoteheadFallbackCalibrations,
} from "../src/features/omr/noteheadFallbackCalibration.js";

function image(width = 240, height = 280) {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  return { width, height, data };
}

function inkPixel(target, x, y) {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
  const offset = (Math.round(y) * target.width + Math.round(x)) * 4;
  target.data[offset] = 0;
  target.data[offset + 1] = 0;
  target.data[offset + 2] = 0;
  target.data[offset + 3] = 255;
}

function horizontal(target, x0, x1, y, thickness = 1) {
  for (
    let dy = -Math.floor(thickness / 2);
    dy <= Math.floor(thickness / 2);
    dy += 1
  ) {
    for (let x = Math.round(x0); x <= Math.round(x1); x += 1)
      inkPixel(target, x, y + dy);
  }
}

function vertical(target, x, y0, y1, thickness = 1) {
  for (
    let dx = -Math.floor(thickness / 2);
    dx <= Math.floor(thickness / 2);
    dx += 1
  ) {
    for (let y = Math.round(y0); y <= Math.round(y1); y += 1)
      inkPixel(target, x + dx, y);
  }
}

function ellipse(
  target,
  cx,
  cy,
  rx,
  ry,
  { open = false, asymmetric = false } = {},
) {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y += 1) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const distance = dx * dx + dy * dy;
      const edge = open ? distance >= 0.48 && distance <= 1.18 : distance <= 1;
      if (edge && (!asymmetric || x <= cx + rx * 0.72 || y >= cy))
        inkPixel(target, x, y);
    }
  }
}

function staff(target, lineYs, x0 = 15, x1 = 225) {
  for (const y of lineYs) horizontal(target, x0, x1, y);
}

function glyph(
  cx,
  baselineY,
  { width = 18, height = 30, text = "\ue0a4" } = {},
) {
  return {
    x: cx,
    y: baselineY,
    width,
    height,
    text,
    fontName: "SyntheticMusic-Regular",
  };
}

const LINES = [100, 120, 140, 160, 180];

describe("font-aware notehead pitch anchors", () => {
  it("centers a filled notehead between staff lines", () => {
    const page = image();
    staff(page, LINES);
    ellipse(page, 110, 150, 8, 5);
    const anchor = resolveNoteheadAnchor(glyph(110, 160), page, LINES);
    expect(anchor.source).toBe("ink-notehead-geometry");
    expect(anchor.yNorm * page.height).toBeCloseTo(150, 0);
  });

  it("uses the compact open-head outline instead of asymmetric full bounds", () => {
    const page = image();
    staff(page, LINES);
    ellipse(page, 110, 130, 9, 6, { open: true, asymmetric: true });
    const anchor = resolveNoteheadAnchor(
      glyph(110, 146, { height: 38, text: "\ue0a3" }),
      page,
      LINES,
    );
    expect(anchor.yNorm * page.height).toBeCloseTo(130, 1);
    expect(anchor.visualBounds.height).toBeLessThan(18);
  });

  it("excludes an attached stem from the vertical notehead center", () => {
    const page = image();
    staff(page, LINES);
    ellipse(page, 110, 150, 8, 5);
    vertical(page, 118, 105, 151, 2);
    const anchor = resolveNoteheadAnchor(
      glyph(110, 160, { height: 58 }),
      page,
      LINES,
    );
    expect(anchor.yNorm * page.height).toBeCloseTo(150, 1);
    expect(anchor.suppressedStemColumns).toBeGreaterThan(0);
  });

  it("is invariant under uniform scaling and transformed glyph metrics", () => {
    const page = image(480, 560);
    const lines = LINES.map((value) => value * 2);
    staff(page, lines, 30, 450);
    ellipse(page, 220, 300, 16, 10);
    const anchor = resolveNoteheadAnchor(
      glyph(220, 326, { width: 44, height: 72 }),
      page,
      lines.map((value) => value / page.height),
    );
    expect(anchor.yNorm * page.height).toBeCloseTo(300, 1);
  });

  it("centers a note on one ledger line above the staff", () => {
    const page = image();
    staff(page, LINES);
    horizontal(page, 98, 122, 80);
    ellipse(page, 110, 80, 8, 5);
    const anchor = resolveNoteheadAnchor(glyph(110, 92), page, LINES);
    expect(anchor.yNorm * page.height).toBeCloseTo(80, 1);
    expect(anchor.suppressedStaffOrLedgerRows).toBeGreaterThan(0);
    expect(
      anchor.source === "ink-notehead-geometry" ||
        anchor.source === "ledger-masked-ink-notehead-geometry",
    ).toBe(true);
  });

  it("centers a note on one ledger line below the staff", () => {
    const page = image();
    staff(page, LINES);
    horizontal(page, 98, 122, 200);
    ellipse(page, 110, 190, 8, 5);
    const anchor = resolveNoteheadAnchor(
      glyph(110, 202, { height: 42 }),
      page,
      LINES,
    );
    expect(anchor.yNorm * page.height).toBeCloseTo(190, 1);
    expect(
      midiFromStaffPosition(
        anchor.yNorm,
        LINES.map((y) => y / page.height),
        "treble",
      ),
    ).toBe(62);
  });

  it("uses the owned head when multiple ledger lines are present", () => {
    const page = image();
    staff(page, LINES);
    horizontal(page, 98, 122, 80);
    horizontal(page, 98, 122, 60);
    ellipse(page, 110, 60, 8, 5);
    const anchor = resolveNoteheadAnchor(
      glyph(110, 73, { height: 42 }),
      page,
      LINES,
    );
    expect(anchor.yNorm * page.height).toBeCloseTo(60, 1);
  });

  it("does not let a competing ledger fragment pull a neighboring note", () => {
    const page = image();
    staff(page, LINES);
    horizontal(page, 92, 119, 80);
    ellipse(page, 104, 80, 8, 5);
    ellipse(page, 137, 90, 8, 5);
    const left = resolveNoteheadAnchor(glyph(104, 92), page, LINES);
    const right = resolveNoteheadAnchor(glyph(137, 101), page, LINES);
    expect(left.yNorm * page.height).toBeCloseTo(80, 1);
    expect(right.yNorm * page.height).toBeCloseTo(90, 1);
  });

  it("keeps displaced seconds in a chord on separate vertical anchors", () => {
    const page = image();
    staff(page, LINES);
    ellipse(page, 106, 140, 8, 5);
    ellipse(page, 124, 150, 8, 5);
    const upper = resolveNoteheadAnchor(glyph(106, 151), page, LINES);
    const lower = resolveNoteheadAnchor(glyph(124, 161), page, LINES);
    expect(upper.yNorm * page.height).toBeCloseTo(140, 1);
    expect(lower.yNorm * page.height).toBeCloseTo(150, 1);
  });

  it("ignores a nearby accidental when centering the notehead", () => {
    const page = image();
    staff(page, LINES);
    ellipse(page, 110, 150, 8, 5);
    vertical(page, 91, 140, 160, 2);
    vertical(page, 97, 140, 160, 2);
    horizontal(page, 87, 101, 147, 2);
    horizontal(page, 87, 101, 153, 2);
    const anchor = resolveNoteheadAnchor(glyph(110, 160), page, LINES);
    expect(anchor.yNorm * page.height).toBeCloseTo(150, 1);
  });

  it("uses the supplied local staff model for a cross-staff note", () => {
    const page = image();
    const lower = [190, 210, 230, 250, 270];
    staff(page, LINES);
    staff(page, lower);
    ellipse(page, 110, 200, 8, 5);
    const anchor = resolveNoteheadAnchor(glyph(110, 211), page, lower);
    expect(anchor.yNorm * page.height).toBeCloseTo(200, 1);
    expect(
      midiFromStaffPosition(
        anchor.yNorm,
        lower.map((y) => y / page.height),
        "bass",
      ),
    ).toBe(55);
  });

  it("produces the same geometry with treble and bass clef while clef mapping stays distinct", () => {
    const page = image();
    staff(page, LINES);
    ellipse(page, 110, 140, 8, 5);
    const anchor = resolveNoteheadAnchor(glyph(110, 151), page, LINES);
    const normalized = LINES.map((y) => y / page.height);
    expect(midiFromStaffPosition(anchor.yNorm, normalized, "treble")).toBe(71);
    expect(midiFromStaffPosition(anchor.yNorm, normalized, "bass")).toBe(50);
  });

  it("selects the stacked head nearest the glyph origin instead of abandoning ink", () => {
    const page = image();
    staff(page, LINES);
    ellipse(page, 110, 135, 8, 5);
    ellipse(page, 110, 155, 8, 5);
    const anchor = resolveNoteheadAnchor(
      glyph(110, 166, { height: 46 }),
      page,
      LINES,
    );
    expect(anchor.source).toBe("ink-notehead-geometry");
    expect(Math.round(anchor.yNorm * page.height)).toBe(155);
    expect(anchor.competingHeadCandidates?.length).toBeGreaterThan(1);
  });

  it("still rejects two equally plausible vertical components as ambiguous", () => {
    const page = image();
    staff(page, LINES);
    ellipse(page, 110, 135, 8, 5);
    ellipse(page, 110, 155, 8, 5);
    // Baseline midway between heads → near-equal origin scores.
    const anchor = resolveNoteheadAnchor(
      glyph(110, 155, { height: 46 }),
      page,
      LINES,
    );
    expect(anchor.source).toBe("glyph-metrics-fallback");
    expect(anchor.rejectedReason).toBe("ambiguous-components");
  });

  it("maps equivalent text-glyph and vector-path bounds to the same staff position", () => {
    const page = image();
    staff(page, LINES);
    ellipse(page, 110, 150, 8, 5);
    const text = resolveNoteheadAnchor(
      glyph(110, 160, { width: 18, height: 30 }),
      page,
      LINES,
    );
    const transformed = resolveNoteheadAnchor(
      glyph(110, 168, { width: 32, height: 54 }),
      page,
      LINES,
    );
    const normalized = LINES.map((y) => y / page.height);
    expect(midiFromStaffPosition(text.yNorm, normalized, "treble")).toBe(
      midiFromStaffPosition(transformed.yNorm, normalized, "treble"),
    );
  });

  it("keeps an uncalibrated legacy-font glyph on the frozen metric profile", () => {
    const page = image();
    staff(page, LINES);
    ellipse(page, 110, 150, 8, 5);
    const anchor = resolveNoteheadAnchor(
      {
        ...glyph(110, 160),
        legacyMusicFontNormalized: true,
        originalLegacyText: "\ue12d",
      },
      page,
      LINES,
    );
    expect(anchor.source).toBe("glyph-metrics-fallback");
    expect(anchor.rejectedReason).toBe("legacy-font-profile-unavailable");
  });

  it("places a tall upper-treble metric fallback on the E-line not the F-line", () => {
    const page = image(1000, 1172);
    const lineYs = [222, 233, 244, 255, 266];
    staff(page, lineYs);
    ellipse(page, 590, 227, 8, 5);
    const noteGlyph = glyph(590, 234, { width: 18, height: 25 });
    const normalized = lineYs.map((y) => y / page.height);
    const anchor = resolveNoteheadAnchor(noteGlyph, page, normalized);
    expect(midiFromStaffPosition(anchor.yNorm, normalized, "treble")).toBe(76);
    expect(midiFromStaffPosition(anchor.yNorm, normalized, "treble")).not.toBe(77);
  });

  it("self-calibrates rejected dense-chord fallbacks to the same staff step", () => {
    const page = image(1000, 1172);
    const lineYs = [222, 233, 244, 255, 266];
    staff(page, lineYs);
    for (const centerY of [210, 227, 244, 261, 278, 227, 244]) {
      ellipse(page, 520, centerY, 8, 5);
    }
    const normalized = lineYs.map((y) => y / page.height);
    const gapNorm = (lineYs[4] - lineYs[0]) / 4 / page.height;
    const heightNorm = 25 / page.height;
    const samples = [210, 227, 244, 261, 278, 227, 244].map((centerY) => ({
      glyph: glyph(520, centerY + 7, { width: 18, height: 25 }),
      source: "ink-notehead-geometry",
      confidence: 0.96,
      originToCenterSpaces: 0.51,
      glyphHeightSpaces: heightNorm / gapNorm,
    }));
    const calibration = buildNoteheadFallbackCalibrations(samples);
    const denseGlyph = glyph(590, 234, { width: 18, height: 25 });
    const rejected = resolveNoteheadAnchor(denseGlyph, page, normalized);
    const calibrated = applyNoteheadFallbackCalibration({
      anchor: {
        ...rejected,
        rejectedReason: "ambiguous-components",
      },
      glyph: denseGlyph,
      imageData: page,
      lineYs: normalized,
      calibration,
    });
    expect(calibrated.source).toBe("self-calibrated-glyph-fallback");
    expect(midiFromStaffPosition(calibrated.yNorm, normalized, "treble")).toBe(76);
  });
});
