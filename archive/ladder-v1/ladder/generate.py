"""Synthetic campaign history in the brief's four-table schema.

Every distributional assumption is a named constant below and is listed in docs/METHODOLOGY.md.
The ladder method is never told these numbers; validate.py checks that it recovers them from the
posts alone.
"""
import math
import random
from datetime import date, timedelta

from .config import CATEGORIES, FORMATS, SEED, TIER_BOUNDS, TIERS
from .data import Dataset
from .rules import fixed_payout

N_CAMPAIGNS = 40
N_CREATORS = 400

# How far content travels, relative to FMCG / Instagram / reel. Assumed, not measured.
CATEGORY_REACH = {"entertainment": 1.35, "gaming": 1.2, "FMCG": 1.0, "D2C": 0.85, "finance": 0.6}
PLATFORM_REACH = {"instagram": 1.0, "youtube": 1.15}
FORMAT_REACH = {"reel": 1.0, "carousel": 0.4, "short": 1.0, "long_form": 0.3}
FORMAT_MIX = {"instagram": {"reel": 0.75, "carousel": 0.25}, "youtube": {"short": 0.8, "long_form": 0.2}}
PLATFORM_MIX = {"instagram": 0.6, "youtube": 0.4}

# What brands in each category say a view is worth (Rs per 1,000 views). Synthetic.
CATEGORY_CPM = {"finance": 70, "D2C": 45, "gaming": 38, "FMCG": 35, "entertainment": 28}

CREATOR_TIER_MIX = {"nano": 0.42, "micro": 0.35, "mid": 0.18, "macro": 0.05}
TARGET_TIER_MIX = {"nano": 0.25, "micro": 0.4, "mid": 0.25, "macro": 0.1}
TARGET_BUDGET = {  # Rs, log-uniform range by the campaign's target tier
    "nano": (25_000, 75_000),
    "micro": (150_000, 450_000),
    "mid": (500_000, 1_500_000),
    "macro": (2_500_000, 7_500_000),
}
# Creators who join per Rs 1 lakh of budget. Smaller creators each cost less, so the same money
# draws more of them. The spread is how far a brand's budget sits from the reach it attracts.
CREATORS_PER_LAKH = {"nano": 80, "micro": 12, "mid": 2.4, "macro": 0.6}
BUDGET_FIT = (0.5, 1.8)

# Creators react to the ladder, as the brief describes. This is what makes history "contaminated":
#   * joining: creators weigh what the ladder offers up front (expected Rs per 1,000 views for a typical
#     creator like them); participation scales with that offer to this power, around a reference offer.
#   * quitting: after a post misses the first rung (seen at 7 days), a creator is less likely to post again.
PARTICIPATION_ELASTICITY = 0.6
OFFER_REFERENCE = 30.0
CONTINUE_IF_CLEARED, CONTINUE_IF_MISSED = 0.55, 0.2
MAX_POSTS = 5

# Typical views per post grow slower than followers: bigger pages reach a smaller share.
REACH_SCALE, REACH_EXPONENT = 4.0, 0.85
CREATOR_SIGMA = 0.35      # creator-to-creator quality spread (log scale)
POST_SIGMA = 0.85         # post-to-post spread for the same creator (log scale): heavy tail
VIRAL_SHARE = 0.02        # posts that break out, on top of the lognormal tail
VIRAL_BOOST = (math.log(6), 0.5)

FRAUD_CREATOR_SHARE = 0.08     # creators willing to buy views
FRAUD_POST_SHARE = 0.5         # of their posts, how many are boosted
BOUGHT_MULTIPLE = (1.0, 8.0)   # bought views as a multiple of the post's organic views
DRIP_SHARE = 0.3               # boosts spread over the first week instead of one burst: harder to see
LABEL_HIT = 0.85               # boosted posts that ops actually flagged
LABEL_FALSE_ALARM = 0.005      # clean posts flagged anyway: the label is only a rough proxy

# Old gut-feel ladders: round numbers by target tier, applied to everyone regardless of tier/format.
OLD_TEMPLATES = {
    "nano": [5_000, 10_000, 25_000, 50_000],
    "micro": [10_000, 50_000, 100_000, 500_000],
    "mid": [50_000, 100_000, 250_000, 500_000, 1_000_000],
    "macro": [100_000, 250_000, 500_000, 1_000_000, 2_500_000],
}

