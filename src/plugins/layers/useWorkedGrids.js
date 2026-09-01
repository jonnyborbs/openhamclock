import { useEffect, useRef, useState } from 'react';
import logbookStore from '../../services/logbookStore.js';
import { workedGridCounts, workedGridsBucket, gridToRect, WORKED_GRIDS_COLOR } from '../../utils/globeOverlays.js';
import { densifyPath } from '../../utils/geo.js';
import { esc } from '../../utils/escapeHtml.js';

/**
 * Worked Grids Overlay Plugin
 *
 * Shades every 4-char Maidenhead square that appears in the native logbook
 * (GridTracker-style). Fill intensity steps with QSO count — 1 / 2-4 / 5+ —
 * using the emerald bucket colours shared with the 3D globe painter in
 * utils/globeOverlays.js, so the two projections cannot drift.
 *
 * Data comes straight from logbookStore's subscribe API: newly logged QSOs
 * (or ADIF imports) shade their squares immediately, no refresh needed.
 *
 * A small on-map control (zones-selector pattern) offers an optional band
 * filter — "All bands" or any band present in the log — persisted to
 * localStorage. QSOs without a band tag fall back to bandFromFreq(freq).
 *
 * Projections: on Mercator each cell is an L.rectangle, replicated at ±360°
 * so shading survives world wrap. On the azimuthal projection cells are
 * polygons with densified edges (≤0.5° segments) so their outlines curve
 * with the disc instead of cutting straight chords.
 */

export const metadata = {
  id: 'worked-grids',
  name: 'plugins.layers.workedGrids.name',
  description: 'plugins.layers.workedGrids.description',
  icon: '🗺️',
  category: 'amateur',
  defaultEnabled: false,
  defaultOpacity: 0.6,
  version: '1.0.0',
};

const BAND_STORAGE_KEY = 'openhamclock_worked_grids_band';

// Canonical band ordering for the filter dropdown (bands actually present in
// the log are appended in this order; unknown tags go last alphabetically).
const BAND_ORDER = [
  '2190m',
  '630m',
  '160m',
  '80m',
  '60m',
  '40m',
  '30m',
  '20m',
  '17m',
  '15m',
  '12m',
  '10m',
  '6m',
  '4m',
  '2m',
  '1.25m',
  '70cm',
  '33cm',
  '23cm',
  '13cm',
];

