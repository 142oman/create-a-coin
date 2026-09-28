"""View model: log(views) is a bell curve (lognormal) per group of similar posts.

Every creator-campaign counts once: each post is weighted 1 / (that creator's posts in that campaign).
Under the old ladders, creators whose early posts cleared rung 1 kept posting and the rest often quit,
so a plain post-by-post average over-represents strong creators (survivorship). Weighting by creator
removes that: a creator's later posts are fresh draws of the same creator, not extra votes.

A group is category + platform + tier + format. When a group has too few clean posts, it is widened
one factor at a time, dropping first whichever factor moves views the least *in the data* — measured,
not assumed. The tier is never dropped: audience size moves views the most.
"""
import math
import statistics
from dataclasses import dataclass

from .config import MIN_GROUP_POSTS


@dataclass(frozen=True)
class ViewDist:
    mu: float       # mean of log-views; the median post gets e^mu views
    sigma: float    # spread of log-views
    n: int          # creators (creator-campaigns) behind the estimate
    basis: tuple    # the group actually used, e.g. ("gaming", "instagram", "micro", "reel")
    widened: int    # 0 = exact group, 1+ = factors dropped to reach MIN_GROUP_POSTS

    @property
    def median(self):
        return math.exp(self.mu)


def _weighted_stats(pairs):
    total = sum(w for _, w in pairs)
    mean = sum(v * w for v, w in pairs) / total
    # Unbiased for reliability weights: divide by total - sum(w^2)/total instead of n - 1.
    denom = total - sum(w * w for _, w in pairs) / total
    var = sum(w * (v - mean) ** 2 for v, w in pairs) / denom if denom > 0 else 0.0
    return mean, math.sqrt(var), total


def _spread_of_means(groups):
    means = [_weighted_stats(v)[0] for v in groups.values() if len(v) >= 5]
    return statistics.pstdev(means) if len(means) > 1 else 0.0


class ViewModel:
    def __init__(self, dataset, weighted=True):
        self.dataset = dataset
        self.weighted = weighted
        per_creator = {}
        for p in dataset.posts:
            key = (p["campaign_id"], p["creator_id"])
            per_creator[key] = per_creator.get(key, 0) + 1
        self.samples = {}  # (category, platform, tier, format) -> [(log views, weight)]
        for p in dataset.posts:
            if p["flagged_suspicious"] or p["views_final"] <= 0:
                continue
            category = dataset.campaign_by_id[p["campaign_id"]]["category"]
            key = (category, p["platform"], dataset.tier_of(p), p["format"])
            weight = 1 / per_creator[(p["campaign_id"], p["creator_id"])] if weighted else 1.0
            self.samples.setdefault(key, []).append((math.log(p["views_final"]), weight))
        self.drop_order = self._drop_order()

    def _drop_order(self):
        """Which factor to drop first: the one whose levels differ least in average log-views."""
        by_category, by_format = {}, {}
        for (category, platform, tier, fmt), values in self.samples.items():
            # Compare categories within the same platform/tier/format, and formats within the same
            # category/platform/tier, so each spread isolates one factor.
            by_category.setdefault((platform, tier, fmt), {}).setdefault(category, []).extend(values)
            by_format.setdefault((category, platform, tier), {}).setdefault(fmt, []).extend(values)
        category_effect = statistics.fmean([_spread_of_means(g) for g in by_category.values()] or [0])
        format_effect = statistics.fmean([_spread_of_means(g) for g in by_format.values()] or [0])
        self.effects = {"category": category_effect, "format": format_effect}
        return ("category", "format") if category_effect <= format_effect else ("format", "category")

    def _collect(self, categories, platform, tier, fmt, dropped):
        values = []
        for (c, p, t, f), v in self.samples.items():
            if t != tier:
                continue
            if "platform" not in dropped and p != platform:
                continue
            if "category" not in dropped and c not in categories:
                continue
            if "format" not in dropped and f != fmt:
                continue
            values.extend(v)
        return values

    def dist(self, category, platform, tier, fmt):
        """`category` is one category or a collection of them (a campaign open to several)."""
        categories = (category,) if isinstance(category, str) else tuple(category)
        steps = [(), (self.drop_order[0],), self.drop_order, self.drop_order + ("platform",)]
        for widened, dropped in enumerate(steps):
            values = self._collect(categories, platform, tier, fmt, dropped)
            if sum(w for _, w in values) >= MIN_GROUP_POSTS or widened == len(steps) - 1:
                break
        if len(values) < 2:
            raise ValueError(f"No history at all for tier {tier}")
        basis = tuple(x for name, x in zip(("category", "platform", "tier", "format"),
                                           ("/".join(categories), platform, tier, fmt)) if name not in dropped)
        mean, sd, n = _weighted_stats(values)
        return ViewDist(mean, sd, round(n), basis, widened)
