"""Campaign parameters in, milestone ladders out.

1. Forecast views for every tier x format group (model.py).
2. Place rungs: rung 1 at the group's median post, each next rung reached by STEP_CHANCE of the
   posts that reached the one before, and no rung fewer than one post is expected to reach.
3. One flat rate per view at every rung. Payout at a rung = rate x rung views.
4. Guaranteed minimum rate from a Monte Carlo of the whole campaign; maximum = brand's CPM.
"""
import bisect
import math
import random
import statistics
from dataclasses import dataclass, field
from datetime import date, timedelta
from statistics import NormalDist

from . import correction
from .config import BUDGET_CONFIDENCE, FORMATS, SIMULATION_RUNS, STEP_CHANCE, TIERS
from .model import ViewModel
from .rules import fixed_payout, settled_rate

STANDARD_NORMAL = NormalDist()


@dataclass
class CampaignParams:
    category: str
    platform: str
    total_budget: float
    brand_max_cpm: float          # ₹ per 1,000 views: the most the brand will pay
    target_creator_tier: str
    start_date: str = None
    end_date: str = None

    def __post_init__(self):
        if self.platform not in FORMATS:
            raise ValueError(f"platform must be one of {list(FORMATS)}")
        if self.target_creator_tier not in TIERS:
            raise ValueError(f"target_creator_tier must be one of {list(TIERS)}")
        if self.total_budget <= 0 or self.brand_max_cpm <= 0:
            raise ValueError("budget and brand_max_cpm must be positive")
        self.start_date = self.start_date or date.today().isoformat()
        self.end_date = self.end_date or (date.fromisoformat(self.start_date) + timedelta(days=30)).isoformat()

    @classmethod
    def from_campaign(cls, c):
        return cls(c["category"], c["platform"], c["total_budget"], c["brand_max_cpm"],
                   c["target_creator_tier"], c["start_date"], c["end_date"])


def round_sig(x, digits=2):
    """38,712 -> 39,000: thresholds people can read and remember."""
    if x <= 0:
        return 0
    return int(round(x, digits - 1 - int(math.floor(math.log10(x)))))


@dataclass
class GroupLadder:
    tier: str
    format: str
    expected_posts: float
    dist: object
    rungs: list = field(default_factory=list)   # [(views, reach)]

    @property
    def thresholds(self):
        return [v for v, _ in self.rungs]

    def cleared(self, views):
        """Views paid for: the highest rung at or below `views` (141 pays for 140)."""
        i = bisect.bisect_right(self.thresholds, views)
        return self.thresholds[i - 1] if i else 0

    def next_rung(self, views):
        i = bisect.bisect_right(self.thresholds, views)
        return self.thresholds[i] if i < len(self.thresholds) else None


def place_rungs(dist, expected_posts, step=STEP_CHANCE):
    """Rung 1 at the median; each next rung reached by `step` of those that reached the one before.

    Stop once fewer than one post in this campaign is expected to get there, but never before the
    ladder covers BUDGET_CONFIDENCE of posts: otherwise a tier with only a handful of expected posts
    gets a one-rung ladder and its good posts are paid as if they were median ones.
    """
    rungs, reach = [], 0.5
    while True:
        views = round_sig(math.exp(dist.mu + dist.sigma * STANDARD_NORMAL.inv_cdf(1 - reach)))
        if rungs and views <= rungs[-1][0]:
            views = round_sig(rungs[-1][0] * 1.1)  # rounding collided; keep the ladder strictly rising
        # The exact reach of the rounded threshold, so what we show is what we modelled.
        exact = 1 - STANDARD_NORMAL.cdf((math.log(views) - dist.mu) / dist.sigma)
        rungs.append((views, exact))
        reach *= step
        covered = exact <= 1 - BUDGET_CONFIDENCE
        if covered and expected_posts * reach < 1:
            return rungs


def _tier_medians(history):
    logs = {}
    for p in history.posts:
        if not p["flagged_suspicious"] and p["views_final"] > 0:
            logs.setdefault(history.tier_of(p), []).append(math.log(p["views_final"]))
    return {t: math.exp(statistics.median(v)) for t, v in logs.items()}


