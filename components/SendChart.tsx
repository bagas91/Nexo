import React, { useMemo } from 'react';
import { HistoryEntry } from '../types';

export type ChartPeriod = 7 | 30;

interface SendChartProps {
  history: HistoryEntry[];
  period: ChartPeriod;
  onPeriodChange?: (p: ChartPeriod) => void;
}

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatLabel(key: string) {
  const [, m, d] = key.split('-');
  return `${d}/${m}`;
}

const SendChart: React.FC<SendChartProps> = ({ history, period, onPeriodChange }) => {
  const { bars, max, total } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const keys: string[] = [];
    for (let i = period - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      keys.push(dayKey(d.getTime()));
    }
    const counts = new Map<string, number>();
    keys.forEach((k) => counts.set(k, 0));
    history.forEach((h) => {
      const k = dayKey(h.timestamp);
      if (counts.has(k)) counts.set(k, (counts.get(k) || 0) + 1);
    });
    const bars = keys.map((k) => ({ key: k, count: counts.get(k) || 0 }));
    const max = Math.max(1, ...bars.map((b) => b.count));
    const total = bars.reduce((s, b) => s + b.count, 0);
    return { bars, max, total };
  }, [history, period]);

  return (
    <div className="bs-card p-5 h-full">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-bold text-bs-text">Envios WhatsApp</h3>
          <p className="text-xs text-bs-muted mt-0.5">
            Últimos {period} dias · {total} envio(s)
          </p>
        </div>
        {onPeriodChange && (
          <div className="flex rounded-lg border border-bs-border overflow-hidden text-xs">
            {([7, 30] as ChartPeriod[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onPeriodChange(p)}
                className={`px-3 py-1.5 font-semibold transition-colors ${
                  period === p
                    ? 'bg-bs-accent text-white'
                    : 'bg-bs-elevated text-bs-muted hover:text-bs-text'
                }`}
              >
                {p}d
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-end gap-0.5 sm:gap-1 h-32">
        {bars.map((b) => {
          // altura em px — % em flex-col colapsa e deixa o gráfico “flat”
          const barH = b.count > 0 ? Math.max(4, Math.round((b.count / max) * 100)) : 2;
          return (
            <div key={b.key} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0 h-full">
              <span className="text-[9px] text-bs-subtle tabular-nums h-3 shrink-0">
                {b.count > 0 ? b.count : ''}
              </span>
              <div
                className="w-full rounded-t-md bg-emerald-500/80 transition-all hover:bg-emerald-500 shrink-0"
                style={{ height: barH }}
                title={`${formatLabel(b.key)}: ${b.count}`}
              />
              {period <= 7 && (
                <span className="text-[9px] text-bs-subtle truncate w-full text-center shrink-0">
                  {formatLabel(b.key)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {period > 7 && (
        <div className="flex justify-between mt-2 text-[10px] text-bs-muted">
          <span>{formatLabel(bars[0]?.key || '')}</span>
          <span>{formatLabel(bars[bars.length - 1]?.key || '')}</span>
        </div>
      )}
    </div>
  );
};

export default SendChart;
