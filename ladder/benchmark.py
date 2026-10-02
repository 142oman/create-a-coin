"""Benchmark: the old way and Creator Coin on the same simulated campaigns.

Self-contained on purpose: nothing here is read by the other pages, and it only *reads* the engine
(`rungs_from`, `settle`, `rung_coins`, `ladder_pay`, `binom_cdf`), so a change to the engine shows up
here but never the other way round. No fraud check: that is external to this comparison.

One campaign, in order:
  1. The advertiser brings a budget (₹20,000 to ₹2 crore, log-uniform) and a CPI "feel" score. 100 is
     the market's true CPI; above 100 he expects more people than the budget really buys, below 100
     fewer (expected crowd = budget / true CPI x feel / 100). Feel runs 5 to 500.
  2. Old way: one ladder for every creator, built by gut. Each rung gets its own score (5 to 300)
     for where he believes the 80%-cross point sits: 100 is exactly right, above is set too high, below
     too low. His scores share a campaign-wide bias and a tilt (a ladder too steep or too flat), on top
     of his feel. Payouts are sized so a market behaving as he pictures spends exactly the budget.
  3. Market: creators of four sizes (nano to macro, about 1,000x apart in views). The crowd's size comes
     from the scenario, only slightly nudged by how easy his rungs look. Viral events lift a whole tier
     (many posts at once) and a few single posts spike.
  4. Creator Coin gets the same budget and the same feel-CPI (kept within a factor of 2 of what past
     campaigns showed, since a wild feel says nothing about the market). It builds rungs per tier from
     past posts of that tier, checks Fair Reach once per tier, and prices with the engine's `settle`.
"""
import math
import random
from datetime import date, timedelta
import statistics

from . import engine
from .store import quantile

TIERS = {                # tier: (median views, sigma, share of the crowd)
    "nano": (3_000, 1.0, 0.55),
    "micro": (25_000, 1.0, 0.30),
    "mid": (200_000, 1.0, 0.12),
    "macro": (1_500_000, 1.0, 0.03),
}
TIER_NAMES = list(TIERS)
MEAN_VIEWS = sum(sh * math.exp(math.log(med) + s ** 2 / 2) for med, s, sh in TIERS.values())
TRUE_CPI = 0.03                       # rupees per view, close to the generated world's reference
BUDGET_RANGE = (20_000, 20_000_000)   # rupees
FEEL_RANGE = (5, 500)
RUNG_SCORE_RANGE = (5, 300)
HISTORY_PER_TIER = 300                # past posts per tier Creator Coin builds its rungs from
MAX_POSTS = 20_000                    # keeps a huge abundant crowd affordable to simulate
BANDS = ((0, 0.5), (0.5, 0.8), (0.8, 1.05), (1.05, 2.0), (2.0, math.inf))   # spend / budget

SCENARIOS = {
    "smooth": "Everything moves smoothly",
    "abundant": "Abundant: a crowd floods in",
    "scarce": "Scarce: too few people arrive",
    "viral_one": "One viral surge",
    "viral_many": "Many viral surges",
}


def _clip(x, lo, hi):
    return max(lo, min(hi, x))


def _draw_views(rng, tier, tiers=TIERS):
    med, sigma, _ = tiers[tier]
    return int(rng.lognormvariate(math.log(med), sigma))


def _mean_views(tiers):
    return sum(sh * math.exp(math.log(med) + s ** 2 / 2) for med, s, sh in tiers.values())


def _poisson(rng, lam):
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


# Entropy mode: nothing is a hand-set scenario. Each of these is drawn fresh for every campaign from a wide
# distribution, listed here so no choice is hidden.
ENTROPY_CPI = (0.005, 0.1)           # true price, rupees per view (₹5 to ₹100 per 1,000), log-uniform


def _draw_world(rng):
    """Creator sizes with their own typical views, spread and share of the crowd, all jittered."""
    raw = {t: (med * math.exp(rng.gauss(0, 0.5)), rng.uniform(0.6, 1.5), sh * math.exp(rng.gauss(0, 0.5)))
           for t, (med, _, sh) in TIERS.items()}
    total = sum(sh for _, _, sh in raw.values())
    return {t: (med, sigma, sh / total) for t, (med, sigma, sh) in raw.items()}


def _pooled_reach_for(level, tiers):
    """Same as _pooled_reach for any set of creator sizes, from the exact mixture (no sampling)."""
    def above(x):
        return sum(sh * (1 - _norm_cdf((math.log(x) - math.log(med)) / sigma)) for med, sigma, sh in tiers.values())
    lo, hi = 0.0, math.log(1e10)
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if above(math.exp(mid)) > level else (lo, mid)
    return math.exp((lo + hi) / 2)


_norm_cdf = statistics.NormalDist().cdf


def _pooled_reach(level, _cache={}):
    """The views that a `level` share of all posts reach, from the true market (all tiers pooled)."""
    if not _cache:
        rng = random.Random("benchmark-pool")
        tiers = rng.choices(TIER_NAMES, weights=[TIERS[t][2] for t in TIER_NAMES], k=60_000)
        _cache["v"] = sorted(_draw_views(rng, t) for t in tiers)
    v = _cache["v"]
    return v[min(len(v) - 1, int((1 - level) * len(v)))]


