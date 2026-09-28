"""Monte Carlo comparison of the true-value finder against the full-information price."""
import math
import random
import statistics
import sys

from market import Publisher, run_campaign, true_value

BUDGET = 100_000
HOURS = 240

SCENARIOS = {
    #  name                 expected CPI, publishers, median reservation, spread, arrivals
    "thin liquidity":       (2.0, 15, 3.0, 0.20, "uniform"),
    "balanced":             (2.0, 100, 2.0, 0.30, "uniform"),
    "abundant":             (2.0, 300, 1.0, 0.30, "uniform"),
    "early burst":          (2.0, 100, 2.0, 0.30, "early"),
    "late burst":           (2.0, 100, 2.0, 0.30, "late"),
    "advertiser lowballs":  (0.5, 60, 2.5, 0.30, "uniform"),
    "advertiser highballs": (8.0, 60, 2.0, 0.30, "uniform"),
    "thin + highball":      (8.0, 15, 3.0, 0.20, "uniform"),
}


def poisson(rng, mean):
    limit, k, product = math.exp(-mean), 0, rng.random()
    while product > limit:
        k += 1
        product *= rng.random()
    return k


def arrival_hour(rng, profile):
    if profile == "early":
        return rng.randint(10, 16) if rng.random() < 0.7 else rng.randrange(HOURS)
    if profile == "late":
        return rng.randint(190, 200) if rng.random() < 0.7 else rng.randrange(HOURS)
    return rng.randrange(HOURS)


def population(rng, count, median_reservation, spread, profile):
    return [
        Publisher(
            arrival=arrival_hour(rng, profile),
            reservation=median_reservation * math.exp(spread * rng.gauss(0, 1)),
            rate=5.0 * math.exp(0.5 * rng.gauss(0, 1)),
            patience=int(rng.expovariate(1 / 72)),
        )
        for _ in range(max(1, poisson(rng, count)))
    ]


def pct_error(estimate, truth):
    return abs(estimate - truth) / truth * 100


def run(seeds):
    header = f"{'scenario':<22}{'truth':>8}{'expected':>10}{'pool B/M':>10}{'finder':>9}  |err| vs truth: {'exp':>6}{'B/M':>8}{'finder':>8}{'refund':>9}"
    print(header)
    print("-" * len(header))
    for name, (expected, count, median_r, spread, profile) in SCENARIOS.items():
        truths, pools, finds, e_exp, e_pool, e_find, refunds = [], [], [], [], [], [], []
        for seed in range(seeds):
            rng = random.Random(seed)
            pubs = population(rng, count, median_r, spread, profile)
            truth = true_value(pubs, BUDGET, HOURS)
            result = run_campaign(pubs, BUDGET, expected, HOURS)
            s = result.settlement
            if s.minted == 0:
                continue
            pool = BUDGET / s.minted
            truths.append(truth)
            pools.append(pool)
            finds.append(s.price)
            e_exp.append(pct_error(expected, truth))
            e_pool.append(pct_error(pool, truth))
            e_find.append(pct_error(s.price, truth))
            refunds.append(s.refund / BUDGET * 100)
        med = statistics.median
        print(
            f"{name:<22}{med(truths):>8.2f}{expected:>10.2f}{med(pools):>10.2f}{med(finds):>9.2f}"
            f"  {'':>15}{med(e_exp):>5.0f}%{med(e_pool):>7.0f}%{med(e_find):>7.1f}%{med(refunds):>8.0f}%"
        )


if __name__ == "__main__":
    run(int(sys.argv[1]) if len(sys.argv) > 1 else 200)
