import React from 'react';
import { BRANDING } from '../config/branding';

export type StudioTab = 'assistant' | 'templates' | 'image' | 'mine';

interface StudioSidebarProps {
  currentTab: StudioTab;
  setTab: (t: StudioTab) => void;
  onLogout: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

const StudioSidebar: React.FC<StudioSidebarProps> = ({ currentTab, setTab, onLogout, isOpen, onClose }) => {
  const items: { id: StudioTab; label: string; icon: string }[] = [
    { id: 'assistant', label: 'Assistente IA', icon: 'fa-wand-magic-sparkles' },
    { id: 'templates', label: 'Templates', icon: 'fa-layer-group' },
    { id: 'image', label: 'Criar imagem', icon: 'fa-image' },
    { id: 'mine', label: 'Minhas criações', icon: 'fa-folder-open' },
  ];

  return (
    <aside
      className={`fixed md:relative w-72 md:w-64 bg-bs-shell border-r border-bs-border h-full flex flex-col z-30 transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}
    >
      <div className="p-6 border-b border-bs-border flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-bs-accent/15 border border-bs-accent/30 rounded-lg flex items-center justify-center text-bs-accent shrink-0">
            <i className="fa-solid fa-gem text-xl"></i>
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-sm text-bs-text leading-tight truncate">
              {BRANDING.storeName}
            </h1>
            <p className="text-[11px] text-bs-accent font-semibold uppercase tracking-wide">Estúdio Semijoias</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="md:hidden text-bs-muted hover:text-bs-accent">
          <i className="fa-solid fa-xmark text-xl"></i>
        </button>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
              currentTab === item.id ? 'bs-nav-active' : 'bs-nav-item'
            }`}
          >
            <i className={`fa-solid ${item.icon} w-5`}></i>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-bs-border space-y-2">
        <a
          href={BRANDING.storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 text-xs text-bs-muted hover:text-bs-accent transition-colors"
        >
          <i className="fa-solid fa-store"></i>
          {BRANDING.storeUrl.replace(/^https?:\/\//, '')}
        </a>
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-500 rounded-xl transition-colors"
        >
          <i className="fa-solid fa-right-from-bracket w-5"></i>
          Sair
        </button>
      </div>
    </aside>
  );
};

export default StudioSidebar;
