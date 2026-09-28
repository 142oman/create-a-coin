"""Invariants the method promises. Run: python -m unittest"""
import math
import unittest
from datetime import timedelta

from ladder.backtest import eligible, evaluate
from ladder.builder import CampaignParams, GroupLadder, build, lowball_check, place_rungs, settled_rate
from ladder.config import SETTLE_DAYS
from ladder.data import Dataset, day
from ladder.fraud import Detector
from ladder.generate import generate
from ladder.model import ViewDist, ViewModel

DATA = generate()


class Generator(unittest.TestCase):
    def test_same_seed_same_data(self):
        again = generate()
        self.assertEqual(DATA.posts[:50], again.posts[:50])
        self.assertEqual(len(DATA.posts), len(again.posts))

    def test_schema_matches_brief(self):
        self.assertTrue({"campaign_id", "brand", "category", "platform", "total_budget", "start_date",
                         "end_date", "target_creator_tier"} <= DATA.campaigns[0].keys())
        self.assertTrue({"post_id", "campaign_id", "creator_id", "post_date", "platform", "format", "views_at_24h",
                         "views_at_7d", "views_at_30d", "views_final", "total_payout_earned",
                         "flagged_suspicious"} <= DATA.posts[0].keys())

    def test_views_only_grow(self):
        for p in DATA.posts:
            self.assertLessEqual(p["views_at_24h"], p["views_at_7d"])
            self.assertLessEqual(p["views_at_7d"], p["views_at_30d"])
            self.assertLessEqual(p["views_at_30d"], p["views_final"])


class Rungs(unittest.TestCase):
    dist = ViewDist(mu=math.log(20_000), sigma=1.0, n=100, basis=("x",), widened=0)

    def test_each_rung_reached_by_half_of_the_previous(self):
        rungs = place_rungs(self.dist, expected_posts=40)
        reaches = [r for _, r in rungs]
        self.assertAlmostEqual(reaches[0], 0.5, delta=0.02)
        for a, b in zip(reaches, reaches[1:]):
            self.assertAlmostEqual(b / a, 0.5, delta=0.08)

    def test_strictly_rising_and_covers_confidence(self):
        rungs = place_rungs(self.dist, expected_posts=2)
        views = [v for v, _ in rungs]
        self.assertEqual(views, sorted(set(views)))
        self.assertLessEqual(rungs[-1][1], 0.05)

    def test_more_expected_posts_more_rungs(self):
        self.assertGreater(len(place_rungs(self.dist, 500)), len(place_rungs(self.dist, 20)))

    def test_rounds_down_to_cleared_rung(self):
        ladder = GroupLadder("micro", "reel", 10, self.dist, [(100, .5), (140, .25), (200, .1)])
        self.assertEqual(ladder.cleared(141), 140)
        self.assertEqual(ladder.cleared(99), 0)
        self.assertEqual(ladder.cleared(10_000), 200)


class Money(unittest.TestCase):
    def test_settled_rate_between_min_and_max(self):
        for views in (1, 1_000, 10**6, 10**9):
            rate = settled_rate(100_000, views, 0.01, 0.05)
            self.assertGreaterEqual(rate, 0.01)
            self.assertLessEqual(rate, 0.05)

    def test_same_inputs_same_ladder_and_price(self):
        """A brand asking twice, or two creators in the same tier and format, see identical terms."""
        c = DATA.campaigns[-1]
        a = build(DATA.before(c["start_date"]), CampaignParams.from_campaign(c), runs=300).to_dict()
        b = build(DATA.before(c["start_date"]), CampaignParams.from_campaign(c), runs=300).to_dict()
        self.assertEqual(a["ladders"], b["ladders"])
        self.assertEqual(a["pricing"], b["pricing"])

    def test_backtest_budget_and_refund_add_up(self):
        for c in eligible(DATA)[-6:]:
            _, _, new = evaluate(DATA, c, runs=500)
            self.assertAlmostEqual(new["spend"] + new["refund"], c["total_budget"], delta=2)
            # Over budget is only possible when promised minimums outran the forecast, which is
            # exactly when the campaign should have closed early.
            self.assertTrue(new["within_budget"] or new["closed_early_on"])

    def test_lowball_blocks_below_every_past_rate(self):
        c = DATA.campaigns[-1]
        history = DATA.before(c["start_date"])
        params = CampaignParams(c["category"], c["platform"], 100_000, 0.01, c["target_creator_tier"], c["start_date"])
        self.assertEqual(lowball_check(history, params)["status"], "block")


class History(unittest.TestCase):
    def test_no_future_leaks_into_history(self):
        c = DATA.campaigns[-1]
        for past in DATA.before(c["start_date"]).campaigns:
            self.assertLess(day(past["end_date"]) + timedelta(days=SETTLE_DAYS), day(c["start_date"]))

    def test_small_history_widens_the_group(self):
        few = Dataset(DATA.campaigns[:3], [], DATA.creators,
                      [p for p in DATA.posts if p["campaign_id"] in {c["campaign_id"] for c in DATA.campaigns[:3]}])
        dist = ViewModel(few).dist("finance", "youtube", "micro", "long_form")
        self.assertGreater(dist.widened, 0)


class Fraud(unittest.TestCase):
    def test_false_alarms_stay_rare_on_clean_posts(self):
        detector = Detector.fit(DATA)
        clean = [p for p in DATA.posts if not DATA.truth[p["post_id"]]]
        held = sum(detector.suspicious(p, DATA.creator_by_id[p["creator_id"]]) for p in clean)
        self.assertLess(held / len(clean), 0.03)

    def test_catches_most_bought_views(self):
        detector = Detector.fit(DATA)
        boosted = [p for p in DATA.posts if DATA.truth[p["post_id"]]]
        caught = sum(p["flagged_suspicious"] or detector.suspicious(p, DATA.creator_by_id[p["creator_id"]])
                     for p in boosted)
        self.assertGreater(caught / len(boosted), 0.85)


if __name__ == "__main__":
    unittest.main()
