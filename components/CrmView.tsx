import React, { useCallback, useEffect, useMemo, useState } from 'react';
import platformService from '../services/platformService';
import type { CrmDeal, CrmDealStage } from '../services/mockStore';
import { useToast } from '../contexts/ToastContext';
import InboxPanel from './InboxPanel';

export type CrmTab = 'atendimento' | 'pipeline';

const STAGES: { id: CrmDealStage; label: string }[] = [
  { id: 'new', label: 'Novo contato' },
  { id: 'attending', label: 'Em atendimento' },
  { id: 'link_sent', label: 'Link enviado' },
  { id: 'awaiting_payment', label: 'Aguardando pagamento' },
  { id: 'paid', label: 'Pedido pago' },
  { id: 'lost', label: 'Perdido' },
];

const LEGACY: Record<string, CrmDealStage> = {
  lead: 'new',
  qualified: 'attending',
  proposal: 'link_sent',
  won: 'paid',
  lost: 'lost',
};

function normalizeStage(stage: string): CrmDealStage {
  if (LEGACY[stage]) return LEGACY[stage];
  if (STAGES.some((s) => s.id === stage)) return stage as CrmDealStage;
  return 'new';
}

type CrmViewProps = {
  tab?: CrmTab;
  onTabChange?: (tab: CrmTab) => void;
};

const PipelineBoard: React.FC = () => {
  const { showToast } = useToast();
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await platformService.listCrmDeals();
      setDeals((res.deals || []).map((d) => ({
        ...d,
        stage: normalizeStage(d.stage),
        value: Number(d.value) || 0,
        updatedAt: d.updatedAt || Date.now(),
      })) as CrmDeal[]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao carregar pipeline', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byStage = useMemo(() => {
    const map: Record<string, CrmDeal[]> = {};
    for (const s of STAGES) map[s.id] = [];
    for (const d of deals) {
      const stage = normalizeStage(String(d.stage));
      if (!map[stage]) map[stage] = [];
      map[stage].push(d);
    }
    return map;
  }, [deals]);

  const moveDeal = async (deal: CrmDeal, stage: CrmDealStage) => {
    if (normalizeStage(String(deal.stage)) === stage) return;
    setBusyId(deal.id);
    try {
      await platformService.updateCrmDeal(deal.id, { stage });
      setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, stage, updatedAt: Date.now() } : d)));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao mover oportunidade', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando pipeline…</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-bs-muted max-w-2xl">
          Funil digital: do WhatsApp até o pagamento. Use <strong className="text-bs-text">+ Criar</strong> na ficha do cliente no Atendimento.
        </p>
        <button type="button" className="bs-btn-secondary text-xs py-1.5 px-3" onClick={() => void refresh()}>
          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 overflow-x-auto pb-2">
        {STAGES.map((stage) => (
          <div key={stage.id} className="bs-card p-3 min-w-[160px] flex flex-col min-h-[220px]">
            <p className="text-[10px] font-bold uppercase text-bs-subtle mb-2">
              {stage.label}
              <span className="ml-1 text-bs-muted font-semibold">({byStage[stage.id]?.length || 0})</span>
            </p>
            <div className="space-y-2 flex-1">
              {(byStage[stage.id] || []).map((d) => {
                const stageIdx = STAGES.findIndex((s) => s.id === stage.id);
                const prev = stageIdx > 0 ? STAGES[stageIdx - 1] : null;
                const next = stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null;
                return (
                  <div key={d.id} className="p-2.5 rounded-lg border border-bs-border bg-bs-elevated space-y-1.5">
                    <p className="font-semibold text-xs text-bs-text leading-snug">{d.title}</p>
                    <p className="text-[11px] text-bs-muted truncate">{d.contactName}</p>
                    {d.phone && <p className="text-[10px] font-mono text-bs-subtle truncate">{d.phone}</p>}
                    {d.value > 0 && (
                      <p className="text-[11px] text-bs-accent font-bold">R$ {Number(d.value).toFixed(2)}</p>
                    )}
                    <div className="flex gap-1 pt-1">
                      {prev && (
                        <button
                          type="button"
                          className="text-[10px] px-1.5 py-0.5 rounded border border-bs-border text-bs-muted hover:text-bs-text disabled:opacity-50"
                          disabled={busyId === d.id}
                          onClick={() => void moveDeal(d, prev.id)}
                          title={`Voltar para ${prev.label}`}
                        >
                          ←
                        </button>
                      )}
                      {next && next.id !== 'lost' && (
                        <button
                          type="button"
                          className="flex-1 text-[10px] px-1.5 py-0.5 rounded bg-bs-accent/15 text-bs-accent font-semibold disabled:opacity-50"
                          disabled={busyId === d.id}
                          onClick={() => void moveDeal(d, next.id)}
                        >
                          Avançar
                        </button>
                      )}
                      {stage.id !== 'lost' && stage.id !== 'paid' && (
                        <button
                          type="button"
                          className="text-[10px] px-1.5 py-0.5 rounded border border-bs-border text-bs-muted hover:text-rose-600 disabled:opacity-50"
                          disabled={busyId === d.id}
                          onClick={() => void moveDeal(d, 'lost')}
                          title="Marcar como perdido"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {!(byStage[stage.id]?.length) && (
                <p className="text-[11px] text-bs-subtle py-4 text-center">Vazio</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const CrmView: React.FC<CrmViewProps> = ({ tab: controlledTab, onTabChange }) => {
  const [localTab, setLocalTab] = useState<CrmTab>('atendimento');
  const tab = controlledTab ?? localTab;
  const setTab = (next: CrmTab) => {
    onTabChange?.(next);
    if (controlledTab === undefined) setLocalTab(next);
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="bs-page-title">CRM</h2>
          <p className="bs-page-desc mt-1">
            E-commerce + WhatsApp — ajude quem não sabe comprar no site e acompanhe o funil digital.
          </p>
        </div>
        <div className="flex gap-1 p-1 rounded-lg bg-bs-elevated border border-bs-border self-start">
          <button
            type="button"
            onClick={() => setTab('atendimento')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
              tab === 'atendimento' ? 'bg-bs-shell text-bs-text shadow-sm' : 'text-bs-muted hover:text-bs-text'
            }`}
          >
            <i className="fa-solid fa-comments mr-1.5" />
            Atendimento
          </button>
          <button
            type="button"
            onClick={() => setTab('pipeline')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
              tab === 'pipeline' ? 'bg-bs-shell text-bs-text shadow-sm' : 'text-bs-muted hover:text-bs-text'
            }`}
          >
            <i className="fa-solid fa-chart-line mr-1.5" />
            Pipeline
          </button>
        </div>
      </div>

      {tab === 'atendimento' ? <InboxPanel embedded /> : <PipelineBoard />}
    </div>
  );
};

export default CrmView;
