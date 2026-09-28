# Methodology: milestone ladders for creator campaigns

## 1. What "optimized" means here

A ladder is **optimized** when, in priority order:

1. **The budget holds with 95% confidence.** Total payout fits the brand's budget in at least 95% of
   simulated versions of the campaign, and a rule enforces it for the other 5%. This is a hard
   constraint, not a goal to trade off. *(Budget adherence)*
2. **The brand never pays more per view than it said a view is worth.** The brand sets a maximum
   price per 1,000 views; payouts never exceed it. *(Marginal ROI)*
3. **Every creator tier has the same odds of reaching each rung.** A 5K-follower page and a
   500K-follower page each have a 50% chance of clearing their first rung with a normal post.
   *(Fairness across tiers)*
4. **Gaps are neither too far to chase nor too cheap to fake.** Each rung is reached by half of the
   posts that reached the previous one. *(Creator motivation)*
5. **Bought views don't get paid.** Posts are paid once, at the end, after a growth-curve check.
   *(Fraud resistance)*

Why this order: budget overruns are what the brand notices first and what ends the relationship, so
they come first and are enforced by a rule, not a forecast. ROI comes next because it defines what
"too much" means per view. Fairness and motivation are how the money is distributed *within* those two
limits. Fraud control protects all of them.

**What we deliberately gave up:** overall milestone completion drops slightly (62% → 57% in the
backtest), because big creators no longer clear rungs that were trivially easy for them. And when a
campaign attracts far more reach than its budget can pay for at the brand's maximum, creators get
less per view than the old ladders paid, because the old ladders simply overspent.

---

## 2. The method, end to end

```
campaign parameters ──► view model ──► rung placement ──► flat rate ──► Monte Carlo ──► ladder + ₹ range
(category, platform,     (lognormal     (median, then     (₹ per view   (guaranteed
 budget, brand max,       per group,     each rung half    same at      minimum rate)
 target tier, dates)      with fallback)  as reachable)    every rung)
                                                                    │
              during the campaign: running tally of promised minimums ──► close to new posts if full
              at settlement: fraud check ──► final rate ──► pay ──► refund the rest
```

**Inputs** (`python -m ladder build --help`): category, platform, total budget, the brand's maximum
₹ per 1,000 views, target creator tier, optional start/end dates. The only field we added to the
brief's campaign schema is `brand_max_cpm`.

**Output:** one ladder per **tier × format** (e.g. micro reel, micro carousel), each a list of
(view threshold, ₹ minimum payout, ₹ maximum payout, chance of reaching it), plus the guaranteed and
maximum rate, expected spend, expected refund and the chance of filling up early.

### 2.1 Modelling views for a new campaign

Views per post are heavy-tailed, so we model **log(views)** as a normal distribution: a lognormal
with two numbers per group:

- **μ**, the average of log-views (the median post gets e^μ views)
- **σ**, the spread of log-views (how uneven the group is)

A **group** is `category × platform × tier × format`, estimated from past posts that ops did not
flag. We use `views_final` because that is what gets paid.

**Why lognormal:** it's the simplest distribution that is heavy-tailed, strictly positive, and has
a closed-form quantile. The quantile gives the rung formula directly. We validated it rather than
assumed it (§5).

**Cold start and thin groups: fallback.** A group with fewer than 30 clean posts gives an unstable
median and spread (30 is the usual rule of thumb), so the group is widened one factor at a time:

| Step | Group used |
|---|---|
| 0 | category · platform · tier · format |
| 1 | drop the factor that moves views least **in the data** |
| 2 | drop the other one |
| 3 | tier only |

**Which factor to drop first is measured, not assumed.** On our data, format moves views more than
category (spread of group means 0.40 vs 0.28 in log-views), so category is dropped first.

- **Tier is never dropped**, because audience size moves views the most.
- Every ladder reports which group it came from and how many posts were behind it, so a brand can
  see when a forecast is less specific.
- A campaign in a brand-new category simply lands on step 1 and says so. That is the cold-start
  answer.

