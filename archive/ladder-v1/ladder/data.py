"""The four tables from the brief, stored as JSON files, plus the generator's hidden truth."""
import json
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from .config import SETTLE_DAYS

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TABLES = ("campaigns", "milestone_ladders", "creators", "posts")
TRUTH_FILE = "generator_truth.json"


def day(value):
    return value if isinstance(value, date) else date.fromisoformat(value)


@dataclass
class Dataset:
    campaigns: list
    milestone_ladders: list
    creators: list
    posts: list
    # The generator's hidden truth. Used only to score the method, never as an input to it.
    truth: dict = field(default_factory=dict)        # post_id -> did this post buy views?
    true_offer: dict = field(default_factory=dict)   # campaign_id -> what its ladder really offered (Rs/1K views)

    def __post_init__(self):
        self.creator_by_id = {c["creator_id"]: c for c in self.creators}
        self.campaign_by_id = {c["campaign_id"]: c for c in self.campaigns}
        self.posts_by_campaign = {}
        for p in self.posts:
            self.posts_by_campaign.setdefault(p["campaign_id"], []).append(p)
        self.ladder_by_campaign = {}
        for rung in sorted(self.milestone_ladders, key=lambda r: r["milestone_rank"]):
            self.ladder_by_campaign.setdefault(rung["campaign_id"], []).append(rung)

    def tier_of(self, post):
        return self.creator_by_id[post["creator_id"]]["tier"]

    def before(self, cutoff):
        """Only campaigns fully settled before `cutoff`: what a planner would actually know then."""
        cutoff = day(cutoff)
        known = [c for c in self.campaigns
                 if day(c["end_date"]) + timedelta(days=SETTLE_DAYS) < cutoff]
        ids = {c["campaign_id"] for c in known}
        return Dataset(
            campaigns=known,
            milestone_ladders=[r for r in self.milestone_ladders if r["campaign_id"] in ids],
            creators=self.creators,
            posts=[p for p in self.posts if p["campaign_id"] in ids],
            truth=self.truth,
            true_offer=self.true_offer,
        )


def save(dataset, directory=DATA_DIR):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for name in TABLES:
        (directory / f"{name}.json").write_text(json.dumps(getattr(dataset, name), indent=1), encoding="utf-8")
    hidden = {"bought_views": dataset.truth, "offer_cpm": dataset.true_offer}
    (directory / TRUTH_FILE).write_text(json.dumps(hidden), encoding="utf-8")


def load(directory=DATA_DIR):
    directory = Path(directory)
    if not (directory / "posts.json").exists():
        raise FileNotFoundError(f"No data in {directory}. Run: python -m ladder generate")
    tables = {name: json.loads((directory / f"{name}.json").read_text(encoding="utf-8")) for name in TABLES}
    truth_path = directory / TRUTH_FILE
    hidden = json.loads(truth_path.read_text(encoding="utf-8")) if truth_path.exists() else {}
    return Dataset(**tables, truth=hidden.get("bought_views", {}), true_offer=hidden.get("offer_cpm", {}))
