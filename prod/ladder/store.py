"""The running summary of settled campaigns (docs/DISCUSSION.md, G19).

When a campaign settles, its posts are added here, so a new campaign reads a few lists instead of
re-scanning history. It holds exactly what the engine needs:
  * per segment (category, platform, tier, format): final views, and views reached by each age
    (rungs, cold-start test, Fair Reach judging by age);
  * per settled campaign and format: the coin price and how many coins of that format (the market
    reference, G16);
  * per creator: their past posts' views ("versus usual" in the fraud check);
  * every past post's drop after its peak and its size versus its creator's usual (fraud cut-offs).
"""
import statistics

from .config import HOLD_ALONE, HOLD_TOGETHER, QUALIFY_REACH


def quantile(values, q):
    """Linear-interpolated quantile of an unsorted list."""
    v = sorted(values)
    if not v:
        return None
    pos = q * (len(v) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (pos - lo)


def weighted_median(pairs):
    pairs = sorted(pairs)
    total = sum(w for _, w in pairs)
    if not total:
        return None
    acc = 0.0
    for value, w in pairs:
        acc += w
        if acc >= total / 2:
            return value
    return pairs[-1][0]


def drop_after_peak(daily):
    """(views the day after the biggest day + 1) / (views on the biggest day + 1). The +1 keeps tiny
    posts honest: 1 view then 0 is not a cliff, 2,000 then 0 is. None if the peak is the last day."""
    if not daily:
        return None
    peak = max(range(len(daily)), key=lambda i: daily[i])
    if peak == len(daily) - 1:
        return None
    return (daily[peak + 1] + 1) / (daily[peak] + 1)


class Summary:
    def __init__(self):
        self.segment_views = {}   # seg -> [views_final]
        self.segment_by_age = {}  # seg -> {age: [cumulative views at that age]}
        self.prices = []          # (category, format, coin price per view, coins of that format)
        self.creator_views = {}   # creator_id -> [views_final]
        self.drops, self.usual_ratios = [], []
        self.campaigns = 0
        self._cut = None

    def usual(self, creator_id):
        past = self.creator_views.get(creator_id)
        return statistics.median(past) if past else None

    def add(self, campaign, posts, fraud_ids, price, held_ids=()):
        """Add a settled campaign. `posts` carry category/platform/tier/format/daily; `price` is its
        coin price per view (None if nothing was minted). Fraud cut-offs learn only from posts that
        were not held (G6: "compared with past posts that weren't flagged")."""
        coins_by_format = {}
        for p in posts:
            views = sum(p["daily"])
            if p["post_id"] not in held_ids:
                drop = drop_after_peak(p["daily"])
                if drop is not None:
                    self.drops.append(drop)
                usual = self.usual(p["creator_id"])
                if usual:
                    self.usual_ratios.append(views / usual)
            if p["post_id"] in fraud_ids:
                continue
            seg = (p["category"], p["platform"], p["tier"], p["format"])
            self.segment_views.setdefault(seg, []).append(views)
            by_age = self.segment_by_age.setdefault(seg, {})
            cum = 0
            for age, v in enumerate(p["daily"]):
                cum += v
                by_age.setdefault(age, []).append(cum)
            self.creator_views.setdefault(p["creator_id"], []).append(views)
            coins_by_format[p["format"]] = coins_by_format.get(p["format"], 0) + views
        if price:
            for fmt, coins in coins_by_format.items():
                self.prices.append((campaign["category"], fmt, price, coins))
        self.campaigns += 1
        self._cut = None

    def cutoffs(self):
        """Fraud cut-offs learned from past posts (G6). None until there is history."""
        if self._cut is None and self.drops:
            self._cut = {
                "drop_alone": quantile(self.drops, 1 - HOLD_ALONE),
                "drop_together": quantile(self.drops, 1 - HOLD_TOGETHER),
                "usual_together": quantile(self.usual_ratios, HOLD_TOGETHER) if self.usual_ratios else None,
                "usual_alone": quantile(self.usual_ratios, HOLD_ALONE) if self.usual_ratios else None,
            }
        return self._cut

    def reference(self, categories, formats):
        """Market reference per view (G16): same category and format; else the same format anywhere;
        else None. Weighted by how many coins of each format a campaign minted."""
        same = [(pr, w) for c, f, pr, w in self.prices if c in categories and f in formats]
        if same:
            return weighted_median(same), "same category and format"
        anywhere = [(pr, w) for c, f, pr, w in self.prices if f in formats]
        if anywhere:
            return weighted_median(anywhere), "same format, any category"
        return None, "no past campaign with this format"

    def age_threshold(self, seg, age):
        """The first rung for a post of this age: views that QUALIFY_REACH of past posts in the
        segment had reached by the same age (G12). Learned from history, never typed in."""
        by_age = self.segment_by_age.get(seg)
        if not by_age:
            return None
        a = min(age, max(by_age))
        while a not in by_age and a > 0:
            a -= 1
        return quantile(by_age[a], 1 - QUALIFY_REACH) if a in by_age else None

    def without_category(self, category):
        """The same summary as if `category` had never run: for demonstrating a cold start."""
        other = Summary()
        other.segment_views = {s: v for s, v in self.segment_views.items() if s[0] != category}
        other.segment_by_age = {s: v for s, v in self.segment_by_age.items() if s[0] != category}
        other.prices = [x for x in self.prices if x[0] != category]
        other.creator_views, other.drops, other.usual_ratios = self.creator_views, self.drops, self.usual_ratios
        other.campaigns = self.campaigns
        return other