def _draw_market(rng, scenario):
    """(crowd multiplier, tier surges [(tier, share of its posts, multiplier)], single spikes)."""
    if scenario == "abundant":
        return rng.uniform(2.5, 6.0), [], 0
    if scenario == "scarce":
        return rng.uniform(0.08, 0.4), [], 0
    mult = rng.uniform(0.8, 1.25)
    if scenario == "viral_one":
        return mult, [_surge(rng)], rng.randint(0, 1) + 1
    if scenario == "viral_many":
        return mult, [_surge(rng) for _ in range(rng.randint(2, 4))], rng.randint(3, 10)
    return mult, [], 0


def _surge(rng):
    return rng.choice(TIER_NAMES), rng.uniform(0.3, 0.7), math.exp(rng.uniform(math.log(3), math.log(15)))


def _ladder_payouts(budget, expected_posts):
    """Cumulative payout per rung, rising in equal steps, sized so that if the shares reaching each
    rung were exactly engine.LEVELS the expected spend would equal the budget."""
    n = len(engine.LEVELS)
    shares = engine.LEVELS + [0.0]
    weight = sum((shares[k] - shares[k + 1]) * (k + 1) / n for k in range(n))
    top = budget / (expected_posts * weight)
    return [top * (k + 1) / n for k in range(n)]


def _fair_reach(posts, rungs):
    """One Fair Reach check for a tier: if clearly fewer than QUALIFY_REACH of its posts reach rung 1,
    shrink every rung by sqrt(score the 80% mark actually reached). Only down, never up."""
    if not posts or not rungs:
        return rungs, 1.0
    alpha = (1 - engine.CONFIDENCE) / len(engine.CHECKS)
    n, k = len(posts), sum(1 for v in posts if v >= rungs[0])
    if engine.binom_cdf(k, n, engine.QUALIFY_REACH) >= alpha:
        return rungs, 1.0
    f = quantile([v / rungs[0] for v in posts if v > 0], 1 - engine.QUALIFY_REACH)
    if not f or f >= 1:
        return rungs, 1.0
    factor = math.sqrt(f)
    out = []
    for r in rungs:
        r = engine.round_sig(r * factor)
        if r and (not out or r > out[-1]):
            out.append(r)
    return out or rungs, factor


