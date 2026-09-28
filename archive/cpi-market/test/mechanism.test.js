'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SupplyCurve, settle, estimatedPrice } = require('../server/mechanism');
const { Market } = require('../server/store');
const { runMarket, MARKETS } = require('../sim/simulate');

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

test('settlement conserves the budget exactly', () => {
  const holdings = [{ publisher: 'a', coins: 1234.5 }, { publisher: 'b', coins: 987.6 }];
  const s = settle(100000, 3.33, holdings);
  const paid = s.payouts.reduce((sum, p) => sum + p.payout, 0);
  assert.ok(Math.abs(paid - s.disbursed) < 1e-9);
  assert.ok(Math.abs(s.disbursed + s.refund - 100000) < 1e-9);
  assert.ok(s.disbursed <= 100000);
});

test('every coin settles at one price', () => {
  const s = settle(100000, 2.5, [{ publisher: 'a', coins: 1000 }, { publisher: 'b', coins: 4000 }]);
  const perCoin = s.payouts.map((p) => p.payout / p.coins);
  assert.ok(Math.abs(perCoin[0] - perCoin[1]) < 1e-9);
});

test('never pays more than the pool split', () => {
  const s = settle(1000, 99, [{ publisher: 'a', coins: 1000 }]);
  assert.strictEqual(s.price, 1);
  assert.strictEqual(s.refund, 0);
});

test('no supply refunds everything', () => {
  const s = settle(5000, 2, []);
  assert.deepStrictEqual([s.minted, s.disbursed, s.refund], [0, 0, 5000]);
});

test('the estimate can only fall as more is minted', () => {
  const a = estimatedPrice(100000, 5, 1000);
  const b = estimatedPrice(100000, 5, 40000);
  assert.strictEqual(a, 5);
  assert.ok(b < a);
});

test('saturation beats budget exhaustion when it is cheaper', () => {
  const curve = new SupplyCurve();
  for (let i = 0; i < 20; i += 1) curve.record(1 + i * 0.5, Math.min(12000, 3000 * (1 + i * 0.5)));
  const { price, source, exhaust } = curve.clearingPrice(100000, 2);
  assert.strictEqual(source, 'supply-saturated');
  assert.ok(price < exhaust, 'thin supply must not be charged the pool split');
});

test('the wanted CPI is ignored once the curve is learned', () => {
  const build = () => {
    const curve = new SupplyCurve();
    for (let i = 0; i < 20; i += 1) curve.record(1 + i * 0.5, Math.min(12000, 3000 * (1 + i * 0.5)));
    return curve;
  };
  const low = build().priceFor(100000, 0.4, { explore: false }).price;
  const high = build().priceFor(100000, 40, { explore: false }).price;
  assert.strictEqual(low, high);
});

test('campaign lifecycle enforces sticky, single-settlement rules', () => {
  const market = new Market();
  const c = market.createCampaign({ budget: 10000, wantedCpi: 2, explore: false });
  market.join(c.id, { publisher: 'p1' });
  assert.throws(() => market.join(c.id, { publisher: 'p1' }), /already joined/);
  assert.throws(() => market.mint(c.id, { publisher: 'ghost', impressions: 5 }), /has not joined/);
  assert.throws(() => market.mint(c.id, { publisher: 'p1', impressions: 0 }), /must be positive/);
  market.mint(c.id, { publisher: 'p1', impressions: 100 });
  market.settleCampaign(c.id);
  assert.throws(() => market.settleCampaign(c.id), /already settled/);
  assert.throws(() => market.mint(c.id, { publisher: 'p1', impressions: 5 }), /settled/);
});

test('settling teaches the platform curve', () => {
  const market = new Market();
  assert.strictEqual(market.state().observations, 0);
  const c = market.createCampaign({ budget: 10000, wantedCpi: 2, explore: false });
  market.join(c.id, { publisher: 'p1' });
  market.mint(c.id, { publisher: 'p1', impressions: 500 });
  market.settleCampaign(c.id);
  assert.strictEqual(market.state().observations, 1);
});

test('a thin market is healed rather than charged the pool split', () => {
  const r = runMarket('thin', { campaigns: 200 });
  const mature = r.series.filter((s) => !s.warmup).slice(-100);
  const error = median(mature.map((s) => s.error));
  const poolError = median(mature.map((s) => (Math.abs(s.poolSplit - s.truth) / s.truth) * 100));
  assert.ok(error < 25, `discovered price error ${error.toFixed(1)}%`);
  assert.ok(poolError > 50, 'pool split should be badly wrong in a thin market');
  assert.ok(median(mature.map((s) => s.refundShare)) > 5, 'unspendable budget must be refunded');
});

test('discovery tracks truth in every market', () => {
  for (const name of Object.keys(MARKETS)) {
    const r = runMarket(name, { campaigns: 200 });
    const mature = r.series.filter((s) => !s.warmup).slice(-100);
    const error = median(mature.map((s) => s.error));
    assert.ok(error < 25, `${name}: ${error.toFixed(1)}%`);
  }
});
