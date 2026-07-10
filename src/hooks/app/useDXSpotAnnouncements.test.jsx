/**
 * useDXSpotAnnouncements — Vitest + React 18
 *
 * Verifies aria-live announcement text for new DX cluster spot arrivals.
 * Uses a thin wrapper component rendered with createRoot/act (no @testing-library/react needed).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useDXSpotAnnouncements } from './useDXSpotAnnouncements';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let setSpots;

function ControlledHarness({ initial }) {
  const [spots, setSpots_] = useState(initial);
  setSpots = setSpots_;
  const { announcement } = useDXSpotAnnouncements(spots);
  return <div data-testid="out">{announcement}</div>;
}

function makeSpot(call, freq, spotter = 'G3XYZ') {
  return { call, freq, spotter };
}

function getText() {
  return container.querySelector('[data-testid="out"]')?.textContent ?? '';
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useDXSpotAnnouncements', () => {
  it('starts with no announcement on first render', () => {
    act(() => {
      root.render(<ControlledHarness initial={[makeSpot('G0ABC', '14.070')]} />);
    });
    expect(getText()).toBe('');
  });

  it('announces a single new spot', () => {
    act(() => {
      root.render(<ControlledHarness initial={[]} />);
    });
    act(() => {
      setSpots([makeSpot('G0ABC', '14.070')]);
    });
    expect(getText()).toBe('New DX spot: G0ABC on 14.070 MHz');
  });

  it('announces multiple new spots with count and latest call', () => {
    act(() => {
      root.render(<ControlledHarness initial={[]} />);
    });
    act(() => {
      setSpots([makeSpot('G0ABC', '14.070'), makeSpot('G0DEF', '7.074')]);
    });
    expect(getText()).toBe('2 new DX spots, latest: G0ABC on 14.070 MHz');
  });

  it('does not announce when spot list is unchanged', () => {
    act(() => {
      root.render(<ControlledHarness initial={[makeSpot('G0ABC', '14.070')]} />);
    });
    act(() => {
      setSpots([makeSpot('G0ABC', '14.070')]);
    });
    expect(getText()).toBe('');
  });

  it('converts kHz frequency values to MHz', () => {
    act(() => {
      root.render(<ControlledHarness initial={[]} />);
    });
    act(() => {
      setSpots([makeSpot('G0ABC', 14070)]);
    });
    expect(getText()).toBe('New DX spot: G0ABC on 14.070 MHz');
  });

  it('clears announcement after 5 seconds', () => {
    act(() => {
      root.render(<ControlledHarness initial={[]} />);
    });
    act(() => {
      setSpots([makeSpot('G0ABC', '14.070')]);
    });
    expect(getText()).not.toBe('');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(getText()).toBe('');
  });

  it('throttles a second announcement within the cooldown window', () => {
    act(() => {
      root.render(<ControlledHarness initial={[]} />);
    });
    act(() => {
      setSpots([makeSpot('G0ABC', '14.070')]);
    });
    const first = getText();
    expect(first).not.toBe('');
    // Immediately add another new spot — still within cooldown, text must not change
    act(() => {
      setSpots([makeSpot('G0ABC', '14.070'), makeSpot('G0DEF', '7.074')]);
    });
    expect(getText()).toBe(first); // second announcement suppressed
  });

  it('announces again after cooldown expires', () => {
    act(() => {
      root.render(<ControlledHarness initial={[]} />);
    });
    act(() => {
      setSpots([makeSpot('G0ABC', '14.070')]);
    });
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    act(() => {
      setSpots([makeSpot('G0ABC', '14.070'), makeSpot('G0DEF', '7.074')]);
    });
    expect(getText()).toMatch(/new DX spot/i);
  });

  it('handles empty spots list gracefully', () => {
    act(() => {
      root.render(<ControlledHarness initial={[]} />);
    });
    expect(getText()).toBe('');
  });
});
