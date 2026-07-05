
import React, { useState, useEffect } from 'react';
import { View } from '../types';
import type { SettingsTab } from './SettingsView';
import { BRANDING } from '../config/branding';
import StudioCredit from './StudioCredit';

interface SidebarProps {
  currentView: View;
  setView: (v: View) => void;
  onLogout: () => void;
  isOpen?: boolean;
  onClose?: () => void;
  settingsTab?: SettingsTab;
  onSettingsTab?: (tab: SettingsTab) => void;
}

type NavItem = { id: View; label: string; icon: string };
type SettingsNavItem = { id: SettingsTab; label: string; icon: string };

const INICIO: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie' },
];

const ATENDIMENTO: NavItem[] = [
  { id: 'contacts', label: 'Contatos', icon: 'fa-address-book' },
  { id: 'conversations', label: 'Conversas', icon: 'fa-comments' },
  { id: 'crm', label: 'CRM', icon: 'fa-chart-line' },
  { id: 'campaigns', label: 'Campanhas', icon: 'fa-bullhorn' },
];

const FERRAMENTAS: NavItem[] = [
  { id: 'templates', label: 'Templates', icon: 'fa-clone' },
  { id: 'scheduler', label: 'Agendamentos', icon: 'fa-calendar-alt' },
  { id: 'groupdispatch', label: 'Disparo por grupo', icon: 'fa-paper-plane' },
  { id: 'calendar', label: 'Calendário', icon: 'fa-calendar-days' },
  { id: 'groups', label: 'Grupos e Canais', icon: 'fa-users' },
  { id: 'categories', label: 'Categorias', icon: 'fa-folder-tree' },
  { id: 'library', label: 'Biblioteca', icon: 'fa-book-open' },
  { id: 'history', label: 'Histórico', icon: 'fa-history' },
];

const AUTOMACAO: NavItem[] = [
  { id: 'followups', label: 'Follow Ups', icon: 'fa-route' },
  { id: 'aiagents', label: 'Agentes de IA', icon: 'fa-robot' },
  { id: 'flows', label: 'Fluxos', icon: 'fa-diagram-project' },
];

const CONFIG_ITEMS: SettingsNavItem[] = [
  { id: 'connections', label: 'Conexões', icon: 'fa-plug' },
  { id: 'atendimento', label: 'Atendimento IA', icon: 'fa-robot' },
  { id: 'integrations', label: 'Integrações', icon: 'fa-puzzle-piece' },
  { id: 'users', label: 'Usuários', icon: 'fa-user-gear' },
  { id: 'csat', label: 'Pesquisa CSAT', icon: 'fa-star' },
  { id: 'api', label: 'API', icon: 'fa-code' },
  { id: 'widget', label: 'Widget site', icon: 'fa-comment-dots' },
  { id: 'profile', label: 'Perfil', icon: 'fa-user' },
];

const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  setView,
  onLogout,
  isOpen,
  onClose,
  settingsTab = 'connections',
  onSettingsTab,
}) => {
  const isSettingsView = currentView === 'settings' || currentView === 'whatsapp';
  const [configOpen, setConfigOpen] = useState(isSettingsView);

  useEffect(() => {
    if (isSettingsView) setConfigOpen(true);
  }, [isSettingsView]);

  const goSettings = (tab: SettingsTab) => {
    onSettingsTab?.(tab);
    setView('settings');
    onClose?.();
  };

  const renderNavItem = (item: NavItem) => {
    const active = currentView === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => { setView(item.id); onClose?.(); }}
        className={`w-full flex items-center gap-3 pl-5 pr-4 py-2.5 text-sm transition-colors ${
          active ? 'bs-nav-active' : 'bs-nav-item'
        }`}
      >
        <i className={`fa-solid ${item.icon} w-4 text-center text-[14px] ${active ? 'text-bs-accent' : 'text-bs-muted'}`} />
        {item.label}
      </button>
    );
  };

  return (
    <aside className={`fixed md:relative w-64 bg-bs-shell border-r border-bs-border h-full flex flex-col z-30 shadow-card transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
      <div className="h-16 px-4 flex items-center gap-3 border-b border-bs-border shrink-0">
        <div className="bs-logo-mark">{BRANDING.productInitial}</div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-bs-text leading-none truncate">{BRANDING.productName}</p>
          <p className="text-[10px] text-bs-muted mt-0.5">{BRANDING.productTagline}</p>
        </div>
        <button type="button" onClick={onClose} className="md:hidden ml-auto text-bs-muted hover:text-bs-text">
          <i className="fa-solid fa-xmark text-lg" />
        </button>
      </div>

      <nav className="flex-1 py-1 overflow-y-auto custom-scrollbar">
        <p className="bs-nav-section">Início</p>
        {INICIO.map(renderNavItem)}

        <p className="bs-nav-section">Atendimento</p>
        {ATENDIMENTO.map(renderNavItem)}

        <p className="bs-nav-section">Ferramentas</p>
        {FERRAMENTAS.map(renderNavItem)}

        <p className="bs-nav-section">Automação</p>
        {AUTOMACAO.map(renderNavItem)}

        <p className="bs-nav-section">Sistema</p>
        <button
          type="button"
          onClick={() => setConfigOpen((o) => !o)}
          className={`w-full flex items-center gap-3 pl-5 pr-4 py-2.5 text-sm transition-colors ${
            isSettingsView ? 'bs-nav-active' : 'bs-nav-item'
          }`}
        >
          <i className={`fa-solid fa-cog w-4 text-center text-[14px] ${isSettingsView ? 'text-bs-accent' : 'text-bs-muted'}`} />
          <span className="flex-1 text-left">Configurações</span>
          <i className={`fa-solid fa-chevron-down text-[10px] text-bs-subtle transition-transform ${configOpen ? 'rotate-180' : ''}`} />
        </button>

        {configOpen && (
          <div className="pb-1">
            {CONFIG_ITEMS.map((item) => {
              const active = isSettingsView && settingsTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goSettings(item.id)}
                  className={`w-full flex items-center gap-3 pl-10 pr-4 py-2 text-sm transition-colors ${
                    active ? 'text-bs-accent font-semibold bg-bs-hover' : 'text-bs-muted hover:text-bs-text hover:bg-bs-hover'
                  }`}
                >
                  <i className={`fa-solid ${item.icon} w-4 text-center text-xs`} />
                  {item.label}
                </button>
              );
            })}
          </div>
        )}
      </nav>

      <div className="px-3 py-2 border-t border-bs-border shrink-0">
        <StudioCredit variant="sidebar" />
      </div>

      <div className="p-3 border-t border-bs-border shrink-0">
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg text-sm transition-colors"
        >
          <i className="fa-solid fa-right-from-bracket w-4" />
          Sair
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
