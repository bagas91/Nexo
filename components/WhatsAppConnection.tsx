import React, { useState } from 'react';
import { ConnectionStatus } from '../types';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';

type ConnectMode = 'qr' | 'code';
export type WaRole = 'dispatch' | 'ecommerce';

interface WhatsAppConnectionProps {
  role?: WaRole;
  title?: string;
  subtitle?: string;
  status: ConnectionStatus;
  qrCode: string | null;
  pairingCode: string | null;
  pairingPhone?: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync?: () => void;
  onPairingCodeChange?: (code: string | null) => void;
  syncing?: boolean;
  embedded?: boolean;
  showSyncGroups?: boolean;
  hidePageHeader?: boolean;
}

function formatPairingCode(code: string): string {
  const c = code.replace(/\s/g, '').toUpperCase();
  if (c.length === 8) return `${c.slice(0, 4)}-${c.slice(4)}`;
  return c;
}

function normalizeBrPhone(input: string): string {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('5591') && d.length === 13 && d[4] === '9') {
    d = `5511${d.slice(4)}`;
  }
  if (d.startsWith('55') && d.length === 12 && /^\d{8}$/.test(d.slice(4))) {
    d = `${d.slice(0, 4)}9${d.slice(4)}`;
  }
  return d;
}

function formatPhoneDisplay(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.startsWith('55') && d.length === 13) {
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  return d;
}

