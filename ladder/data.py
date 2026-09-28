"""Saving and loading the generated world, plus the brief's four tables as CSV for anyone to inspect."""
import csv
import json
from pathlib import Path

from .world import World, generate

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
WORLD_FILE = "world.json"
TABLES = {
    "campaigns": ["campaign_id", "brand", "category", "platform", "total_budget", "start_date", "end_date",
                  "target_creator_tier"],
    "milestone_ladders": ["campaign_id", "milestone_rank", "view_threshold", "payout_amount"],
    "creators": ["creator_id", "platform", "follower_count", "tier", "account_age_months",
                 "historical_avg_views_per_post", "historical_completion_rate"],
    "posts": ["post_id", "campaign_id", "creator_id", "post_date", "platform", "format", "views_at_24h",
              "views_at_7d", "views_at_30d", "views_final", "total_payout_earned", "flagged_suspicious"],
}


def save(world, directory=DATA_DIR, flagged=None):
    """Write world.json (everything, incl. daily_views and hidden truth) and the brief's tables as CSV.
    `flagged`: post_ids our fraud check held, for the export's flagged_suspicious column."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / WORLD_FILE).write_text(json.dumps(world.to_dict()), encoding="utf-8")
    flagged = flagged or set()
    for name, cols in TABLES.items():
        rows = getattr(world, name)
        with open(directory / f"{name}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(cols)
            for r in rows:
                if name == "posts":
                    r = {**r, "flagged_suspicious": r["post_id"] in flagged}
                w.writerow([r[c] for c in cols])


def load(directory=DATA_DIR):
    path = Path(directory) / WORLD_FILE
    if not path.exists():
        return generate()
    return World.from_dict(json.loads(path.read_text(encoding="utf-8")))
