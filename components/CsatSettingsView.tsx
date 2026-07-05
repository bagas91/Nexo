import React, { useEffect, useState } from 'react';
import { useToast } from '../contexts/ToastContext';
import { usePlatformKv } from '../hooks/usePlatformData';
import type { CsatConfig } from '../services/mockStore';
import Toggle from './Toggle';

const CSAT_FALLBACK: CsatConfig = {
  active: false,
  message: 'Como foi seu atendimento? Responda de 1 a 5 ⭐',
};

const CsatSettingsView: React.FC = () => {
  const { showToast } = useToast();
  const { value: stored, save, loading } = usePlatformKv<CsatConfig>('csat', CSAT_FALLBACK);
  const [active, setActive] = useState(stored.active);
  const [message, setMessage] = useState(stored.message);

  useEffect(() => {
    setActive(stored.active);
    setMessage(stored.message);
  }, [stored]);

  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      save({ active, message }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [active, message, loading, save]);

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando CSAT…</div>;
  }

  return (
    <div className="space-y-6 animate-fadeIn max-w-4xl">
      <div>
        <h2 className="bs-page-title">Pesquisa CSAT</h2>
        <p className="bs-page-desc mt-1">Configuração salva no servidor.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bs-section space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-bs-text">Pesquisa CSAT</p>
              <p className="text-xs text-bs-muted">Ativar envio automático pós-atendimento</p>
            </div>
            <Toggle on={active} onChange={(v) => { setActive(v); showToast(v ? 'CSAT ativado.' : 'CSAT desativado.', 'info'); }} />
          </div>
          <textarea className="bs-input min-h-[100px]" value={message} onChange={(e) => setMessage(e.target.value)} disabled={!active} />
        </div>
        <div className="bs-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-bs-subtle mb-4">Pré-visualização</p>
          <div className="rounded-xl border border-bs-border bg-bs-elevated p-4 max-w-xs mx-auto">
            <div className="bg-bs-shell border border-bs-border rounded-lg rounded-tl-none px-3 py-2 text-sm">{message}</div>
            <div className="flex gap-2 mt-3 justify-end">
              {['1', '2', '3', '4', '5'].map((n) => (
                <span key={n} className="w-8 h-8 rounded-lg border border-bs-border bg-bs-shell text-xs flex items-center justify-center text-bs-muted">{n}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CsatSettingsView;
