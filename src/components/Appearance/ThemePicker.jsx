import { CalendarDays, Check, Palette, Share2 } from 'lucide-react';
import { useState } from 'react';
import { useSeasonalTheme } from '../../hooks/useSeasonalTheme.jsx';
import { SEASONAL_THEMES, seasonalThemeLabel } from '../../utils/seasonalTheme.js';
import './SeasonalAppearance.css';

export function SeasonalMotif({ theme, className = '' }) {
  return <span aria-hidden="true" className={`seasonal-motif seasonal-motif--${theme} ${className}`} />;
}

export default function ThemePicker({ compact = false }) {
  const { preference, theme, selectTheme, saveStatus, serverState, saving } = useSeasonalTheme();
  const [confirmPublish, setConfirmPublish] = useState(false);
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
        className={`theme-menu-option ${selected ? 'theme-menu-option--selected' : ''}`} disabled={saving}
        onClick={() => selectTheme(value)} onKeyDown={(event) => navigateOptions(event, index)}>
        <span className="theme-menu-radio" aria-hidden="true">{selected && <Check size={13} />}</span><span>{label}</span>
      </button>
    );
    return (
      <label key={value} className={`theme-choice ${selected ? 'theme-choice--selected' : ''}`}>
        <input type="radio" name="seasonal-theme" value={value} checked={selected} disabled={saving} onChange={() => selectTheme(value)} />
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
        <small>{serverState?.controlsPublicQr ? 'Tema das picagens: esta conta' : 'Preferência pessoal'}</small>
      </div>
      {serverState?.canPublishQr && !serverState.controlsPublicQr && <div className="theme-publish-actions">
        {confirmPublish ? <>
          <span>Passar o tema de todos os links de picagem para esta conta?</span>
          <button type="button" className="secondary-button" onClick={() => setConfirmPublish(false)}>Cancelar</button>
          <button type="button" className="command-button" disabled={saving} onClick={() => { setConfirmPublish(false); selectTheme(preference, { publishToQr: true }); }}><Share2 size={16} />Aplicar aos links</button>
        </> : <button type="button" className="secondary-button" disabled={saving} onClick={() => setConfirmPublish(true)}><Share2 size={16} />Usar o meu tema nos links de picagem</button>}
      </div>}
      <p className="theme-save-status" role="status">{saveStatus}</p>
    </div>
  );
}
