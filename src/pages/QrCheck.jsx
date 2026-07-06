import { CheckCircle2, Clock3, LogIn, LogOut, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_URL } from '../utils/api.js';

async function publicQrApi(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
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

export default function QrCheck() {
  const { token } = useParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPayload(await publicQrApi(`/qr-check/${encodeURIComponent(token)}`));
    } catch (err) {
      setError(err.message || 'QR Code inválido.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function register(action) {
    setSaving(true);
    setError('');
    try {
      const next = await publicQrApi(`/qr-check/${encodeURIComponent(token)}/${action}`, { method: 'POST' });
      setPayload(next);
    } catch (err) {
      setError(err.message || 'Não foi possível registar a hora.');
    } finally {
      setSaving(false);
    }
  }

  const nextAction = payload?.state?.nextAction;

  return (
    <main className="qr-check-page">
      <section className="qr-check-card">
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
            <button type="button" className="secondary-button" onClick={load}>Tentar novamente</button>
          </div>
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
              <button type="button" className="qr-check-command" disabled={saving} onClick={() => register('check-out')}>
                <LogOut size={20} /> Dar Saída
              </button>
            )}

            <p className="qr-check-footnote">A hora é registada pelo servidor da ExtraSolutio.</p>
          </>
        )}
      </section>
    </main>
  );
}
