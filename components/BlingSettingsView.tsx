import React, { useEffect, useState } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useIntegrationEvents, usePlatformKv } from '../hooks/usePlatformData';
import platformService from '../services/platformService';
import type { BlingConfig, IntegrationConfig } from '../services/mockStore';
import Toggle from './Toggle';
import IntegrationEventLog from './IntegrationEventLog';
import { BRANDING } from '../config/branding';

const INTEGRATIONS_FALLBACK: IntegrationConfig[] = [];

const BLING_FALLBACK: BlingConfig = {
  connected: false,
  apiKey: '',
  accessToken: '',
  syncProducts: true,
  syncOrders: true,
  notifyNfe: true,
  notifyLowStock: false,
  statusMap: [],
};

const SETUP_STEPS = [
  'No Bling: cadastre o app OAuth (developer.bling.com.br) com o Link de redirecionamento abaixo.',
  'Adicione escopos: Pedidos de venda e Contatos (mínimo para WhatsApp).',
  'Cole Client ID e Client Secret aqui → Salvar credenciais → Autorizar no Bling.',
  'No Bling: Configurações → Webhooks → cadastre a URL de webhook (recurso: Pedido de venda).',
  'Ative os status desejados na tabela e teste com Simular.',
];

interface BlingSettingsViewProps {
  onBack?: () => void;
}

