import { describe, it, expect } from 'vitest';
import { slugify, createSlugger } from './slugify.js';

describe('slugify (GitHub heading anchors)', () => {
  it('slugs real MANUAL.md headings the way GitHub does', () => {
    expect(slugify('The basics')).toBe('the-basics');
    expect(slugify('Projections: flat, azimuthal, 3D globe')).toBe('projections-flat-azimuthal-3d-globe');
    expect(slugify('DE and DX: markers, click-to-set, favorites')).toBe('de-and-dx-markers-click-to-set-favorites');
    expect(slugify('Map Data text view (accessibility)')).toBe('map-data-text-view-accessibility');
    expect(slugify('Offline mode (PWA)')).toBe('offline-mode-pwa');
    expect(slugify('WSJT-X and digital modes')).toBe('wsjt-x-and-digital-modes');
    expect(slugify('Hosted site vs self-hosted')).toBe('hosted-site-vs-self-hosted');
  });

  it('keeps consecutive hyphens when punctuation is stripped between spaces (GitHub behavior)', () => {
    // "Layouts (Settings → Display)" — the arrow and parens vanish,
    // leaving two spaces → two hyphens, exactly like GitHub renders it.
    expect(slugify('Layouts (Settings → Display)')).toBe('layouts-settings--display');
  });

  it('lowercases and trims', () => {
    expect(slugify('  DX Cluster In Depth  ')).toBe('dx-cluster-in-depth');
  });

  it('keeps unicode letters', () => {
    expect(slugify('Español y más')).toBe('español-y-más');
  });

  it('createSlugger de-duplicates repeated headings with -N suffixes', () => {
    const slug = createSlugger();
    expect(slug('Sources')).toBe('sources');
    expect(slug('Sources')).toBe('sources-1');
    expect(slug('Sources')).toBe('sources-2');
    expect(slug('Filters')).toBe('filters');
  });
});
