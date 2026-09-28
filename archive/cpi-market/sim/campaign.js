'use strict';
/**
 * Dedicated single-campaign simulation, hour by hour.
 *
 * The advertiser supplies a budget, an expected CPI and a duration in days. Archetypes are
 * defined relative to that campaign's own target volume (budget / expected CPI), so "thin" and
 * "abundant" mean the same thing whatever numbers are entered.
 */
const { SupplyCurve, settle, gauss } = require('../server/mechanism');
const { runCampaignAt, trueValue, mulberry32 } = require('./simulate');

const ARCHETYPES = {
  thin: { label: 'thin liquidity', supply: 0.25, priceLevel: 1.5, count: 12, arrivals: 'uniform' },
  balanced: { label: 'balanced', supply: 1.2, priceLevel: 1.0, count: 60, arrivals: 'uniform' },
  abundant: { label: 'abundant', supply: 3.0, priceLevel: 0.6, count: 200, arrivals: 'uniform' },
  earlyBurst: { label: 'early burst', supply: 1.2, priceLevel: 1.0, count: 60, arrivals: 'early' },
  lateBurst: { label: 'late rush', supply: 1.2, priceLevel: 1.0, count: 60, arrivals: 'late' },
  premium: { label: 'premium supply', supply: 0.6, priceLevel: 2.0, count: 25, arrivals: 'uniform' },
};

function poisson(random, mean) {
  const limit = Math.exp(-mean);
  let k = 0;
  let product = random();
  while (product > limit) {
    k += 1;
    product *= random();
  }
  return k;
}

function pickArchetype(random, name) {
  if (name && name !== 'random') {
    if (!ARCHETYPES[name]) throw new Error('unknown archetype ' + name);
    return { id: name, ...ARCHETYPES[name] };
  }
  const ids = Object.keys(ARCHETYPES);
  const id = ids[Math.floor(random() * ids.length)];
  const a = ARCHETYPES[id];
  // Jitter, so "random" is not just one of six fixed worlds.
  return {
    id,
    label: a.label + ' (randomised)',
    supply: a.supply * Math.exp(0.45 * gauss(random)),
    priceLevel: a.priceLevel * Math.exp(0.3 * gauss(random)),
    count: Math.max(3, Math.round(a.count * Math.exp(0.5 * gauss(random)))),
    arrivals: a.arrivals,
  };
}

function arrivalHourIn(random, profile, hours) {
  if (profile === 'early') {
    return random() < 0.7 ? Math.floor(hours * (0.04 + random() * 0.05)) : Math.floor(random() * hours);
  }
  if (profile === 'late') {
    return random() < 0.7 ? Math.floor(hours * (0.78 + random() * 0.14)) : Math.floor(random() * hours);
  }
  return Math.floor(random() * hours);
}

/** Publishers sized against this campaign's own target volume. */
function buildPopulation(random, archetype, { budget, expectedCpi, hours }) {
  const targetCoins = budget / expectedCpi;
  const potential = targetCoins * archetype.supply;
  const count = Math.max(1, poisson(random, archetype.count));
  const averageLiveHours = hours * 0.55;
  const baseRate = potential / (count * averageLiveHours);
  return Array.from({ length: count }, (_, i) => ({
    name: 'pub-' + String(i + 1).padStart(3, '0'),
    arrival: arrivalHourIn(random, archetype.arrivals, hours),
    reservation: expectedCpi * archetype.priceLevel * Math.exp(0.3 * gauss(random)),
    rate: Math.max(1e-6, baseRate * Math.exp(0.5 * gauss(random))),
    patience: Math.floor(-(hours * 0.3) * Math.log(1 - random())),
    joined: null,
  }));
}