HISTORY_START = date(2024, 1, 1)
HISTORY_DAYS = 640


def _log_uniform(rng, lo, hi):
    return math.exp(rng.uniform(math.log(lo), math.log(hi)))


def _pick(rng, weights):
    return rng.choices(list(weights), weights=list(weights.values()))[0]


def _creators(rng):
    creators, hidden = [], {}
    for i in range(N_CREATORS):
        tier = _pick(rng, CREATOR_TIER_MIX)
        followers = int(_log_uniform(rng, *TIER_BOUNDS[tier]))
        quality = rng.lognormvariate(0, CREATOR_SIGMA)
        cheats = rng.random() < FRAUD_CREATOR_SHARE
        typical = REACH_SCALE * followers ** REACH_EXPONENT * quality
        # The platform reports a mean, and the mean of a lognormal sits above its median.
        avg = typical * math.exp(POST_SIGMA ** 2 / 2) * rng.lognormvariate(0, 0.15)
        completion = 0.5 + 0.3 * math.log(quality) + (0.15 if cheats else 0) + rng.gauss(0, 0.1)
        creator_id = f"CR{i + 1:04d}"
        creators.append({
            "creator_id": creator_id,
            "platform": _pick(rng, PLATFORM_MIX),
            "follower_count": followers,
            "tier": tier,
            "account_age_months": rng.randint(3, 96),
            "historical_avg_views_per_post": int(avg),
            "historical_completion_rate": round(min(0.97, max(0.03, completion)), 2),
        })
        hidden[creator_id] = {"typical": typical, "cheats": cheats}
    return creators, hidden


def _old_ladder(rng, campaign):
    thresholds = list(OLD_TEMPLATES[campaign["target_creator_tier"]])
    # Ops sometimes set the whole ladder too generous or too stingy relative to real reach.
    scale = rng.choice([0.5, 1, 1, 1, 2])
    if rng.random() < 0.3:
        thresholds.pop(rng.randrange(1, len(thresholds)))
    rate = rng.uniform(45, 140) / 1000  # Rs per view, from gut feel, blind to category
    ladder, payout = [], 0
    for rank, t in enumerate(thresholds, 1):
        views = int(t * scale)
        payout = max(payout + 100, round(views * rate * rng.uniform(0.6, 1.0) / 100) * 100)
        ladder.append({"campaign_id": campaign["campaign_id"], "milestone_rank": rank,
                       "view_threshold": views, "payout_amount": payout})
    return ladder


def _growth(rng):
    """Share of final views seen at 24h, 7d and 30d for an organic post."""
    f24 = min(0.75, max(0.08, rng.gauss(0.33, 0.1)))
    f7 = f24 + (1 - f24) * rng.uniform(0.45, 0.85)
    f30 = f7 + (1 - f7) * rng.uniform(0.6, 0.9)
    return f24, f7, f30


def _organic_views(rng, secret, reach, fmt):
    views = secret["typical"] * reach * FORMAT_REACH[fmt] * rng.lognormvariate(0, POST_SIGMA)
    if rng.random() < VIRAL_SHARE:
        views *= rng.lognormvariate(*VIRAL_BOOST)
    return views


def _offer(rng, campaign, ladder, pool, weights, hidden, reach, draws=400):
    """What the ladder is worth to a typical joiner, before anyone posts: Rs per 1,000 expected views."""
    paid = seen = 0.0
    for creator in rng.choices(pool, weights=weights, k=draws):
        fmt = _pick(rng, FORMAT_MIX[campaign["platform"]])
        views = _organic_views(rng, hidden[creator["creator_id"]], reach, fmt)
        paid += fixed_payout(ladder, views)
        seen += views
    return 1000 * paid / seen


