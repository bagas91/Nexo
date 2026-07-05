import React, { useMemo, useState } from 'react';
import { ScheduledMessage, View } from '../types';

interface ScheduleCalendarViewProps {
  schedules: ScheduledMessage[];
  onNavigate?: (view: View) => void;
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const ScheduleCalendarView: React.FC<ScheduleCalendarViewProps> = ({ schedules, onNavigate }) => {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduledMessage[]>();
    schedules.forEach((s) => {
      if (!s.scheduledAt) return;
      const d = new Date(s.scheduledAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [schedules]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const prevMonth = () => setCursor(new Date(year, month - 1, 1));
  const nextMonth = () => setCursor(new Date(year, month + 1, 1));
  const todayKey = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  })();

  const selectedItems = selectedDay ? byDay.get(selectedDay) || [] : [];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="bs-page-title">Calendário</h2>
          <p className="bs-page-desc mt-1">Visão mensal dos agendamentos — clique no dia para detalhes.</p>
        </div>
        {onNavigate && (
          <button type="button" onClick={() => onNavigate('scheduler')} className="bs-btn px-4 py-2 text-sm shrink-0">
            <i className="fa-solid fa-plus mr-2" />
            Novo agendamento
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bs-card p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <button type="button" onClick={prevMonth} className="w-9 h-9 rounded-lg border border-bs-border hover:bg-bs-hover text-bs-muted">
              <i className="fa-solid fa-chevron-left" />
            </button>
            <h3 className="font-bold text-bs-text">{MONTHS[month]} {year}</h3>
            <button type="button" onClick={nextMonth} className="w-9 h-9 rounded-lg border border-bs-border hover:bg-bs-hover text-bs-muted">
              <i className="fa-solid fa-chevron-right" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-center text-[10px] font-bold uppercase text-bs-subtle py-1">{w}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, idx) => {
              if (day === null) return <div key={`e-${idx}`} className="aspect-square" />;
              const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const count = byDay.get(key)?.length || 0;
              const isToday = key === todayKey;
              const isSelected = key === selectedDay;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(key)}
                  className={`aspect-square rounded-lg border text-sm flex flex-col items-center justify-center gap-0.5 transition-colors ${
                    isSelected
                      ? 'border-bs-accent bg-[var(--bs-success-bg)] text-bs-accent font-bold'
                      : isToday
                        ? 'border-bs-accent/50 bg-bs-elevated font-semibold'
                        : 'border-transparent hover:bg-bs-hover text-bs-text'
                  }`}
                >
                  <span>{day}</span>
                  {count > 0 && (
                    <span className="flex gap-0.5">
                      {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                        <span key={i} className="w-1 h-1 rounded-full bg-bs-accent" />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="bs-card p-4 md:p-5">
          <h3 className="font-bold text-bs-text text-sm mb-3">
            {selectedDay
              ? new Date(selectedDay + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
              : 'Selecione um dia'}
          </h3>
          {selectedDay && selectedItems.length === 0 && (
            <p className="text-sm text-bs-muted italic">Nenhum agendamento neste dia.</p>
          )}
          <ul className="space-y-2">
            {selectedItems.map((s) => (
              <li key={s.id} className="p-3 rounded-lg border border-bs-border bg-bs-elevated">
                <p className="text-xs text-bs-muted mb-1">
                  {new Date(s.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  {' · '}
                  <span className="bs-badge-accent normal-case text-[9px]">{s.status}</span>
                </p>
                <p className="text-sm text-bs-text line-clamp-2">{s.content || '(Apenas mídia)'}</p>
                <p className="text-xs text-bs-muted mt-1">{s.targets.length} destino(s)</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ScheduleCalendarView;
