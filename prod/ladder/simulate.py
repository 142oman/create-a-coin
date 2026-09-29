"""A new campaign played out after the generated history, with the same chains that made the history.

Used by the advertiser flow (Publish, "see how we'd handle...") and the creator flow. It is a
sandbox: pricing never reads it. Creators join day by day; a higher live coin value pulls more of
them in (built-in relation 5), which dilutes it again. The same posts are also paid the old way, by
a typical gut-feel ladder, so the report can show what the brand would have paid.
"""
import copy
import math
import statistics
import random
from datetime import timedelta

from . import engine
from .config import ALL_FORMATS, CATEGORIES, HISTORY_DAYS, PLATFORM_OF, TIERS, tier_of
from .world import (CREATOR_STATES, POST_STATES, SEASONS, START, _step, add_bought, budget_ladder,
                    grow_post, pay_response, season_at, typical_first_day)

# The creator simulator plays in a friendlier market than the generated history: posts get more views and
# each view is worth more, closer to what creators are really paid. Only the creator flow uses this.
VIEW_SCALE = {"nano": 20, "micro": 12, "mid": 7, "macro": 5}
_REAL = {}


def _stated_prices(world):
    """The market reference from what past campaigns *offered* per view (each ladder's payout over its
    threshold), not what they happened to pay out. Realised pay per view undercounts: most posts never
    reached the first rung and were paid nothing, and a post is paid only up to the rung it cleared,
    so paid / views ran about a third of the rate the ladders quoted."""
    out = []
    for c in world.campaigns:
        ladder = world.ladder_by_campaign[c["campaign_id"]]
        rate = statistics.median(pay / thr for thr, pay in ladder if thr)
        views = {}
        for p in world.posts_by_campaign.get(c["campaign_id"], []):
            views[p["format"]] = views.get(p["format"], 0) + p["views_final"]
        out += [(c["category"], fmt, rate, v) for fmt, v in views.items() if v]
    return out


def realistic_summary(world, summary):
    """A copy of the history with views and prices lifted to the creator simulator's scale."""
    if id(summary) not in _REAL:
        r = copy.copy(summary)
        f = lambda seg: VIEW_SCALE.get(seg[2], 1)
        r.segment_views = {seg: [v * f(seg) for v in vs] for seg, vs in summary.segment_views.items()}
        r.segment_by_age = {seg: {a: [v * f(seg) for v in vs] for a, vs in by.items()} for seg, by in summary.segment_by_age.items()}
        r.creator_views = {cid: [v * VIEW_SCALE.get(tier_of(world.creator_by_id[cid]["follower_count"]), 1) for v in vs]
                           for cid, vs in summary.creator_views.items() if cid in world.creator_by_id}
        r.prices = _stated_prices(world)
        r._cut = None
        _REAL[id(summary)] = r
    return _REAL[id(summary)]


MAX_COPIES = 100     # most times the world's creators are cloned for a big budget
CLONE = "~"          # separates a clone's number from the creator it copies

SCENARIOS = {
    "normal": {"label": "What usually happens", "join": 1.0},
    "crowded": {"label": "Too many creators", "join": 4.0},
    "thin": {"label": "Too few views", "join": 0.15},
    "fraud": {"label": "A fraud wave", "join": 1.0, "cheat": 0.4},
    "late_viral": {"label": "Viral on the last day", "join": 1.0, "late_viral": 25},
}

# What a normal run looks like: mostly strong, sometimes a little under, and now and then a run where
# the protection has to step in. (weight, joining multiplier range, views multiplier range): how many
# creators join, and how well their posts do (below 1 the views run cold for everyone, which is what
# Fair Reach is for). Drawn per seed, so a replay of the same seed is the same run; the what-if
# buttons bypass this and force a scenario.
PROFILES = {
    "strong": (0.55, (3.5, 6.0), (1.0, 1.0)),
    "slightly_under": (0.15, (1.5, 2.5), (0.7, 0.9)),
    "partial_protection": (0.12, (0.7, 1.0), (0.4, 0.65)),
    "considerable_protection": (0.10, (0.3, 0.5), (0.25, 0.45)),
    "low_liquidity": (0.08, (0.08, 0.15), (0.6, 1.0)),
}


