import { formatGmtUtc } from '../utils';
import { useTranslation } from 'react-i18next';

/**
 * DXLocalTime — always shows the local time at the DX target location.
 *
 * Uses the real IANA timezone from the API when available; falls back to
 * an approximate solar timezone computed from longitude.
 */
export function DXLocalTime({ currentTime, timezone, solarTimezone }) {
  const { t } = useTranslation();

  // Prefer real IANA timezone; fall back to solar approximation.
  const effectiveTimezone = timezone ?? solarTimezone?.tz;
  const isFallback = timezone == null && solarTimezone?.tz != null;

  if (!effectiveTimezone) return null;

  const now = currentTime instanceof Date ? currentTime : new Date(currentTime);
  if (Number.isNaN(now.getTime())) return null;

  const localTime = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: effectiveTimezone,
  }).format(now);

  const fTz = formatGmtUtc(effectiveTimezone);

  return (
    <div
      style={{ color: 'var(--accent-cyan)', fontSize: '13px', marginTop: '2px' }}
      title={isFallback ? t('app.dxTime.solarFallbackTitle', 'Approximate solar time (API unavailable)') : undefined}
    >
      {localTime}{' '}
      <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
        ({fTz}){isFallback && <span style={{ color: 'var(--accent-amber)' }}> ⚠</span>}
      </span>
    </div>
  );
}

export default DXLocalTime;
