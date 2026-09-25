import { Bell, BellOff, Save, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';
import { currentPushDevice, disablePush, enablePush, pushAvailability, requestPushPermission } from '../../utils/pushNotifications.js';
import './PushSettings.css';

export default function PushSettings({ userId }) {
  const [config, setConfig] = useState(null);
  const [device, setDevice] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [preferences, setPreferences] = useState({ notifyEntry: true, notifyExit: true });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const unavailable = pushAvailability();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api('/push/config');
        if (cancelled) return;
        setConfig(result);
        if (globalThis.isSecureContext && globalThis.PushManager && globalThis.navigator?.serviceWorker) {
          const current = await currentPushDevice();
          if (cancelled) return;
          setDevice(current.device);
          setSubscription(current.subscription);
          if (current.device) {
            setPreferences({ notifyEntry: current.device.notifyEntry, notifyExit: current.device.notifyExit });
          }
        }
      } catch (err) { if (!cancelled) setError(err.message); }
      finally { if (!cancelled) setBusy(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [userId, unavailable]);

  async function run(action) {
    if (busy) return;
    setBusy(true); setMessage(''); setError('');
    try { await action(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function activate() {
    const permission = requestPushPermission();
    void run(async () => {
      const current = await enablePush(config.publicKey, preferences, userId, permission);
      setDevice(current.device); setSubscription(current.subscription);
      setMessage('Notificações ativas neste dispositivo.');
    });
  }
  const blocked = busy || Boolean(unavailable) || !config?.configured;
  return (
    <section className="push-settings" aria-labelledby="push-title">
      <header><Bell size={20} /><h2 id="push-title">Notificações de picagens</h2></header>
      <p>{device ? 'Ativas neste dispositivo' : 'Inativas neste dispositivo'}</p>
      {unavailable ? <p className="notice">{unavailable}</p> : config && !config.configured ? <p className="notice">Notificações ainda não configuradas no servidor.</p> : null}
      <fieldset disabled={blocked}>
        <legend>Receber alertas</legend>
        <label><input type="checkbox" checked={preferences.notifyEntry} onChange={(event) => setPreferences((old) => ({ ...old, notifyEntry: event.target.checked }))} />Entradas</label>
        <label><input type="checkbox" checked={preferences.notifyExit} onChange={(event) => setPreferences((old) => ({ ...old, notifyExit: event.target.checked }))} />Saídas</label>
      </fieldset>
      <div className="push-settings__actions">
        {!device ? <button type="button" className="command-button" disabled={blocked} onClick={activate}><Bell size={17} />Ativar neste dispositivo</button> : <>
          <button type="button" className="command-button" disabled={blocked} onClick={() => run(async () => {
            const result = await api('/push/device', { method: 'PUT', body: JSON.stringify({ subscription: subscription.toJSON(), ...preferences }) });
            setDevice(result); setMessage('Preferências guardadas.');
          })}><Save size={17} />Guardar preferências</button>
          <button type="button" className="button button--ghost" disabled={blocked} onClick={() => run(async () => {
            const result = await api('/push/test', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) });
            setMessage(result.message);
          })}><Send size={17} />Testar notificação</button>
          <button type="button" className="button button--ghost" disabled={busy} onClick={() => run(async () => {
            try { await disablePush(); }
            finally { setDevice(null); setSubscription(null); }
            setMessage('Notificações desativadas neste dispositivo.');
          })}><BellOff size={17} />Desativar</button>
        </>}
        {subscription && !device && <button type="button" className="button button--ghost" disabled={busy} onClick={() => run(async () => {
          try { await disablePush(); }
          finally { setSubscription(null); }
          setMessage('Subscrição local removida.');
        })}><BellOff size={17} />Remover subscrição local</button>}
      </div>
      <div aria-live="polite">{busy && <p>A processar...</p>}{message && <p className="success-note">{message}</p>}{error && <p className="notice" role="alert">{error}</p>}</div>
    </section>
  );
}