**How many posts to expect.** From past campaigns with the same target tier and platform (widening
to same tier, then all), we count posts per rupee of budget.
- **Normalisation:** posts per rupee differ about 100× between nano and macro campaigns, so the rate
  is normalised by the typical post value of the target tier before pooling.
- **Tier mix:** from the similar campaigns.
- **Format mix:** from all past posts on the platform.

### 2.2 Placing thresholds

For a group with (μ, σ), rung *k* is the view count that a share **0.5 × s^(k−1)** of posts reach,
where **s = 0.5** is the step chance:

```
rung_k = exp(μ + σ · z_k),    z_k = Φ⁻¹(1 − 0.5 · s^(k−1))
```

| Rung | Reached by | z |
|---:|---:|---:|
| 1 | 50% (the median post) | 0.00 |
| 2 | 25% | 0.67 |
| 3 | 12.5% | 1.15 |
| 4 | 6.25% | 1.53 |
| 5 | 3.1% | 1.86 |

- **Why the first rung is the median:** payment starts where a normal post for this tier lands.
  Half of posts earn something, and any creator with three posts has an 87.5% chance of hitting a
  milestone.
- **Why rungs are placed by reach instead of fixed view numbers:** it's the fairness requirement.
  Every tier faces the same odds at every step, which one fixed ladder cannot do.
- **Why s = 0.5:** the brief names two opposite failures. Gaps that are too large make creators give
  up (a low chance of the next rung). Gaps that are too small make the ladder trivially climbed and
  cheap to fake (a high chance). We have no data on how creators react to missing a rung, so 0.5 is
  the neutral point between them. §4.4 shows 0.4 and 0.6 side by side.
- **Where the ladder stops:** once fewer than one post in this campaign is expected to reach the next
  rung, **but never before the ladder covers 95% of posts**. Without that floor, a tier with three
  expected posts got a one-rung ladder in testing, and its good posts were paid as if they were
  median ones. The 95% reuses the budget confidence level; it is not a new number.
- **Rounding:** thresholds are rounded to two significant figures (38,712 → 39,000), and the exact
  reach of the *rounded* number is recomputed and shown.
- **Answer to "why 250K and not 200K?":** because 1 in 8 posts in this group reaches 250K, and half of
  the posts that reach the rung below also reach this one. Moving it to 200K would make it a rung
  that 1 in 6 reach, which breaks the halving between rungs.

### 2.3 Setting payouts

- **One flat rate per view at every rung.** Payout at rung *k* = rate × rung views, cumulative.
  **Justification:** paid media charges the same per 1,000 views whichever post delivers them, so the
  brand's 400,001st view is worth the same as its 10,001st.
- **We earlier considered a rate that falls at higher rungs and rejected it.** Any rate of decline
  would have been an arbitrary number. The viral-post budget risk it was meant to address is handled
  by the top rung instead: views past it are not paid.
- **Payment rounds down** to the last cleared rung. 141K views on a ladder with a 140K rung pays for
  140K. This is what makes it a milestone ladder rather than a per-view rate.
- **The rate has a range:**
  - **Maximum** = the brand's number (`brand_max_cpm`), a hard ceiling.
  - **Guaranteed minimum** = budget ÷ (95th percentile of total cleared views), from 3,000 simulated
    campaigns. Each simulation draws a number of posts from similar campaigns, a group for each post,
    and views from that group's lognormal, then rounds each post down to its rung.
  - Creators see both numbers per rung: *"reach 57K → at least ₹1,359, up to ₹2,280."*
- **Final rate at settlement:**
  ```
  final rate = max(guaranteed minimum, min(brand maximum, budget ÷ total cleared views))
  refund     = budget − payouts
  ```
  - **Low views:** everyone gets the brand's maximum and the brand gets a refund.
  - **High views:** the budget is split, but never below the guaranteed minimum.
  - This is the "handshake" between brand ceiling, budget and creator floor, written as one formula.
