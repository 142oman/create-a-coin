"""Mint-only price discovery at the platform level.

A single campaign cannot price itself from minting data alone: it yields too few join
events, and a publisher who declines is invisible, so "no coins" is ambiguous between
"price too low" and "nobody there" (see section 13-14 of MECHANISM.md).

The market is the platform, not one campaign. Every campaign posts a price and reports
how many coins were minted. Pooled across campaigns, those pairs trace the supply curve,
which is the only object needed to price the next campaign. Nothing but minting is
observed, so there is no presence signal to fake: moving the price requires delivering
real impressions.
"""
import math
import statistics

from tvf import Settlement


class SupplyCurve:
    """Non-parametric supply curve estimated from (posted price, coins delivered) pairs."""

    def __init__(self, bandwidth=0.18, min_observations=15, saturation=0.95):
        self.observations = []
        self.bandwidth = bandwidth
        self.min_observations = min_observations
        self.saturation = saturation

    def record(self, price, coins):
        self.observations.append((price, coins))

    def coins_at(self, price):
        """Kernel-smoothed expected delivery at a posted price."""
        total = weighted = 0.0
        for observed_price, coins in self.observations:
            w = math.exp(-((math.log(observed_price) - math.log(price)) / self.bandwidth) ** 2 / 2)
            total += w
            weighted += coins * w
        return weighted / total if total > 1e-9 else None

    def clearing_price(self, budget, prior):
        """Cheapest price that spends the budget, or that buys essentially all supply."""
        if len(self.observations) < self.min_observations:
            return prior
        lo = min(p for p, _ in self.observations)
        hi = max(p for p, _ in self.observations)
        grid = [lo * (hi / lo) ** (i / 60) for i in range(61)]
        curve = [(p, self.coins_at(p)) for p in grid]
        curve = [(p, c) for p, c in curve if c is not None]
        if not curve:
            return prior
        # Two candidate prices; the cheaper one governs.
        #   exhaust:    cheapest price at which delivery would spend the whole budget
        #   saturate:   cheapest price that already buys essentially all available supply
        # Paying beyond the saturation point buys nothing: that is the pool-split absurdity,
        # where a thin market is charged the whole budget divided by whatever showed up.
        exhaust = next((p for p, c in curve if p * c >= budget), None)
        # Robust ceiling: the plateau of the smoothed curve, read as the median of its top
        # price decile. Taking the maximum instead is the max of a noisy estimate, which is
        # biased upward and drags the saturation point with it.
        tail = [c for _, c in curve[int(len(curve) * 0.8):]] or [c for _, c in curve]
        ceiling = statistics.median(tail)
        saturate = next((p for p, c in curve if c >= self.saturation * ceiling), None)
        candidates = [p for p in (exhaust, saturate) if p is not None]
        return min(candidates) if candidates else prior


def settle(budget, posted_price, minted):
    if minted <= 0:
        return Settlement(0.0, 0.0, 0.0, budget)
    price = min(posted_price, budget / minted)
    return Settlement(price, minted, price * minted, budget - price * minted)


def run_campaign_at(publishers, budget, posted_price, hours):
    """One campaign at one posted price. The only observable is minting."""
    arrivals = {}
    for p in publishers:
        arrivals.setdefault(p.arrival, []).append(p)
    waiting, live_rate, minted, committed = [], 0.0, 0.0, 0.0
    for t in range(hours):
        still = []
        for p, is_new in [(p, True) for p in arrivals.get(t, [])] + [(p, False) for p in waiting]:
            if not is_new and t - p.arrival > p.patience:
                continue
            own = p.rate * (hours - t)
            expected = min(posted_price, budget / (committed + own))
            if expected >= p.reservation * (1 + p.markup):
                p.joined = t
                live_rate += p.rate
                committed += own
            else:
                still.append(p)
        waiting = still
        minted += live_rate
    return settle(budget, posted_price, minted), minted


WIDE = 2.0          # log-range of exploratory pricing
WIDE_SHARE = 0.10   # share of campaigns priced exploratively once the curve exists


def price_for(curve, budget, wanted_cpi, rng, exploration=0.10):
    """Price the next campaign.

    `wanted_cpi` is only a prior, used until enough campaigns have been observed. After
    that the posted price comes from the pooled supply curve and the advertiser's number
    has no influence at all. Exploration is symmetric and wide, never anchored on the
    advertiser's quote, so a highballed or lowballed prior cannot steer the search.
    """
    if len(curve.observations) < curve.min_observations:
        return wanted_cpi * math.exp(rng.uniform(-WIDE, WIDE))
    price = curve.clearing_price(budget, prior=wanted_cpi)
    if rng.random() < WIDE_SHARE:
        return price * math.exp(rng.uniform(-WIDE, WIDE))
    return price * math.exp(rng.gauss(0, exploration))
