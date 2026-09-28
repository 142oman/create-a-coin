"""Invariants the method promises. Run: python -m unittest"""
import math
import unittest

from ladder.backtest import eligible, evaluate
from ladder.builder import CampaignParams, GroupLadder, build, place_rungs
from ladder.data import Dataset, day
from ladder.fraud import Detector
from ladder.generate import generate
from ladder.market import reference
from ladder.model import ViewDist, ViewModel
from ladder.rules import coins, rung_coins, settle
from ladder.simulate import SCENARIOS, simulate

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

    def test_threshold_reached_by_80_percent_and_each_next_by_half(self):
        rungs = place_rungs(self.dist)
        reaches = [r for _, r in rungs]
        self.assertAlmostEqual(reaches[0], 0.8, delta=0.02)
        for a, b in zip(reaches, reaches[1:]):
            self.assertAlmostEqual(b / a, 0.5, delta=0.08)

    def test_strictly_rising(self):
        views = [v for v, _ in place_rungs(self.dist)]
        self.assertEqual(views, sorted(set(views)))

    def test_no_rungs_pays_every_view_above_the_threshold(self):
        ladder = GroupLadder("gaming", "instagram", "micro", "reel", self.dist, [(100, .8), (140, .4), (200, .2)])
        self.assertEqual(ladder.coins(99), 0)
        self.assertEqual(ladder.coins(100), 100)
        self.assertEqual(ladder.coins(141), 141)
        self.assertEqual(ladder.coins(10_000), 10_000)

    def test_coin_rungs_round_down_to_the_rung_reached(self):
        ladder = GroupLadder("gaming", "instagram", "micro", "reel", self.dist, [(100, .8), (140, .4), (200, .2)])
        self.assertEqual(ladder.coins(99, "rungs"), 0)
        self.assertEqual(ladder.coins(141, "rungs"), 140)
        self.assertEqual(ladder.coins(10_000, "rungs"), 200)
        self.assertEqual(rung_coins(150, [100, 140, 200]), 140)

    def test_rungs_do_not_depend_on_budget(self):
        c = DATA.campaigns[-1]
        history = DATA.before(c["start_date"])
        small = build(history, CampaignParams(1_000, [c["category"]], [c["platform"]], [], c["start_date"]))
        big = build(history, CampaignParams(30_000_000, [c["category"]], [c["platform"]], [], c["start_date"]))
        self.assertEqual([g.rungs for g in small.ladders], [g.rungs for g in big.ladders])
        self.assertEqual(small.references["linear"].rate, big.references["linear"].rate)


class Choices(unittest.TestCase):
    def test_picking_nothing_opens_the_campaign_to_everything(self):
        p = CampaignParams(100_000)
        self.assertEqual(len(p.open_categories), 5)
        self.assertEqual(len(p.open_platforms), 2)
        self.assertEqual(len(p.open_tiers), 4)
        proposal = build(DATA.before(p.start_date), p)
        self.assertEqual(len(proposal.ladders), 5 * 4 * 4)   # category x tier x (2 formats x 2 platforms)

    def test_who_can_join_limits_the_ladders(self):
        proposal = build(DATA, CampaignParams(100_000, ["gaming", "FMCG"], ["instagram"], ["nano", "micro"]))
        self.assertEqual({g.tier for g in proposal.ladders}, {"nano", "micro"})
        self.assertEqual({g.platform for g in proposal.ladders}, {"instagram"})

    def test_each_category_gets_its_own_rungs(self):
        proposal = build(DATA, CampaignParams(100_000, ["gaming", "D2C"], ["youtube"], ["micro"]))
        gaming = proposal.ladder_for("micro", "short", "youtube", "gaming")
        d2c = proposal.ladder_for("micro", "short", "youtube", "D2C")
        self.assertEqual((gaming.dist.widened, d2c.dist.widened), (0, 0))   # both have their own history
        self.assertGreater(gaming.threshold, d2c.threshold)                # gaming travels further

    def test_formats_limit_ladders_and_platforms(self):
        proposal = build(DATA, CampaignParams(100_000, ["gaming"], [], [], formats=["reel"]))
        self.assertEqual({(g.platform, g.format) for g in proposal.ladders}, {("instagram", "reel")})
        with self.assertRaises(ValueError):   # a YouTube-only campaign that only counts reels
            CampaignParams(100_000, [], ["youtube"], [], formats=["reel"])

    def test_simulated_posts_use_only_chosen_formats(self):
        params = CampaignParams(300_000, ["gaming"], [], [], "2026-01-01", "2026-01-31", ["carousel", "short"])
        run = simulate(DATA, params, "crowded", 2)
        self.assertLessEqual({p["format"] for c in run["creators"] for p in c["posts"]}, {"carousel", "short"})

    def test_rejects_unknown_choices(self):
        with self.assertRaises(ValueError):
            CampaignParams(100_000, ["crypto"])