- **The running tally keeps the guarantee payable.** While the campaign runs, we keep a daily tally of
  guaranteed minimum × each post's *projected* cleared views:
  - a post under 1 day old counts as its group's expected value
  - from 24 hours: views at 24h × median growth to final
  - from 7 days: the 7-day figure
  - from 30 days: the 30-day figure
  
  Posts that already look suspicious are left out. When the tally reaches the budget, the campaign
  **stops accepting new posts**. No money moves until settlement.

### 2.4 Fraud and gaming

Four layers, deliberately simple:

1. **Detection from the growth curve.** Bought views arrive in a burst and stop, so a boosted post is
   unusually front-loaded (most of its 7-day views already there at 24 hours) and unusually large
   for the account.
   - A post is flagged if its 24h ÷ 7d ratio is beyond the 99th percentile of clean posts, **or** if
     both that ratio and its 7-day views ÷ the creator's historical average are beyond the 95th.
   - Thresholds are **learned from clean posts**, so the false-alarm rate is set by construction
     rather than by a hand-picked cutoff.
   - Before 7-day data exists, the tally uses the day-one version: first-day views ÷ historical
     average, beyond the 99th percentile.
2. **Payment timing.** Nothing is paid until the check has run on the full curve. A flagged post, by
   ops or by us, is held; if it is still suspicious at settlement, it is not paid.
3. **Ladder design.**
   - Rungs are about 1.4–2× apart (median extra views to the next rung: +37%), so faking your way up
     one rung means buying a large share of your real reach.
   - The top rung caps what any single post can earn, fake or not.
   - Payment is per post at a flat rate, so splitting activity across fake accounts earns nothing
     extra.
4. **Data we would want in production:**
   - likes, comments and saves relative to views
   - viewer geography and follower vs non-follower views
   - the platform's own paid-promotion flag
   - repeated co-engagement between the same accounts (a sign of engagement pods)
   - how an account's follower count has changed over time

**The brief's `flagged_suspicious` label.** We generate it, as a noisy version of the truth: it
catches 85% of boosted posts and wrongly flags 0.5% of clean ones, because a real label is a rough
proxy. We then score both the label and our detector against the generator's hidden truth (§4.5).

### 2.5 Marginal ROI and lowball protection

- **The ROI criterion is met by construction:** payout per view can never exceed the brand's stated
  maximum.
- **The opposite risk is a brand setting a maximum so low that nobody joins.** We compare it with
  what creators in the same category were actually paid in past campaigns:
  - **Block:** below every past campaign in the category. *"Creators have never accepted this rate
    here."*
  - **Warn:** below the category median.
  - **OK:** at or above the median.
- **Why history and not external benchmarks:** neither threshold is invented; both come from the
  data. We don't use live Meta or Google CPMs. Their APIs report an advertiser's own costs, not market
  prices, and hand-typed benchmark numbers would be unsourced. The brand knows what paid social costs
  it and is told to set the maximum at or below that.

---

## 3. Assumptions baked into the synthetic data

The method is never told any of these. The generator (`ladder/generate.py`) is seeded, so the data
is reproducible.

