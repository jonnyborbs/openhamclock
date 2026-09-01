import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyFilter } from './fuzzyMatch.js';

describe('fuzzyMatch', () => {
  it('matches an in-order subsequence', () => {
    expect(fuzzyMatch('wmap', 'World Map').matched).toBe(true);
    expect(fuzzyMatch('dxc', 'DX Cluster').matched).toBe(true);
  });

  it('rejects out-of-order characters', () => {
    expect(fuzzyMatch('pam', 'map').matched).toBe(false);
  });

  it('rejects characters missing from the text', () => {
    expect(fuzzyMatch('mapz', 'World Map').matched).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('WORLD', 'world map').matched).toBe(true);
    expect(fuzzyMatch('world', 'WORLD MAP').matched).toBe(true);
  });

  it('matches everything on an empty query', () => {
    expect(fuzzyMatch('', 'anything').matched).toBe(true);
  });

  it('never matches empty text with a non-empty query', () => {
    expect(fuzzyMatch('a', '').matched).toBe(false);
  });

  it('ranks a prefix above a scattered subsequence', () => {
    const prefix = fuzzyMatch('sol', 'Solar Indices').score;
    const scattered = fuzzyMatch('sol', 'Sked Planner Overlay').score;
    expect(prefix).toBeGreaterThan(scattered);
  });

  it('gives word-boundary matches a better score', () => {
    const initials = fuzzyMatch('wm', 'World Map').score;
    const buried = fuzzyMatch('wm', 'aawaam').score;
    expect(initials).toBeGreaterThan(buried);
  });
});

describe('fuzzyFilter', () => {
  const items = [
    { name: 'World Map' },
    { name: 'DX Cluster' },
    { name: 'Logbook' },
    { name: 'Log Stats' },
    { name: 'Solar Indices' },
  ];

  it('returns everything (copy) when the query is blank', () => {
    const out = fuzzyFilter('  ', items, (i) => i.name);
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });

  it('filters to matching entries only', () => {
    const out = fuzzyFilter('log', items, (i) => i.name);
    expect(out.map((i) => i.name)).toEqual(expect.arrayContaining(['Logbook', 'Log Stats']));
    expect(out.every((i) => /log/i.test(i.name))).toBe(true);
  });

  it('puts the best match first', () => {
    const out = fuzzyFilter('dx', items, (i) => i.name);
    expect(out[0].name).toBe('DX Cluster');
  });

  it('keeps input order for equal scores', () => {
    const dupes = [{ name: 'Alpha' }, { name: 'Alpha' }];
    const out = fuzzyFilter('al', dupes, (i) => i.name);
    expect(out[0]).toBe(dupes[0]);
    expect(out[1]).toBe(dupes[1]);
  });
});
