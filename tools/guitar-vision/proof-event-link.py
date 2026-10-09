#!/usr/bin/env python3
"""Exact joins<->canonical event links (supervision construction).

Convention (verified against dataset-render.sid_for_event): the parser's
document-order note counter stamps both sides. Canonical noteId
`P1-m9-n162` (0-based) <-> joins sid `<prefix>-n163` (1-based, %03d).
Counters are global across parts/measures/rests. Using source truth to
BUILD supervision is legitimate; image inference never touches it.

Self-consistency on corpus: 4052/4060 join sids resolve (99.8%; misses
are unison-merged/unmatched edge cases, reported per sample).

Usage:
    from proof_event_link import build_links
    links, stats = build_links(joins, canonical, prefix)
    # links: {joinsSid: {"event": event|None, "status": linked|unmatched|unison}}
"""
from __future__ import annotations

import re


def sid_for_event_counter(note_id: str, prefix: str) -> str | None:
    match = re.search(r"-n(\d+)$", note_id or "")
    if not match:
        return None
    return f"{prefix}-n{int(match.group(1)) + 1:03d}"


def build_links(joins: dict, canonical: dict | None, prefix: str) -> tuple[dict, dict]:
    by_sid: dict[str, dict] = {}
    if canonical:
        for event in canonical.get("events", []):
            sid = sid_for_event_counter((event.get("source") or {}).get("noteId") or "", prefix)
            if sid:
                by_sid[sid] = event
    merged: dict[str, str] = {}
    try:
        merged = (joins.get("mergedUnisons") or {})
    except AttributeError:
        pass
    links: dict[str, dict] = {}
    stats = {"linked": 0, "unmatched": 0, "unison": 0, "noEvent": 0}
    for sid in (joins.get("joins") or {}):
        event = by_sid.get(sid)
        if event is not None:
            links[sid] = {"event": event, "status": "linked"}
            stats["linked"] += 1
        elif sid in merged:
            twin = by_sid.get(merged[sid])
            links[sid] = {"event": twin, "status": "unison"}
            stats["unison"] += 1
        else:
            links[sid] = {"event": None, "status": "unmatched"}
            stats["unmatched"] += 1
    stats["noEvent"] = sum(1 for v in links.values() if v["event"] is None)
    return links, stats
