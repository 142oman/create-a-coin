"""Invariants the method promises. Run: python -m unittest"""
import math
import random
import unittest

from ladder import backtest, compare, engine, simulate, validate
from ladder.config import QUALIFY_REACH, STEP_CHANCE
from ladder.history import replay
from ladder.store import Summary, drop_after_peak, weighted_median
from ladder.world import POST_STATES, Recipe, draw_params, export_fields, generate

WORLD = generate(Recipe())
RESULTS, _, SUMMARY = replay(WORLD)
VALIDATION = validate.run(WORLD)


def post(pid="p", creator="c", category="gaming", fmt="reel", tier="micro", day=0, daily=(100, 90), bought=0):
    return {"post_id": pid, "creator_id": creator, "category": category, "platform": "instagram", "tier": tier,
            "format": fmt, "day": day, "daily": list(daily), "bought": bought}


class World(unittest.TestCase):
    def test_same_recipe_same_world(self):
        again = generate(Recipe())
        self.assertEqual([p["daily_views"] for p in again.posts[:50]], [p["daily_views"] for p in WORLD.posts[:50]])

    def test_different_seed_different_world(self):
        self.assertNotEqual(len(generate(Recipe(seed=3)).posts), len(WORLD.posts))

    def test_dead_is_permanent_and_only_fading_posts_die(self):
        rows = draw_params(Recipe())["post_transitions"]
        dead = POST_STATES.index("dead")
        self.assertEqual(rows[dead][dead], 1.0)
        for i, st in enumerate(POST_STATES[:-1]):
            if st != "fading":
                self.assertEqual(rows[i][dead], 0)

    def test_views_never_decrease_and_export_matches_daily(self):
        for p in WORLD.posts[:300]:
            self.assertTrue(all(v >= 0 for v in p["daily_views"]))
            self.assertLessEqual(p["views_at_24h"], p["views_at_7d"])
            self.assertLessEqual(p["views_at_7d"], p["views_at_30d"])
            self.assertLessEqual(p["views_at_30d"], p["views_final"])
            self.assertEqual(p["views_final"], sum(p["daily_views"]))

    def test_export_caps_at_campaign_end(self):
        self.assertEqual(export_fields([5, 5, 5]),
                         {"views_at_24h": 5, "views_at_7d": 15, "views_at_30d": 15, "views_final": 15})

    def test_bigger_accounts_get_more_views(self):
        self.assertGreater(VALIDATION["followers_vs_views_correlation"], 0.3)

    def test_heavy_tail(self):
        self.assertGreater(VALIDATION["heavy_tail"]["top_10pct_share"], 0.5)


class Rungs(unittest.TestCase):
    def test_rung_levels_follow_the_policy(self):
        values = [math.exp(random.Random(i).gauss(8, 1)) for i in range(4000)]
        for k, r in enumerate(engine.rungs_from(values)):
            share = sum(v >= r for v in values) / len(values)
            self.assertAlmostEqual(share, QUALIFY_REACH * STEP_CHANCE ** k, delta=0.03)

    def test_strictly_rising(self):
        self.assertEqual(engine.rungs_from([5, 5, 5, 5]), [5])
        r = engine.rungs_from(list(range(1, 1000)))
        self.assertEqual(r, sorted(set(r)))

    def test_paid_only_for_the_rung_reached(self):
        self.assertEqual(engine.rung_coins(42, [10, 40, 80]), 40)
        self.assertEqual(engine.rung_coins(9, [10, 40, 80]), 0)
        self.assertEqual(engine.rung_coins(10_000, [10, 40, 80]), 80)

    def test_calibration_on_unseen_campaigns(self):
        r = VALIDATION["rungs"]
        for design, actual in zip(r["design"], r["actual"]):
            self.assertAlmostEqual(actual, design, delta=0.1)


class Price(unittest.TestCase):
    def test_never_more_than_the_budget(self):
        for coins in (1, 100, 10**5, 10**9):
            for ref in (None, 1e-4, 0.05, 10):
                price, _ = engine.settle(1000, coins, ref)
                self.assertLessEqual(price * coins, 1000 + 1e-6)

    def test_thin_is_the_nash_split(self):
        price, regime = engine.settle(100_000, 10_000, 0.05)
        self.assertEqual(regime, "thin")
        self.assertAlmostEqual(price, math.sqrt(10 * 0.05))

    def test_every_view_prices_but_only_rung_coins_pay(self):
        res = engine.run(Summary(), 1000, 2, [post(daily=(42, 0))], ["gaming"], ["reel"])
        self.assertEqual(res["coins"], 42)
        d = res["posts"][0]
        self.assertLessEqual(d["rung_coins"], 42)
        self.assertAlmostEqual(res["paid"] + res["refund"], 1000)
        self.assertAlmostEqual(res["refund_between_rungs"], res["price"] * (42 - d["rung_coins"]))

    def test_history_never_over_budget_and_adds_up(self):
        for r in RESULTS.values():
            if r:
                self.assertLessEqual(r["paid"], r["budget"] + 1e-6)
                self.assertAlmostEqual(r["paid"] + r["refund"], r["budget"], delta=1e-6)

    def test_reference_order(self):
        s = Summary()
        s.prices = [("gaming", "reel", 0.05, 10), ("FMCG", "reel", 0.5, 10)]
        self.assertEqual(s.reference(["gaming"], ["reel"]), (0.05, "same category and format"))
        self.assertEqual(s.reference(["finance"], ["reel"])[1], "same format, any category")
        self.assertIsNone(s.reference(["finance"], ["short"])[0])

    def test_weighted_median(self):
        self.assertEqual(weighted_median([(1, 1), (2, 1), (3, 5)]), 3)


