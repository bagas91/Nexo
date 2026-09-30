import React, { useMemo, useState } from 'react';
import HelpTip from './HelpTip';

export type SalesPeriod = 7 | 30;

type DailyPoint = {
  date: string;
  count: number;
  revenue: number;
  prevRevenue?: number;
  prevCount?: number;
  prevDate?: string;
};

interface SalesDailyChartProps {
  daily: DailyPoint[];
  period: SalesPeriod;
  onPeriodChange?: (p: SalesPeriod) => void;
  selectedDate?: string | null;
  onDaySelect?: (date: string | null) => void;
  hidePeriodToggle?: boolean;
}

const formatBrl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const formatDay = (ymd: string) => {
  if (!ymd || ymd.length < 10) return '—';
  const [, m, d] = ymd.slice(0, 10).split('-');
  return `${d}/${m}`;
};

const SalesDailyChart: React.FC<SalesDailyChartProps> = ({
  daily,
  period,
  onPeriodChange,
  selectedDate,
  onDaySelect,
  hidePeriodToggle,
}) => {
  const [hover, setHover] = useState<number | null>(null);

  const points = useMemo(() => {
    const slice = daily.slice(-period);
    return slice.length ? slice : daily;
  }, [daily, period]);

  const maxRevenue = Math.max(
    1,
    ...points.map((p) => p.revenue || 0),
    ...points.map((p) => p.prevRevenue || 0),
  );
  const maxCount = Math.max(1, ...points.map((p) => p.count || 0));
  const totalRevenue = points.reduce((s, p) => s + (p.revenue || 0), 0);
  const totalCount = points.reduce((s, p) => s + (p.count || 0), 0);
  const avgRevenue = points.length ? totalRevenue / points.length : 0;
  const hasPrev = points.some((p) => (p.prevRevenue || 0) > 0);

  const W = 640;
  const H = 160;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 8;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = Math.max(1, points.length);
  const gap = n > 20 ? 1 : 2;
  const barW = Math.max(2, (innerW - gap * (n - 1)) / n);

  const linePoints = points
    .map((p, i) => {
      const x = padL + i * (barW + gap) + barW / 2;
      const y = padT + innerH - ((p.revenue || 0) / maxRevenue) * innerH;
      return `${x},${y}`;
    })
    .join(' ');

  const prevLinePoints = points
    .map((p, i) => {
      const x = padL + i * (barW + gap) + barW / 2;
      const y = padT + innerH - ((p.prevRevenue || 0) / maxRevenue) * innerH;
      return `${x},${y}`;
    })
    .join(' ');

  const tip = hover != null ? points[hover] : null;

  return (
    <div className="bs-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-bold text-bs-text inline-flex items-center gap-1.5">
            Faturamento diário
            <HelpTip text="Barras = quantidade de pedidos. Linha verde = faturamento do dia. Linha tracejada cinza = mesmo dia no mês passado (para comparar)." />
          </h3>
          <p className="text-xs text-bs-muted mt-0.5">
            {formatBrl(totalRevenue)} · {totalCount} pedido(s) · últimos {period} dias
          </p>
        </div>
        {onPeriodChange && !hidePeriodToggle && (
          <div className="flex rounded-lg border border-bs-border overflow-hidden text-xs">
            {([7, 30] as SalesPeriod[]).map((p) => (
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

      {selectedDate && onDaySelect && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-bs-accent/30 bg-bs-accent/5 px-3 py-2 text-xs">
          <span className="text-bs-text">
            Filtrando pedidos de <strong>{formatDay(selectedDate)}</strong>
          </span>
          <button type="button" className="bs-link-accent font-semibold" onClick={() => onDaySelect(null)}>
            Limpar
          </button>
        </div>
      )}

      <div className="relative">
        {tip && (
          <div className="absolute z-10 left-1/2 -translate-x-1/2 -top-1 pointer-events-none rounded-lg border border-bs-border bg-bs-surface px-3 py-2 shadow-card text-xs whitespace-nowrap">
            <p className="font-semibold text-bs-text">{formatDay(tip.date)}</p>
            <p className="text-bs-accent tabular-nums">{formatBrl(tip.revenue)}</p>
            <p className="text-bs-muted">{tip.count} pedido(s)</p>
            {hasPrev && (
              <p className="text-bs-muted mt-1">
                Mês ant.{tip.prevDate ? ` (${formatDay(tip.prevDate)})` : ''}:{' '}
                <span className="tabular-nums">{formatBrl(tip.prevRevenue || 0)}</span>
              </p>
            )}
          </div>
        )}

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-40"
          preserveAspectRatio="none"
          role="img"
          aria-label="Gráfico de faturamento diário"
        >
          {[0.25, 0.5, 0.75].map((f) => {
            const y = padT + innerH * (1 - f);
            return (
              <line
                key={f}
                x1={padL}
                x2={W - padR}
                y1={y}
                y2={y}
                stroke="var(--bs-border)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            );
          })}

          {avgRevenue > 0 && (
            <line
              x1={padL}
              x2={W - padR}
              y1={padT + innerH - (avgRevenue / maxRevenue) * innerH}
              y2={padT + innerH - (avgRevenue / maxRevenue) * innerH}
              stroke="var(--bs-muted)"
              strokeWidth="1.5"
              strokeDasharray="6 4"
              opacity="0.7"
            >
              <title>{`Média: ${formatBrl(avgRevenue)}`}</title>
            </line>
          )}

          {points.map((p, i) => {
            const x = padL + i * (barW + gap);
            const barH = Math.max(2, ((p.count || 0) / maxCount) * innerH * 0.85);
            const y = padT + innerH - barH;
            const active = hover === i || selectedDate === p.date;
            return (
              <rect
                key={p.date}
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={2}
                fill={active ? 'var(--bs-accent)' : 'color-mix(in srgb, var(--bs-accent) 45%, transparent)'}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  if (!onDaySelect) return;
                  onDaySelect(selectedDate === p.date ? null : p.date);
                }}
                className="cursor-pointer"
              />
            );
          })}

          {hasPrev && (
            <polyline
              points={prevLinePoints}
              fill="none"
              stroke="var(--bs-muted)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
              opacity="0.85"
            />
          )}

          <polyline
            points={linePoints}
            fill="none"
            stroke="var(--bs-accent)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {points.map((p, i) => {
            const x = padL + i * (barW + gap) + barW / 2;
            const y = padT + innerH - ((p.revenue || 0) / maxRevenue) * innerH;
            return (
              <circle
                key={`d-${p.date}`}
                cx={x}
                cy={y}
                r={hover === i ? 4 : 2.5}
                fill="var(--bs-surface)"
                stroke="var(--bs-accent)"
                strokeWidth="2"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer"
              />
            );
          })}
        </svg>

        <div className="flex justify-between mt-1 text-[10px] text-bs-muted">
          <span>{formatDay(points[0]?.date || '')}</span>
          <span className="flex items-center gap-3 flex-wrap justify-center">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-bs-accent/50" /> pedidos
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-0.5 bg-bs-accent" /> faturamento
            </span>
            {hasPrev && (
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-0.5 border-t border-dashed border-bs-muted" /> mês ant.
              </span>
            )}
            {avgRevenue > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-0.5 border-t border-dashed border-bs-muted opacity-50" /> média
              </span>
            )}
          </span>
          <span>{formatDay(points[points.length - 1]?.date || '')}</span>
        </div>
      </div>
    </div>
  );
};

export default SalesDailyChart;
