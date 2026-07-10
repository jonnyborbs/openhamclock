/**
 * useMapTextData
 *
 * Collects the data that map layer plugins broadcast for the text view panel
 * (#1002 v2). Lightning, aircraft, aurora, and Winlink gateways all live
 * entirely inside their Leaflet plugin hooks; rather than threading their
 * state up through WorldMap, each plugin dispatches a `mapdata:<layer>`
 * CustomEvent on window when its data changes (same exfiltration pattern as
 * `lightning:proximity`). This hook is the single subscriber.
 *
 * Each returned field is `null` while the corresponding layer is disabled —
 * the panel renders a "layer is off" message instead of an empty table.
 */
import { useState, useEffect } from 'react';

export const useMapTextData = () => {
  const [lightning, setLightning] = useState(null);
  const [aircraft, setAircraft] = useState(null);
  const [aurora, setAurora] = useState(null);
  const [winlink, setWinlink] = useState(null);

  useEffect(() => {
    const onLightning = (e) => setLightning(e.detail?.enabled ? { strikes: e.detail.strikes || [] } : null);
    const onAircraft = (e) => setAircraft(e.detail?.enabled ? { aircraft: e.detail.aircraft || [] } : null);
    const onAurora = (e) => setAurora(e.detail?.enabled ? { summary: e.detail.summary || null } : null);
    const onWinlink = (e) => setWinlink(e.detail?.enabled ? { gateways: e.detail.gateways || [] } : null);

    window.addEventListener('mapdata:lightning', onLightning);
    window.addEventListener('mapdata:aircraft', onAircraft);
    window.addEventListener('mapdata:aurora', onAurora);
    window.addEventListener('mapdata:winlink', onWinlink);
    return () => {
      window.removeEventListener('mapdata:lightning', onLightning);
      window.removeEventListener('mapdata:aircraft', onAircraft);
      window.removeEventListener('mapdata:aurora', onAurora);
      window.removeEventListener('mapdata:winlink', onWinlink);
    };
  }, []);

  return { lightning, aircraft, aurora, winlink };
};