| What | Assumed | Why it matters |
|---|---|---|
| Size | 40 campaigns, 400 creators, 2,820 posts | Enough for most groups to reach 30 posts |
| Tiers (brief's bands) | 42% nano, 35% micro, 18% mid, 5% macro | Small creators dominate supply |
| Views of a typical post | 4 × followers^0.85 × creator quality | Bigger pages reach a smaller share of followers |
| Creator quality | lognormal, σ = 0.35 | Same-size pages differ |
| Post-to-post spread | lognormal, σ = 0.85, plus 2% viral posts × ~6 | Heavy tail: the model's lognormal is *slightly wrong on purpose* |
| Category reach | entertainment 1.35, gaming 1.2, FMCG 1.0, D2C 0.85, finance 0.6 | Gaming vs finance behave differently |
| Format reach | reel/short 1.0, carousel 0.4, long-form 0.3 | Format matters as much as category |
| Growth | about 33% of final views at 24h, 77% at 7d, 95% at 30d (medians) | Drives the tally and fraud checks |
| Fraud | 8% of creators; half their posts buy 1–8× their organic views; 70% in one day-one burst, 30% dripped over the week | Drip fraud is deliberately hard to see |
| Ops label | catches 85% of boosted posts, flags 0.5% of clean ones | "Rough proxy", per the brief |
| Brand value per 1,000 views | finance ₹70, D2C ₹45, gaming ₹38, FMCG ₹35, entertainment ₹28 (× 0.8–1.3) | In the range the brief's own example ladder implies |
| Participation | creators per ₹1 lakh by target tier, × 0.5–1.8 for how well the budget fits reach | Some campaigns oversubscribed, some not |
| Status-quo ladders | round-number templates by target tier (the brief's example for micro); same for everyone; 40% of the time scaled ×0.5 or ×2 by "gut feel", 30% drop a rung; payout rate ₹45–140 per 1,000 views blind to category | Reproduces the brief's problems: some blow the budget, some are out of reach |

**These choices shape the results.** In particular, fraud is easier to detect here than in reality,
and participation does not respond to the ladder, because nothing in the brief's data links them.

---

## 4. Results (full tables: `results/BACKTEST.md`)

### 4.1 Setup
- **Campaigns:** all 23 that had at least 12 fully settled campaigns before them.
- **No look-ahead:** each ladder is rebuilt using only campaigns that settled before it started.
- **Replay:** the same real posts are run under the ladder actually used and under ours.
- **Stated assumption:** the posts are the same under both, so creator behaviour is held fixed.

### 4.2 Headline

| | Status quo | Ours |
|---|---:|---:|
| Campaigns within budget | 17 / 23 | **23 / 23** |
| Worst overspend | 200% over | **0%** |
| Total paid | ₹97.96L | ₹83.79L |
| Creators hitting a milestone | 62% | 57% |
| Paid to posts with bought views | ₹1,84,700 | **₹3,522** |
| Clean posts wrongly withheld | 6 | 11 |

One campaign filled up early and turned away 48 late posts.

### 4.3 Fairness: hit rate by tier

| Tier | Status quo | Ours |
|---|---:|---:|
| nano | 40% | 59% |
| micro | 70% | 52% |
| mid | 90% | 67% |
| macro | 95% | 60% |

Status-quo hit rates range from 40% to 95% depending on creator size; ours range from 52% to 67%.

### 4.4 Sensitivity to the one policy choice

| Step chance | Avg rungs | Within budget | Hit rate | Views unpaid by rounding down | Extra views to next rung |
|---:|---:|---:|---:|---:|---:|
| 40% | 4.0 | 22/23 | 58% | 32% | +51% |
| **50%** | 5.0 | 23/23 | 57% | 28% | +37% |
| 60% | 6.0 | 22/23 | 57% | 25% | +26% |

**Reading:** the choice barely moves budget safety or hit rate. What it trades is shown in the last
two columns:
- **Lower step chance:** wider gaps, harder to fake, but more views go unpaid and the next rung feels
  further away.
- **Higher step chance:** the reverse.

**How creators would *feel* about each cannot be measured from this data.** The expected behaviour
we can only reason about:

| Step chance | Ladder | Likely creator reaction (assumed, not measured) |
|---|---|---|
| 40% | Fewer, bigger jumps | The next rung feels far, so more give up mid-campaign; buying views to climb costs more |
| 50% | Middle | Neutral between the brief's two failures |
| 60% | More, smaller jumps | Frequent small wins, but cheap to fake a rung and more low-effort grinding |

With real drop-off data (did creators post again after missing a rung?), this is the first number
to tune. The 23 vs 22 within-budget difference is one campaign and should not be read as proof
that 50% is best.

### 4.5 Fraud

| Signal | Caught | Missed | Clean posts held | Precision | Recall |
|---|---:|---:|---:|---:|---:|
| Ops label only (status quo) | 99 | 23 | 14 | 88% | 81% |
| Our detector only | 88 | 34 | 16 | 85% | 72% |
| Label or detector (used) | 115 | 7 | 30 | 79% | 94% |

The detector alone is weaker than the label, because it misses the drip-fed fraud. Combined, they
catch 94% of boosted posts, at the cost of about 1% of clean posts being held.

### 4.6 Paid more or less than actual?

- **Less in total:** ₹83.8L vs ₹98.0L across the 23 campaigns.
- **Where less:** almost entirely in the 6 campaigns where the status quo overspent (up to 3× the
  budget).
- **Where more:** in several under-spending campaigns ours paid more, because creators were paid the
  brand's full maximum where the old ladder's rungs were out of reach. C040: ₹15.5L vs ₹11.4L on a
  ₹57.7L budget.
- The five showcase campaigns, with every number, are in `results/BACKTEST.md`.

---

## 5. Validation of the view model (`results/VALIDATION.md`)

**Calibration on unseen campaigns.** Fitted on campaigns settled before 2025-01-22, then tested on
821 later posts.

| Rung | Model says reached by | Actually reached by |
|---:|---:|---:|
| 1 | 49.9% | 49.8% |
| 2 | 24.9% | 24.7% |
| 3 | 12.4% | 12.7% |
| 4 | 6.3% | 7.4% |
| 5 | 3.1% | 4.9% |

- Rungs 1–3 are accurate.
- The top rungs are reached more often than modelled, because the 2% viral posts make the real tail
  heavier than a lognormal.
- **Practical effect:** top rungs are slightly easier than advertised, and the P95 budget line is
  slightly optimistic. The running tally and the early close cover this.

**Recovery of hidden effects.** Estimated from the posts alone vs the generator's hidden truth:

| Factor | Estimated | Truth |
|---|---:|---:|
| Carousel vs reel | 0.40× | 0.40× |
| Long-form vs short | 0.26× | 0.30× |
| Gaming vs FMCG | 1.19× | 1.20× |
| Entertainment vs FMCG | 1.39× | 1.35× |
| Finance vs FMCG | 0.69× | 0.60× |
| D2C vs FMCG | 1.00× | 0.85× |

Format and most categories are recovered well. D2C is not, because there are few D2C posts per
cell, a reminder that thin groups are noisy.

---

## 6. Limits: what would break it, and what we'd want more data for

1. **Creator behaviour is held fixed.** The biggest gap. A ladder changes who joins and how many posts
   they make; nothing in the brief's data measures that. Needed: per-creator posting history across
   campaigns with different ladders, and whether creators posted again after missing a rung.
2. **Budgets far smaller than the reach they attract.** The guaranteed minimum then becomes small
   (e.g. ₹4.85 per 1,000 views against a ₹88 maximum in C039). The method stays within budget, but
   creators earn little per view. Better: cap the number of accepted posts up front, and show the
   brand how much reach their budget can actually buy at their price.
3. **One large post on a small budget.** A macro post's top rung can pay more than a small campaign's
   budget. It stays within budget through dilution and the running tally, but a brand wanting reach
   spread across many creators may want a per-post cap.
4. **Tiers are 10× wide.** A 12K-follower page finds the micro median harder than a 90K one. Fix:
   place rungs by follower count within the tier.
5. **Tail heavier than lognormal.** Top rungs are slightly easier than advertised. Fix: a
   heavier-tailed fit, or an empirical tail once there is enough data.
6. **Fraud here is easier than real fraud.** Real bot farms imitate organic growth curves.
   Engagement-quality signals (§2.4) would be needed.
7. **Thin history.** With fewer than about 12 settled campaigns, most groups fall back to tier-only
   forecasts. The method still works, but tells you so.
8. **Views after settlement are not paid.** Books have to close; settling 30 days after the
   campaign ends gives every post at least the brief's 30-day checkpoint.

---

## 7. Earlier exploration (archived)

We first built a price-discovery market (`archive/cpi-market/`): publishers minting one coin per
impression, one price per coin learned from a supply curve across campaigns, and a refund of the
unspent pool. It answered a different question ("what should a view cost?") and paid linearly, so
it produced no ladder.

**Kept from it:** settling at the end with one price for everyone, capped by the pool, with a
refund, now the settlement formula in §2.3.

**Dropped:**
- the learned price curve, because the brief's data has no price-vs-participation signal
- the geometric (Nash) handshake, because in that work's own tests a brand could triple the price by
  misreporting
