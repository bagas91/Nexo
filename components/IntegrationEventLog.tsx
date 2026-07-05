import React from 'react';
import { IntegrationEvent } from '../services/mockStore';

interface IntegrationEventLogProps {
  events: IntegrationEvent[];
  filter?: 'woocommerce' | 'bling' | 'all';
}

const STATUS: Record<IntegrationEvent['status'], string> = {
  processed: 'bs-badge-success',
  queued: 'bs-badge-warning',
  failed: 'bs-badge-danger',
};

const IntegrationEventLog: React.FC<IntegrationEventLogProps> = ({ events, filter = 'all' }) => {
  const list = filter === 'all' ? events : events.filter((e) => e.source === filter);

  return (
    <div className="bs-table-wrap">
      <div className="bs-table-toolbar">
        <span className="text-sm font-semibold text-bs-text">Log de eventos</span>
        <span className="text-xs text-bs-muted">{list.length} registro(s)</span>
      </div>
      {list.length === 0 ? (
        <p className="bs-table-empty">Nenhum evento ainda. Use &quot;Simular evento&quot; para testar.</p>
      ) : (
        <table className="bs-table">
          <thead className="bs-table-head">
            <tr>
              <th>Quando</th>
              <th>Origem</th>
              <th>Evento</th>
              <th>Cliente</th>
              <th>WhatsApp</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((ev) => (
              <tr key={ev.id} className="bs-table-row">
                <td className="text-xs text-bs-muted whitespace-nowrap">
                  {new Date(ev.ts).toLocaleString('pt-BR')}
                </td>
                <td>
                  <span className="bs-badge-accent normal-case text-[9px]">
                    {ev.source === 'woocommerce' ? 'Woo' : 'Bling'}
                  </span>
                </td>
                <td className="text-sm text-bs-text max-w-[140px]">
                  <p className="font-medium truncate">{ev.summary}</p>
                  <p className="text-[10px] text-bs-subtle font-mono">{ev.eventType}</p>
                </td>
                <td className="text-xs text-bs-muted">
                  <p>{ev.customer}</p>
                  <p className="font-mono">{ev.phone}</p>
                </td>
                <td className="text-xs text-bs-muted max-w-[200px] truncate" title={ev.whatsappPreview}>
                  {ev.whatsappPreview}
                </td>
                <td>
                  <span className={`${STATUS[ev.status]} normal-case text-[9px]`}>{ev.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default IntegrationEventLog;
