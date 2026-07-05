import React from 'react';

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }> = ({
  on,
  onChange,
  label,
  disabled,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    data-on={on ? 'true' : 'false'}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className="bs-toggle disabled:opacity-50"
  >
    <span className="bs-toggle-thumb" />
  </button>
);

export default Toggle;