def _profile(seed):
    rng = random.Random(f"profile-{seed}")
    name = rng.choices(list(PROFILES), weights=[v[0] for v in PROFILES.values()])[0]
    _, joining, views = PROFILES[name]
    return name, rng.uniform(*joining), rng.uniform(*views)


def _views_to(post, t):
    return sum(post["daily"][:max(0, t - post["day"])])


def simulate(world, summary, categories, formats, budget, days, seed=None, scenario="normal",
             cold_category=None, join_creator=None, max_cpm=None, copies=None, realistic=False):  # max_cpm: the brand's expected price per 1,000 views
    if scenario not in SCENARIOS:
        raise ValueError(f"scenario must be one of {', '.join(SCENARIOS)}")
    budget, days = float(budget), int(days)
    if budget <= 0 or days < 1:
        raise ValueError("budget and duration must be positive")
    seed = int(seed) if seed not in (None, "") else random.randrange(1, 1_000_000)
    spec = SCENARIOS[scenario]
    profile = None
    if scenario in ("normal", "fraud", "late_viral"):   # fraud and viral replay the same campaign with a twist
        profile, joining, cold = _profile(seed)
        spec = {**spec, "join": joining, "views": cold}
    cats = [c for c in (categories or []) if c in CATEGORIES] or list(CATEGORIES)
    fmts = [f for f in (formats or []) if f in ALL_FORMATS] or list(ALL_FORMATS)
    platforms = {PLATFORM_OF[f] for f in fmts}
    P = world.params
    rng = random.Random(f"sim-{seed}-{scenario}")
    used = summary.without_category(cold_category) if cold_category else summary
    market, _ = used.reference(cats, fmts)   # what creators expect: drives who joins, never the price
    brand_cpi = float(max_cpm) / 1000 if max_cpm not in (None, "") and float(max_cpm) > 0 else None
    reference = brand_cpi or market
    season = SEASONS[season_at(world.season_path, HISTORY_DAYS)]

    # A bigger budget draws a bigger market: the world's creators are cloned in proportion to the budget
    # (capped), so a 2 crore campaign is not starved of creators the generated world happens not to have.
    # The "too few views" what-if is the opposite case (few creators for this budget), so it keeps the
    # world as it is.
    copies = copies or (1 if scenario == "thin" else int(min(MAX_COPIES, max(1, round(budget / (typical_budget(world, cats, fmts) or 16900))))))
    people = []
    for c0 in world.creators:
        if c0["platform"] not in platforms:
            continue
        for k in range(copies):
            c = c0 if k == 0 else {**c0, "creator_id": f"{c0['creator_id']}{CLONE}{k}"}
            st = _step(rng, P["creator_transitions"][world.creator_state[c0["creator_id"]]])
            if spec.get("cheat") and rng.random() < spec["cheat"]:
                st = CREATOR_STATES.index("cheating")
            forced = c["creator_id"] == join_creator
            if forced:   # the player is always a genuine, active creator: they can join any campaign and never get flagged
                st = CREATOR_STATES.index("active")
            if CREATOR_STATES[st] == "gone" and not forced:
                continue
            fatigue = P["fatigued_factor"] if CREATOR_STATES[st] == "fatigued" else 1.0
            people.append({"c": c, "state": CREATOR_STATES[st], "fatigue": fatigue, "category": rng.choice(cats),
                           "forced_day": rng.randint(0, max(0, days // 5)) if forced else None})

    by_id = {p["c"]["creator_id"]: p for p in people}
    base_chance = P["join_chance"] * P["season_joining"][season] * spec["join"]
    posts, joined = [], {}
    for d in range(days):
        coins = sum(_views_to(p, d) for p in posts)
        live_price = engine.settle(budget, coins, reference)[0] if coins else None
        pull = 1.0 if live_price is None else pay_response(live_price, market, P["pay_pull"])  # no price yet: neutral
        for person in people:
            cid = person["c"]["creator_id"]
            if cid in joined:
                continue
            if person["forced_day"] is not None:
                if d != person["forced_day"]:
                    continue
            else:
                total = min(1.0, base_chance * person["fatigue"] * pull)
                if rng.random() >= 1 - (1 - total) ** (1 / days):
                    continue
            joined[cid] = d
            day = d
            while day < days:
                posts.append(_post(rng, P, person, day, days, fmts, world.season_path, len(posts),
                                  boost=spec.get("views", 1.0) * (VIEW_SCALE.get(tier_of(person["c"]["follower_count"]), 1) if realistic else 1)))
                if rng.random() >= P["keep_posting"] * person["fatigue"]:
                    break
                day += 1 + int(rng.expovariate(1 / P["gap_days"]))

    if spec.get("late_viral") and joined:
        cid = rng.choice(sorted(joined))
        person = by_id[cid]
        post = _post(rng, P, person, days - 1, days, fmts, world.season_path, len(posts),
                     state=POST_STATES.index("viral"), boost=spec["late_viral"] * (VIEW_SCALE.get(tier_of(person["c"]["follower_count"]), 1) if realistic else 1))
        post["late_viral"] = True
        posts.append(post)

    ours = engine.run(used, budget, days, posts, cats, fmts, with_timeline=True, brand_cpi=brand_cpi)
    ladder = ops_ladder(world, summary, budget, seed, posts, cats, formats=fmts)
    old = engine.old_way(ladder, budget, posts)
    start = START + timedelta(days=HISTORY_DAYS)
    end = start + timedelta(days=days - 1)
    return {
        "seed": seed, "scenario": scenario, "profile": profile, "scenario_label": spec["label"], "days": days, "budget": budget,
        "categories": cats, "formats": fmts, "cold_category": cold_category,
        "starts_on": start.isoformat(), "ends_on": end.isoformat(),
        "settles_on": (end + timedelta(days=ours["review_days"])).isoformat(),
        "ours": ours, "old": {**old, "ladder": ladder}, "posts": posts,
        "creators": {cid: _creator_card(by_id[cid], day)
                     for cid, day in joined.items()},
        "report": _report(ours, old, ladder, posts),
    }


def ops_ladder(world, summary, budget, seed, posts=None, categories=None, target=None, formats=None):
    """The ladder ops would set for this budget the old way (budget-aware gut feel), anchored on past
    posts like these (target creator size, same formats, same categories when there are any) and the
    usual number of posts in similar campaigns."""
    tiers = [p["tier"] for p in posts or []]
    target = target or (max(TIERS, key=tiers.count) if tiers else "micro")
    fmts = set(formats or ALL_FORMATS)
    like = lambda s: s[2] == target and s[3] in fmts
    seen = [v for s, vs in summary.segment_views.items() if like(s) and (not categories or s[0] in categories)
            for v in vs] or [v for s, vs in summary.segment_views.items() if like(s) for v in vs]
    mix = lambda s: s[3] in fmts and (not categories or s[0] in categories)
    everyone = [v for s, vs in summary.segment_views.items() if mix(s) for v in vs]
    similar = [c["campaign_id"] for c in world.campaigns if not categories or c["category"] in categories]
    per_campaign = sorted(len(world.posts_by_campaign.get(cid, [])) for cid in similar) or [10]
    return budget_ladder(random.Random(f"ops-{seed}"), world.params, target, seen, budget,
                         max(1, per_campaign[len(per_campaign) // 2]), everyone)


def typical_budget(world, categories, formats):
    """What similar past campaigns spent (median), to pre-fill the budget step."""
    fmts = set(formats or ALL_FORMATS)
    budgets = sorted(c["total_budget"] for c in world.campaigns
                     if (not categories or c["category"] in categories)
                     and any(p["format"] in fmts for p in world.posts_by_campaign.get(c["campaign_id"], [])))
    return budgets[len(budgets) // 2] if budgets else None


def _post(rng, P, person, day, days, fmts, season_path, n, state=None, boost=1.0):
    c = person["c"]
    mix = {f: w for f, w in P["format_mix"][c["platform"]].items() if f in fmts}
    fmt = rng.choices(list(mix), weights=list(mix.values()))[0]
    typical = typical_first_day(P, c, person["category"], fmt) * boost
    daily = grow_post(rng, P, typical, days - day, season_path, HISTORY_DAYS + day, state)
    organic = [int(round(x)) for x in daily]
    bought = 0
    if person["state"] == "cheating" and rng.random() < P["boost_chance"]:
        full = [int(round(x)) for x in add_bought(rng, P, daily)]
        bought, organic = sum(full) - sum(organic), full
    return {"post_id": f"N{n + 1:04d}", "creator_id": c["creator_id"], "category": person["category"],
            "platform": c["platform"], "tier": tier_of(c["follower_count"]), "format": fmt, "day": day,
            "daily": organic, "bought": bought}


def _creator_card(person, day):
    c = person["c"]
    return {"creator_id": c["creator_id"], "platform": c["platform"], "followers": c["follower_count"],
            "tier": tier_of(c["follower_count"]), "category": person["category"], "joined": day}


def _rs(x):
    return f"₹{x:,.0f}"


def _report(ours, old, ladder, posts):
    """The advertiser's results, all computed from the run (G24)."""
    genuine = ours["genuine_views"]
    cpm_ours = 1000 * ours["paid"] / genuine if genuine else None
    cpm_old = 1000 * old["paid"] / old["genuine_views"] if old["genuine_views"] else None
    fraud_posts = sum(1 for d in ours["posts"] if d["fraud"])
    cards = []
    if ours["regime"] == "plenty" and ours["reference"] and ours["price"] < ours["reference"]:
        cards.append({"kind": "cheaper", "text": "Lots of creators joined, so every view got cheaper for you."})
    scarce = max(0.0, ours["refund_thin"])           # liquidity rescue: the price settled below the pool
    unreached = max(0.0, ours["refund_between_rungs"])   # rung clearance: reach between two rungs is unpaid
    if scarce > 1:
        cards.append({"kind": "liquidity", "text": "Fewer views came in than your budget could buy, so we settled "
                      f"a lower price instead of letting a few creators take it all. {_rs(scarce)} of your budget came back."})
    if unreached > 1:
        cards.append({"kind": "rungs", "text": "Creators are paid for the milestone each post reached, and reach "
                      f"between two milestones isn't paid. {_rs(unreached)} of your budget came back."})
    if fraud_posts:
        cards.append({"kind": "fraud", "text": f"{fraud_posts} post{'s' if fraud_posts > 1 else ''} had bought views. "
                                               "You weren't charged for them."})
    cards.append({"kind": "budget", "text": "You never paid more than your budget."})
    return {
        "genuine_views": genuine, "cpm": cpm_ours, "old_cpm": cpm_old, "paid": ours["paid"],
        "old_paid": old["paid"], "old_over_budget": old["over_budget"], "money_back": max(0.0, ours["refund"]), "money_back_liquidity": scarce, "money_back_rungs": unreached,
        "fraud_blocked": ours["fraud_value_blocked"] if fraud_posts else 0.0, "fraud_posts": fraud_posts,
        "creators": len({p["creator_id"] for p in posts}), "posts": len(posts),
        "decisions_ours": 5, "decisions_old": 3 + 2 * len(ladder), "cards": cards,
    }


# --- Creator flow -------------------------------------------------------------------------------

_HANDLE_A = ("meme", "clip", "hype", "loop", "vibe", "chaos", "glitch", "desi", "reel", "pixel", "snack", "zoom")
_HANDLE_B = ("lord", "queen", "factory", "wala", "daily", "cult", "house", "nation", "vault", "lab", "zone", "club")


def handle(creator_id):
    rng = random.Random(creator_id)
    return f"@{rng.choice(_HANDLE_A)}{rng.choice(_HANDLE_B)}{rng.randint(1, 99)}"


def profiles(world, seed, n=6):
    rng = random.Random(f"profiles-{seed}")
    alive = [c for c in world.creators if CREATOR_STATES[world.creator_state[c["creator_id"]]] != "gone"]
    picks = []
    for tier in TIERS:
        pool = [c for c in alive if tier_of(c["follower_count"]) == tier]
        picks += rng.sample(pool, min(len(pool), 2 if tier in ("nano", "micro") else 1))
    picks.sort(key=lambda c: c["follower_count"])   # smallest to biggest, so every size is easy to spot
    return [{"creator_id": c["creator_id"], "handle": handle(c["creator_id"]), "platform": c["platform"],
             "followers": c["follower_count"], "tier": tier_of(c["follower_count"])} for c in picks[:n]]


def campaign_cards(world, summary, creator_id, seed):
    summary = realistic_summary(world, summary)
    c = world.creator_by_id[creator_id]
    rng = random.Random(f"cards-{seed}-{creator_id}")
    r = world.recipe
    cold_at = rng.randrange(3) if rng.random() < 0.5 else None   # now and then, a brand-new kind of campaign
    cards = []
    for i in range(3):
        cat = rng.choice(CATEGORIES)
        fmts = [f for f in ALL_FORMATS if PLATFORM_OF[f] == c["platform"]]
        days = rng.randint(r.duration_min, r.duration_max)
        typical = typical_budget(world, [cat], fmts) or r.budget_min
        budget = max(1000, int(round(typical * math.exp(rng.gauss(0, 0.5)), -3)))
        # Size the pool to the crowd: a first run tells us how many views this campaign draws, and the
        # pool is set near the market rate for them, so a creator's payout is worth playing for.
        probe = simulate(world, summary, [cat], fmts, budget, days, seed, cold_category=cat if i == cold_at else None, copies=1, realistic=True, join_creator=creator_id)
        ref, coins = probe["ours"]["reference"], probe["ours"]["coins"]
        if ref and coins:
            budget = max(5000, int(round(coins * ref * rng.uniform(0.9, 1.4), -2)))
        cards.append({"id": i, "category": cat, "formats": fmts, "platform": c["platform"], "budget": budget,
                      "days": days, "brand": f"{cat.title()} Brand {rng.randint(100, 999)}",
                      "cold": i == cold_at})
    return cards


def creator_run(world, summary, creator_id, card, seed):
    summary = realistic_summary(world, summary)
    sim = simulate(world, summary, [card["category"]], card["formats"], card["budget"], card["days"], seed,
                   copies=1, realistic=True, cold_category=card["category"] if card.get("cold") else None, join_creator=creator_id)
    mine = [d for d in sim["ours"]["posts"] if d["creator_id"] == creator_id]
    daily = {p["post_id"]: p["daily"] for p in sim["posts"] if p["creator_id"] == creator_id}
    segs = {"|".join((d["category"], d["platform"], d["tier"], d["format"])) for d in mine}
    groups = {(d["category"], d["format"]) for d in mine}
    events = [e for e in sim["ours"]["events"]
              if (e["kind"] == "cold_start" and "|".join(e["segment"]) in segs)
              or (e["kind"] == "fair_reach" and tuple(e["group"]) in groups)]
    return {**sim, "me": {"creator_id": creator_id, "handle": handle(creator_id),
                          "posts": [{**d, "daily": daily[d["post_id"]]} for d in mine],
                          "events": events, "paid": sum(d["paid"] for d in mine),
                          "coins": sum(d["rung_coins"] for d in mine)}}
