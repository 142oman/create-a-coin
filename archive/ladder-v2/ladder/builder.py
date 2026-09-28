"""Campaign parameters in, rungs and market terms out.

1. Forecast views for every category x platform x tier x format the campaign is open to (model.py).
   A campaign open to several categories gets separate rungs for each: gaming and finance content
   travel very differently.
2. Minimum threshold: the views reached by QUALIFY_REACH of posts like yours. Below it a post earns
   nothing.
3. Coin rungs: the threshold, then each next rung reached by STEP_CHANCE of the posts on the one
   below. Two payout rules are priced from the same rungs:
     * no rungs  - every view of a post at or above the threshold is one coin
     * coin rungs - a post mints the coins of the highest rung it reached (the brief's ladder)
4. The market reference for each rule (market.py) and the settlement (rules.settle). No price is set
   here: the brand gives a budget, creators give views, and the coin price is found at the end.
"""
import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from statistics import NormalDist

from .config import CATEGORIES, FORMATS, PLATFORMS, QUALIFY_REACH, RUNGS, STEP_CHANCE, TIERS
from .market import reference
from .model import ViewModel
from .rules import coins, rung_coins, settle

STANDARD_NORMAL = NormalDist()
MODES = ("linear", "rungs")   # no rungs (every view) / coin rungs


def _pick(values, allowed, name):
    values = [v for v in (values or []) if v]
    bad = [v for v in values if v not in allowed]
    if bad:
        raise ValueError(f"unknown {name}: {', '.join(bad)} (choose from {', '.join(allowed)})")
    return list(values)


@dataclass
class CampaignParams:
    """What the brand chooses. An empty list means "any": the campaign is open to all of them."""
    total_budget: float
    categories: list = field(default_factory=list)
    platforms: list = field(default_factory=list)
    tiers: list = field(default_factory=list)       # who can join
    start_date: str = None
    end_date: str = None
    formats: list = field(default_factory=list)     # which content formats count

    def __post_init__(self):
        self.categories = _pick(self.categories, CATEGORIES, "category")
        self.platforms = _pick(self.platforms, PLATFORMS, "platform")
        self.tiers = _pick(self.tiers, TIERS, "tier")
        self.formats = _pick(self.formats, [f for fs in FORMATS.values() for f in fs], "format")
        if not self.open_platforms:
            raise ValueError("None of the chosen formats exist on the chosen platforms")
        if self.total_budget <= 0:
            raise ValueError("budget must be positive")
        self.start_date = self.start_date or date.today().isoformat()
        self.end_date = self.end_date or (date.fromisoformat(self.start_date) + timedelta(days=30)).isoformat()
        if self.end_date <= self.start_date:
            raise ValueError("the campaign must end after it starts")

    @property
    def open_categories(self):
        return tuple(self.categories) or CATEGORIES

    @property
    def open_platforms(self):
        """Chosen platforms (or all) that still have at least one chosen format."""
        return tuple(p for p in (tuple(self.platforms) or PLATFORMS) if self.formats_on(p))

    def formats_on(self, platform):
        return tuple(f for f in FORMATS[platform] if not self.formats or f in self.formats)

    @property
    def open_tiers(self):
        return tuple(self.tiers) or TIERS

    @classmethod
    def from_campaign(cls, c):
        """A past campaign: one category and platform, open to every tier (anyone could join)."""
        return cls(c["total_budget"], [c["category"]], [c["platform"]], [], c["start_date"], c["end_date"], [])


def round_sig(x, digits=2):
    """38,712 -> 39,000: thresholds people can read and remember."""
    if x <= 0:
        return 0
    return int(round(x, digits - 1 - int(math.floor(math.log10(x)))))


def reach_of(dist, views):
    """Share of posts in a lognormal group reaching `views`."""
    return 1 - STANDARD_NORMAL.cdf((math.log(views) - dist.mu) / dist.sigma)


def place_rungs(dist, qualify=QUALIFY_REACH, step=STEP_CHANCE, count=RUNGS):
    """Rung 1 (the minimum threshold) reached by `qualify` of posts; each next by `step` of those before."""
    out, reach = [], qualify
    for _ in range(count):
        views = max(1, round_sig(math.exp(dist.mu + dist.sigma * STANDARD_NORMAL.inv_cdf(1 - reach))))
        if out and views <= out[-1][0]:
            views = round_sig(out[-1][0] * 1.1)  # rounding collided; keep them strictly rising
        out.append((views, reach_of(dist, views)))  # the exact reach of the rounded threshold
        reach *= step
    return out


