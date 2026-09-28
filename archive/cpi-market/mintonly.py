"""Price finder that observes only minting: who started delivering, and how much.

There is no presence signal. A publisher who looks at the quote and declines is
invisible, so zero coins is ambiguous between "the price is too low" and "nobody is
there". The engine resolves that ambiguity by hunting:

  * budget oversubscribed        -> come down, the pool cannot pay for this
  * nothing minting, budget left -> climb; raising a price nobody is taking is free
  * supply minting, budget left  -> drift down and see whether the flow survives it

The quote therefore oscillates around the lowest price that sustains delivery, which is
the marginal cost of the supply that exists. Coins settle at the highest quote any
publisher accepted, capped by the pool.
"""
from tvf import Settlement


class MintOnlyFinder:
    def __init__(self, budget, expected_cpi, step_up=0.03, step_down=0.01, window=12):
        if budget <= 0 or expected_cpi <= 0:
            raise ValueError("budget and expected CPI must be positive")
        self.budget = budget
        self.quote = expected_cpi
        self.step_up = step_up
        self.step_down = step_down
        self.window = window
        self._joins = []
        self._max_join_quote = None
        self._added_rate = 0.0
        self._forecast = 0.0

    def projected_value(self, committed, own):
        return min(self.quote, self.budget / (committed + self._forecast + own))

    def on_hour(self, *, hour, hours, committed, added_rate, joins, coins_minted):
        self._joins.append(joins)
        if joins:
            q = self.quote
            self._max_join_quote = q if self._max_join_quote is None else max(self._max_join_quote, q)

        self._added_rate += added_rate
        elapsed, remaining = hour + 1, hours - hour - 1
        horizon = min(elapsed, remaining)
        self._forecast = self._added_rate / elapsed * (horizon * remaining - horizon * horizon / 2)

        excess = self.budget / self.quote - committed - self._forecast
        recent_joins = sum(self._joins[-self.window:])
        if excess < 0:
            self.quote *= 1 - self.step_down
        elif recent_joins == 0:
            self.quote *= 1 + self.step_up
        else:
            self.quote *= 1 - self.step_down

    def settle(self, minted):
        if minted <= 0:
            return Settlement(0.0, 0.0, 0.0, self.budget)
        # Smallest uniform price that is individually rational on the evidence: every
        # publisher accepted some quote, so the highest accepted quote covers all of them.
        covering = self._max_join_quote if self._max_join_quote is not None else self.quote
        price = min(covering, self.budget / minted)
        return Settlement(price, minted, price * minted, self.budget - price * minted)


def run_mintonly_campaign(publishers, budget, expected_cpi, hours, **kwargs):
    engine = MintOnlyFinder(budget, expected_cpi, **kwargs)
    arrivals = {}
    for p in publishers:
        arrivals.setdefault(p.arrival, []).append(p)
    waiting, live_rate, minted, committed = [], 0.0, 0.0, 0.0
    for t in range(hours):
        joins = added_rate = 0.0
        still = []
        for p, is_new in [(p, True) for p in arrivals.get(t, [])] + [(p, False) for p in waiting]:
            if not is_new and t - p.arrival > p.patience:
                continue
            own = p.rate * (hours - t)
            if engine.projected_value(committed, own) >= p.reservation * (1 + p.markup):
                p.joined = t
                live_rate += p.rate
                added_rate += p.rate
                committed += own
                joins += 1
            else:
                still.append(p)
        waiting = still
        minted += live_rate
        engine.on_hour(hour=t, hours=hours, committed=committed, added_rate=added_rate,
                       joins=joins, coins_minted=live_rate)
    return engine.settle(minted)
