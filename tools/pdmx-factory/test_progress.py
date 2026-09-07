#!/usr/bin/env python3
"""Precision and denominator-state tests for global factory progress."""

from __future__ import annotations

import unittest

from progress import aggregate_denominator_state, estimated_total, percent, progress_record


class ProgressMathTest(unittest.TestCase):
    def test_exact_percentages_keep_tiny_movement(self):
        self.assertEqual(percent(0, 36535), 0.0)
        self.assertAlmostEqual(percent(1, 36535), 100 / 36535)
        self.assertAlmostEqual(percent(12843, 33376), 12843 / 33376 * 100)

    def test_completion_gate_prevents_premature_hundred(self):
        self.assertEqual(percent(999999, 1000000), 99.9999)
        self.assertEqual(percent(1000000, 1000000, completion_gate=False), 99.9999)
        self.assertEqual(percent(1000000, 1000000, completion_gate=True), 100.0)

    def test_unknown_denominators_never_fake_percent(self):
        calculating = progress_record(1283, None, "CALCULATING", "not inventoried")
        unavailable = progress_record(1283, None, "UNAVAILABLE", "cannot be known")
        self.assertIsNone(calculating["denominator"])
        self.assertIsNone(calculating["percentage"])
        self.assertIsNone(unavailable["denominator"])
        self.assertIsNone(unavailable["percentage"])

    def test_estimated_totals_are_labeled(self):
        total, state = estimated_total(1200, 4, 20)
        self.assertEqual((total, state), (6000, "ESTIMATED"))
        record = progress_record(1200, total, state, "sample extrapolation")
        self.assertEqual(record["denominatorState"], "ESTIMATED")
        self.assertEqual(record["percentage"], 20.0)

    def test_denominator_state_upgrades(self):
        self.assertEqual(aggregate_denominator_state(["EXACT"], False), "CALCULATING")
        self.assertEqual(aggregate_denominator_state(["EXACT", "ESTIMATED"], True), "ESTIMATED")
        self.assertEqual(aggregate_denominator_state(["EXACT", "UNAVAILABLE"], True), "UNAVAILABLE")
        self.assertEqual(aggregate_denominator_state(["EXACT", "EXACT"], True), "EXACT")


if __name__ == "__main__":
    unittest.main(verbosity=2)
