import { describe, it, expect } from 'vitest';
import {
  CONTEST_DEFS,
  DEFAULT_CONTEST_ID,
  getContestDef,
  isWve,
  resolveAdifContestId,
  sentFieldsFor,
  sentExchangeReady,
  wpxPrefix,
  nextSentSerial,
  buildQsoContestFields,
  formatRcvdExchange,
  multDimsFor,
  dimValue,
  computeContestMults,
} from './contestDefs.js';
import { buildAdif } from './adif.js';

const T0 = Date.UTC(2026, 7, 28, 12, 0, 0);

const qso = (call, minsAfterStart, fields = {}) => {
  const d = new Date(T0 + minsAfterStart * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    call,
    qso_date: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`,
    time_on: `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`,
    band: '20m',
    ...fields,
  };
};

// Deterministic resolver — no cty.dat in tests.
const resolve = (call) => {
  const map = {
    W1AW: { dxcc: 'K', entity: 'United States', cq: 5, itu: 8 },
    K5ZD: { dxcc: 'K', entity: 'United States', cq: 4, itu: 7 },
    DL1ABC: { dxcc: 'DL', entity: 'Germany', cq: 14, itu: 28 },
    JA1XYZ: { dxcc: 'JA', entity: 'Japan', cq: 25, itu: 45 },
    'PJ2/W9WI': { dxcc: 'PJ2', entity: 'Curacao', cq: 9, itu: 11 },
  };
  return map[call] || null;
};

const WVE = { dxcc: 'K', cq: 4, itu: 7 };
const DX = { dxcc: 'DL', cq: 14, itu: 28 };

describe('registry shape', () => {
  it('has unique ids and a generic default', () => {
    const ids = CONTEST_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_CONTEST_ID);
  });

  it('every def has a non-empty exchange with widths and labels', () => {
    for (const d of CONTEST_DEFS) {
      expect(d.exchange.length, d.id).toBeGreaterThan(0);
      for (const f of d.exchange) {
        expect(typeof f.key, d.id).toBe('string');
        expect(typeof f.label, d.id).toBe('string');
      }
    }
  });

  it('falls back to the generic def for unknown ids', () => {
    expect(getContestDef('nope').id).toBe(DEFAULT_CONTEST_ID);
    expect(getContestDef(undefined).id).toBe(DEFAULT_CONTEST_ID);
    expect(getContestDef('arrl-ss').id).toBe('arrl-ss');
  });

  it('picks CONTEST_ID variants by mode', () => {
    expect(resolveAdifContestId(getContestDef('cq-ww'), 'CW')).toBe('CQ-WW-CW');
    expect(resolveAdifContestId(getContestDef('cq-ww'), 'SSB')).toBe('CQ-WW-SSB');
    expect(resolveAdifContestId(getContestDef('cq-ww'), 'RTTY')).toBe('CQ-WW-RTTY');
    expect(resolveAdifContestId(getContestDef('cq-wpx'), 'SSB')).toBe('CQ-WPX-SSB');
    expect(resolveAdifContestId(getContestDef('arrl-ss'), 'CW')).toBe('ARRL-SS-CW');
    expect(resolveAdifContestId(getContestDef('arrl-fd'), 'SSB')).toBe('ARRL-FIELD-DAY');
    expect(resolveAdifContestId(getContestDef('naqp'), 'RTTY')).toBe('NAQP-RTTY');
    expect(resolveAdifContestId(getContestDef('generic-dx'), 'CW')).toBeNull();
  });
});

describe('ARRL DX side detection', () => {
  it('W and VE resolve as the W/VE side', () => {
    expect(isWve({ dxcc: 'K' })).toBe(true);
    expect(isWve({ dxcc: 'VE' })).toBe(true);
    expect(isWve({ dxcc: 'DL' })).toBe(false);
    expect(isWve(null)).toBe(false);
  });

  it('sent fields adapt to the side: W/VE sends state, DX sends power', () => {
    const def = getContestDef('arrl-dx');
    expect(sentFieldsFor(def, WVE).map((f) => f.key)).toEqual(['state']);
    expect(sentFieldsFor(def, DX).map((f) => f.key)).toEqual(['power']);
  });

  it('mult dimension adapts: dxcc for W/VE, states/provinces for DX', () => {
    const def = getContestDef('arrl-dx');
    expect(multDimsFor(def, WVE)).toEqual(['dxcc']);
    expect(multDimsFor(def, DX)).toEqual(['stprov']);
  });
});

describe('sentExchangeReady', () => {
  it('requires every sent field to be present and valid', () => {
    const fd = getContestDef('arrl-fd');
    expect(sentExchangeReady(fd, {}, null)).toBe(false);
    expect(sentExchangeReady(fd, { class: '3A' }, null)).toBe(false);
    expect(sentExchangeReady(fd, { class: '3A', section: 'STX' }, null)).toBe(true);
    expect(sentExchangeReady(fd, { class: 'XX', section: 'STX' }, null)).toBe(false);
  });

  it('defs with no sent fields are always ready', () => {
    expect(sentExchangeReady(getContestDef('generic-dx'), {}, null)).toBe(true);
    expect(sentExchangeReady(getContestDef('cq-wpx'), {}, null)).toBe(true);
  });
});

describe('wpxPrefix', () => {
  it('extracts the standard prefix from plain calls', () => {
    expect(wpxPrefix('K5AB')).toBe('K5');
    expect(wpxPrefix('DL1ABC')).toBe('DL1');
    expect(wpxPrefix('W1AW')).toBe('W1');
    expect(wpxPrefix('N8BJQ')).toBe('N8');
    expect(wpxPrefix('4X4ABC')).toBe('4X4');
    expect(wpxPrefix('KH6ABC')).toBe('KH6');
  });

  it('uses the operating-entity designator of compound calls', () => {
    expect(wpxPrefix('PJ2/W9WI')).toBe('PJ2');
    expect(wpxPrefix('W9WI/PJ2')).toBe('PJ2');
    expect(wpxPrefix('5Z4/DL1ABC')).toBe('5Z4');
  });

  it('appends 0 to digitless designators and calls', () => {
    expect(wpxPrefix('PA/W1AW')).toBe('PA0');
    expect(wpxPrefix('LX/DJ1ABC')).toBe('LX0');
    expect(wpxPrefix('RAEM')).toBe('RA0');
  });

  it('replaces the district digit for /n portable calls', () => {
    expect(wpxPrefix('W9WI/7')).toBe('W7');
    expect(wpxPrefix('KH6XYZ/1')).toBe('KH1');
    expect(wpxPrefix('K5AB/0')).toBe('K0');
  });

  it('ignores single-letter and operating suffixes', () => {
    expect(wpxPrefix('W9WI/P')).toBe('W9');
    expect(wpxPrefix('DL1ABC/M')).toBe('DL1');
    expect(wpxPrefix('G4ABC/MM')).toBe('G4');
    expect(wpxPrefix('K5AB/QRP')).toBe('K5');
  });

  it('returns null for garbage', () => {
    expect(wpxPrefix('')).toBeNull();
    expect(wpxPrefix(null)).toBeNull();
    expect(wpxPrefix('///')).toBeNull();
  });
});

describe('nextSentSerial', () => {
  it('is session QSO count + 1, recomputed from the log', () => {
    expect(nextSentSerial([], T0)).toBe(1);
    const list = [qso('W1AW', -10), qso('K5ZD', 1), qso('DL1ABC', 2)];
    expect(nextSentSerial(list, T0)).toBe(3); // pre-session QSO ignored
  });

  it('is 1 without a session', () => {
    expect(nextSentSerial([qso('W1AW', 0)], undefined)).toBe(1);
  });
});

describe('buildQsoContestFields — ADIF mapping', () => {
  it('CQ WW: CQZ + MY_CQ_ZONE + composites + CONTEST_ID by mode', () => {
    const r = buildQsoContestFields(getContestDef('cq-ww'), {
      mode: 'CW',
      rcvd: { rst: '599', zone: '14' },
      sent: { zone: '5' },
    });
    expect(r.rstRcvd).toBe('599');
    expect(r.extras).toEqual({
      CONTEST_ID: 'CQ-WW-CW',
      CQZ: '14',
      SRX_STRING: '14',
      MY_CQ_ZONE: '5',
      STX_STRING: '5',
    });
  });

  it('CQ WPX: STX/SRX serials', () => {
    const r = buildQsoContestFields(getContestDef('cq-wpx'), {
      mode: 'SSB',
      rcvd: { rst: '59', serial: '123' },
      serialSent: 45,
    });
    expect(r.extras.CONTEST_ID).toBe('CQ-WPX-SSB');
    expect(r.extras.STX).toBe('45');
    expect(r.extras.SRX).toBe('123');
    expect(r.extras.SRX_STRING).toBe('123');
    expect(r.extras.STX_STRING).toBe('45');
  });

  it('ARRL SS: serial + precedence + check + section', () => {
    const r = buildQsoContestFields(getContestDef('arrl-ss'), {
      mode: 'CW',
      rcvd: { serial: '123', prec: 'A', check: '72', section: 'CT' },
      sent: { prec: 'B', check: '85', section: 'STX' },
      serialSent: 7,
    });
    expect(r.extras.CONTEST_ID).toBe('ARRL-SS-CW');
    expect(r.extras.SRX).toBe('123');
    expect(r.extras.PRECEDENCE).toBe('A');
    expect(r.extras.CHECK).toBe('72');
    expect(r.extras.ARRL_SECT).toBe('CT');
    expect(r.extras.SRX_STRING).toBe('123 A 72 CT');
    expect(r.extras.STX).toBe('7');
    expect(r.extras.STX_STRING).toBe('7 B 85 STX');
    expect(r.rstRcvd).toBeNull(); // SS has no RST
  });

  it('ARRL Field Day: CLASS + ARRL_SECT', () => {
    const r = buildQsoContestFields(getContestDef('arrl-fd'), {
      mode: 'SSB',
      rcvd: { class: '3A', section: 'EMA' },
      sent: { class: '2A', section: 'STX' },
    });
    expect(r.extras.CONTEST_ID).toBe('ARRL-FIELD-DAY');
    expect(r.extras.CLASS).toBe('3A');
    expect(r.extras.ARRL_SECT).toBe('EMA');
    expect(r.extras.SRX_STRING).toBe('3A EMA');
    expect(r.extras.STX_STRING).toBe('2A STX');
  });

  it('ARRL DX: state token → STATE, power token → RX_PWR, KW → 1000', () => {
    const def = getContestDef('arrl-dx');
    const state = buildQsoContestFields(def, { mode: 'CW', rcvd: { rst: '599', exch: 'CT' } });
    expect(state.extras.STATE).toBe('CT');
    expect(state.extras.RX_PWR).toBeUndefined();

    const pwr = buildQsoContestFields(def, { mode: 'CW', rcvd: { rst: '599', exch: '100' } });
    expect(pwr.extras.RX_PWR).toBe('100');
    expect(pwr.extras.STATE).toBeUndefined();

    const kw = buildQsoContestFields(def, { mode: 'CW', rcvd: { rst: '599', exch: 'KW' } });
    expect(kw.extras.RX_PWR).toBe('1000');
  });

  it('ARRL DX sent side: W/VE state → MY_STATE, DX power → core tx_pwr', () => {
    const def = getContestDef('arrl-dx');
    const wve = buildQsoContestFields(def, {
      mode: 'CW',
      rcvd: { rst: '599', exch: '100' },
      sent: { state: 'MO' },
      myResolved: WVE,
    });
    expect(wve.extras.MY_STATE).toBe('MO');
    expect(wve.extras.STX_STRING).toBe('MO');

    const dx = buildQsoContestFields(def, {
      mode: 'CW',
      rcvd: { rst: '599', exch: 'CT' },
      sent: { power: '500' },
      myResolved: DX,
    });
    expect(dx.core.tx_pwr).toBe('500');
    expect(dx.extras.STX_STRING).toBe('500');
  });

  it('IARU HF: numeric zone → ITUZ, society → SRX_STRING only', () => {
    const def = getContestDef('iaru-hf');
    const zone = buildQsoContestFields(def, { mode: 'CW', rcvd: { rst: '599', zone: '28' }, sent: { zone: '7' } });
    expect(zone.extras.ITUZ).toBe('28');
    expect(zone.extras.MY_ITU_ZONE).toBe('7');

    const soc = buildQsoContestFields(def, { mode: 'CW', rcvd: { rst: '599', zone: 'DARC' } });
    expect(soc.extras.ITUZ).toBeUndefined();
    expect(soc.extras.SRX_STRING).toBe('DARC');
  });

  it('NAQP: name → core name, qth → STATE, MY_NAME/MY_STATE sent', () => {
    const r = buildQsoContestFields(getContestDef('naqp'), {
      mode: 'CW',
      rcvd: { name: 'MIKE', qth: 'TX' },
      sent: { name: 'CHRIS', qth: 'MO' },
    });
    expect(r.extras.CONTEST_ID).toBe('NAQP-CW');
    expect(r.core.name).toBe('MIKE');
    expect(r.extras.STATE).toBe('TX');
    expect(r.extras.SRX_STRING).toBe('MIKE TX');
    expect(r.extras.MY_NAME).toBe('CHRIS');
    expect(r.extras.MY_STATE).toBe('MO');
  });

  it('generic DX: no CONTEST_ID, RST only, empty extras', () => {
    const r = buildQsoContestFields(getContestDef('generic-dx'), { mode: 'SSB', rcvd: { rst: '59' } });
    expect(r.rstRcvd).toBe('59');
    expect(r.extras).toEqual({});
  });

  it('round-trips through buildAdif — extras land verbatim in the export', () => {
    const contest = buildQsoContestFields(getContestDef('cq-ww'), {
      mode: 'CW',
      rcvd: { rst: '599', zone: '14' },
      sent: { zone: '5' },
    });
    const adif = buildAdif([
      {
        call: 'DL1ABC',
        qso_date: '20260828',
        time_on: '120000',
        band: '20m',
        mode: 'CW',
        rst_sent: '599',
        rst_rcvd: '599',
        extras: contest.extras,
      },
    ]);
    expect(adif).toContain('<CONTEST_ID:8>CQ-WW-CW');
    expect(adif).toContain('<CQZ:2>14');
    expect(adif).toContain('<SRX_STRING:2>14');
    expect(adif).toContain('<STX_STRING:1>5');
    expect(adif).toContain('<MY_CQ_ZONE:1>5');
  });
});

describe('formatRcvdExchange', () => {
  it('prefers SRX_STRING, then #SRX, then rst_rcvd', () => {
    expect(formatRcvdExchange({ extras: { SRX_STRING: '123 A 72 CT' } })).toBe('123 A 72 CT');
    expect(formatRcvdExchange({ extras: { SRX: '42' } })).toBe('#42');
    expect(formatRcvdExchange({ rst_rcvd: '599', extras: {} })).toBe('599');
    expect(formatRcvdExchange({})).toBe('');
  });
});

describe('dimValue', () => {
  it('ituz uses ITUZ, then a lettered SRX_STRING society, then cty', () => {
    expect(dimValue('ituz', { extras: { ITUZ: '28' } }, null)).toBe(28);
    expect(dimValue('ituz', { extras: { SRX_STRING: 'DARC' } }, null)).toBe('DARC');
    expect(dimValue('ituz', { extras: {} }, { itu: 45 })).toBe(45);
  });

  it('stprov accepts provinces that state rejects', () => {
    expect(dimValue('stprov', { extras: { STATE: 'ON' } }, null)).toBe('ON');
    expect(dimValue('state', { extras: { STATE: 'ON' } }, null)).toBeNull();
    expect(dimValue('state', { extras: { STATE: 'MO' } }, null)).toBe('MO');
  });
});

describe('computeContestMults — per-def multipliers', () => {
  it('CQ WW counts zones AND entities', () => {
    const list = [
      qso('W1AW', 1, { extras: { CQZ: '5' } }),
      qso('K5ZD', 2, { extras: { CQZ: '4' } }),
      qso('DL1ABC', 3, { extras: { CQZ: '14' } }),
    ];
    const m = computeContestMults(list, { startedAt: T0, def: getContestDef('cq-ww'), resolve });
    expect(m.qsoCount).toBe(3);
    const byKey = Object.fromEntries(m.dims.map((d) => [d.key, d.values]));
    expect(byKey.cqzone.size).toBe(3); // 5, 4, 14
    expect(byKey.dxcc.size).toBe(2); // K, DL
    expect(m.multTotal).toBe(5);
    expect(m.score).toBe(15);
  });

  it('CQ WPX counts unique prefixes', () => {
    const list = [qso('W1AW', 1), qso('K5ZD', 2), qso('K5AB', 3), qso('PJ2/W9WI', 4)];
    const m = computeContestMults(list, { startedAt: T0, def: getContestDef('cq-wpx'), resolve });
    const prefixes = m.dims[0].values;
    expect([...prefixes].sort()).toEqual(['K5', 'PJ2', 'W1']); // K5 counted once
    expect(m.score).toBe(4 * 3);
  });

  it('Sweepstakes counts sections from the logged exchange', () => {
    const list = [
      qso('W1AW', 1, { extras: { ARRL_SECT: 'CT' } }),
      qso('K5ZD', 2, { extras: { ARRL_SECT: 'STX' } }),
      qso('K5AB', 3, { extras: { ARRL_SECT: 'CT' } }),
    ];
    const m = computeContestMults(list, { startedAt: T0, def: getContestDef('arrl-ss'), resolve });
    expect(m.dims[0].key).toBe('section');
    expect(m.dims[0].values.size).toBe(2);
    expect(m.score).toBe(6);
  });

  it('Field Day has no scoring mults — score is plain QSOs, sections tracked as info', () => {
    const list = [qso('W1AW', 1, { extras: { ARRL_SECT: 'EMA' } }), qso('K5ZD', 2, { extras: { ARRL_SECT: 'STX' } })];
    const m = computeContestMults(list, { startedAt: T0, def: getContestDef('arrl-fd'), resolve });
    expect(m.scoring).toBe(false);
    expect(m.score).toBe(2);
    expect(m.dims).toHaveLength(1);
    expect(m.dims[0]).toMatchObject({ key: 'section', scoring: false });
    expect(m.dims[0].values.size).toBe(2);
  });

  it('ARRL DX from the DX side counts states/provinces', () => {
    const list = [
      qso('W1AW', 1, { extras: { STATE: 'CT' } }),
      qso('K5ZD', 2, { extras: { STATE: 'TX' } }),
      qso('K5AB', 3, { extras: { STATE: 'ON' } }),
    ];
    const m = computeContestMults(list, { startedAt: T0, def: getContestDef('arrl-dx'), myResolved: DX, resolve });
    expect(m.dims[0].key).toBe('stprov');
    expect(m.dims[0].values.size).toBe(3);
  });

  it('scopes to the session and tracks per-band values', () => {
    const list = [qso('W1AW', -5), qso('K5ZD', 1, { band: '40m' }), qso('DL1ABC', 2, { band: '20m' })];
    const m = computeContestMults(list, { startedAt: T0, def: getContestDef('generic-dx'), resolve });
    expect(m.qsoCount).toBe(2);
    expect(m.perBand.get('40m').qsos).toBe(1);
    expect(m.perBand.get('20m').values.get('dxcc').has('DL')).toBe(true);
  });
});