class Simulation(unittest.TestCase):
    params = CampaignParams(300_000, ["gaming"], ["instagram"], [], "2026-01-01", "2026-01-31")

    def test_same_seed_same_campaign(self):
        a = simulate(DATA, self.params, "normal", 11)
        b = simulate(DATA, self.params, "normal", 11)
        self.assertEqual(a["settlement"], b["settlement"])
        self.assertEqual(a["creators"], b["creators"])

    def test_never_over_budget_and_payouts_add_up(self):
        for scenario in SCENARIOS:
            run = simulate(DATA, self.params, scenario, 5)
            for mode in ("rungs", "linear"):
                st = run["settlement"][mode]
                self.assertLessEqual(st["paid"], 300_000 + 1)
                self.assertAlmostEqual(st["paid"] + st["refund"], 300_000, delta=1)
                self.assertAlmostEqual(sum(c["paid"][mode] for c in run["creators"]), st["paid"],
                                       delta=len(run["creators"]) + 1)

    def test_crowded_dilutes_and_thin_refunds(self):
        crowded = [simulate(DATA, self.params, "crowded", s)["settlement"]["linear"] for s in range(5)]
        thin = [simulate(DATA, self.params, "thin", s)["settlement"]["linear"] for s in range(5)]
        self.assertTrue(all(x["refund"] == 0 for x in crowded))
        self.assertTrue(all(x["refund"] > 0 for x in thin))

    def test_creators_belong_to_the_chosen_categories(self):
        params = CampaignParams(300_000, ["gaming", "FMCG"], ["instagram"], [], "2026-01-01", "2026-01-31")
        run = simulate(DATA, params, "crowded", 4)
        self.assertEqual({c["category"] for c in run["creators"]}, {"gaming", "FMCG"})

    def test_held_posts_delay_settlement_by_the_review_window(self):
        run = simulate(DATA, self.params, "fraud_wave", 4)
        held = [p for c in run["creators"] for p in c["posts"] if p["held"]]
        self.assertTrue(held)
        self.assertEqual((run["review_days"], run["settles_on"]), (7, "2026-02-06"))
        self.assertTrue(all(p["review"] in ("valid", "fraud") for p in held))
        clean = simulate(DATA, self.params, "fraud_wave", 3)   # a run with nothing held settles on the last day
        self.assertEqual(clean["settles_on"], clean["ends_on"])

    def test_caught_fraud_is_never_paid(self):
        run = simulate(DATA, self.params, "fraud_wave", 4)
        for c in run["creators"]:
            for p in c["posts"]:
                if p["voided"]:
                    self.assertEqual(p["paid"], {"rungs": 0, "linear": 0})


class Settlement(unittest.TestCase):
    def test_never_pays_more_than_the_budget(self):
        for minted in (1, 10, 1_000, 10**6, 10**9):
            for ref in (None, 0.001, 0.05, 5.0):
                rate, _ = settle(100_000, minted, ref)
                self.assertLessEqual(rate * minted, 100_000 + 1e-6)

    def test_plentiful_supply_spends_everything(self):
        rate, regime = settle(100_000, 10**7, 0.05)          # pool 0.01 < market 0.05
        self.assertEqual(regime, "competitive")
        self.assertAlmostEqual(rate * 10**7, 100_000)

    def test_thin_supply_pays_the_nash_split_and_refunds(self):
        rate, regime = settle(100_000, 10_000, 0.05)          # pool 10 > market 0.05
        self.assertEqual(regime, "thin")
        self.assertAlmostEqual(rate, math.sqrt(10 * 0.05))
        self.assertLess(rate * 10_000, 100_000)

    def test_price_falls_as_coins_are_minted(self):
        prices = [settle(100_000, m, 0.05)[0] for m in (10**3, 10**4, 10**5, 10**6, 10**7)]
        self.assertEqual(prices, sorted(prices, reverse=True))

    def test_no_coins_full_refund(self):
        self.assertEqual(settle(100_000, 0, 0.05), (0.0, "empty"))

    def test_cold_start_is_the_pure_pool(self):
        self.assertEqual(settle(100_000, 1_000, None), (100.0, "cold start"))

    def test_backtest_budget_and_refund_add_up(self):
        for c in eligible(DATA)[-6:]:
            _, sides = evaluate(DATA, c)
            for mode in ("rungs", "linear"):
                self.assertTrue(sides[mode]["within_budget"])
                self.assertAlmostEqual(sides[mode]["spend"] + sides[mode]["refund"], c["total_budget"], delta=2)

    def test_one_price_for_every_coin(self):
        c = eligible(DATA)[-1]
        _, sides = evaluate(DATA, c)
        for mode in ("rungs", "linear"):
            new = sides[mode]
            self.assertAlmostEqual(new["spend"], new["coin_cpm"] / 1000 * new["coins"], delta=1)

    def test_coins_helper(self):
        self.assertEqual(coins(5, 10), 0)
        self.assertEqual(coins(12, 10), 12)


class History(unittest.TestCase):
    def test_no_future_leaks_into_history(self):
        c = DATA.campaigns[-1]
        for past in DATA.before(c["start_date"]).campaigns:
            self.assertLess(day(past["end_date"]), day(c["start_date"]))

    def test_small_history_widens_the_group(self):
        few = Dataset(DATA.campaigns[:3], [], DATA.creators,
                      [p for p in DATA.posts if p["campaign_id"] in {c["campaign_id"] for c in DATA.campaigns[:3]}])
        dist = ViewModel(few).dist("finance", "youtube", "micro", "long_form")
        self.assertGreater(dist.widened, 0)

    def test_no_history_is_a_cold_start(self):
        c = DATA.campaigns[0]
        empty = Dataset([], [], DATA.creators, [])
        few = Dataset(DATA.campaigns[:3], [], DATA.creators,
                      [p for p in DATA.posts if p["campaign_id"] in {x["campaign_id"] for x in DATA.campaigns[:3]}])
        self.assertIsNotNone(build(few, CampaignParams.from_campaign(c)).references["linear"].rate)  # widens
        self.assertIsNone(reference(empty, [c["category"]], [c["platform"]], lambda *a: 1).rate)


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
