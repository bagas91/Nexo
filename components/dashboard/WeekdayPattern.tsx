import React, { useMemo } from 'react';
import HelpTip from './HelpTip';

type DailyPoint = { date: string; count: number; revenue: number };

interface WeekdayPatternProps {
  daily: DailyPoint[];
  period: number;
}

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;
const BAR_MAX_PX = 100;

const formatBrl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** Agrega faturamento médio por dia da semana (Dom–Sáb). */
const WeekdayPattern: React.FC<WeekdayPatternProps> = ({ daily, period }) => {
  const { bars, max, bestIdx } = useMemo(() => {
    const slice = daily.slice(-period);
    const buckets = DAYS.map(() => ({ revenue: 0, count: 0, days: 0 }));
    for (const p of slice) {
      if (!p.date || p.date.length < 10) continue;
      const [y, m, d] = p.date.split('-').map(Number);
      const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      buckets[wd].revenue += p.revenue || 0;
      buckets[wd].count += p.count || 0;
      buckets[wd].days += 1;
    }
    const bars = buckets.map((b, i) => ({
      label: DAYS[i],
      avg: b.days ? b.revenue / b.days : 0,
      revenue: b.revenue,
      count: b.count,
      days: b.days,
    }));
    const max = Math.max(1, ...bars.map((b) => b.avg));
    let bestIdx = 0;
    bars.forEach((b, i) => {
      if (b.avg > bars[bestIdx].avg) bestIdx = i;
    });
    return { bars, max, bestIdx };
  }, [daily, period]);

  const hasData = bars.some((b) => b.revenue > 0);

  return (
    <div className="bs-card p-5 h-full">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-bs-text inline-flex items-center gap-1.5">
          Padrão por dia da semana
          <HelpTip text="Média de faturamento em cada dia da semana (seg, ter…). Ajuda a ver qual dia costuma vender mais." />
        </h3>
        <p className="text-xs text-bs-muted mt-0.5">
          Média diária de faturamento · últimos {period} dias
        </p>
      </div>

      {!hasData ? (
        <div className="bs-table-empty text-sm py-8">Sem dados no período.</div>
      ) : (
        <div className="flex items-end gap-1.5 h-36">
          {bars.map((b, i) => {
            const barH = b.avg > 0
              ? Math.max(6, Math.round((b.avg / max) * BAR_MAX_PX))
              : 2;
            const best = i === bestIdx && b.avg > 0;
            return (
              <div
                key={b.label}
                className="flex-1 flex flex-col items-center justify-end gap-1.5 min-w-0 h-full"
              >
                <span
                  className="text-[9px] tabular-nums text-bs-muted truncate w-full text-center shrink-0"
                  title={formatBrl(b.avg)}
                >
                  {b.avg > 0 ? formatBrl(b.avg) : '—'}
                </span>
                <div
                  className={`w-full max-w-[2.5rem] mx-auto rounded-t-md transition-all shrink-0 ${
                    best ? 'bg-bs-accent' : 'bg-bs-accent/40'
                  }`}
                  style={{ height: barH }}
                  title={`${b.label}: ${formatBrl(b.avg)}/dia · ${b.count} ped. · ${b.days} dia(s)`}
                />
                <span className={`text-[10px] font-semibold shrink-0 ${best ? 'text-bs-accent' : 'text-bs-muted'}`}>
                  {b.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WeekdayPattern;
