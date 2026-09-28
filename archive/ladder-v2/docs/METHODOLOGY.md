# Methodology: Creator Pool, a coin pool for milestone campaigns

## 1. What "optimized" means here

A milestone ladder has to answer two questions: **what is a view worth**, and **which posts get
paid, and for how much of their reach**. Today ops answers both by gut feel. We answer them separately:

- **What a view is worth is not decided by anyone.** The brand commits a budget, creators deliver
  views, and one price per coin is found when the campaign ends. No cap, no guaranteed minimum, no
  declared price. Nothing in pricing is simulated.
- **Which posts get paid** is decided by rungs placed from past posts, per creator tier and format.
  Rung 1 is the minimum threshold. We price two payout rules on the same rungs:
  - **Coin rungs** (the brief's ladder): a post mints the coins of the highest rung it reached.
  - **No rungs**: a post past the threshold mints one coin per view; the rungs above are targets only.

"Optimized" therefore means, in priority order:

1. **The budget can never be exceeded.** Not with 95% confidence: in every outcome, by construction.
2. **Every coin is paid the same, market-set price.** No brand can underpay by declaring a low rate.
3. **Every tier has the same odds** at every rung, and duds cannot grind the pool.
4. **Bought views are not paid.**
5. **When supply is thin, the brand is not charged the whole pool** for a handful of views.

## 2. The mechanism

### 2.1 What the brand chooses, and what each choice does

Every choice is multi-select. Picking none means "any".

| Choice | Effect in the algorithm |
|---|---|
| Category | Each chosen category gets its own rungs, from past posts in that category (gaming travels further than finance); together they pick which past campaigns set the market reference |
| Platform | Which formats exist (reel / carousel on Instagram, short / long-form on YouTube); each format gets its own rungs |
| Format | Which kinds of post count (reel, carousel, short, long-form); each gets its own rungs, and simulated creators only post in them. Only formats with past view data are offered |
| Who can join | Which creator tiers may take part; each tier that can join gets its own rungs |
| Budget | Only what a coin is worth, and how many coins separate a thin campaign from a plentiful one |
| Dates | Only when settlement happens |

Stories, static posts and YouTube community posts are not offered: the history has no views for
them (stories expire in 24 hours, and community posts show no public view count), so their rungs would
be invented. They can be added once real data exists. The market reference is still read from all
formats of past campaigns in the chosen categories and platforms.

### 2.2 Coins

A validated post that reaches its threshold mints coins (at its rung, or per view). The budget `B`
backs all coins minted, `M`. The more coins arrive, the less each is worth. Nothing is paid until
the campaign ends.

```
pool split  = B / M          what a coin gets if the whole budget is paid out
```

### 2.3 The market reference

`p_ref` is what a coin fetches on this platform: the **median pool split of past campaigns** in the
same categories and platforms (widened to same category, same platform, then all, when fewer than 5
settled campaigns exist). Each past pool split is recomputed under today's rungs, counting only
validated posts, **separately for each payout rule**, because coin rungs mint fewer coins for the
same views.

- It is read from real settlements, not simulated, and moves as each campaign settles.
- It is per coin, so a ₹1,000 and a ₹3 crore campaign are compared on the same footing.
- With no settled campaigns at all, a campaign settles at the pure pool split.

### 2.4 Settlement: one price per coin

```
if B/M ≤ p_ref:   price = B/M               plenty of views: the whole budget is paid out
if B/M > p_ref:   price = √(B/M · p_ref)    too few views: Nash split, the rest is refunded
paid   = price × M
refund = B − paid
```

- **Plenty of views.** The budget binds; every rupee goes to creators, split over every coin.
- **Too few views.** Paying the whole pool would pay far above what views fetch anywhere else.
  Brand and creators bargain over the range between the pool (the most the brand's money allows)
  and the market (what creators' views earn elsewhere). The Nash bargaining solution with equal
  power and log utility is the geometric mean. The difference goes back to the brand.

**Why this is the price and not a guess.** Neither side declares a number, so neither can misstate
one. The brand's only input is its budget (real money); the creator's only input is views (real,
fraud-checked). `p_ref` is market-wide and neither side controls it. No mechanism can make every
stated valuation correct: the Myerson–Satterthwaite theorem (1983) shows trading mechanisms cannot be
efficient, truthful, voluntary and budget-balanced all at once. The defensible target is a
mechanism where nobody has a number to misstate.

**How this relates to ad platforms.** Meta's "Highest volume" and Google's "Maximize conversions"
take only a budget and spend all of it; the price per result is what falls out, `B/M`. They guard
thin auctions with reserve prices learned from their own history. `p_ref` plays that role here, as a
bargaining reference rather than a floor.

**A worked extreme.** ₹50,000 budget, only 1,000 coins, market ₹40 per 1,000. Pool split is ₹50,000
per 1,000. The Nash split pays √(50 × 0.04) = ₹1.41 per coin, ₹1,414 in total, and refunds ₹48,586.
Creators get 35× the market as a scarcity premium; the brand gets 97% back.

**What the live value does.** While the campaign runs, creators see what a coin would settle at if
the campaign ended now. Above the market, the campaign pulls creators in and the value falls; below
it, fewer join. A viral post on the last day is simply more coins: it dilutes everyone, because it
delivered those views, and the budget still cannot be exceeded.

### 2.5 Rungs

Views per post are heavy-tailed, so **log(views)** is modelled as a normal distribution per group
(`category × platform × tier × format`; a campaign open to several categories gets rungs for each), from past posts ops did not flag. Each creator-campaign
counts once, so creators who kept posting are not over-represented.

```
rung 1 (threshold) = reached by 80% of posts like yours
rung k             = reached by 50% of the posts that reached rung k−1     (40%, 20%, 10%, 5%)
coins at rung k    = rung k's views
```

- **Why a threshold at 80%.** It only has to keep duds and spam out: in a pool a weak post adds few
  coins, so a high bar buys little. Measured on the backtest, moving from a 50% to an 80% threshold
  pays 27 more creators in 100 and lowers the no-rung coin value by only 17%. Below it a post earns
  nothing under either rule. This is one of two policy choices; §4.4 shows 70% and 90%.
- **Why each next rung at 50%.** The brief names two opposite failures: gaps so large creators give
  up, and so small the ladder is cheap to climb. With no data on how creators react to missing a
  rung, halving is the neutral point.
- **Why five rungs.** The brief's example has four or five. Under no-rungs pay the count changes
  nothing; under coin rungs the top rung caps what a post can earn.
- **Coin rungs vs no rungs.** Rounding down to a rung does not save the brand money when plenty of
  views arrive: the whole budget is paid either way. It moves money from views between rungs to
  posts that crossed a higher rung. When views are thin, rungs mint fewer coins, which changes the
  refund.
- **Budget does not enter.** Rungs depend on how far posts like yours travel. A ₹1,000 and a ₹3 crore
  campaign ask a nano reel for the same views; the budget changes only the coin's value.
- **Thin groups and cold start.** A group with fewer than 30 clean posts is widened one factor at a
  time, dropping first whichever factor moves views least **in the data**. Tier is never dropped.
  Every ladder reports which group it came from, and the brand page shows the full calculation per
  tier (posts used, typical post, spread, and median × e^(σ·z) for each rung). In this data many
  category groups are too small and widen, which is why, for example, finance often shares rungs
  with the platform-wide group.
- **Answer to "why 250K and not 200K?"** Because that many views is what 1 in 10 posts like this
  reach, and half of those reaching the rung below. Moving it breaks the halving.

### 2.6 Fraud

1. **Detection from the growth curve.** Bought views arrive in a burst and stop, so a boosted post is
   unusually front-loaded (24h ÷ 7d views) and unusually large for the account. Thresholds are
   learned from clean posts (99th percentile on one signal, 95th on both).
2. **Payment is held until validated, with a deadline.** A post flagged by ops or the detector mints
   no coins until it is reviewed, and its coins are left out of the live coin value. If any post is
   still held when the campaign ends, settlement waits up to **7 days** for the review, and nobody is
   paid before then. That is deliberate: if others were paid first, a post cleared later would change
   the coin price after the money had gone. Each held post is marked:
   - **valid**: the post's coins count, at the same price as everyone else's;
   - **fraud**: never paid.

   A post not cleared by the deadline counts as fraud: the flagged creator carries the burden of
   showing the views are real.

   Every decision moves everyone's pay. When plenty of views arrive, clearing a post adds coins, so
   each coin is worth less and other creators get less. When too few arrive, it changes the refund.
   The web page (brand and creator views) lets you mark each held post valid or fraud and shows that effect.
   The backtest has no reviewer, so it treats every held post as not cleared, which is the strict
   reading. That is why it withholds 18 clean posts.
   **How a post gets flagged:** over 70% of its first-week views arrived in the first 24 hours (1 in
   100 clean posts do that; boosted posts median 86%, clean 44%), or over 62% did **and** it got more
   than 2.5× the creator's usual views. Views alone never flag a post: a small creator's genuine
   viral post usually keeps growing through the week and passes. In the data, 6 of 75 genuine posts
   above 2.5× their creator's usual were held. The weak spot is a real meme that spikes on day one and
   dies, which looks like bought views; review, not automatic rejection, is the answer to that.
3. **The pool itself.** One price per coin, so splitting activity across accounts earns nothing
   extra, and confirmed bought views never dilute honest creators.
4. **Data we would want in production:** engagement relative to views, viewer geography, the
   platform's paid-promotion flag, co-engagement between accounts, follower history.

### 2.7 The simulation sandbox

The brand page can play a new campaign out day by day (`ladder/simulate.py`, `python -m ladder
simulate`). **Pricing never reads it**; it exists to show how settlement and payouts behave.

- **One seed** drives every random draw: the same seed replays the same campaign, a new seed a new one.
- **Creators** are drawn from past creator profiles (tier, platform) among those allowed to join.
  Each makes content in one of the campaign's categories, and qualifies against that category's
  rungs. Their posts' views come from the same view model the rungs use, with 2% viral posts. Fraud follows the
  generator's pattern, and caught posts use the backtest's measured catch rate (94%).
- **Scenarios:** normal, too many join, too few join, viral on the last day, fraud wave, only small
  creators, only big creators. Each changes how many views arrive relative to the market reference,
  who arrives, or what goes wrong.
- **Settlement is on the last day** and counts each post's views by then, so a last-day post has one
  day of views.
- **Scenarios are counted in views, not creators:** one macro creator can supply as much as fifty
  nano ones, so creator counts vary widely between seeds.
- **Playback:** a run auto-plays day by day (pause, 1–4× speed, scrubber) on the brand and creator pages.
- **Output:** the live coin value each day under both rules, the settlement, where the budget went by
  tier, every creator's payout under both rules, and a creator view that follows one creator
  through the campaign.

## 3. Assumptions baked into the synthetic data

The mechanism uses none of these. It reads only budgets, views and settled campaigns. They matter
for the backtest and the sandbox. The generator (`ladder/generate.py`) is seeded.

| What | Assumed |
|---|---|
| Size | 40 campaigns, 400 creators, ~2,800 posts |
| Tiers (brief's bands) | 42% nano, 35% micro, 18% mid, 5% macro |
| Views of a typical post | 4 × followers^0.85 × creator quality (lognormal σ 0.35) |
| Post-to-post spread | lognormal σ 0.85, plus 2% viral posts × ~6 (so the model is slightly wrong on purpose) |
| Category reach | entertainment 1.35, gaming 1.2, FMCG 1.0, D2C 0.85, finance 0.6 |
| Format reach | reel/short 1.0, carousel 0.4, long-form 0.3 |
| Fraud | 8% of creators; half their posts buy 1–8× organic views; 30% dripped over a week |
| Ops label | catches 85% of boosted posts, flags 0.5% of clean ones |
| Participation | creators per ₹1 lakh by target tier, scaled by how generous the old ladder was |
| Status-quo ladders | round-number templates by target tier, the same for everyone, randomly scaled by "gut feel" |

## 4. Results (full tables: `results/BACKTEST.md`)

### 4.1 Setup
All 25 campaigns with at least 12 campaigns ended before them. Rungs and market references are
rebuilt from those earlier campaigns only. The same real posts are replayed three ways.

### 4.2 Headline

| | Status quo | Coin rungs | No rungs |
|---|---:|---:|---:|
| Within budget | 21 / 25 | **25 / 25** | **25 / 25** |
| Worst overspend | 164% | **0%** | **0%** |
| Creators paid anything | 53% | 79% | 79% |
| Views on paid posts that earned nothing | 46% | 34% | **0%** |
| Paid to bought views | ₹3,800 | ₹2,762 | ₹3,210 |
| Too few views (refunded) | – | 13 campaigns, ₹14.1 lakh | 12 campaigns, ₹13.4 lakh |
| Median paid per 1,000 real views | ₹34.7 | ₹72.9 | ₹70.9 |

**Paid more or less than actual?** More: about ₹1.60 crore against ₹1.17 crore. Gut-feel ladders
often paid out a fraction of the budget; Creator Pool pays out what the brand committed whenever
views are plentiful.

### 4.3 Fairness: creators paid, by tier

| Tier | Status quo | Coin rungs / no rungs |
|---|---:|---:|
| nano | 21% | 75% |
| micro | 49% | 80% |
| mid | 89% | 80% |
| macro | 100% | 90% (30 creators) |

### 4.4 Sensitivity: where the threshold sits

| Posts reaching it | Creators paid | Median coin price, coin rungs | Median coin price, no rungs |
|---:|---:|---:|---:|
| 70% | 70% | ₹140.3 | ₹106.5 |
| **80%** | **79%** | **₹146.7** | **₹101.0** |
| 90% | 88% | ₹155.2 | ₹94.7 |

Coin rungs price each coin higher because they mint fewer coins for the same views. The budget holds
in every case.

### 4.5 Fraud
Label or detector catches 44 of 47 boosted posts (94%), holding 24 clean posts for review.

## 5. Validation of the view model (`results/VALIDATION.md`)

Fitted on the earlier 70% of campaigns, tested on later ones: the threshold is predicted to be
reached by 80.2% of posts and actually is by 80.5%; rung 5 predicted 5.0%, actual 4.8%. The model
also recovers the hidden category and format effects from posts alone (e.g. finance 0.67× estimated
vs 0.60× hidden).

## 6. Limits

- **Behaviour is held fixed in the backtest.** Creator Pool's main self-correction, a high live
  value drawing creators in, cannot appear in a replay. The sandbox shows scenarios, not a forecast.
- **Creators carry price risk.** With no floor, a crowded campaign can pay less per view than a
  creator hoped. That is how ad markets behave, and the live value is shown throughout.
- **Settling on the last day** means a post made near the end counts only the views it has by then.
- **Not strategy-proof for creators in thin markets.** If creators collectively hold back, the pool
  split rises and so does the Nash split. Coordinating that across many independent creators is hard.
- **The reference needs history.** Early on it is wide; with none the campaign settles at the pool.
- **Smart fraud** that imitates organic growth can slip through; engagement data would close the gap.
- **Everything here is synthetic.** The next step is running it alongside live campaigns.

## 7. Earlier designs (archived)

- `archive/cpi-market/`: an earlier price-discovery engine that tested holdout-based clocks, a
  geometric kernel and a cross-campaign supply curve. It established that a single campaign cannot
  price itself from minting alone, and that a brand-declared price must never enter the settlement.
- `archive/ladder-v1/`: the previous milestone design with a brand maximum CPM, a Monte Carlo
  guaranteed minimum, a running tally with early close and payment 30 days after the campaign ended.
  It was replaced because a cap lets brands underpay, a minimum rewards low-effort posts, and the
  simulation behind it rested on our own assumptions.
