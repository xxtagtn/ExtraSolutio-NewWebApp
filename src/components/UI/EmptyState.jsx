export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}) {
  return (
    <div className={`empty-state ${compact ? 'empty-state--compact' : ''}`}>
      {Icon ? (
        <span className="empty-state__icon" aria-hidden="true">
          <Icon size={compact ? 17 : 22} />
        </span>
      ) : null}
      <div className="empty-state__content">
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
