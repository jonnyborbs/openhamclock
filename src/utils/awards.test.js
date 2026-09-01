import { describe, expect, it } from 'vitest';

import {
  computeAwards,
  bandBreakdown,
  modeBreakdown,
  neededSet,
  spotAwardStatus,
  spotBadge,
  qsoBand,
  vuccGrid,
  US_STATES,
  WAZ_TOTAL,
} from './awards.js';

// Injected resolver — tests must not depend on cty.dat being fetched.
// Mirrors ctyLookup's output shape ({ entity, dxcc, cq, cont, ... }).
const CTY = {
  K1ABC: { entity: 'United States', dxcc: 'K', cq: 5, cont: 'NA' },
  W1AW: { entity: 'United States', dxcc: 'K', cq: 5, cont: 'NA' },
  OZ6ABL: { entity: 'Denmark', dxcc: 'OZ', cq: 14, cont: 'EU' },
  JA1XYZ: { entity: 'Japan', dxcc: 'JA', cq: 25, cont: 'AS' },
  P5DX: { entity: 'North Korea', dxcc: 'P5', cq: 25, cont: 'AS' },
};
const resolve = (call) => CTY[String(call).toUpperCase()] || null;

const qso = (call, over = {}) => ({ call, qso_date: '20260801', time_on: '120000', ...over });

describe('qsoBand / vuccGrid', () => {
  it('derives band from freq (MHz) and falls back to an ADIF band tag', () => {
    expect(qsoBand({ freq: 14.074 })).toBe('20m');
    expect(qsoBand({ band: '40M' })).toBe('40m');
    expect(qsoBand({ band: '70cm' })).toBe('70cm');
    expect(qsoBand({ band: 'nonsense' })).toBe(null);
    expect(qsoBand({})).toBe(null);
  });

  it('extracts valid 4-char grids and rejects junk', () => {
    expect(vuccGrid('FN31pr')).toBe('FN31');
    expect(vuccGrid('jo65')).toBe('JO65');
    expect(vuccGrid('ZZ99')).toBe(null); // field letters only go to R
    expect(vuccGrid('FN3')).toBe(null);
    expect(vuccGrid('')).toBe(null);
    expect(vuccGrid(null)).toBe(null);
  });
});

describe('computeAwards — entity counting', () => {
  it('counts unique DXCC entities with per-band and per-mode sets', () => {
    const awards = computeAwards(
      [
        qso('K1ABC', { freq: 14.074, mode: 'FT8' }),
        qso('W1AW', { freq: 7.03, mode: 'CW' }), // same entity, different call
        qso('OZ6ABL', { freq: 14.2, mode: 'USB' }),
      ],
      { resolve },
    );

    expect(awards.totalQsos).toBe(3);
    expect(awards.dxcc.worked.size).toBe(2); // K + OZ
    const k = awards.dxcc.worked.get('K');
    expect(k.count).toBe(2);
    expect(k.entity).toBe('United States');
    expect(k.bands.has('20m')).toBe(true);
    expect(k.bands.has('40m')).toBe(true);
    expect(k.modes.has('FT8')).toBe(true);
    expect(k.modes.has('CW')).toBe(true);
    expect(k.bandModes.has('40m|CW')).toBe(true);
    // Phone submodes normalize (USB → SSB), same as the worked-before index.
    expect(awards.dxcc.worked.get('OZ').modes.has('SSB')).toBe(true);
  });

  it('counts unresolvable calls as unresolved, not as entities', () => {
    const awards = computeAwards([qso('K1ABC', { freq: 14.0 }), qso('X9XX', { freq: 14.0 })], { resolve });
    expect(awards.dxcc.worked.size).toBe(1);
    expect(awards.dxcc.unresolved).toBe(1);
  });

  it('derives WAZ zones from the resolver and prefers an explicit ADIF CQZ', () => {
    const awards = computeAwards(
      [
        qso('JA1XYZ', { freq: 21.0, mode: 'CW' }), // zone 25 from resolver
        qso('K1ABC', { freq: 14.0, extras: { CQZ: '3' } }), // West-coast K — CQZ wins over prefix zone 5
        qso('OZ6ABL', { extras: { CQZ: '99' } }), // invalid CQZ → resolver zone 14
      ],
      { resolve },
    );
    expect([...awards.waz.worked.keys()].sort((a, b) => a - b)).toEqual([3, 14, 25]);
    expect(awards.waz.worked.get(25).bands.has('15m')).toBe(true);
  });

  it('counts WAS only from the ADIF STATE field (never guessed)', () => {
    const awards = computeAwards(
      [
        qso('K1ABC', { freq: 14.0, extras: { STATE: 'CT' } }),
        qso('W1AW', { freq: 7.0 }), // US call but no STATE → not counted
        qso('K1ABC', { freq: 7.0, extras: { STATE: 'xx' } }), // not a state
      ],
      { resolve },
    );
    expect(awards.was.worked.size).toBe(1);
    expect(awards.was.worked.has('CT')).toBe(true);
    expect(awards.was.qsosWithState).toBe(1);
    expect(US_STATES.size).toBe(50);
  });

  it('counts VUCC as unique 4-char grids with per-band sets', () => {
    const awards = computeAwards(
      [
        qso('K1ABC', { freq: 50.313, gridsquare: 'FN31pr' }),
        qso('W1AW', { freq: 144.2, gridsquare: 'FN31ab' }), // same 4-char grid
        qso('OZ6ABL', { freq: 50.313, gridsquare: 'JO65' }),
      ],
      { resolve },
    );
    expect(awards.vucc.worked.size).toBe(2);
    expect(awards.vucc.worked.get('FN31').bands.has('6m')).toBe(true);
    expect(awards.vucc.worked.get('FN31').bands.has('2m')).toBe(true);
  });

  it('handles empty and malformed input', () => {
    expect(computeAwards([], { resolve }).totalQsos).toBe(0);
    expect(computeAwards(null, { resolve }).dxcc.worked.size).toBe(0);
    expect(computeAwards([{}, null, { freq: 14 }], { resolve }).totalQsos).toBe(0); // no call → skipped
  });
});