class Fraud(unittest.TestCase):
    cut = {"drop_alone": 0.1, "drop_together": 0.3, "usual_together": 3, "usual_alone": 10}

    def test_drop_after_peak(self):
        self.assertAlmostEqual(drop_after_peak([100, 1000, 10]), 11 / 1001)
        self.assertIsNone(drop_after_peak([1, 2, 3]))

    def test_cliff_is_held_gradual_is_not(self):
        self.assertTrue(engine.fraud_check([100, 5000, 50, 40], 1000, self.cut)[0])
        self.assertFalse(engine.fraud_check([100, 5000, 3500, 2500], 1000, self.cut)[0])

    def test_size_alone_never_holds_unless_the_peak_is_last(self):
        self.assertFalse(engine.fraud_check([100, 90000, 60000], 100, self.cut)[0])
        self.assertTrue(engine.fraud_check([10, 20, 90000], 100, self.cut)[0])

    def test_proven_fraud_is_never_paid(self):
        for r in RESULTS.values():
            for d in (r or {}).get("posts", []):
                if d["fraud"]:
                    self.assertEqual(d["paid"], 0)

    def test_false_alarms_are_rare(self):
        self.assertLess(VALIDATION["fraud"]["false_alarm_rate"], 0.03)


class FairReach(unittest.TestCase):
    def test_only_lowers(self):
        for r in RESULTS.values():
            for e in (r or {}).get("events", []):
                if e["kind"] == "fair_reach":
                    self.assertLess(e["factor"], 1)
                    self.assertLess(e["shortfall"], 1)

    def test_binomial(self):
        self.assertAlmostEqual(engine.binom_cdf(10, 10, 0.8), 1.0)
        self.assertLess(engine.binom_cdf(2, 20, 0.8), 1e-6)


class ColdStart(unittest.TestCase):
    def test_zero_history_builds_rungs_from_the_campaign(self):
        daily = [[max(1, int(1000 * 0.9 ** d)) * (i + 1) for d in range(20)] for i in range(10)]
        posts = [post(pid=f"p{i}", creator=f"c{i}", daily=d) for i, d in enumerate(daily)]
        res = engine.run(Summary(), 5000, 20, posts, ["gaming"], ["reel"])
        self.assertTrue(res["cold_segments"])
        self.assertTrue(any(e["kind"] == "cold_start" for e in res["events"]))
        self.assertTrue(all(d["rungs"] for d in res["posts"]))

    def test_without_category_is_a_cold_start(self):
        self.assertFalse(any(s[0] == "gaming" for s in SUMMARY.without_category("gaming").segment_views))


class Simulation(unittest.TestCase):
    def test_same_seed_same_campaign(self):
        a = simulate.simulate(WORLD, SUMMARY, ["gaming"], ["reel"], 20000, 14, seed=5)
        b = simulate.simulate(WORLD, SUMMARY, ["gaming"], ["reel"], 20000, 14, seed=5)
        self.assertEqual(a["report"], b["report"])

    def test_never_over_budget_in_any_scenario(self):
        for sc in simulate.SCENARIOS:
            r = simulate.simulate(WORLD, SUMMARY, ["FMCG"], ["short"], 15000, 14, seed=2, scenario=sc)
            self.assertLessEqual(r["ours"]["paid"], 15000 + 1e-6)

    def test_crowded_is_cheaper_per_view_than_thin(self):
        crowded = simulate.simulate(WORLD, SUMMARY, ["gaming"], ["reel"], 20000, 14, seed=3, scenario="crowded")
        thin = simulate.simulate(WORLD, SUMMARY, ["gaming"], ["reel"], 20000, 14, seed=3, scenario="thin")
        self.assertLess(crowded["ours"]["price"], thin["ours"]["price"])

    def test_creator_run_pays_the_creator(self):
        me = simulate.profiles(WORLD, 1)[0]["creator_id"]
        card = simulate.campaign_cards(WORLD, me, 1)[0]
        self.assertTrue(simulate.creator_run(WORLD, SUMMARY, me, card, 1)["me"]["posts"])


class Pages(unittest.TestCase):
    def test_backtest_measures(self):
        r = backtest.run(WORLD)
        self.assertEqual(r["budget"]["new_over"], 0)
        self.assertEqual(r["campaigns"], sum(1 for x in RESULTS.values() if x))

    def test_compare_uses_real_past_campaigns(self):
        r = compare.compare(WORLD, ["gaming"], ["reel"], 20000, {"budget": 20000, "rungs": [[10000, 500], [50000, 2000]]})
        self.assertGreater(r["count"], 0)
        self.assertEqual(r["summary"]["ours_over_count"], 0)
        self.assertEqual(r["worlds"][r["worst"]]["old"]["waste"], max(w["old"]["waste"] for w in r["worlds"]))

    def test_compare_falls_back_to_same_format(self):
        w, basis = compare.worlds_for(WORLD, ["nonexistent"], ["reel"])
        self.assertEqual(basis, "same format, any category")
        self.assertTrue(w)


if __name__ == "__main__":
    unittest.main()
