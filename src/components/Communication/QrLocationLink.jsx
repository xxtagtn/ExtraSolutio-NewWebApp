import { ExternalLink, MapPin } from 'lucide-react';
import { googleMapsDirectionsUrl } from '../../utils/googleMapsDirections.js';

export default function QrLocationLink({ location, workLocation }) {
  const destination = typeof location === 'string' ? location.trim() : '';
  const area = typeof workLocation === 'string' ? workLocation.trim() : '';
  const label = [destination, area].filter(Boolean).join(' · ');
  if (!label) return null;
  const href = googleMapsDirectionsUrl(destination);
  const content = <><MapPin size={16} aria-hidden="true" /><span>{label}</span></>;
  return <p className="qr-day-location">{href ? (
    <a className="qr-location-link" href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
      title="Abrir direções no Google Maps (nova janela)"
      aria-label={`Abrir direções no Google Maps para ${destination} (nova janela)`}>
      {content}<ExternalLink size={14} aria-hidden="true" />
    </a>
  ) : content}</p>;
}
