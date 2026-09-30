import React from 'react';

interface HelpTipProps {
  /** Texto da explicação (pode ter várias frases). */
  text: string;
  className?: string;
  /** Lado preferido do balão. */
  side?: 'top' | 'bottom';
}

/**
 * Ícone "?" com tooltip ao passar o mouse — para termos de vendas/analytics.
 */
const HelpTip: React.FC<HelpTipProps> = ({ text, className = '', side = 'top' }) => (
  <span
    className={`relative inline-flex items-center group/helptip align-middle ${className}`}
    tabIndex={0}
    role="img"
    aria-label={text}
  >
    <i
      className="fa-regular fa-circle-question text-[11px] text-bs-subtle hover:text-bs-muted cursor-help leading-none"
      aria-hidden
    />
    <span
      className={`pointer-events-none absolute z-50 w-56 sm:w-64 rounded-lg border border-bs-border bg-bs-surface px-2.5 py-2 text-[11px] leading-snug text-bs-text shadow-card opacity-0 invisible group-hover/helptip:opacity-100 group-hover/helptip:visible group-focus-within/helptip:opacity-100 group-focus-within/helptip:visible transition-opacity duration-150 left-1/2 -translate-x-1/2 ${
        side === 'bottom'
          ? 'top-full mt-1.5'
          : 'bottom-full mb-1.5'
      }`}
    >
      {text}
    </span>
  </span>
);

export default HelpTip;