const bandsInLog = (qsos) => {
  const seen = new Set();
  for (const q of Array.isArray(qsos) ? qsos : []) {
    const b = String(q?.band || '')
      .trim()
      .toLowerCase();
    if (b) seen.add(b);
  }
  return [...seen].sort((a, b) => {
    const ia = BAND_ORDER.indexOf(a);
    const ib = BAND_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
};

const legendRow = (label, alpha) => `
  <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
    <span style="width:14px;height:10px;flex:none;background:rgba(${WORKED_GRIDS_COLOR.r},${WORKED_GRIDS_COLOR.g},${WORKED_GRIDS_COLOR.b},${alpha});border:1px solid ${WORKED_GRIDS_COLOR.hex};"></span>
    <span>${label}</span>
  </div>`;

export function useLayer({ enabled = false, opacity = 0.6, map = null }) {
  const [qsos, setQsos] = useState([]);
  const [band, setBand] = useState(() => {
    try {
      return localStorage.getItem(BAND_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const groupRef = useRef(null);
  const controlRef = useRef(null);
  const selectRef = useRef(null);

  // Live logbook feed — subscribe delivers the current cache synchronously
  // and again after every add/import/edit/delete.
  useEffect(() => {
    if (!enabled) return undefined;
    return logbookStore.subscribe(setQsos);
  }, [enabled]);

  // Render shaded cells
  useEffect(() => {
    if (!map || !enabled || typeof L === 'undefined') return;

    const isAzimuthal = map.options?.crs?.code === 'AzimuthalEquidistant';
    const group = L.layerGroup();
    group.addTo(map);
    groupRef.current = group;

    const renderer = L.canvas({ padding: 0.5 });
    const counts = workedGridCounts(qsos, band || null);
    // Mercator wraps the world — replicate each cell one world-copy either
    // side (replicatePoint pattern). The azimuthal projection is periodic in
    // longitude, so one copy covers the whole disc.
    const lonOffsets = isAzimuthal ? [0] : [-360, 0, 360];

    for (const [grid, count] of Object.entries(counts)) {
      const rect = gridToRect(grid);
      const color = workedGridsBucket(count);
      if (!rect || !color) continue;
      const { south, west } = rect;

      const style = {
        renderer,
        color: WORKED_GRIDS_COLOR.hex,
        weight: 1,
        opacity: Math.min(1, opacity * 0.8),
        fillColor: WORKED_GRIDS_COLOR.hex,
        fillOpacity: color.a * opacity,
        interactive: true,
      };
      const tooltip = `${esc(grid)} · ${count} QSO${count === 1 ? '' : 's'}`;

      for (const off of lonOffsets) {
        let cell;
        if (isAzimuthal) {
          // Densified closed ring so cell edges curve with the projection.
          cell = L.polygon(
            densifyPath(
              [
                [south, west + off],
                [south, west + 2 + off],
                [south + 1, west + 2 + off],
                [south + 1, west + off],
                [south, west + off],
              ],
              0.5,
            ),
            style,
          );
        } else {
          cell = L.rectangle(
            [
              [south, west + off],
              [south + 1, west + 2 + off],
            ],
            style,
          );
        }
        cell.bindTooltip(tooltip, { sticky: true, direction: 'top' });
        group.addLayer(cell);
      }
    }

    return () => {
      try {
        group.clearLayers();
        map.removeLayer(group);
      } catch {}
      groupRef.current = null;
    };
  }, [map, enabled, opacity, qsos, band]);

  // On-map control: band filter + bucket legend (zones-selector pattern)
  useEffect(() => {
    if (!enabled || !map || controlRef.current) return;

    const Control = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const wrapper = L.DomUtil.create('div', 'panel-wrapper');
        const div = L.DomUtil.create('div', 'worked-grids-layer-control', wrapper);
        div.style.minWidth = '160px';
        div.innerHTML = `
          <div class="floating-panel-header">🗺️ Worked Grids</div>
          <div style="margin-top:8px;font-size:11px;color:var(--text-secondary);">
            <label for="worked-grids-band-select" style="display:block;margin-bottom:4px;">Band:</label>
            <select id="worked-grids-band-select" style="width:100%;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);padding:4px;font-size:11px;">
              <option value="">All bands</option>
            </select>
            <div style="margin-top:8px;">
              ${legendRow('1 QSO', 0.25)}
              ${legendRow('2–4 QSOs', 0.42)}
              ${legendRow('5+ QSOs', 0.6)}
            </div>
          </div>
        `;

        const select = div.querySelector('#worked-grids-band-select');
        selectRef.current = select;
        if (select) {
          select.addEventListener('change', (e) => {
            const v = e.target.value || '';
            setBand(v);
            try {
              localStorage.setItem(BAND_STORAGE_KEY, v);
            } catch {}
          });
        }

        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return wrapper;
      },
    });

    const control = new Control();
    map.addControl(control);
    controlRef.current = control;

    return () => {
      if (controlRef.current) {
        try {
          map.removeControl(controlRef.current);
        } catch {}
        controlRef.current = null;
        selectRef.current = null;
      }
    };
  }, [map, enabled]);

  // Keep the band dropdown's options in sync with the bands actually present
  // in the log (an import can add a band while the control is up).
  useEffect(() => {
    const select = selectRef.current;
    if (!select) return;
    const options = ['', ...bandsInLog(qsos)];
    const current = band || '';
    select.innerHTML = options.map((b) => `<option value="${esc(b)}">${b ? esc(b) : 'All bands'}</option>`).join('');
    // Restore selection; a persisted band no longer in the log still filters,
    // so keep it selectable rather than silently resetting.
    if (current && !options.includes(current)) {
      select.innerHTML += `<option value="${esc(current)}">${esc(current)}</option>`;
    }
    select.value = current;
  }, [qsos, band, enabled]);

  return { gridCount: Object.keys(workedGridCounts(qsos, band || null)).length };
}