def one_campaign(rng, scenario, skill=None, entropy=False, budget=None, expected_cpi=None, trace=False, twist=None):
    """budget / expected_cpi (rupees, rupees per view) pin the advertiser's own numbers, for the Advertiser page.
    The random draws still happen, so every other draw is the same as without them."""
    if entropy:
        cpi = math.exp(rng.uniform(math.log(ENTROPY_CPI[0]), math.log(ENTROPY_CPI[1])))
        world = _draw_world(rng)
        skill = rng.uniform(0, 2) if skill is None else skill
    else:
        cpi, world = TRUE_CPI, TIERS
        skill = 1.0 if skill is None else skill
    mean_views = MEAN_VIEWS if not entropy else _mean_views(world)
    drawn_budget = math.exp(rng.uniform(math.log(BUDGET_RANGE[0]), math.log(BUDGET_RANGE[1])))
    feel = _clip(rng.lognormvariate(math.log(100), 0.8 * skill), *FEEL_RANGE)
    budget = drawn_budget if budget is None else float(budget)
    if expected_cpi is not None:
        feel = _clip(cpi * 100 / expected_cpi, *FEEL_RANGE)
    feel_cpi = cpi * 100 / feel if expected_cpi is None else expected_cpi

    # --- the advertiser's ladder, by gut: one for everyone ---
    optimal = [engine.round_sig(_pooled_reach(lv) if not entropy else _pooled_reach_for(lv, world)) for lv in engine.LEVELS]
    bias, tilt = rng.lognormvariate(0, 0.5 * skill), rng.gauss(0, 0.4 * skill)
    last = len(optimal) - 1
    scores = [_clip(feel * bias * math.exp(tilt * (2 * k / last - 1)) * rng.lognormvariate(0, 0.15 * skill), *RUNG_SCORE_RANGE)
              for k in range(len(optimal))]
    raw = sorted(o * s / 100 for o, s in zip(optimal, scores))
    old_rungs = []
    for r in raw:
        r = engine.round_sig(r)
        old_rungs.append(max(r, old_rungs[-1] + 1) if old_rungs else max(r, 1))
    expected_posts = max(1.0, budget / feel_cpi / mean_views)
    payouts = _ladder_payouts(budget, expected_posts)
    ladder = list(zip(old_rungs, payouts))

    # --- the market ---
    true_posts = max(1.0, budget / cpi / mean_views)
    if entropy:
        crowd_mult = rng.lognormvariate(0, 0.9)
        surges = [(rng.choice(TIER_NAMES), rng.uniform(0.1, 0.9), math.exp(rng.uniform(math.log(2), math.log(20))))
                  for _ in range(_poisson(rng, 1.0))]
        spikes, spike_range = _poisson(rng, 2.0), (5, 200)
    else:
        crowd_mult, surges, spikes = _draw_market(rng, scenario)
        spike_range = (20, 150)
    ease = _clip((100 / math.exp(statistics.fmean(math.log(s) for s in scores))) ** 0.15, 0.7, 1.4)
    n = int(_clip(round(true_posts * crowd_mult * ease), 4, MAX_POSTS))
    tiers = rng.choices(TIER_NAMES, weights=[world[t][2] for t in TIER_NAMES], k=n)
    views = [_draw_views(rng, t, world) for t in tiers]
    for tier, share, mult in surges:
        for i, t in enumerate(tiers):
            if t == tier and rng.random() < share:
                views[i] = int(views[i] * mult)
    for i in rng.sample(range(n), min(spikes, n)):
        views[i] = int(views[i] * math.exp(rng.uniform(math.log(spike_range[0]), math.log(spike_range[1]))))
    # Advertiser page twists, never used by Benchmark itself. fraud: some creators buy views (the old way pays on
    # them, Clearing's fraud check does not). late_viral: several posts explode, which only shows on the last day.
    fraud, late = set(), {}
    if twist == "fraud":
        fraud = set(rng.sample(range(n), max(1, int(n * rng.uniform(0.12, 0.25)))))
        for i in fraud:
            views[i] = int(views[i] * rng.uniform(8, 30))
    elif twist == "late_viral":
        # a handful of big creators' posts explode: about 6% of posts (at least 4), taken from the largest size
        # groups first. Each one reaches a top rung the ladder was never priced for.
        k = min(n, max(4, round(0.06 * n)))
        pool = []
        for t in reversed(TIER_NAMES):
            pool += [j for j in range(n) if tiers[j] == t]
            if len(pool) >= k:
                break
        for i in rng.sample(pool, min(k, len(pool))):
            late[i] = views[i]   # its views before it went viral
            views[i] = int(views[i] * math.exp(rng.uniform(math.log(15), math.log(40))))
    genuine = [i for i in range(n) if i not in fraud]
    total_views = sum(views[i] for i in genuine)
    by_tier = {t: [views[i] for i in genuine if tiers[i] == t] for t in TIER_NAMES}
    all_by_tier = {t: [v for v, tt in zip(views, tiers) if tt == t] for t in TIER_NAMES} if fraud else by_tier

    # --- old way ---
    old_by_tier = {t: sum(engine.ladder_pay(ladder, v) for v in vs) for t, vs in all_by_tier.items()}
    old_spend = sum(old_by_tier.values())
    old_paid = {t: sum(1 for v in vs if v >= old_rungs[0]) for t, vs in all_by_tier.items()}

    # --- Creator Coin: exactly what engine.settle does for a real campaign (ladder/simulate.py) ---
    # the advertiser's raw feel-CPI goes straight in as the reference, unclipped. settle() itself is
    # what handles a wrong guess: pool <= reference means views were abundant enough that liquidity
    # sets the price regardless of his number ("plenty"); pool > reference means views were thin, so
    # the price converges toward a negotiated point between the pool price and his reference ("thin").
    reference = feel_cpi
    # entropy: past posts have drifted from today's market (each size's typical views shifted at random)
    past = {t: (med * math.exp(rng.gauss(0, 0.3)), sg, sh) for t, (med, sg, sh) in world.items()} if entropy else world
    new_rungs, factors = {}, {}
    for t in TIER_NAMES:
        base = engine.rungs_from([_draw_views(rng, t, past) for _ in range(HISTORY_PER_TIER)])
        new_rungs[t], factors[t] = _fair_reach(by_tier[t], base)
    price, regime = engine.settle(budget, total_views, reference)
    new_by_tier, new_paid = {}, {}
    for t, vs in by_tier.items():
        new_by_tier[t] = price * sum(engine.rung_coins(v, new_rungs[t]) for v in vs)
        new_paid[t] = sum(1 for v in vs if v >= new_rungs[t][0])
    new_spend = sum(new_by_tier.values())

    if entropy:   # labelled only after the fact, from what actually happened
        seen = n / true_posts
        scenario = "abundant" if seen >= 2 else "scarce" if seen <= 0.5 else "viral_many" if len(surges) >= 2 else "viral_one" if surges else "smooth"
    return {
        **({"trace": [(tiers[i], views[i], i in fraud, late.get(i)) for i in range(n)]} if trace else {}),   # per post, for the Advertiser timeline
        "fraud_posts": len(fraud), "fraud_blocked": price * sum(engine.rung_coins(views[i], new_rungs[tiers[i]]) for i in fraud),
        "scenario": scenario, "true_cpi": cpi, "entropy": entropy, "budget": budget, "feel": feel, "feel_cpi": feel_cpi, "reference": reference,
        "rung_scores": scores, "bias": bias, "tilt": tilt, "posts": n, "views": total_views,
        "tier_posts": {t: len(vs) for t, vs in by_tier.items()},
        "surges": [{"tier": t, "share": s, "mult": m} for t, s, m in surges], "spikes": spikes,
        "true_posts": true_posts, "expected_posts": expected_posts, "crowd_mult": crowd_mult, "ease": ease,
        "optimal_rungs": optimal, "old_rungs": old_rungs, "old_payouts": payouts, "new_rungs": new_rungs,
        "rescued": [t for t, f in factors.items() if f < 1],
        "tier_views": {t: sum(vs) for t, vs in by_tier.items()},
        "old": {"spend": old_spend, "paid_by_tier": old_paid, "spend_by_tier": old_by_tier,
                "verdict": _verdict(old_spend, budget, total_views, cpi)},
        "new": {"spend": new_spend, "paid_by_tier": new_paid, "spend_by_tier": new_by_tier, "price": price,
                "regime": regime, "verdict": _verdict(new_spend, budget, total_views, cpi)},
    }


OVERPAID = 1.5           # "fair cost" line: this multiple of the true price for the reach delivered
OVERPAID_SHARE = 0.5     # "overpriced" verdict: only when the excess over that line tops this share of the budget


