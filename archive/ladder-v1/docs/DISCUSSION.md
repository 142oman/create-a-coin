# Discussing and understanding: how the design was reached

A record of every question raised while designing this, what we decided, and why. It includes the
places where an earlier answer was wrong and was corrected. Use it to walk through the reasoning in
the interview.

---

## Part 1. Where we started

### 1.1 What we had built first
A **cost-per-impression price-discovery market**:
- Advertisers fund a pool; publishers "mint" one coin per impression.
- Every coin settles at one price, learned from a supply curve across campaigns.
- Whatever the market can't absorb is refunded.

It was careful work (budget conservation, manipulation tests, a comparison against a Nash-bargaining
"handshake") but it answered **"what should a view cost?"**, not the brief's question.

### 1.2 The mismatch with the brief
- **The brief asks for** *"a milestone ladder — a set of (view threshold, payout) pairs"*.
- **Ours paid linearly** (coins × price) and said *"money is never gamified"*. Its "ladder" was a
  motivation widget of 6-hour delivery targets, with no money attached.
- **None of the brief's data model existed:** no followers, posts, view curves, fraud labels or
  backtest.

### 1.3 The original intent, mapped to the brief's terms

| Our term | Brief's term |
|---|---|
| Coin (1 minted = 1 verified view) | View |
| Settled CPI | Payout per view (× 1000 = effective CPM) |
| Personal dynamic ladder | Tiering, taken to the extreme |
| Settlement + refund | Budget adherence |
| Brand's expected CPI | Brand's ROI reference |
| "Don't pay for an unreached rung" | Milestones |

**Conclusion:** partly a naming gap, partly real gaps (data, view model, fairness, fraud, backtest,
one-pager).

### 1.4 Two conceptual corrections early on
- **Posts don't "deliver" views in 6-hour steps.** A creator posts once and the algorithm distributes
  it over days (24h → 7d → 30d). The creator's real levers are posting more and staying in the
  campaign.
- **"Motivate creators to boost their posts" conflicts with the brief**, which lists *"paid promotion
  to hit a threshold"* as gaming to resist. So the ladder should motivate more genuine posts, not
  boosting.

---

## Part 2. Decisions, in the order we made them

### D1. Can we drop the ladder?
**No.** The brief requires it in three places:
- §2: *"outputs a milestone ladder"*
- §4B: *"output a milestone ladder (view thresholds + payouts)"*
- §4C: *"compare the ladder your method proposes against the ladder that was actually used"*

What we're free to choose is how it's built.

### D2. Is a ladder per post or per creator?
**Per post.** The brief: *"a creator's post unlocks a cash reward each time it crosses a threshold"*,
and `posts.total_payout_earned`.
- **Risk:** grinding many cheap posts that each clear rung 1.
- **Mitigation:** rung 1 at the median (half of posts earn nothing); the fraud check.

### D3. Pay only for cleared rungs, or for every view?
**Only up to the last cleared rung** (141 pays for 140). That is what a milestone is. Paying every
view would be a per-view rate with a UI on top.

### D4. Fairness: "if someone can reach 140, pay 140 whether their ladder said 140 or 150"
- **Rounding down:** yes.
- **But moving a rung to wherever the post landed** would be linear pay in disguise. Rungs must be
  fixed before the views come in.
- **Resolution:** same views in the same tier and format → same money, always.

### D5. A personal "next goal" on a shared ladder?
**Dropped.** As you put it, a personal goal without a personal ladder is just UI. The brief itself
offers the middle ground: *"decide whether and how milestones should be tiered or normalized"*. So:
**one ladder per creator tier**.
- **Reachable for everyone:** each tier's rungs sit where its own posts land.
- **Fair in money:** every tier gets the same ₹ per view; only the thresholds differ.
- **Cold start for free:** a new creator is placed by follower count.
- **Rejected: a fully personal ladder per creator.** Not defensible on fairness, and it can be gamed
  by deliberately weak early posts to get easier rungs later.

### D6. How are tiers defined, and do we move creators between them?
- **Definition:** the brief defines tiers by followers (nano < 10K, micro 10K–100K, mid 100K–1M,
  macro 1M+), and `creators.tier` is in the data.
- **Moving creators:** the brief doesn't ask for it, so **we take the given tier as true**. We
  discussed moving a creator one tier when their view history doesn't match (it would help against
  bought followers) and left it as a possible extension.

### D7. How are categories (gaming, finance…) handled?
Category affects two different things:
- **Where rungs sit (views):** learned per category from past posts. Gaming content travels further
  than finance, so a gaming micro ladder sits higher.
