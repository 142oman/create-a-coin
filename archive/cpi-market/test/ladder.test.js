'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { PublisherGame, RUNG_SUCCESS } = require('../sim/ladder');

function game() {
  const g = new PublisherGame();
  g.refreshOffers(11);
  return g;
}

function mulberry(a) {
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd) {
  let u = 0;
  while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

test('rungs are cumulative, strictly rising, and priced at the whole position', () => {
  const s = game().join('offer-2');
  let previous = 0;
  for (const r of s.ladder) {
    assert.ok(r.need > 0);
    assert.strictEqual(r.cumulativeCoins, Math.round(s.coins + r.need));
    assert.ok(r.cumulativeCoins > previous, 'a ladder whose rungs are equal is not a ladder');
    previous = r.cumulativeCoins;
    assert.ok(Math.abs(r.cumulativeEarnings - r.cumulativeCoins * r.cumulativeCpi) < 1e-6);
  }
});

test('rungs clear at roughly their advertised odds', () => {
  // Publishers with a real, stable ability. The ladder should track them, not outrun them.
  const clears = [0, 0, 0];
  let steps = 0;
  // Publishers comfortably above the market floor. Below it the ladder is meant to be hard.
  for (const [capability, spread, offer] of [[200, 0.2, 'offer-2'], [200, 0.45, 'offer-2'], [200, 0.8, 'offer-2']]) {
    for (let run = 0; run < 40; run += 1) {
      const g = game();
      let s = g.join(offer);
      const rnd = mulberry(500 + run);
      for (let i = 0; i < 12 && s.status === 'active'; i += 1) {
        const delivered = Math.max(0, Math.round(capability * Math.exp(spread * gauss(rnd))));
        if (!s.ladder[0].saturated) {
          s.ladder.forEach((r, k) => { if (delivered >= r.need) clears[k] += 1; });
          steps += 1;
        }
        s = g.step(s.id, delivered);
      }
    }
  }
  const rates = clears.map((c) => c / steps);
  const bands = [[0.76, 0.94], [0.40, 0.60], [0.15, 0.34]];
  rates.forEach((rate, i) => {
    assert.ok(rate >= bands[i][0] && rate <= bands[i][1],
      `rung ${i + 1} advertised ${RUNG_SUCCESS[i] * 100}%, measured ${(rate * 100).toFixed(0)}%`);
  });
});

test('the first rung sits at or below typical delivery, so it is actually achievable', () => {
  const g = game();
  let s = g.join('offer-2');
  const rnd = mulberry(7);
  for (let i = 0; i < 10 && s.status === 'active'; i += 1) {
    s = g.step(s.id, Math.max(0, Math.round(300 * Math.exp(0.35 * gauss(rnd)))));
    if (!s.ladder[0].saturated && !s.atFloor) {
      assert.ok(s.ladder[0].need <= s.typical * 1.05,
        `first rung ${s.ladder[0].need} must not outrun typical delivery ${s.typical}`);
    }
  }
});

test('one lucky step does not drag the bar out of reach', () => {
  const g = game();
  let s = g.join('offer-2');
  for (let i = 0; i < 4; i += 1) s = g.step(s.id, 200);
  const before = s.ladder[0].need;
  s = g.step(s.id, 2000); // a ten-times spike
  assert.ok(s.ladder[0].need < before * 2.5,
    `bar jumped from ${before} to ${s.ladder[0].need} on a single spike`);
});

test('sustained improvement does move the bar up', () => {
  const g = game();
  let s = g.join('offer-2');
  for (let i = 0; i < 4; i += 1) s = g.step(s.id, 200);
  const before = s.ladder[0].need;
  for (let i = 0; i < 6; i += 1) s = g.step(s.id, 600);
  assert.ok(s.ladder[0].need > before * 1.8,
    `bar only moved ${before} -> ${s.ladder[0].need} after sustained tripling`);
});

test('sustained decline eases the bar', () => {
  const g = game();
  let s = g.join('offer-2');
  for (let i = 0; i < 5; i += 1) s = g.step(s.id, 600);
  const before = s.ladder[0].need;
  for (let i = 0; i < 6; i += 1) s = g.step(s.id, 100);
  assert.ok(s.ladder[0].need < before, `bar did not ease: ${before} -> ${s.ladder[0].need}`);
});

test('the bar is not monotonic: difficulty is paced, not ramped', () => {
  const g = game();
  let s = g.join('offer-2');
  const rnd = mulberry(3);
  let ups = 0;
  let downs = 0;
  let previous = s.ladder[0].need;
  for (let i = 0; i < 14 && s.status === 'active'; i += 1) {
    s = g.step(s.id, Math.max(0, Math.round(250 * Math.exp(0.3 * gauss(rnd)))));
    if (!s.ladder.length) break;
    const next = s.ladder[0].need;
    if (next > previous) ups += 1;
    if (next < previous) downs += 1;
    previous = next;
  }
  assert.ok(downs > 0, 'the bar must sometimes come down');
  assert.ok(ups > 0, 'and sometimes go up');
});

test('a run of strong steps earns a recovery beat', () => {
  const g = game();
  let s = g.join('offer-2');
  for (let i = 0; i < 3; i += 1) s = g.step(s.id, s.ladder[2].need);
  assert.strictEqual(s.mode, 'recovery');
  assert.strictEqual(s.ladder[0].label, 'breather');
});

test('a missed bar holds before it eases at all', () => {
  const g = game();
  let s = g.join('offer-2');
  for (let i = 0; i < 3; i += 1) s = g.step(s.id, 400);
  const held = s.bar;
  s = g.step(s.id, 1);
  assert.strictEqual(s.bar, held, 'one miss must not move the bar');
  s = g.step(s.id, 1);
  assert.strictEqual(s.bar, held, 'nor the second, within the grace period');
  s = g.step(s.id, 1);
  assert.ok(s.bar < held, 'only then does it start to ease');
});

test('the bar eases gradually and stops at the market floor', () => {
  const g = game();
  let s = g.join('offer-2');
  for (let i = 0; i < 3; i += 1) s = g.step(s.id, 400);
  let previous = s.bar;
  const drops = [];
  for (let i = 0; i < 20 && s.status === 'active'; i += 1) {
    s = g.step(s.id, 1);
    if (s.bar < previous) drops.push(previous / s.bar);
    assert.ok(s.bar >= s.floor, 'the bar must never fall below the market floor');
    previous = s.bar;
  }
  assert.strictEqual(s.status, 'active', 'the campaign should still be running for this check');
  assert.ok(drops.length > 3, 'it should ease over several steps, not collapse at once');
  assert.ok(Math.max(...drops) < 1.3, 'and ease gradually rather than in one plunge');
  assert.strictEqual(s.bar, s.floor, 'settling exactly at the floor');
  assert.ok(s.atFloor);
  assert.strictEqual(s.ladder[0].label, 'minimum to stay in');
});

test('a publisher below the market floor cannot simply clear the bar', () => {
  const g = game();
  let s = g.join('offer-2');
  let cleared = 0;
  const trickle = Math.max(1, Math.round(s.floor * 0.2));
  for (let i = 0; i < 20 && s.status === 'active'; i += 1) {
    s = g.step(s.id, trickle);
    cleared += s.lastStep.cleared > 0 ? 1 : 0;
  }
  assert.strictEqual(cleared, 0, 'delivering a fifth of the market minimum should never clear a rung');
  assert.ok(s.floor > trickle);
});

test('a near miss is not punished', () => {
  const g = game();
  let s = g.join('offer-2');
  for (let i = 0; i < 3; i += 1) s = g.step(s.id, 300);
  const streak = s.streak;
  const asked = s.ladder[0].need;
  s = g.step(s.id, Math.round(asked * 0.95));
  assert.ok(s.lastStep.nearMiss, 'delivering 95% of the ask is a near miss');
  assert.strictEqual(s.streak, streak, 'a near miss keeps the streak');
});

test('settlement pays the publisher its share at one price', () => {
  const g = game();
  let s = g.join('offer-1');
  while (s.status === 'active') s = g.step(s.id, s.ladder[0].need);
  const f = s.settlement;
  assert.ok(Math.abs(f.yourPayout - f.yourCoins * f.cpi) < 0.02);
  assert.ok(Math.abs(f.yourShare - f.yourCoins / f.minted) < 1e-9);
  assert.ok(f.cpi <= f.poolSplit + 1e-9, 'never pays more than the pool split');
  assert.ok(f.disbursed + f.refund <= s.campaign.budget + 1e-6);
});

test('tiers track share of the pool', () => {
  const g = game();
  let s = g.join('offer-1');
  assert.strictEqual(s.tier.current, null);
  for (let i = 0; i < 8 && s.status === 'active'; i += 1) s = g.step(s.id, s.ladder[2].need);
  assert.ok(s.tier.share > 0);
  assert.ok(s.tier.current !== null, 'delivering hard should reach at least the first tier');
});

test('a settled campaign refuses further steps, and bad input is rejected', () => {
  const g = game();
  let s = g.join('offer-3');
  while (s.status === 'active') s = g.step(s.id, s.ladder[0].need);
  assert.throws(() => g.step(s.id, 10), /already settled/);
  const t = g.join('offer-1');
  assert.throws(() => g.step(t.id, -5), /zero or more/);
  assert.throws(() => g.step(t.id, 'lots'), /zero or more/);
  assert.throws(() => g.join('offer-99'), /no campaign/);
  assert.throws(() => g.view('nope'), /no session/);
});
