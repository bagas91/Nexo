import React, { useMemo } from 'react';
import { ConnectionStatus, User } from '../types';
import WhatsAppConnection from './WhatsAppConnection';
import UsersView from './UsersView';
import ApiSettingsView from './ApiSettingsView';
import ProfileSettingsView from './ProfileSettingsView';
import IntegrationsSettingsView from './IntegrationsSettingsView';
import CsatSettingsView from './CsatSettingsView';
import WidgetSettingsView from './WidgetSettingsView';
import BlingSettingsView from './BlingSettingsView';
import WooCommerceSettingsView from './WooCommerceSettingsView';
import AttendanceSettingsView from './AttendanceSettingsView';
import { SETTINGS_TAB_TO_MODULE, userHasModule } from '../config/modules';

export type SettingsTab =
  | 'connections'
  | 'users'
  | 'api'
  | 'profile'
  | 'integrations'
  | 'bling'
  | 'woocommerce'
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
  { id: 'api', label: 'API' },
  { id: 'profile', label: 'Perfil' },
];

function canTab(user: User, tab: SettingsTab) {
  if (user.role === 'superadmin') return true;
  if (tab === 'bling' || tab === 'woocommerce') return false;
  const mod = SETTINGS_TAB_TO_MODULE[tab];
  if (mod === null || mod === undefined) return false;
  return userHasModule(user, mod);
}

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
  const visibleTabs = useMemo(() => TABS.filter((t) => canTab(user, t.id)), [user]);
  const detailLabel = tab === 'bling' ? 'Bling ERP' : tab === 'woocommerce' ? 'WooCommerce' : null;
  const currentLabel = visibleTabs.find((t) => t.id === tab)?.label
    || detailLabel
    || 'Configurações';
  const selectValue = (tab === 'bling' || tab === 'woocommerce') ? 'integrations' : tab;

  if (!canTab(user, (tab === 'bling' || tab === 'woocommerce') ? 'integrations' : tab)
    && tab !== 'bling'
    && tab !== 'woocommerce') {
    return (
      <div className="bs-card p-6 text-sm text-bs-muted">
        Sem permissão para esta configuração.
      </div>
    );
  }

  return (
    <div className="animate-fadeIn max-w-5xl">
      <div className="mb-6 lg:hidden">
        <h2 className="bs-page-title">Configurações</h2>
        <label className="text-xs text-bs-muted mt-3 mb-1 block">Seção</label>
        <select
          className="bs-input text-sm"
          value={selectValue}
          onChange={(e) => onTabChange(e.target.value as SettingsTab)}
        >
          {visibleTabs.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        {detailLabel && (
          <p className="text-xs text-bs-muted mt-2">Agora: <span className="text-bs-text font-medium">{currentLabel}</span></p>
        )}
      </div>

      <div className="min-w-0">
        {tab === 'connections' && canTab(user, 'connections') && (
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
        {tab === 'integrations' && canTab(user, 'integrations') && (
          <IntegrationsSettingsView onTabChange={onTabChange} />
        )}
        {tab === 'atendimento' && <AttendanceSettingsView />}
        {tab === 'bling' && user.role === 'superadmin' && (
          <BlingSettingsView onBack={() => onTabChange('integrations')} />
        )}
        {tab === 'woocommerce' && user.role === 'superadmin' && (
          <WooCommerceSettingsView onBack={() => onTabChange('integrations')} />
        )}
        {tab === 'users' && canTab(user, 'users') && <UsersView embedded />}
        {tab === 'csat' && <CsatSettingsView />}
        {tab === 'api' && canTab(user, 'api') && <ApiSettingsView />}
        {tab === 'widget' && <WidgetSettingsView />}
        {tab === 'profile' && <ProfileSettingsView user={user} />}
      </div>
    </div>
  );
};

export default SettingsView;
