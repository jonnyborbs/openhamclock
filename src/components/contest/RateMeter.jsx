/**
 * RateMeter — QSO rate for the Contest layout.
 *
 * Shows QSOs in the last 10 / 60 minutes, the extrapolated hourly rate
 * (last-10-minutes × 6 — the number contesters actually watch), and a
 * trailing-hour sparkline in 5-minute buckets. All math lives in
 * utils/contestRate.js (pure, tested); this component just ticks a clock.
 */
import { useEffect, useMemo, useState } from 'react';
import { qsoTimestamps, countInWindow, ratePerHour, sparklineBuckets } from '../../utils/contestRate.js';

const TEN_MIN = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const BUCKET_MS = 5 * 60 * 1000;
const BUCKETS = 12;

const Stat = ({ label, value, accent }) => (
  <div style={{ textAlign: 'center', minWidth: '64px' }}>
    <div
      style={{
        fontSize: '22px',
        fontWeight: 700,
        fontFamily: 'var(--font-mono)',
        color: accent || 'var(--text-primary)',
        lineHeight: 1.1,
      }}
    >
      {value}
    </div>
    <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {label}
    </div>
  </div>
);

export const RateMeter = ({ qsos }) => {
  // Re-render every 15 s so counts age out of their windows without new QSOs.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  const timestamps = useMemo(() => qsoTimestamps(qsos), [qsos]);

  const { last10, last60, hourly, buckets } = useMemo(
    () => ({
      last10: countInWindow(timestamps, TEN_MIN, now),
      last60: countInWindow(timestamps, ONE_HOUR, now),
      hourly: ratePerHour(timestamps, TEN_MIN, now),
      buckets: sparklineBuckets(timestamps, { buckets: BUCKETS, bucketMs: BUCKET_MS, now }),
    }),
    [timestamps, now],
  );

  const max = Math.max(1, ...buckets);
  const barW = 100 / BUCKETS;

  return (
    <div className="panel" style={{ padding: '10px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        style={{
          fontSize: '12px',
          color: 'var(--accent-amber)',
          fontWeight: 700,
          marginBottom: '8px',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>RATE</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '9px', fontWeight: 400 }}>trailing hour</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-around', gap: '8px', marginBottom: '8px' }}>
        <Stat label="last 10 min" value={last10} />
        <Stat label="last 60 min" value={last60} />
        <Stat label="QSO/hr" value={hourly} accent="var(--accent-green)" />
      </div>
      <svg
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '28px', display: 'block' }}
        aria-label="QSO rate trend, last hour in 5 minute buckets"
        role="img"
      >
        {buckets.map((n, i) => {
          const h = (n / max) * 22;
          return (
            <rect
              key={i}
              x={i * barW + 0.5}
              y={24 - h}
              width={barW - 1}
              height={Math.max(h, n > 0 ? 1 : 0.5)}
              fill={n > 0 ? 'var(--accent-green)' : 'var(--border-color)'}
              opacity={n > 0 ? 0.9 : 0.5}
            />
          );
        })}
      </svg>
    </div>
  );
};

export default RateMeter;
