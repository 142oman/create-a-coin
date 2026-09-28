# Milestone Ladder

Given a new campaign's parameters, this outputs creator payout ladders (view threshold → ₹ payout)
that stay within budget with 95% confidence, give every creator tier the same odds, pay the same
rate for every view, and withhold payment from bought views.

| Deliverable | Where |
|---|---|
| A. Methodology write-up | [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) |
| B. Working code | [`ladder/`](ladder) (Python 3.10+, standard library only) |
| C. Backtest results | [`results/BACKTEST.md`](results/BACKTEST.md), model checks in [`results/VALIDATION.md`](results/VALIDATION.md) |
| D. One-pager | [`docs/ONE_PAGER.md`](docs/ONE_PAGER.md) |
| Synthetic data + generator | [`data/`](data) (JSON), [`ladder/generate.py`](ladder/generate.py) |
| Design discussion log | [`docs/DISCUSSION.md`](docs/DISCUSSION.md) |

## Setup

Python 3.10 or newer. No packages to install.

```bash
python -m ladder generate     # synthetic data -> data/*.json (seeded, reproducible)
python -m ladder validate     # view-model checks -> results/VALIDATION.md
python -m ladder backtest     # replay history under both ladders -> results/BACKTEST.md (~20s)
python -m unittest            # 15 invariant tests
python -m ladder serve        # web app on http://localhost:8000
```

The data and results are committed, so `serve` works straight after cloning.

## Build a ladder for a new campaign

```bash
python -m ladder build --category gaming --platform instagram --budget 300000 --max-cpm 40 --tier micro
```

| Flag | Meaning |
|---|---|
| `--category` | gaming, FMCG, finance, D2C, entertainment |
| `--platform` | instagram, youtube |
| `--budget` | total budget in ₹ |
| `--max-cpm` | the most the brand pays per 1,000 views (₹), a hard ceiling |
| `--tier` | target creator tier: nano, micro, mid, macro |
| `--start`, `--end` | optional dates (default: today, +30 days) |
| `--json` | full machine-readable output |

The output gives one ladder per creator tier × format. Each rung shows its views, the share of posts
expected to reach it, and the guaranteed-to-maximum payout.

## Score a hand-made ladder

```bash
echo '[[10000,500],[50000,2000],[100000,5000],[500000,15000]]' > brief_example.json
python -m ladder compare --campaign C035 --ladder brief_example.json
```

This replays that campaign's real posts under the ladder actually used, yours, and ours.

## Web app

`python -m ladder serve`, then open http://localhost:8000.

- **Build:** enter a campaign and get its ladders, price band and budget simulation.
- **Backtest:** the headline numbers, fairness by tier, spend vs budget for every campaign, five
  campaigns in detail, sensitivity and fraud results.
- **Compare:** edit a ladder by hand and score it on any past campaign.
- **Method:** the one-pager, methodology, discussion log and generated reports.

## Layout

| Path | Role |
|---|---|
| `ladder/config.py` | every tunable number, with its reason (only two are policy choices) |
| `ladder/generate.py` | synthetic campaigns, creators, posts, status-quo ladders, hidden fraud truth |
| `ladder/model.py` | lognormal view model per group, with measured fallback order |
| `ladder/builder.py` | rung placement, participation forecast, Monte Carlo minimum, lowball check |
| `ladder/settle.py` | running budget tally, early close, fraud hold, settlement and refund |
| `ladder/fraud.py` | growth-curve detector with thresholds learned from clean posts |
| `ladder/backtest.py` | leave-the-future-out replay, sensitivity, manual comparison |
| `ladder/validate.py` | calibration on unseen campaigns, recovery of hidden effects |
| `ladder/server.py`, `web/` | the web app (standard-library HTTP server, plain JS) |
| `tests/` | invariants: rung odds, rounding down, budget identity, no look-ahead, fraud rates |
| `archive/cpi-market/` | an earlier price-discovery approach; see METHODOLOGY §7 |

## Key assumption

The backtest replays the same posts under both ladders, so creator behaviour is held fixed. A
different ladder would change who joins and how much they post. Nothing in the data measures that,
so the backtest compares money and reach, not behaviour.