def _verdict(spend, budget, views, cpi=TRUE_CPI):
    """What a brand would say about one campaign: overspent (by any amount), overpriced within budget
    (real money, not just a price-per-view ratio: what was paid beyond a 1.5x-true-price "fair cost"
    tops half the budget — a tiny campaign at a high per-view price but small total spend doesn't count),
    or fine."""
    if spend > budget * (1 + 1e-9):
        return "blown"
    fair_cost = OVERPAID * cpi * views
    if views and spend - fair_cost > OVERPAID_SHARE * budget:
        return "overpaid"
    return "fine"


def _pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else 0


def _side(rows, key):
    ratio = [r[key]["spend"] / r["budget"] for r in rows]
    # money paid above the true price of the reach delivered (includes going past the budget)
    waste = [max(0.0, r[key]["spend"] - r["true_cpi"] * r["views"]) for r in rows]
    cpm = [1000 * r[key]["spend"] / r["views"] for r in rows if r["views"]]
    budget = sum(r["budget"] for r in rows)
    posts = {t: sum(r["tier_posts"][t] for r in rows) for t in TIER_NAMES}
    paid = {t: sum(r[key]["paid_by_tier"][t] for r in rows) for t in TIER_NAMES}
    price_x = [r[key]["spend"] / (r["true_cpi"] * r["views"]) for r in rows if r["views"]]   # paid / true price
    tier_views = {t: sum(r["tier_views"][t] for r in rows) for t in TIER_NAMES}
    tier_spend = {t: sum(r[key]["spend_by_tier"][t] for r in rows) for t in TIER_NAMES}
    return {
        "verdicts": {v: sum(1 for r in rows if r[key]["verdict"] == v) for v in ("blown", "overpaid", "fine")},
        "total_budget": budget, "total_spend": sum(r[key]["spend"] for r in rows),
        "waste_amount": sum(waste),
        "price_x_p10": _pct(price_x, 0.1), "price_x_median": _pct(price_x, 0.5), "price_x_p90": _pct(price_x, 0.9),
        "pay_per_1k_by_tier": {t: (1000 * tier_spend[t] / tier_views[t] if tier_views[t] else 0) for t in TIER_NAMES},
        "over_count": sum(1 for x in ratio if x > 1 + 1e-9),
        "over_2x": sum(1 for x in ratio if x > 2),
        "over_worst": max(ratio) if ratio else 0,
        "over_amount": sum(max(0, r[key]["spend"] - r["budget"]) for r in rows),
        "ratio_p10": _pct(ratio, 0.1), "ratio_median": _pct(ratio, 0.5), "ratio_p90": _pct(ratio, 0.9),
        "bands": [sum(1 for x in ratio if lo <= x < hi) / len(ratio) for lo, hi in BANDS] if ratio else [],
        "waste_share": sum(waste) / budget if budget else 0,
        "waste_p90": _pct([w / r["budget"] for w, r in zip(waste, rows)], 0.9),
        "cpm_overall": 1000 * sum(r[key]["spend"] for r in rows) / max(1, sum(r["views"] for r in rows)),
        "cpm_p90": _pct(cpm, 0.9),
        "cpm_cv": (statistics.pstdev(cpm) / statistics.fmean(cpm)) if len(cpm) > 1 and statistics.fmean(cpm) else 0,
        "paid_by_tier": {t: (paid[t] / posts[t] if posts[t] else 0) for t in TIER_NAMES},
        "creators_paid": sum(paid.values()) / max(1, sum(posts.values())),
    }


def _rows(seed, campaigns, scenario, skill=None, tick=None, entropy=False):
    names = list(SCENARIOS)
    rows = []
    for i in range(campaigns):
        # the entropy seed namespace keeps its old name on purpose: the same seed still gives the same campaigns
        rng = random.Random(f"benchmark-{seed}-{i}" if not entropy else f"unbiased-{seed}-{i}")
        rows.append(one_campaign(rng, scenario if scenario != "all" else names[i % len(names)], skill, entropy))
        rows[-1]["id"] = i + 1
        if tick:
            tick()
    return rows


def run(seed=1, campaigns=400, scenario="all", tick=None, entropy=False):
    if scenario != "all" and scenario not in SCENARIOS:
        raise ValueError(f"scenario must be 'all' or one of {', '.join(SCENARIOS)}")
    campaigns = int(_clip(int(campaigns), 1, 1000))
    names = list(SCENARIOS)
    rows = _rows(seed, campaigns, scenario, None, tick, entropy)
    by_scenario = {s: {"old": _side(g, "old"), "new": _side(g, "new"), "n": len(g)}
                   for s in names if (g := [r for r in rows if r["scenario"] == s])}
    return {
        "seed": seed, "campaigns": campaigns, "scenario": scenario, "labels": SCENARIOS, "tiers": TIER_NAMES,
        "mode": "entropy" if entropy else "standard", "true_cpm": statistics.median(r["true_cpi"] for r in rows) * 1000,
        "overpaid": OVERPAID, "overpaid_share": OVERPAID_SHARE, "levels": engine.LEVELS,
        "totals": {"old": _side(rows, "old"), "new": _side(rows, "new"),
                   "rescued_campaigns": sum(1 for r in rows if r["rescued"])},
        "by_scenario": by_scenario, "rows": rows,
    }


# --- confidence checks: other seeds, and advertisers better than the typical one ---------------------
ROBUST_SEEDS, ROBUST_N = 5, 100
SKILLS = (("Perfect", 0.0), ("Careful", 0.5), ("Typical", 1.0), ("Careless", 1.5))
SKILL_N = 150


