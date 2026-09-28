# Creator Pool

Given a new campaign's parameters, this outputs coin rungs for every creator tier × format (rung 1
is the minimum threshold) plus the market terms the campaign will settle on. The brand sets a budget
and, optionally, which categories, platforms and creator tiers it is for. Posts past the threshold
mint coins, either at the highest rung reached (coin rungs, the brief's ladder) or one per view (no
rungs); both are priced. The budget backs all coins, and one price per coin is found when the
campaign ends. There is no price cap, no guaranteed minimum, and nothing in pricing is simulated.
When too few views arrive, the price is the Nash split between the pool and the platform's market
reference, and the rest is refunded. A seeded simulator plays a new campaign out for demonstration.

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
python -m ladder backtest     # replay history under all three systems -> results/BACKTEST.md (~2s)
python -m unittest            # 29 invariant tests
python -m ladder serve        # web app on http://localhost:8000
```

The data and results are committed, so `serve` works straight after cloning.

## Create a campaign

```bash
python -m ladder build --budget 300000 --category gaming FMCG --platform instagram --tier nano micro
python -m ladder build --budget 1000          # nothing picked: open to every category, platform and tier
```

| Flag | Meaning |
|---|---|
| `--budget` | total budget in ₹: the most that can ever be paid |
| `--category` | any of gaming, FMCG, finance, D2C, entertainment; none = any |
| `--platform` | any of instagram, youtube; none = both |
| `--format` | which formats count: any of reel, carousel, short, long_form; none = all on the chosen platforms |
| `--tier` | who can join: any of nano, micro, mid, macro; none = every tier |
| `--start`, `--end` | optional dates (default: today, +30 days) |
| `--json` | full machine-readable output |

The output gives the market reference for each payout rule, the number of coins below which the
campaign counts as thin (and refunds), and the rungs per platform × tier × format.

## Simulate it

```bash
python -m ladder simulate --budget 300000 --category gaming --scenario thin --seed 42
```

Scenarios: `normal`, `crowded`, `thin`, `late_viral`, `fraud_wave`, `small_only`, `big_only`. The same
seed replays the same campaign; leave `--seed` out for a new one. Prints the settlement under both
payout rules and each creator's payout. A demo sandbox: pricing never reads it.

## Compare the three systems

```bash
echo '[[10000,500],[50000,2000],[100000,5000],[500000,15000]]' > brief_example.json
python -m ladder compare --campaign C035 --ladder brief_example.json
```

This replays that campaign's real posts under a status-quo ladder (the one you pass, applied the way
ops does today), our coin rungs, and no rungs.

## Web app

`python -m ladder serve`, then open http://localhost:8000.

- **Brand:** pick categories, platforms, formats and who can join (any number, or none), set a budget, and see
  the market reference, the rungs, and a checklist of the brief's five objectives. Everything updates as you choose. Then simulate the
  campaign: choose a scenario and a seed, and see the live coin value by day, the settlement under both
  payout rules, where the budget went, and every creator's payout.
- **Creator:** follow one simulated creator day by day: their posts climbing the rungs, the live coin
  value, and what they would be paid under each rule, ending in the final payout.
- **Backtest:** status quo vs coin rungs vs no rungs on 25 past campaigns.
- **Compare:** one past campaign paid three ways: the status quo (editable), our coin rungs, and no rungs.
- **Method:** the one-pager, methodology, discussion log and generated reports.

## Layout

| Path | Role |
|---|---|
| `ladder/config.py` | every tunable number with its reason (one policy choice) |
| `ladder/rules.py` | coins per view, coin rungs, settlement (competitive / thin / cold start), status-quo payouts |
| `ladder/market.py` | market reference from settled campaigns' pool splits |
| `ladder/builder.py` | campaign choices (multi-select), rungs per platform × tier × format, both payout rules |
| `ladder/simulate.py` | seeded day-by-day campaign sandbox with scenarios |
| `ladder/model.py` | lognormal view model per group, with measured fallback order |
| `ladder/settle.py` | replay a campaign: validate, mint, settle, refund |
| `ladder/fraud.py` | growth-curve detector with thresholds learned from clean posts |
| `ladder/generate.py` | synthetic campaigns, creators, posts, status-quo ladders, hidden fraud truth |
| `ladder/backtest.py` | leave-the-future-out replay, sensitivity, manual comparison |
| `ladder/validate.py` | calibration on unseen campaigns, recovery of hidden effects |
| `ladder/server.py`, `web/` | the web app (standard-library HTTP server, plain JS) |
| `tests/` | invariants: never over budget, one price per coin, rungs, choices, seeded simulation, no look-ahead, fraud |
| `archive/` | earlier designs: `cpi-market/` (price-discovery experiments), `ladder-v1/` (capped ladder) |

## Key assumption

The backtest replays the same posts under all three systems, so creator behaviour is held fixed. In a live
Creator Pool a high coin value would draw more creators in and dilute it. Nothing in the data measures
that, so the backtest compares money and reach, not behaviour.
