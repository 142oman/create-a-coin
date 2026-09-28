"""Play a new campaign out, day by day, with simulated creators. A demo sandbox: pricing never reads it.

Everything random comes from one seed, so the same seed replays the same campaign and a new seed gives
a new one. Simulated creators are drawn from the profiles of past creators (tier, platform), each makes
content in one of the campaign's categories, and their posts' views come from the same view model the
rungs for that category, tier and format are placed with. What varies by scenario is how many
join, who, and what goes wrong:

  normal      supply lands near where the pool meets the market
  crowded     far more creators than the budget expects: the coin is diluted, nothing is refunded
  thin        very few creators: the Nash split applies and part of the budget comes back
  late_viral  a normal campaign, plus one post that explodes on the last day
  fraud_wave  a normal campaign where many creators buy views
  small_only  only nano and micro creators turn up
  big_only    only mid and macro creators turn up

Settlement counts the views each post has on the campaign's last day. If any post is still held for
review then, settlement waits up to REVIEW_DAYS for the review: posts found valid count, posts found
to have bought views do not, and a post not cleared by the deadline counts as fraud. The simulation's
review finds the truth (bought views are fraud, false alarms are valid); the web page lets you change
each decision and see the effect. Coins are minted under both payout rules from the same posts.
"""
import math
import random
from datetime import date, timedelta

from .builder import MODES, build
from .config import REVIEW_DAYS
from .generate import FORMAT_MIX

SCENARIOS = {
    "normal": {"label": "Normal", "supply": (0.7, 1.4), "fraud": 0.08,
               "about": "About as many views as the budget buys at the market price. Supply is counted in views, so a few big creators can supply as much as many small ones."},
    "crowded": {"label": "Too many join", "supply": (3.0, 5.0), "fraud": 0.08,
                "about": "Three to five times the views the budget buys at the market price. The coin is diluted and nothing is refunded. Counted in views: sometimes that is a few big creators."},
    "thin": {"label": "Too few join", "supply": (0.08, 0.25), "fraud": 0.08,
             "about": "A tenth to a quarter of the views the budget buys at the market price, sometimes from just one or two creators. The price is negotiated and the rest refunded."},
    "late_viral": {"label": "Viral on the last day", "supply": (0.7, 1.4), "fraud": 0.08, "late_viral": True,
                   "about": "A normal campaign, plus one post that explodes on the final day."},
    "fraud_wave": {"label": "Fraud wave", "supply": (0.7, 1.4), "fraud": 0.35,
                   "about": "Over a third of creators buy views. Caught posts are never paid."},
    "small_only": {"label": "Only small creators", "supply": (0.7, 1.4), "fraud": 0.08, "tiers": ("nano", "micro"),
                   "about": "Only nano and micro pages turn up."},
    "big_only": {"label": "Only big creators", "supply": (0.7, 1.4), "fraud": 0.08, "tiers": ("mid", "macro"),
                 "about": "Only mid and macro pages turn up."},
}

# Conventions for the sandbox, taken from the synthetic world and the backtest where possible.
CREATOR_SPREAD = 0.35                 # creator-to-creator quality (log scale), as in the generator
VIRAL_SHARE, VIRAL_BOOST = 0.02, (math.log(6), 0.5)
KEEP_POSTING, MAX_POSTS = 0.45, 4     # chance of another post after each one
GAP_DAYS = (3, 10)
BOOSTED_POST_SHARE, BOUGHT_MULTIPLE = 0.5, (1.0, 8.0)
CATCH_RATE = 0.94                     # label-or-detector recall measured in the backtest
FALSE_ALARM = 0.01                    # clean posts held for review, then released
GROWTH_DAYS = 4.0                     # organic views: 1 - exp(-(age + 1) / 4) of final by `age` days
MAX_CREATORS = 4000
OVERSHOOT, MAX_TURNED_AWAY = 1.5, 300
LATE_VIRAL = 25                       # the last-day breakout, as a multiple of a typical post
DEFAULT_PER_VIEW = 0.1                # Rs per view to size supply before any market reference exists


def growth(age_days):
    """Share of a post's organic views it has `age_days` after posting (0 = posting day)."""
    return 0.0 if age_days < 0 else 1 - math.exp(-(age_days + 1) / GROWTH_DAYS)


def _views_at(post, day):
    age = day - post["day"]
    if age < 0:
        return 0
    return int(post["organic"] * growth(age) + post["bought"])  # bought views arrive in one burst


