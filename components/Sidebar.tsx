
import React, { useState, useEffect, useMemo } from 'react';
import { User, View } from '../types';
import type { SettingsTab } from './SettingsView';
import { BRANDING } from '../config/branding';
import StudioCredit from './StudioCredit';
import { canAccessView, SETTINGS_TAB_TO_MODULE, userHasModule } from '../config/modules';
import { useInboxNeedsHumanCount } from '../hooks/useInboxNeedsHumanCount';

interface SidebarProps {
  currentView: View;
  setView: (v: View) => void;
  onLogout: () => void;
  isOpen?: boolean;
  onClose?: () => void;
  settingsTab?: SettingsTab;
  onSettingsTab?: (tab: SettingsTab) => void;
  user: User;
}

type NavItem = { id: View; label: string; icon: string };
type SettingsNavItem = { id: SettingsTab; label: string; icon: string };

const INICIO: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie' },
];

const ATENDIMENTO: NavItem[] = [
  { id: 'contacts', label: 'Contatos', icon: 'fa-address-book' },
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

const LOJA: NavItem[] = [
  { id: 'catalog', label: 'Qualidade do Catálogo', icon: 'fa-clipboard-list' },
];

const ADMIN_NAV: NavItem[] = [
  { id: 'admin', label: 'Controle Admin', icon: 'fa-shield-halved' },
];

const CONFIG_ITEMS: SettingsNavItem[] = [
  { id: 'connections', label: 'Conexões', icon: 'fa-plug' },
  { id: 'atendimento', label: 'Atendimento IA', icon: 'fa-robot' },
  { id: 'integrations', label: 'Integrações', icon: 'fa-puzzle-piece' },
  { id: 'users', label: 'Usuários', icon: 'fa-user-gear' },
  { id: 'api', label: 'API', icon: 'fa-code' },
  { id: 'profile', label: 'Perfil', icon: 'fa-user' },
];

function filterNav(items: NavItem[], user: User) {
  return items.filter((item) => canAccessView(user, item.id));
}

function canSettingsTab(user: User, tab: SettingsTab) {
  if (user.role === 'superadmin') return true;
  const mod = SETTINGS_TAB_TO_MODULE[tab];
  if (mod === null || mod === undefined) return false;
  return userHasModule(user, mod);
}

const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  setView,
  onLogout,
  isOpen,
  onClose,
  settingsTab = 'connections',
  onSettingsTab,
  user,
}) => {
  const isSettingsView = currentView === 'settings' || currentView === 'whatsapp';
  const [configOpen, setConfigOpen] = useState(isSettingsView);

  const inicio = useMemo(() => filterNav(INICIO, user), [user]);
  const atendimento = useMemo(() => filterNav(ATENDIMENTO, user), [user]);
  const ferramentas = useMemo(() => filterNav(FERRAMENTAS, user), [user]);
  const automacao = useMemo(() => filterNav(AUTOMACAO, user), [user]);
  const loja = useMemo(
    () => filterNav(LOJA, user).map((item) => {
      if (item.id !== 'catalog' || user.role === 'superadmin') return item;
      const hasQuality = userHasModule(user, 'catalog_quality');
      const hasGoiania = userHasModule(user, 'catalog');
      if (hasQuality) return { ...item, label: 'Qualidade do Catálogo' };
      if (hasGoiania) return { ...item, label: 'Fila Goiânia' };
      return item;
    }),
    [user],
  );
  const adminNav = useMemo(
    () => (user.role === 'superadmin' ? ADMIN_NAV : []),
    [user],
  );
  const configItems = useMemo(
    () => CONFIG_ITEMS.filter((item) => canSettingsTab(user, item.id)),
    [user],
  );

  useEffect(() => {
    if (isSettingsView) setConfigOpen(true);
  }, [isSettingsView]);

  const canCrmInbox = canAccessView(user, 'crm') || canAccessView(user, 'conversations');
  const { count: needsHumanCount } = useInboxNeedsHumanCount(canCrmInbox);

  const goSettings = (tab: SettingsTab) => {
    if (!canSettingsTab(user, tab)) return;
    onSettingsTab?.(tab);
    setView('settings');
    onClose?.();
  };

  const renderNavItem = (item: NavItem) => {
    const showActive = currentView === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => { setView(item.id); onClose?.(); }}
        className={`w-full flex items-center gap-3 pl-5 pr-4 py-2.5 text-sm transition-colors ${
          showActive ? 'bs-nav-active' : 'bs-nav-item'
        }`}
      >
        <i className={`fa-solid ${item.icon} w-4 text-center text-[14px] ${showActive ? 'text-bs-accent' : 'text-bs-muted'}`} />
        <span className="flex-1 text-left">{item.label}</span>
        {item.id === 'crm' && needsHumanCount > 0 && (
          <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
            {needsHumanCount > 99 ? '99+' : needsHumanCount}
          </span>
        )}
      </button>
    );
  };

  const renderSection = (label: string, items: NavItem[]) => {
    if (!items.length) return null;
    return (
      <>
        <p className="bs-nav-section">{label}</p>
        {items.map(renderNavItem)}
      </>
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
        {renderSection('Início', inicio)}
        {renderSection('Atendimento', atendimento)}
        {renderSection('Ferramentas', ferramentas)}
        {renderSection('Automação', automacao)}
        {renderSection('Loja', loja)}
        {renderSection('Admin', adminNav)}

        {configItems.length > 0 && (
          <>
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
                {configItems.map((item) => {
                  const active = isSettingsView && (
                    settingsTab === item.id
                    || (item.id === 'integrations' && settingsTab === 'bling')
                  );
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
          </>
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
