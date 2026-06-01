export default function IconButton({ children, label, tone = 'neutral', ...props }) {
  return (
    <button className={`icon-button icon-button--${tone}`} type="button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}
