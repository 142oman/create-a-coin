# Methodology

Creator Coin replaces hand-set milestone ladders with a coin pool: the brand sets a budget, creators'
real views become coins, and the market sets what a coin is worth. Every decision below, and why it
was made, is in `docs/DISCUSSION.md` (Part 12 onwards; tags like G9 refer to it).

## 1. What "optimized" means here

In priority order:

1. **The budget can never be exceeded.** In every outcome, by construction, not at 95% confidence.
2. **One market-set price per coin.** Nobody declares a rate, so nobody can lowball or pad it.
3. **Every creator size has the same odds** at every rung, and weak posts can't grind the pool.
4. **Bought views are not paid.**
5. **When too few views arrive, the brand is not charged the whole pool.**
6. **Rungs stay reachable** when views run cold for everyone.

## 2. The method

### 2.1 What the brand chooses (G21)

Four things: category (one or several), where (platform and format, default anywhere), budget, and
duration. Every creator size can join. Everything else is set by the method.

### 2.2 Rungs (G9–G13)

For each segment (category × platform × creator tier × format), from that segment's past posts only:

- **rung 1** (the minimum) = the views 80% of past posts reached;
- **each next rung** = where half of the posts that reached the rung below got to (40%, 20%, 10%, 5%);
- empirical quantiles of past final views, rounded to two significant figures.

Rungs never depend on the budget: a ₹1,000 and a ₹1 crore campaign ask a nano reel for the same views.
**Why 80%:** in a pool a weak post adds few coins, so the bar only has to keep duds out. **Why halving:**
the neutral point between "too far to chase" and "too cheap to climb". These are the two policy
choices.

### 2.3 Price and pay (G9)

- **Every validated view is a coin in the price**, including views on posts below rung 1 and views
  between rungs: the price is what the brand's money bought.
- **pool = budget ÷ coins.**
- **Plenty of views** (pool ≤ market reference): price = pool; the whole budget is paid out.
- **Too few views** (pool > reference): price = √(pool × reference), the Nash bargaining split between
  the most the brand's money allows and what creators could earn elsewhere. The rest is refunded.
- **Each post is paid for the coins at the highest rung it reached** (42 views on a 40 rung: priced as
  42, paid as 40). Everything priced but not paid goes back to the brand.

### 2.4 Market reference (G16, G28)

What creators could earn instead: the coin-weighted median price per view actually paid in settled
campaigns of the same category and format; if none, of the same format in any category; if the format
has never run, none (plain pool split). The generated history ran the old way, so its reference is the
old ladders' real payouts per view.

### 2.5 Fraud (G6)

Two signals, from daily view counts only:

1. **Drop after the peak:** (next day + 1) ÷ (peak day + 1). Real attention fades; bought views
   arrive in a burst and stop.
2. **Versus usual:** this post's views ÷ the creator's median past post. Supporting evidence only.

Hold if the drop is sharper than 99 in 100 past unflagged posts, or sharper than 95 in 100 **and** the
post is bigger than 95 in 100 of the creator's usual. A peak on the campaign's last day is held only
if the post is beyond 99 in 100 of the creator's usual. Cut-offs are learned from past posts that were
not held. Held posts are reviewed within **7 days** after the campaign ends; nobody is paid before
then. Valid: counted at the same price. Fraud (or not cleared in time): never paid.

### 2.6 Fair Reach (G10–G12, G18)

At 25%, 50% and 75% of the campaign, per group (category × format, all tiers pooled):

- each post is judged against the rung-1 level that past posts in its segment had reached **at the same
  age**;
- if both the share of posts on track and the share of creators with a post on track are below 80%
  beyond chance (one-sided binomial test, 95% overall confidence split across the three checks), the
  group is short;
- every rung of the group, in every tier, is multiplied by √(score 80% of posts reach): the Nash split
  between the historical rung and the live one;
- rungs only come down, never up.

### 2.7 Cold start (G15)

A segment with **zero** past posts has no rungs until the 25% mark; every view is still a coin. At 25%
its rungs are built from the campaign's own posts, rebuilt at 50% and 75% (up or down), then fixed.
Once it settles, the segment has history. No borrowing rungs from other groups.

## 3. The generated world (G1–G5, G7, G14, G28)

No Meme'd data exists, so the history is generated at run time. Nothing about the market is typed in:
a recipe of sliders tilts random draws, and Markov chains do the rest.

- **Post momentum, daily:** cold, steady, trending, viral, fading, dead. Each state multiplies daily
  views; transition tables are drawn per run. Dead is permanent; only a fading post can die.
- **Creator state, per campaign:** active, fatigued, cheating, gone. Gone is permanent.
- **Market season, monthly:** hot, normal, cold.

The only built-in relations: bigger accounts get more views (less than proportionally); views never
decrease; category and format change reach; bought views arrive mostly as a burst; a higher coin
value or a more generous ladder attracts more creators; brands budget roughly for the reach they
expect; ops anchor gut-feel ladders on what past posts got. The **size** of every effect is drawn per
run. The brief's four tables are exported from it, with `views_at_24h/7d/30d` capped at the campaign's
end and `flagged_suspicious` being our check's decision.

**Checks on the default world** (`results/VALIDATION.md`): the top 10% of posts carry 88% of views;
followers and views correlate at 0.84; rungs built from history are reached by 73%, 39%, 22%, 13% and
9% of later posts against the designed 80%, 40%, 20%, 10% and 5%.

## 4. Results (default recipe, `results/BACKTEST.md`)

120 past campaigns, each paid the old way and by Creator Coin on the same posts:

| | Old way | Creator Coin |
|---|---:|---:|
| Campaigns over budget | 22 (worst 6.1×) | 0 |
| Cost per 1,000 genuine views | ₹58.3 | ₹40.6 |
| Creators paid, nano / macro | 19% / 81% | 79% / 74% |
| Paid for bought views | ₹4,14,100 | ₹89,643 |
| Price swing between similar campaigns | 0.67 | 0.44 |
| Pay to top 10% of creators | 50% | 75% |

Plus 17 Fair Reach rescues (46 creators paid only because of them) and ₹45.9 lakh returned to brands.
Pay concentration rises because pay follows reach. Results vary by recipe: in some worlds gut-feel
ladders happened to underpay, and Creator Coin costs more per view there. The recipe panel shows it.

## 5. Limits

- **Behaviour held fixed in the backtest.** A replay can't show creators reacting to a better price.
- **Slow-dripped fakes** are caught only when far above the creator's usual; there's no engagement data.
- **Rungs from very few past posts** can be too easy until more history arrives (too hard is fixed by
  Fair Reach).
- **Creators carry price risk**: no floor. They see the live value throughout.
- **Everything is generated.** Next step: run alongside live campaigns.
