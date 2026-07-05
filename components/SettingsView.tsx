import React from 'react';
import { ConnectionStatus, User } from '../types';
import WhatsAppConnection from './WhatsAppConnection';
import UsersView from './UsersView';
import ApiSettingsView from './ApiSettingsView';
import ProfileSettingsView from './ProfileSettingsView';
import IntegrationsSettingsView from './IntegrationsSettingsView';
import CsatSettingsView from './CsatSettingsView';
import WidgetSettingsView from './WidgetSettingsView';
import WooCommerceSettingsView from './WooCommerceSettingsView';
import BlingSettingsView from './BlingSettingsView';
import AttendanceSettingsView from './AttendanceSettingsView';

export type SettingsTab =
  | 'connections'
  | 'users'
  | 'api'
  | 'profile'
  | 'integrations'
  | 'woocommerce'
  | 'bling'
  | 'csat'
  | 'widget'
  | 'atendimento';

interface SettingsViewProps {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  user: User;
  status: ConnectionStatus;
  qrCode: string | null;
  pairingCode?: string | null;
  pairingPhone?: string | null;
  onPairingCodeChange?: (code: string | null) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => Promise<void>;
  syncing: boolean;
}

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'connections', label: 'Conexões', icon: 'fa-plug' },
  { id: 'atendimento', label: 'Atendimento IA', icon: 'fa-robot' },
  { id: 'integrations', label: 'Integrações', icon: 'fa-puzzle-piece' },
  { id: 'users', label: 'Usuários', icon: 'fa-user-gear' },
  { id: 'csat', label: 'Pesquisa CSAT', icon: 'fa-star' },
  { id: 'api', label: 'API', icon: 'fa-code' },
  { id: 'widget', label: 'Widget site', icon: 'fa-comment-dots' },
  { id: 'profile', label: 'Perfil', icon: 'fa-user' },
];

const SettingsView: React.FC<SettingsViewProps> = ({
  tab,
  onTabChange,
  user,
  status,
  qrCode,
  pairingCode,
  pairingPhone,
  onPairingCodeChange,
  onConnect,
  onDisconnect,
  onSync,
  syncing,
}) => {
  return (
    <div className="animate-fadeIn flex flex-col lg:flex-row gap-6 lg:gap-8">
      <aside className="lg:w-52 shrink-0">
        <div className="mb-4 lg:hidden">
          <h2 className="bs-page-title">Configurações</h2>
          <p className="bs-page-desc">Conexões, integrações e API.</p>
        </div>
        <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTabChange(t.id)}
                className={`shrink-0 flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors whitespace-nowrap ${
                  active ? 'bs-settings-tab-active' : 'bs-settings-tab'
                }`}
              >
                <i className={`fa-solid ${t.icon} w-4 text-center text-xs ${active ? 'text-bs-accent' : 'text-bs-muted'}`} />
                {t.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 min-w-0">
        {tab === 'connections' && (
          <WhatsAppConnection
            status={status}
            qrCode={qrCode}
            pairingCode={pairingCode ?? null}
            pairingPhone={pairingPhone ?? null}
            onPairingCodeChange={onPairingCodeChange}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onSync={onSync}
            syncing={syncing}
            embedded
          />
        )}
        {tab === 'integrations' && <IntegrationsSettingsView onTabChange={onTabChange} />}
        {tab === 'atendimento' && <AttendanceSettingsView />}
        {tab === 'woocommerce' && <WooCommerceSettingsView onBack={() => onTabChange('integrations')} />}
        {tab === 'bling' && <BlingSettingsView onBack={() => onTabChange('integrations')} />}
        {tab === 'users' && <UsersView embedded />}
        {tab === 'csat' && <CsatSettingsView />}
        {tab === 'api' && <ApiSettingsView />}
        {tab === 'widget' && <WidgetSettingsView />}
        {tab === 'profile' && <ProfileSettingsView user={user} />}
      </div>
    </div>
  );
};

export default SettingsView;