- **What a view is worth (₹):** the brand's own maximum, entered at creation. A finance brand values a
  viewer more and enters more.

The lowball check compares a brand only with past campaigns in **its own category**.

### D8. How far apart are rungs? (the longest discussion)
1. **First suggestion, a fixed multiplier (1.5–2×):** you asked "why 1.5 and not 1.2 or 1.3?" There
   was no answer, so it was **rejected**.
2. **Second, reach chances 65% / 50% / 3%:** three separate made-up numbers, **rejected**.
3. **Final, one number, the step chance = 50%.** Each rung is reached by half of the posts that
   reached the previous one, and rung 1 is the tier's median post.
   - **Why reach-based at all:** it gives every tier the same odds, which is the fairness requirement.
   - **Why 50%:** the brief names two opposite failures, *"so large that creators give up"* and
     *"so small that the ladder is trivially climbed and cheap to grind"*. We have no data on how
     creators react to missing a rung, so 50% is the neutral point.
   - **It's tested:** the backtest compares 40%, 50% and 60%.
   - **Answer to "why 250K?":** *1 in 8 posts in this group reach it, and half of those reaching the
     rung below also reach this one.*

### D9. How many rungs? Is 4 fixed?
**Not fixed.** The brief's 4-rung example is today's manual ladder, not a requirement.
- **Rule:** keep adding rungs while at least one post in this campaign is expected to reach the next.
- Campaign size therefore decides the count; typically 5–6.
- (See B2 for a floor added while building.)

### D10. Should ₹ per view fall at higher rungs?
- We first agreed to a slight drop (to make viral posts cheaper), then asked "why 10%?" and "why half
  rate at the top?". **Both were arbitrary, so we reversed.**
- **Final: a flat rate at every rung.** Paid media charges the same per 1,000 views whichever post
  delivers them, so the brief's ROI criterion argues for flat.
- **Viral risk is handled by the top rung:** views beyond it aren't paid.

### D11. What does P95 mean?
The brief: *"within the brand's budget with a defined confidence level, not just in expectation"*.
- **P95:** in 95% of simulated outcomes, total payout stays within budget.
- **95% is our choice;** the brief asks us to state one.

### D12. Is the brand's CPI a hard maximum? Does the brief demand it?
- **The brief doesn't demand it.** It asks that pay per view *"make sense relative to… paid media
  CPM"*.
- A hard ceiling at the brand's number is **our** way of meeting that.
- **Tension with the old design:** the old code deliberately ignored the brand's number so a brand
  couldn't lowball. With a ceiling, lowballing just means fewer creators join, hence D13.

### D13. How do we stop a brand lowballing? Meta and Google CPM data?
- **Old code:** it ignored the brand's number and priced from a learned curve (measured sensitivity
  to a 20× misquote: under 0.15).
- **New: compare the brand's maximum with what creators in the same category were actually paid:**
  - below every past campaign → **block**
  - below the median → **warn**
  - otherwise OK
- **No live Meta or Google data.** Their APIs show an advertiser's own costs, not market prices, and
  hand-typed benchmarks would be unsourced. You decided: *"we will handle max and min here itself."*
  (We briefly considered a `brand_paid_cpm` field; dropped for that reason.)

### D14. How can a minimum be "guaranteed" if a viral creator can join?
You were right that no forecast is 100%. So the guarantee rests on a **rule**, not the forecast:
1. **Pay once, at the end.** No money moves during the campaign.
2. **Running tally:** keep a daily tally of guaranteed minimum × each post's projected cleared views.
3. **Early close:** when the tally reaches the budget, stop accepting new posts.
4. **Top rung:** limits any single post's claim.

- **What the forecast decides:** only how high the minimum can safely be. Set from the P95 forecast,
  about 5% of campaigns should fill up early.
- **Precise statement:** promises already made are always paid. The budget can be exceeded only if
  posts *already accepted* grow far past their projections. That happened in **0 of 23** backtest
  campaigns.
- **Correction:** I first said "early closing is what we're doing now". It wasn't; the old code only
  diluted the price. It is implemented now.
- **Clarification:** early close protects the **budget**. Underpaying creators is handled by the
  **minimum**, overpaying by the **ceiling**. Three different tools.

### D15. The "handshake": what the old code did, what we kept
- **What the old code actually did:**
  - posted price from the learned curve
  - final price = min(posted, budget ÷ coins)
  - refund the rest
- **The Nash-bargaining handshake,** √(brand CPI × budget ÷ coins), was tested and **rejected** in the
  old work: a brand could triple the price by misreporting.
