import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  spotModeToDemod,
  buildKiwiUrl,
  getListenUrl,
  loadNearbyReceivers,
  _resetReceiverDirectory,
  KIWISDR_DIRECTORY_URL,
  WEB_SDR_RECEIVERS,
} from './webSdr';
import { apiFetch } from './apiFetch';

vi.mock('./apiFetch', () => ({ apiFetch: vi.fn() }));

beforeEach(() => {
  _resetReceiverDirectory();
  vi.clearAllMocks();
});

const mockReceivers = (receivers) => apiFetch.mockResolvedValue({ ok: true, json: async () => ({ receivers }) });

describe('spotModeToDemod', () => {
  it('maps CW to cw', () => {
    expect(spotModeToDemod('CW', 14025)).toBe('cw');
  });

  it('maps SSB by band convention: USB above 10 MHz, LSB below', () => {
    expect(spotModeToDemod('SSB', 14200)).toBe('usb');
    expect(spotModeToDemod('SSB', 7150)).toBe('lsb');
  });

  it('maps digital modes to usb regardless of band', () => {
    expect(spotModeToDemod('FT8', 3573)).toBe('usb');
    expect(spotModeToDemod('FT4', 7047)).toBe('usb');
    expect(spotModeToDemod('RTTY', 7040)).toBe('usb');
    expect(spotModeToDemod('PSK', 3580)).toBe('usb');
  });

  it('falls back to sideband convention for unknown mode', () => {
    expect(spotModeToDemod(null, 21300)).toBe('usb');
    expect(spotModeToDemod(null, 3790)).toBe('lsb');
  });

  it('maps AM and FM', () => {
    expect(spotModeToDemod('AM', 7290)).toBe('am');
    expect(spotModeToDemod('FM', 29600)).toBe('fm');
  });
});

describe('buildKiwiUrl', () => {
  it('builds the ?f=<kHz><mode>z<zoom> form', () => {
    expect(buildKiwiUrl('kiwi.example.com:8073', 14074, 'FT8')).toBe('http://kiwi.example.com:8073/?f=14074usbz8');
  });

  it('keeps an explicit scheme and translates FM to nbfm', () => {
    expect(buildKiwiUrl('http://kiwi.example.com:8073/', 29600, 'FM', 10)).toBe(
      'http://kiwi.example.com:8073/?f=29600nbfmz10',
    );
  });
});

describe('getListenUrl', () => {
  it('returns null for invalid frequencies', () => {
    expect(getListenUrl(NaN, 'CW')).toBeNull();
    expect(getListenUrl(0, 'CW')).toBeNull();
  });

  it('returns a covering curated receiver with a tuned URL', () => {
    const res = getListenUrl(14074, 'FT8');
    expect(res).not.toBeNull();
    expect(res.url).toMatch(/\?(tune|f)=14074usb/);
  });

  it('falls back to the KiwiSDR directory when nothing covers the frequency', () => {
    const res = getListenUrl(144300, 'SSB'); // 2m — outside every curated receiver
    expect(res.url).toBe(KIWISDR_DIRECTORY_URL);
  });

  it('curated list stays tiny (3-6 receivers)', () => {
    expect(WEB_SDR_RECEIVERS.length).toBeGreaterThanOrEqual(3);
    expect(WEB_SDR_RECEIVERS.length).toBeLessThanOrEqual(6);
  });
});

describe('directory-backed getListenUrl (tier 1)', () => {
  const kiwi = (name, coverage) => ({
    url: `http://${name}.example.com:8073`,
    name,
    dist_km: 0,
    users: 0,
    users_max: 8,
    snr: '30,30',
    bands: null,
    coverage,
    antenna: null,
  });

  it('picks the nearest (first) directory receiver covering the frequency', async () => {
    mockReceivers([
      kiwi('nearest-hf', { min_khz: 0, max_khz: 30000 }),
      kiwi('farther-hf', { min_khz: 0, max_khz: 30000 }),
    ]);
    await loadNearbyReceivers(50, 8);
    const res = getListenUrl(14074, 'FT8');
    expect(res.url).toBe('http://nearest-hf.example.com:8073/?f=14074usbz10');
    expect(res.name).toBe('nearest-hf');
  });

  it('skips directory receivers that do not cover the frequency', async () => {
    mockReceivers([
      kiwi('lowbands-only', { min_khz: 0, max_khz: 8000 }),
      kiwi('wideband', { min_khz: 0, max_khz: 30000 }),
      kiwi('no-coverage', null),
    ]);
    await loadNearbyReceivers(50, 8);
    expect(getListenUrl(14074, 'FT8').name).toBe('wideband');
  });

  it('finds a VHF-capable kiwi for a 2m spot instead of the directory page', async () => {
    mockReceivers([kiwi('hf', { min_khz: 0, max_khz: 30000 }), kiwi('vhf', { min_khz: 144000, max_khz: 148000 })]);
    await loadNearbyReceivers(50, 8);
    const res = getListenUrl(144300, 'SSB');
    expect(res.url).toBe('http://vhf.example.com:8073/?f=144300usbz10');
  });

  it('falls back to curated receivers when nothing in the directory covers the frequency', async () => {
    mockReceivers([kiwi('lowbands-only', { min_khz: 0, max_khz: 8000 })]);
    await loadNearbyReceivers(50, 8);
    const res = getListenUrl(14074, 'FT8');
    expect(res.url).toMatch(/\?tune=14074usb/); // a curated WebSDR, not a kiwi
  });

  it('falls back to curated receivers before the list has loaded', () => {
    const res = getListenUrl(14074, 'FT8');
    expect(res.url).toMatch(/\?tune=14074usb/);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('still ends at the directory page when neither tier covers the frequency', async () => {
    mockReceivers([kiwi('hf', { min_khz: 0, max_khz: 30000 })]);
    await loadNearbyReceivers(50, 8);
    expect(getListenUrl(1296200, 'SSB').url).toBe(KIWISDR_DIRECTORY_URL); // 23cm
  });
});

describe('loadNearbyReceivers caching', () => {
  it('fetches once for concurrent and repeat callers (module-level cache)', async () => {
    mockReceivers([]);
    await Promise.all([loadNearbyReceivers(50, 8), loadNearbyReceivers(50, 8)]);
    await loadNearbyReceivers(50, 8);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/api/websdr/receivers?lat=50.0000&lon=8.0000');
  });

  it('resolves null (curated fallback) on fetch failure without throwing', async () => {
    apiFetch.mockRejectedValue(new Error('offline'));
    await expect(loadNearbyReceivers(50, 8)).resolves.toBeNull();
    expect(getListenUrl(14074, 'FT8').url).toMatch(/\?tune=/);
  });

  it('skips fetching without valid coordinates', async () => {
    await loadNearbyReceivers(null, undefined);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
