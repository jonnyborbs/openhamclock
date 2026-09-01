/**
 * useSceneRotation — Vitest + React 18
 *
 * Drives the kiosk scene-rotation hook with fake timers: advancing on the
 * interval, pause-while-modal-open re-arming, the 60 s user-activity grace,
 * wrap-around, and interval clamping. Rendered with createRoot/act (no
 * @testing-library/react needed — same pattern as useDXSpotAnnouncements).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// The hook activates named dockable presets through the layout store — mock
// it so these tests stay pure (no localStorage, no server-sync side effects).
const presetStore = vi.hoisted(() => ({ activeId: 'default', activatePreset: null }));
vi.mock('../../store/layoutStore.js', () => ({
  activatePreset: (...args) => presetStore.activatePreset(...args),
  getActivePresetId: () => presetStore.activeId,
  getPresetById: (id) => ({ id, name: `Preset ${id}` }),
}));

// Same for config profiles — activateProfileScene hard-reloads the page on
// success, so it must never run for real here.
const profileStore = vi.hoisted(() => ({
  activeId: null,
  known: new Set(),
  activateProfileScene: null,
  clearActiveProfile: null,
}));
vi.mock('../../utils/profiles.js', () => ({
  getActiveProfileId: () => profileStore.activeId,
  getProfileById: (id) => (profileStore.known.has(id) ? { id, name: `Profile ${id}` } : null),
  activateProfileScene: (...args) => profileStore.activateProfileScene(...args),
  clearActiveProfile: (...args) => profileStore.clearActiveProfile(...args),
}));

import useSceneRotation, { clampSceneInterval, parseSceneLayoutId, findCurrentSceneIndex } from './useSceneRotation.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let setPaused;
let onSave;

function Harness({ config, initialPaused = false }) {
  const [paused, setPaused_] = useState(initialPaused);
  setPaused = setPaused_;
  const { active, flash } = useSceneRotation(config, onSave, { paused });
  return (
    <div data-testid="out">
      {active ? 'active' : 'idle'}|{flash?.layout || ''}|{flash?.presetName || ''}
    </div>
  );
}

const cfg = (layout, layouts, intervalSec = 30, enabled = true) => ({
  layout,
  sceneRotation: { enabled, intervalSec, layouts },
});

const getText = () => container.querySelector('[data-testid="out"]')?.textContent ?? '';

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onSave = vi.fn();
  presetStore.activeId = 'default';
  presetStore.activatePreset = vi.fn((id) => {
    presetStore.activeId = id;
    return true;
  });
  profileStore.activeId = null;
  profileStore.known = new Set();
  profileStore.activateProfileScene = vi.fn((id) => {
    if (!profileStore.known.has(id)) return false;
    profileStore.activeId = id; // real impl reloads; tests just track it
    return true;
  });
  profileStore.clearActiveProfile = vi.fn(() => {
    profileStore.activeId = null;
  });
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('clampSceneInterval', () => {
  it('clamps into the 30 s – 10 min range and defaults to 60', () => {
    expect(clampSceneInterval(5)).toBe(30);
    expect(clampSceneInterval(30)).toBe(30);
    expect(clampSceneInterval(90)).toBe(90);
    expect(clampSceneInterval(9999)).toBe(600);
    expect(clampSceneInterval('nope')).toBe(60);
  });
});

describe('useSceneRotation', () => {
  it('is inactive when disabled or with fewer than two layouts', () => {
    act(() => {
      root.render(<Harness config={cfg('modern', ['modern', 'classic'], 30, false)} />);
    });
    expect(getText()).toContain('idle');
    act(() => {
      root.render(<Harness config={cfg('modern', ['modern'], 30, true)} />);
    });
    expect(getText()).toContain('idle');
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('advances to the next selected layout after the interval', () => {
    act(() => {
      root.render(<Harness config={cfg('modern', ['modern', 'classic'])} />);
    });
    expect(getText()).toContain('active');
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(onSave).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].layout).toBe('classic');
    // The switch is flashed for the indicator…
    expect(getText()).toContain('classic');
    // …and clears after a short beat.
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(getText()).not.toContain('classic');
  });

  it('wraps around and enters the rotation at the first scene when the current layout is not selected', () => {
    act(() => {
      root.render(<Harness config={cfg('contest', ['modern', 'classic'])} />);
    });
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(onSave.mock.calls[0][0].layout).toBe('modern');

    onSave.mockClear();
    act(() => {
      root.render(<Harness config={cfg('classic', ['modern', 'classic'])} />);
    });
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(onSave.mock.calls[0][0].layout).toBe('modern'); // wrap classic → modern
  });

  it('holds while paused and re-arms the full interval on resume', () => {
    act(() => {
      root.render(<Harness config={cfg('modern', ['modern', 'classic'])} initialPaused />);
    });
    act(() => {
      vi.advanceTimersByTime(180_000);
    });
    expect(onSave).not.toHaveBeenCalled();
    act(() => {
      setPaused(false);
    });
    // No instant flip: a full interval must elapse after the modal closes.
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(onSave).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('defers rotation until the user has been idle for 60 s', () => {
    act(() => {
      root.render(<Harness config={cfg('modern', ['modern', 'classic'])} />);
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
      window.dispatchEvent(new Event('pointerdown'));
    });
    // The 30 s deadline passes, but the user was active 25 s ago — hold.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onSave).not.toHaveBeenCalled();
    // 60 s after the interaction the switch goes through.
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('parseSceneLayoutId', () => {
  it('splits compound dockable-preset ids and passes plain ids through', () => {
    expect(parseSceneLayoutId('modern')).toEqual({ layout: 'modern', presetId: null });
    expect(parseSceneLayoutId('dockable')).toEqual({ layout: 'dockable', presetId: null });
    expect(parseSceneLayoutId('dockable#abc-123')).toEqual({ layout: 'dockable', presetId: 'abc-123' });
    expect(parseSceneLayoutId('dockable#')).toEqual({ layout: 'dockable', presetId: null });
    expect(parseSceneLayoutId(undefined)).toEqual({ layout: undefined, presetId: null });
  });
});

describe('findCurrentSceneIndex', () => {
  it('prefers the exact dockable#<activePreset> entry over plain dockable', () => {
    const list = ['modern', 'dockable', 'dockable#a', 'dockable#b'];
    expect(findCurrentSceneIndex(list, 'dockable', 'b')).toBe(3);
    expect(findCurrentSceneIndex(list, 'dockable', 'nope')).toBe(1); // plain fallback
    expect(findCurrentSceneIndex(list, 'modern', 'a')).toBe(0);
    expect(findCurrentSceneIndex(['modern', 'classic'], 'dockable', 'a')).toBe(-1);
  });

  it('prefers the last-switched scene, then the active profile, over layout matching', () => {
    const list = ['modern', 'profile#p1', 'classic'];
    // In-memory position wins outright
    expect(findCurrentSceneIndex(list, 'modern', null, { lastSceneId: 'classic' })).toBe(2);
    // After a profile-switch reload the ref is gone — the pointer resumes it
    expect(findCurrentSceneIndex(list, 'modern', null, { activeProfileId: 'p1' })).toBe(1);
    // Unknown profile / absent ref falls through to the layout id
    expect(findCurrentSceneIndex(list, 'modern', null, { activeProfileId: 'nope' })).toBe(0);
    expect(findCurrentSceneIndex(list, 'modern', null, { lastSceneId: 'tablet' })).toBe(0);
  });
});

describe('useSceneRotation — config profiles (profile#<id>)', () => {
  it('rotates into a profile scene via activateProfileScene', () => {
    profileStore.known = new Set(['p1']);
    act(() => {
      root.render(<Harness config={cfg('modern', ['modern', 'profile#p1'])} />);
    });
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(profileStore.activateProfileScene).toHaveBeenCalledWith('p1');
    // The real implementation hard-reloads — no config save happens here.
    expect(onSave).not.toHaveBeenCalled();
  });

  it('resumes after the reload from the active-profile pointer and clears it when leaving', () => {
    profileStore.known = new Set(['p1']);
    profileStore.activeId = 'p1'; // simulates post-reload state
    act(() => {
      root.render(<Harness config={cfg('modern', ['modern', 'profile#p1'])} />);
    });
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    // Current scene is the profile → next wraps to 'modern'
    expect(profileStore.activateProfileScene).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled(); // layout already 'modern'
    expect(profileStore.clearActiveProfile).toHaveBeenCalledTimes(1);
  });

  it('skips a profile scene this browser does not have', () => {
    profileStore.known = new Set(); // profile deleted / never synced
    act(() => {
      root.render(<Harness config={cfg('modern', ['modern', 'profile#gone', 'classic'])} />);
    });
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(profileStore.activateProfileScene).toHaveBeenCalledWith('gone');
    expect(onSave).not.toHaveBeenCalled(); // no switch this tick
    // Next tick moves past the missing scene to 'classic'
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].layout).toBe('classic');
  });
});

describe('useSceneRotation — named dockable presets (dockable#<id>)', () => {
  it('rotates preset→preset via activatePreset without re-saving config.layout', () => {
    presetStore.activeId = 'a';
    act(() => {
      root.render(<Harness config={cfg('dockable', ['dockable#a', 'dockable#b'])} />);
    });
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(presetStore.activatePreset).toHaveBeenCalledWith('b');
    expect(onSave).not.toHaveBeenCalled(); // layout stays 'dockable'
    expect(getText()).toContain('Preset b'); // flash carries the preset name

    // Next tick wraps back to preset a (the mock updated the active id).
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(presetStore.activatePreset).toHaveBeenLastCalledWith('a');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('enters a named preset from another layout: activates the preset AND sets layout=dockable', () => {
    act(() => {
      root.render(<Harness config={cfg('modern', ['modern', 'dockable#a'])} />);
    });
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(presetStore.activatePreset).toHaveBeenCalledWith('a');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].layout).toBe('dockable'); // never a compound id in config
  });

  it('a plain dockable scene keeps whatever preset is active', () => {
    presetStore.activeId = 'x';
    act(() => {
      root.render(<Harness config={cfg('dockable', ['dockable', 'modern'])} />);
    });
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(presetStore.activatePreset).not.toHaveBeenCalled();
    expect(onSave.mock.calls[0][0].layout).toBe('modern');
  });
});
