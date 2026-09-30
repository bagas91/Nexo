import React, { useMemo } from 'react';
import HelpTip from './HelpTip';

export type ChannelRow = {
  channel: string;
  channelLabel: string;
  channelName?: string;
  count: number;
  revenue: number;
  avgTicket?: number;
};

interface ChannelScorecardProps {
  rows: ChannelRow[];
  title?: string;
  selectedChannel?: string | null;
  onSelect?: (channel: string | null) => void;
}

const formatBrl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Tabela por origem (Woo / FC / Manual…) — estilo “por conta” do Power BI. */
const ChannelScorecard: React.FC<ChannelScorecardProps> = ({
  rows,
  title = 'Por origem',
  selectedChannel = null,
  onSelect,
}) => {
  const data = useMemo(() => {
    const list = [...(rows || [])].filter((r) => r.count > 0);
    const totalRev = list.reduce((s, r) => s + (r.revenue || 0), 0) || 1;
    const totalCount = list.reduce((s, r) => s + (r.count || 0), 0);
    return {
      list: list.map((r) => ({
        ...r,
        share: ((r.revenue || 0) / totalRev) * 100,
        avgTicket: r.avgTicket ?? (r.count ? r.revenue / r.count : 0),
      })),
      totalRev,
      totalCount,
      maxRev: Math.max(1, ...list.map((r) => r.revenue || 0)),
    };
  }, [rows]);

  if (!data.list.length) {
    return (
      <div className="bs-card p-5 h-full">
        <h3 className="text-sm font-bold text-bs-text">{title}</h3>
        <p className="text-xs text-bs-muted mt-2">Sem pedidos no período.</p>
      </div>
    );
  }

  return (
    <div className="bs-card p-5 h-full">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div>
          <h3 className="text-sm font-bold text-bs-text inline-flex items-center gap-1.5">
            {title}
            <HelpTip text="De onde veio a venda: site (WooCommerce), frente de caixa (loja física) ou lançamento manual no Bling." />
          </h3>
          <p className="text-[11px] text-bs-muted mt-0.5">
            {formatBrl(data.totalRev)} · {data.totalCount} pedido(s)
            {onSelect ? ' · clique para filtrar' : ''}
          </p>
        </div>
        {selectedChannel && onSelect && (
          <button type="button" className="text-[11px] bs-link-accent font-semibold" onClick={() => onSelect(null)}>
            Limpar
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-bs-muted text-left">
              <th className="pb-2 font-semibold">Origem</th>
              <th className="pb-2 font-semibold text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  Ped.
                  <HelpTip side="bottom" text="Quantidade de pedidos nessa origem." />
                </span>
              </th>
              <th className="pb-2 font-semibold text-right min-w-[7rem]">
                <span className="inline-flex items-center justify-end gap-1">
                  Fat.
                  <HelpTip side="bottom" text="Faturamento = soma em R$ dos pedidos. É o total vendido, não o lucro." />
                </span>
              </th>
              <th className="pb-2 font-semibold text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  %
                  <HelpTip side="bottom" text="Quanto essa origem representa do faturamento total do período." />
                </span>
              </th>
              <th className="pb-2 font-semibold text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  Ticket
                  <HelpTip side="bottom" text="Ticket médio = faturamento ÷ número de pedidos. Quanto o cliente gasta em média por compra." />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.list.map((r) => {
              const active = selectedChannel === r.channel;
              const barW = Math.max(4, ((r.revenue || 0) / data.maxRev) * 100);
              const rowClass = `border-t border-bs-border/60 ${
                onSelect ? 'cursor-pointer hover:bg-bs-elevated/60' : ''
              } ${active ? 'bg-bs-accent/10' : ''}`;
              return (
                <tr
                  key={r.channel}
                  className={rowClass}
                  onClick={() => onSelect?.(active ? null : r.channel)}
                  title={r.channelName || r.channelLabel}
                >
                  <td className="py-2 pr-2 font-medium text-bs-text">{r.channelLabel}</td>
                  <td className="py-2 text-right tabular-nums text-bs-muted">{r.count}</td>
                  <td className="py-2 pl-2">
                    <div className="flex flex-col items-end gap-1">
                      <span className="tabular-nums font-semibold text-bs-text">{formatBrl(r.revenue)}</span>
                      <div className="w-full max-w-[6rem] h-1 rounded-full bg-bs-elevated overflow-hidden">
                        <div className="h-full rounded-full bg-bs-accent/70" style={{ width: `${barW}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums text-bs-muted">
                    {r.share.toFixed(0)}%
                  </td>
                  <td className="py-2 text-right tabular-nums text-bs-text">
                    {formatBrl(r.avgTicket)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ChannelScorecard;
