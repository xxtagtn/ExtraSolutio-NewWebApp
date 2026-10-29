import SeasonalArtwork from '../Appearance/SeasonalArtwork.jsx';

export default function QrLinkHeader({ themed = false, className = '', children }) {
  return <header className={`qr-check-header ${className}${themed ? ' qr-seasonal-header' : ''}`}>
    {themed ? <>
      <SeasonalArtwork placement="header" />
      <div className="qr-seasonal-identity">
        <img src="/logo.png" alt="ExtraSolutio" />
        <div className="qr-seasonal-identity-details">{children}</div>
      </div>
    </> : children}
  </header>;
}
