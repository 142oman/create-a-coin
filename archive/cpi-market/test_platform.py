import math
import random
import statistics
import unittest

from market import true_value
from platform import SupplyCurve, price_for, run_campaign_at, settle
from simulate import BUDGET, HOURS, population, pct_error


def season(count, median_r, wanted, campaigns=160, warmup=40, profile="uniform"):
    """Run a platform season; return settlements and truths for the post-warmup campaigns."""
    curve, rng, out = SupplyCurve(), random.Random(1), []
    for i in range(campaigns):
        pubs = population(random.Random(10_000 + i), count, median_r, 0.30, profile)
        price = price_for(curve, BUDGET, wanted, rng)
        s, minted = run_campaign_at(pubs, BUDGET, price, HOURS)
        curve.record(price, minted)
        if i >= warmup:
            out.append((s, true_value(pubs, BUDGET, HOURS)))
    return out


class PlatformInvariants(unittest.TestCase):
    def test_conservation_and_no_overdraw(self):
        for s, _ in season(100, 2.0, 2.0):
            self.assertTrue(math.isclose(s.disbursed + s.refund, BUDGET, rel_tol=1e-12))
            self.assertLessEqual(s.disbursed, BUDGET * (1 + 1e-12))
            self.assertGreaterEqual(s.refund, -1e-9)

    def test_one_price_per_coin(self):
        for s, _ in season(100, 2.0, 2.0):
            self.assertTrue(math.isclose(s.disbursed, s.price * s.minted, rel_tol=1e-12))

    def test_never_pays_more_than_the_pool_split(self):
        for s, _ in season(15, 3.0, 2.0):
            if s.minted:
                self.assertLessEqual(s.price, BUDGET / s.minted * (1 + 1e-12))

    def test_thin_markets_heal_and_refund(self):
        rows = [(s, t) for s, t in season(15, 3.0, 2.0) if s.minted]
        refunds = [s.refund for s, _ in rows]
        below_split = [s.price < BUDGET / s.minted for s, _ in rows]
        self.assertGreater(statistics.median(refunds), 0)
        self.assertGreater(sum(below_split) / len(below_split), 0.5)

    def test_learned_price_tracks_truth(self):
        for count, median_r, tolerance in [(15, 3.0, 30), (100, 2.0, 15), (300, 1.0, 15)]:
            errs = [pct_error(s.price, t) for s, t in season(count, median_r, 2.0) if s.minted]
            self.assertLess(statistics.median(errs), tolerance, f"{count} publishers")

    def test_no_supply_refunds_everything(self):
        s = settle(BUDGET, 2.0, 0)
        self.assertEqual((s.minted, s.disbursed, s.refund), (0.0, 0.0, BUDGET))

    def test_advertiser_cannot_steer_the_learned_price(self):
        """The wanted CPI is a warmup prior only; a 20x misquote must barely move the price."""
        prices = {}
        for wanted in (0.4, 8.0):
            rows = season(15, 3.0, wanted)
            prices[wanted] = statistics.median([s.price for s, _ in rows if s.minted])
        elasticity = math.log(prices[8.0] / prices[0.4]) / math.log(8.0 / 0.4)
        self.assertLess(abs(elasticity), 0.15, f"elasticity {elasticity:.2f}")


if __name__ == "__main__":
    unittest.main()
