import React from 'react';
import HelpTip from './HelpTip';

export type TodayForecast = {
  soFar: number;
  count: number;
  hoursElapsed: number;
  forecast: number;
  vsYesterdayPct: number | null;
};

interface DayForecastCardProps {
  forecast: TodayForecast | null;
  yesterdayRevenue?: number;
}

const formatBrl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Previsão do dia por run-rate (fat até agora ÷ horas × 24). */
const DayForecastCard: React.FC<DayForecastCardProps> = ({
  forecast,
  yesterdayRevenue = 0,
}) => {
  if (!forecast) {
    return (
      <div className="bs-card p-5 h-full">
        <h3 className="text-sm font-bold text-bs-text inline-flex items-center gap-1.5">
          Previsão hoje
          <HelpTip text="Estimativa de quanto o dia pode fechar, projetando o ritmo das vendas até agora para as 24 horas." />
        </h3>
        <p className="text-xs text-bs-muted mt-2">Carregando…</p>
      </div>
    );
  }

  const delta = forecast.vsYesterdayPct;
  const vsYest = yesterdayRevenue > 0
    ? forecast.forecast - yesterdayRevenue
    : null;

  return (
    <div className="bs-card p-5 h-full">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-bs-text inline-flex items-center gap-1.5">
          Previsão hoje
          <HelpTip text="Estimativa de quanto o dia pode fechar, projetando o ritmo das vendas até agora para as 24 horas. Não é garantia — só uma indicação." />
        </h3>
        <p className="text-[11px] text-bs-muted mt-0.5 inline-flex items-center gap-1">
          Run-rate · {forecast.hoursElapsed.toFixed(1).replace('.', ',')}h decorridas
          <HelpTip text="Run-rate = ritmo atual. Ex.: se em 6h vendeu R$ 300, o ritmo sugere R$ 1.200 no dia (300 ÷ 6 × 24)." />
        </p>
      </div>

      <p className="text-2xl font-bold text-bs-accent tabular-nums">
        {formatBrl(forecast.forecast)}
      </p>
      <p className="text-xs text-bs-muted mt-0.5">
        Até agora {formatBrl(forecast.soFar)} · {forecast.count} ped.
      </p>

      <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-bs-muted font-semibold inline-flex items-center gap-1">
            vs ontem (real)
            <HelpTip text="Compara o que já vendeu hoje com o total que vendeu ontem (mesmo horário ainda não — é o dia inteiro de ontem)." />
          </p>
          <p className={`font-bold tabular-nums mt-0.5 ${
            delta == null ? 'text-bs-muted'
              : delta >= 0 ? 'text-emerald-500' : 'text-rose-500'
          }`}>
            {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1).replace('.', ',')}%`}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-bs-muted font-semibold inline-flex items-center gap-1">
            Prev. vs ontem
            <HelpTip text="Se o dia seguir no ritmo atual, quanto a mais ou a menos que ontem pode fechar." />
          </p>
          <p className={`font-bold tabular-nums mt-0.5 ${
            vsYest == null ? 'text-bs-muted'
              : vsYest >= 0 ? 'text-emerald-500' : 'text-rose-500'
          }`}>
            {vsYest == null ? '—' : `${vsYest >= 0 ? '+' : ''}${formatBrl(vsYest)}`}
          </p>
        </div>
      </div>
    </div>
  );
};

export default DayForecastCard;
