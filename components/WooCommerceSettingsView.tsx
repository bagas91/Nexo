import React, { useEffect, useState } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useIntegrationEvents, usePlatformKv } from '../hooks/usePlatformData';
import platformService from '../services/platformService';
import type { IntegrationConfig, WooCommerceConfig } from '../services/mockStore';
import Toggle from './Toggle';
import IntegrationEventLog from './IntegrationEventLog';
import { BRANDING } from '../config/branding';

const WOO_EVENTS: { key: string; label: string; desc: string }[] = [
  { key: 'order.created', label: 'Pedido criado', desc: 'Cliente finalizou checkout' },
  { key: 'order.processing', label: 'Pagamento aprovado', desc: 'Pedido em processamento' },
  { key: 'order.completed', label: 'Pedido concluído', desc: 'Entrega confirmada' },
  { key: 'order.shipped', label: 'Pedido enviado', desc: 'Com código de rastreio' },
  { key: 'cart.abandoned', label: 'Carrinho abandonado', desc: 'Recuperação de venda' },
];

const AUTO_TEMPLATES = [
  { name: 'Pós-compra padrão', flow: 'Pedido criado → WhatsApp confirmação', icon: 'fa-bag-shopping' },
  { name: 'Carrinho abandonado', flow: '1h + 24h follow-up', icon: 'fa-cart-shopping' },
  { name: 'Pedido enviado', flow: 'Rastreio automático', icon: 'fa-truck' },
  { name: 'CSAT pós-entrega', flow: 'Avaliação 1–5 após concluído', icon: 'fa-star' },
];

const WOO_FALLBACK: WooCommerceConfig = {
  connected: false,
  storeUrl: BRANDING.storeUrl,
  consumerKey: '',
  consumerSecret: '',
  events: {},
};

interface WooCommerceSettingsViewProps {
  onBack?: () => void;
}

