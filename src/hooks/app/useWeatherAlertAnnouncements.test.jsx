/**
 * useWeatherAlertAnnouncements — Vitest + React 18
 *
 * Verifies aria-live announcement text for new NWS weather alerts (#1088).
 * Uses a thin wrapper component rendered with createRoot/act (no @testing-library/react needed).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useWeatherAlertAnnouncements } from './useWeatherAlertAnnouncements';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let setAlerts;

function ControlledHarness({ initial }) {
  const [alerts, setAlerts_] = useState(initial);
  setAlerts = setAlerts_;
  const { announcement } = useWeatherAlertAnnouncements(alerts);
  return <div data-testid="out">{announcement}</div>;
}

function makeAlert(id, event, expires = null) {
  return { id, event, expires, severity: 'Severe' };
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

describe('useWeatherAlertAnnouncements', () => {
  it('does not announce alerts already active at app load', () => {
    act(() => {
      root.render(<ControlledHarness initial={[makeAlert('a1', 'Tornado Warning')]} />);
    });
    expect(getText()).toBe('');
  });

  it('announces a single new alert with its event name', () => {
    act(() => {
      root.render(<ControlledHarness initial={[]} />);
    });
    act(() => {
      setAlerts([makeAlert('a1', 'Severe Thunderstorm Warning')]);
    });
    expect(getText()).toBe('Weather alert: Severe Thunderstorm Warning');
  });

  it('includes the expiry time when present', () => {
    act(() => {
      root.render(<ControlledHarness initial={[]} />);
    });
    const expires = new Date('2026-06-12T20:00:00').toISOString();
    act(() => {
      setAlerts([makeAlert('a1', 'Severe Thunderstorm Warning', expires)]);
    });
    const expected = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date(expires),
    );
    expect(getText()).toBe(`Weather alert: Severe Thunderstorm Warning until ${expected}`);
  });

  it('collapses multiple new alerts, leading with the most severe', () => {
    act(() => {
      root.render(<ControlledHarness initial={[]} />);
    });
    act(() => {
      // List arrives pre-sorted most severe first, matching useWeatherAlerts
      setAlerts([makeAlert('a1', 'Tornado Warning'), makeAlert('a2', 'Flood Watch')]);
    });
    expect(getText()).toBe('2 weather alerts, most severe: Tornado Warning');
  });

  it('stays silent when a refresh returns the same alert id', () => {
    act(() => {
      root.render(<ControlledHarness initial={[]} />);
    });
    act(() => {
      setAlerts([makeAlert('a1', 'Severe Thunderstorm Warning')]);
    });
    act(() => {
      vi.advanceTimersByTime(10000); // let the first announcement clear
    });
    act(() => {
      setAlerts([makeAlert('a1', 'Severe Thunderstorm Warning')]);
    });
    expect(getText()).toBe('');
  });

  it('announces an upgrade arriving under a new id', () => {
    act(() => {
      root.render(<ControlledHarness initial={[makeAlert('a1', 'Tornado Watch')]} />);
    });
    act(() => {
      setAlerts([makeAlert('a2', 'Tornado Warning')]);
    });
    expect(getText()).toBe('Weather alert: Tornado Warning');
  });

  it('clears the announcement after 10 seconds', () => {
    act(() => {
      root.render(<ControlledHarness initial={[]} />);
    });
    act(() => {
      setAlerts([makeAlert('a1', 'Severe Thunderstorm Warning')]);
    });
    expect(getText()).not.toBe('');
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(getText()).toBe('');
  });

  it('does not announce when alerts simply expire away', () => {
    act(() => {
      root.render(<ControlledHarness initial={[makeAlert('a1', 'Flood Watch')]} />);
    });
    act(() => {
      setAlerts([]);
    });
    expect(getText()).toBe('');
  });
});
