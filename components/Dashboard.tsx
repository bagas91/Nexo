import React, { useState, useEffect } from 'react';
import { ChatEntity, ScheduledMessage, HistoryEntry } from '../types';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';
import SendChart, { ChartPeriod } from './SendChart';

interface DashboardProps {
  chats: ChatEntity[];
  schedules: ScheduledMessage[];
  backend?: BackendService | null;
  onRefreshSchedules?: () => Promise<void>;
}

const statusLabel: Record<string, string> = {
  pending: 'Pendente',
  paused: 'Pausado',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'Falhou'
};

const Dashboard: React.FC<DashboardProps> = ({ chats, schedules, backend, onRefreshSchedules }) => {
  const [actionId, setActionId] = useState<string | null>(null);
  const [messagesToday, setMessagesToday] = useState<number>(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendInProgress, setSendInProgress] = useState(false);
  const [dispatchPaused, setDispatchPaused] = useState(false);
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>(7);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const { showToast } = useToast();

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(uniqueSchedules.slice(0, 15).map((s) => s.id)));
  };

  const deselectAll = () => setSelectedIds(new Set());

  const handleDeleteSelected = async () => {
    if (!backend || !onRefreshSchedules || selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`Excluir ${count} agendamento(s) selecionado(s)? Esta ação não pode ser desfeita.`)) return;
    setActionId('bulk');
    try {
      for (const id of selectedIds) {
        await backend.deleteSchedule(id);
      }
      setSelectedIds(new Set());
      await onRefreshSchedules();
      showToast(`${count} agendamento(s) excluído(s).`, 'success');
    } catch (e) {
      console.error('Erro ao excluir selecionados', e);
      showToast((e as Error)?.message || 'Erro ao excluir.', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!backend || !onRefreshSchedules || uniqueSchedules.length === 0) return;
    if (!confirm(`Excluir TODOS os ${uniqueSchedules.length} agendamento(s) da lista? (pendentes, enviados e falhos). Esta ação não pode ser desfeita.`)) return;
    setActionId('bulk');
    try {
      for (const s of uniqueSchedules) {
        await backend.deleteSchedule(s.id);
      }
      setSelectedIds(new Set());
      await onRefreshSchedules();
      showToast(`${uniqueSchedules.length} agendamento(s) excluído(s).`, 'success');
    } catch (e) {
      console.error('Erro ao excluir todos', e);
      showToast((e as Error)?.message || 'Erro ao excluir todos.', 'error');
    } finally {
      setActionId(null);
    }
  };

  useEffect(() => {
    if (!backend) return;
    backend.getHistoryTodayCount().then(setMessagesToday);
    backend.getHistory(500).then(setHistory).catch(() => setHistory([]));
  }, [backend]);

  useEffect(() => {
    if (!backend) return;
    const poll = async () => {
      const { sendInProgress: busy, dispatchPaused: paused } = await backend.getStatus();
      setSendInProgress(!!busy);
      setDispatchPaused(!!paused);
    };
    poll();
    const id = window.setInterval(poll, 2000);
    return () => window.clearInterval(id);
  }, [backend]);

  const handleStopAll = async () => {
    if (!backend) return;
    if (!confirm('Parar todos os disparos? Agendamentos pendentes serão pausados e o envio em andamento será cancelado.')) return;
    setDispatchBusy(true);
    try {
      const r = await backend.stopAllDispatches();
      setDispatchPaused(true);
      await onRefreshSchedules?.();
      showToast(
        `Parada de emergência ativa. ${r.paused || 0} agendamento(s) pausado(s).`,
        'info',
      );
    } catch (e) {
      showToast((e as Error)?.message || 'Erro ao parar disparos.', 'error');
    } finally {
      setDispatchBusy(false);
    }
  };

  const handleResumeDispatches = async (unpauseSchedules = false) => {
    if (!backend) return;
    setDispatchBusy(true);
    try {
      const r = await backend.resumeDispatches({ unpauseSchedules });
      setDispatchPaused(false);
      await onRefreshSchedules?.();
      showToast(
        unpauseSchedules
          ? `Disparos reativados. ${r.unpaused || 0} agendamento(s) voltaram para a fila.`
          : 'Disparos reativados. Reative agendamentos pausados um a um, ou use “Reativar tudo”.',
        'success',
      );
    } catch (e) {
      showToast((e as Error)?.message || 'Erro ao reativar disparos.', 'error');
    } finally {
      setDispatchBusy(false);
    }
  };

  const uniqueSchedules = React.useMemo(() => {
    const map = new Map<string, ScheduledMessage>();
    schedules.forEach((s) => {
      map.set(s.id, s);
    });
    const list = Array.from(map.values());
    const pendingStatuses = ['pending', 'paused', 'sending'];
    return list.sort((a, b) => {
      const aPending = pendingStatuses.includes(a.status);
      const bPending = pendingStatuses.includes(b.status);
      if (aPending && !bPending) return -1;
      if (!aPending && bPending) return 1;
      const aTime = new Date(a.scheduledAt).getTime();
      const bTime = new Date(b.scheduledAt).getTime();
      if (aPending) return aTime - bTime;
      return bTime - aTime;
    });
  }, [schedules]);

  const formatScheduledAt = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const groupsCount = chats.filter(c => c.type === 'group').length;
  const channelsCount = chats.filter(c => c.type === 'channel').length;
  const pendingSchedules = uniqueSchedules.filter(s => s.status === 'pending').length;

  const handlePause = async (s: ScheduledMessage) => {
    if (!backend || !onRefreshSchedules || s.status !== 'pending') return;
    setActionId(s.id);
    try {
      await backend.updateScheduleStatus(s.id, 'paused');
      await onRefreshSchedules();
    } catch (e) {
      console.error('Erro ao pausar', e);
      showToast((e as Error)?.message || 'Erro ao pausar agendamento.', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleResume = async (s: ScheduledMessage) => {
    if (!backend || !onRefreshSchedules || s.status !== 'paused') return;
    setActionId(s.id);
    try {
      await backend.updateScheduleStatus(s.id, 'pending');
      await onRefreshSchedules();
    } catch (e) {
      console.error('Erro ao reativar', e);
      showToast((e as Error)?.message || 'Erro ao reativar agendamento.', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (s: ScheduledMessage) => {
    if (!backend || !onRefreshSchedules) return;
    if (!confirm('Excluir este agendamento? Esta ação não pode ser desfeita.')) return;
    setActionId(s.id);
    try {
      await backend.deleteSchedule(s.id);
      await onRefreshSchedules();
    } catch (e) {
      console.error('Erro ao excluir', e);
      showToast((e as Error)?.message || 'Erro ao excluir agendamento.', 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleSendNow = async (s: ScheduledMessage) => {
    if (!backend || !onRefreshSchedules || s.status !== 'failed') return;
    if (sendInProgress || backend.isSendInProgress()) {
      showToast('Já existe um envio em andamento. Aguarde terminar antes de reenviar.', 'error');
      return;
    }
    if (!confirm(`Reenviar agora para ${s.targets.length} destino(s)?`)) return;
    setActionId(s.id);
    try {
      const result = await backend.sendScheduleNow(s.id);
      await onRefreshSchedules();
      if (result.failed > 0) {
        showToast(`Envio parcial: ${result.sent} enviado(s), ${result.failed} falha(s).`, 'error');
      } else {
        showToast(`Enviado com sucesso para ${result.sent} destino(s).`, 'success');
      }
    } catch (e) {
      console.error('Erro ao reenviar agora', e);
      showToast((e as Error)?.message || 'Erro ao reenviar agendamento.', 'error');
      await onRefreshSchedules();
    } finally {
      setActionId(null);
    }
  };

  const stats = [
    { label: 'Total de Grupos', value: groupsCount, icon: 'fa-users' },
    { label: 'Canais Sincronizados', value: channelsCount, icon: 'fa-broadcast-tower' },
    { label: 'Envios Agendados', value: pendingSchedules, icon: 'fa-clock' },
    { label: 'Mensagens Hoje', value: messagesToday, icon: 'fa-paper-plane' },
  ];

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case 'pending': return 'bs-badge-accent';
      case 'paused': return 'bs-badge-warning';
      case 'sending': return 'bs-badge-accent';
      case 'sent': return 'bs-badge-success';
      case 'failed': return 'bs-badge-danger';
      default: return 'bs-badge-accent';
    }
  };

  const visibleSchedules = uniqueSchedules.slice(0, 15);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h2 className="bs-page-title">Visão Geral</h2>
        <p className="bs-page-desc mt-1">Hub de automação WhatsApp — fila e métricas.</p>
      </div>

      {dispatchPaused && (
        <div className="rounded-xl border border-amber-400/50 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
              <i className="fa-solid fa-triangle-exclamation mr-2" />
              Parada de emergência ativa
            </p>
            <p className="text-xs text-bs-muted mt-0.5">
              Worker e envios em massa estão bloqueados. Checkpoint de agendamentos é preservado.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleResumeDispatches(false)}
              disabled={dispatchBusy || !backend}
              className="bs-btn-secondary text-xs py-2 px-3"
            >
              {dispatchBusy ? '…' : 'Reativar disparos'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!confirm('Reativar disparos E colocar todos os agendamentos pausados de volta na fila?')) return;
                void handleResumeDispatches(true);
              }}
              disabled={dispatchBusy || !backend}
              className="bs-btn text-xs py-2 px-3"
            >
              Reativar tudo
            </button>
          </div>
        </div>
      )}

      {!dispatchPaused && backend && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleStopAll()}
            disabled={dispatchBusy}
            className="text-xs font-semibold px-3 py-2 rounded-md border border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10 disabled:opacity-60"
          >
            <i className="fa-solid fa-hand mr-1.5" />
            {dispatchBusy ? '…' : 'Parar disparos'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bs-card p-5 flex items-center gap-4">
            <div className="w-11 h-11 bg-bs-elevated border border-bs-border text-bs-accent rounded-xl flex items-center justify-center text-lg">
              <i className={`fa-solid ${stat.icon}`}></i>
            </div>
            <div>
              <p className="text-xs text-bs-muted font-medium uppercase tracking-wide">{stat.label}</p>
              <p className="text-2xl font-bold text-bs-text tabular-nums">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-bs-muted font-semibold mr-1">Período:</span>
        {([7, 30] as ChartPeriod[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setChartPeriod(p)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold ${chartPeriod === p ? 'bs-filter-active' : 'bs-filter-idle'}`}
          >
            {p} dias
          </button>
        ))}
      </div>

      <SendChart history={history} period={chartPeriod} />

      <div className="bs-table-wrap">
        <div className="bs-table-toolbar">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="font-bold text-bs-text">Fila de Disparo</h3>
            {sendInProgress && (
              <span className="bs-badge-warning normal-case inline-flex items-center gap-1">
                <i className="fa-solid fa-spinner animate-spin"></i>
                Envio em andamento
              </span>
            )}
            <span className="text-xs text-bs-muted">{visibleSchedules.length} item(ns)</span>
          </div>
          {onRefreshSchedules && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => onRefreshSchedules()} className="bs-link-accent flex items-center gap-1 px-2 py-1 rounded hover:bg-bs-hover">
                <i className="fa-solid fa-arrows-rotate"></i> Atualizar
              </button>
              <button type="button" onClick={selectAll} className="bs-link px-2 py-1 rounded hover:bg-bs-hover">Selecionar</button>
              <button type="button" onClick={deselectAll} className="bs-link px-2 py-1 rounded hover:bg-bs-hover">Desmarcar</button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={selectedIds.size === 0 || actionId === 'bulk'}
                className="bs-link px-2 py-1 rounded hover:bg-bs-hover text-[var(--bs-danger-text)] disabled:opacity-50"
              >
                Excluir ({selectedIds.size})
              </button>
              <button
                type="button"
                onClick={handleDeleteAll}
                disabled={uniqueSchedules.length === 0 || actionId === 'bulk'}
                className="bs-btn-danger text-xs py-1.5 px-3 disabled:opacity-50"
              >
                Excluir todos
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          {visibleSchedules.length === 0 ? (
            <div className="bs-table-empty">
              <i className="fa-solid fa-inbox text-3xl mb-3 opacity-30 block"></i>
              Nenhum agendamento na fila.
            </div>
          ) : (
            <table className="bs-table">
              <thead className="bs-table-head">
                <tr>
                  {backend && onRefreshSchedules && <th className="w-10"></th>}
                  <th className="w-10"></th>
                  <th>Conteúdo</th>
                  <th>Agendado para</th>
                  <th>Status</th>
                  <th>Destinos</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visibleSchedules.map((s) => (
                  <tr
                    key={s.id}
                    className={`bs-table-row ${selectedIds.has(s.id) ? 'bg-[var(--bs-danger-bg)]' : ''}`}
                  >
                    {backend && onRefreshSchedules && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleSelect(s.id)}
                          className="rounded border-bs-border text-bs-accent focus:ring-bs-accent"
                        />
                      </td>
                    )}
                    <td>
                      <div className="w-8 h-8 rounded-lg bg-bs-elevated border border-bs-border flex items-center justify-center text-bs-accent">
                        <i className={`fa-solid ${s.attachments?.length ? 'fa-paperclip' : 'fa-message'}`}></i>
                      </div>
                    </td>
                    <td className="max-w-xs">
                      <p className="font-medium text-bs-text truncate">{s.content || '(Apenas mídia)'}</p>
                      {s.status === 'failed' && s.errorMessage && (
                        <p className="text-xs text-[var(--bs-danger-text)] truncate mt-0.5" title={s.errorMessage}>
                          {s.errorMessage}
                        </p>
                      )}
                      {s.repeatDaily && (
                        <span className="text-[10px] text-bs-muted uppercase tracking-wide">Repete diariamente</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-xs text-bs-muted">
                      {formatScheduledAt(s.scheduledAt)}
                    </td>
                    <td>
                      <span className={`${statusBadgeClass(s.status)} normal-case`}>
                        {statusLabel[s.status] ?? s.status}
                      </span>
                    </td>
                    <td>
                      <span className="text-sm font-semibold text-bs-accent tabular-nums">{s.targets.length}</span>
                      {s.attachments && s.attachments.length > 0 && (
                        <span className="text-[10px] text-bs-muted block">+{s.attachments.length} anexo(s)</span>
                      )}
                    </td>
                    <td>
                      {backend && onRefreshSchedules && (
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          {s.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => handlePause(s)}
                              disabled={actionId === s.id}
                              className="bs-link-accent px-2 py-1 rounded hover:bg-bs-hover disabled:opacity-50"
                            >
                              Pausar
                            </button>
                          )}
                          {s.status === 'paused' && (
                            <button
                              type="button"
                              onClick={() => handleResume(s)}
                              disabled={actionId === s.id}
                              className="bs-link-accent px-2 py-1 rounded hover:bg-bs-hover disabled:opacity-50"
                            >
                              Reativar
                            </button>
                          )}
                          {s.status === 'failed' && (
                            <button
                              type="button"
                              onClick={() => handleSendNow(s)}
                              disabled={actionId === s.id || actionId === 'bulk' || sendInProgress}
                              className="bs-link-accent px-2 py-1 rounded hover:bg-bs-hover disabled:opacity-50"
                            >
                              Reenviar
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDelete(s)}
                            disabled={actionId === s.id || actionId === 'bulk'}
                            className="bs-link px-2 py-1 rounded hover:bg-bs-hover text-[var(--bs-danger-text)] disabled:opacity-50"
                          >
                            Excluir
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
