import React from 'react';

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
  <div className="bs-card px-6 py-12 text-center">
    <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-bs-elevated border border-bs-border flex items-center justify-center text-bs-muted text-2xl">
      <i className={`fa-solid ${icon}`} />
    </div>
    <h3 className="font-bold text-bs-text mb-2">{title}</h3>
    <p className="text-sm text-bs-muted max-w-md mx-auto mb-4">{description}</p>
    {action && (
      <button type="button" onClick={action.onClick} className="bs-btn px-5 py-2 text-sm">
        {action.label}
      </button>
    )}
  </div>
);

export default EmptyState;
