/**
 * useSceneRotation — kiosk-style automatic layout ("scene") rotation.
 *
 * Settings → Display → Scene rotation persists (with the sibling display
 * settings, via the normal config save path):
 *   config.sceneRotation = {
 *     enabled: boolean,
 *     intervalSec: number,   // 30–600
 *     layouts: string[],     // layout ids from the Settings layout picker;
 *                            // a named dockable preset is `dockable#<presetId>`,
 *                            // a saved config profile is `profile#<profileId>`
 *   }
 *
 * Profile scenes restore the profile's full localStorage snapshot (keeping
 * the CURRENT sceneRotation block so the rotation survives the switch) and
 * then hard-reload the page — profile activation has always been
 * reload-based. After the reload the active-profile pointer identifies the
 * current scene, so the rotation resumes from the right position. Profiles
 * are browser-local (not server-synced); a scene referencing a profile this
 * browser doesn't have is skipped.
 *
 * Rotation is active only when enabled AND at least two layouts are selected.
 * Every tick advances config.layout to the next selected layout (wrapping),
 * through the same save path the Settings layout picker uses, so a reload
 * lands on the last shown scene.
 *
 * Pause semantics:
 *  • `paused` (prop) — true while Settings or any other app modal is open;
 *    while paused the countdown is continuously re-armed to the full
 *    interval, so closing a modal never causes an instant flip.
 *  • user interaction — any pointer/key/wheel/touch activity defers the next
 *    switch until the user has been idle for the 60 s grace period.
 *
 * Returns { active, flash } — `active` drives the on-screen indicator dot,
 * `flash` is { layout, presetName, ts } for ~2.5 s after each switch so the
 * indicator can flash the new layout's (and preset's) name.
 */
import { useEffect, useRef, useState } from 'react';
import { activatePreset, getActivePresetId, getPresetById } from '../../store/layoutStore.js';
import { activateProfileScene, clearActiveProfile, getActiveProfileId, getProfileById } from '../../utils/profiles.js';

export const SCENE_ROTATION_MIN_SEC = 30;
export const SCENE_ROTATION_MAX_SEC = 600;
const IDLE_GRACE_MS = 60_000;
const FLASH_MS = 2500;
const TICK_MS = 1000;

/** Clamp a stored interval into the supported 30 s – 10 min range. */
export const clampSceneInterval = (sec) => {
  const n = parseInt(sec, 10);
  if (!Number.isFinite(n)) return 60;
  return Math.min(SCENE_ROTATION_MAX_SEC, Math.max(SCENE_ROTATION_MIN_SEC, n));
};

/**
 * Scene ids are either a base layout id ('modern', 'dockable', …), a
 * compound `dockable#<presetId>` addressing a named dockable layout preset,
 * or `profile#<profileId>` addressing a saved config profile.
 * → { layout, presetId } with presetId null for plain ids (for profile
 * scenes, `layout` is the literal 'profile' and presetId is the profile id).
 */
export const parseSceneLayoutId = (id) => {
  if (typeof id !== 'string') return { layout: id, presetId: null };
  const hash = id.indexOf('#');
  if (hash === -1) return { layout: id, presetId: null };
  return { layout: id.slice(0, hash), presetId: id.slice(hash + 1) || null };
};

/**
 * Index of the currently showing scene within the rotation list.
 * Precedence:
 *  1. `lastSceneId` — the scene this rotation last switched to (in-memory);
 *  2. `profile#<activeProfileId>` — resumes correctly after the hard reload
 *     a profile switch performs (the ref doesn't survive the reload);
 *  3. exact `dockable#<activePreset>` over a plain 'dockable' entry;
 *  4. the plain layout id.
 * Exported for tests.
 */
export const findCurrentSceneIndex = (list, currentLayout, activePresetId, { lastSceneId, activeProfileId } = {}) => {
  if (lastSceneId) {
    const last = list.indexOf(lastSceneId);
    if (last !== -1) return last;
  }
  if (activeProfileId) {
    const profile = list.indexOf(`profile#${activeProfileId}`);
    if (profile !== -1) return profile;
  }
  if (currentLayout === 'dockable') {
    const exact = list.indexOf(`dockable#${activePresetId}`);
    if (exact !== -1) return exact;
  }
  return list.indexOf(currentLayout);
};

