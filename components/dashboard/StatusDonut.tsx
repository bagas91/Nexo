import React, { useMemo } from 'react';

type StatusRow = { status: string; count: number; revenue: number };

interface StatusDonutProps {
  rows: StatusRow[];
  title?: string;
  selectedStatus?: string | null;
  onStatusSelect?: (status: string | null) => void;
}

const COLORS = [
  '#3FB57A',
  '#E9A820',
  '#94A3B8',
  '#0065F9',
  '#FF7835',
  '#A855F7',
  '#14B8A6',
  '#F43F5E',
];

function colorForStatus(status: string, index: number): string {
  const s = String(status || '').toLowerCase();
  if (/atendid|conclu|pago|entreg/.test(s)) return '#3FB57A';
  if (/cancel/.test(s)) return '#94A3B8';
  if (/aberto|digit|etiqueta|aguard|devolu/.test(s)) return '#E9A820';
  if (/andamento|atendiment/.test(s)) return '#0065F9';
  // canais / origem
  if (/woo|site/.test(s)) return '#0065F9';
  if (/frente|caixa/.test(s)) return '#E9A820';
  if (/manual/.test(s)) return '#64748B';
  if (/tiktok/.test(s)) return '#F43F5E';
  if (/mercado/.test(s)) return '#FF7835';
  return COLORS[index % COLORS.length];
}

const formatBrl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const StatusDonut: React.FC<StatusDonutProps> = ({
  rows,
  title = 'Pedidos por status (30d)',
  selectedStatus = null,
  onStatusSelect,
}) => {
  const data = useMemo(() => {
    const list = [...rows].filter((r) => r.count > 0).slice(0, 8);
    const total = list.reduce((s, r) => s + r.count, 0) || 1;
    let angle = -Math.PI / 2;
    const slices = list.map((row, i) => {
      const frac = row.count / total;
      const start = angle;
      const end = angle + frac * Math.PI * 2;
      angle = end;
      const large = end - start > Math.PI ? 1 : 0;
      const r = 42;
      const cx = 50;
      const cy = 50;
      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const d = [
        `M ${cx} ${cy}`,
        `L ${x1} ${y1}`,
        `A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
        'Z',
      ].join(' ');
      return {
        ...row,
        frac,
        d,
        color: colorForStatus(row.status, i),
      };
    });
    return { slices, total: list.reduce((s, r) => s + r.count, 0) };
  }, [rows]);

  const toggle = (status: string) => {
    if (!onStatusSelect) return;
    onStatusSelect(selectedStatus === status ? null : status);
  };

  if (!data.slices.length) {
    return (
      <div className="bs-table-wrap">
        <div className="bs-table-toolbar">
          <h3 className="font-bold text-bs-text text-sm">{title}</h3>
        </div>
        <div className="bs-table-empty text-sm">Sem dados de status ainda.</div>
      </div>
    );
  }

  return (
    <div className="bs-card p-5 h-full">
      <div className="flex items-start justify-between gap-2 mb-4">
        <h3 className="text-sm font-bold text-bs-text">{title}</h3>
        {selectedStatus && onStatusSelect && (
          <button type="button" className="text-[11px] bs-link-accent font-semibold shrink-0" onClick={() => onStatusSelect(null)}>
            Limpar
          </button>
        )}
      </div>
      <div className="flex flex-col sm:flex-row items-center gap-5">
        <div className="relative shrink-0">
          <svg viewBox="0 0 100 100" className="w-36 h-36">
            {data.slices.length === 1 ? (
              <circle
                cx="50"
                cy="50"
                r="42"
                fill={data.slices[0].color}
                className={onStatusSelect ? 'cursor-pointer' : undefined}
                onClick={() => toggle(data.slices[0].status)}
              />
            ) : (
              data.slices.map((s) => {
                const dimmed = selectedStatus && selectedStatus !== s.status;
                return (
                  <path
                    key={s.status}
                    d={s.d}
                    fill={s.color}
                    opacity={dimmed ? 0.35 : 1}
                    stroke="var(--bs-surface)"
                    strokeWidth="1.5"
                    className={onStatusSelect ? 'cursor-pointer' : undefined}
                    onClick={() => toggle(s.status)}
                  >
                    <title>{`${s.status}: ${s.count}`}</title>
                  </path>
                );
              })
            )}
            <circle cx="50" cy="50" r="26" fill="var(--bs-surface)" />
            <text
              x="50"
              y="48"
              textAnchor="middle"
              className="fill-bs-text"
              style={{ fontSize: '14px', fontWeight: 700 }}
            >
              {data.total}
            </text>
            <text
              x="50"
              y="60"
              textAnchor="middle"
              className="fill-bs-muted"
              style={{ fontSize: '6px' }}
            >
              pedidos
            </text>
          </svg>
        </div>
        <ul className="flex-1 w-full space-y-2 min-w-0">
          {data.slices.map((s) => {
            const active = selectedStatus === s.status;
            return (
              <li key={s.status}>
                <button
                  type="button"
                  onClick={() => toggle(s.status)}
                  disabled={!onStatusSelect}
                  className={`w-full flex items-center gap-2 text-xs rounded-md px-1.5 py-1 transition-colors text-left ${
                    onStatusSelect ? 'hover:bg-bs-hover cursor-pointer' : ''
                  } ${active ? 'bg-bs-accent/10 ring-1 ring-bs-accent/30' : ''}`}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="flex-1 truncate text-bs-text font-medium">{s.status}</span>
                  <span className="tabular-nums text-bs-muted">{s.count}</span>
                  <span className="tabular-nums font-semibold text-bs-text w-[5.5rem] text-right">
                    {formatBrl(s.revenue)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {onStatusSelect && (
        <p className="text-[10px] text-bs-muted mt-3">Clique no status para filtrar a lista de pedidos.</p>
      )}
    </div>
  );
};

export default StatusDonut;
