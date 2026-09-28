"""Head-to-head: geometric reconciliation kernel vs the true-value finder."""
import math
import random
import statistics

from market import Publisher, run_campaign, true_value
from simulate import BUDGET, HOURS, SCENARIOS, population, pct_error
from tvf import Settlement


def kernel_price(budget, expected_cpi, coins):
    """Geometric reconciliation: log-midpoint of the advertiser's quote and the pool ratio."""
    if coins <= 0:
        return None
    raw = budget / coins
    return min(raw, math.sqrt(expected_cpi * raw))


def run_kernel_campaign(publishers, budget, expected_cpi, hours):
    """Same agents and same supply forecast, priced by the closed-form kernel instead."""
    arrivals = {}
    for p in publishers:
        arrivals.setdefault(p.arrival, []).append(p)
    waiting, live_rate, minted, committed, added_total = [], 0.0, 0.0, 0.0, 0.0
    for t in range(hours):
        elapsed, remaining = t + 1, hours - t - 1
        horizon = min(elapsed, remaining)
        forecast = added_total / elapsed * (horizon * remaining - horizon * horizon / 2)
        still = []
        for p, is_new in [(p, True) for p in arrivals.get(t, [])] + [(p, False) for p in waiting]:
            if not is_new and t - p.arrival > p.patience:
                continue
            own = p.rate * (hours - t)
            price = kernel_price(budget, expected_cpi, committed + forecast + own)
            if price is not None and price >= p.reservation * (1 + p.markup):
                p.joined = t
                live_rate += p.rate
                added_total += p.rate
                committed += own
            else:
                still.append(p)
        waiting = still
        minted += live_rate
    price = kernel_price(budget, expected_cpi, minted)
    if price is None:
        return Settlement(0.0, 0.0, 0.0, budget)
    return Settlement(price, minted, price * minted, budget - price * minted)


def fresh(seed, count, median_r, spread, profile):
    return population(random.Random(seed), count, median_r, spread, profile)


def head_to_head(seeds=200):
    hdr = f"{'scenario':<22}{'truth':>8}{'geometric':>11}{'finder':>9}   {'geo err':>9}{'finder err':>12}{'geo refund':>12}{'finder refund':>15}"
    print(hdr); print("-" * len(hdr))
    for name, (expected, count, median_r, spread, profile) in SCENARIOS.items():
        t_, g_, f_, ge, fe, gr, fr = ([] for _ in range(7))
        for seed in range(seeds):
            args = (seed, count, median_r, spread, profile)
            truth = true_value(fresh(*args), BUDGET, HOURS)
            g = run_kernel_campaign(fresh(*args), BUDGET, expected, HOURS)
            f = run_campaign(fresh(*args), BUDGET, expected, HOURS).settlement
            if not (g.minted and f.minted):
                continue
            t_.append(truth); g_.append(g.price); f_.append(f.price)
            ge.append(pct_error(g.price, truth)); fe.append(pct_error(f.price, truth))
            gr.append(g.refund / BUDGET * 100); fr.append(f.refund / BUDGET * 100)
        m = statistics.median
        print(f"{name:<22}{m(t_):>8.2f}{m(g_):>11.2f}{m(f_):>9.2f}   {m(ge):>8.0f}%{m(fe):>11.1f}%{m(gr):>11.0f}%{m(fr):>14.0f}%")


def manipulation(seeds=120):
    """How far does the settled price move when the advertiser misreports the wanted CPI?"""
    print(f"\n{'scenario':<18}{'mechanism':<12}" + "".join(f"{f'c_e={x}x':>10}" for x in [0.25, 0.5, 1, 2, 4]) + f"{'elasticity':>12}")
    for sc in ["thin liquidity", "balanced"]:
        base_expected, count, median_r, spread, profile = SCENARIOS[sc]
        for label, runner in [("geometric", run_kernel_campaign), ("finder", lambda *a: run_campaign(*a).settlement)]:
            prices = []
            for mult in [0.25, 0.5, 1, 2, 4]:
                ps = [runner(fresh(s, count, median_r, spread, profile), BUDGET, base_expected * mult, HOURS).price
                      for s in range(seeds)]
                ps = [p for p in ps if p]
                prices.append(statistics.median(ps))
            slope = (math.log(prices[-1]) - math.log(prices[0])) / (math.log(4) - math.log(0.25))
            print(f"{sc:<18}{label:<12}" + "".join(f"{p:>10.2f}" for p in prices) + f"{slope:>12.2f}")


def fallback_rate(seeds=200):
    """How often does the finder never see a holdout accept, and fall back to an arbitrary price?"""
    print(f"\n{'scenario':<22}{'no revealed marginal cost':>28}")
    for name, (expected, count, median_r, spread, profile) in SCENARIOS.items():
        miss = total = 0
        for seed in range(seeds):
            pubs = fresh(seed, count, median_r, spread, profile)
            res = run_campaign(pubs, BUDGET, expected, HOURS)
            if res.settlement.minted:
                total += 1
                miss += res.trace[-1][2] is None
        print(f"{name:<22}{miss / total * 100:>27.0f}%")


if __name__ == "__main__":
    head_to_head()
    manipulation()
    fallback_rate()
