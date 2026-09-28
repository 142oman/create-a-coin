import math
import random
import unittest

from market import run_campaign
from simulate import BUDGET, HOURS, SCENARIOS, population
from tvf import TrueValueFinder


def campaigns(seeds=40):
    for name, (expected, count, median_r, spread, profile) in SCENARIOS.items():
        for seed in range(seeds):
            pubs = population(random.Random(seed), count, median_r, spread, profile)
            yield name, pubs, run_campaign(pubs, BUDGET, expected, HOURS).settlement


class SettlementInvariants(unittest.TestCase):
    def test_conservation_and_no_overdraw(self):
        for name, _, s in campaigns():
            self.assertTrue(math.isclose(s.disbursed + s.refund, BUDGET, rel_tol=1e-12), name)
            self.assertLessEqual(s.disbursed, BUDGET * (1 + 1e-12), name)
            self.assertGreaterEqual(s.refund, -1e-9, name)

    def test_every_coin_settles_at_one_price(self):
        for name, _, s in campaigns():
            self.assertTrue(math.isclose(s.disbursed, s.price * s.minted, rel_tol=1e-12), name)

    def test_recruited_holdouts_are_paid_their_price_unless_budget_is_exhausted(self):
        for name, pubs, s in campaigns():
            if s.refund <= 1e-9:
                continue
            for p in pubs:
                if p.joined is not None and p.joined > p.arrival:
                    self.assertGreaterEqual(s.price, p.reservation, name)

    def test_thin_liquidity_heals_instead_of_splitting_the_pool(self):
        for name, _, s in campaigns():
            if name == "thin liquidity" and s.minted:
                self.assertLess(s.price, BUDGET / s.minted, name)
                self.assertGreater(s.refund, 0, name)

    def test_no_supply_refunds_everything(self):
        s = run_campaign([], BUDGET, 2.0, HOURS).settlement
        self.assertEqual((s.minted, s.disbursed, s.refund), (0.0, 0.0, BUDGET))

    def test_rejects_non_positive_inputs(self):
        with self.assertRaises(ValueError):
            TrueValueFinder(0, 2.0)
        with self.assertRaises(ValueError):
            TrueValueFinder(BUDGET, 0)


if __name__ == "__main__":
    unittest.main()