describe('breakdown helpers', () => {
  it('summarizes entities per band and per mode', () => {
    const awards = computeAwards(
      [
        qso('K1ABC', { freq: 14.0, mode: 'CW' }),
        qso('OZ6ABL', { freq: 14.2, mode: 'SSB' }),
        qso('OZ6ABL', { freq: 7.1, mode: 'SSB' }),
      ],
      { resolve },
    );
    expect(bandBreakdown(awards.dxcc.worked)).toEqual({ '20m': 2, '40m': 1 });
    expect(modeBreakdown(awards.dxcc.worked)).toEqual({ CW: 1, SSB: 1 });
  });
});

describe('neededSet', () => {
  const awards = computeAwards(
    [
      qso('JA1XYZ', { freq: 14.0, mode: 'CW', extras: { STATE: undefined } }),
      qso('K1ABC', { freq: 14.0, extras: { STATE: 'CT' } }),
    ],
    { resolve },
  );

  it('returns all unworked zones for WAZ', () => {
    const needed = neededSet(awards, 'waz');
    expect(needed.size).toBe(WAZ_TOTAL - 2); // zones 25 and 5 worked
    expect(needed.has(25)).toBe(false);
    expect(needed.has(5)).toBe(false);
    expect(needed.has(1)).toBe(true);
  });

  it('returns unworked states for WAS', () => {
    const needed = neededSet(awards, 'was');
    expect(needed.size).toBe(49);
    expect(needed.has('CT')).toBe(false);
    expect(needed.has('WY')).toBe(true);
  });

  it('scopes needed to a band (worked, but not on this band, is needed)', () => {
    const needed = neededSet(awards, 'waz', { band: '40m' });
    expect(needed.size).toBe(WAZ_TOTAL); // nothing worked on 40m yet
    expect(needed.has(25)).toBe(true);
  });

  it('scopes needed to band+mode', () => {
    const needed20cw = neededSet(awards, 'waz', { band: '20m', mode: 'CW' });
    expect(needed20cw.has(25)).toBe(false); // JA worked 20m CW
    expect(needed20cw.has(5)).toBe(true); // K worked 20m but mode unknown
  });

  it('returns null for open-ended or unknown universes', () => {
    expect(neededSet(awards, 'vucc')).toBe(null);
    // dxcc universe needs cty.dat entities — not loaded in tests
    expect(neededSet(awards, 'dxcc')).toBe(null);
  });
});

describe('spotAwardStatus', () => {
  const awards = computeAwards(
    [qso('K1ABC', { freq: 14.074, mode: 'FT8' }), qso('OZ6ABL', { freq: 7.1, mode: 'SSB' })],
    { resolve },
  );

  it('flags an unworked entity as new (ATNO)', () => {
    expect(spotAwardStatus(awards, 'P5DX', 14.074, { resolve })).toBe('new');
  });

  it('flags a worked entity on a new band as new-band', () => {
    expect(spotAwardStatus(awards, 'W1AW', 7.03, { resolve })).toBe('new-band'); // K worked, but only on 20m
    expect(spotAwardStatus(awards, 'W1AW', 7030, { resolve })).toBe('new-band'); // kHz input
  });

  it('returns null for a worked entity on a worked band', () => {
    expect(spotAwardStatus(awards, 'W1AW', 14.2, { resolve })).toBe(null);
  });

  it('returns null without a frequency when the entity is worked', () => {
    expect(spotAwardStatus(awards, 'W1AW', null, { resolve })).toBe(null);
  });

  it('returns null for unresolvable calls, empty logs, and missing input', () => {
    expect(spotAwardStatus(awards, 'X9XX', 14.0, { resolve })).toBe(null);
    expect(spotAwardStatus(computeAwards([], { resolve }), 'P5DX', 14.0, { resolve })).toBe(null);
    expect(spotAwardStatus(awards, '', 14.0, { resolve })).toBe(null);
    expect(spotAwardStatus(null, 'P5DX', 14.0, { resolve })).toBe(null);
  });

  it('stays quiet when no logged QSO resolved (cty.dat was not loaded)', () => {
    const blind = computeAwards([qso('K1ABC', { freq: 14.0 })], { resolve: () => null });
    expect(blind.dxcc.unresolved).toBe(1);
    expect(spotAwardStatus(blind, 'P5DX', 14.0, { resolve })).toBe(null);
  });
});

describe('spotBadge precedence', () => {
  it('orders new > new-band > worked-status', () => {
    expect(spotBadge('new', 'dupe')).toBe('new');
    expect(spotBadge('new', null)).toBe('new');
    expect(spotBadge('new-band', 'worked')).toBe('new-band');
    expect(spotBadge('new-band', 'dupe')).toBe('new-band');
    expect(spotBadge(null, 'dupe')).toBe('dupe');
    expect(spotBadge(null, 'worked')).toBe('worked');
    expect(spotBadge(null, null)).toBe(null);
  });
});
