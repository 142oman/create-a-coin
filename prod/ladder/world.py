"""The generated world: past campaigns, creators and posts, made by Markov chains at run time.

Nothing about the market is hand-set. The only relations built in (docs/DISCUSSION.md, G2, G14, G28):
  1. bigger accounts get more views, less than proportionally (the steepness is drawn per run);
  2. views never decrease (daily views are never negative);
  3. category and format change reach (how much is drawn per run);
  4. bought views arrive mostly as a burst, the rest over the next days (the split is drawn per run);
  5. a higher coin value (or a more generous ladder) attracts more creators (strength drawn per run);
  6. brands budget roughly for the reach they expect, off by a random error (its size drawn per run);
  7. ops anchor gut-feel ladders on what past posts got, off by a random error (drawn per run).
Everything else comes out of three chains whose transition tables are drawn at random:
  * post momentum, daily:  cold, steady, trending, viral, fading, dead (dead is permanent, and only a
    fading post can die: attention tails off before it stops)
  * creator state, per campaign they could join: active, fatigued, cheating, gone (gone is permanent)
  * market season, monthly: hot, normal, cold
The recipe's sliders (0 to 1) only tilt where those random draws land.
"""
import math
import random
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

from .config import (CATEGORIES, FORMATS, HISTORY_DAYS, N_CAMPAIGNS, N_CREATORS, PLATFORMS,
                     TIER_BOUNDS, TIERS, tier_of)

START = date(2024, 1, 1)
POST_STATES = ("cold", "steady", "trending", "viral", "fading", "dead")
CREATOR_STATES = ("active", "fatigued", "cheating", "gone")
SEASONS = ("hot", "normal", "cold")
SEASON_DAYS = 30


@dataclass
class Recipe:
    seed: int = 2
    budget_min: int = 10_000
    budget_max: int = 5_000_000
    duration_min: int = 7
    duration_max: int = 45
    virality: float = 0.5
    cheating: float = 0.5
    seasons: float = 0.5
    pay_pull: float = 0.5

    def __post_init__(self):
        self.seed = int(self.seed)
        for k in ("virality", "cheating", "seasons", "pay_pull"):
            setattr(self, k, min(1.0, max(0.0, float(getattr(self, k)))))
        self.budget_min, self.budget_max = sorted((max(100, int(self.budget_min)), max(100, int(self.budget_max))))
        self.duration_min, self.duration_max = sorted((max(3, int(self.duration_min)), max(3, int(self.duration_max))))

    @classmethod
    def from_dict(cls, d):
        return cls(**{k: v for k, v in (d or {}).items() if k in cls.__dataclass_fields__})

    @classmethod
    def randomised(cls, seed):
        rng = random.Random(seed)
        lo = int(10 ** rng.uniform(3, 5.5))
        return cls(seed=seed, budget_min=lo, budget_max=int(lo * 10 ** rng.uniform(1, 3)),
                   duration_min=rng.randint(3, 14), duration_max=rng.randint(15, 60),
                   virality=rng.random(), cheating=rng.random(), seasons=rng.random(), pay_pull=rng.random())


def _dirichlet(rng, weights):
    draws = [rng.gammavariate(w, 1.0) if w > 0 else 0.0 for w in weights]
    total = sum(draws) or 1.0
    return [d / total for d in draws]


def _row(rng, n, me, stay, weights):
    """A transition row: stay with probability `stay`, otherwise move by random shares of `weights`."""
    others = _dirichlet(rng, [0 if i == me else w for i, w in enumerate(weights)])
    return [stay if i == me else (1 - stay) * others[i] for i in range(n)]


def _step(rng, row):
    r, acc = rng.random(), 0.0
    for i, p in enumerate(row):
        acc += p
        if r < acc:
            return i
    return len(row) - 1


