import React, { useMemo } from 'react';
import HelpTip from './HelpTip';

type DailyPoint = { date: string; count: number; revenue: number };

interface PeriodCompareProps {
  daily: DailyPoint[];
  /** Tamanho de cada metade (ex.: 7 → últimos 7 vs 7 anteriores). */
  half: 7 | 15;
}

const formatBrl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const formatDay = (ymd: string) => {
  if (!ymd || ymd.length < 10) return '—';
  const [, m, d] = ymd.slice(0, 10).split('-');
  return `${d}/${m}`;
};

/** Barras lado a lado: período atual vs período imediatamente anterior. */
const PeriodCompare: React.FC<PeriodCompareProps> = ({ daily, half }) => {
  const data = useMemo(() => {
    if (daily.length < half * 2) return null;
    const current = daily.slice(-half);
    const previous = daily.slice(-(half * 2), -half);
    const sum = (rows: DailyPoint[]) => ({
      revenue: rows.reduce((s, d) => s + (d.revenue || 0), 0),
      count: rows.reduce((s, d) => s + (d.count || 0), 0),
      from: rows[0]?.date || '',
      to: rows[rows.length - 1]?.date || '',
    });
    const cur = sum(current);
    const prev = sum(previous);
    const delta = prev.revenue === 0
      ? (cur.revenue === 0 ? 0 : null)
      : ((cur.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100;
    const max = Math.max(1, cur.revenue, prev.revenue);
    return { cur, prev, delta, max, current, previous };
  }, [daily, half]);

  if (!data) {
    return (
      <div className="bs-card p-5 h-full">
        <h3 className="text-sm font-bold text-bs-text">Comparativo {half}d</h3>
        <p className="text-xs text-bs-muted mt-2">Dados insuficientes (precisa de {half * 2} dias).</p>
      </div>
    );
  }

  const { cur, prev, delta, max } = data;
  const up = delta != null && delta > 0.5;
  const down = delta != null && delta < -0.5;

  return (
    <div className="bs-card p-5 h-full">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div>
          <h3 className="text-sm font-bold text-bs-text inline-flex items-center gap-1.5">
            Comparativo {half}d
            <HelpTip text={`Compara os últimos ${half} dias com os ${half} dias imediatamente anteriores. Mostra se as vendas aceleraram ou caíram.`} />
          </h3>
          <p className="text-xs text-bs-muted mt-0.5">
            Atual vs {half} dias anteriores
          </p>
        </div>
        {delta != null && (
          <span
            className={`text-xs font-semibold tabular-nums ${
              up ? 'text-emerald-600 dark:text-emerald-400'
                : down ? 'text-rose-600 dark:text-rose-400'
                  : 'text-bs-muted'
            }`}
          >
            {up && <i className="fa-solid fa-arrow-up mr-1 text-[9px]" />}
            {down && <i className="fa-solid fa-arrow-down mr-1 text-[9px]" />}
            {delta === 0 ? '0%' : `${up ? '+' : ''}${delta.toFixed(0)}%`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 items-end">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-bs-muted font-semibold mb-1">Anterior</p>
          <p className="text-lg font-bold text-bs-text tabular-nums">{formatBrl(prev.revenue)}</p>
          <p className="text-[11px] text-bs-muted mt-0.5">{prev.count} ped. · {formatDay(prev.from)}–{formatDay(prev.to)}</p>
          <div className="mt-3 h-24 flex items-end">
            <div
              className="w-full rounded-t-md bg-slate-400/35 dark:bg-slate-500/40 shrink-0"
              style={{ height: Math.max(8, Math.round((prev.revenue / max) * 96)) }}
              title={formatBrl(prev.revenue)}
            />
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-bs-muted font-semibold mb-1">Atual</p>
          <p className="text-lg font-bold text-bs-accent tabular-nums">{formatBrl(cur.revenue)}</p>
          <p className="text-[11px] text-bs-muted mt-0.5">{cur.count} ped. · {formatDay(cur.from)}–{formatDay(cur.to)}</p>
          <div className="mt-3 h-24 flex items-end">
            <div
              className="w-full rounded-t-md bg-bs-accent shrink-0"
              style={{ height: Math.max(8, Math.round((cur.revenue / max) * 96)) }}
              title={formatBrl(cur.revenue)}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PeriodCompare;
