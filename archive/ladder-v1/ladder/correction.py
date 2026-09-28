"""Undoing the old ladders' fingerprints on history.

Past campaigns ran under gut-feel ladders, and creators reacted to them: generous ladders drew more
creators, unreachable ones fewer, and creators who missed the first rung often stopped posting.
Anything learned from that history carries those reactions. Three channels, three corrections:

1. Who joined (participation). The old ladders varied almost at random: that is what "gut feel"
   means. That variation is a natural experiment. For each past campaign we compute what its ladder
   *offered* a typical creator before anyone posted (expected Rs per 1,000 views), then measure how
   participation moved with the offer. A new campaign's participation is forecast by re-pricing each
   similar past campaign at the offer our ladder makes, not at the offer its own ladder made.

2. Who kept posting (survivorship). Creators whose early posts cleared the old rung 1 posted more,
   so a post-weighted sample over-represents strong creators. The view model therefore weights every
   creator-campaign equally (each post weighs 1 / that creator's posts in that campaign).

3. What creators were paid (lowball check). Realised payouts mix the offer with luck and with
   overspending. The check compares against what past ladders offered up front instead.

A fourth possible channel, creators pushing a post just over an old threshold, is tested for rather
than assumed (bunching test below).
"""
import math
import statistics
from dataclasses import dataclass
from statistics import NormalDist

STANDARD_NORMAL = NormalDist()
MIN_CAMPAIGNS = 8          # fewer and a slope across campaigns is noise
SIGNIFICANCE = 2.0         # adjust only when the effect is at least two standard errors from zero


def survival(dist, views):
    """Share of posts in a lognormal group reaching `views`."""
    if views <= 0:
        return 1.0
    return 1 - STANDARD_NORMAL.cdf((math.log(views) - dist.mu) / dist.sigma)


def expected_views(dist):
    return math.exp(dist.mu + dist.sigma ** 2 / 2)


def expected_fixed_payout(ladder, dist):
    """Expected Rs per post under a fixed (threshold, cumulative payout) ladder."""
    rungs = sorted(ladder, key=lambda r: r["view_threshold"])
    total = 0.0
    for i, r in enumerate(rungs):
        above_next = survival(dist, rungs[i + 1]["view_threshold"]) if i + 1 < len(rungs) else 0.0
        total += r["payout_amount"] * (survival(dist, r["view_threshold"]) - above_next)
    return total


def expected_cleared(rungs, dist):
    """Expected views paid for per post under a (views, reach) rung list."""
    total = 0.0
    for i, (views, _) in enumerate(rungs):
        above_next = survival(dist, rungs[i + 1][0]) if i + 1 < len(rungs) else 0.0
        total += views * (survival(dist, views) - above_next)
    return total


def offer_of_fixed_ladder(ladder, groups):
    """Rs per 1,000 expected views a fixed ladder offers, over [(weight, dist)] groups."""
    paid = sum(w * expected_fixed_payout(ladder, d) for w, d in groups)
    seen = sum(w * expected_views(d) for w, d in groups)
    return 1000 * paid / seen if seen else 0.0


def offer_of_proposal(ladders, rate):
    """Rs per 1,000 expected views our ladders offer at a flat `rate` per cleared view."""
    paid = sum(g.expected_posts * rate * expected_cleared(g.rungs, g.dist) for g in ladders)
    seen = sum(g.expected_posts * expected_views(g.dist) for g in ladders)
    return 1000 * paid / seen if seen else 0.0


@dataclass
class Correction:
    offers: dict            # campaign_id -> what its old ladder offered up front (Rs / 1K expected views)
    elasticity: float       # % change in participation per % change in offer (0 if not detectable)
    estimate: float         # the raw estimate, before the significance rule
    std_error: float
    campaigns: int
    applied: bool

    def adjust(self, rate, old_offer, new_offer):
        """Re-price a past campaign's participation rate at a different offer."""
        if not self.applied or old_offer <= 0 or new_offer <= 0:
            return rate
        return rate * (new_offer / old_offer) ** self.elasticity

    def to_dict(self):
        return {"elasticity": round(self.elasticity, 3), "estimate": round(self.estimate, 3),
                "std_error": round(self.std_error, 3), "campaigns": self.campaigns, "applied": self.applied}


