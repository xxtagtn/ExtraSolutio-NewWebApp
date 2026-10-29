import { CalendarDays, Check, Palette } from 'lucide-react';
import { useSeasonalTheme } from '../../hooks/useSeasonalTheme.jsx';
import { SEASONAL_THEMES, seasonalThemeLabel } from '../../utils/seasonalTheme.js';
import './SeasonalAppearance.css';

export function SeasonalMotif({ theme, className = '' }) {
  return <span aria-hidden="true" className={`seasonal-motif seasonal-motif--${theme} ${className}`} />;
}

export default function ThemePicker({ compact = false }) {
  const { preference, theme, selectTheme, saveStatus } = useSeasonalTheme();
  function navigateOptions(event, index) {
    const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? SEASONAL_THEMES.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + SEASONAL_THEMES.length) % SEASONAL_THEMES.length;
    event.currentTarget.parentElement.children[next].focus();
  }
  const content = SEASONAL_THEMES.map(({ value, label }, index) => {
    const selected = preference === value;
    const visual = value === 'original' ? <Palette size={20} /> : value === 'automatic'
      ? <CalendarDays size={20} /> : <SeasonalMotif theme={value} />;
    if (compact) return (
      <button key={value} type="button" role="menuitemradio" aria-checked={selected}
        className={`theme-menu-option ${selected ? 'theme-menu-option--selected' : ''}`}
        onClick={() => selectTheme(value)} onKeyDown={(event) => navigateOptions(event, index)}>
        {visual}<span>{label}</span>{selected && <Check size={16} aria-hidden="true" />}
      </button>
    );
    return (
      <label key={value} className={`theme-choice ${selected ? 'theme-choice--selected' : ''}`}>
        <input type="radio" name="seasonal-theme" value={value} checked={selected} onChange={() => selectTheme(value)} />
        {visual}<span>{label}</span>{selected && <Check size={17} aria-hidden="true" />}
      </label>
    );
  });
  if (compact) return <div className="theme-menu-options" role="group" aria-label="Tema da aplicação">{content}</div>;
  return (
    <div className="theme-settings" id="appearance">
      <fieldset className="theme-choices"><legend>Tema da aplicação</legend>{content}</fieldset>
      <div className="theme-settings__status">
        <span>Tema ativo: <strong>{seasonalThemeLabel(theme)}</strong></span>
        <small>Preferência deste utilizador neste navegador</small>
      </div>
      <p className="theme-save-status" role="status">{saveStatus}</p>
    </div>
  );
}