const WooCommerceSettingsView: React.FC<WooCommerceSettingsViewProps> = ({ onBack }) => {
  const { showToast } = useToast();
  const { value: cfg, setValue: setCfg, save, loading } = usePlatformKv<WooCommerceConfig>('woocommerce', WOO_FALLBACK);
  const { value: integrations, save: saveIntegrations } = usePlatformKv<IntegrationConfig[]>('integrations', []);
  const { events, refresh: refreshEvents } = useIntegrationEvents('woocommerce');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [localCfg, setLocalCfg] = useState(cfg);

  useEffect(() => {
    setLocalCfg(cfg);
  }, [cfg]);

  useEffect(() => {
    platformService.getWebhookToken().then((token) => {
      setWebhookUrl(platformService.webhookUrl('woocommerce', token));
    }).catch(() => {});
  }, []);

  const persist = async (next: WooCommerceConfig) => {
    setLocalCfg(next);
    try {
      await save(next);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao salvar', 'error');
    }
  };

  const saveCredentials = async () => {
    try {
      await persist(localCfg);
      showToast('Configuração WooCommerce salva.', 'success');
    } catch {
      /* persist handles toast */
    }
  };

  const connectDemo = async () => {
    const next: WooCommerceConfig = {
      ...localCfg,
      connected: true,
      consumerKey: 'ck_demo_••••••••',
      consumerSecret: 'cs_demo_••••••••',
      connectedAt: Date.now(),
    };
    await persist(next);
    if (integrations.length) {
      await saveIntegrations(integrations.map((i) =>
        i.id === 'woocommerce' ? { ...i, connected: true, connectedAt: Date.now() } : i
      ));
    }
    showToast('WooCommerce conectado em modo demo!', 'success');
  };

  const simulate = async (eventType: string) => {
    const payloads: Record<string, Record<string, unknown>> = {
      'order.created': { id: 5902, billing: { first_name: 'Cliente', phone: '5562999990000' }, total: '189' },
      'order.processing': { id: 5902, billing: { first_name: 'Cliente', phone: '5562999990000' } },
      'cart.abandoned': { billing: { first_name: 'Visitante', phone: '5511988881111' } },
    };
    try {
      await platformService.simulateIntegrationEvent('woocommerce', eventType, payloads[eventType] || payloads['order.created']);
      await refreshEvents();
      showToast('Evento simulado — veja no log abaixo.', 'info');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao simular', 'error');
    }
  };

  const copyWebhook = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    showToast('URL do webhook copiada!', 'success');
  };

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando WooCommerce…</div>;
  }

  return (
    <div className="space-y-6 animate-fadeIn max-w-4xl">
      {onBack && (
        <button type="button" onClick={onBack} className="bs-link-accent text-sm flex items-center gap-1.5">
          <i className="fa-solid fa-arrow-left text-xs" />
          Voltar para Integrações
        </button>
      )}

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#7f54b3]/15 border border-[#7f54b3]/30 flex items-center justify-center text-[#7f54b3] text-xl font-bold">W</div>
          <div>
            <h2 className="bs-page-title">WooCommerce</h2>
            <p className="bs-page-desc mt-0.5">Loja {BRANDING.storeUrl.replace(/^https?:\/\//, '')} — webhooks e pós-venda no WhatsApp.</p>
          </div>
        </div>
        {localCfg.connected ? (
          <span className="bs-badge-success normal-case shrink-0">Conectado</span>
        ) : (
          <button type="button" onClick={connectDemo} className="bs-btn text-sm px-4 py-2 shrink-0">
            Conectar (demo)
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bs-section space-y-4">
          <h3 className="bs-section-title">Conexão da loja</h3>
          <div>
            <label className="text-xs text-bs-muted mb-1 block">URL da loja</label>
            <input className="bs-input" value={localCfg.storeUrl} onChange={(e) => setLocalCfg({ ...localCfg, storeUrl: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-bs-muted mb-1 block">Consumer Key</label>
            <input className="bs-input font-mono text-sm" placeholder="ck_..." value={localCfg.consumerKey} onChange={(e) => setLocalCfg({ ...localCfg, consumerKey: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-bs-muted mb-1 block">Consumer Secret</label>
            <input type="password" className="bs-input font-mono text-sm" placeholder="cs_..." value={localCfg.consumerSecret} onChange={(e) => setLocalCfg({ ...localCfg, consumerSecret: e.target.value })} />
          </div>
          <button type="button" onClick={saveCredentials} className="bs-btn text-sm">Salvar credenciais</button>
        </div>

        <div className="bs-section space-y-3">
          <h3 className="bs-section-title">Webhook</h3>
          <p className="text-xs text-bs-muted">Cole em WooCommerce → Configurações → Avançado → Webhooks</p>
          <div className="relative">
            <pre className="bg-bs-elevated border border-bs-border rounded-lg px-3 py-2 text-[11px] font-mono text-bs-text overflow-x-auto pr-10">{webhookUrl || 'Carregando token…'}</pre>
            <button type="button" onClick={copyWebhook} className="absolute top-2 right-2 w-7 h-7 rounded border border-bs-border bg-bs-shell hover:bg-bs-hover text-bs-muted text-xs">
              <i className="fa-regular fa-copy" />
            </button>
          </div>
          <p className="text-[10px] text-bs-subtle">Token incluído na URL · Eventos registrados no log abaixo</p>
        </div>
      </div>

      <div className="bs-section">
        <h3 className="bs-section-title mb-4">Eventos → WhatsApp</h3>
        <div className="space-y-3">
          {WOO_EVENTS.map((ev) => (
            <div key={ev.key} className="flex items-center justify-between gap-4 py-2 border-b border-bs-border last:border-0">
              <div className="min-w-0">
                <p className="text-sm font-medium text-bs-text">{ev.label}</p>
                <p className="text-xs text-bs-muted">{ev.desc}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => simulate(ev.key)} className="bs-link-accent text-[10px] hidden sm:inline">Simular</button>
                <Toggle
                  on={localCfg.events[ev.key] ?? false}
                  onChange={(v) => {
                    const next = { ...localCfg, events: { ...localCfg.events, [ev.key]: v } };
                    setLocalCfg(next);
                    persist(next);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-bs-text mb-3">Automações prontas (e-commerce)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {AUTO_TEMPLATES.map((t) => (
            <div key={t.name} className="bs-card p-4 flex gap-3">
              <i className={`fa-solid ${t.icon} text-bs-accent mt-0.5`} />
              <div>
                <p className="font-semibold text-sm text-bs-text">{t.name}</p>
                <p className="text-xs text-bs-muted">{t.flow}</p>
                <button type="button" onClick={() => showToast(`Automação "${t.name}" — ative em Fluxos.`, 'info')} className="bs-link-accent text-[10px] mt-2">
                  Ativar →
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <IntegrationEventLog events={events} filter="woocommerce" />
    </div>
  );
};

export default WooCommerceSettingsView;