def _gist(rows):
    n = len(rows)
    out = {}
    for key in ("old", "new"):
        spend, budget = sum(r[key]["spend"] for r in rows), sum(r["budget"] for r in rows)
        out[key] = {"blown": sum(1 for r in rows if r[key]["verdict"] == "blown") / n,
                    "fine": sum(1 for r in rows if r[key]["verdict"] == "fine") / n,
                    "spend_x": spend / budget}
    return out


def run_full(seed=1, campaigns=400, scenario="all", progress=None, entropy=False):
    """The main run plus the confidence checks. progress(done, total, stage) is called as work finishes."""
    campaigns = int(_clip(int(campaigns), 1, 1000))
    total = campaigns + ROBUST_SEEDS * ROBUST_N + len(SKILLS) * SKILL_N
    done = [0]
    report = progress or (lambda *a: None)

    def ticker(stage):
        def tick():
            done[0] += 1
            report(done[0], total, stage)
        return tick

    result = run(seed, campaigns, scenario, ticker("Simulating campaigns"), entropy)
    result["robust"] = []
    for k in range(ROBUST_SEEDS):
        other = seed + 1000 * (k + 1)
        result["robust"].append({"seed": other, **_gist(_rows(other, ROBUST_N, "all", None, ticker(f"Re-running with other seeds ({k + 1} of {ROBUST_SEEDS})"), entropy))})
    result["skills"] = []
    for label, k in SKILLS:
        result["skills"].append({"label": label, "skill": k, **_gist(_rows(seed + 77, SKILL_N, "all", k, ticker(f"Testing a {label.lower()} advertiser"), entropy))})
    report(total, total, "Done")
    return result


# --- background jobs, so the page can show real progress ------------------------------------------------
import threading
import uuid

_JOBS, _LOCK = {}, threading.Lock()
MAX_RUNNING_JOBS = 4   # runs at once, so a small host is never swamped


class Busy(ValueError):
    """Too many runs in flight; the server answers 429 and the page says so."""


def start_job(seed=1, campaigns=400, scenario="all", entropy=False):
    if scenario != "all" and scenario not in SCENARIOS:
        raise ValueError(f"scenario must be 'all' or one of {', '.join(SCENARIOS)}")
    job_id = uuid.uuid4().hex[:12]
    job = {"done": 0, "total": 1, "stage": "Starting", "result": None, "error": None}
    with _LOCK:
        if sum(1 for j in _JOBS.values() if j["result"] is None and j["error"] is None) >= MAX_RUNNING_JOBS:
            raise Busy("The benchmark is busy with other runs. Try again in a few seconds.")
        for k in list(_JOBS)[:-20]:
            del _JOBS[k]
        _JOBS[job_id] = job

    def progress(done, total, stage):
        job.update(done=done, total=total, stage=stage)

    def work():
        try:
            job["result"] = run_full(seed, campaigns, scenario, progress, entropy)
        except Exception as e:   # reported to the page, never swallowed
            job["error"] = str(e)

    threading.Thread(target=work, daemon=True).start()
    return job_id


def job_status(job_id):
    job = _JOBS.get(job_id)
    if job is None:
        raise KeyError("unknown job")
    return {k: job[k] for k in ("done", "total", "stage", "error")} | ({"result": job["result"]} if job["result"] else {})


# --- Compare page: the user's own ladder against Clearing, on this module's synthetic market ---------
# Used by the /api/compare route. Deliberately not `ladder/compare.py` (which plays both ways against
# real past campaigns from the generated world) — this reads the same tier distributions, market draws
# and engine calls as the rest of this file, so the Compare page tells the same story as Benchmark.
REPS_PER_MARKET = 60   # x5 built-in markets = 300 draws of the user's own campaign — enough for real
                       # percentages and distributions, not the single lucky-or-unlucky draw v0.1 gave


def _compare_rep(rng, scenario, budget, ladder, fair_cpi):
    """One simulated market for the Compare page: a random crowd of the given scenario meets the
    user's own ladder, and separately meets Clearing with the user's fair CPI as reference."""
    true_posts = max(1.0, budget / TRUE_CPI / MEAN_VIEWS)
    crowd_mult, surges, spikes = _draw_market(rng, scenario)
    n = int(_clip(round(true_posts * crowd_mult), 4, MAX_POSTS))
    tiers = rng.choices(TIER_NAMES, weights=[TIERS[t][2] for t in TIER_NAMES], k=n)
    views = [_draw_views(rng, t) for t in tiers]
    for tier, share, mult in surges:
        for i, t in enumerate(tiers):
            if t == tier and rng.random() < share:
                views[i] = int(views[i] * mult)
    for i in rng.sample(range(n), min(spikes, n)):
        views[i] = int(views[i] * math.exp(rng.uniform(math.log(20), math.log(150))))
    total_views = sum(views)
    by_tier = {t: [v for v, tt in zip(views, tiers) if tt == t] for t in TIER_NAMES}

    old_spend = sum(engine.ladder_pay(ladder, v) for v in views)

    # exactly what engine.settle does for a real campaign: the user's fair CPI goes straight in as the
    # reference, unmodified.
    new_rungs = {}
    for t in TIER_NAMES:
        base = engine.rungs_from([_draw_views(rng, t) for _ in range(HISTORY_PER_TIER)])
        new_rungs[t], _ = _fair_reach(by_tier[t], base)
    price, regime = engine.settle(budget, total_views, fair_cpi)
    new_spend = sum(price * sum(engine.rung_coins(v, new_rungs[t]) for v in vs) for t, vs in by_tier.items())

    return {"scenario": scenario, "posts": n, "views": total_views, "old_spend": old_spend,
            "new_spend": new_spend, "price": price, "regime": regime,
            "verdict_old": _verdict(old_spend, budget, total_views), "verdict_new": _verdict(new_spend, budget, total_views)}