const BlingSettingsView: React.FC<BlingSettingsViewProps> = ({ onBack }) => {
  const { showToast } = useToast();
  const { value: cfg, loading, refresh } = usePlatformKv<BlingConfig>('bling', BLING_FALLBACK);
  const { value: integrations, save: saveIntegrations } = usePlatformKv<IntegrationConfig[]>('integrations', INTEGRATIONS_FALLBACK);
  const { events, refresh: refreshEvents } = useIntegrationEvents('bling');
  const [localCfg, setLocalCfg] = useState(cfg);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState(`${BRANDING.vpsUrl}/api/bling/oauth/callback`);
  const [testPhone, setTestPhone] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [simulateFeedback, setSimulateFeedback] = useState<string | null>(null);

  useEffect(() => setLocalCfg(cfg), [cfg]);
  useEffect(() => {
    const t = cfg.accessToken || cfg.apiKey || '';
    if (t && !t.includes('demo') && !t.includes('•••')) setTokenInput(t);
    if (cfg.clientId) setClientId(cfg.clientId);
    if (cfg.clientSecret) setClientSecret(cfg.clientSecret);
  }, [cfg]);

  useEffect(() => {
    platformService.getWebhookToken().then((token) => {
      setWebhookUrl(platformService.webhookUrl('bling', token));
    }).catch(() => {});
    platformService.getBlingRedirectUri().then((r) => {
      if (r.redirectUri) setRedirectUri(r.redirectUri);
    }).catch(() => {});
  }, []);

  const persist = async (next: BlingConfig) => {
    try {
      const saved = await platformService.setKv('bling', next);
      setLocalCfg(saved);
      await refresh();
      return saved;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao salvar', 'error');
      throw e;
    }
  };

  const isConnected = Boolean(
    cfg.connected || cfg.tokenConfigured || localCfg.connected || localCfg.tokenConfigured,
  );

  const save = async () => {
    if (!tokenInput.trim() && (cfg.tokenConfigured || localCfg.tokenConfigured)) {
      showToast('Token OAuth já está salvo no servidor.', 'info');
      return;
    }
    if (!tokenInput.trim()) {
      showToast('Cole o token ou use Autorizar no Bling.', 'error');
      return;
    }
    await persist({ ...localCfg, connected: true, accessToken: tokenInput.trim(), apiKey: tokenInput.trim(), connectedAt: Date.now() });
    showToast('Token Bling salvo.', 'success');
  };

  const copyWebhook = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    showToast('URL do webhook copiada!', 'success');
  };

  const copyRedirectUri = () => {
    navigator.clipboard.writeText(redirectUri);
    showToast('Link de redirecionamento copiado!', 'success');
  };

  const saveCredentials = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      showToast('Informe Client ID e Client Secret do app Bling.', 'error');
      return;
    }
    setSavingCreds(true);
    try {
      const res = await platformService.saveBlingCredentials(clientId.trim(), clientSecret.trim());
      if (res.redirectUri) setRedirectUri(res.redirectUri);
      if (res.value) setLocalCfg(res.value);
      await refresh();
      showToast('Credenciais salvas no servidor.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao salvar credenciais', 'error');
    } finally {
      setSavingCreds(false);
    }
  };

  const authorizeBling = async () => {
    setAuthorizing(true);
    try {
      const res = await platformService.getBlingAuthorizeUrl();
      window.open(res.url, '_blank', 'noopener,noreferrer');
      showToast('Autorize no Bling. Esta página atualiza sozinha quando conectar.', 'info');
      const started = Date.now();
      const poll = window.setInterval(async () => {
        if (Date.now() - started > 120000) {
          window.clearInterval(poll);
          return;
        }
        try {
          const latest = await platformService.getKv<BlingConfig>('bling');
          if (latest?.tokenConfigured || (latest?.connected && !String(latest.apiKey || '').includes('demo'))) {
            window.clearInterval(poll);
            await refresh();
            showToast('Bling conectado com sucesso!', 'success');
          }
        } catch {
          /* ignore poll errors */
        }
      }, 2500);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao gerar link de autorização', 'error');
    } finally {
      setAuthorizing(false);
    }
  };

  const testConnection = async () => {
    const manual = tokenInput.trim();
    setTesting(true);
    setTestFeedback(null);
    try {
      const res = await platformService.testBlingConnection(manual || undefined);
      const message = res.message || 'Conexão OK!';
      setTestFeedback({ ok: true, message });
      showToast(message, 'success');
      await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha na conexão';
      setTestFeedback({ ok: false, message });
      showToast(message, 'error');
    } finally {
      setTesting(false);
    }
  };

  const connectBling = async () => {
    if (!tokenInput.trim()) {
      showToast('Cole o token OAuth do Bling.', 'error');
      return;
    }
    setConnecting(true);
    try {
      const res = await platformService.connectBling(tokenInput.trim());
      await persist({
        ...localCfg,
        connected: true,
        accessToken: tokenInput.trim(),
        apiKey: tokenInput.trim(),
        connectedAt: Date.now(),
      });
      if (integrations.length) {
        await saveIntegrations(integrations.map((i) =>
          i.id === 'bling' ? { ...i, connected: true, connectedAt: Date.now() } : i
        ));
      }
      showToast(res.message || 'Bling conectado!', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao conectar', 'error');
    } finally {
      setConnecting(false);
    }
  };

  const simulateStatus = async (blingStatus: string) => {
    const phone = testPhone.replace(/\D/g, '') || '5562988885555';
    const nome = 'Cliente Teste';
    setSimulateFeedback(null);
    try {
      const event = await platformService.simulateIntegrationEvent('bling', `pedido.${blingStatus.toLowerCase().replace(/\s/g, '_')}`, {
        numero: '7821',
        situacao: blingStatus,
        contato: { nome, telefone: phone },
      }) as { status?: string; whatsappPreview?: string };
      await refreshEvents();
      const sent = event?.status === 'processed';
      const msg = sent
        ? `WhatsApp enviado para ${testPhone ? 'seu número' : 'número demo'} — status "${blingStatus}".`
        : `Evento "${blingStatus}" registrado (sem envio WhatsApp — confira se o status está ativo e syncOrders ligado).`;
      setSimulateFeedback(msg);
      showToast(msg, sent ? 'success' : 'info');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erro ao simular';
      setSimulateFeedback(message);
      showToast(message, 'error');
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
            <p className="bs-page-desc mt-0.5">Pedidos, NF-e e rastreio → WhatsApp automático.</p>
          </div>
        </div>
        {isConnected ? (
          <span className="bs-badge-success normal-case shrink-0">Conectado</span>
        ) : (
          <button type="button" onClick={connectBling} disabled={connecting} className="bs-btn text-sm px-4 py-2 shrink-0">
            {connecting ? 'Conectando…' : 'Conectar Bling'}
          </button>
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
          <h3 className="bs-section-title">App OAuth no Bling</h3>
          <div>
            <label className="text-xs text-bs-muted mb-1 block">Link de redirecionamento (cole no cadastro do app)</label>
            <pre className="bg-bs-elevated border border-bs-border rounded-lg px-3 py-2 text-[10px] font-mono text-bs-text overflow-x-auto whitespace-pre-wrap break-all">{redirectUri}</pre>
            <button type="button" onClick={copyRedirectUri} className="bs-link-accent text-xs mt-2">
              Copiar link de redirecionamento
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs text-bs-muted mb-1 block">Client ID</label>
              <input
                className="bs-input font-mono text-sm"
                placeholder="ID do aplicativo Bling"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-xs text-bs-muted mb-1 block">Client Secret</label>
              <input
                className="bs-input font-mono text-sm"
                placeholder="Segredo do aplicativo"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                type="password"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={saveCredentials} disabled={savingCreds} className="bs-btn-secondary text-sm">
              {savingCreds ? 'Salvando…' : 'Salvar credenciais'}
            </button>
            <button type="button" onClick={authorizeBling} disabled={authorizing} className="bs-btn text-sm">
              {authorizing ? 'Abrindo…' : 'Autorizar no Bling'}
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
          <p className="text-xs text-bs-muted">
            Crie o app em{' '}
            <a href="https://developer.bling.com.br" target="_blank" rel="noreferrer" className="text-bs-accent underline">
              developer.bling.com.br
            </a>
            . Escopos mínimos: <strong>Pedidos de venda</strong> e <strong>Contatos</strong>.
          </p>
        </div>

        <div className="bs-section space-y-4">
          <h3 className="bs-section-title">Token manual (opcional)</h3>
          <div>
            <label className="text-xs text-bs-muted mb-1 block">Token de acesso (Bearer)</label>
            <input
              className="bs-input font-mono text-sm"
              placeholder="Ou cole o access_token manualmente"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              type="password"
              autoComplete="off"
            />
          </div>
          <p className="text-xs text-bs-muted">
            Usado para buscar dados completos do pedido quando o webhook chega só com o ID.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} className="bs-btn-secondary text-sm">Salvar token</button>
          </div>
          {webhookUrl && (
            <div>
              <label className="text-xs text-bs-muted mb-1 block">Webhook URL (cadastre no Bling)</label>
              <pre className="bg-bs-elevated border border-bs-border rounded-lg px-3 py-2 text-[10px] font-mono text-bs-text overflow-x-auto whitespace-pre-wrap break-all">{webhookUrl}</pre>
              <button type="button" onClick={copyWebhook} className="bs-link-accent text-xs mt-2">
                Copiar URL
              </button>
            </div>
          )}
        </div>

        <div className="bs-section space-y-3">
          <h3 className="bs-section-title">Sincronização</h3>
          {([
            { key: 'syncProducts' as const, label: 'Sincronizar produtos', desc: 'Catálogo para Agente IA (em breve)' },
            { key: 'syncOrders' as const, label: 'WhatsApp em mudança de pedido', desc: 'Envia mensagem ao cliente' },
            { key: 'notifyNfe' as const, label: 'Avisar NF-e autorizada', desc: 'Status NF-e na tabela abaixo' },
            { key: 'notifyLowStock' as const, label: 'Alerta estoque baixo', desc: 'Grupo ADM interno (em breve)' },
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
          <div className="pt-2 border-t border-bs-border">
            <label className="text-xs text-bs-muted mb-1 block">Telefone para testes (Simular)</label>
            <input
              className="bs-input py-1.5 text-sm font-mono"
              placeholder="5511999999999 (opcional)"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
            />
            <p className="text-[10px] text-bs-muted mt-1">Se vazio, usa número demo. Com seu número, o WhatsApp recebe a mensagem de teste.</p>
          </div>
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
        <p className="text-[10px] text-bs-muted px-4 py-2 border-t border-bs-border">
          Variáveis: {'{{nome}}'}, {'{{numero}}'}, {'{{rastreio}}'}
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
          <strong>WooCommerce</strong> confirma pedido no site → <strong>Bling</strong> assume logística (NF, rastreio, entrega).
          Evita mensagens duplicadas: Woo para marketing inicial, Bling para operação.
        </p>
      </div>

      <IntegrationEventLog events={events} filter="bling" />
    </div>
  );
};

export default BlingSettingsView;
