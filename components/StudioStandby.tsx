import React from 'react';
import { User } from '../types';
import { BRANDING } from '../config/branding';
import StudioCredit from './StudioCredit';

interface StudioStandbyProps {
  user: User;
  onLogout: () => void;
}

const StudioStandby: React.FC<StudioStandbyProps> = ({ user, onLogout }) => {
  return (
    <div className="min-h-screen bg-bs-canvas flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full bs-card p-8 text-center">
        <div className="bs-logo-mark w-14 h-14 text-2xl mx-auto mb-5">{BRANDING.productInitial}</div>
        <h1 className="text-xl font-bold text-bs-text mb-2">Estúdio em preparação</h1>
        <p className="text-sm text-bs-muted leading-relaxed mb-6">
          Olá, {user.name}! A área de criação de conteúdo está temporariamente pausada.
          Em breve você poderá gerar copy e imagens por aqui.
        </p>
        <button type="button" onClick={onLogout} className="bs-btn-secondary px-6 py-2.5 text-sm">
          Sair
        </button>
      </div>
    </div>
  );
};

export default StudioStandby;