def simulate(dataset, params, scenario="normal", seed=None):
    if scenario not in SCENARIOS:
        raise ValueError(f"scenario must be one of {', '.join(SCENARIOS)}")
    seed = seed if seed is not None else random.randrange(1, 1_000_000)
    rng = random.Random(seed)
    spec = SCENARIOS[scenario]
    proposal = build(dataset.before(params.start_date), params)
    days = max(1, (date.fromisoformat(params.end_date) - date.fromisoformat(params.start_date)).days)
    last = days - 1

    tiers = [t for t in params.open_tiers if t in spec.get("tiers", params.open_tiers)]
    profiles = [c for c in dataset.creators if c["platform"] in params.open_platforms and c["tier"] in tiers]
    if not profiles:
        raise ValueError("No creators can join: the campaign's 'who can join' excludes everyone this scenario brings")

    ref = proposal.references["linear"].rate
    target = params.total_budget / (ref or DEFAULT_PER_VIEW) * rng.uniform(*spec["supply"])

    # Creators arrive until supply reaches the scenario's target. One macro post can carry millions of
    # views, so a creator who would overshoot the target by half again is turned away (they "don't
    # show up"); after enough of those, arrivals stop.
    creators, minted, turned_away = [], 0, 0
    while minted < target and len(creators) < MAX_CREATORS and turned_away < MAX_TURNED_AWAY:
        base = rng.choice(profiles)
        category = rng.choice(params.open_categories)   # the creator's content category
        cid = f"S{len(creators) + 1:04d}"
        quality = rng.gauss(0, CREATOR_SPREAD)
        cheats = rng.random() < spec["fraud"]
        joined = rng.randrange(days)
        posts, day = [], joined
        for n in range(MAX_POSTS):
            if n:
                if rng.random() >= KEEP_POSTING:
                    break
                day += rng.randint(*GAP_DAYS)
                if day > last:
                    break
            posts.append(_post(rng, proposal, base, category, day, quality, cheats))
        adds = sum(proposal.ladder_for(base["tier"], p["format"], base["platform"], category).coins(_views_at(p, last))
                   for p in posts if not p["voided"])
        if minted + adds > OVERSHOOT * target:
            turned_away += 1
            continue
        creators.append({"creator_id": cid, "tier": base["tier"], "platform": base["platform"], "category": category,
                         "follower_count": base["follower_count"], "joined": joined, "cheats": cheats, "posts": posts})
        minted += adds

    if spec.get("late_viral") and creators:
        star = rng.choice(creators)
        post = _post(rng, proposal, star, star["category"], last, 0.0, False)
        post["organic"] *= LATE_VIRAL  # a breakout on the final day, of which one day's growth counts
        post["viral"] = True
        star["posts"].append(post)

    return _settle(proposal, creators, days, scenario, seed)


def _post(rng, proposal, creator, category, day, quality, cheats):
    platform = creator["platform"]
    allowed = proposal.params.formats_on(platform)
    mix = {f: w for f, w in FORMAT_MIX[platform].items() if f in allowed}   # only formats the campaign counts
    fmt = rng.choices(list(mix), weights=list(mix.values()))[0]
    dist = proposal.ladder_for(creator["tier"], fmt, platform, category).dist
    post_sigma = math.sqrt(max(dist.sigma ** 2 - CREATOR_SPREAD ** 2, 0.1))
    organic = math.exp(rng.gauss(dist.mu + quality, post_sigma))
    viral = rng.random() < VIRAL_SHARE
    if viral:
        organic *= rng.lognormvariate(*VIRAL_BOOST)
    bought = organic * rng.uniform(*BOUGHT_MULTIPLE) if cheats and rng.random() < BOOSTED_POST_SHARE else 0.0
    held = rng.random() < (CATCH_RATE if bought else FALSE_ALARM)
    return {"day": day, "format": fmt, "organic": organic, "bought": bought, "viral": viral,
            "held": held, "voided": held and bought > 0}   # voided = the review finds bought views


