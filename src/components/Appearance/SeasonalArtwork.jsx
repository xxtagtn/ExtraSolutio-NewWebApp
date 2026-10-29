export default function SeasonalArtwork({ placement }) {
  if (placement === 'header') return <span className="seasonal-header-decoration" aria-hidden="true"><span className="seasonal-header-scene" /></span>;
  if (placement === 'public-footer') return <span className="qr-seasonal-footer" aria-hidden="true"><span className="seasonal-art-tile seasonal-art-tile--base" /></span>;
  if (placement === 'sidebar-edge') return (
    <span className="seasonal-sidebar-edge" aria-hidden="true">
      {Array.from({ length: 24 }, (_, index) => <span key={index} className="seasonal-art-tile seasonal-art-tile--edge" />)}
    </span>
  );
  return <span className="seasonal-sidebar-scene" aria-hidden="true"><span className="seasonal-art-tile seasonal-art-tile--base" /></span>;
}
