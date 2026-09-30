import React, { useMemo } from 'react';
import HelpTip from './HelpTip';

type OrderLike = { total?: number; totalLabel?: string; status?: string };

export type TicketBucketKey = '0-50' | '50-100' | '100-200' | '200-400' | '400+';

export const TICKET_BUCKETS: Array<{
  key: TicketBucketKey;
  min: number;
  max: number;
  label: string;
}> = [
  { key: '0-50', min: 0, max: 50, label: 'Até R$ 50' },
  { key: '50-100', min: 50, max: 100, label: 'R$ 50–100' },
  { key: '100-200', min: 100, max: 200, label: 'R$ 100–200' },
  { key: '200-400', min: 200, max: 400, label: 'R$ 200–400' },
  { key: '400+', min: 400, max: Infinity, label: 'R$ 400+' },
];

interface TicketDistributionProps {
  orders: OrderLike[];
  periodLabel?: string;
  selectedBucket?: TicketBucketKey | null;
  onBucketSelect?: (key: TicketBucketKey | null) => void;
}

export function parseOrderTotal(o: OrderLike): number {
  if (typeof o.total === 'number' && Number.isFinite(o.total)) return o.total;
  const raw = String(o.totalLabel || '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function orderInTicketBucket(total: number, key: TicketBucketKey): boolean {
  const b = TICKET_BUCKETS.find((x) => x.key === key);
  if (!b) return true;
  return total >= b.min && total < b.max;
}

const TicketDistribution: React.FC<TicketDistributionProps> = ({
  orders,
  periodLabel,
  selectedBucket = null,
  onBucketSelect,
}) => {
  const { bars, max, total, median, avg } = useMemo(() => {
    const values = orders
      .filter((o) => !/cancel/i.test(String((o as { status?: string }).status || '')))
      .map(parseOrderTotal)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const counts = TICKET_BUCKETS.map((b) => ({
      ...b,
      count: values.filter((v) => v >= b.min && v < b.max).length,
    }));
    const max = Math.max(1, ...counts.map((c) => c.count));
    const sum = values.reduce((s, v) => s + v, 0);
    const mid = values.length ? values[Math.floor((values.length - 1) / 2)] : 0;
    return {
      bars: counts,
      max,
      total: values.length,
      median: mid,
      avg: values.length ? sum / values.length : 0,
    };
  }, [orders]);

  const formatBrl = (n: number) =>
    n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="bs-card p-5 h-full">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-bold text-bs-text inline-flex items-center gap-1.5">
            Distribuição de ticket
            <HelpTip text="Ticket = valor de cada pedido. Este bloco mostra em que faixa de preço a maioria das compras cai (barato, médio, alto)." />
          </h3>
          <p className="text-xs text-bs-muted mt-0.5">
            {periodLabel || 'Período'} · {total} pedido(s) com valor · excl. cancelados
            {onBucketSelect ? ' · clique para filtrar' : ''}
          </p>
        </div>
        <div className="text-right text-[11px] text-bs-muted leading-relaxed">
          <div className="inline-flex items-center gap-1">
            Média <span className="font-semibold text-bs-text tabular-nums">{formatBrl(avg)}</span>
            <HelpTip text="Média = some todos os valores e divida pela quantidade. Um pedido muito caro puxa a média para cima." />
          </div>
          <div className="inline-flex items-center gap-1 justify-end">
            Mediana <span className="font-semibold text-bs-text tabular-nums">{formatBrl(median)}</span>
            <HelpTip text="Mediana = valor do meio da lista. Metade dos pedidos ficou abaixo e metade acima. Costuma representar melhor o “pedido típico”." />
          </div>
        </div>
      </div>

      {!total ? (
        <div className="bs-table-empty text-sm py-8">Sem valores neste filtro.</div>
      ) : (
        <div className="space-y-2.5">
          {bars.map((b) => {
            const pct = total ? Math.round((b.count / total) * 100) : 0;
            const active = selectedBucket === b.key;
            const className = `grid grid-cols-[7rem_1fr_auto] items-center gap-2 text-xs w-full text-left rounded-md px-1 py-0.5 -mx-1 transition-colors ${
              onBucketSelect ? 'hover:bg-bs-elevated cursor-pointer' : ''
            } ${active ? 'bg-bs-accent/10 ring-1 ring-bs-accent/30' : ''}`;
            const inner = (
              <>
                <span className={`truncate ${active ? 'text-bs-accent font-semibold' : 'text-bs-muted'}`}>
                  {b.label}
                </span>
                <div className="h-2.5 rounded-full bg-bs-elevated overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${active ? 'bg-bs-accent' : 'bg-bs-accent/80'}`}
                    style={{ width: `${Math.max(b.count ? 4 : 0, (b.count / max) * 100)}%` }}
                    title={`${b.count} · ${pct}%`}
                  />
                </div>
                <span className="tabular-nums text-bs-text font-semibold w-14 text-right">
                  {b.count}
                  <span className="text-bs-muted font-normal ml-1">{pct}%</span>
                </span>
              </>
            );
            if (onBucketSelect) {
              return (
                <button
                  key={b.key}
                  type="button"
                  className={className}
                  onClick={() => onBucketSelect(active ? null : b.key)}
                >
                  {inner}
                </button>
              );
            }
            return (
              <div key={b.key} className={className}>
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TicketDistribution;
