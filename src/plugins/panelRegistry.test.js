/**
 * Tests for panelRegistry's validation + collision logic.
 * discoverPanels is pure (modules map in, validated plugin list out) so we
 * feed it fake module maps instead of mocking import.meta.glob.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { discoverPanels } from './panelRegistry.js';

const GoodPanel = () => null;

const goodModule = (id, over = {}) => ({
  metadata: { id, name: `Panel ${id}`, icon: '🧩', ...over },
  Panel: GoodPanel,
});

let warnSpy;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe('discoverPanels', () => {
  it('collects valid panel plugins with normalized fields', () => {
    const panels = discoverPanels({
      './local/panels/MyPanel.jsx': goodModule('my-panel', { description: 'demo' }),
    });
    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({
      id: 'my-panel',
      name: 'Panel my-panel',
      icon: '🧩',
      description: 'demo',
      Panel: GoodPanel,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns an empty list for an empty or missing module map', () => {
    expect(discoverPanels({})).toEqual([]);
    expect(discoverPanels(undefined)).toEqual([]);
  });

  it('skips modules missing metadata or Panel exports (warns, never throws)', () => {
    const panels = discoverPanels({
      './local/panels/NoMeta.jsx': { Panel: GoodPanel },
      './local/panels/NoPanel.jsx': { metadata: { id: 'no-panel', name: 'X' } },
      './local/panels/Ok.jsx': goodModule('ok-panel'),
    });
    expect(panels.map((p) => p.id)).toEqual(['ok-panel']);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid ids (bad chars, too short, non-string)', () => {
    const panels = discoverPanels({
      './local/panels/A.jsx': goodModule('Bad Id With Spaces'),
      './local/panels/B.jsx': goodModule('x'), // too short
      './local/panels/C.jsx': { metadata: { id: 42, name: 'N' }, Panel: GoodPanel },
      './local/panels/D.jsx': goodModule('good_id-2'),
    });
    expect(panels.map((p) => p.id)).toEqual(['good_id-2']);
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it('cannot shadow built-in panel ids', () => {
    const panels = discoverPanels(
      {
        './local/panels/Evil.jsx': goodModule('logbook'),
        './local/panels/Fine.jsx': goodModule('my-logbook'),
      },
      new Set(['logbook', 'world-map']),
    );
    expect(panels.map((p) => p.id)).toEqual(['my-logbook']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('shadows a built-in panel'));
  });

  it('accepts builtinIds as a plain array too', () => {
    const panels = discoverPanels({ './local/panels/Evil.jsx': goodModule('logbook') }, ['logbook']);
    expect(panels).toHaveLength(0);
  });

  it('skips duplicate plugin ids, keeping the first', () => {
    const first = goodModule('dupe');
    const panels = discoverPanels({
      './local/panels/First.jsx': first,
      './local/panels/Second.jsx': goodModule('dupe'),
    });
    expect(panels).toHaveLength(1);
    expect(panels[0].name).toBe('Panel dupe');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('duplicate id'));
  });

  it('requires metadata.name and defaults a missing icon', () => {
    const panels = discoverPanels({
      './local/panels/NoName.jsx': { metadata: { id: 'no-name' }, Panel: GoodPanel },
      './local/panels/NoIcon.jsx': { metadata: { id: 'no-icon', name: 'No Icon' }, Panel: GoodPanel },
    });
    expect(panels.map((p) => p.id)).toEqual(['no-icon']);
    expect(panels[0].icon).toBe('🧩');
  });
});