def _cmp_stats(rows, key, budget):
    """The same shape of numbers Benchmark shows, computed over many draws of one fixed campaign
    instead of over many different campaigns."""
    n = len(rows)
    spend = [r[f"{key}_spend"] for r in rows]
    verdict = [r[f"verdict_{key}"] for r in rows]
    cpmvals = sorted(1000 * r[f"{key}_spend"] / r["views"] for r in rows if r["views"])
    pct = lambda q: cpmvals[min(len(cpmvals) - 1, int(q * len(cpmvals)))] if cpmvals else 0
    return {
        "paid": statistics.fmean(spend),
        "over_count": sum(1 for x in spend if x > budget * (1 + 1e-9)),
        "over_share": sum(1 for x in spend if x > budget * (1 + 1e-9)) / n,
        "verdicts": {v: sum(1 for x in verdict if x == v) / n for v in ("blown", "overpaid", "fine")},
        "cpm_p10": pct(0.1), "cpm_median": pct(0.5), "cpm_p90": pct(0.9),
        "returned": statistics.fmean(max(0.0, budget - x) for x in spend),
        "over_amount": statistics.fmean(max(0.0, x - budget) for x in spend),
    }


# --- Method scorecard: 4 scores out of 100, judgment calls made explicit in each docstring ------------
_CANON_RUNGS_CACHE = {}


def _canonical_new_rungs(tier, n=4000):
    """The rungs Clearing would build for one creator size from a large, clean sample of its history.
    Used only for the two *structural* scores below (retention shape, tier fairness) — never to price
    a real campaign. A real campaign's rungs also move with Fair Reach and whatever history it actually
    draws; this is the design's steady-state shape, not any one draw's."""
    if tier not in _CANON_RUNGS_CACHE:
        rng = random.Random(f"canon-{tier}")
        _CANON_RUNGS_CACHE[tier] = engine.rungs_from([_draw_views(rng, tier) for _ in range(n)])
    return _CANON_RUNGS_CACHE[tier]


RETENTION_LO, RETENTION_HI = 1.4, 3.5   # my call: a "climbable but still meaningful" step, rung to rung


def _gap_score(ratio):
    """100 inside the ideal band. Below it: scaled down toward 0 as the step shrinks to nothing (trivial,
    grindable). Above it: an exponential falloff, roughly halving every 3x past the ideal ceiling (too
    big a leap to bother chasing). The exact band and decay rate are my judgment calls, not measured."""
    if ratio <= 1.0:
        return 0.0
    if RETENTION_LO <= ratio <= RETENTION_HI:
        return 100.0
    if ratio < RETENTION_LO:
        return 100.0 * (ratio - 1.0) / (RETENTION_LO - 1.0)
    return 100.0 * math.exp(-(math.log(ratio) - math.log(RETENTION_HI)) / math.log(3))


def _retention_score(rung_lists, weights=None):
    """Score the gaps between consecutive milestones, weighting early gaps more heavily — a creator who
    gives up chasing the *second* rung is lost for the whole campaign, so that gap matters more than the
    seventh one. `rung_lists`: one list of view-thresholds per ladder scored (several for Clearing, one
    per creator size; a single list, repeated, for one shared ladder)."""
    weights = weights or [1.0] * len(rung_lists)
    total_w = total = 0.0
    for rungs, w in zip(rung_lists, weights):
        if len(rungs) < 2:
            continue
        gaps = [rungs[i + 1] / rungs[i] for i in range(len(rungs) - 1)]
        gap_w = [1.0 / (i + 1) for i in range(len(gaps))]
        s = sum(_gap_score(g) * gw for g, gw in zip(gaps, gap_w)) / sum(gap_w)
        total += s * w
        total_w += w
    return total / total_w if total_w else 0.0


def _tier_reach(rungs, tier, n=3000):
    """Share of a creator size's typical posts that would clear the ladder's first rung — i.e. earn
    anything at all."""
    if not rungs:
        return 0.0
    rng = random.Random(f"reach-{tier}-{rungs[0]}")
    return sum(1 for _ in range(n) if _draw_views(rng, tier) >= rungs[0]) / n


def _fairness_score(rungs_by_tier):
    """100 minus the spread (as percentage points) between the best-served and worst-served creator
    size's odds of earning anything. One shared ladder applied to nano through macro creators, who
    differ ~1,000x in typical views, tends to be unreachable for the small end or trivial for the large
    end — this is the gap that measures."""
    shares = {t: _tier_reach(rungs_by_tier[t], t) for t in TIER_NAMES}
    return 100.0 * (1.0 - (max(shares.values()) - min(shares.values()))), shares


def _roi_score(cpm_actual, true_cpm):
    """100 whenever the price paid per 1,000 views is at or below the market's true price — that's not
    a foul, it's the market having decided a price the brand is happy to pay less than. Only a price
    *above* true value is a real ROI problem: the score halves at 2x true price, halves again at 4x,
    and so on (100 x true/actual). Not symmetric: underpaying isn't the same failure as overpaying."""
    if cpm_actual <= 0 or true_cpm <= 0:
        return 0.0
    if cpm_actual <= true_cpm:
        return 100.0
    return 100.0 * true_cpm / cpm_actual