export default function useSceneRotation(config, onSaveConfig, { paused = false } = {}) {
  const rotation = config?.sceneRotation;
  const layouts = Array.isArray(rotation?.layouts) ? rotation.layouts : [];
  const intervalMs = clampSceneInterval(rotation?.intervalSec) * 1000;
  const active = !!rotation?.enabled && layouts.length >= 2;

  const [flash, setFlash] = useState(null); // { layout, ts } | null

  // Refs so the single ticker sees fresh values without re-subscribing.
  const configRef = useRef(config);
  configRef.current = config;
  const saveRef = useRef(onSaveConfig);
  saveRef.current = onSaveConfig;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const lastActivityRef = useRef(0); // 0 = no interaction seen yet
  const dueAtRef = useRef(0);
  // Scene id this rotation last switched to. Lets the index-finder track
  // position exactly (incl. skipped/missing scenes); null after a reload,
  // where the active-profile pointer takes over.
  const lastSceneRef = useRef(null);

  // User-activity tracking (capture phase so panels can't swallow it).
  useEffect(() => {
    if (!active) return undefined;
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    const opts = { capture: true, passive: true };
    window.addEventListener('pointerdown', bump, opts);
    window.addEventListener('pointermove', bump, opts);
    window.addEventListener('keydown', bump, opts);
    window.addEventListener('wheel', bump, opts);
    window.addEventListener('touchstart', bump, opts);
    return () => {
      window.removeEventListener('pointerdown', bump, opts);
      window.removeEventListener('pointermove', bump, opts);
      window.removeEventListener('keydown', bump, opts);
      window.removeEventListener('wheel', bump, opts);
      window.removeEventListener('touchstart', bump, opts);
    };
  }, [active]);

  // The ticker. A 1 s heartbeat checking a deadline (rather than one long
  // setTimeout) keeps pause/idle handling trivial and drift-free.
  useEffect(() => {
    if (!active) return undefined;
    dueAtRef.current = Date.now() + intervalMs;
    const id = setInterval(() => {
      const now = Date.now();
      if (pausedRef.current) {
        // Modal open — full re-arm so the scene holds a while after closing.
        dueAtRef.current = now + intervalMs;
        return;
      }
      if (lastActivityRef.current && now - lastActivityRef.current < IDLE_GRACE_MS) {
        // Someone is using the screen — hold until 60 s of quiet.
        dueAtRef.current = Math.max(dueAtRef.current, lastActivityRef.current + IDLE_GRACE_MS);
        return;
      }
      if (now < dueAtRef.current) return;

      const cfg = configRef.current;
      const list = Array.isArray(cfg?.sceneRotation?.layouts) ? cfg.sceneRotation.layouts : [];
      if (list.length < 2) return;
      const activePresetId = getActivePresetId();
      const activeProfileId = getActiveProfileId();
      // Trust the last-switched-scene ref only while it still describes what
      // is actually showing — a manual layout change repositions the
      // rotation to wherever the user went. A profile scene stays trusted
      // while its profile is active, or when the profile doesn't exist at
      // all (the ref is then the marker that lets rotation move past it).
      let lastSceneId = null;
      if (lastSceneRef.current) {
        const p = parseSceneLayoutId(lastSceneRef.current);
        const stillCurrent =
          p.layout === 'profile'
            ? p.presetId === activeProfileId || !getProfileById(p.presetId)
            : p.layout === cfg.layout && (!p.presetId || p.presetId === activePresetId);
        if (stillCurrent) lastSceneId = lastSceneRef.current;
      }
      const cur = findCurrentSceneIndex(list, cfg.layout, activePresetId, {
        lastSceneId,
        activeProfileId,
      });
      // Current layout not in the rotation (user picked something else
      // manually) → start from the first selected scene.
      const next = cur === -1 ? list[0] : list[(cur + 1) % list.length];
      dueAtRef.current = now + intervalMs;
      if (!next) return;
      const { layout: nextLayout, presetId } = parseSceneLayoutId(next);

      // Saved config profile: restore its snapshot (keeping the current
      // rotation settings) and hard-reload — profile activation is
      // reload-based. The reload restarts the ticker; the active-profile
      // pointer marks where the rotation resumes.
      if (nextLayout === 'profile') {
        if (presetId && presetId === activeProfileId) {
          lastSceneRef.current = next; // already showing it
          return;
        }
        if (!presetId || !activateProfileScene(presetId)) {
          // Profile missing in this browser (profiles don't sync) — mark the
          // scene as visited so the next tick moves past it.
          lastSceneRef.current = next;
        }
        // On success activateProfileScene hard-reloads; nothing more to do.
        return;
      }

      lastSceneRef.current = next;
      // Leaving profile-flavored state for a plain scene: clear the pointer
      // so the index-finder doesn't snap back to the profile's position
      // after the next reload, and so nothing auto-saves rotated-away state
      // into the profile.
      if (activeProfileId) clearActiveProfile();
      // Already showing this scene (same layout, and same preset when the
      // scene addresses one) — nothing to do.
      if (nextLayout === cfg.layout && (!presetId || presetId === activePresetId)) return;
      // Named dockable preset: activate it (layoutStore notifies DockableApp).
      // Plain 'dockable' keeps whatever preset is currently active.
      const presetName = presetId ? getPresetById(presetId)?.name || null : null;
      if (presetId) activatePreset(presetId);
      // config.layout only ever holds base layout ids — preset activation is
      // orthogonal state, so nothing else in the app needs to know.
      if (nextLayout !== cfg.layout) saveRef.current?.({ ...cfg, layout: nextLayout });
      setFlash({ layout: nextLayout, presetName, ts: now });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [active, intervalMs]);

  // Clear the name flash after a short beat.
  useEffect(() => {
    if (!flash) return undefined;
    const id = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(id);
  }, [flash]);

  return { active, flash };
}
