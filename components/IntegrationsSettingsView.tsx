import React from 'react';
import { useToast } from '../contexts/ToastContext';
import { useIntegrationEvents, usePlatformKv } from '../hooks/usePlatformData';
import type { BlingConfig, IntegrationConfig } from '../services/mockStore';
import type { SettingsTab } from './SettingsView';
import IntegrationEventLog from './IntegrationEventLog';

const INTEGRATIONS_FALLBACK: IntegrationConfig[] = [];

const BLING_FALLBACK: BlingConfig = {
  connected: false,
  apiKey: '',
  syncProducts: true,
  syncOrders: true,
  notifyNfe: true,
  notifyLowStock: false,
  statusMap: [],
};

const META: Record<string, { name: string; icon: string; desc: string; featured?: boolean }> = {
  woocommerce: {
    name: 'WooCommerce',
    icon: 'fa-brands fa-wordpress',
    desc: 'REST API + webhooks da loja. Usado no Comparador e nas regras Bling × Woo.',
    featured: true,
  },
  bling: {
    name: 'Bling ERP',
    icon: 'fa-boxes-stacked',
    desc: 'Pedidos, NF-e, rastreio, estoque e status operacional.',
    featured: true,
  },
  calendar: { name: 'Google Calendar', icon: 'fa-calendar', desc: 'Sincronize cultos e eventos.' },
  'meta-ads': { name: 'Meta Ads', icon: 'fa-brands fa-meta', desc: 'Leads de Facebook/Instagram.' },
  'google-ads': { name: 'Google Ads', icon: 'fa-brands fa-google', desc: 'Conversões de anúncios.' },
  discord: { name: 'Discord', icon: 'fa-brands fa-discord', desc: 'Relatórios de disparo (servidor real via .env).' },
};

const DETAIL_TABS: Record<string, SettingsTab> = {
  woocommerce: 'woocommerce',
  bling: 'bling',
};

interface IntegrationsSettingsViewProps {
  onTabChange?: (tab: SettingsTab) => void;
}

const IntegrationsSettingsView: React.FC<IntegrationsSettingsViewProps> = ({ onTabChange }) => {
  const { showToast } = useToast();
  const { value: integrations, save: saveIntegrations, loading } = usePlatformKv<IntegrationConfig[]>('integrations', INTEGRATIONS_FALLBACK);
  const { value: blingCfg } = usePlatformKv<BlingConfig>('bling', BLING_FALLBACK);
  const { value: wooCfg } = usePlatformKv<{ connected?: boolean }>('woocommerce', { connected: false });
  const { events } = useIntegrationEvents();

  const visible = integrations.filter((i) => META[i.id]);
  const featured = visible.filter((i) => META[i.id]?.featured);
  const others = visible.filter((i) => !META[i.id]?.featured);

  const toggleIntegration = async (id: string) => {
    const item = integrations.find((i) => i.id === id);
    if (!item) return;
    const wasConnected = item.connected;
    const next = integrations.map((i) =>
      i.id === id ? { ...i, connected: !i.connected, connectedAt: !i.connected ? Date.now() : undefined } : i
    );
    try {
      await saveIntegrations(next);
      if (id === 'discord' && !wasConnected) {
        showToast('Discord real: configurado no .env do servidor.', 'info');
      }
      showToast(wasConnected ? 'Desconectado.' : 'Conectado!', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro', 'error');
    }
  };

  const renderCard = (item: IntegrationConfig, large?: boolean) => {
    const meta = META[item.id] || { name: item.id, icon: 'fa-plug', desc: '' };
    const detailTab = DETAIL_TABS[item.id];
    const isConnected = item.connected
      || (item.id === 'bling' && blingCfg.connected)
      || (item.id === 'woocommerce' && !!wooCfg.connected);

    return (
      <div key={item.id} className={`bs-card p-5 flex flex-col ${large ? 'lg:col-span-1' : ''}`}>
        <div className="flex items-center gap-3 mb-3">
          <div
            className={`rounded-lg bg-bs-elevated border border-bs-border flex items-center justify-center text-bs-accent shrink-0 ${
              large ? 'w-12 h-12 text-lg' : 'w-10 h-10'
            }`}
          >
            <i className={`fa-solid ${meta.icon}`} />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-bs-text">{meta.name}</p>
            {isConnected && <span className="bs-badge-success normal-case text-[9px]">Conectado</span>}
          </div>
        </div>
        <p className="text-sm text-bs-muted flex-1 mb-4">{meta.desc}</p>
        {item.connectedAt && (
          <p className="text-[10px] text-bs-subtle mb-2">Desde {new Date(item.connectedAt).toLocaleDateString('pt-BR')}</p>
        )}
        <div className="flex flex-col gap-2 mt-auto">
          {detailTab && onTabChange && (
            <button type="button" onClick={() => onTabChange(detailTab)} className="bs-btn text-xs py-2">
              Configurar →
            </button>
          )}
          {!detailTab && (
            <button
              type="button"
              onClick={() => toggleIntegration(item.id)}
              className={item.connected ? 'bs-btn-secondary text-xs py-2' : 'bs-btn text-xs py-2'}
            >
              {item.connected ? 'Desconectar' : 'Conectar'}
            </button>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando integrações…</div>;
  }

  return (
    <div className="space-y-6 animate-fadeIn max-w-4xl">
      <div>
        <h2 className="bs-page-title">Integrações</h2>
        <p className="bs-page-desc mt-1">
          ERP, loja WooCommerce e ferramentas conectadas ao WhatsApp. O Comparador do catálogo usa a REST API do Woo.
        </p>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-bs-muted mb-3">E-commerce & ERP</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{featured.map((item) => renderCard(item, true))}</div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-bs-muted mb-3">Outras integrações</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{others.map((item) => renderCard(item))}</div>
      </div>

      <IntegrationEventLog events={events} filter="all" />
    </div>
  );
};

export default IntegrationsSettingsView;