def method_scores(budget, old_rungs_views, true_cpm, totals):
    """Four 0–100 scores per method. Budget adherence and brand ROI come from the 300 simulated draws of
    this exact campaign; creator retention and tier fairness are structural — the shape of each method's
    rungs, not any one draw, since a ladder is designed once and then meets whatever market shows up."""
    new_by_tier = {t: _canonical_new_rungs(t) for t in TIER_NAMES}
    budget_score = lambda k: round(100 * max(0.0, 1 - totals[k]["over_share"] - totals[k]["over_amount"] / budget), 1)
    roi_score = lambda k: round(_roi_score(totals[k]["cpm_median"], true_cpm), 1)
    retention_old = round(_retention_score([old_rungs_views]), 1)
    retention_new = round(_retention_score([new_by_tier[t] for t in TIER_NAMES], [TIERS[t][2] for t in TIER_NAMES]), 1)
    fair_old, reach_old = _fairness_score({t: old_rungs_views for t in TIER_NAMES})
    fair_new, reach_new = _fairness_score(new_by_tier)

    def bundle(bud, ret, fair, roi):
        return {"budget": bud, "retention": ret, "fairness": round(fair, 1), "roi": roi,
                "overall": round(statistics.fmean([bud, ret, fair, roi]), 1)}

    return {
        "old": bundle(budget_score("old"), retention_old, fair_old, roi_score("old")),
        "new": bundle(budget_score("new"), retention_new, fair_new, roi_score("new")),
        "reach_by_tier": {"old": {t: round(v, 3) for t, v in reach_old.items()}, "new": {t: round(v, 3) for t, v in reach_new.items()}},
        "retention_band": [RETENTION_LO, RETENTION_HI], "reference_cpm": true_cpm,
    }


def random_old_ladder(budget):
    """A starting ladder for the Compare page's "old way" step, generated exactly the way one_campaign
    builds an advertiser's gut-feel ladder for Benchmark: optimal rungs from the true market, each
    thrown off by a random feel, a campaign-wide bias, a tilt (steeper or flatter), and per-rung noise.
    Genuinely random each call (not seeded), since this is a starting point to edit, not a result to
    reproduce."""
    rng = random.Random()
    budget = float(budget)
    optimal = [engine.round_sig(_pooled_reach(lv)) for lv in engine.LEVELS]
    feel = _clip(rng.lognormvariate(math.log(100), 0.8), *FEEL_RANGE)
    bias, tilt = rng.lognormvariate(0, 0.5), rng.gauss(0, 0.4)
    last = len(optimal) - 1
    scores = [_clip(feel * bias * math.exp(tilt * (2 * k / last - 1)) * rng.lognormvariate(0, 0.15), *RUNG_SCORE_RANGE)
              for k in range(len(optimal))]
    raw = sorted(o * s / 100 for o, s in zip(optimal, scores))
    rungs = []
    for r in raw:
        r = engine.round_sig(r)
        rungs.append(max(r, rungs[-1] + 1) if rungs else max(r, 1))
    feel_cpi = TRUE_CPI * 100 / feel
    expected_posts = max(1.0, budget / feel_cpi / MEAN_VIEWS)
    payouts = _ladder_payouts(budget, expected_posts)
    return [[v, round(p, -2) if p >= 1000 else round(p)] for v, p in zip(rungs, payouts)]


def compare(budget, old_rungs, fair_cpm, seed=1):
    """old_rungs: [[views, payout], ...], the user's own ladder. fair_cpm: the user's fair price per
    1,000 views for Clearing — required, same as the budget, so both sides get something to aim at.
    Runs REPS_PER_MARKET draws of THIS campaign through each of the 5 built-in markets (300 total), so
    the result is real percentages and ranges, not one lucky or unlucky draw."""
    budget = float(budget)
    ladder = sorted((int(v), float(p)) for v, p in old_rungs if int(v) > 0)
    if budget <= 0 or not ladder:
        raise ValueError("Need a budget and at least one rung for the old way")
    if fair_cpm in (None, "") or float(fair_cpm) <= 0:
        raise ValueError("Need a fair CPI for Clearing")
    fair_cpi = float(fair_cpm) / 1000
    names = list(SCENARIOS)
    reps = [_compare_rep(random.Random(f"compare-{seed}-{scenario}-{i}-{budget}-{fair_cpm}"), scenario, budget, ladder, fair_cpi)
            for scenario in names for i in range(REPS_PER_MARKET)]
    for i, r in enumerate(reps):
        r["id"] = i + 1
    by_market = {s: {"old": _cmp_stats(g, "old", budget), "new": _cmp_stats(g, "new", budget),
                     "posts_p10": sorted(x["posts"] for x in g)[int(0.1 * len(g))],
                     "posts_median": statistics.median(x["posts"] for x in g),
                     "posts_p90": sorted(x["posts"] for x in g)[int(0.9 * len(g)) - 1]}
                 for s in names if (g := [r for r in reps if r["scenario"] == s])}
    totals = {"old": _cmp_stats(reps, "old", budget), "new": _cmp_stats(reps, "new", budget)}
    old_rungs_views = [v for v, _ in ladder]
    return {
        "budget": budget, "fair_cpi": fair_cpi, "true_cpm": TRUE_CPI * 1000, "reps_per_market": REPS_PER_MARKET,
        "n": len(reps), "labels": SCENARIOS, "reps": reps, "totals": totals, "by_market": by_market,
        "scores": method_scores(budget, old_rungs_views, TRUE_CPI * 1000, totals),
    }


