import React from 'react';
import { BRANDING, studioCreditFull, studioCreditShort } from '../config/branding';

type StudioCreditVariant = 'sidebar' | 'login' | 'settings';

interface StudioCreditProps {
  variant?: StudioCreditVariant;
}

const StudioCredit: React.FC<StudioCreditProps> = ({ variant = 'sidebar' }) => {
  if (variant === 'sidebar') {
    return (
      <p className="bs-studio-credit text-center px-2">
        {studioCreditShort}
        <span className="block text-[9px] opacity-75 mt-0.5">{BRANDING.studioAuthor}</span>
      </p>
    );
  }

  if (variant === 'login') {
    return (
      <p className="bs-studio-credit text-center mt-4">
        {studioCreditFull}
      </p>
    );
  }

  return (
    <div className="text-sm text-bs-muted space-y-1">
      <p>
        <span className="font-semibold text-bs-text">{BRANDING.productName}</span>
        {' '}
        v{BRANDING.version}
        <span className="text-bs-subtle"> · {BRANDING.productTagline}</span>
      </p>
      <p className="text-xs text-bs-subtle">{studioCreditFull}</p>
    </div>
  );
};

export default StudioCredit;
