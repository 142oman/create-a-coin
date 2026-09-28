'use strict';
/**
 * Simulator: synthetic publishers with hidden reservation prices, campaigns run against
 * the real mechanism, scored against the full-information competitive price.
 *
 * Nothing here is visible to the mechanism except minting.
 */
const { SupplyCurve, settle } = require('../server/mechanism');

const HOURS = 240;
const BUDGET = 100000;

const MARKETS = {
  thin: { publishers: 15, medianReservation: 3.0, spread: 0.3, arrivals: 'uniform', wantedCpi: 2.0 },
  balanced: { publishers: 100, medianReservation: 2.0, spread: 0.3, arrivals: 'uniform', wantedCpi: 2.0 },
  abundant: { publishers: 300, medianReservation: 1.0, spread: 0.3, arrivals: 'uniform', wantedCpi: 2.0 },
  earlyBurst: { publishers: 100, medianReservation: 2.0, spread: 0.3, arrivals: 'early', wantedCpi: 2.0 },
  lateBurst: { publishers: 100, medianReservation: 2.0, spread: 0.3, arrivals: 'late', wantedCpi: 2.0 },
  lowball: { publishers: 60, medianReservation: 2.5, spread: 0.3, arrivals: 'uniform', wantedCpi: 0.5 },
  highball: { publishers: 60, medianReservation: 2.0, spread: 0.3, arrivals: 'uniform', wantedCpi: 8.0 },
  thinHighball: { publishers: 15, medianReservation: 3.0, spread: 0.3, arrivals: 'uniform', wantedCpi: 8.0 },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(random) {
  let u = 0;
  while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

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

function arrivalHour(random, profile) {
  if (profile === 'early') return random() < 0.7 ? 10 + Math.floor(random() * 7) : Math.floor(random() * HOURS);
  if (profile === 'late') return random() < 0.7 ? 190 + Math.floor(random() * 11) : Math.floor(random() * HOURS);
  return Math.floor(random() * HOURS);
}

function population(random, spec) {
  const count = Math.max(1, poisson(random, spec.publishers));
  return Array.from({ length: count }, () => ({
    arrival: arrivalHour(random, spec.arrivals),
    reservation: spec.medianReservation * Math.exp(spec.spread * gauss(random)),
    rate: 5 * Math.exp(0.5 * gauss(random)),
    patience: Math.floor(-72 * Math.log(1 - random())),
    joined: null,
  }));
}

/** One campaign at one posted price. Publishers join when the deal beats their hidden price. */
function runCampaignAt(publishers, budget, postedPrice, hours = HOURS) {
  const arrivals = new Map();
  for (const p of publishers) {
    if (!arrivals.has(p.arrival)) arrivals.set(p.arrival, []);
    arrivals.get(p.arrival).push(p);
  }
  let waiting = [];
  let liveRate = 0;
  let minted = 0;
  let committed = 0;
  for (let t = 0; t < hours; t += 1) {
    const candidates = [
      ...(arrivals.get(t) || []).map((p) => [p, true]),
      ...waiting.map((p) => [p, false]),
    ];
    const still = [];
    for (const [p, isNew] of candidates) {
      if (!isNew && t - p.arrival > p.patience) continue;
      const own = p.rate * (hours - t);
      const expected = Math.min(postedPrice, budget / (committed + own));
      if (expected >= p.reservation) {
        p.joined = t;
        liveRate += p.rate;
        committed += own;
      } else {
        still.push(p);
      }
    }
    waiting = still;
    minted += liveRate;
  }
  const holdings = publishers.filter((p) => p.joined !== null).map((p, i) => ({
    publisher: `p${i}`,
    coins: p.rate * (hours - p.joined),
  }));
  return { settlement: settle(budget, postedPrice, holdings), minted };
}

/** Full-information competitive price: buy cheapest first until the budget runs out. */
function trueValue(publishers, budget, hours = HOURS) {
  const supply = publishers
    .map((p) => [p.reservation, p.rate * (hours - p.arrival)])
    .sort((a, b) => a[0] - b[0]);
  let cumulative = 0;
  for (const [reservation, volume] of supply) {
    if (cumulative > 0 && reservation * cumulative >= budget) return budget / cumulative;
    cumulative += volume;
    if (reservation * cumulative >= budget) return reservation;
  }
  return supply.length ? supply[supply.length - 1][0] : null;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function spread(xs) {
  const m = median(xs);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return (Math.sqrt(variance) / m) * 100;
}

/** Run a season of campaigns in one market and score the mechanism against truth. */
function runMarket(name, { campaigns = 120, warmup = 40, seed = 1, budget = BUDGET } = {}) {
  const spec = MARKETS[name];
  if (!spec) throw new Error(`unknown market ${name}`);
  const curve = new SupplyCurve();
  const random = mulberry32(seed);
  const series = [];
  for (let i = 0; i < campaigns; i += 1) {
    const publishers = population(mulberry32(10000 + i), spec);
    const truth = trueValue(publishers, budget);
    const quote = curve.priceFor(budget, spec.wantedCpi, { random });
    const { settlement } = runCampaignAt(publishers, budget, quote.price);
    curve.record(quote.price, settlement.minted);
    series.push({
      campaign: i + 1,
      warmup: i < warmup,
      posted: quote.price,
      source: quote.source,
      settled: settlement.price,
      truth,
      minted: settlement.minted,
      poolSplit: settlement.minted > 0 ? budget / settlement.minted : null,
      refundShare: (settlement.refund / budget) * 100,
      error: settlement.minted > 0 ? (Math.abs(settlement.price - truth) / truth) * 100 : null,
    });
  }
  const scored = series.filter((s) => !s.warmup && s.error !== null);
  return {
    market: name,
    spec,
    series,
    summary: {
      truth: median(scored.map((s) => s.truth)),
      settled: median(scored.map((s) => s.settled)),
      error: median(scored.map((s) => s.error)),
      poolSplitError: median(scored.map((s) => (Math.abs(s.poolSplit - s.truth) / s.truth) * 100)),
      refundShare: median(scored.map((s) => s.refundShare)),
      floor: spread(scored.map((s) => s.truth)),
    },
  };
}

function main() {
  const campaigns = Number(process.argv[2]) || 150;
  const pad = (s, n) => String(s).padStart(n);
  console.log(`\nMint-only price discovery, ${campaigns} campaigns per market\n`);
  console.log(
    'market'.padEnd(16) + pad('truth', 8) + pad('settled', 9) + pad('error', 9) +
    pad('pool split', 12) + pad('refund', 9) + pad('floor', 8),
  );
  console.log('-'.repeat(71));
  for (const name of Object.keys(MARKETS)) {
    const { summary: s } = runMarket(name, { campaigns });
    console.log(
      name.padEnd(16) + pad(s.truth.toFixed(2), 8) + pad(s.settled.toFixed(2), 9) +
      pad(`${s.error.toFixed(1)}%`, 9) + pad(`${s.poolSplitError.toFixed(0)}%`, 12) +
      pad(`${s.refundShare.toFixed(0)}%`, 9) + pad(`${s.floor.toFixed(0)}%`, 8),
    );
  }
  console.log('\nfloor = campaign-to-campaign spread of the true price; no mechanism beats it.\n');
}

if (require.main === module) main();

module.exports = { runMarket, runCampaignAt, trueValue, population, MARKETS, mulberry32, HOURS, BUDGET };
