"""The payout rules themselves, shared by the builder, the settlement and the generator."""


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


def settled_rate(budget, cleared_views, min_rate, max_rate):
    """The brand's maximum while the budget covers it; the pool split below that; never under the
    guaranteed minimum."""
    if cleared_views <= 0:
        return max_rate
    return max(min_rate, min(max_rate, budget / cleared_views))
