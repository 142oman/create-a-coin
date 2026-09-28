"""Every tunable number in one place, each with the reason it has the value it has.

Two values here are policy choices: QUALIFY_REACH and STEP_CHANCE. Everything else is given by the
brief (tiers, categories, formats) or is a named statistical convention. There is no price cap, no
price floor, and nothing in pricing is simulated: the price of a view is decided by the campaign's
own market at settlement.
"""

# --- Policy choices ------------------------------------------------------------------------------

# The minimum threshold is the view count reached by this share of posts like yours. Below it a post
# earns nothing: it keeps duds and spam out of the pool. In a pool a weak post adds few coins, so the
# bar only needs to exclude the bottom of the distribution. Measured on the backtest: moving from 50%
# to 80% qualifying pays 27 more creators in 100 and lowers the coin value by only 17%.
QUALIFY_REACH = 0.8

# Coin rungs above the threshold: each is reached by this share of the posts on the rung below. The
# brief names two failures, gaps so large creators give up and so small the ladder is cheap to climb;
# with no data on how creators react, 0.5 is the neutral point.
STEP_CHANCE = 0.5

# --- Conventions -------------------------------------------------------------------------------

# Rungs per ladder: the threshold plus four above it, the same count as the brief's example ladder.
RUNGS = 5

# Fewer posts than this and a group's median and spread are unstable; widen the group instead.
MIN_GROUP_POSTS = 30

# Fewer settled campaigns than this in a category and the market reference widens to the platform,
# then to all campaigns. With none at all, the campaign settles at the pure pool split.
MIN_REFERENCE_CAMPAIGNS = 5

# The detector calls a post suspicious only when it is more extreme than this share of known-clean
# posts on one signal (or beyond the 95th percentile on two at once), so roughly 1-2 clean posts in
# 100 are held for review by construction rather than by a hand-picked cutoff.
FRAUD_QUANTILE = 0.99

# Held posts: when the campaign ends with posts still under fraud review, settlement waits at most
# this many days. Nobody is paid before the price is final, so a post cleared late never needs a
# second payout at a different price. A post not cleared by the deadline counts as fraud: the flagged
# creator carries the burden of showing the views are real. A week is long enough to request
# analytics from a creator and short enough that honest creators are not kept waiting.
REVIEW_DAYS = 7

# --- Given by the brief --------------------------------------------------------------------------

TIERS = ("nano", "micro", "mid", "macro")
TIER_BOUNDS = {  # followers, as defined in the brief's campaigns table
    "nano": (1_000, 10_000),
    "micro": (10_000, 100_000),
    "mid": (100_000, 1_000_000),
    "macro": (1_000_000, 10_000_000),
}
CATEGORIES = ("gaming", "FMCG", "finance", "D2C", "entertainment")
PLATFORMS = ("instagram", "youtube")
FORMATS = {"instagram": ("reel", "carousel"), "youtube": ("short", "long_form")}

SEED = 7
