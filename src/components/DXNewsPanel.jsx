/**
 * DXNewsPanel — full reader over the merged DX news feed (dockable panel
 * `dx-news`).
 *
 * Same data as the scrolling DXNewsTicker (shared useDXNews hook over
 * GET /api/dxnews: dxnews.com + dx-world.net + NG3K), presented as a
 * newest-first list: source badge, title, relative age, expandable
 * summary with an external "open article" link, and per-source filter
 * chips. A read/unread dot persists in localStorage
 * (openhamclock_dxNewsRead, capped at 200 ids) — expanding an item
 * marks it read.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDXNews } from '../hooks/useDXNews.js';
import { loadReadIds, saveReadIds, markRead, relativeTime } from '../utils/dxNewsRead.js';

const SOURCE_COLORS = {
  DXNEWS: 'var(--accent-amber)',
  'DX-WORLD': 'var(--accent-cyan)',
  NG3K: 'var(--accent-green)',
};

const sourceColor = (source) => SOURCE_COLORS[source] || 'var(--text-secondary)';

const chipStyle = (active, color) => ({
  background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
  border: `1px solid ${active ? color : 'var(--border-color)'}`,
  borderRadius: '10px',
  color: active ? color : 'var(--text-secondary)',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: '9px',
  fontWeight: active ? '700' : '400',
  padding: '1px 8px',
  flexShrink: 0,
});

export const DXNewsPanel = () => {
  const { t } = useTranslation();
  const { items, loading } = useDXNews(true);
  const [filter, setFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [readIds, setReadIds] = useState(loadReadIds);

  // Feed arrives newest-first from the server (D-09); keep a defensive sort.
  const sorted = useMemo(
    () => [...items].sort((a, b) => new Date(b.publishDate || 0) - new Date(a.publishDate || 0)),
    [items],
  );

  const sources = useMemo(() => [...new Set(items.map((i) => i.source).filter(Boolean))], [items]);
  const visible = filter === 'all' ? sorted : sorted.filter((i) => i.source === filter);
  const readSet = useMemo(() => new Set(readIds), [readIds]);

  const handleToggle = (item) => {
    setExpandedId((cur) => (cur === item.id ? null : item.id));
    if (!readSet.has(item.id)) {
      const next = markRead(readIds, item.id);
      setReadIds(next);
      saveReadIds(next);
    }
  };

  const unreadCount = sorted.filter((i) => !readSet.has(i.id)).length;

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          marginBottom: '6px',
          fontSize: '11px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'var(--accent-primary)',
          fontWeight: '700',
        }}
      >
        <span>📰 {t('dxNewsPanel.title', { defaultValue: 'DX NEWS' })}</span>
        {unreadCount > 0 && (
          <span style={{ color: 'var(--accent-amber)', fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
            {t('dxNewsPanel.unread', { defaultValue: '{{n}} unread', n: unreadCount })}
          </span>
        )}
      </div>

      {sources.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
          <button
            style={chipStyle(filter === 'all', 'var(--accent-primary)')}
            onClick={() => setFilter('all')}
            aria-pressed={filter === 'all'}
          >
            {t('dxNewsPanel.allSources', { defaultValue: 'All' })}
          </button>
          {sources.map((s) => (
            <button
              key={s}
              style={chipStyle(filter === s, sourceColor(s))}
              onClick={() => setFilter((cur) => (cur === s ? 'all' : s))}
              aria-pressed={filter === s}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', padding: '10px 4px' }}>
            {t('dxNewsPanel.loading', { defaultValue: 'Loading DX news…' })}
          </div>
        ) : visible.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: '10px 4px', lineHeight: 1.5 }}>
            {t('dxNewsPanel.empty', {
              defaultValue:
                'No fresh DX news right now. The feed merges dxnews.com, dx-world.net, and NG3K, keeping only recent items — check back later.',
            })}
          </div>
        ) : (
          visible.map((item) => {
            const isRead = readSet.has(item.id);
            const expanded = expandedId === item.id;
            const age = relativeTime(item.publishDate);
            return (
              <div
                key={item.id}
                style={{
                  padding: '5px 6px',
                  marginBottom: '3px',
                  borderRadius: '4px',
                  background: expanded ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                  border: '1px solid transparent',
                }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  onClick={() => handleToggle(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleToggle(item);
                    }
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                >
                  <span
                    data-testid="dxnews-read-dot"
                    title={
                      isRead
                        ? t('dxNewsPanel.read', { defaultValue: 'Read' })
                        : t('dxNewsPanel.unreadDot', { defaultValue: 'Unread' })
                    }
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: isRead ? 'transparent' : 'var(--accent-amber)',
                      border: isRead ? '1px solid var(--border-color)' : '1px solid var(--accent-amber)',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      color: sourceColor(item.source),
                      fontSize: '8px',
                      fontWeight: '700',
                      border: `1px solid ${sourceColor(item.source)}`,
                      borderRadius: '3px',
                      padding: '0 3px',
                      flexShrink: 0,
                    }}
                  >
                    {item.source}
                  </span>
                  <span
                    style={{
                      color: isRead ? 'var(--text-secondary)' : 'var(--text-primary)',
                      fontWeight: isRead ? '400' : '600',
                      flex: 1,
                      whiteSpace: expanded ? 'normal' : 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minWidth: 0,
                    }}
                  >
                    {item.title}
                  </span>
                  {age && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '9px', flexShrink: 0 }}>
                      {t('dxNewsPanel.ago', { defaultValue: '{{age}} ago', age })}
                    </span>
                  )}
                </div>
                {expanded && (
                  <div style={{ marginTop: '4px', paddingLeft: '12px' }}>
                    {item.description && item.description !== item.title && (
                      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '4px' }}>
                        {item.description}
                      </div>
                    )}
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--accent-cyan)', textDecoration: 'none', fontSize: '9px' }}
                    >
                      {t('dxNewsPanel.openArticle', { defaultValue: 'Open article ↗' })}
                    </a>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          textAlign: 'right',
          fontSize: '9px',
          color: 'var(--text-muted)',
          paddingTop: '2px',
        }}
      >
        {t('dxNewsPanel.footer', { defaultValue: 'dxnews.com · dx-world.net · ng3k.com' })}
      </div>
    </div>
  );
};

export default DXNewsPanel;
