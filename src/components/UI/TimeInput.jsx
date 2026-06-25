import { isCompleteTimeInput, normalizeTimeInput, sanitizeTimeInput } from '../../utils/timeInput.js';

export default function TimeInput({
  value = '',
  onChange,
  onBlur,
  placeholder = 'HH:MM',
  ...props
}) {
  function handleChange(event) {
    event.currentTarget.setCustomValidity('');
    onChange?.(sanitizeTimeInput(event.target.value), event);
  }

  function handleBlur(event) {
    const normalized = normalizeTimeInput(event.target.value);
    const valid = !normalized || isCompleteTimeInput(normalized);
    event.currentTarget.setCustomValidity(valid ? '' : 'Introduz uma hora válida no formato HH:MM.');
    onChange?.(normalized, event);
    onBlur?.(normalized, event);
  }

  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      maxLength={5}
      placeholder={placeholder}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
