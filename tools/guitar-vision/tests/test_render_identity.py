"""Guitar Vision — render/source identity pilot tests (G1).

Proves the document-order assumption is gone: every rendered note group
joins to its symbolic source event by stable ID string equality.

  * stable IDs across separate processes (a fresh interpreter stamps the
    same file and must produce byte-identical IDs);
  * exact source->render joins, standard-only and paired standard+TAB;
  * explicit notehead / TAB-text mapping per joined group;
  * page + box provenance in canonical page units;
  * no order fallback: unmatched IDs on either side fail the test.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
TOOLS = ROOT / "tools" / "guitar-vision"
FIXTURES = ROOT / "datasets" / "guitar-vision" / "fixtures" / "notation-v1"
sys.path.insert(0, str(TOOLS))

from render_identity import identity_join, inject_stable_ids, render_svg


def stamp(path: Path, prefix: str):
    xml = path.read_text(encoding="utf-8")
    return inject_stable_ids(xml, prefix)


def test_ids_stable_across_processes():
    target = FIXTURES / "paired-staff-tab.musicxml"
    _, expected = stamp(target, "gv-pilot")
    probe = (
        "import sys; sys.path.insert(0, %r);"
        "from pathlib import Path;"
        "from render_identity import inject_stable_ids;"
        "_, ids = inject_stable_ids(Path(%r).read_text(), 'gv-pilot');"
        "print('\\n'.join(ids))" % (str(TOOLS), str(target))
    )
    proc = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True, check=True)
    assert proc.stdout.split() == expected


def test_standard_only_exact_identity():
    stamped, ids = stamp(FIXTURES / "simple-4-4-rhythm.musicxml", "gv-std")
    assert len(ids) == 3
    svg, toolkit = render_svg(stamped)
    result = identity_join(svg, ids, toolkit)
    assert result["identityRate"] == 1.0
    assert result["duplicates"] == []
    assert result["unmatchedSource"] == []
    assert result["unmatchedRendered"] == []
    for source_id, join in result["joins"].items():
        assert "notehead" in join["children"], source_id
        assert join["page"] == 1
        assert len(join["boxes"]) == 1
        x0, y0, x1, y1 = join["boxes"][0]
        assert x1 > x0 and y1 > y0


def test_paired_standard_tab_exact_identity():
    stamped, ids = stamp(FIXTURES / "paired-staff-tab.musicxml", "gv-paired")
    assert len(ids) == 2
    svg, toolkit = render_svg(stamped)
    result = identity_join(svg, ids, toolkit)
    assert result["identityRate"] == 1.0
    assert result["duplicates"] == []
    assert result["unmatchedSource"] == []
    assert result["unmatchedRendered"] == []
    kinds = sorted("notehead" if "notehead" in j["children"] else "tab" for j in result["joins"].values())
    assert kinds == ["notehead", "tab"], kinds


def test_tab_chord_digits_join_by_id():
    stamped, ids = stamp(FIXTURES / "tab-chord-verified.musicxml", "gv-tab")
    assert len(ids) == 5
    svg, toolkit = render_svg(stamped)
    result = identity_join(svg, ids, toolkit)
    assert result["identityRate"] == 1.0
    assert result["unmatchedSource"] == []
    assert result["unmatchedRendered"] == []


def test_rest_groups_carry_source_ids():
    stamped, ids = stamp(FIXTURES / "rests.musicxml", "gv-rest")
    assert len(ids) == 3
    svg, toolkit = render_svg(stamped)
    result = identity_join(svg, ids, toolkit)
    assert result["identityRate"] == 1.0
    assert result["unmatchedSource"] == []
    kinds = {tuple(j["children"]) for j in result["joins"].values()}
    assert kinds == {("rest",)}, kinds


def test_no_order_fallback_tampered_id_fails():
    stamped, ids = stamp(FIXTURES / "simple-4-4-rhythm.musicxml", "gv-std")
    svg, toolkit = render_svg(stamped)
    tampered = [source_id + "-nope" for source_id in ids]
    result = identity_join(svg, tampered, toolkit)
    assert result["identityRate"] == 0.0
    assert len(result["unmatchedSource"]) == len(ids)


def test_all_fixtures_render_in_verovio():
    """Every fixture must load in the engraver: render identity applies
    "where applicable" (G8), and a fixture the renderer refuses is not
    applicable at all. Failure here names the fixture, not a statistic."""
    import verovio

    failures = []
    for path in sorted(FIXTURES.glob("*.musicxml")):
        toolkit = verovio.toolkit()
        toolkit.setOptions(
            {
                "pageWidth": 2100,
                "pageHeight": 2970,
                "scale": 40,
                "adjustPageWidth": True,
                "adjustPageHeight": True,
                "footer": "none",
                "header": "none",
            }
        )
        try:
            ok = toolkit.loadData(path.read_text(encoding="utf-8"))
        except Exception as error:  # noqa: BLE001
            ok = False
            failures.append(f"{path.name}: {error}")
        if not ok:
            failures.append(f"{path.name}: Verovio refused the file")
    assert failures == []
