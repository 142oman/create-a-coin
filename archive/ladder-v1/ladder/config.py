"""Every tunable number in one place, each with the reason it has the value it has.

Only two values here are policy choices: STEP_CHANCE and BUDGET_CONFIDENCE. Everything else is
either given by the brief (tiers, categories, formats) or a statistical convention.
"""

# --- Policy choices (the only two) -------------------------------------------------------------

# Share of posts that reached one rung and go on to reach the next. The brief names two opposite
# failures: gaps so large creators give up (low chance) and gaps so small the ladder is trivially
# climbed and cheap to fake (high chance). With no data on how creators react to missing a rung,
# 0.5 is the neutral point. The backtest compares 0.4 / 0.5 / 0.6.
STEP_CHANCE = 0.5

# The brief asks for budget adherence "with a defined confidence level". The guaranteed minimum
# rate is set so total payout fits the budget in this share of simulated campaigns.
BUDGET_CONFIDENCE = 0.95

# --- Statistical conventions -------------------------------------------------------------------

# Fewer posts than this and a group's median and spread are unstable; widen the group instead.
MIN_GROUP_POSTS = 30

# Monte Carlo runs behind the guaranteed minimum. Measured on this data: 3,000 runs puts the 95th
# percentile within ~1% of a 40,000-run reference on average (4% worst case), well inside the
# model's own uncertainty, and keeps a ladder build under half a second.
SIMULATION_RUNS = 3000

# The detector calls a post suspicious only when it is more extreme than this share of known-clean
# posts on one signal (or beyond the 95th percentile on two at once), so roughly 1-2 clean posts in
# 100 are held for review by construction rather than by a hand-picked cutoff.
FRAUD_QUANTILE = 0.99

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

# Views are paid on the final count, read when the campaign settles. Settling this many days after
# the campaign ends gives every post at least 30 days: the last checkpoint in the brief's schema.
SETTLE_DAYS = 30

SEED = 7
