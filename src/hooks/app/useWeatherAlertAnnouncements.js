import { useState, useEffect, useRef } from 'react';

const CLEARDOWN_MS = 10000; // clear announcement after 10 seconds

function formatUntil(expires) {
  if (!expires) return '';
  const d = new Date(expires);
  if (Number.isNaN(d.getTime())) return '';
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
  return ` until ${time}`;
}

/**
 * Announces new severe weather alerts for the DE location via an assertive
 * aria-live region (#1088). After lightning proximity this is the most
 * safety-relevant status change in the app — an operator may need to secure
 * antennas ahead of a storm warning.
 *
 * Takes the alert list from useWeatherAlerts (pre-sorted most severe first).
 * Diffs by NWS alert id, so 5-minute refreshes of the same alert stay silent
 * while upgrades (watch → warning) arrive under a new id and announce
 * naturally. DX-location alerts are deliberately not announced — operator
 * safety only applies to where the operator is.
 */
export function useWeatherAlertAnnouncements(alerts) {
  const [announcement, setAnnouncement] = useState('');
  const prevIdsRef = useRef(null); // null = baseline not yet established
  const clearTimerRef = useRef(null);

  useEffect(() => {
    // Establish baseline on first call, even when the list is empty — alerts
    // already active when the app loads are visible in the weather panel and
    // shouldn't be read out as breaking news.
    if (prevIdsRef.current === null) {
      prevIdsRef.current = new Set((alerts ?? []).map((a) => a.id));
      return;
    }

    if (!alerts || alerts.length === 0) return;

    const prev = prevIdsRef.current;
    const newAlerts = alerts.filter((a) => !prev.has(a.id));
    prevIdsRef.current = new Set(alerts.map((a) => a.id));

    if (newAlerts.length === 0) return;

    // The hook's input is sorted most-severe-first, so newAlerts[0] is the
    // one worth leading with.
    const top = newAlerts[0];
    const until = formatUntil(top.expires);
    const text =
      newAlerts.length === 1
        ? `Weather alert: ${top.event}${until}`
        : `${newAlerts.length} weather alerts, most severe: ${top.event}${until}`;

    setAnnouncement(text);

    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => setAnnouncement(''), CLEARDOWN_MS);
  }, [alerts]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  return { announcement };
}
