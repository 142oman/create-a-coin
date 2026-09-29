"""Every fixed number in one place, with the reason it has the value it has.

Policy choices are few and named. Everything about the market itself (how posts grow, how creators
behave, how generous old ladders were) is not here: it is drawn at random by `world.py` from the
recipe, so no market "fact" is hand-set.
"""

NAME = "Clearing"

# --- Policy choices ------------------------------------------------------------------------------

# Rung 1 (the minimum threshold) sits at the views this share of past posts like yours reached.
# In a pool a weak post adds few coins, so the bar only has to keep duds out.
QUALIFY_REACH = 0.8

# Each further rung is reached by this share of the posts that reached the rung below: the neutral
# point between "too far to chase" and "too cheap to climb".
STEP_CHANCE = 0.5

# Rungs per ladder: the threshold plus seven. More rungs leave less of a post's reach between two
# rungs (unpaid, so refunded), at the price of a longer ladder than the brief's five-rung example.
RUNGS = 8

# Held posts: settlement waits at most this many days for review. Nobody is paid before the price is
# final. A post not cleared by then counts as fraud (the flagged creator must show the views are real).
REVIEW_DAYS = 7

# Fair Reach: rungs are re-checked at these points of the campaign, never daily (young posts would
# look like a slump every day, and 30 daily tests make a false alarm likely).
CHECKS = (0.25, 0.5, 0.75)

# Overall confidence for Fair Reach across all checks; each check uses an equal share of the error.
CONFIDENCE = 0.95

# Fraud check: a post is held when its drop after the peak is sharper than this share of past posts,
# or sharper than the lower share *and* it is bigger than that share of the creator's usual.
HOLD_ALONE, HOLD_TOGETHER = 0.99, 0.95

# --- Given by the brief --------------------------------------------------------------------------

TIERS = ("nano", "micro", "mid", "macro")
TIER_BOUNDS = {"nano": (1_000, 10_000), "micro": (10_000, 100_000),
               "mid": (100_000, 1_000_000), "macro": (1_000_000, 10_000_000)}
CATEGORIES = ("gaming", "FMCG", "finance", "D2C", "entertainment")
PLATFORMS = ("instagram", "youtube")
FORMATS = {"instagram": ("reel", "carousel"), "youtube": ("short", "long_form")}
PLATFORM_OF = {f: p for p, fs in FORMATS.items() for f in fs}
ALL_FORMATS = tuple(PLATFORM_OF)

# --- World size (fixed; the recipe changes behaviour, not size) ----------------------------------
N_CREATORS = 500
N_CAMPAIGNS = 120
HISTORY_DAYS = 720


def tier_of(followers):
    for tier, (_, hi) in TIER_BOUNDS.items():
        if followers < hi:
            return tier
    return "macro"
