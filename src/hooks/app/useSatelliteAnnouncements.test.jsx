/**
 * useSatelliteAnnouncements — Vitest + React 18
 *
 * Verifies aria-live announcement text for satellite rise and set events.
 * Uses a thin wrapper component rendered with createRoot/act (no @testing-library/react needed).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useSatelliteAnnouncements } from './useSatelliteAnnouncements';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ satellites }) {
  const { riseAnnouncement, setAnnouncement } = useSatelliteAnnouncements(satellites);
  return (
    <>
      <div data-testid="rise">{riseAnnouncement}</div>
      <div data-testid="set">{setAnnouncement}</div>
    </>
  );
}

// Wrapper that lets tests push new satellite arrays via setSats()
let root;
let container;
let setSats;

function ControlledHarness({ initial }) {
  const [sats, setSatsState] = useState(initial);
  setSats = setSatsState;
  const { riseAnnouncement, setAnnouncement } = useSatelliteAnnouncements(sats);
  return (
    <>
      <div data-testid="rise">{riseAnnouncement}</div>
      <div data-testid="set">{setAnnouncement}</div>
    </>
  );
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

const makeSat = (name, isVisible) => ({ name, isVisible, elevation: isVisible ? 15 : -5 });

describe('useSatelliteAnnouncements', () => {
  it('makes no announcement on first render', () => {
    act(() => {
      root.render(<Harness satellites={[makeSat('ISS', true)]} />);
    });
    expect(container.querySelector('[data-testid="rise"]').textContent).toBe('');
    expect(container.querySelector('[data-testid="set"]').textContent).toBe('');
  });

  it('announces a single rising satellite', () => {
    act(() => {
      root.render(<ControlledHarness initial={[makeSat('ISS', false)]} />);
    });
    act(() => {
      setSats([makeSat('ISS', true)]);
    });
    expect(container.querySelector('[data-testid="rise"]').textContent).toBe('ISS now overhead');
    expect(container.querySelector('[data-testid="set"]').textContent).toBe('');
  });

  it('announces a single setting satellite', () => {
    act(() => {
      root.render(<ControlledHarness initial={[makeSat('ISS', true)]} />);
    });
    act(() => {
      setSats([makeSat('ISS', false)]);
    });
    expect(container.querySelector('[data-testid="rise"]').textContent).toBe('');
    expect(container.querySelector('[data-testid="set"]').textContent).toBe('ISS passed below horizon');
  });

  it('lists two rising satellites with "and"', () => {
    act(() => {
      root.render(<ControlledHarness initial={[makeSat('ISS', false), makeSat('AO-91', false)]} />);
    });
    act(() => {
      setSats([makeSat('ISS', true), makeSat('AO-91', true)]);
    });
    expect(container.querySelector('[data-testid="rise"]').textContent).toBe('ISS and AO-91 now overhead');
  });

  it('lists three setting satellites with Oxford comma pattern', () => {
    act(() => {
      root.render(
        <ControlledHarness initial={[makeSat('ISS', true), makeSat('AO-91', true), makeSat('FO-29', true)]} />,
      );
    });
    act(() => {
      setSats([makeSat('ISS', false), makeSat('AO-91', false), makeSat('FO-29', false)]);
    });
    expect(container.querySelector('[data-testid="set"]').textContent).toBe(
      'ISS, AO-91 and FO-29 passed below horizon',
    );
  });

  it('clears rise announcement after 4 s', () => {
    act(() => {
      root.render(<ControlledHarness initial={[makeSat('ISS', false)]} />);
    });
    act(() => {
      setSats([makeSat('ISS', true)]);
    });
    expect(container.querySelector('[data-testid="rise"]').textContent).toBe('ISS now overhead');
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(container.querySelector('[data-testid="rise"]').textContent).toBe('');
  });

  it('does not announce when satellite stays visible across renders', () => {
    act(() => {
      root.render(<ControlledHarness initial={[makeSat('ISS', true)]} />);
    });
    act(() => {
      setSats([makeSat('ISS', true)]);
    });
    expect(container.querySelector('[data-testid="rise"]').textContent).toBe('');
    expect(container.querySelector('[data-testid="set"]').textContent).toBe('');
  });

  it('handles empty satellite array without crashing', () => {
    act(() => {
      root.render(<ControlledHarness initial={[]} />);
    });
    act(() => {
      setSats([]);
    });
    expect(container.querySelector('[data-testid="rise"]').textContent).toBe('');
    expect(container.querySelector('[data-testid="set"]').textContent).toBe('');
  });
});