- **Kept:** settle once with one price, capped by the pool, refund the rest. Extended with the
  guaranteed minimum:
  ```
  final rate = max(guaranteed minimum, min(brand maximum, budget ÷ cleared views))
  refund     = budget − payouts
  ```
- **Dropped:** the learned price curve. The brief's data has no price-vs-participation signal.
- **What is reserved when a rung is cleared:** the guaranteed minimum × rung views, in the tally only.
  The rest (up to the brand's maximum) arrives at settlement as a **bonus**.

### D16. Why 7 and 30 days? What about views after 30 days?
- **The checkpoints come from the brief's schema:** `views_at_24h`, `views_at_7d`, `views_at_30d`,
  `views_final`. There is no day-8 or day-29 figure, which answers "why not 8 days?".
- **Correction:** I once said *"views after 30 days aren't paid"*. That was invented, and retracted.
  **We pay on `views_final`.**
- **Settlement date** = campaign end + 30 days, so every post gets at least the brief's last
  checkpoint. Longer campaigns simply settle later.
- 24h, 7d and 30d are used only for the running tally and the fraud check.

### D17. What is a "similar campaign"? What's the fallback?
- **Similar posts:** same category, platform, tier and format (the brief's own fields).
- **Fallback:** if fewer than 30 clean posts, widen one factor at a time; tier is kept longest.
  **30** is the usual rule of thumb for a stable median and spread; stated as a convention.
- **Every ladder records which group it used,** so thin forecasts are visible.
- This is also the **cold-start** answer.

### D18. Format
**One ladder per tier × format** (micro reel and micro carousel are different ladders). The brief
names ignoring format as a failure of today's ladders.

### D19. Fraud
- **The label:** the brief says `flagged_suspicious` is *"already labeled for you"*. Since we generate
  the data, we generate the label (noisy), **and** build our own detector, **and** score both against
  the hidden truth.
- **Policy:** payout is held until the growth check runs, not at a fixed 30 days. If still suspicious,
  it isn't paid.
- **Four layers:** growth-curve detection, payment timing, ladder design, data we'd want in
  production. See METHODOLOGY §2.4.
- **Correction:** the old report claimed *"Nothing to fake. Only minting is observed."* That is wrong
  under the brief's threat model, because bought views are real, mintable views. Removed.

### D20. Data format and size
- **Format:** JSON files written by a seeded generator (`data/*.json`), using the brief's field names.
- **Size:** you asked for smaller. The result is 40 campaigns, 400 creators, 2,820 posts. Size is about
  having enough posts per group, not speed; generation takes under a second.

### D21. The "old ladder" and the backtest
- **"Old ladder"** = the brief's `milestone_ladders` table: *"the thing you're trying to improve on"*,
  set manually by ops. §4C requires comparing against it, so the generator makes them look like gut
  feel: round numbers, the same for everyone, sometimes too generous or too stingy.
- **Backtest:** the same real posts, replayed under both.
- **Manual comparison, your suggestion:** `python -m ladder compare --campaign C035 --ladder
  my.json`, and the Compare page in the app. It scores any hand-made ladder against both.

### D22. The old code
**Moved to `archive/cpi-market/`, not deleted.** It answers a different question; reviewers grade
"not full of dead code"; the part we kept (settle and refund) is a few lines. METHODOLOGY §7 explains
this in one paragraph.

### D23. Language and wording
- **Python, standard library only**, so reviewers need no installs.
- **Wording:** the brief's terms (views, milestone, payout, CPM). "Coins" survives only in the archive.

### D24. Creator behaviour at 40 / 50 / 60%
In the write-up as an assumption, because it can't be measured:
- **40%:** fewer, bigger jumps. More give up; harder to fake.
- **50%:** neutral.
- **60%:** frequent small wins. Cheap to fake; more grinding.

*"Lacking behavioural data, we picked the neutral point. With real drop-off data, this is the first
number to tune."*

---

## Part 3. Changes made while building (and why)

These came from running the code, not from our discussion. Each is a place where the agreed design,
applied literally, produced a bad result.

**B1. The fallback drops category before format.**
- **I had said** "drop format first".
- **Measured:** format moves views more than category (spread 0.40 vs 0.28).
- **Change:** the code now measures which to drop instead of assuming. That is what "drop the least
  important factor first" actually means.

**B2. The ladder always covers 95% of posts.**
- **Problem:** the "stop when fewer than one post is expected" rule alone gave groups with about 3
  expected posts a single rung at the median. A 500K-view mid post was paid as 79K, which fails
  fairness.
- **Fix:** keep adding rungs until the top rung is reached by 5% or fewer, reusing the 95% confidence
  level rather than inventing a number.

**B3. The participation forecast keeps tier, and normalises across tiers.**
- **Problem:** widening from "same platform + tier" to "same platform" mixed nano campaigns (about
  200 creators per lakh) with macro ones (about 1.5). Forecasts were off by 10–50×.
- **Fix:** widen by dropping platform first, and normalise posts per rupee by the tier's typical post.

**B4. The running tally skips posts that already look suspicious.**
- **Problem:** one post with 4.2M bought first-day views was projected to 12.5M, filled the tally
  alone, and closed a campaign at 17% spend.
- **Fix:** the tally now applies the checks possible at each age (day one: views vs the account's
  history; from 7 days: the full front-loading check).

**B5. Recalibrated synthetic world.**
- **Problem:** in the first data, budgets were 5–10× smaller than the reach they attracted, so every
  campaign diluted to a few rupees per 1,000 views, and every status-quo ladder underspent.
- **Fix:** brand values were set to the range the brief's own example ladder implies (about ₹30–50 per
  1,000 views, finance higher), and budgets rebalanced so some campaigns overspend and some
  underspend, as the brief describes.

**B6. Drip fraud added.**
- **Problem:** the first detector caught 100% of fraud, which is unrealistically easy.
- **Fix:** 30% of boosted posts now spread bought views over the week. The detector alone then catches
  72%, which is more honest.

**B7. Lowball thresholds come from history.**
- **Before:** "block under 50% of benchmark, warn at 50–80%" was proposed.
- **Now:** block below the lowest past rate in the category, warn below its median. No invented
  percentages.

---

## Part 4. Honest trade-offs to own in the interview

- **Completion falls overall:** 62% → 57%. By tier it becomes even (nano 40→59%, macro 95→60%). We
  chose fairness and budget safety over making big creators' first rung trivially easy.
- **Creators earn less per view in oversubscribed campaigns** than the status quo paid, because the
  status quo simply overspent. The brand gets the reach within budget; creators get at least the
  guaranteed minimum.
- **Behaviour is held fixed.** The backtest measures money and reach, not how many creators would
  join or quit.
- **The model's tail is too thin.** Top rungs are reached a bit more often than advertised (4.9% vs
  3.1% at rung 5).
