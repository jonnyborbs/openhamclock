const { test } = require('node:test');
const assert = require('node:assert');

const { SpotStore } = require('../lib/store.js');

const skimmerSpot = (over = {}) => ({
  spotter: 'KM3T-#',
  call: 'W1AW',
  freqKhz: 14025.1,
  mode: 'CW',
  snr: 20,
  comment: 'CW 20 dB 22 WPM CQ',
  timestamp: Date.now(),
  source: 'RBN',
  isSkimmer: true,
  ...over,
});

const humanSpot = (over = {}) => ({
  spotter: 'K0CJH',
  call: 'TX5U',
  freqKhz: 18070,
  comment: 'up 2',
  timestamp: Date.now(),
  source: 'OHC',
  isSkimmer: false,
  ...over,
});

test('skimmer spots collapse by call+band+mode', () => {
  const store = new SpotStore();
  store.add(skimmerSpot({ spotter: 'KM3T-#', snr: 20 }));
  store.add(skimmerSpot({ spotter: 'W3OA-#', snr: 31, comment: 'CW 31 dB 22 WPM CQ' }));
  store.add(skimmerSpot({ spotter: 'DL8LAS-#', snr: 12 }));

  const spots = store.query({ limit: 10 });
  assert.equal(spots.length, 1);
  assert.equal(spots[0].skimmerCount, 3);
  assert.equal(spots[0].snr, 31); // best report wins
  assert.equal(spots[0].comment, 'CW 31 dB 22 WPM CQ');
});

test('same call on different bands stays separate', () => {
  const store = new SpotStore();
  store.add(skimmerSpot({ freqKhz: 14025 }));
  store.add(skimmerSpot({ freqKhz: 7025 }));
  assert.equal(store.query({ limit: 10 }).length, 2);
});

test('human spots dedupe by spotter+call+freq window', () => {
  const store = new SpotStore();
  const ts = Date.now();
  assert.ok(store.add(humanSpot({ timestamp: ts })));
  assert.equal(store.add(humanSpot({ timestamp: ts + 1000 })), null); // dupe
  assert.ok(store.add(humanSpot({ spotter: 'W1AW', timestamp: ts }))); // different spotter is fine
  assert.equal(store.query({ limit: 10 }).length, 2);
});

test('listeners fire for new spots, not skimmer refreshes', () => {
  const store = new SpotStore();
  let fired = 0;
  store.onSpot(() => fired++);
  store.add(skimmerSpot({ spotter: 'A1AA-#' }));
  store.add(skimmerSpot({ spotter: 'B2BB-#' })); // collapse, no re-fire
  store.add(humanSpot());
  assert.equal(fired, 2);
});

test('query filters by humanOnly, band, mode', () => {
  const store = new SpotStore();
  store.add(skimmerSpot());
  store.add(humanSpot());
  assert.equal(store.query({ humanOnly: true }).length, 1);
  assert.equal(store.query({ humanOnly: true })[0].call, 'TX5U');
  assert.equal(store.query({ band: '20m' }).length, 1);
  assert.equal(store.query({ mode: 'CW' }).length, 1);
});

test('cleanup drops expired spots and their skimmer index entries', () => {
  const store = new SpotStore({ retentionMs: 1000 });
  store.add(skimmerSpot({ timestamp: Date.now() - 5000 }));
  store.add(humanSpot());
  assert.equal(store.cleanup(), 1);
  assert.equal(store.query({ limit: 10 }).length, 1);
  // The skimmer key must be gone so the same station can be spotted fresh
  store.add(skimmerSpot());
  assert.equal(store.query({ limit: 10 }).length, 2);
});

test('store caps total spots and evicts oldest', () => {
  const store = new SpotStore({ maxSpots: 5 });
  for (let i = 0; i < 10; i++) {
    store.add(humanSpot({ call: `W${i}AW`, spotter: `K${i}AB`, freqKhz: 14000 + i }));
  }
  assert.equal(store.query({ limit: 100 }).length, 5);
});

test('rejects spots with missing or invalid fields', () => {
  const store = new SpotStore();
  assert.equal(store.add({ spotter: '', call: 'W1AW', freqKhz: 14000 }), null);
  assert.equal(store.add({ spotter: 'K0CJH', call: 'W1AW', freqKhz: -5 }), null);
  assert.equal(store.add({ spotter: 'K0CJH', call: '', freqKhz: 14000 }), null);
});
