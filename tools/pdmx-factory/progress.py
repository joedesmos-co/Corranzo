#!/usr/bin/env python3
"""Exact denominator-state and percentage helpers for factory progress."""

from __future__ import annotations


DENOMINATOR_STATES = {"EXACT", "ESTIMATED", "CALCULATING", "UNAVAILABLE"}


def percent(numerator, denominator, *, completion_gate=True):
    """Return an unrounded percentage or None when no denominator exists.

    A mathematically complete ratio is held at 99.9999 until its explicit
    completion gate passes, preventing a premature 100.0000% display.
    """
    if denominator is None or denominator <= 0:
        return 100.0 if denominator == 0 and completion_gate else None
    value = max(0.0, min(100.0, float(numerator) * 100.0 / float(denominator)))
    if value >= 100.0 and not completion_gate:
        return 99.9999
    return value


def progress_record(numerator, denominator, state, definition, *, completion_gate=True, known_subtotal=None):
    if state not in DENOMINATOR_STATES:
        raise ValueError(f"Invalid denominator state: {state}")
    if state in {"CALCULATING", "UNAVAILABLE"}:
        denominator = None
    numerator = int(numerator or 0)
    denominator = int(denominator) if denominator is not None else None
    return {
        "numerator": numerator,
        "denominator": denominator,
        "denominatorState": state,
        "percentage": percent(numerator, denominator, completion_gate=completion_gate),
        "completionGatePassed": bool(completion_gate),
        "knownSubtotal": int(known_subtotal) if known_subtotal is not None else None,
        "definition": definition,
    }


def estimated_total(numerator, observed_units, planned_units, minimum_samples=3):
    if planned_units == 0:
        return 0, "EXACT"
    if observed_units >= planned_units:
        return int(numerator), "EXACT"
    if observed_units < minimum_samples or numerator <= 0:
        return None, "CALCULATING"
    return max(int(numerator), round(float(numerator) * planned_units / observed_units)), "ESTIMATED"


def aggregate_denominator_state(states, complete):
    states = list(states)
    if not complete:
        return "CALCULATING"
    if not states or any(state == "UNAVAILABLE" for state in states):
        return "UNAVAILABLE"
    if any(state == "ESTIMATED" for state in states):
        return "ESTIMATED"
    return "EXACT"
