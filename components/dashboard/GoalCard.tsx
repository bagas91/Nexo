import React, { useState } from 'react';
import HelpTip from './HelpTip';

export type SalesGoal = {
  monthlyGoal: number;
  achieved: number;
  achievedPct: number;
  expectedPct: number;
  expectedRevenue: number;
  gapVsExpected: number;
  gapVsGoal: number;
  pacePerDay: number;
  daysRemaining: number;
  dayOfMonth: number;
  daysInMonth: number;
};

interface GoalCardProps {
  goal: SalesGoal | null;
  prevMonthRevenue?: number;
  onSaveGoal: (monthlyGoal: number) => Promise<void>;
}

const formatBrl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Meta do mês: % alcançado vs % esperado + ritmo/dia. */
const GoalCard: React.FC<GoalCardProps> = ({ goal, prevMonthRevenue = 0, onSaveGoal }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setDraft(goal?.monthlyGoal ? String(Math.round(goal.monthlyGoal)) : '');
    setEditing(true);
  };

  const save = async () => {
    const raw = draft.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
    const n = Math.max(0, Math.round(Number(raw) || 0));
    setBusy(true);
    try {
      await onSaveGoal(n);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (!goal) {
    return (
      <div className="bs-card p-5 h-full">
        <h3 className="text-sm font-bold text-bs-text inline-flex items-center gap-1.5">
          Meta do mês
          <HelpTip text="Valor de faturamento que você quer atingir neste mês. Serve para saber se as vendas estão no ritmo certo." />
        </h3>
        <p className="text-xs text-bs-muted mt-2">Carregando…</p>
      </div>
    );
  }

  const hasGoal = goal.monthlyGoal > 0;
  const behind = hasGoal && goal.achievedPct + 0.5 < goal.expectedPct;
  const ahead = hasGoal && goal.achievedPct > goal.expectedPct + 0.5;
  const barPct = hasGoal ? Math.min(100, Math.max(0, goal.achievedPct)) : 0;
  const expectedMark = Math.min(100, Math.max(0, goal.expectedPct));
  const mom = prevMonthRevenue > 0
    ? ((goal.achieved - prevMonthRevenue) / prevMonthRevenue) * 100
    : null;

  return (
    <div className="bs-card p-5 h-full">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-bold text-bs-text inline-flex items-center gap-1.5">
            Meta do mês
            <HelpTip text="Valor de faturamento que você quer atingir neste mês. Serve para saber se as vendas estão no ritmo certo." />
          </h3>
          <p className="text-[11px] text-bs-muted mt-0.5">
            Dia {goal.dayOfMonth}/{goal.daysInMonth}
            {goal.daysRemaining > 0 ? ` · ${goal.daysRemaining} dia(s) restantes` : ' · fim do mês'}
          </p>
        </div>
        {!editing && (
          <button type="button" className="text-[11px] bs-link-accent font-semibold shrink-0" onClick={startEdit}>
            {hasGoal ? 'Editar' : 'Definir'}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <label className="block text-[11px] text-bs-muted font-semibold">Meta (R$)</label>
          <input
            type="text"
            inputMode="numeric"
            className="bs-input text-sm w-full"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ex: 50000"
            autoFocus
          />
          <div className="flex gap-2">
            <button type="button" className="bs-btn text-xs py-1.5 px-3" disabled={busy} onClick={() => void save()}>
              Salvar
            </button>
            <button
              type="button"
              className="bs-btn-secondary text-xs py-1.5 px-3"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : !hasGoal ? (
        <p className="text-xs text-bs-muted">
          Defina uma meta mensal para acompanhar o ritmo.
        </p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-2">
            <p className="text-2xl font-bold text-bs-text tabular-nums inline-flex items-center gap-1.5">
              {goal.achievedPct.toFixed(1).replace('.', ',')}%
              <HelpTip
                side="bottom"
                text="% do faturamento do mês em relação à meta. Ex.: meta R$ 50 mil e vendeu R$ 25 mil = 50%."
              />
            </p>
            <p className="text-xs text-bs-muted tabular-nums text-right">
              de {formatBrl(goal.monthlyGoal)}
            </p>
          </div>
          <p className="text-xs text-bs-muted mt-0.5 tabular-nums">
            {formatBrl(goal.achieved)} realizado
          </p>

          <div className="relative mt-3 h-2.5 rounded-full bg-bs-elevated overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                behind ? 'bg-rose-500/80' : ahead ? 'bg-emerald-500/80' : 'bg-bs-accent'
              }`}
              style={{ width: `${barPct}%` }}
            />
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-bs-text/70"
              style={{ left: `${expectedMark}%` }}
              title={`Esperado: ${goal.expectedPct.toFixed(1)}%`}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-bs-muted">
            <span className="inline-flex items-center gap-1">
              Esperado {goal.expectedPct.toFixed(1).replace('.', ',')}%
              <HelpTip text="Se a meta for linear no mês, quanto % você já deveria ter batido hoje. Ex.: dia 15 de um mês com 30 dias ≈ 50%." />
            </span>
            <span className={behind ? 'text-rose-500' : ahead ? 'text-emerald-500' : ''}>
              {behind ? 'Abaixo do ritmo' : ahead ? 'Acima do ritmo' : 'No ritmo'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-bs-muted font-semibold inline-flex items-center gap-1">
                Gap vs esperado
                <HelpTip text="Diferença entre o que já vendeu e o que deveria ter vendido até hoje para estar no ritmo da meta. Negativo = atrasado." />
              </p>
              <p className={`font-bold tabular-nums mt-0.5 ${
                goal.gapVsExpected < 0 ? 'text-rose-500' : 'text-emerald-500'
              }`}>
                {goal.gapVsExpected >= 0 ? '+' : ''}{formatBrl(goal.gapVsExpected)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-bs-muted font-semibold inline-flex items-center gap-1">
                Ritmo / dia
                <HelpTip text="Quanto precisa faturar por dia, em média, nos dias que faltam para bater a meta do mês." />
              </p>
              <p className="font-bold text-bs-text tabular-nums mt-0.5">
                {goal.daysRemaining > 0 ? formatBrl(goal.pacePerDay) : '—'}
              </p>
            </div>
          </div>

          {mom != null && (
            <p className="text-[11px] text-bs-muted mt-3 inline-flex items-center gap-1 flex-wrap">
              vs mês passado:{' '}
              <span className={`font-semibold tabular-nums ${mom >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {mom >= 0 ? '+' : ''}{mom.toFixed(1).replace('.', ',')}%
              </span>
              {' '}({formatBrl(prevMonthRevenue)})
              <HelpTip text="Compara o faturamento deste mês (até agora) com o mês anterior inteiro." />
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default GoalCard;
