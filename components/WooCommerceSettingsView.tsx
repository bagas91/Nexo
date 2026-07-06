import React, { useEffect, useState } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useIntegrationEvents, usePlatformKv } from '../hooks/usePlatformData';
import platformService from '../services/platformService';
import type { IntegrationConfig, WooCommerceConfig } from '../services/mockStore';
import Toggle from './Toggle';
import IntegrationEventLog from './IntegrationEventLog';
import { BRANDING } from '../config/branding';

const INTEGRATIONS_FALLBACK: IntegrationConfig[] = [];

const WOO_EVENTS: { key: string; label: string; desc: string }[] = [
  { key: 'order.created', label: 'Pedido criado', desc: 'Cliente finalizou checkout' },
  { key: 'order.processing', label: 'Pagamento aprovado', desc: 'Pedido em processamento' },
  { key: 'order.completed', label: 'Pedido concluído', desc: 'Entrega confirmada' },
  { key: 'order.shipped', label: 'Pedido enviado', desc: 'Com código de rastreio' },
  { key: 'cart.abandoned', label: 'Carrinho abandonado', desc: 'Recuperação de venda (plugin)' },
];

const SETUP_STEPS = [
  'WooCommerce → Configurações → Avançado → REST API → Adicionar chave (Leitura/Gravação).',
  'Cole URL da loja, Consumer Key e Consumer Secret abaixo → Salvar e conectar.',
  'WooCommerce → Configurações → Avançado → Webhooks → cadastre a URL do Nexo.',
  'Tópicos recomendados: Pedido criado, Pedido atualizado (para processing/completed).',
  'Ative os eventos desejados e teste com Simular (coloque seu WhatsApp).',
];

const WOO_FALLBACK: WooCommerceConfig = {
  connected: false,
  storeUrl: BRANDING.storeUrl,
  consumerKey: '',
  consumerSecret: '',
  syncOrders: true,
  events: {},
  eventMessages: {},
};

interface WooCommerceSettingsViewProps {
  onBack?: () => void;
}