def _similar_campaigns(history, params):
    # Target tier decides how many creators a rupee attracts (small creators each cost less), so it
    # is kept longest; platform is dropped first.
    same_tier = [c for c in history.campaigns if c["target_creator_tier"] == params.target_creator_tier]
    similar = [c for c in same_tier if c["platform"] == params.platform]
    basis = "same platform and target tier"
    if len(similar) < 3:
        similar, basis = same_tier, "same target tier, any platform"
    if len(similar) < 3:
        similar, basis = list(history.campaigns), "all past campaigns (too few with this target tier)"
    similar = [c for c in similar if history.posts_by_campaign.get(c["campaign_id"])]
    if not similar:
        raise ValueError("No settled campaigns in the history to learn participation from")
    return similar, basis


def continuation(history):
    """How often a creator posts again after a post that did / did not clear the old rung 1 by day 7.
    Measured straight from each creator's sequence of posts: this is the quitting behaviour."""
    sequences = {}
    for p in history.posts:
        sequences.setdefault((p["campaign_id"], p["creator_id"]), []).append(p)
    cap = max((len(s) for s in sequences.values()), default=1)
    counts = {True: [0, 0], False: [0, 0]}   # cleared? -> [posted again, chances]
    for (cid, _), seq in sequences.items():
        ladder = history.ladder_by_campaign.get(cid)
        if not ladder:
            continue
        seq.sort(key=lambda p: (p["post_date"], p["post_id"]))
        for i, p in enumerate(seq):
            if i + 1 >= cap:
                break
            cleared = fixed_payout(ladder, p["views_at_7d"]) > 0
            counts[cleared][1] += 1
            counts[cleared][0] += i + 1 < len(seq)
    rate = lambda k: counts[k][0] / counts[k][1] if counts[k][1] else 0.4
    return {"after_cleared": rate(True), "after_missed": rate(False), "max_posts": cap}


def posts_per_creator(cont, p_clear):
    """Expected posts per creator when each post clears rung 1 with probability p_clear."""
    q = p_clear * cont["after_cleared"] + (1 - p_clear) * cont["after_missed"]
    return sum(q ** k for k in range(cont["max_posts"]))


def participation(history, params, correction, typical):
    """Who is likely to join, from similar past campaigns, before re-pricing to our offer."""
    similar, basis = _similar_campaigns(history, params)
    # Creators joined per rupee differ ~100x between nano and macro campaigns, because small creators
    # each cost less. Normalising by the target tier's typical post makes campaigns comparable, so a
    # wider fallback group still gives a sensible forecast.
    rates, tier_counts = [], {}
    for c in similar:
        posts = history.posts_by_campaign[c["campaign_id"]]
        creators = len({p["creator_id"] for p in posts})
        rates.append((creators * typical[c["target_creator_tier"]] / c["total_budget"],
                      correction.offers.get(c["campaign_id"], 0.0)))
        for p in posts:
            tier_counts[history.tier_of(p)] = tier_counts.get(history.tier_of(p), 0) + 1
    # Format mix comes from every past post on this platform: the similar campaigns may be elsewhere.
    format_counts = {}
    for p in history.posts:
        if p["platform"] == params.platform:
            key = (history.tier_of(p), p["format"])
            format_counts[key] = format_counts.get(key, 0) + 1
    shares = {}
    n_tier = sum(tier_counts.values())
    for tier, count in tier_counts.items():
        in_tier = {f: format_counts.get((tier, f), 0) for f in FORMATS[params.platform]}
        n_fmt = sum(in_tier.values())
        for f, k in in_tier.items():
            shares[(tier, f)] = count / n_tier * (k / n_fmt if n_fmt else 1 / len(in_tier))
    scale = params.total_budget / typical[params.target_creator_tier]
    return {"creator_rates": rates, "scale": scale, "shares": shares, "basis": basis,
            "campaigns": [c["campaign_id"] for c in similar]}


