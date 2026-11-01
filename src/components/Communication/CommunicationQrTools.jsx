import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

export function useCommunicationQrTools() {
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function copyLink(row) {
    try {
      await window.navigator.clipboard.writeText(row.qrUrl);
      setNotice('Link copiado');
    } catch {
      setNotice('Não foi possível copiar o link. Verifica a permissão da área de transferência.');
    }
  }
  return { notice, copyLink };
}

export function CommunicationQrActions({ row, tools }) {
  const url = row?.attendanceQrUrl || row?.monthlyQrUrl || row?.qrUrl;
  const label = row?.attendanceQrUrl ? 'Copiar link de picagem' : 'Copiar Link';
  return <div className="communication-qr-actions">
    <button type="button" className="secondary-button" title={label}
      aria-label={`${label}${row ? ` de ${row.collaboratorName}` : ''}`} disabled={!url}
      onClick={() => tools.copyLink({ ...row, qrUrl: url })}>
      <Copy size={16} /> {label}
    </button>
  </div>;
}
