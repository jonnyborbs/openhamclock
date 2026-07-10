import { useEffect, useRef, useState } from 'react';

/**
 * Announces satellite rise and set events via aria-live regions (#997).
 * Follows the same pattern as the rig-status announcements in RigContext.
 *
 * Rise (assertive): satellite newly above the user's minimum elevation.
 * Set  (polite):    satellite that was visible has dropped below minimum elevation.
 */
export function useSatelliteAnnouncements(satellites) {
  const [riseAnnouncement, setRiseAnnouncement] = useState('');
  const [setAnnouncement, setSetAnnouncement] = useState('');
  // null on first render so we establish a baseline without announcing
  const prevVisibleRef = useRef(null);

  useEffect(() => {
    if (!satellites || satellites.length === 0) return;

    const nowVisible = new Set(satellites.filter((s) => s.isVisible).map((s) => s.name));

    if (prevVisibleRef.current === null) {
      prevVisibleRef.current = nowVisible;
      return;
    }

    const prev = prevVisibleRef.current;
    const risen = satellites.filter((s) => s.isVisible && !prev.has(s.name));
    const set = [...prev].filter((name) => !nowVisible.has(name));
    prevVisibleRef.current = nowVisible;

    const cleanups = [];

    if (risen.length > 0) {
      const names =
        risen.length === 1
          ? risen[0].name
          : risen
              .slice(0, -1)
              .map((s) => s.name)
              .join(', ') +
            ' and ' +
            risen[risen.length - 1].name;
      setRiseAnnouncement(`${names} now overhead`);
      const t = setTimeout(() => setRiseAnnouncement(''), 4000);
      cleanups.push(() => clearTimeout(t));
    }

    if (set.length > 0) {
      const names = set.length === 1 ? set[0] : set.slice(0, -1).join(', ') + ' and ' + set[set.length - 1];
      setSetAnnouncement(`${names} passed below horizon`);
      const t = setTimeout(() => setSetAnnouncement(''), 4000);
      cleanups.push(() => clearTimeout(t));
    }

    if (cleanups.length > 0) return () => cleanups.forEach((fn) => fn());
  }, [satellites]);

  return { riseAnnouncement, setAnnouncement };
}