def campaign_groups(history, model, campaign):
    """The (share, view distribution) mix of the posts a past campaign actually drew."""
    counts = {}
    for p in history.posts_by_campaign.get(campaign["campaign_id"], []):
        key = (history.tier_of(p), p["format"])
        counts[key] = counts.get(key, 0) + 1
    return [(n, model.dist(campaign["category"], campaign["platform"], tier, fmt))
            for (tier, fmt), n in counts.items()]


def fit(history, model, typical):
    """Offers of every past ladder, and how participation responded to them."""
    offers, rows = {}, []
    for c in history.campaigns:
        ladder = history.ladder_by_campaign.get(c["campaign_id"])
        posts = history.posts_by_campaign.get(c["campaign_id"], [])
        if not ladder or not posts:
            continue
        offers[c["campaign_id"]] = offer_of_fixed_ladder(ladder, campaign_groups(history, model, c))
        creators = len({p["creator_id"] for p in posts})
        # Creators who joined per rupee, normalised by the target tier's typical post, so campaigns
        # of different tiers and sizes are comparable. Joining (not posts) is what the offer drives;
        # posts per creator is the survivorship channel, handled in the view model.
        rows.append((c["target_creator_tier"], math.log(creators * typical[c["target_creator_tier"]] / c["total_budget"]),
                     math.log(offers[c["campaign_id"]])))
    estimate, se = _within_tier_slope(rows)
    applied = len(rows) >= MIN_CAMPAIGNS and se > 0 and abs(estimate) >= SIGNIFICANCE * se
    return Correction(offers, estimate if applied else 0.0, estimate, se, len(rows), applied)


def _within_tier_slope(rows):
    """OLS slope of log participation on log offer, comparing campaigns only within the same target tier."""
    by_tier = {}
    for tier, y, x in rows:
        by_tier.setdefault(tier, []).append((y, x))
    xs, ys = [], []
    for values in by_tier.values():
        if len(values) < 2:
            continue
        my = statistics.fmean(y for y, _ in values)
        mx = statistics.fmean(x for _, x in values)
        ys.extend(y - my for y, _ in values)
        xs.extend(x - mx for _, x in values)
    sxx = sum(x * x for x in xs)
    if len(xs) < 3 or sxx == 0:
        return 0.0, float("inf")
    slope = sum(x * y for x, y in zip(xs, ys)) / sxx
    groups = sum(1 for v in by_tier.values() if len(v) >= 2)
    dof = max(1, len(xs) - 1 - groups)
    residual = sum((y - slope * x) ** 2 for x, y in zip(xs, ys)) / dof
    return slope, math.sqrt(residual / sxx)


def bunching(history, window=0.1):
    """Do posts pile up just above old thresholds? Compares the share of posts in [t, t(1+w)) among those
    in [t(1-w), t(1+w)) with what a smooth curve predicts. A z-score near 0 means no pushing to cross."""
    above = below = 0
    expected_share = []
    for c in history.campaigns:
        for rung in history.ladder_by_campaign.get(c["campaign_id"], []):
            t = rung["view_threshold"]
            for p in history.posts_by_campaign.get(c["campaign_id"], []):
                v = p["views_final"]
                if t * (1 - window) <= v < t:
                    below += 1
                elif t <= v < t * (1 + window):
                    above += 1
    n = above + below
    if not n:
        return {"posts_near_thresholds": 0, "share_above": None, "expected_share_above": None, "z": 0.0}
    # A falling lognormal density puts slightly fewer posts just above t than just below; ~0.5 is the
    # right benchmark for a narrow window, and a conservative one (it hides, not creates, bunching).
    share = above / n
    z = (share - 0.5) / math.sqrt(0.25 / n)
    return {"posts_near_thresholds": n, "share_above": share, "expected_share_above": 0.5, "z": z}