def draw_params(recipe):
    """Every number the world runs on, drawn once per recipe. Shown on the page under "all numbers"."""
    rng = random.Random(f"params-{recipe.seed}")
    v, c, s, pull = recipe.virality, recipe.cheating, recipe.seasons, recipe.pay_pull
    fatigued = rng.uniform(0.1, 0.5)
    gone = rng.uniform(0.01, 0.08)
    post_mult = {"cold": rng.uniform(0.55, 0.9), "steady": rng.uniform(0.85, 1.0),
                 "trending": rng.uniform(1.05, 1.35), "viral": rng.uniform(1.3, 2.0),
                 "fading": rng.uniform(0.35, 0.75), "dead": 0.0}
    boost = 0.2 + 2.0 * v   # the virality slider tilts moves towards trending and viral
    post_stay = {"cold": rng.uniform(0.3, 0.8), "steady": rng.uniform(0.4, 0.85),
                 "trending": rng.uniform(0.3, 0.75), "viral": rng.uniform(0.2, 0.45 + 0.4 * v),
                 "fading": rng.uniform(0.4, 0.85)}
    # Structural rule: only a fading post can die; attention tails off before it stops.
    can_die = {"fading": 1}
    post_rows = [_row(rng, 6, i, post_stay[st], [1, 1, boost, boost, 1, can_die.get(st, 0)])
                 for i, st in enumerate(POST_STATES[:-1])]
    post_rows.append([0, 0, 0, 0, 0, 1.0])  # dead is permanent
    cheat_w = 0.05 + 0.6 * c
    creator_rows = [
        _row(rng, 4, 0, rng.uniform(0.6, 0.95), [1, 1, cheat_w, gone]),
        _row(rng, 4, 1, rng.uniform(0.4, 0.85), [1, 1, cheat_w, 2 * gone]),
        _row(rng, 4, 2, rng.uniform(0.3, 0.6 + 0.35 * c), [1, 0.5, 1, gone]),
        [0, 0, 0, 1.0],  # gone is permanent
    ]
    cold_w = 0.3 + 2.0 * s
    season_rows = [
        _row(rng, 3, 0, rng.uniform(0.5, 0.9), [1, 1, cold_w]),
        _row(rng, 3, 1, rng.uniform(0.5, 0.9), [1, 1, cold_w]),
        _row(rng, 3, 2, rng.uniform(0.5, 0.6 + 0.35 * s), [1, 1, 1]),
    ]
    sc, sf = rng.uniform(0.1, 0.6), rng.uniform(0.2, 0.8)
    return {
        "follower_steepness": rng.uniform(0.55, 0.95),
        "first_day_scale": rng.uniform(0.02, 0.3),
        "creator_quality_spread": rng.uniform(0.2, 0.6),
        "post_noise": rng.uniform(0.2, 0.6),
        "small_creator_skew": rng.uniform(1.2, 3.0),
        "instagram_share": rng.uniform(0.4, 0.7),
        "category_effect": {k: math.exp(rng.gauss(0, sc)) for k in CATEGORIES},
        "format_effect": {k: math.exp(rng.gauss(0, sf)) for fs in FORMATS.values() for k in fs},
        "format_mix": {p: dict(zip(fs, _dirichlet(rng, [2] * len(fs)))) for p, fs in FORMATS.items()},
        "post_states": list(POST_STATES), "post_multiplier": post_mult, "post_transitions": post_rows,
        "post_start": _dirichlet(rng, [2, 3, 0.5 + v, 0.1 + 0.5 * v, 0, 0]),
        "creator_states": list(CREATOR_STATES), "creator_transitions": creator_rows,
        "creator_start": _dirichlet(rng, [3, 1, 0.1 + c, 0]),
        "fatigued_factor": fatigued,
        "seasons": list(SEASONS), "season_transitions": season_rows,
        "season_views": {"hot": rng.uniform(1.05, 1.5), "normal": 1.0, "cold": rng.uniform(0.35, 0.85)},
        "season_joining": {"hot": rng.uniform(1.0, 1.5), "normal": 1.0, "cold": rng.uniform(0.4, 0.9)},
        "join_chance": rng.uniform(0.05, 0.2),
        "keep_posting": rng.uniform(0.3, 0.7),
        "gap_days": rng.uniform(3, 10),
        "boost_chance": min(0.95, rng.uniform(0.3, 0.9) * (0.5 + c)),
        "bought_multiple": rng.uniform(0.0, 1.6),
        "burst_share": rng.uniform(0.5, 1.0),
        "pay_pull": max(0.05, pull) * rng.uniform(0.5, 2.0),
        "follower_growth": rng.uniform(0.001, 0.01),
        "ops_rate_centre": math.exp(rng.uniform(math.log(10), math.log(200))),
        "ops_error": rng.uniform(0.3, 1.2),
        "brand_value_per_view": {k: math.exp(rng.uniform(math.log(0.02), math.log(0.3))) for k in CATEGORIES},
        "budget_error": rng.uniform(0.3, 1.0),
    }