/** Run one campaign at a posted price, recording the state of the market every hour. */
function simulateCampaign({ budget, hours, postedPrice, publishers }) {
  const arrivals = new Map();
  for (const p of publishers) {
    if (!arrivals.has(p.arrival)) arrivals.set(p.arrival, []);
    arrivals.get(p.arrival).push(p);
  }
  let waiting = [];
  let liveRate = 0;
  let minted = 0;
  let committed = 0;
  let live = 0;
  const timeline = [];

  for (let t = 0; t < hours; t += 1) {
    const newcomers = arrivals.get(t) || [];
    const candidates = [...newcomers.map((p) => [p, true]), ...waiting.map((p) => [p, false])];
    const joinedNames = [];
    const still = [];
    for (const [p, isNew] of candidates) {
      if (!isNew && t - p.arrival > p.patience) continue;
      const own = p.rate * (hours - t);
      const expected = Math.min(postedPrice, budget / (committed + own));
      if (expected >= p.reservation) {
        p.joined = t;
        liveRate += p.rate;
        committed += own;
        live += 1;
        joinedNames.push(p.name);
      } else {
        still.push(p);
      }
    }
    waiting = still;
    minted += liveRate;
    const estimatedCpi = minted > 0 ? Math.min(postedPrice, budget / minted) : postedPrice;
    timeline.push({
      hour: t + 1,
      day: Math.floor(t / 24) + 1,
      arrived: newcomers.length,
      joined: joinedNames.length,
      joinedNames,
      live,
      waiting: waiting.length,
      coins: minted,
      mintRate: liveRate,
      estimatedCpi,
      spend: minted * estimatedCpi,
      refundIfClosedNow: Math.max(0, budget - minted * estimatedCpi),
    });
  }

  const holdings = publishers
    .filter((p) => p.joined !== null)
    .map((p) => ({ publisher: p.name, coins: p.rate * (hours - p.joined) }));
  const result = settle(budget, postedPrice, holdings);
  const byName = new Map(result.payouts.map((p) => [p.publisher, p]));

  return {
    timeline,
    settlement: {
      minted: result.minted,
      cpi: result.price,
      disbursed: result.disbursed,
      refund: result.refund,
      poolSplit: result.minted > 0 ? budget / result.minted : null,
      healed: result.minted > 0 && result.price < budget / result.minted - 1e-9,
      fullyDeployed: result.refund < 0.005,
    },
    publishers: publishers
      .map((p) => ({
        name: p.name,
        arrival: p.arrival + 1,
        joined: p.joined === null ? null : p.joined + 1,
        reservation: p.reservation,
        coins: p.joined === null ? 0 : p.rate * (hours - p.joined),
        payout: byName.get(p.name) ? byName.get(p.name).payout : 0,
        coveredAsk: p.joined !== null && result.price >= p.reservation,
      }))
      .sort((a, b) => b.coins - a.coins),
  };
}

/** Teach a fresh curve from campaigns in the same market, so the posted price is a learned one. */
function warmCurve(random, archetype, { budget, expectedCpi, hours, campaigns }) {
  const curve = new SupplyCurve();
  for (let i = 0; i < campaigns; i += 1) {
    const publishers = buildPopulation(random, archetype, { budget, expectedCpi, hours });
    const quote = curve.priceFor(budget, expectedCpi, { random });
    const { settlement } = runCampaignAt(publishers, budget, quote.price, hours);
    curve.record(quote.price, settlement.minted);
  }
  return curve;
}

/** Warm the platform curve, price this campaign from it, then run it hour by hour. */
function simulateOneCampaign({
  budget, expectedCpi, durationDays, archetype = 'balanced', seed, warmupCampaigns = 40,
}) {
  budget = Number(budget);
  expectedCpi = Number(expectedCpi);
  durationDays = Number(durationDays);
  if (!(budget > 0)) throw new Error('budget must be positive');
  if (!(expectedCpi > 0)) throw new Error('expected CPI must be positive');
  if (!(durationDays > 0 && durationDays <= 90)) throw new Error('duration must be between 1 and 90 days');

  const hours = Math.round(durationDays * 24);
  const hasSeed = seed !== undefined && seed !== null && seed !== '' && Number.isFinite(Number(seed));
  const usedSeed = hasSeed ? Number(seed) : Math.floor(Math.random() * 1e6);
  const random = mulberry32(usedSeed);
  const spec = pickArchetype(random, archetype);

  const curve = warmCurve(random, spec, { budget, expectedCpi, hours, campaigns: warmupCampaigns });
  const quote = curve.priceFor(budget, expectedCpi, { random });
  const publishers = buildPopulation(random, spec, { budget, expectedCpi, hours });
  const run = simulateCampaign({ budget, hours, postedPrice: quote.price, publishers });

  return {
    campaign: {
      budget,
      expectedCpi,
      durationDays,
      hours,
      seed: usedSeed,
      archetype: spec.id,
      archetypeLabel: spec.label,
      targetCoins: budget / expectedCpi,
    },
    pricing: {
      postedPrice: quote.price,
      source: quote.source,
      saturate: quote.saturate,
      exhaust: quote.exhaust,
      learnedFrom: warmupCampaigns,
    },
    truth: trueValue(publishers, budget, hours),
    ...run,
  };
}

module.exports = { ARCHETYPES, simulateOneCampaign, simulateCampaign, buildPopulation, warmCurve };
