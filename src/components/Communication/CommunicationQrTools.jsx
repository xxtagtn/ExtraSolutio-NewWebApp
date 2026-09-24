import { Copy, Download, Eye, Printer, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import Modal from '../UI/Modal.jsx';
import { date } from '../../utils/formatters.js';

function qrDataUrl(row) {
  return QRCode.toDataURL(row.qrUrl, {
    width: 900, margin: 2, errorCorrectionLevel: 'M',
    color: { dark: '#041012', light: '#ffffff' },
  });
}

function qrDate(row) {
  return row.assignmentDate ? date.format(new Date(row.assignmentDate)) : '';
}

export function useCommunicationQrTools() {
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null);
  const [image, setImage] = useState('');
  const generation = useRef(0);

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

  async function open(row) {
    const request = ++generation.current;
    setSelected(row);
    setImage('');
    setNotice('');
    try {
      const next = await qrDataUrl(row);
      if (request === generation.current) setImage(next);
    } catch {
      if (request === generation.current) setNotice('Não foi possível apresentar o QR Code. Tenta novamente.');
    }
  }

  function close() {
    ++generation.current;
    setSelected(null);
    setImage('');
  }

  async function download(row) {
    try {
      const link = document.createElement('a');
      link.href = await qrDataUrl(row);
      link.download = `qr-${row.collaboratorName || 'colaborador'}-${row.assignmentId}.png`;
      link.click();
    } catch {
      setNotice('Não foi possível descarregar o QR Code.');
    }
  }

  async function copyImage(row) {
    try {
      if (!window.ClipboardItem || !window.navigator.clipboard?.write) throw new Error('Clipboard unavailable');
      // Keep clipboard access in the click gesture, including browsers that await a PNG promise.
      const png = qrDataUrl(row).then((url) => fetch(url)).then((response) => response.blob());
      await window.navigator.clipboard.write([new window.ClipboardItem({ 'image/png': png })]);
      setNotice('QR Code copiado');
    } catch {
      setNotice('Não foi possível copiar a imagem. Usa Download para guardar o QR Code.');
    }
  }

  async function print(row) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setNotice('Permite a abertura da janela de impressão no browser.');
      return;
    }
    printWindow.opener = null;
    try {
      const url = await qrDataUrl(row);
      const doc = printWindow.document;
      doc.title = `QR Code - ${row.collaboratorName}`;
      doc.body.style.cssText = 'font-family:Arial,sans-serif;padding:32px;text-align:center;color:#111';
      const img = doc.createElement('img');
      img.width = 280;
      img.height = 280;
      img.alt = 'QR Code';
      img.onload = () => { printWindow.print(); printWindow.close(); };
      img.src = url;
      doc.body.appendChild(img);
      for (const [tag, value] of [['h1', row.collaboratorName], ['p', row.eventName], ['p', `${qrDate(row)} · ${row.role || ''}`], ['p', [row.startTime, row.endTime].filter(Boolean).join(' → ')]]) {
        const element = doc.createElement(tag);
        element.textContent = value || '';
        doc.body.appendChild(element);
      }
    } catch {
      printWindow.close();
      setNotice('Não foi possível imprimir o QR Code.');
    }
  }

  return { notice, selected, image, copyLink, open, close, download, copyImage, print };
}

export function CommunicationQrActions({ row, tools, compact = false }) {
  const disabled = !row?.qrUrl;
  const className = compact ? 'icon-button' : 'secondary-button';
  return (
    <div className="communication-qr-actions">
      <button type="button" className={className} title="Copiar Link" aria-label={`Copiar Link${row ? ` de ${row.collaboratorName}` : ''}`} disabled={disabled} onClick={() => tools.copyLink(row)}>
        <Copy size={16} />{!compact && ' Copiar Link'}
      </button>
      <button type="button" className={className} title="Ver QR" aria-label={`Ver QR Code${row ? ` de ${row.collaboratorName}` : ''}`} disabled={disabled} onClick={() => tools.open(row)}>
        {compact ? <Eye size={16} /> : <QrCode size={16} />}{!compact && ' QR Code'}
      </button>
      {compact && <>
        <button type="button" className="icon-button" title="Imprimir" disabled={disabled} onClick={() => tools.print(row)}><Printer size={16} /></button>
        <button type="button" className="icon-button" title="Download" disabled={disabled} onClick={() => tools.download(row)}><Download size={16} /></button>
      </>}
    </div>
  );
}

export function CommunicationQrDialog({ tools }) {
  const row = tools.selected;
  if (!row) return null;
  return (
    <Modal title={`QR Code · ${row.collaboratorName}`} onClose={tools.close}>
      <div className="communication-qr-dialog">
        <p>{row.eventName} · {qrDate(row)}</p>
        <p>{[row.startTime, row.endTime].filter(Boolean).join(' → ')}</p>
        {tools.image ? <img src={tools.image} alt={`QR Code de ${row.collaboratorName}`} /> : <p>A preparar QR Code...</p>}
        <code>{row.qrUrl}</code>
        <span role="status" aria-live="polite">{tools.notice}</span>
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={() => tools.copyLink(row)}><Copy size={16} /> Copiar Link</button>
          <button type="button" className="secondary-button" onClick={() => tools.copyImage(row)} disabled={!tools.image}><Copy size={16} /> Copiar QR Code</button>
          <button type="button" className="secondary-button" onClick={() => tools.print(row)}><Printer size={16} /> Imprimir</button>
          <button type="button" className="command-button" onClick={() => tools.download(row)}><Download size={16} /> Download</button>
        </div>
      </div>
    </Modal>
  );
}
