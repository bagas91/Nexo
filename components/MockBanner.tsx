import React from 'react';

const MockBanner: React.FC = () => (
  <div
    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs border mb-4"
    style={{ background: 'var(--bs-elevated)', borderColor: 'var(--bs-border)', color: 'var(--bs-muted)' }}
  >
    <i className="fa-solid fa-flask text-bs-accent" />
    <span>
      <strong className="text-bs-text">Modo mock</strong> — dados salvos no navegador (localStorage). Não afeta WhatsApp nem backend.
    </span>
  </div>
);

export default MockBanner;
