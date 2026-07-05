import React, { useState } from 'react';
import { mockStore } from '../services/mockStore';
import { useMockStore } from '../hooks/useMockStore';
import { useToast } from '../contexts/ToastContext';
import MockBanner from './MockBanner';

const ApiSettingsView: React.FC = () => {
  useMockStore();
  const [tokenLabel, setTokenLabel] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const { showToast } = useToast();
  const tokens = mockStore.getTokens();

  const handleGenerate = () => {
    if (!tokenLabel.trim()) return showToast('Informe um nome para o token.', 'error');
    const t = mockStore.createToken(tokenLabel.trim());
    setTokenLabel('');
    setRevealed(t.id);
    showToast('Token gerado (mock). Copie agora — não será exibido de novo.', 'success');
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Copiado!', 'success');
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-3xl">
      <MockBanner />
      <div>
        <h2 className="bs-page-title">Documentação da API</h2>
        <p className="bs-page-desc mt-1">Tokens mock — persistidos no navegador.</p>
      </div>

      <div className="bs-section space-y-4">
        <h3 className="bs-section-title">Seus Tokens de API</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <input className="bs-input flex-1" placeholder="Nome do token" value={tokenLabel} onChange={(e) => setTokenLabel(e.target.value)} />
          <button type="button" onClick={handleGenerate} className="bs-btn whitespace-nowrap">
            <i className="fa-solid fa-plus mr-2" />Gerar Token
          </button>
        </div>

        {tokens.length === 0 ? (
          <p className="text-sm text-bs-muted italic py-4 text-center border border-dashed border-bs-border rounded-lg">
            Nenhum token criado ainda.
          </p>
        ) : (
          <ul className="space-y-2">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border border-bs-border bg-bs-elevated">
                <div>
                  <p className="font-semibold text-sm text-bs-text">{t.label}</p>
                  <p className="font-mono text-xs text-bs-muted">
                    {revealed === t.id ? t.token : `${t.prefix}••••••••`}
                  </p>
                  <p className="text-[10px] text-bs-subtle">{new Date(t.createdAt).toLocaleString('pt-BR')}</p>
                </div>
                <div className="flex gap-2">
                  {revealed === t.id && (
                    <button type="button" onClick={() => copy(t.token)} className="bs-btn-secondary text-xs py-1 px-2">Copiar</button>
                  )}
                  <button type="button" onClick={() => { mockStore.deleteToken(t.id); showToast('Token revogado.', 'success'); }} className="text-xs text-red-600 font-semibold">Revogar</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-lg px-4 py-3 text-sm border" style={{ background: 'var(--bs-warning-bg)', borderColor: 'var(--bs-warning-border)', color: 'var(--bs-warning-text)' }}>
          Tokens mock — não autenticam na API real ainda. Rate limit futuro: 100 req/min.
        </div>
      </div>

      <div className="bs-section space-y-3">
        <h3 className="bs-section-title">Autenticação</h3>
        <pre className="bg-bs-elevated border border-bs-border rounded-lg px-4 py-3 text-sm font-mono">Authorization: Bearer SEU_TOKEN_AQUI</pre>
      </div>
    </div>
  );
};

export default ApiSettingsView;
