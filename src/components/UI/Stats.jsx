export default function Stats({ items, className = '' }) {
  return (
    <div className={`stats-grid ${className}`.trim()}>
      {items.map((item) => (
        <div
          className={`stat ${item.tone ? `stat--${item.tone}` : ''} ${item.featured ? 'stat--featured' : ''}`.trim()}
          key={item.label}
        >
          <div className="stat__body">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.detail && <small>{item.detail}</small>}
          </div>
          {item.icon ? <span className="stat__icon">{item.icon}</span> : null}
        </div>
      ))}
    </div>
  );
}
