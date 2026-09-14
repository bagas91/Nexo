import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';

export interface MetaWhatsAppConfig {
  connected?: boolean;
  phoneNumberId?: string;
  wabaId?: string;
  displayPhone?: string;
  verifyToken?: string;
  graphVersion?: string;
  accessToken?: string;
  appSecret?: string;
  accessTokenConfigured?: boolean;
  appSecretConfigured?: boolean;
  lastError?: string | null;
  lastWebhookAt?: number | null;
}

interface MetaWhatsAppConnectionProps {
  onStatusChange?: (connected: boolean) => void;
}

const MetaWhatsAppConnection: React.FC<MetaWhatsAppConnectionProps> = ({ onStatusChange }) => {
  const { showToast } = useToast();
  const backend = BackendService.getInstance();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [cfg, setCfg] = useState<MetaWhatsAppConfig>({});
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [testPhone, setTestPhone] = useState('');

  const webhookUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/api/webhooks/meta-whatsapp`;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await backend.getMetaWhatsAppConfig();
      setCfg(data || {});
      setAccessToken('');
      setAppSecret('');
      onStatusChange?.(!!data?.connected);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao carregar Cloud API', 'error');
    } finally {
      setLoading(false);
    }
  }, [backend, onStatusChange, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        phoneNumberId: cfg.phoneNumberId || '',
        wabaId: cfg.wabaId || '',
        displayPhone: cfg.displayPhone || '',
        verifyToken: cfg.verifyToken || '',
        graphVersion: cfg.graphVersion || 'v21.0',
        connected: true,
        accessToken: accessToken.trim() || '••••••••',
        appSecret: appSecret.trim() || '••••••••',
      };
      const saved = await backend.saveMetaWhatsAppConfig(payload);
      setCfg(saved);
      setAccessToken('');
      setAppSecret('');
      onStatusChange?.(!!saved.connected);
      showToast(saved.connected ? 'Cloud API salva e conectada.' : 'Salvo — complete Phone Number ID e Token.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao salvar', 'error');
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('Desconectar Cloud API Meta do e-commerce?')) return;
    setSaving(true);
    try {
      const saved = await backend.saveMetaWhatsAppConfig({
        ...cfg,
        connected: false,
        accessToken: '••••••••',
        appSecret: '••••••••',
      });
      setCfg(saved);
      onStatusChange?.(false);
      showToast('E-commerce Cloud API desconectado.', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro', 'error');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    const phone = testPhone.replace(/\D/g, '');
    if (phone.length < 10) {
      showToast('Informe o telefone com DDI (ex.: 5511999999999).', 'error');
      return;
    }
    setTesting(true);
    try {
      await backend.testMetaWhatsApp(phone);
      showToast('Mensagem de teste enviada!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha no teste', 'error');
    } finally {
      setTesting(false);
    }
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      showToast('URL do webhook copiada.', 'success');
    } catch {
      showToast('Não foi possível copiar.', 'error');
    }
  };

  const isConnected = !!cfg.connected;

  return (
    <div className="bs-card p-6 space-y-4">
      <div className="flex items-center gap-3 mb-1">
        <i className="fa-brands fa-meta text-2xl text-bs-accent" />
        <div>
          <p className="font-bold text-bs-text">E-commerce — Cloud API Meta</p>
          <p className="text-xs text-bs-muted">CRM e atendimento pela API oficial (sem QR)</p>
        </div>
        <span className={`ml-auto bs-badge ${isConnected ? 'bs-badge-success' : 'bs-badge-warning'} normal-case`}>
          {isConnected ? 'Conectado' : 'Desconectado'}
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-bs-muted">Carregando…</p>
      ) : (
        <>
          <div
            className="rounded-xl border p-4"
            style={{
              background: isConnected ? 'var(--bs-success-bg)' : 'var(--bs-warning-bg)',
              borderColor: isConnected ? 'var(--bs-success-border)' : 'var(--bs-warning-border)',
            }}
          >
            <p className="text-sm font-semibold" style={{ color: isConnected ? 'var(--bs-success-text)' : 'var(--bs-warning-text)' }}>
              {isConnected
                ? 'Pronto para receber webhooks e enviar mensagens 1:1'
                : 'Preencha Phone Number ID, Access Token e Verify Token'}
            </p>
            {cfg.lastError && (
              <p className="text-xs text-red-500 mt-2">{cfg.lastError}</p>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-bs-muted mb-1.5 block">Webhook URL (cole no App Meta)</label>
            <div className="flex gap-2">
              <input className="bs-input font-mono text-xs" readOnly value={webhookUrl} />
              <button type="button" className="bs-btn-secondary shrink-0" onClick={copyWebhook}>Copiar</button>
            </div>
            <p className="text-[10px] text-bs-subtle mt-1">
              Em Meta Developers → WhatsApp → Configuration → Webhook → Callback URL. Assine o campo <strong>messages</strong>.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-bs-muted mb-1.5 block">Phone Number ID</label>
              <input
                className="bs-input font-mono text-sm"
                value={cfg.phoneNumberId || ''}
                onChange={(e) => setCfg((c) => ({ ...c, phoneNumberId: e.target.value }))}
                placeholder="Ex.: 109876543210"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-bs-muted mb-1.5 block">WABA ID (opcional)</label>
              <input
                className="bs-input font-mono text-sm"
                value={cfg.wabaId || ''}
                onChange={(e) => setCfg((c) => ({ ...c, wabaId: e.target.value }))}
                placeholder="WhatsApp Business Account ID"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-bs-muted mb-1.5 block">Número exibido (opcional)</label>
              <input
                className="bs-input font-mono text-sm"
                value={cfg.displayPhone || ''}
                onChange={(e) => setCfg((c) => ({ ...c, displayPhone: e.target.value }))}
                placeholder="5511…"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-bs-muted mb-1.5 block">Verify Token</label>
              <input
                className="bs-input font-mono text-sm"
                value={cfg.verifyToken || ''}
                onChange={(e) => setCfg((c) => ({ ...c, verifyToken: e.target.value }))}
                placeholder="Mesmo token do webhook na Meta"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-bs-muted mb-1.5 block">
                Access Token {cfg.accessTokenConfigured ? '(já salvo — deixe em branco para manter)' : ''}
              </label>
              <input
                className="bs-input font-mono text-sm"
                type="password"
                autoComplete="off"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={cfg.accessTokenConfigured ? '••••••••' : 'Token permanente / System User'}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-bs-muted mb-1.5 block">
                App Secret {cfg.appSecretConfigured ? '(já salvo — deixe em branco para manter)' : '(recomendado p/ assinatura)'}
              </label>
              <input
                className="bs-input font-mono text-sm"
                type="password"
                autoComplete="off"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder={cfg.appSecretConfigured ? '••••••••' : 'App Secret do Meta App'}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="bs-btn" onClick={save} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar Cloud API'}
            </button>
            {isConnected && (
              <button type="button" className="bs-btn-danger" onClick={disconnect} disabled={saving}>
                Desconectar
              </button>
            )}
          </div>

          {isConnected && (
            <div className="pt-3 border-t border-bs-border space-y-2">
              <p className="text-xs font-semibold text-bs-muted">Teste de envio</p>
              <div className="flex flex-wrap gap-2">
                <input
                  className="bs-input font-mono text-sm flex-1 min-w-[180px]"
                  placeholder="5511999999999"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                />
                <button type="button" className="bs-btn-secondary" onClick={sendTest} disabled={testing}>
                  {testing ? 'Enviando…' : 'Enviar teste'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MetaWhatsAppConnection;