def _settle(proposal, creators, days, scenario, seed):
    budget, last = proposal.params.total_budget, days - 1
    if not creators:
        raise ValueError("Nobody joined this run: try another seed")
    start = date.fromisoformat(proposal.params.start_date)

    def post_coins(c, p, day, mode):
        if p["voided"] or (p["held"] and day < last):   # held until validated; released at settlement
            return 0
        return proposal.ladder_for(c["tier"], p["format"], c["platform"], c["category"]).coins(_views_at(p, day), mode)

    timeline = []
    for d in range(days):
        row = {"day": d, "date": (start + timedelta(days=d)).isoformat(),
               "creators": sum(1 for c in creators if c["joined"] <= d),
               "posts": sum(1 for c in creators for p in c["posts"] if p["day"] <= d),
               "views": sum(_views_at(p, d) for c in creators for p in c["posts"])}
        for mode in MODES:
            coins = sum(post_coins(c, p, d, mode) for c in creators for p in c["posts"])
            rate, regime = proposal.settle(coins, mode)
            row[mode] = {"coins": coins, "coin_cpm": rate * 1000, "regime": regime,
                         "pool_cpm": 1000 * budget / coins if coins else None}
        timeline.append(row)

    settlement = {}
    for mode in MODES:
        final = timeline[-1][mode]
        rate = final["coin_cpm"] / 1000
        paid = rate * final["coins"]
        ref = proposal.references[mode].rate
        settlement[mode] = {**final, "paid": round(paid), "refund": round(budget - paid),
                            "reference_cpm": ref * 1000 if ref else None}

    rows = []
    for c in creators:
        posts = []
        for p in c["posts"]:
            ladder = proposal.ladder_for(c["tier"], p["format"], c["platform"], c["category"])
            views = _views_at(p, last)
            reached = sum(1 for r in ladder.thresholds if views >= r)
            coins = {m: post_coins(c, p, last, m) for m in MODES}
            posts.append({"key": f"{c['creator_id']}-{len(posts) + 1}", "review": ("fraud" if p["voided"] else "valid") if p["held"] else None,
                          "day": p["day"], "format": p["format"], "views": views, "bought_views": int(p["bought"]),
                          "organic_final": int(p["organic"]), "viral": p["viral"], "held": p["held"],
                          "voided": p["voided"], "rung": reached, "rungs": ladder.thresholds, "coins": coins,
                          "paid": {m: round(coins[m] * settlement[m]["coin_cpm"] / 1000) for m in MODES}})
        coins = {m: sum(p["coins"][m] for p in posts) for m in MODES}
        rows.append({"creator_id": c["creator_id"], "tier": c["tier"], "platform": c["platform"],
                     "category": c["category"], "followers": c["follower_count"], "joined": c["joined"],
                     "cheats": c["cheats"],
                     "views": sum(p["views"] for p in posts), "posts": posts, "coins": coins,
                     "paid": {m: sum(p["paid"][m] for p in posts) for m in MODES},
                     "share": {m: coins[m] / settlement[m]["coins"] if settlement[m]["coins"] else 0 for m in MODES}})
    rows.sort(key=lambda r: -r["paid"]["linear"])

    def group_stats(key):
        out = {}
        for r in rows:
            g = out.setdefault(key(r), {"creators": 0, "posts": 0, "qualified": 0, "views": 0,
                                        "coins": {m: 0 for m in MODES}, "paid": {m: 0 for m in MODES},
                                        "paid_creators": {m: 0 for m in MODES}})
            g["creators"] += 1
            g["posts"] += len(r["posts"])
            g["qualified"] += sum(1 for p in r["posts"] if p["rung"] and not p["voided"])
            g["views"] += r["views"]
            for m in MODES:
                g["coins"][m] += r["coins"][m]
                g["paid"][m] += r["paid"][m]
                g["paid_creators"][m] += r["paid"][m] > 0
        return out

    by_tier = group_stats(lambda r: r["tier"])
    by_group = group_stats(lambda r: f"{r['tier']}|{r['category']}")

    all_posts = [p for r in rows for p in r["posts"]]
    end = start + timedelta(days=last)
    review = any(p["held"] for p in all_posts)
    return {
        "seed": seed, "scenario": scenario, "scenario_label": SCENARIOS[scenario]["label"],
        "about": SCENARIOS[scenario]["about"], "days": days, "growth_days": GROWTH_DAYS,
        "ends_on": end.isoformat(), "review_days": REVIEW_DAYS if review else 0,
        "settles_on": (end + timedelta(days=REVIEW_DAYS if review else 0)).isoformat(),
        "proposal": proposal.to_dict(), "timeline": timeline, "settlement": settlement,
        "creators": rows, "by_tier": by_tier, "by_group": by_group,
        "summary": {"creators": len(rows), "posts": len(all_posts),
                    "posts_held": sum(p["held"] for p in all_posts),
                    "posts_voided": sum(p["voided"] for p in all_posts),
                    "bought_views_paid": {m: sum(p["paid"][m] for p in all_posts if p["bought_views"] and not p["voided"])
                                          for m in MODES},
                    "posts_below_threshold": sum(1 for p in all_posts if p["rung"] == 0)},
    }
