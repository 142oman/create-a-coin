"""A new campaign played out after the generated history, with the same chains that made the history.

Used by the advertiser flow (Publish, "see how we'd handle...") and the creator flow. It is a
sandbox: pricing never reads it. Creators join day by day; a higher live coin value pulls more of
them in (built-in relation 5), which dilutes it again. The same posts are also paid the old way, by
a typical gut-feel ladder, so the report can show what the brand would have paid.
"""
import math
import random
from datetime import timedelta

from . import engine
from .config import ALL_FORMATS, CATEGORIES, HISTORY_DAYS, PLATFORM_OF, TIERS, tier_of
from .world import (CREATOR_STATES, POST_STATES, SEASONS, START, _step, add_bought, budget_ladder,
                    grow_post, pay_response, season_at, typical_first_day)

SCENARIOS = {
    "normal": {"label": "What usually happens", "join": 1.0},
    "crowded": {"label": "Too many creators", "join": 4.0},
    "thin": {"label": "Too few views", "join": 0.15},
    "fraud": {"label": "A fraud wave", "join": 1.0, "cheat": 0.4},
    "late_viral": {"label": "Viral on the last day", "join": 1.0, "late_viral": 25},
}


def _views_to(post, t):
    return sum(post["daily"][:max(0, t - post["day"])])


def simulate(world, summary, categories, formats, budget, days, seed=None, scenario="normal",
             cold_category=None, join_creator=None):
    if scenario not in SCENARIOS:
        raise ValueError(f"scenario must be one of {', '.join(SCENARIOS)}")
    budget, days = float(budget), int(days)
    if budget <= 0 or days < 1:
        raise ValueError("budget and duration must be positive")
    seed = int(seed) if seed not in (None, "") else random.randrange(1, 1_000_000)
    spec = SCENARIOS[scenario]
    cats = [c for c in (categories or []) if c in CATEGORIES] or list(CATEGORIES)
    fmts = [f for f in (formats or []) if f in ALL_FORMATS] or list(ALL_FORMATS)
    platforms = {PLATFORM_OF[f] for f in fmts}
    P = world.params
    rng = random.Random(f"sim-{seed}-{scenario}")
    used = summary.without_category(cold_category) if cold_category else summary
    reference, _ = used.reference(cats, fmts)
    season = SEASONS[season_at(world.season_path, HISTORY_DAYS)]

    people = []
    for c in world.creators:
        if c["platform"] not in platforms:
            continue
        st = _step(rng, P["creator_transitions"][world.creator_state[c["creator_id"]]])
        if spec.get("cheat") and rng.random() < spec["cheat"]:
            st = CREATOR_STATES.index("cheating")
        forced = c["creator_id"] == join_creator
        if CREATOR_STATES[st] == "gone" and not forced:
            continue
        fatigue = P["fatigued_factor"] if CREATOR_STATES[st] == "fatigued" else 1.0
        people.append({"c": c, "state": CREATOR_STATES[st], "fatigue": fatigue, "category": rng.choice(cats),
                       "forced_day": rng.randint(0, max(0, days // 5)) if forced else None})

    base_chance = P["join_chance"] * P["season_joining"][season] * spec["join"]
    posts, joined = [], {}
    for d in range(days):
        coins = sum(_views_to(p, d) for p in posts)
        live_price = engine.settle(budget, coins, reference)[0] if coins else None
        pull = 1.0 if live_price is None else pay_response(live_price, reference, P["pay_pull"])  # no price yet: neutral
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
                posts.append(_post(rng, P, person, day, days, fmts, world.season_path, len(posts)))
                if rng.random() >= P["keep_posting"] * person["fatigue"]:
                    break
                day += 1 + int(rng.expovariate(1 / P["gap_days"]))

    if spec.get("late_viral") and joined:
        cid = rng.choice(sorted(joined))
        person = next(p for p in people if p["c"]["creator_id"] == cid)
        post = _post(rng, P, person, days - 1, days, fmts, world.season_path, len(posts),
                     state=POST_STATES.index("viral"), boost=spec["late_viral"])
        post["late_viral"] = True
        posts.append(post)

    ours = engine.run(used, budget, days, posts, cats, fmts, with_timeline=True)
    ladder = ops_ladder(world, summary, budget, seed, posts, cats, formats=fmts)
    old = engine.old_way(ladder, budget, posts)
    start = START + timedelta(days=HISTORY_DAYS)
    end = start + timedelta(days=days - 1)
    return {
        "seed": seed, "scenario": scenario, "scenario_label": spec["label"], "days": days, "budget": budget,
        "categories": cats, "formats": fmts, "cold_category": cold_category,
        "starts_on": start.isoformat(), "ends_on": end.isoformat(),
        "settles_on": (end + timedelta(days=ours["review_days"])).isoformat(),
        "ours": ours, "old": {**old, "ladder": ladder}, "posts": posts,
        "creators": {cid: _creator_card(next(p for p in people if p["c"]["creator_id"] == cid), day)
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


def _report(ours, old, ladder, posts):
    """The advertiser's results, all computed from the run (G24)."""
    genuine = ours["genuine_views"]
    cpm_ours = 1000 * ours["paid"] / genuine if genuine else None
    cpm_old = 1000 * old["paid"] / old["genuine_views"] if old["genuine_views"] else None
    fraud_posts = sum(1 for d in ours["posts"] if d["fraud"])
    cards = []
    if ours["regime"] == "plenty" and ours["reference"] and ours["price"] < ours["reference"]:
        cards.append({"kind": "cheaper", "text": "Lots of creators joined, so every view got cheaper for you."})
    if ours["regime"] == "thin":
        cards.append({"kind": "refund", "text": "Fewer views came in than your budget could buy, so you paid a "
                                                "fair market price and got the rest back."})
    if fraud_posts:
        cards.append({"kind": "fraud", "text": f"{fraud_posts} post{'s' if fraud_posts > 1 else ''} had bought views. "
                                               "You weren't charged for them."})
    cards.append({"kind": "budget", "text": "You never paid more than your budget."})
    return {
        "genuine_views": genuine, "cpm": cpm_ours, "old_cpm": cpm_old, "paid": ours["paid"],
        "old_paid": old["paid"], "old_over_budget": old["over_budget"], "money_back": max(0.0, ours["refund"]),
        "fraud_blocked": ours["fraud_value_blocked"] if fraud_posts else 0.0, "fraud_posts": fraud_posts,
        "creators": len({p["creator_id"] for p in posts}), "posts": len(posts),
        "decisions_ours": 4, "decisions_old": 3 + 2 * len(ladder), "cards": cards,
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
    rng.shuffle(picks)
    return [{"creator_id": c["creator_id"], "handle": handle(c["creator_id"]), "platform": c["platform"],
             "followers": c["follower_count"], "tier": tier_of(c["follower_count"])} for c in picks[:n]]


def campaign_cards(world, creator_id, seed):
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
        cards.append({"id": i, "category": cat, "formats": fmts, "platform": c["platform"], "budget": budget,
                      "days": days, "brand": f"{cat.title()} Brand {rng.randint(100, 999)}",
                      "cold": i == cold_at})
    return cards


def creator_run(world, summary, creator_id, card, seed):
    sim = simulate(world, summary, [card["category"]], card["formats"], card["budget"], card["days"], seed,
                   cold_category=card["category"] if card.get("cold") else None, join_creator=creator_id)
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