@dataclass
class GroupLadder:
    category: str
    platform: str
    tier: str
    format: str
    dist: object
    rungs: list = field(default_factory=list)   # [(views, reach)]

    @property
    def threshold(self):
        return self.rungs[0][0]

    @property
    def thresholds(self):
        return [v for v, _ in self.rungs]

    def coins(self, views, mode="linear"):
        return coins(views, self.threshold) if mode == "linear" else rung_coins(views, self.thresholds)


def _history_coins(model, qualify, step):
    """coins_of(campaign, post) for each rule, with rungs cached per group: used on every past post."""
    cache = {}

    def ladder(campaign, post):
        key = (campaign["category"], post["platform"], model.dataset.tier_of(post), post["format"])
        if key not in cache:
            cache[key] = [v for v, _ in place_rungs(model.dist(*key), qualify, step)]
        return cache[key]
    return {"linear": lambda c, p: coins(p["views_final"], ladder(c, p)[0]),
            "rungs": lambda c, p: rung_coins(p["views_final"], ladder(c, p))}


def build(history, params, qualify=QUALIFY_REACH, step=STEP_CHANCE):
    model = ViewModel(history)
    cats = params.open_categories
    ladders = [GroupLadder(c, pl, t, f, d, place_rungs(d, qualify, step))
               for c in cats for pl in params.open_platforms for t in params.open_tiers for f in params.formats_on(pl)
               for d in [model.dist(c, pl, t, f)]]
    rules = _history_coins(model, qualify, step)
    refs = {mode: reference(history, cats, params.open_platforms, rules[mode]) for mode in MODES}
    return Proposal(params, qualify, step, ladders, refs, model.drop_order, model.effects)


@dataclass
class Proposal:
    params: CampaignParams
    qualify: float
    step: float
    ladders: list
    references: dict   # mode -> market.Reference
    drop_order: tuple
    effects: dict

    def ladder_for(self, tier, fmt, platform=None, category=None):
        return next(g for g in self.ladders
                    if g.tier == tier and g.format == fmt and (platform is None or g.platform == platform)
                    and (category is None or g.category == category))

    def settle(self, minted, mode="linear"):
        return settle(self.params.total_budget, minted, self.references[mode].rate)

    def break_even(self, mode="linear"):
        """Coins at which the pool split equals the market: fewer means a thin market and a refund."""
        rate = self.references[mode].rate
        return self.params.total_budget / rate if rate else None

    def to_dict(self):
        return {
            "params": {**vars(self.params), "open": {"categories": list(self.params.open_categories),
                                                     "platforms": list(self.params.open_platforms),
                                                     "formats": [f for pl in self.params.open_platforms
                                                                 for f in self.params.formats_on(pl)],
                                                     "tiers": list(self.params.open_tiers)}},
            "qualify_reach": self.qualify,
            "step_chance": self.step,
            "market": {mode: {**ref.to_dict(), "break_even_coins": round(self.break_even(mode)) if ref.rate else None}
                       for mode, ref in self.references.items()},
            "ladders": [{
                "category": g.category, "platform": g.platform, "tier": g.tier, "format": g.format,
                "threshold": g.threshold,
                "basis": {"group": list(g.dist.basis), "posts": g.dist.n, "widened": g.dist.widened,
                          "median_views": round(g.dist.median), "sigma": round(g.dist.sigma, 3),
                          "mu": round(g.dist.mu, 4)},
                # How each rung was placed: views = median x e^(sigma * z), z the normal quantile of its reach.
                "calc": [{"target_reach": round(self.qualify * self.step ** i, 4),
                          "z": round(STANDARD_NORMAL.inv_cdf(1 - self.qualify * self.step ** i), 3)}
                         for i in range(len(g.rungs))],
                "rungs": [{"rank": i + 1, "views": v, "coins": v, "reach": round(r, 4)}
                          for i, (v, r) in enumerate(g.rungs)],
            } for g in self.ladders],
            "widening_order": list(self.drop_order),
        }
