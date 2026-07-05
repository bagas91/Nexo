import React from 'react';
import { usePlatformEntities } from '../hooks/usePlatformData';
import type { CrmDeal } from '../services/mockStore';

const STAGES: CrmDeal['stage'][] = ['lead', 'qualified', 'proposal', 'won', 'lost'];
const STAGE_LABEL: Record<CrmDeal['stage'], string> = {
  lead: 'Lead',
  qualified: 'Qualificado',
  proposal: 'Proposta',
  won: 'Ganho',
  lost: 'Perdido',
};

const CrmView: React.FC = () => {
  const { items: deals, loading } = usePlatformEntities<CrmDeal>('deals');

  const byStage = (stage: CrmDeal['stage']) => deals.filter((d) => d.stage === stage);

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando CRM…</div>;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h2 className="bs-page-title">CRM</h2>
        <p className="bs-page-desc mt-1">Pipeline de vendas e leads.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3 overflow-x-auto pb-2">
        {STAGES.map((stage) => (
          <div key={stage} className="bs-card p-3 min-w-[160px]">
            <p className="text-xs font-bold uppercase text-bs-subtle mb-3">{STAGE_LABEL[stage]} ({byStage(stage).length})</p>
            <div className="space-y-2">
              {byStage(stage).map((d) => (
                <div key={d.id} className="p-3 rounded-lg border border-bs-border bg-bs-elevated">
                  <p className="font-semibold text-sm text-bs-text">{d.title}</p>
                  <p className="text-xs text-bs-muted">{d.contactName}</p>
                  {d.value > 0 && <p className="text-xs text-bs-accent font-bold mt-1">R$ {d.value.toFixed(2)}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CrmView;