def _posts(rng, campaign, ladder, creators, hidden, next_id):
    pool = [c for c in creators if c["platform"] == campaign["platform"]]
    target = campaign["target_creator_tier"]
    distance = {t: abs(TIERS.index(t) - TIERS.index(target)) for t in TIERS}
    tier_weight = {0: 0.5, 1: 0.2, 2: 0.05, 3: 0.02}
    reach = CATEGORY_REACH[campaign["category"]] * PLATFORM_REACH[campaign["platform"]]
    offer = _offer(random.Random(rng.random()), campaign, ladder, pool,
                   [tier_weight[distance[c["tier"]]] for c in pool], hidden, reach)
    per_lakh = CREATORS_PER_LAKH[target] * rng.uniform(*BUDGET_FIT)
    per_lakh *= (offer / OFFER_REFERENCE) ** PARTICIPATION_ELASTICITY
    n_creators = min(len(pool), round(campaign["total_budget"] / 100_000 * per_lakh))
    joined, candidates = [], list(pool)
    while len(joined) < n_creators and candidates:
        weights = [tier_weight[distance[c["tier"]]] for c in candidates]
        joined.append(candidates.pop(rng.choices(range(len(candidates)), weights=weights)[0]))

    start, end = date.fromisoformat(campaign["start_date"]), date.fromisoformat(campaign["end_date"])
    posts, truth = [], {}
    for creator in joined:
        secret = hidden[creator["creator_id"]]
        posted = start + timedelta(days=rng.randint(0, (end - start).days))
        for n_posts in range(1, MAX_POSTS + 1):
            if n_posts > 1:
                # The next post comes after the creator has seen how the last one did (day 7).
                posted += timedelta(days=rng.randint(7, 12))
                if posted > end:
                    break
            fmt = _pick(rng, FORMAT_MIX[campaign["platform"]])
            organic = _organic_views(rng, secret, reach, fmt)
            f24, f7, f30 = _growth(rng)
            bought, bought_24h = 0.0, 0.0
            if secret["cheats"] and rng.random() < FRAUD_POST_SHARE:
                bought = organic * rng.uniform(*BOUGHT_MULTIPLE)
                bought_24h = bought * (rng.uniform(0.25, 0.45) if rng.random() < DRIP_SHARE else 1.0)
            post_id = f"P{next_id + len(posts):05d}"
            flagged = rng.random() < (LABEL_HIT if bought else LABEL_FALSE_ALARM)
            posts.append({
                "post_id": post_id,
                "campaign_id": campaign["campaign_id"],
                "creator_id": creator["creator_id"],
                "post_date": posted.isoformat(),
                "platform": campaign["platform"],
                "format": fmt,
                "views_at_24h": int(organic * f24 + bought_24h),
                "views_at_7d": int(organic * f7 + bought),
                "views_at_30d": int(organic * f30 + bought),
                "views_final": int(organic + bought),
                "total_payout_earned": 0,
                "flagged_suspicious": flagged,
            })
            truth[post_id] = bought > 0
            # Did this post clear the first rung by day 7? Creators who miss it tend to give up.
            cleared = fixed_payout(ladder, organic * f7 + bought) > 0
            if rng.random() >= (CONTINUE_IF_CLEARED if cleared else CONTINUE_IF_MISSED):
                break
    return posts, truth, offer


def generate(seed=SEED):
    rng = random.Random(seed)
    creators, hidden = _creators(rng)
    starts = sorted(rng.randrange(HISTORY_DAYS) for _ in range(N_CAMPAIGNS))
    campaigns, ladders, posts, truth, true_offer = [], [], [], {}, {}
    for i, offset in enumerate(starts):
        category = rng.choice(CATEGORIES)
        target = _pick(rng, TARGET_TIER_MIX)
        start = HISTORY_START + timedelta(days=offset)
        campaign = {
            "campaign_id": f"C{i + 1:03d}",
            "brand": f"{category.title()} Brand {i + 1}",
            "category": category,
            "platform": _pick(rng, PLATFORM_MIX),
            "total_budget": int(round(_log_uniform(rng, *TARGET_BUDGET[target]), -4)),
            "start_date": start.isoformat(),
            "end_date": (start + timedelta(days=rng.randint(14, 45))).isoformat(),
            "target_creator_tier": target,
            "brand_max_cpm": round(CATEGORY_CPM[category] * rng.uniform(0.8, 1.3)),
        }
        ladder = _old_ladder(rng, campaign)
        new_posts, new_truth, offer = _posts(rng, campaign, ladder, creators, hidden, len(posts) + 1)
        true_offer[campaign["campaign_id"]] = offer
        for p in new_posts:
            # Status quo: pay the old ladder on final views; only ops-flagged posts are withheld.
            p["total_payout_earned"] = 0 if p["flagged_suspicious"] else fixed_payout(ladder, p["views_final"])
        campaigns.append(campaign)
        ladders.extend(ladder)
        posts.extend(new_posts)
        truth.update(new_truth)
    return Dataset(campaigns, ladders, creators, posts, truth, true_offer)
