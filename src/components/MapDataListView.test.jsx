import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import i18n from '../lang/i18n.js';
import MapDataListView from './MapDataListView.jsx';

const props = {
  dxSpots: [{ id: 1, call: 'JA1XYZ', freq: 14074, dxLat: 35.7, dxLon: 139.7, timestamp: Date.now() - 120000 }],
  satellites: [{ name: 'ISS', isVisible: true, elevation: 23, azimuth: 178, mode: 'FM', nextPassStartTimes: [] }],
  potaSpots: [{ call: 'K1ABC', ref: 'US-0001', freq: 7030, lat: 44, lon: -71, timestamp: Date.now() - 300000 }],
  lightning: {
    strikes: [{ id: 's1', lat: 40, lon: -105, intensity: 15, polarity: '+', timestamp: Date.now() - 30000 }],
  },
  aircraft: {
    aircraft: [{ id: 'a1', call: 'UAL123', type: 'B738', alt_ft: 35000, speed_kn: 450, lat: 41, lon: -104 }],
  },
  aurora: {
    summary: {
      maxProbability: 80,
      maxLat: 65,
      southernExtentNorth: 55,
      northernExtentSouth: null,
      probabilityAtDe: 5,
      forecastTime: Date.now(),
    },
  },
  winlink: {
    gateways: [
      {
        callsign: 'W1AW-10',
        gridsquare: 'FN31',
        lat: 41.7,
        lon: -72.7,
        channels: [{ frequency: 7101200, modeLabel: 'VARA' }],
      },
    ],
  },
  deLocation: { lat: 39.7, lon: -104.9 },
};

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root;
  act(() => {
    root = createRoot(container);
    root.render(<MapDataListView {...props} />);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

describe('MapDataListView i18n', () => {
  it('renders all sections with populated data in English', () => {
    const { container, unmount } = render();
    expect(container.textContent).toContain('DX Spots');
    expect(container.textContent).toContain('Satellites Overhead');
    expect(container.textContent).toContain('JA1XYZ');
    expect(container.textContent).toContain('W1AW-10');
    expect(container.querySelector('[aria-label*="bearing"]')).toBeTruthy();
    unmount();
  });

  it('renders translated section titles, columns, and aria-labels (de)', async () => {
    await act(() => i18n.changeLanguage('de'));
    const { container, unmount } = render();
    expect(container.textContent).toContain('DX-Spots');
    expect(container.textContent).toContain('Rufzeichen');
    expect(container.querySelector('[aria-label*="Richtung"]')).toBeTruthy();
    unmount();
  });

  it('renders translated content in a non-Latin script (ja)', async () => {
    await act(() => i18n.changeLanguage('ja'));
    const { container, unmount } = render();
    expect(container.textContent).toContain('DXスポット');
    expect(container.textContent).toContain('コールサイン');
    unmount();
  });

  it('leaves no unresolved {{interpolation}} in any sampled language', async () => {
    for (const lng of ['en', 'fr', 'es', 'ru', 'zh', 'th', 'ka']) {
      await act(() => i18n.changeLanguage(lng));
      const { container, unmount } = render();
      expect(container.innerHTML, `lang ${lng}`).not.toContain('{{');
      unmount();
    }
  });
});
