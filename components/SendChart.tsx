import React, { useMemo } from 'react';
import { HistoryEntry } from '../types';

export type ChartPeriod = 7 | 30;

interface SendChartProps {
  history: HistoryEntry[];
  period: ChartPeriod;
}

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatLabel(key: string) {
  const [, m, d] = key.split('-');
  return `${d}/${m}`;
}

const SendChart: React.FC<SendChartProps> = ({ history, period }) => {
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
    <div className="bs-card p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="font-bold text-bs-text">Envios por dia</h3>
          <p className="text-xs text-bs-muted">Últimos {period} dias · {total} envio(s) no período</p>
        </div>
      </div>
      <div className="flex items-end gap-1 sm:gap-2 h-32">
        {bars.map((b) => (
          <div key={b.key} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <span className="text-[10px] text-bs-subtle tabular-nums">{b.count || ''}</span>
            <div
              className="w-full rounded-t-md bg-bs-accent/80 min-h-[4px] transition-all"
              style={{ height: `${Math.max(4, (b.count / max) * 100)}%`, maxHeight: '100%' }}
              title={`${formatLabel(b.key)}: ${b.count}`}
            />
            <span className="text-[9px] text-bs-subtle truncate w-full text-center">{formatLabel(b.key)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SendChart;
