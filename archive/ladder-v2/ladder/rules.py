"""The payout rules themselves, shared by the builder, the settlement and the generator."""
import math


def fixed_payout(ladder, views):
    """Cumulative payout of a fixed (threshold, Rs) ladder: the amount at the highest rung reached."""
    paid = 0
    for rung in sorted(ladder, key=lambda r: r["view_threshold"]):
        if views >= rung["view_threshold"]:
            paid = rung["payout_amount"]
    return paid


def fixed_cleared(ladder, views):
    cleared = 0
    for rung in sorted(ladder, key=lambda r: r["view_threshold"]):
        if views >= rung["view_threshold"]:
            cleared = rung["view_threshold"]
    return cleared


def coins(views, threshold):
    """No rungs: a validated post mints one coin per view once it reaches the minimum threshold."""
    return int(views) if views >= threshold else 0


def rung_coins(views, rungs):
    """Coin rungs: a validated post mints the coins of the highest rung it reached (26K on a 20K rung
    mints 20K). `rungs` are rising view thresholds; the first is the minimum threshold."""
    cleared = 0
    for r in rungs:
        if views >= r:
            cleared = r
    return cleared


def settle(budget, minted, reference):
    """One price for every coin, decided only when the campaign resolves.

    pool      = budget / coins: what each coin would get if the whole budget were paid out.
    reference = the platform's market price per view (None before any history exists).

    Pool at or below the market: supply is plentiful, the budget binds, every rupee is paid out.
    Pool above the market: supply is thin. The price is the Nash bargaining split between the most
    the brand's pool allows and what creators' views fetch elsewhere on the platform, which under
    log utility is the geometric mean. The rest is refunded.
    """
    if minted <= 0:
        return 0.0, "empty"
    pool = budget / minted
    if reference is None:
        return pool, "cold start"
    if pool <= reference:
        return pool, "competitive"
    return math.sqrt(pool * reference), "thin"
