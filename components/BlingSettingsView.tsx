import React, { useEffect, useState } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useIntegrationEvents, usePlatformKv } from '../hooks/usePlatformData';
import platformService from '../services/platformService';
import type { BlingConfig, IntegrationConfig } from '../services/mockStore';
import Toggle from './Toggle';
import IntegrationEventLog from './IntegrationEventLog';
import { BRANDING } from '../config/branding';

const BLING_FALLBACK: BlingConfig = {
  connected: false,
  apiKey: '',
  syncProducts: true,
  syncOrders: true,
  notifyNfe: true,
  notifyLowStock: false,
  statusMap: [],
};

interface BlingSettingsViewProps {
  onBack?: () => void;
}

const BlingSettingsView: React.FC<BlingSettingsViewProps> = ({ onBack }) => {
  const { showToast } = useToast();
  const { value: cfg, loading } = usePlatformKv<BlingConfig>('bling', BLING_FALLBACK);
  const { value: integrations, save: saveIntegrations } = usePlatformKv<IntegrationConfig[]>('integrations', []);
  const { events, refresh: refreshEvents } = useIntegrationEvents('bling');
  const [localCfg, setLocalCfg] = useState(cfg);
  const [webhookUrl, setWebhookUrl] = useState('');

  useEffect(() => setLocalCfg(cfg), [cfg]);

  useEffect(() => {
    platformService.getWebhookToken().then((token) => {
      setWebhookUrl(platformService.webhookUrl('bling', token));
    }).catch(() => {});
  }, []);

  const persist = async (next: BlingConfig) => {
    setLocalCfg(next);
    try {
      await platformService.setKv('bling', next);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao salvar', 'error');
    }
  };

  const save = async () => {
    await persist(localCfg);
    showToast('Configuração Bling salva.', 'success');
  };

  const connectDemo = async () => {
    const next: BlingConfig = {
      ...localCfg,
      connected: true,
      apiKey: 'bling_••••••••demo',
      connectedAt: Date.now(),
    };
    await persist(next);
    if (integrations.length) {
      await saveIntegrations(integrations.map((i) =>
        i.id === 'bling' ? { ...i, connected: true, connectedAt: Date.now() } : i
      ));
    }
    showToast('Bling ERP conectado em modo demo!', 'success');
  };

  const simulateStatus = async (blingStatus: string) => {
    try {
      await platformService.simulateIntegrationEvent('bling', `pedido.${blingStatus.toLowerCase().replace(/\s/g, '_')}`, {
        numero: '7821',
        situacao: blingStatus,
        contato: { nome: 'Cliente Bling Demo', telefone: '5562988885555' },
      });
      await refreshEvents();
      showToast(`Evento Bling "${blingStatus}" simulado.`, 'info');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao simular', 'error');
    }
  };

  const syncNow = async () => {
    try {
      await platformService.simulateIntegrationEvent('bling', 'sync.produtos', {
        summary: 'Sync manual — 142 produtos',
      });
      await refreshEvents();
      showToast('Sincronização simulada com sucesso.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro', 'error');
    }
  };

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando Bling…</div>;
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
          <div className="w-12 h-12 rounded-xl bg-green-600/15 border border-green-600/30 flex items-center justify-center text-green-600 font-bold text-sm">bling</div>
          <div>
            <h2 className="bs-page-title">Bling ERP</h2>
            <p className="bs-page-desc mt-0.5">Pedidos, NF-e, estoque e rastreio → WhatsApp.</p>
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
          <h3 className="bs-section-title">API Bling v3</h3>
          <div>
            <label className="text-xs text-bs-muted mb-1 block">API Key</label>
            <input className="bs-input font-mono text-sm" placeholder="Sua chave API do Bling" value={localCfg.apiKey} onChange={(e) => setLocalCfg({ ...localCfg, apiKey: e.target.value })} />
          </div>
          <p className="text-xs text-bs-muted">
            Obtenha em <span className="text-bs-accent">bling.com.br → Configurações → API</span>
          </p>
          {webhookUrl && (
            <div>
              <label className="text-xs text-bs-muted mb-1 block">Webhook URL</label>
              <pre className="bg-bs-elevated border border-bs-border rounded-lg px-3 py-2 text-[10px] font-mono text-bs-text overflow-x-auto">{webhookUrl}</pre>
            </div>
          )}
          <button type="button" onClick={save} className="bs-btn text-sm">Salvar</button>
        </div>

        <div className="bs-section space-y-3">
          <h3 className="bs-section-title">Sincronização</h3>
          {([
            { key: 'syncProducts' as const, label: 'Sincronizar produtos', desc: 'Catálogo para Agente IA' },
            { key: 'syncOrders' as const, label: 'Sincronizar pedidos', desc: 'Status em tempo real' },
            { key: 'notifyNfe' as const, label: 'Avisar NF-e autorizada', desc: 'WhatsApp ao emitir nota' },
            { key: 'notifyLowStock' as const, label: 'Alerta estoque baixo', desc: 'Grupo ADM interno' },
          ]).map((opt) => (
            <div key={opt.key} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-bs-text">{opt.label}</p>
                <p className="text-xs text-bs-muted">{opt.desc}</p>
              </div>
              <Toggle
                on={localCfg[opt.key]}
                onChange={(v) => {
                  const next = { ...localCfg, [opt.key]: v };
                  setLocalCfg(next);
                  persist(next);
                }}
              />
            </div>
          ))}
          <button type="button" onClick={syncNow} className="bs-btn-secondary text-xs py-2 w-full mt-2">
            <i className="fa-solid fa-arrows-rotate mr-1" />Sincronizar agora (demo)
          </button>
        </div>
      </div>

      <div className="bs-table-wrap">
        <div className="bs-table-toolbar">
          <span className="text-sm font-semibold text-bs-text">Status Bling → Mensagem WhatsApp</span>
        </div>
        <table className="bs-table">
          <thead className="bs-table-head">
            <tr>
              <th>Status no Bling</th>
              <th>Mensagem</th>
              <th>Ativo</th>
              <th className="text-right">Testar</th>
            </tr>
          </thead>
          <tbody>
            {localCfg.statusMap.map((row, idx) => (
              <tr key={row.blingStatus} className="bs-table-row">
                <td className="font-medium text-sm text-bs-text whitespace-nowrap">{row.blingStatus}</td>
                <td>
                  <input
                    className="bs-input py-1 text-xs w-full"
                    value={row.message}
                    onChange={(e) => {
                      const statusMap = [...localCfg.statusMap];
                      statusMap[idx] = { ...row, message: e.target.value };
                      const next = { ...localCfg, statusMap };
                      setLocalCfg(next);
                      persist(next);
                    }}
                  />
                </td>
                <td>
                  <Toggle
                    on={row.active}
                    onChange={(v) => {
                      const statusMap = [...localCfg.statusMap];
                      statusMap[idx] = { ...row, active: v };
                      const next = { ...localCfg, statusMap };
                      setLocalCfg(next);
                      persist(next);
                    }}
                  />
                </td>
                <td className="text-right">
                  <button type="button" onClick={() => simulateStatus(row.blingStatus)} className="bs-link-accent text-xs">
                    Simular
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bs-card p-4 border-dashed">
        <p className="text-sm font-semibold text-bs-text mb-1">Fluxo recomendado {BRANDING.productName}</p>
        <p className="text-xs text-bs-muted leading-relaxed">
          <strong>WooCommerce</strong> confirma pedido no site → <strong>Bling</strong> assume logística (NF, rastreio, entrega).
          Evita mensagens duplicadas: Woo para marketing inicial, Bling para operação.
        </p>
      </div>

      <IntegrationEventLog events={events} filter="bling" />
    </div>
  );
};

export default BlingSettingsView;
