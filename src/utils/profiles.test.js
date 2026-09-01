import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SHARE_CODE_PREFIX,
  clearActiveProfile,
  decodeShareCode,
  encodeShareCode,
  exportProfileShareCode,
  getActiveProfileId,
  getProfileById,
  getProfiles,
  importProfileFromShareCode,
  loadProfileById,
  renameProfile,
  saveProfile,
} from './profiles.js';

const sample = {
  name: 'Contest',
  version: 1,
  snapshot: {
    openhamclock_config: JSON.stringify({ callsign: 'K0CJH', theme: 'dark' }),
    openhamclock_use12Hour: 'false',
    openhamclock_dxFilters: JSON.stringify({ bands: ['20m', '40m'], modes: ['CW'] }),
  },
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('share code encode/decode', () => {
  it('round-trips through the plain base64url fallback (no CompressionStream)', async () => {
    // jsdom-safe path: force the fallback regardless of what Node provides.
    vi.stubGlobal('CompressionStream', undefined);
    const code = await encodeShareCode(sample);
    expect(code.startsWith(SHARE_CODE_PREFIX)).toBe(true);
    // base64url only — safe to paste anywhere
    expect(code.slice(SHARE_CODE_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeShareCode(code)).toEqual(sample);
  });

  it('survives surrounding whitespace and non-ASCII content', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const obj = { name: 'Nürnberg 日本', version: 1, snapshot: { openhamclock_config: '{"callsign":"DL1ÄÖÜ"}' } };
    const code = await encodeShareCode(obj);
    expect(await decodeShareCode(`  ${code}\n`)).toEqual(obj);
  });

  const gzipAvailable = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

  it.runIf(gzipAvailable)('round-trips through the gzip path and is marked by the gzip magic', async () => {
    const code = await encodeShareCode(sample);
    expect(code.startsWith(SHARE_CODE_PREFIX)).toBe(true);
    // Assert the payload really is gzip (0x1f 0x8b) — a silent fallback to
    // plain JSON would still round-trip, hiding a broken gzip path.
    const b64 = code.slice(SHARE_CODE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    expect([bin.charCodeAt(0), bin.charCodeAt(1)]).toEqual([0x1f, 0x8b]);
    expect(await decodeShareCode(code)).toEqual(sample);
  });

  it.runIf(gzipAvailable)('decodes plain-fallback codes even when gzip is available', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const plainCode = await encodeShareCode(sample);
    vi.unstubAllGlobals();
    expect(await decodeShareCode(plainCode)).toEqual(sample);
  });

  it.runIf(gzipAvailable)('returns null for gzip codes when DecompressionStream is missing', async () => {
    const gzipCode = await encodeShareCode(sample);
    vi.stubGlobal('DecompressionStream', undefined);
    expect(await decodeShareCode(gzipCode)).toBe(null);
  });

  it('rejects garbage: wrong prefix, bad base64, bad JSON', async () => {
    expect(await decodeShareCode('')).toBe(null);
    expect(await decodeShareCode(null)).toBe(null);
    expect(await decodeShareCode('OHC2:abcdef')).toBe(null);
    expect(await decodeShareCode(`${SHARE_CODE_PREFIX}!!!not-base64!!!`)).toBe(null);
    // valid base64url of a non-JSON payload
    expect(await decodeShareCode(`${SHARE_CODE_PREFIX}aGVsbG8`)).toBe(null);
  });
});

describe('profile share-code integration', () => {
  it('exports a saved profile and imports it back as a new profile', async () => {
    localStorage.setItem('openhamclock_config', '{"callsign":"K0CJH"}');
    saveProfile('Contest');

    const code = await exportProfileShareCode('Contest');
    expect(code.startsWith(SHARE_CODE_PREFIX)).toBe(true);

    // Imports under a suffixed name since "Contest" already exists
    const imported = await importProfileFromShareCode(code);
    expect(imported).toBe('Contest (1)');
    expect(getProfiles()['Contest (1)'].snapshot.openhamclock_config).toBe('{"callsign":"K0CJH"}');
  });

  it('returns null for missing profiles and invalid codes', async () => {
    expect(await exportProfileShareCode('Nope')).toBe(null);
    expect(await importProfileFromShareCode('not a code')).toBe(null);
    // structurally valid JSON but not a profile
    vi.stubGlobal('CompressionStream', undefined);
    const code = await encodeShareCode({ hello: 'world' });
    expect(await importProfileFromShareCode(code)).toBe(null);
  });
});

describe('stable profile ids (scene rotation references)', () => {
  const seedProfile = (name) => {
    localStorage.setItem('openhamclock_config', JSON.stringify({ layout: 'modern' }));
    saveProfile(name);
  };

  it('assigns an id on save and keeps it across renames', () => {
    seedProfile('Kiosk');
    const id = getProfiles()['Kiosk'].id;
    expect(id).toMatch(/^pr-/);
    expect(renameProfile('Kiosk', 'Shack TV')).toBe(true);
    expect(getProfiles()['Shack TV'].id).toBe(id);
    expect(getProfileById(id)?.name).toBe('Shack TV');
  });

  it('lazily migrates pre-id profiles on read', () => {
    localStorage.setItem(
      'openhamclock_profiles',
      JSON.stringify({ Legacy: { snapshot: { openhamclock_config: '{}' }, createdAt: 'x', updatedAt: 'x' } }),
    );
    const profiles = getProfiles();
    expect(profiles['Legacy'].id).toMatch(/^pr-/);
    // persisted, not just in-memory
    expect(JSON.parse(localStorage.getItem('openhamclock_profiles'))['Legacy'].id).toBe(profiles['Legacy'].id);
  });

  it('getActiveProfileId resolves the pointer through the name', () => {
    seedProfile('Kiosk');
    expect(getActiveProfileId()).toBe(getProfiles()['Kiosk'].id);
    clearActiveProfile();
    expect(getActiveProfileId()).toBe(null);
  });

  it('loadProfileById restores the snapshot; preserveSceneRotation carries the CURRENT rotation over', () => {
    localStorage.setItem('openhamclock_config', JSON.stringify({ layout: 'classic', theme: 'dark' }));
    saveProfile('Contest Day'); // snapshot has NO sceneRotation
    const id = getProfiles()['Contest Day'].id;

    // Live state moves on: different layout, rotation configured
    const liveRotation = { enabled: true, intervalSec: 60, layouts: ['modern', `profile#${id}`] };
    localStorage.setItem(
      'openhamclock_config',
      JSON.stringify({ layout: 'modern', theme: 'light', sceneRotation: liveRotation }),
    );

    expect(loadProfileById(id, { preserveSceneRotation: true })).toBe(true);
    const cfg = JSON.parse(localStorage.getItem('openhamclock_config'));
    expect(cfg.layout).toBe('classic'); // profile's own view restored…
    expect(cfg.theme).toBe('dark');
    expect(cfg.sceneRotation).toEqual(liveRotation); // …but the rotation survives
    expect(getActiveProfileId()).toBe(id);

    expect(loadProfileById('pr-nope', {})).toBe(false);
  });

  it('re-importing the same profile never reuses its id', async () => {
    seedProfile('Kiosk');
    const code = await exportProfileShareCode('Kiosk');
    const name1 = await importProfileFromShareCode(code);
    const name2 = await importProfileFromShareCode(code);
    const profiles = getProfiles();
    const ids = [profiles['Kiosk'].id, profiles[name1].id, profiles[name2].id];
    expect(new Set(ids).size).toBe(3);
  });
});
