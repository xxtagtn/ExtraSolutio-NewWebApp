import { CheckCircle2, Clock3, LogIn, LogOut, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_URL } from '../utils/api.js';
import DailyQrServices from '../components/Communication/DailyQrServices.jsx';

async function publicQrApi(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Pedido falhou.');
  }
  return response.json();
}

function formatDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

function StateBadge({ state }) {
  const key = state?.key || 'qr_generated';
  return <span className={`qr-check-state qr-check-state--${key}`}>{state?.label || 'QR Gerado'}</span>;
}

export default function QrCheck({ daily = false }) {
  const { token } = useParams();
  return <QrCheckPage key={`${daily}:${token}`} token={token} daily={daily} />;
}

function QrCheckPage({ token, daily }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const pending = useRef(false);
  const revision = useRef(0);
  const endpoint = `/qr-check/${daily ? 'day/' : ''}${encodeURIComponent(token)}`;

  const load = useCallback(async ({ silent = false } = {}) => {
    if (pending.current) return;
    const request = ++revision.current;
    if (!silent) setLoading(true);
    try {
      const next = await publicQrApi(endpoint);
      if (request !== revision.current) return;
      setPayload(next);
      setError('');
    } catch (err) {
      if (request !== revision.current) return;
      setError(err.message || 'QR Code inválido.');
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const requests = revision;
    load();
    const refresh = () => {
      if (document.visibilityState === 'visible') load({ silent: true });
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const interval = window.setInterval(refresh, 15000);
    return () => {
      ++requests.current;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  useEffect(() => {
    const delays = [payload?.checkOutRetryAfterMs, payload?.switchRetryAfterMs, payload?.punchRetryAfterMs,
      ...(payload?.services || []).map((service) => service.checkOutRetryAfterMs)].filter((value) => value > 0);
    if (!delays.length) return;
    const timeout = window.setTimeout(() => load({ silent: true }), Math.min(...delays) + 50);
    return () => window.clearTimeout(timeout);
  }, [payload, load]);

  async function register(action, assignmentId) {
    // React state updates alone do not serialize rapid taps or in-flight refreshes.
    if (pending.current) return;
    pending.current = true;
    const request = ++revision.current;
    setSaving(true);
    setError('');
    setActionError('');
    let refreshNeeded = false;
    try {
      const next = await publicQrApi(`${endpoint}/${action}`, {
        method: 'POST',
        ...(daily ? { body: JSON.stringify({ assignmentId, revision: payload.revision }) } : {}),
      });
      if (request === revision.current) setPayload(next);
    } catch (err) {
      if (request === revision.current) {
        setActionError(err.message || 'Não foi possível registar a hora.');
        refreshNeeded = true;
      }
    } finally {
      pending.current = false;
      setSaving(false);
      if (refreshNeeded) await load({ silent: true });
    }
  }

  const nextAction = payload?.state?.nextAction;
  const checkoutBlocked = payload?.checkOutRetryAfterMs > 0;

  return (
    <main className="qr-check-page">
      <section className={`qr-check-card${daily ? ' qr-check-card--daily' : ''}`}>
        <div className="qr-check-logo">ES</div>
        {loading ? (
          <div className="qr-check-empty">
            <Clock3 size={28} />
            <h1>A carregar QR Code</h1>
            <p>A validar o serviço associado.</p>
          </div>
        ) : error ? (
          <div className="qr-check-empty qr-check-empty--error">
            <ShieldAlert size={32} />
            <h1>Não foi possível validar</h1>
            <p>{error}</p>
            <button type="button" className="secondary-button" onClick={() => load()}>Tentar novamente</button>
          </div>
        ) : daily ? (
          <>
            <DailyQrServices payload={payload} saving={saving} onRegister={register} />
            {actionError && <p className="qr-check-footnote" role="alert">{actionError}</p>}
            <p className="qr-check-footnote">A hora é registada pelo servidor da ExtraSolutio.</p>
          </>
        ) : (
          <>
            <header className="qr-check-header">
              <StateBadge state={payload.state} />
              <h1>{payload.eventName}</h1>
              <p>{payload.clientName || 'ExtraSolutio'} · {formatDate(payload.assignmentDate)}</p>
            </header>

            <dl className="qr-check-details">
              <div>
                <dt>Colaborador</dt>
                <dd>{payload.collaboratorName}</dd>
              </div>
              <div>
                <dt>Função</dt>
                <dd>{payload.role || '-'}</dd>
              </div>
              <div>
                <dt>Previsto</dt>
                <dd>{[payload.plannedCheckIn, payload.plannedCheckOut].filter(Boolean).join(' → ') || '-'}</dd>
              </div>
              <div>
                <dt>Entrada</dt>
                <dd>{payload.checkIn || 'Por registar'}</dd>
              </div>
              <div>
                <dt>Saída</dt>
                <dd>{payload.checkOut || 'Por registar'}</dd>
              </div>
            </dl>

            {payload.completed ? (
              <div className="qr-check-completed">
                <CheckCircle2 size={22} />
                <span>Entrada e saída já registadas.</span>
              </div>
            ) : nextAction === 'check_in' ? (
              <button type="button" className="qr-check-command" disabled={saving} onClick={() => register('check-in')}>
                <LogIn size={20} /> Dar Entrada
              </button>
            ) : (
              <button type="button" className="qr-check-command" disabled={saving || checkoutBlocked} onClick={() => register('check-out')}>
                <LogOut size={20} /> Dar Saída
              </button>
            )}

            {checkoutBlocked && (
              <p className="qr-check-footnote" role="status">
                Entrada já registada. Podes dar saída a partir das {payload.checkOutAvailableTime}, 30 minutos após a entrada.
              </p>
            )}
            {actionError && <p className="qr-check-footnote" role="alert">{actionError}</p>}
            <p className="qr-check-footnote">A hora é registada pelo servidor da ExtraSolutio.</p>
          </>
        )}
      </section>
    </main>
  );
}
