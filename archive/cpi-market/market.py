"""Publisher agents, the campaign loop, and a full-information benchmark."""
from dataclasses import dataclass

from tvf import TrueValueFinder


@dataclass
class Publisher:
    arrival: int
    reservation: float
    rate: float
    patience: int
    markup: float = 0.0
    joined: int | None = None


@dataclass
class CampaignResult:
    settlement: object
    trace: list
    publishers: list


def run_campaign(publishers, budget, expected_cpi, hours, **engine_kwargs):
    engine = TrueValueFinder(budget, expected_cpi, **engine_kwargs)
    arrivals = {}
    for p in publishers:
        arrivals.setdefault(p.arrival, []).append(p)

    waiting, live_rate, minted, committed, trace = [], 0.0, 0.0, 0.0, []
    for t in range(hours):
        instant = holdout_joins = declines = 0
        added_rate = 0.0
        remaining = []
        candidates = [(p, True) for p in arrivals.get(t, [])] + [(p, False) for p in waiting]
        for p, is_new in candidates:
            if not is_new and t - p.arrival > p.patience:
                continue
            own = p.rate * (hours - t)
            if engine.projected_value(committed, own) >= p.reservation * (1 + p.markup):
                p.joined = t
                live_rate += p.rate
                added_rate += p.rate
                committed += own
                if is_new:
                    instant += 1
                else:
                    holdout_joins += 1
            else:
                declines += is_new
                remaining.append(p)
        waiting = remaining
        minted += live_rate
        engine.on_hour(
            hour=t,
            hours=hours,
            committed=committed,
            added_rate=added_rate,
            holdouts=len(waiting),
            instant_joins=instant,
            holdout_joins=holdout_joins,
            declines=declines,
        )
        trace.append((t, engine.quote, engine.justified, minted))

    return CampaignResult(engine.settle(minted), trace, publishers)


def true_value(publishers, budget, hours):
    """Competitive uniform price with every reservation known and every publisher live from arrival."""
    supply = sorted((p.reservation, p.rate * (hours - p.arrival)) for p in publishers)
    cumulative = 0.0
    for reservation, volume in supply:
        if cumulative > 0 and reservation * cumulative >= budget:
            return budget / cumulative
        cumulative += volume
        if reservation * cumulative >= budget:
            return reservation
    return supply[-1][0] if supply else None
