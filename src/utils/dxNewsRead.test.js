/**
 * dxNewsRead tests — read/unread persistence (cap, idempotence, corrupt
 * storage) and the relative-time formatter.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DX_NEWS_READ_KEY, DX_NEWS_READ_CAP, loadReadIds, saveReadIds, markRead, relativeTime } from './dxNewsRead.js';

// jsdom in this project runs without a URL — provide a minimal localStorage.
const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  },
  writable: true,
});

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
});

describe('loadReadIds / saveReadIds', () => {
  it('round-trips ids through localStorage', () => {
    saveReadIds(['a', 'b']);
    expect(loadReadIds()).toEqual(['a', 'b']);
  });

  it('returns [] for missing, corrupt, or non-array storage', () => {
    expect(loadReadIds()).toEqual([]);
    store[DX_NEWS_READ_KEY] = 'not json{';
    expect(loadReadIds()).toEqual([]);
    store[DX_NEWS_READ_KEY] = '{"a":1}';
    expect(loadReadIds()).toEqual([]);
  });

  it('drops non-string entries on load', () => {
    store[DX_NEWS_READ_KEY] = JSON.stringify(['a', 42, null, 'b']);
    expect(loadReadIds()).toEqual(['a', 'b']);
  });

  it('caps persisted ids at the newest CAP entries', () => {
    const many = Array.from({ length: DX_NEWS_READ_CAP + 50 }, (_, i) => `id-${i}`);
    saveReadIds(many);
    const loaded = loadReadIds();
    expect(loaded).toHaveLength(DX_NEWS_READ_CAP);
    expect(loaded[0]).toBe('id-50'); // oldest 50 dropped
    expect(loaded[loaded.length - 1]).toBe(`id-${DX_NEWS_READ_CAP + 49}`);
  });
});

describe('markRead', () => {
  it('appends unseen ids', () => {
    expect(markRead(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('is idempotent — already-read id returns the same array', () => {
    const ids = ['a', 'b'];
    expect(markRead(ids, 'a')).toBe(ids);
  });

  it('ignores empty ids', () => {
    const ids = ['a'];
    expect(markRead(ids, '')).toBe(ids);
    expect(markRead(ids, undefined)).toBe(ids);
  });

  it('enforces the cap by dropping oldest', () => {
    const full = Array.from({ length: DX_NEWS_READ_CAP }, (_, i) => `id-${i}`);
    const next = markRead(full, 'newest');
    expect(next).toHaveLength(DX_NEWS_READ_CAP);
    expect(next[0]).toBe('id-1');
    expect(next[next.length - 1]).toBe('newest');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-08-28T12:00:00Z');

  it('buckets ages into now/minutes/hours/days', () => {
    expect(relativeTime('2026-08-28T11:59:40Z', now)).toBe('now');
    expect(relativeTime('2026-08-28T11:15:00Z', now)).toBe('45m');
    expect(relativeTime('2026-08-28T09:00:00Z', now)).toBe('3h');
    expect(relativeTime('2026-08-26T11:00:00Z', now)).toBe('2d');
  });

  it('returns null for missing or invalid dates', () => {
    expect(relativeTime(null, now)).toBeNull();
    expect(relativeTime('garbage', now)).toBeNull();
  });
});
