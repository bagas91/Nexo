import React, { useMemo, useState } from 'react';
import HelpTip from './HelpTip';

export type TopProductRow = {
  name: string;
  codigo?: string | null;
  qty: number;
  revenue: number;
  orders: number;
};

type SortMode = 'revenue' | 'qty' | 'orders';

interface TopProductsProps {
  products: TopProductRow[];
  sampled?: number;
  periodLabel?: string;
}

const formatBrl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const MODE_LABEL: Record<SortMode, string> = {
  revenue: 'Fat.',
  qty: 'Un.',
  orders: 'Ped.',
};

/** Ranking de produtos (amostra de detalhes Bling). */
const TopProducts: React.FC<TopProductsProps> = ({
  products,
  sampled = 0,
  periodLabel,
}) => {
  const [mode, setMode] = useState<SortMode>('revenue');

  const rows = useMemo(() => {
    const list = [...(products || [])];
    list.sort((a, b) => {
      if (mode === 'qty') return (b.qty || 0) - (a.qty || 0) || (b.revenue || 0) - (a.revenue || 0);
      if (mode === 'orders') return (b.orders || 0) - (a.orders || 0) || (b.revenue || 0) - (a.revenue || 0);
      return (b.revenue || 0) - (a.revenue || 0) || (b.qty || 0) - (a.qty || 0);
    });
    return list.slice(0, 8);
  }, [products, mode]);

  const max = Math.max(
    1,
    ...rows.map((r) => (mode === 'qty' ? r.qty : mode === 'orders' ? r.orders : r.revenue) || 0),
  );

  return (
    <div className="bs-card p-5 h-full">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div>
          <h3 className="text-sm font-bold text-bs-text inline-flex items-center gap-1.5">
            Top produtos
            <HelpTip text="Produtos que mais vendem no período. Amostra dos pedidos mais relevantes do Bling (não é 100% dos itens)." />
          </h3>
          <p className="text-xs text-bs-muted mt-0.5">
            {periodLabel || '30 dias'}
            {sampled ? ` · amostra ${sampled} pedido(s)` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <HelpTip text="Fat. = faturamento (R$). Un. = unidades vendidas. Ped. = em quantos pedidos o produto apareceu." />
          <div className="flex rounded-lg border border-bs-border overflow-hidden text-[10px]">
            {(['revenue', 'qty', 'orders'] as SortMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2 py-1 font-semibold transition-colors ${
                  mode === m
                    ? 'bg-bs-accent text-white'
                    : 'bg-bs-elevated text-bs-muted hover:text-bs-text'
                }`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!rows.length ? (
        <div className="bs-table-empty text-sm py-8">
          Sem itens na amostra ainda. Clique em Atualizar.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r, i) => {
            const metric = mode === 'qty' ? r.qty : mode === 'orders' ? r.orders : r.revenue;
            const pct = Math.max(4, ((metric || 0) / max) * 100);
            return (
              <li key={`${r.codigo || r.name}-${i}`} className="px-1">
                <div className="flex items-center gap-2 text-xs mb-1">
                  <span className="w-4 tabular-nums text-bs-muted font-semibold">{i + 1}</span>
                  <span className="flex-1 truncate font-medium text-bs-text" title={r.name}>
                    {r.name}
                  </span>
                  <span className="tabular-nums font-semibold text-bs-text shrink-0">
                    {mode === 'revenue' ? formatBrl(r.revenue || 0) : metric}
                  </span>
                </div>
                <div className="flex items-center gap-2 pl-6">
                  <div className="flex-1 h-1.5 rounded-full bg-bs-elevated overflow-hidden">
                    <div
                      className="h-full rounded-full bg-bs-accent/70"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-bs-muted tabular-nums shrink-0">
                    {r.qty} un · {r.orders} ped.
                    {mode !== 'revenue' ? ` · ${formatBrl(r.revenue || 0)}` : ''}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default TopProducts;