const WhatsAppConnection: React.FC<WhatsAppConnectionProps> = ({
  role = 'dispatch',
  title,
  subtitle,
  status,
  qrCode,
  pairingCode,
  pairingPhone,
  onConnect,
  onDisconnect,
  onSync,
  onPairingCodeChange,
  syncing,
  embedded = false,
  showSyncGroups = role === 'dispatch',
  hidePageHeader = false,
}) => {
  const { showToast } = useToast();
  const [mode, setMode] = useState<ConnectMode>('code');
  const [phone, setPhone] = useState('5511915266397');
  const [lastGeneratedPhone, setLastGeneratedPhone] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [requestingCode, setRequestingCode] = useState(false);
  const [generatingSec, setGeneratingSec] = useState(0);

  const isConnected = status === ConnectionStatus.CONNECTED;
  const backend = BackendService.getInstance();
  const displayTitle = title || (role === 'ecommerce' ? 'WhatsApp E-commerce' : 'WhatsApp Disparo');
  const displaySubtitle = subtitle || (role === 'ecommerce'
    ? 'CRM, atendimento e pedidos'
    : 'Palavra do Dia, grupos e agendamentos');

  const switchMode = async (next: ConnectMode) => {
    if (next === mode) return;
    if (next === 'qr' && pairingCode) {
      try {
        await backend.cancelPairingCode(role);
        onPairingCodeChange?.(null);
      } catch {
        /* ignora */
      }
    }
    setMode(next);
  };

  const handleRequestCode = async () => {
    const digits = normalizeBrPhone(phone);
    if (digits.length < 12) {
      const msg = 'Informe o número completo: 55 + DDD + número (ex.: 5511915266397).';
      setPhoneError(msg);
      showToast(msg, 'error');
      return;
    }
    if (digits !== phone.replace(/\D/g, '')) {
      setPhone(digits);
      showToast('Número ajustado automaticamente para o formato correto.', 'info');
    }
    setPhoneError(null);
    setRequestingCode(true);
    setGeneratingSec(0);
    const tick = window.setInterval(() => setGeneratingSec((s) => s + 1), 1000);
    try {
      const started = await backend.startPairingCode(digits, role);
      if (started.pairingCode) {
        onPairingCodeChange?.(started.pairingCode);
        setLastGeneratedPhone(started.pairingPhone || digits);
        showToast('Código gerado!', 'success');
        return;
      }

      const { pairingCode: code, pairingPhone: generatedFor } = await backend.pollPairingCode(
        started.pairingPhone || digits,
        28,
        2000,
        role
      );
      onPairingCodeChange?.(code);
      setLastGeneratedPhone(generatedFor || digits);
      showToast('Código gerado! Confira o número abaixo.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao gerar código.';
      setPhoneError(msg);
      showToast(msg, 'error');
    } finally {
      window.clearInterval(tick);
      setGeneratingSec(0);
      setRequestingCode(false);
    }
  };

  const copyCode = async () => {
    if (!pairingCode) return;
    try {
      await navigator.clipboard.writeText(pairingCode.replace(/\s/g, '').toUpperCase());
      showToast('Código copiado!', 'success');
    } catch {
      showToast('Não foi possível copiar.', 'error');
    }
  };

  return (
    <div className={`space-y-6 ${embedded || hidePageHeader ? '' : 'max-w-2xl mx-auto animate-fadeIn'}`}>
      {!embedded && !hidePageHeader && (
        <div>
          <h2 className="bs-page-title">Conexão WhatsApp</h2>
          <p className="bs-page-desc mt-1">
            Conecte, sincronize ou desconecte o WhatsApp deste papel.
          </p>
        </div>
      )}

      <div className="bs-card p-6">
        <div className="flex items-center gap-3 mb-1">
          <i className="fa-brands fa-whatsapp text-2xl text-bs-accent" />
          <div>
            <p className="font-bold text-bs-text">{displayTitle}</p>
            <p className="text-xs text-bs-muted">{displaySubtitle}</p>
          </div>
          <span className={`ml-auto bs-badge ${isConnected ? 'bs-badge-success' : 'bs-badge-warning'} normal-case`}>
            {isConnected ? 'Conectado' : 'Desconectado'}
          </span>
        </div>

        <div
          className="mt-4 rounded-xl border p-4"
          style={{
            background: isConnected ? 'var(--bs-success-bg)' : 'var(--bs-warning-bg)',
            borderColor: isConnected ? 'var(--bs-success-border)' : 'var(--bs-warning-border)',
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-bs-accent animate-pulse' : 'bg-amber-500'}`} />
            <span className="font-bold" style={{ color: isConnected ? 'var(--bs-success-text)' : 'var(--bs-warning-text)' }}>
              {isConnected
                ? (role === 'ecommerce' ? 'Sessão ativa — CRM e atendimento' : 'Sessão ativa — pronto para disparar')
                : 'WhatsApp desconectado'}
            </span>
          </div>

          {isConnected ? (
            <div className="flex flex-wrap gap-3">
              {showSyncGroups && onSync && (
                <button type="button" onClick={onSync} disabled={syncing} className="bs-btn">
                  {syncing ? 'Sincronizando...' : 'Sincronizar grupos'}
                </button>
              )}
              <button type="button" onClick={onDisconnect} className="bs-btn-danger">
                Desconectar
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-1 p-1 bg-bs-elevated rounded-lg border border-bs-border w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => switchMode('code')}
                  className={`flex-1 sm:flex-none px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                    mode === 'code' ? 'bs-filter-active' : 'bs-filter-idle'
                  }`}
                >
                  <i className="fa-solid fa-keyboard mr-1.5" />
                  Código
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('qr')}
                  className={`flex-1 sm:flex-none px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                    mode === 'qr' ? 'bs-filter-active' : 'bs-filter-idle'
                  }`}
                >
                  <i className="fa-solid fa-qrcode mr-1.5" />
                  QR Code
                </button>
              </div>

              {mode === 'code' && (
                <div className="space-y-4">
                  <p className="text-sm text-bs-muted">
                    Ideal quando não dá para escanear QR: você gera o código aqui e a pessoa digita no celular.
                  </p>
                  <div>
                    <label className="text-xs font-semibold text-bs-muted mb-1.5 block">
                      Número do WhatsApp (DDI + DDD + número)
                    </label>
                    <input
                      className="bs-input font-mono"
                      placeholder="5511915266397"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        if (phoneError) setPhoneError(null);
                      }}
                    />
                    {phoneError ? (
                      <p className="text-xs text-red-500 mt-1.5 font-medium">{phoneError}</p>
                    ) : (
                      <p className="text-[10px] text-bs-subtle mt-1">
                        Ex.: 55 + DDD + número. Em SP: 55119…
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleRequestCode}
                    disabled={requestingCode}
                    className="bs-btn px-6 py-2.5 flex items-center gap-2"
                  >
                    {requestingCode ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Gerando código...
                      </>
                    ) : (
                      <>
                        {pairingCode ? 'Atualizar código' : 'Gerar código de pareamento'}
                        <i className="fa-solid fa-arrow-right" />
                      </>
                    )}
                  </button>

                  {requestingCode && (
                    <div className="space-y-2">
                      <p className="text-xs text-bs-muted">
                        Gerando código… {generatingSec > 0 ? `(${generatingSec}s)` : ''} — não clique de novo.
                      </p>
                      {generatingSec >= 20 && (
                        <button
                          type="button"
                          onClick={() => switchMode('qr')}
                          className="bs-btn-secondary text-xs px-4 py-2"
                        >
                          Cancelar e usar QR Code
                        </button>
                      )}
                    </div>
                  )}

                  {(status === ConnectionStatus.PAIRING_CODE_READY || pairingCode) && pairingCode && (
                    <div className="space-y-4 pt-2 border-t border-bs-border">
                      <div className="text-center p-6 bg-bs-shell rounded-xl border border-bs-border">
                        <p className="text-xs uppercase tracking-wider text-bs-muted mb-2">Código para digitar no celular</p>
                        {(pairingPhone || lastGeneratedPhone) && (
                          <p className="text-sm text-bs-text font-semibold mb-3">
                            Número: {formatPhoneDisplay(pairingPhone || lastGeneratedPhone || '')}
                          </p>
                        )}
                        <p className="text-4xl md:text-5xl font-mono font-bold tracking-[0.2em] text-bs-accent select-all">
                          {formatPairingCode(pairingCode)}
                        </p>
                        <button type="button" onClick={copyCode} className="bs-link-accent text-xs mt-3">
                          Copiar código
                        </button>
                      </div>
                      <ol className="text-sm text-bs-muted list-decimal list-inside space-y-1.5">
                        <li>No celular: WhatsApp → <strong>Configurações</strong> → <strong>Aparelhos conectados</strong></li>
                        <li>Toque em <strong>Conectar um aparelho</strong></li>
                        <li>Escolha <strong>Conectar com número de telefone</strong></li>
                        <li>Digite o <strong>mesmo número</strong> mostrado acima e depois o código</li>
                      </ol>
                    </div>
                  )}
                </div>
              )}

              {mode === 'qr' && (
                <div className="space-y-4">
                  {status === ConnectionStatus.DISCONNECTED && (
                    <button
                      type="button"
                      onClick={onConnect}
                      className="w-full sm:w-auto bs-btn px-6 py-3 flex items-center justify-center gap-2"
                    >
                      Gerar QR Code
                      <i className="fa-solid fa-qrcode" />
                    </button>
                  )}

                  {status === ConnectionStatus.CONNECTING && !qrCode && (
                    <div className="flex items-center gap-3" style={{ color: 'var(--bs-success-text)' }}>
                      <div className="w-8 h-8 border-4 border-bs-border border-t-bs-accent rounded-full animate-spin" />
                      <span className="font-medium">Iniciando sessão do WhatsApp...</span>
                    </div>
                  )}

                  {status === ConnectionStatus.QR_READY && qrCode && (
                    <div className="space-y-4">
                      <div className="p-4 bg-bs-shell rounded-xl border border-bs-border inline-block">
                        <img src={qrCode} alt={`QR Code ${displayTitle}`} className="w-64 h-64 md:w-72 md:h-72 mx-auto" style={{ imageRendering: 'crisp-edges' }} />
                      </div>
                      <ol className="text-sm text-bs-muted list-decimal list-inside space-y-1">
                        <li>Abra o WhatsApp no celular deste número</li>
                        <li>Configurações → Aparelhos conectados</li>
                        <li>Conectar um aparelho → escaneie o código</li>
                      </ol>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WhatsAppConnection;