def pay_response(offer, reference, pull):
    """Joining boost from pay: 1 when the offer equals the reference, up to 2 when far above, towards
    0 when far below. The direction is built in; the steepness `pull` is drawn per run."""
    if not reference or offer <= 0:
        return 1.0
    return 2.0 / (1.0 + (reference / offer) ** pull)


def round_human(x):
    """Round to 1, 2, 2.5 or 5 x 10^k, as a person setting a ladder would."""
    if x <= 0:
        return 0
    k = 10 ** math.floor(math.log10(x))
    return int(min((1, 2, 2.5, 5, 10), key=lambda m: abs(math.log(x / (m * k)))) * k)


def season_at(season_path, day):
    return season_path[min(len(season_path) - 1, max(0, day) // SEASON_DAYS)]


def grow_post(rng, P, typical, days, season_path, start_day, state=None):
    """Organic daily views for `days` days from `start_day`, driven by the momentum chain."""
    s = state if state is not None else _step(rng, P["post_start"])
    level = typical * math.exp(rng.gauss(0, P["post_noise"]))
    daily = []
    for d in range(days):
        if d:
            s = _step(rng, P["post_transitions"][s])
            level *= P["post_multiplier"][POST_STATES[s]]
        season = SEASONS[season_at(season_path, start_day + d)]
        daily.append(level * P["season_views"][season])
    return daily


def add_bought(rng, P, daily):
    """Bought views on top of organic: mostly one burst early, the rest over the next days."""
    total = sum(daily) * math.exp(rng.gauss(P["bought_multiple"], 0.5))
    out = list(daily)
    burst = rng.choice((0, 1)) if len(out) > 1 else 0
    out[burst] += total * P["burst_share"]
    rest = list(range(burst + 1, min(len(out), burst + 7)))
    for d in rest:
        out[d] += total * (1 - P["burst_share"]) / len(rest)
    if not rest:
        out[burst] += total * (1 - P["burst_share"])
    return out


def typical_first_day(P, creator, category, fmt):
    return (P["first_day_scale"] * creator["follower_count"] ** P["follower_steepness"] * creator["quality"]
            * P["category_effect"][category] * P["format_effect"][fmt])


def old_ladder(rng, P, target_tier, seen):
    """A gut-feel ladder: the first rung anchored on what past posts by the target tier got (or a rough
    guess before there are any), off by a random gut-feel error; round thresholds; one flat-ish rate."""
    if seen:
        anchor = sorted(seen)[len(seen) // 2]
    else:
        lo, hi = TIER_BOUNDS[target_tier]
        anchor = P["first_day_scale"] * math.sqrt(lo * hi) ** P["follower_steepness"] * 10
    first = round_human(anchor * math.exp(rng.gauss(0, P["ops_error"])))
    rate = P["ops_rate_centre"] * math.exp(rng.gauss(0, 0.5))
    rungs, views = [], max(100, first)
    for _ in range(rng.randint(2, 6)):
        rungs.append((views, max(100, round(views * rate / 1000 / 100) * 100)))
        views = round_human(views * rng.uniform(2, 5))
    payouts = [p for _, p in rungs]
    for i in range(1, len(payouts)):
        payouts[i] = max(payouts[i], payouts[i - 1] + 100)
    return [(v, p) for (v, _), p in zip(rungs, payouts)], rate


def ladder_pay(ladder, views):
    paid = 0
    for v, p in ladder:
        if views >= v:
            paid = p
    return paid


@dataclass
class World:
    recipe: Recipe
    params: dict
    campaigns: list
    milestone_ladders: list
    creators: list
    posts: list
    truth: dict = field(default_factory=dict)           # post_id -> bought views (0 = none)
    creator_state: dict = field(default_factory=dict)   # creator_id -> state index at the end of history
    season_path: list = field(default_factory=list)     # season index per 30-day block (incl. the future)

    def __post_init__(self):
        self.index()

    def index(self):
        self.creator_by_id = {c["creator_id"]: c for c in self.creators}
        self.campaign_by_id = {c["campaign_id"]: c for c in self.campaigns}
        self.posts_by_campaign = {}
        for p in self.posts:
            self.posts_by_campaign.setdefault(p["campaign_id"], []).append(p)
        self.ladder_by_campaign = {}
        for r in sorted(self.milestone_ladders, key=lambda r: r["milestone_rank"]):
            self.ladder_by_campaign.setdefault(r["campaign_id"], []).append((r["view_threshold"], r["payout_amount"]))

    def to_dict(self):
        return {"recipe": asdict(self.recipe), "params": self.params, "campaigns": self.campaigns,
                "milestone_ladders": self.milestone_ladders, "creators": self.creators, "posts": self.posts,
                "truth": self.truth, "creator_state": self.creator_state, "season_path": self.season_path}

    @classmethod
    def from_dict(cls, d):
        return cls(Recipe.from_dict(d["recipe"]), d["params"], d["campaigns"], d["milestone_ladders"],
                   d["creators"], d["posts"], d["truth"], d["creator_state"], d["season_path"])


def generate(recipe=None):
    recipe = recipe or Recipe()
    P = draw_params(recipe)
    rng = random.Random(f"world-{recipe.seed}")

    # Seasons: one state per 30-day block, for the history and a year beyond it (for new campaigns).
    season_path, s = [], 1
    for _ in range((HISTORY_DAYS + 365) // SEASON_DAYS + 1):
        season_path.append(s)
        s = _step(rng, P["season_transitions"][s])

    creators, state = [], {}
    for i in range(N_CREATORS):
        followers = int(10 ** (3 + 4 * rng.random() ** P["small_creator_skew"]))
        cid = f"CR{i + 1:04d}"
        creators.append({
            "creator_id": cid,
            "platform": "instagram" if rng.random() < P["instagram_share"] else "youtube",
            "follower_count": min(9_999_999, followers),
            "quality": math.exp(rng.gauss(0, P["creator_quality_spread"])),
            "prior_age_months": rng.randint(1, 60),
        })
        state[cid] = _step(rng, P["creator_start"])

    starts = sorted(rng.randrange(0, HISTORY_DAYS - recipe.duration_min) for _ in range(N_CAMPAIGNS))
    campaigns, ladders, posts, truth = [], [], [], {}
    seen_by_tier = {t: [] for t in TIERS}   # what ops can see: final views of earlier posts
    for i, start in enumerate(starts):
        duration = rng.randint(recipe.duration_min, recipe.duration_max)
        category, platform = rng.choice(CATEGORIES), rng.choice(PLATFORMS)
        target = rng.choice(TIERS)
        ladder, rate = old_ladder(rng, P, target, seen_by_tier[target])
        cid = f"C{i + 1:03d}"
        campaign = {"campaign_id": cid, "brand": f"{category.title()} Brand {i + 1}", "category": category,
                    "platform": platform, "total_budget": 0,
                    "start_date": (START + timedelta(days=start)).isoformat(),
                    "end_date": (START + timedelta(days=start + duration - 1)).isoformat(),
                    "target_creator_tier": target}
        campaigns.append(campaign)
        first_post = len(posts)
        for rank, (v, pay) in enumerate(ladder, 1):
            ladders.append({"campaign_id": cid, "milestone_rank": rank, "view_threshold": v, "payout_amount": pay})
        season = SEASONS[season_at(season_path, start)]
        pull = pay_response(rate, P["ops_rate_centre"], P["pay_pull"])
        for cr in creators:
            if cr["platform"] != platform:
                continue
            st = state[cr["creator_id"]] = _step(rng, P["creator_transitions"][state[cr["creator_id"]]])
            if CREATOR_STATES[st] == "gone":
                continue
            fatigue = P["fatigued_factor"] if CREATOR_STATES[st] == "fatigued" else 1.0
            if rng.random() >= P["join_chance"] * fatigue * P["season_joining"][season] * pull:
                continue
            day = rng.randrange(duration)
            while day < duration:
                posts.append(_make_post(rng, P, cr, cid, category, platform, start, day, duration,
                                        season_path, CREATOR_STATES[st] == "cheating", ladder, truth, len(posts)))
                if rng.random() >= P["keep_posting"] * fatigue:
                    break
                day += 1 + int(rng.expovariate(1 / P["gap_days"]))
        # Brands budget roughly for the reach they expect, at their category's value per view, off by
        # a random error; bounded by the recipe's budget range.
        mine = posts[first_post:]
        reach = sum(p["views_final"] - truth[p["post_id"]] for p in mine)
        if reach:
            budget = reach * P["brand_value_per_view"][category] * math.exp(rng.gauss(0, P["budget_error"]))
        else:
            budget = math.exp(rng.uniform(math.log(recipe.budget_min), math.log(recipe.budget_max)))
        campaign["total_budget"] = int(round(min(recipe.budget_max, max(recipe.budget_min, budget)), -2))
        for p in mine:
            seen_by_tier[p["tier_at_post"]].append(p["views_final"])
    world = World(recipe, P, campaigns, ladders, creators, posts, truth,
                  {k: v for k, v in state.items()}, season_path)
    _finish_creators(world)
    return world


def _make_post(rng, P, creator, cid, category, platform, start, day, duration, season_path, cheating, ladder, truth, n):
    mix = P["format_mix"][platform]
    fmt = rng.choices(list(mix), weights=list(mix.values()))[0]
    daily = grow_post(rng, P, typical_first_day(P, creator, category, fmt), duration - day, season_path, start + day)
    organic = [int(round(x)) for x in daily]
    if cheating and rng.random() < P["boost_chance"]:
        daily = [int(round(x)) for x in add_bought(rng, P, daily)]
    else:
        daily = organic
    pid = f"P{n + 1:05d}"
    truth[pid] = sum(daily) - sum(organic)   # bought views (0 = none); hidden from the method
    final = sum(daily)
    creator["follower_count"] = min(9_999_999, int(creator["follower_count"] + final * P["follower_growth"]))
    return {**export_fields(daily), "post_id": pid, "campaign_id": cid, "creator_id": creator["creator_id"],
            "post_date": (START + timedelta(days=start + day)).isoformat(), "platform": platform, "format": fmt,
            "tier_at_post": tier_of(creator["follower_count"]), "daily_views": daily,
            "total_payout_earned": ladder_pay(ladder, final), "flagged_suspicious": False}


def export_fields(daily):
    """The brief's view columns, calculated from `daily_views` and capped at the campaign's end."""
    cum = 0
    at = {}
    for i, v in enumerate(daily):
        cum += v
        at[i] = cum
    last = len(daily) - 1
    pick = lambda d: at[min(d, last)] if daily else 0
    return {"views_at_24h": pick(0), "views_at_7d": pick(6), "views_at_30d": pick(29), "views_final": pick(last)}


def _finish_creators(world):
    """The brief's creator fields, calculated from each creator's own generated past."""
    by_creator = {}
    for p in world.posts:
        by_creator.setdefault(p["creator_id"], []).append(p)
    for c in world.creators:
        mine = by_creator.get(c["creator_id"], [])
        campaigns = {p["campaign_id"] for p in mine}
        hit = {p["campaign_id"] for p in mine if p["total_payout_earned"] > 0}
        first = min((p["post_date"] for p in mine), default=None)
        months = ((START + timedelta(days=HISTORY_DAYS)) - date.fromisoformat(first)).days // 30 if first else 0
        c.update({"tier": tier_of(c["follower_count"]),
                  "account_age_months": c["prior_age_months"] + months,
                  "historical_avg_views_per_post": int(sum(p["views_final"] for p in mine) / len(mine)) if mine else 0,
                  "historical_completion_rate": round(len(hit) / len(campaigns), 2) if campaigns else 0.0})


def budget_ladder(rng, P, target_tier, seen, budget, typical_posts, everyone=None):
    """The gut-feel ladder ops would set for a given budget: thresholds anchored on the target tier
    (`seen`), payouts scaled so that their guess of the spend (typical number of posts x average payout
    over past posts by everyone who usually joins) matches the budget, off by the random gut-feel error.
    One ladder for every creator size, as ops do today."""
    ladder, rate = old_ladder(rng, P, target_tier, seen)
    sample = everyone or seen or [ladder[0][0]]
    avg = sum(ladder_pay(ladder, v) for v in sample) / len(sample)
    guess = typical_posts * avg * math.exp(rng.gauss(0, P["ops_error"]))
    if guess <= 0:
        return ladder
    k = budget / guess
    out, last = [], 0
    for v, p in ladder:
        pay = max(last + 100, round(p * k / 100) * 100)
        out.append((v, pay))
        last = pay
    return out