def lowball_check(correction, history, params, offer_at_max):
    """Would creators see less than past ladders in this category offered them up front?

    Compares offers, not realised payouts: what a past ladder paid out mixes its offer with luck and
    with overspending, while its offer is what creators actually weighed when deciding to join."""
    offers = [correction.offers[c["campaign_id"]] for c in history.campaigns
              if c["category"] == params.category and c["campaign_id"] in correction.offers]
    if not offers:
        return {"status": "unknown", "history": [], "offer_at_max": offer_at_max,
                "message": f"No past {params.category} campaigns to compare against."}
    low, mid = min(offers), statistics.median(offers)
    change = (offer_at_max / mid) ** correction.elasticity - 1 if correction.applied else None
    effect = (f" Expect about {abs(change):.0%} {'fewer' if change < 0 else 'more'} creators "
              "than a typical campaign here." if change is not None and abs(change) >= 0.05 else "")
    offered = f"At your maximum, creators can expect ₹{offer_at_max:.0f} per 1,000 views"
    if offer_at_max < low:
        status, message = "block", (f"{offered}, below every past {params.category} ladder "
                                    f"(lowest ₹{low:.0f}). No creators have been tested at this rate." + effect)
    elif offer_at_max < mid:
        status, message = "warn", (f"{offered}, below the typical {params.category} ladder "
                                   f"(median ₹{mid:.0f})." + effect)
    else:
        status, message = "ok", (f"{offered}, in line with past {params.category} ladders "
                                 f"(median ₹{mid:.0f})." + effect)
    return {"status": status, "message": message, "history": sorted(round(x, 1) for x in offers),
            "lowest": low, "median": mid, "offer_at_max": offer_at_max}


def simulate_cleared_views(ladders, posts_draws, runs=SIMULATION_RUNS, seed=0):
    """Total views that clear a rung, across `runs` simulated versions of the campaign. Each run draws
    how many posts arrive from `posts_draws` (one per similar past campaign, re-priced to our offer)."""
    rng = random.Random(seed)
    groups = [g for g in ladders if g.expected_posts > 0]
    weights = [g.expected_posts for g in groups]
    totals = []
    for _ in range(runs):
        n_posts = max(1, round(rng.choice(posts_draws)))
        total = 0
        for g in rng.choices(groups, weights=weights, k=n_posts):
            total += g.cleared(math.exp(rng.gauss(g.dist.mu, g.dist.sigma)))
        totals.append(total)
    return sorted(totals)


def _histogram(totals, bins=24):
    lo, hi = totals[0], totals[int(0.995 * (len(totals) - 1))]
    width = max(1, (hi - lo) / bins)
    counts = [0] * bins
    for t in totals:
        counts[min(bins - 1, int((t - lo) / width))] += 1
    return {"start": lo, "width": width, "counts": counts}


