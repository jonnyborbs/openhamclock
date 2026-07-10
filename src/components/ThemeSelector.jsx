import { useEffect } from 'react';
import { setActiveThemeButton } from '../theme/themeUtils';
import { AVAILABLE_THEMES } from '../theme/themeConfig';

export default function ThemeSelector({ id, theme, setTheme }) {
  useEffect(() => {
    setActiveThemeButton(theme);
  }, []);

  return (
    <>
      <div id={id} style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
        {Object.entries(AVAILABLE_THEMES).map(([key, t]) => (
          <button
            type="button"
            className={`${key}-theme-select-button theme-select-button`}
            key={key}
            onClick={() => setTheme(key)}
            aria-pressed={theme === key}
            aria-label={`${t.label} theme`}
            title={`${t.label} theme`}
          >
            <span aria-hidden="true" className="icon">
              {t.icon}
            </span>{' '}
            {t.label}
          </button>
        ))}
      </div>
    </>
  );
}
