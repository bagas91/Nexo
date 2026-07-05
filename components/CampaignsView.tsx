import React from 'react';
import { usePlatformEntities } from '../hooks/usePlatformData';
import type { MockCampaign } from '../services/mockStore';

const STATUS_CLASS: Record<string, string> = {
  draft: 'bs-badge-warning',
  scheduled: 'bs-badge-accent',
  running: 'bs-badge-success',
  done: 'bs-badge normal-case bg-bs-elevated text-bs-muted border border-bs-border',
};

const CampaignsView: React.FC = () => {
  const { items: campaigns, loading } = usePlatformEntities<MockCampaign>('campaigns');

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando campanhas…</div>;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h2 className="bs-page-title">Campanhas</h2>
          <p className="bs-page-desc mt-1">Disparos em massa e campanhas programadas.</p>
        </div>
        <button type="button" className="bs-btn text-sm px-4 py-2 opacity-60 cursor-not-allowed" title="Use Agendamentos para disparos reais">
          Nova campanha
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {campaigns.map((cp) => (
          <div key={cp.id} className="bs-card p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="font-bold text-bs-text">{cp.name}</p>
              <span className={`${STATUS_CLASS[cp.status]} normal-case capitalize`}>{cp.status}</span>
            </div>
            <div className="mb-3">
              <div className="flex justify-between text-xs text-bs-muted mb-1">
                <span>Progresso</span>
                <span>{cp.sent}/{cp.total}</span>
              </div>
              <div className="h-2 rounded-full bg-bs-elevated overflow-hidden">
                <div className="h-full bg-bs-accent rounded-full transition-all" style={{ width: `${cp.total ? (cp.sent / cp.total) * 100 : 0}%` }} />
              </div>
            </div>
            {cp.scheduledAt && (
              <p className="text-xs text-bs-muted">
                Agendado: {new Date(cp.scheduledAt).toLocaleString('pt-BR')}
              </p>
            )}
            <p className="text-xs text-bs-subtle mt-2">Disparos reais → use Ferramentas → Agendamentos</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CampaignsView;
