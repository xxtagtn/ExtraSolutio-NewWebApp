import { Shirt } from 'lucide-react';
import './qrUniform.css';

export default function QrUniform({ uniform, uniformNotes }) {
  const clothing = String(uniform || '').trim();
  const note = String(uniformNotes || '').trim();
  if (!clothing && !note) return null;
  return <section className="qr-uniform" aria-label="Fardamento">
    <div className="qr-uniform__heading"><Shirt size={18} aria-hidden="true" /><strong>Fardamento</strong></div>
    {clothing && <p className="qr-uniform__description">{clothing}</p>}
    {note && <p className="qr-uniform__note">{note}</p>}
  </section>;
}
