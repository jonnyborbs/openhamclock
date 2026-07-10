/**
 * BandConditionsPanel component tests
 * Verifies aria-live and accessibility attributes added in P2-005.
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { BandConditionsPanel } from './BandConditionsPanel.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts && opts.defaultValue) || key,
  }),
}));

const SAMPLE_DATA = [
  { band: '40m', condition: 'GOOD' },
  { band: '20m', condition: 'FAIR' },
  { band: '10m', condition: 'POOR' },
];

function mount(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<BandConditionsPanel {...props} />));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      document.body.removeChild(container);
    },
  };
}

describe('BandConditionsPanel accessibility', () => {
  it('loading state: status div has role=status and aria-label', () => {
    const { container, unmount } = mount({ data: [], loading: true, extras: null });
    const statusDiv = container.querySelector('[role="status"]');
    expect(statusDiv).not.toBeNull();
    expect(statusDiv.getAttribute('aria-label')).toBe('Loading band conditions');
    unmount();
  });

  it('loading state: spinner is aria-hidden', () => {
    const { container, unmount } = mount({ data: [], loading: true, extras: null });
    const spinner = container.querySelector('.loading-spinner');
    expect(spinner.getAttribute('aria-hidden')).toBe('true');
    unmount();
  });

  it('data grid has aria-live=polite', () => {
    const { container, unmount } = mount({ data: SAMPLE_DATA, loading: false, extras: null });
    const grid = container.querySelector('[aria-live="polite"]');
    expect(grid).not.toBeNull();
    unmount();
  });

  it('each band cell has aria-label combining band and translated condition', () => {
    const { container, unmount } = mount({ data: SAMPLE_DATA, loading: false, extras: null });
    const cells = container.querySelectorAll('[aria-live="polite"] > div');
    expect(cells.length).toBe(3);
    expect(cells[0].getAttribute('aria-label')).toBe('40m: band.conditions.good');
    expect(cells[1].getAttribute('aria-label')).toBe('20m: band.conditions.fair');
    expect(cells[2].getAttribute('aria-label')).toBe('10m: band.conditions.poor');
    unmount();
  });

  it('band name and condition text children are aria-hidden', () => {
    const { container, unmount } = mount({ data: SAMPLE_DATA, loading: false, extras: null });
    const cells = container.querySelectorAll('[aria-live="polite"] > div');
    cells.forEach((cell) => {
      const hidden = cell.querySelectorAll('[aria-hidden="true"]');
      expect(hidden.length).toBe(2);
    });
    unmount();
  });

  it('stale badge has role=alert when data is stale', () => {
    const extras = { stale: true, fetchedAt: Date.now() - 120_000 };
    const { container, unmount } = mount({ data: SAMPLE_DATA, loading: false, extras });
    const badge = container.querySelector('[role="alert"]');
    expect(badge).not.toBeNull();
    unmount();
  });

  it('no stale badge when extras is null', () => {
    const { container, unmount } = mount({ data: SAMPLE_DATA, loading: false, extras: null });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    unmount();
  });
});
