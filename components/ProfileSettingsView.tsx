import React from 'react';
import { User } from '../types';
import ThemeToggle from './ThemeToggle';
import StudioCredit from './StudioCredit';
import { BRANDING } from '../config/branding';
import { mockStore } from '../services/mockStore';
import { useToast } from '../contexts/ToastContext';
import MockBanner from './MockBanner';

interface ProfileSettingsViewProps {
  user: User;
}

const ProfileSettingsView: React.FC<ProfileSettingsViewProps> = ({ user }) => {
  const { showToast } = useToast();

  return (
    <div className="space-y-6 animate-fadeIn max-w-2xl">
      <MockBanner />
      <div>
        <h2 className="bs-page-title">Perfil</h2>
        <p className="bs-page-desc mt-1">Suas informações de acesso ao {BRANDING.productName}.</p>
      </div>

      <div className="bs-section space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-bs-muted mb-1">Nome</label>
            <input type="text" readOnly defaultValue={user.name} className="bs-input opacity-80" />
          </div>
          <div>
            <label className="block text-sm font-medium text-bs-muted mb-1">Login</label>
            <input type="text" readOnly defaultValue={user.email} className="bs-input opacity-80" />
          </div>
          <div>
            <label className="block text-sm font-medium text-bs-muted mb-1">Perfil</label>
            <input type="text" readOnly defaultValue={user.role === 'superadmin' ? 'Superadmin' : 'Usuário'} className="bs-input opacity-80" />
          </div>
        </div>
      </div>

      <div className="bs-section">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="bs-section-title">Aparência</h3>
            <p className="text-sm text-bs-muted">Alterne entre tema claro (Bling) e escuro (Sendora).</p>
          </div>
          <ThemeToggle showLabel />
        </div>
      </div>

      <div className="bs-section">
        <h3 className="bs-section-title mb-3">Sobre o sistema</h3>
        <StudioCredit variant="settings" />
      </div>

      <div className="bs-section border border-dashed">
        <h3 className="bs-section-title">Dados mock</h3>
        <p className="text-sm text-bs-muted mb-3">Limpa Follow Ups, agentes, fluxos, tokens e widgets salvos no navegador.</p>
        <button
          type="button"
          onClick={() => {
            if (confirm('Resetar todos os dados mock deste navegador?')) {
              mockStore.resetDemo();
              showToast('Dados mock resetados.', 'success');
            }
          }}
          className="bs-btn-danger text-xs py-2 px-4"
        >
          Resetar demo mock
        </button>
      </div>
    </div>
  );
};

export default ProfileSettingsView;
