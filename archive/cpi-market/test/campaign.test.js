'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { simulateOneCampaign, ARCHETYPES } = require('../sim/campaign');

const base = { budget: 100000, expectedCpi: 2.5, durationDays: 10 };

test('duration in days drives the hourly timeline', () => {
  for (const durationDays of [1, 7, 30]) {
    const r = simulateOneCampaign({ ...base, durationDays, archetype: 'balanced', seed: 3 });
    assert.strictEqual(r.campaign.hours, durationDays * 24);
    assert.strictEqual(r.timeline.length, durationDays * 24);
    assert.strictEqual(r.timeline[0].hour, 1);
    assert.strictEqual(r.timeline[r.timeline.length - 1].day, durationDays);
  }
});

test('coins only accumulate and the estimate only falls', () => {
  const r = simulateOneCampaign({ ...base, archetype: 'abundant', seed: 5 });
  for (let i = 1; i < r.timeline.length; i += 1) {
    assert.ok(r.timeline[i].coins >= r.timeline[i - 1].coins - 1e-9, 'coins must not shrink');
    assert.ok(r.timeline[i].estimatedCpi <= r.timeline[i - 1].estimatedCpi + 1e-9, 'estimate must not rise');
  }
});

test('the budget is conserved and never overdrawn', () => {
  for (const archetype of Object.keys(ARCHETYPES)) {
    for (const seed of [1, 2, 3]) {
      const r = simulateOneCampaign({ ...base, archetype, seed });
      const s = r.settlement;
      assert.ok(Math.abs(s.disbursed + s.refund - base.budget) < 1e-6, archetype);
      assert.ok(s.disbursed <= base.budget + 1e-9, archetype);
      assert.ok(s.refund >= -1e-9, archetype);
    }
  }
});

test('minted coins equal the sum of publisher holdings', () => {
  const r = simulateOneCampaign({ ...base, archetype: 'balanced', seed: 11 });
  const held = r.publishers.reduce((sum, p) => sum + p.coins, 0);
  assert.ok(Math.abs(r.settlement.minted - held) < 1e-6);
  const paid = r.publishers.reduce((sum, p) => sum + p.payout, 0);
  assert.ok(Math.abs(paid - r.settlement.disbursed) < 0.02);
});

test('a thin market is healed and refunded rather than charged the pool split', () => {
  let healed = 0;
  let refunded = 0;
  for (let seed = 0; seed < 12; seed += 1) {
    const s = simulateOneCampaign({ ...base, archetype: 'thin', seed }).settlement;
    if (s.minted > 0) {
      assert.ok(s.cpi <= s.poolSplit + 1e-9, 'never pays more than the pool split');
      if (s.healed) healed += 1;
      if (s.refund > 0) refunded += 1;
    }
  }
  assert.ok(healed >= 9, `thin campaigns healed: ${healed}/12`);
  assert.ok(refunded >= 9, `thin campaigns refunded: ${refunded}/12`);
});

test('abundant supply buys far more coins far cheaper than thin supply', () => {
  const average = (archetype) => {
    let coins = 0;
    let cpi = 0;
    for (let seed = 0; seed < 8; seed += 1) {
      const s = simulateOneCampaign({ ...base, archetype, seed }).settlement;
      coins += s.minted;
      cpi += s.cpi;
    }
    return { coins: coins / 8, cpi: cpi / 8 };
  };
  const thin = average('thin');
  const abundant = average('abundant');
  assert.ok(abundant.coins > thin.coins * 3, 'abundant should mint far more coins');
  assert.ok(abundant.cpi < thin.cpi / 2, 'abundant should resolve far cheaper');
  // Neither forces the budget out: publishers stop joining once dilution drops below their price.
  assert.ok(abundant.cpi * abundant.coins <= base.budget + 1e-6);
});

test('every joined publisher appears with a join hour inside the window', () => {
  const r = simulateOneCampaign({ ...base, archetype: 'earlyBurst', seed: 9 });
  for (const p of r.publishers) {
    if (p.joined !== null) {
      assert.ok(p.joined >= 1 && p.joined <= r.campaign.hours);
      assert.ok(p.coins > 0);
    } else {
      assert.strictEqual(p.coins, 0);
    }
  }
});

test('the same seed reproduces the same campaign', () => {
  const a = simulateOneCampaign({ ...base, archetype: 'random', seed: 77 });
  const b = simulateOneCampaign({ ...base, archetype: 'random', seed: 77 });
  assert.strictEqual(a.campaign.archetype, b.campaign.archetype);
  assert.strictEqual(a.settlement.cpi, b.settlement.cpi);
  assert.strictEqual(a.settlement.minted, b.settlement.minted);
});

test('bad inputs are rejected', () => {
  assert.throws(() => simulateOneCampaign({ ...base, budget: 0 }), /budget/);
  assert.throws(() => simulateOneCampaign({ ...base, expectedCpi: -1 }), /CPI/);
  assert.throws(() => simulateOneCampaign({ ...base, durationDays: 0 }), /duration/);
  assert.throws(() => simulateOneCampaign({ ...base, durationDays: 500 }), /duration/);
  assert.throws(() => simulateOneCampaign({ ...base, archetype: 'nope' }), /unknown archetype/);
});