# --- Advertiser page: one advertiser's own budget and expected price, run through one_campaign ---
# The Advertiser page's what-ifs, on this module's market: key -> (label, Benchmark market, twist)
ADVERTISER_SCENARIOS = {
    "normal": ("What usually happens", "smooth", None),
    "crowded": ("Too many creators", "abundant", None),
    "thin": ("Too few views", "scarce", None),
    "fraud": ("A fraud wave", "smooth", "fraud"),
    "late_viral": ("Viral on the last day", "smooth", "late_viral"),
}
REVIEW_DAYS = 3     # days after the last post before the campaign settles


def _timeline(rng, run, days):
    """Spread the campaign's posts over `days`. Benchmark's market is a pile of independent posts, so here
    they are grouped into creators of one size, each posting 1 to 8 times (45% chance of another post).
    A creator joins on a random day in the first 70%; their other posts land on random days after that.
    A post's views build up front-loaded to its final count, except a late-viral post, which stays quiet
    until the last day. Each day holds what Clearing would owe if the campaign ended that day, with the same
    price (engine.settle) and milestones as the final result, so the last day equals the real outcome.
    Returns (timeline, number of creators)."""
    budget, reference, rungs = run["budget"], run["reference"], run["new_rungs"]
    by_tier = {}
    for t, v, fraud, late in run["trace"]:
        by_tier.setdefault(t, []).append((v, fraud, late))
    posts, creators = [], 0   # posts: (tier, views, fraud, late, creator number, day it starts)
    for t, ps in by_tier.items():
        rng.shuffle(ps)
        i = 0
        while i < len(ps):
            k = 1
            while rng.random() < 0.45 and k < 8:
                k += 1
            join = int(0.7 * days * rng.random())
            for m, (v, fraud, late) in enumerate(ps[i:i + k]):
                posts.append((t, v, fraud, late, creators, join if m == 0 else rng.randint(join, days - 1)))
            i += k
            creators += 1
    tau = days / 4
    out = []
    for d in range(days):
        views = coins = n_posts = 0
        who = set()
        for t, final, fraud, late, c, start in posts:
            if d < start:
                continue
            n_posts += 1
            who.add(c)
            if fraud:
                continue
            f = (1 - math.exp(-(d - start + 1) / tau)) / (1 - math.exp(-(days - start) / tau))
            v = int((final if late is None else late) * f) if d < days - 1 else final   # late viral: quiet until the last day
            views += v
            coins += engine.rung_coins(v, rungs[t])
        price = engine.settle(budget, views, reference)[0] if views else 0.0
        out.append({"views": views, "spend": price * coins, "creators": len(who), "posts": n_posts})
    return out, creators


def advertiser_run(budget, cpm, scenario="normal", seed=1, days=14):
    """The advertiser gives a budget (rupees), the price per 1,000 views (rupees) they'd be happy with and
    a duration. Returns one campaign in full, shaped like the Advertiser page's run (a day-by-day timeline
    and a report)."""
    budget, cpm = float(budget), float(cpm)
    if budget < 1000:
        raise ValueError("Budget must be at least ₹1,000")
    if cpm <= 0:
        raise ValueError("Expected price per 1,000 views must be above zero")
    if scenario not in ADVERTISER_SCENARIOS:
        raise ValueError(f"scenario must be one of {', '.join(ADVERTISER_SCENARIOS)}")
    market, twist = ADVERTISER_SCENARIOS[scenario][1:]
    seed, days = int(seed), int(_clip(int(days), 3, 90))
    make = lambda tag, trace=False: one_campaign(random.Random(f"advertiser-{seed}-{tag}"), market, budget=budget,
                                                 expected_cpi=cpm / 1000, trace=trace, twist=twist)
    run = make("run", True)
    rng = random.Random(f"advertiser-{seed}-timeline")
    timeline, creators = _timeline(rng, run, days)
    trace = run.pop("trace")
    n, o = run["new"], run["old"]
    views, price = run["views"], n["price"]
    sample = trace if len(trace) <= 3000 else rng.sample(trace, 3000)
    report = {
        "genuine_views": views, "cpm": 1000 * n["spend"] / views if views else None,
        "old_cpm": 1000 * o["spend"] / views if views else None, "paid": n["spend"], "old_paid": o["spend"],
        "old_over_budget": max(0.0, o["spend"] - budget), "money_back": max(0.0, budget - n["spend"]),
        "money_back_liquidity": max(0.0, budget - price * views), "money_back_rungs": max(0.0, price * views - n["spend"]),
        "fraud_blocked": run["fraud_blocked"], "fraud_posts": run["fraud_posts"], "creators": creators, "posts": run["posts"],
        "cards": ([{"kind": "cheaper"}] if n["regime"] == "plenty" and price < run["reference"] else []),
    }
    ours = {"timeline": timeline,
            "events": [{"kind": "fair_reach", "group": [t]} for t in run["rescued"]],
            "posts": [{"fraud": f, "views": v, "rung_coins": 0 if f else engine.rung_coins(v, run["new_rungs"][t])} for t, v, f, _ in sample]}
    return {"seed": seed, "scenario": scenario, "scenario_label": ADVERTISER_SCENARIOS[scenario][0], "tiers": TIER_NAMES,
            "budget": budget, "cpm": cpm, "days": days, "true_cpm": TRUE_CPI * 1000, "levels": engine.LEVELS,
            "settles_on": (date.today() + timedelta(days=days + REVIEW_DAYS)).isoformat(),
            "run": run, "ours": ours, "report": report}
