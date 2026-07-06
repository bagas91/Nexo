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

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'connections', label: 'Conexões' },
  { id: 'atendimento', label: 'Atendimento IA' },
  { id: 'integrations', label: 'Integrações' },
  { id: 'users', label: 'Usuários' },
  { id: 'csat', label: 'Pesquisa CSAT' },
  { id: 'api', label: 'API' },
  { id: 'widget', label: 'Widget site' },
  { id: 'profile', label: 'Perfil' },
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
  const currentLabel = TABS.find((t) => t.id === tab)?.label
    || (tab === 'woocommerce' ? 'WooCommerce' : tab === 'bling' ? 'Bling ERP' : 'Configurações');

  return (
    <div className="animate-fadeIn max-w-5xl">
      <div className="mb-6 lg:hidden">
        <h2 className="bs-page-title">Configurações</h2>
        <label className="text-xs text-bs-muted mt-3 mb-1 block">Seção</label>
        <select
          className="bs-input text-sm"
          value={tab === 'woocommerce' || tab === 'bling' ? 'integrations' : tab}
          onChange={(e) => onTabChange(e.target.value as SettingsTab)}
        >
          {TABS.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        {(tab === 'woocommerce' || tab === 'bling') && (
          <p className="text-xs text-bs-muted mt-2">Agora: <span className="text-bs-text font-medium">{currentLabel}</span></p>
        )}
      </div>

      <div className="min-w-0">
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
