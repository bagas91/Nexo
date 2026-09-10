import React, { useEffect, useRef, useState } from 'react';
import { SendProgressState } from '../types';

interface SendProgressPanelProps {
  progress: SendProgressState;
  onDismiss?: () => void;
  onCancel?: () => void | Promise<void>;
  compact?: boolean;
}

const logIcon: Record<string, string> = {
  info: 'fa-circle-info text-blue-500',
  success: 'fa-circle-check text-green-700',
  error: 'fa-circle-xmark text-red-500'
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const SendProgressPanel: React.FC<SendProgressPanelProps> = ({ progress, onDismiss, onCancel, compact = false }) => {
  const logRef = useRef<HTMLDivElement>(null);
  const [cancelling, setCancelling] = useState(false);
  const isRunning = progress.active || progress.status === 'running';
  const isFinished = progress.status === 'completed' || progress.status === 'failed';

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [progress.log.length, progress.current]);

  useEffect(() => {
    if (!isRunning) setCancelling(false);
  }, [isRunning]);

  if (progress.status === 'idle' && !progress.active) return null;

  const handleCancel = async () => {
    if (!onCancel || cancelling) return;
    if (!confirm('Cancelar o envio em andamento? Os destinos restantes serão marcados como falha.')) return;
    setCancelling(true);
    try {
      await onCancel();
    } catch {
      setCancelling(false);
    }
  };

  return (
    <div
      className={`rounded-2xl border shadow-card overflow-hidden ${
        isFinished && progress.failed > 0
          ? 'border-red-200 bg-bs-surface'
          : isFinished
            ? 'border-green-200 bg-bs-surface'
            : 'border-blue-500/30 bg-bs-surface'
      } ${compact ? '' : 'fixed bottom-6 right-6 z-[60] w-full max-w-md'}`}
    >
      <div className={`px-4 py-3 flex items-start justify-between gap-3 ${
        isRunning ? 'bg-blue-50' : progress.failed > 0 ? 'bg-red-50' : 'bg-green-50'
      }`}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isRunning ? (
              <i className="fa-solid fa-spinner animate-spin text-blue-600" />
            ) : progress.failed > 0 ? (
              <i className="fa-solid fa-triangle-exclamation text-red-600" />
            ) : (
              <i className="fa-solid fa-circle-check text-bs-accent" />
            )}
            <p className="font-bold text-bs-text text-sm truncate">
              {isRunning
                ? (cancelling ? 'Cancelando envio…' : 'Enviando mensagens…')
                : progress.failed > 0 ? 'Envio concluído com falhas' : 'Envio concluído'}
            </p>
          </div>
          {progress.sourceLabel && (
            <p className="text-xs text-bs-muted mt-0.5 truncate">{progress.sourceLabel}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isRunning && onCancel && (
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={cancelling}
              className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-60"
            >
              {cancelling ? '…' : 'Cancelar'}
            </button>
          )}
          {onDismiss && !isRunning && (
            <button
              type="button"
              onClick={onDismiss}
              className="w-8 h-8 rounded-lg hover:bg-bs-hover text-bs-muted flex items-center justify-center"
              aria-label="Fechar"
            >
              <i className="fa-solid fa-times" />
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        <div>
          <div className="flex justify-between text-xs text-bs-muted mb-1.5">
            <span>
              {isRunning && progress.currentChatName
                ? `Enviando: ${progress.currentChatName}`
                : `${progress.done} de ${progress.total} processado(s)`}
            </span>
            <span className="font-semibold">{progress.percent}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-bs-elevated overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isRunning ? 'bg-blue-500' : progress.failed > 0 ? 'bg-amber-500' : 'bg-bs-accent'
              }`}
              style={{ width: `${Math.max(isRunning ? 4 : 0, progress.percent)}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-bs-elevated px-2 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-bs-muted font-semibold">Total</p>
            <p className="text-sm font-bold text-bs-text">{progress.total}</p>
          </div>
          <div className="rounded-xl bg-green-50 px-2 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-bs-accent font-semibold">Enviados</p>
            <p className="text-sm font-bold text-green-700">{progress.sent}</p>
          </div>
          <div className="rounded-xl bg-red-50 px-2 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-red-500 font-semibold">Falhas</p>
            <p className="text-sm font-bold text-red-600">{progress.failed}</p>
          </div>
        </div>

        {!compact && progress.log.length > 0 && (
          <div
            ref={logRef}
            className="max-h-48 overflow-y-auto rounded-xl border border-bs-border bg-bs-elevated/80 p-2 space-y-1 custom-scrollbar"
          >
            {progress.log.map((entry, idx) => (
              <div key={`${entry.ts}-${idx}`} className="flex items-start gap-2 text-xs leading-relaxed">
                <span className="shrink-0 text-[10px] text-bs-muted font-mono pt-0.5">{formatTime(entry.ts)}</span>
                <i className={`fa-solid shrink-0 mt-0.5 text-[10px] ${logIcon[entry.type] || logIcon.info}`} />
                <span className={`min-w-0 break-words ${entry.type === 'error' ? 'text-red-600' : entry.type === 'success' ? 'text-green-700' : 'text-bs-text'}`}>
                  {entry.index && entry.total ? `[${entry.index}/${entry.total}] ` : ''}
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SendProgressPanel;