- **Two numbers are genuinely chosen:** the 50% step chance and 95% confidence. Everything else is
  given, measured or a named convention (30 posts; 99th/95th-percentile fraud thresholds).

---

## Part 5. Likely interview questions

**Why not just pay per view?** The brief asks for milestones, and milestones do something a per-view
rate can't: they give creators targets, which is the motivation half of the problem. Rounding down
costs about 28% of views unpaid, which the settlement partly returns via a higher rate.

**Why is rung 3 at 100K and not 80K or 120K?** Because 12.5% of posts like this reach 100K, and half
of those reaching rung 2 go on. Moving it breaks the halving.

**Why the median for rung 1?** It pays a normal post. A lower rung 1 is cheap to grind with low-effort
posts; a higher one leaves most creators with nothing.

**How do you know the model is right?** Calibration on campaigns it never saw (rung 1: 49.9%
predicted, 49.8% actual), plus recovery of the effects we hid in the data.

**What if a brand sets a silly low price?** Blocked if below every past campaign in the category,
warned if below the median.

**What if a macro creator goes viral in a small campaign?** Their post is paid up to the top rung. The
rate may dilute toward the guaranteed minimum, and the tally closes the campaign to new posts before
promises exceed the budget.

**What would you do with real data first?** Measure creator drop-off after missing a rung (to tune the
50%), add engagement signals to fraud detection, and fit a heavier tail.

**What did you get wrong along the way?** The 30-day payment cutoff (invented, retracted); the
declining rate (arbitrary, dropped); "early close is already implemented" (it wasn't); the fallback
order (measured, reversed); "nothing to fake" (false, removed).

---

## Glossary

| Term | Meaning |
|---|---|
| Rung / milestone | A view threshold with a cumulative payout |
| Step chance | Share of posts that reached one rung and go on to reach the next (50%) |
| Tier | Creator size band from the brief (nano / micro / mid / macro) |
| Group | Category × platform × tier × format: posts expected to behave alike |
| CPM | ₹ per 1,000 views |
| Brand maximum | Highest ₹ per 1,000 views the brand pays; a hard ceiling |
| Guaranteed minimum | Lowest rate creators will get; budget ÷ P95 of simulated cleared views |
| P95 | The value 95% of simulated outcomes stay under |
| Running tally | Daily sum of promised minimums; closes the campaign to new posts at the budget |
| Settlement | One payout at campaign end + 30 days; unspent budget is refunded |
| Fallback / widening | Using a broader group when the exact one has under 30 posts |
