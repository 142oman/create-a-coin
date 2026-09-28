"""True-value finder for a fixed-budget CPI campaign.

The engine never sees a publisher's reservation price. Its live quote moves only
on observed publisher behaviour and budget pressure, and a price is recorded as
justified only when a publisher who had declined a lower quote accepts.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Settlement:
    price: float
    minted: float
    disbursed: float
    refund: float


class TrueValueFinder:
    def __init__(self, budget, expected_cpi, step=0.02, step_min=0.002, step_max=0.05):
        if budget <= 0 or expected_cpi <= 0:
            raise ValueError("budget and expected CPI must be positive")
        self.budget = budget
        self.expected_cpi = expected_cpi
        self.quote = expected_cpi
        self.justified = None
        self.lowest_accepted = None
        self._step = step
        self._step_min = step_min
        self._step_max = step_max
        self._last_direction = 0
        self._generous = False
        self._added_rate = 0.0
        self._forecast = 0.0

    def projected_value(self, committed, own):
        """What a coin minted by a publisher joining now is expected to settle at."""
        return min(self.quote, self.budget / (committed + self._forecast + own))

    def on_hour(self, *, hour, hours, committed, added_rate, holdouts, instant_joins, holdout_joins, declines):
        """Advance one hour.

        committed      coins minted so far plus coins live publishers will still mint
        added_rate     hourly minting rate of publishers who joined this hour
        holdouts       publishers who have seen the quote and not joined
        instant_joins  publishers who joined the moment they arrived
        holdout_joins  holdouts who accepted this hour
        declines       new arrivals who turned the quote down
        """
        # A join flow observed for h hours is expected to persist for about h more hours,
        # so a short burst forecasts one more burst rather than a flood for the rest of the window.
        self._added_rate += added_rate
        elapsed = hour + 1
        remaining = hours - elapsed
        horizon = min(elapsed, remaining)
        flow = self._added_rate / elapsed
        self._forecast = flow * (horizon * remaining - horizon * horizon / 2)
        q = self.quote
        if instant_joins or holdout_joins:
            self.lowest_accepted = q if self.lowest_accepted is None else min(self.lowest_accepted, q)
        if holdout_joins:
            self.justified = q if self.justified is None else max(self.justified, q)
            self._step = max(self._step / 2, self._step_min)
        if declines:
            self._generous = False
        if instant_joins and not holdouts:
            self._generous = True

        excess_demand = self.budget / q - committed - self._forecast
        if excess_demand < 0:
            direction = -1
        elif holdouts:
            direction = 1
        elif self._generous:
            direction = -1
        else:
            direction = 0

        if direction:
            self._adapt_step(direction)
            self.quote = q * (1 + direction * self._step)

    def _adapt_step(self, direction):
        if self._last_direction == direction:
            self._step = min(self._step * 1.5, self._step_max)
        elif self._last_direction:
            self._step = max(self._step / 2, self._step_min)
        self._last_direction = direction

    def settle(self, minted):
        if minted <= 0:
            return Settlement(0.0, 0.0, 0.0, self.budget)
        reference = self.justified if self.justified is not None else self.lowest_accepted
        price = min(reference, self.budget / minted)
        disbursed = price * minted
        return Settlement(price, minted, disbursed, self.budget - disbursed)
