import React, { useMemo } from 'react';
import HelpTip from './HelpTip';

type OrderLike = {
  contactName?: string;
  total?: number;
  status?: string;
};

interface TopCustomersProps {
  orders: OrderLike[];
  periodLabel?: string;
  onSelectCustomer?: (name: string) => void;
  selectedCustomer?: string | null;
}

const formatBrl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Ranking dos clientes com maior faturamento no filtro atual. */
const TopCustomers: React.FC<TopCustomersProps> = ({
  orders,
  periodLabel,
  onSelectCustomer,
  selectedCustomer,
}) => {
  const rows = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number; count: number }>();
    for (const o of orders) {
      if (/cancel/i.test(String(o.status || ''))) continue;
      const name = String(o.contactName || '').trim() || 'Sem nome';
      const cur = map.get(name) || { name, revenue: 0, count: 0 };
      cur.revenue += Number(o.total) || 0;
      cur.count += 1;
      map.set(name, cur);
    }
    return [...map.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [orders]);

  const max = Math.max(1, ...rows.map((r) => r.revenue));

  return (
    <div className="bs-card p-5 h-full">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-bs-text inline-flex items-center gap-1.5">
          Top clientes
          <HelpTip text="Quem mais comprou (em R$) no período. Clique no nome para filtrar a lista de pedidos." />
        </h3>
        <p className="text-xs text-bs-muted mt-0.5">
          {periodLabel || 'Período'} · por faturamento · excl. cancelados
        </p>
      </div>

      {!rows.length ? (
        <div className="bs-table-empty text-sm py-8">Sem pedidos neste filtro.</div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r, i) => {
            const active = selectedCustomer === r.name;
            const pct = Math.max(4, (r.revenue / max) * 100);
            return (
              <li key={r.name}>
                <button
                  type="button"
                  className={`w-full text-left rounded-lg px-2 py-1.5 transition-colors ${
                    active ? 'bg-bs-accent/10 ring-1 ring-bs-accent/30' : 'hover:bg-bs-elevated'
                  }`}
                  onClick={() => onSelectCustomer?.(active ? '' : r.name)}
                  title="Filtrar pedidos deste cliente"
                >
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <span className="w-4 tabular-nums text-bs-muted font-semibold">{i + 1}</span>
                    <span className="flex-1 truncate font-medium text-bs-text">{r.name}</span>
                    <span className="tabular-nums font-semibold text-bs-text shrink-0">
                      {formatBrl(r.revenue)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pl-6">
                    <div className="flex-1 h-1.5 rounded-full bg-bs-elevated overflow-hidden">
                      <div
                        className="h-full rounded-full bg-bs-accent/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-bs-muted tabular-nums w-10 text-right">
                      {r.count} ped.
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default TopCustomers;