def build(history, params, step=STEP_CHANCE, runs=SIMULATION_RUNS):
    model = ViewModel(history)
    typical = _tier_medians(history)
    fix = correction.fit(history, model, typical)
    part = participation(history, params, fix, typical)
    cont = continuation(history)
    growth_7d = _growth_to_final(history)
    max_rate = params.brand_max_cpm / 1000
    dists = {(t, f): model.dist(params.category, params.platform, t, f)
             for t in TIERS for f in FORMATS[params.platform]}

    # Rung 1 sits at each group's median, so the chance a post clears it by day 7 (which drives
    # quitting) is known before we know how many posts to expect.
    weight = max(1e-9, sum(part["shares"].get(k, 0) for k in dists))
    p_clear = sum(part["shares"].get(k, 0) * correction.survival(d, round_sig(d.median) / growth_7d)
                  for k, d in dists.items()) / weight
    per_creator = posts_per_creator(cont, p_clear)

    def expected_posts_at(offer):
        """Every similar past campaign, re-priced to `offer`, then turned into posts."""
        return [fix.adjust(r, old, offer) * part["scale"] * per_creator for r, old in part["creator_rates"]]

    def place(total):
        return [GroupLadder(t, f, total * part["shares"].get((t, f), 0.0), d,
                            place_rungs(d, total * part["shares"].get((t, f), 0.0), step))
                for (t, f), d in dists.items()]

    # Fixed point: more creators -> the budget is split more ways -> a lower offer -> fewer creators.
    offer = statistics.median([old for _, old in part["creator_rates"]])
    for _ in range(30):
        ladders = place(statistics.median(expected_posts_at(offer)))
        paid_views = sum(g.expected_posts * correction.expected_cleared(g.rungs, g.dist) for g in ladders)
        rate = min(max_rate, params.total_budget / paid_views) if paid_views else max_rate
        new_offer = correction.offer_of_proposal(ladders, rate)
        if new_offer <= 0 or abs(math.log(new_offer / offer)) < 0.005:
            offer = new_offer or offer
            break
        offer = math.sqrt(offer * new_offer)   # damped step in log space
    draws = expected_posts_at(offer)
    total = statistics.median(draws)
    ladders = place(total)

    totals = simulate_cleared_views(ladders, draws, runs)
    p50 = totals[len(totals) // 2]
    p95 = totals[min(len(totals) - 1, int(BUDGET_CONFIDENCE * len(totals)))]
    min_rate = min(max_rate, params.total_budget / p95) if p95 else max_rate
    spends = [settled_rate(params.total_budget, t, min_rate, max_rate) * t for t in totals]
    expected_spend = statistics.fmean(spends)
    naive = (statistics.median(r for r, _ in part["creator_rates"]) * part["scale"]
             * posts_per_creator(cont, _history_p_clear(history)))
    part.update({"correction": fix, "continuation": cont, "p_clear_rung1_by_7d": p_clear,
                 "posts_per_creator": per_creator, "offer_cpm": offer,
                 "expected_creators": total / per_creator, "uncorrected_posts": naive})
    return Proposal(
        params=params, step=step, ladders=ladders, min_rate=min_rate, max_rate=max_rate,
        budget_rich=min_rate >= max_rate, expected_posts=total, participation=part,
        simulation={
            "runs": runs, "p50_cleared_views": p50, "p95_cleared_views": p95,
            "chance_over_at_min": sum(1 for t in totals if t * min_rate > params.total_budget) / len(totals),
            "expected_spend": expected_spend,
            "expected_refund": params.total_budget - expected_spend,
            "expected_rate_cpm": 1000 * settled_rate(params.total_budget, p50, min_rate, max_rate),
            "views_budget_buys_at_max": params.total_budget / max_rate,
            "histogram": _histogram(totals),
        },
        lowball=lowball_check(fix, history, params, correction.offer_of_proposal(ladders, max_rate)),
        drop_order=model.drop_order, effects=model.effects,
    )


def _growth_to_final(history):
    clean = [p for p in history.posts if not p["flagged_suspicious"] and p["views_at_7d"] > 0]
    return statistics.median(p["views_final"] / p["views_at_7d"] for p in clean) if clean else 1.0


def _history_p_clear(history):
    """How often past posts cleared their old ladder's rung 1 by day 7: the quitting pressure history saw."""
    hits = n = 0
    for p in history.posts:
        ladder = history.ladder_by_campaign.get(p["campaign_id"])
        if ladder:
            n += 1
            hits += fixed_payout(ladder, p["views_at_7d"]) > 0
    return hits / n if n else 0.5


@dataclass
class Proposal:
    params: CampaignParams
    step: float
    ladders: list
    min_rate: float
    max_rate: float
    budget_rich: bool
    expected_posts: float
    participation: dict
    simulation: dict
    lowball: dict
    drop_order: tuple
    effects: dict

    def ladder_for(self, tier, fmt):
        return next(g for g in self.ladders if g.tier == tier and g.format == fmt)

    def to_dict(self):
        return {
            "params": vars(self.params),
            "step_chance": self.step,
            "pricing": {"min_cpm": round(self.min_rate * 1000, 2), "max_cpm": round(self.max_rate * 1000, 2),
                        "budget_rich": self.budget_rich},
            "expected_posts": round(self.expected_posts, 1),
            "ladders": [{
                "tier": g.tier, "format": g.format, "expected_posts": round(g.expected_posts, 1),
                "basis": {"group": list(g.dist.basis), "posts": g.dist.n, "widened": g.dist.widened,
                          "median_views": round(g.dist.median), "sigma": round(g.dist.sigma, 3)},
                "rungs": [{"rank": i + 1, "views": v, "reach": round(r, 4),
                           "min_payout": round(v * self.min_rate), "max_payout": round(v * self.max_rate)}
                          for i, (v, r) in enumerate(g.rungs)],
            } for g in self.ladders],
            "simulation": self.simulation,
            "lowball": self.lowball,
            "participation": {
                "basis": self.participation["basis"],
                "similar_campaigns": self.participation["campaigns"],
                "offer_cpm": round(self.participation["offer_cpm"], 2),
                "expected_creators": round(self.participation["expected_creators"], 1),
                "posts_per_creator": round(self.participation["posts_per_creator"], 2),
                "p_clear_rung1_by_7d": round(self.participation["p_clear_rung1_by_7d"], 3),
                "continuation": {k: round(v, 3) for k, v in self.participation["continuation"].items()},
                "correction": self.participation["correction"].to_dict(),
                "uncorrected_posts": round(self.participation["uncorrected_posts"], 1),
            },
            "widening_order": list(self.drop_order),
        }