const WooCommerceSettingsView: React.FC<WooCommerceSettingsViewProps> = ({ onBack }) => {
  const { showToast } = useToast();
  const { value: cfg, loading, refresh } = usePlatformKv<WooCommerceConfig>('woocommerce', WOO_FALLBACK);
  const { value: integrations, save: saveIntegrations } = usePlatformKv<IntegrationConfig[]>('integrations', INTEGRATIONS_FALLBACK);
  const { events, refresh: refreshEvents } = useIntegrationEvents('woocommerce');
  const [localCfg, setLocalCfg] = useState(cfg);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [storeUrl, setStoreUrl] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [simulateFeedback, setSimulateFeedback] = useState<string | null>(null);

  useEffect(() => setLocalCfg(cfg), [cfg]);
  useEffect(() => {
    if (cfg.storeUrl) setStoreUrl(cfg.storeUrl);
    if (cfg.consumerKey && !cfg.consumerKey.includes('•••')) setConsumerKey(cfg.consumerKey);
    if (cfg.consumerSecret && !cfg.consumerSecret.includes('•••')) setConsumerSecret(cfg.consumerSecret);
  }, [cfg]);

  useEffect(() => {
    platformService.getWebhookToken().then((token) => {
      setWebhookUrl(platformService.webhookUrl('woocommerce', token));
    }).catch(() => {});
  }, []);

  const persist = async (next: WooCommerceConfig) => {
    setLocalCfg(next);
    try {
      await platformService.setKv('woocommerce', next);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao salvar', 'error');
    }
  };

  const saveAndConnect = async () => {
    if (!storeUrl.trim() || !consumerKey.trim() || !consumerSecret.trim()) {
      showToast('Preencha URL, Consumer Key e Consumer Secret.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await platformService.saveWooCredentials(storeUrl.trim(), consumerKey.trim(), consumerSecret.trim());
      await refresh();
      if (integrations.length) {
        await saveIntegrations(integrations.map((i) =>
          i.id === 'woocommerce' ? { ...i, connected: true, connectedAt: Date.now() } : i
        ));
      }
      setTestFeedback({ ok: true, message: res.message || 'WooCommerce conectado!' });
      showToast(res.message || 'WooCommerce conectado!', 'success');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erro ao conectar';
      setTestFeedback({ ok: false, message });
      showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestFeedback(null);
    try {
      const res = await platformService.testWooConnection({
        storeUrl: storeUrl.trim() || localCfg.storeUrl,
        consumerKey: consumerKey.trim() || undefined,
        consumerSecret: consumerSecret.trim() || undefined,
      });
      setTestFeedback({ ok: true, message: res.message });
      showToast(res.message, 'success');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha na conexão';
      setTestFeedback({ ok: false, message });
      showToast(message, 'error');
    } finally {
      setTesting(false);
    }
  };

  const simulate = async (eventType: string) => {
    const phone = testPhone.replace(/\D/g, '') || '5562988885555';
    const nome = 'Cliente Teste';
    setSimulateFeedback(null);
    const payloads: Record<string, Record<string, unknown>> = {
      'order.created': { id: 5902, number: '5902', status: 'pending', total: '189.90', billing: { first_name: nome, phone } },
      'order.processing': { id: 5902, number: '5902', status: 'processing', billing: { first_name: nome, phone } },
      'order.completed': { id: 5902, number: '5902', status: 'completed', billing: { first_name: nome, phone } },
      'order.shipped': { id: 5902, number: '5902', status: 'completed', meta_data: [{ key: 'tracking', value: 'BR123456789BR' }], billing: { first_name: nome, phone } },
      'cart.abandoned': { billing: { first_name: nome, phone } },
    };
    try {
      const event = await platformService.simulateIntegrationEvent(
        'woocommerce',
        eventType,
        payloads[eventType] || payloads['order.created'],
      ) as { status?: string };
      await refreshEvents();
      const sent = event?.status === 'processed';
      const msg = sent
        ? `WhatsApp enviado para ${testPhone ? 'seu número' : 'número demo'} — ${eventType}.`
        : `Evento "${eventType}" registrado (sem envio — verifique se está ativo e syncOrders ligado).`;
      setSimulateFeedback(msg);
      showToast(msg, sent ? 'success' : 'info');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erro ao simular';
      setSimulateFeedback(message);
      showToast(message, 'error');
    }
  };

  const copyWebhook = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    showToast('URL do webhook copiada!', 'success');
  };

  const isConnected = localCfg.connected || localCfg.credentialsConfigured;

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
            <p className="bs-page-desc mt-0.5">Pedidos da loja → WhatsApp automático.</p>
          </div>
        </div>
        {isConnected ? (
          <span className="bs-badge-success normal-case shrink-0">Conectado</span>
        ) : (
          <span className="bs-badge-warning normal-case shrink-0">Não conectado</span>
        )}
      </div>

      <div className="bs-card p-4 border border-bs-border bg-bs-elevated/50">
        <p className="text-sm font-semibold text-bs-text mb-2">Como configurar</p>
        <ol className="text-xs text-bs-muted list-decimal list-inside space-y-1.5">
          {SETUP_STEPS.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bs-section space-y-4">
          <h3 className="bs-section-title">REST API da loja</h3>
          <div>
            <label className="text-xs text-bs-muted mb-1 block">URL da loja</label>
            <input
              className="bs-input"
              placeholder="https://sualoja.com.br"
              value={storeUrl}
              onChange={(e) => setStoreUrl(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-bs-muted mb-1 block">Consumer Key</label>
            <input
              className="bs-input font-mono text-sm"
              placeholder="ck_..."
              value={consumerKey}
              onChange={(e) => setConsumerKey(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="text-xs text-bs-muted mb-1 block">Consumer Secret</label>
            <input
              type="password"
              className="bs-input font-mono text-sm"
              placeholder="cs_..."
              value={consumerSecret}
              onChange={(e) => setConsumerSecret(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={saveAndConnect} disabled={saving} className="bs-btn text-sm">
              {saving ? 'Conectando…' : 'Salvar e conectar'}
            </button>
            <button type="button" onClick={testConnection} disabled={testing} className="bs-btn-secondary text-sm">
              {testing ? 'Testando…' : 'Testar conexão'}
            </button>
          </div>
          {testFeedback && (
            <div className={`text-sm rounded-lg px-3 py-2 border ${testFeedback.ok ? 'border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400' : 'border-red-600/40 bg-red-600/10 text-red-700 dark:text-red-400'}`}>
              {testFeedback.ok ? '✓ ' : '✗ '}{testFeedback.message}
            </div>
          )}
        </div>

        <div className="bs-section space-y-4">
          <h3 className="bs-section-title">Webhook</h3>
          <p className="text-xs text-bs-muted">WooCommerce → Configurações → Avançado → Webhooks</p>
          {webhookUrl && (
            <>
              <pre className="bg-bs-elevated border border-bs-border rounded-lg px-3 py-2 text-[10px] font-mono text-bs-text overflow-x-auto whitespace-pre-wrap break-all">{webhookUrl}</pre>
              <button type="button" onClick={copyWebhook} className="bs-link-accent text-xs">
                Copiar URL do webhook
              </button>
            </>
          )}
          <div className="text-xs text-bs-muted space-y-1 pt-2 border-t border-bs-border">
            <p className="font-medium text-bs-text">Webhooks sugeridos:</p>
            <p>• <strong>Pedido criado</strong> → order.created</p>
            <p>• <strong>Pedido atualizado</strong> → processing / completed</p>
            <p className="text-[10px] text-bs-subtle">Entrega: JSON · Versão API: WP REST v3</p>
          </div>
          <div className="flex items-center justify-between gap-3 pt-2">
            <div>
              <p className="text-sm font-medium text-bs-text">WhatsApp em eventos</p>
              <p className="text-xs text-bs-muted">Desliga todos os envios Woo</p>
            </div>
            <Toggle
              on={localCfg.syncOrders !== false}
              onChange={(v) => {
                const next = { ...localCfg, syncOrders: v };
                setLocalCfg(next);
                persist(next);
              }}
            />
          </div>
          <div>
            <label className="text-xs text-bs-muted mb-1 block">Telefone para testes (Simular)</label>
            <input
              className="bs-input py-1.5 text-sm font-mono"
              placeholder="5511999999999"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="bs-table-wrap">
        <div className="bs-table-toolbar">
          <span className="text-sm font-semibold text-bs-text">Evento WooCommerce → Mensagem WhatsApp</span>
        </div>
        <table className="bs-table">
          <thead className="bs-table-head">
            <tr>
              <th>Evento</th>
              <th>Mensagem</th>
              <th>Ativo</th>
              <th className="text-right">Testar</th>
            </tr>
          </thead>
          <tbody>
            {WOO_EVENTS.map((ev) => (
              <tr key={ev.key} className="bs-table-row">
                <td>
                  <p className="font-medium text-sm text-bs-text">{ev.label}</p>
                  <p className="text-[10px] text-bs-muted">{ev.desc}</p>
                </td>
                <td>
                  <input
                    className="bs-input py-1 text-xs w-full"
                    value={localCfg.eventMessages?.[ev.key] || ''}
                    placeholder="Mensagem padrão do sistema"
                    onChange={(e) => {
                      const eventMessages = { ...(localCfg.eventMessages || {}), [ev.key]: e.target.value };
                      const next = { ...localCfg, eventMessages };
                      setLocalCfg(next);
                      persist(next);
                    }}
                  />
                </td>
                <td>
                  <Toggle
                    on={localCfg.events[ev.key] ?? true}
                    onChange={(v) => {
                      const next = { ...localCfg, events: { ...localCfg.events, [ev.key]: v } };
                      setLocalCfg(next);
                      persist(next);
                    }}
                  />
                </td>
                <td className="text-right">
                  <button type="button" onClick={() => simulate(ev.key)} className="bs-link-accent text-xs">
                    Simular
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-bs-muted px-4 py-2 border-t border-bs-border">
          Variáveis: {'{{nome}}'}, {'{{numero}}'}, {'{{total}}'}, {'{{rastreio}}'}
        </p>
        {simulateFeedback && (
          <p className="text-xs px-4 py-2 border-t border-bs-border text-bs-text bg-bs-elevated/60">
            {simulateFeedback}
          </p>
        )}
      </div>

      <div className="bs-card p-4 border-dashed">
        <p className="text-sm font-semibold text-bs-text mb-1">Fluxo recomendado {BRANDING.productName}</p>
        <p className="text-xs text-bs-muted leading-relaxed">
          <strong>WooCommerce</strong> confirma pedido no site → <strong>Bling</strong> assume logística depois.
          Evite mensagens duplicadas: use Woo para confirmação inicial e Bling para envio/entrega.
        </p>
      </div>

      <IntegrationEventLog events={events} filter="woocommerce" />
    </div>
  );
};

export default WooCommerceSettingsView;
