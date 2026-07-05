import React, { useEffect, useState } from 'react';
import { HistoryEntry } from '../types';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';

const backend = BackendService.getInstance();

const HistoryView: React.FC = () => {
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { showToast } = useToast();

    const HISTORY_PAGE_LIMIT = 200;

    const loadHistory = async () => {
        setIsLoading(true);
        const data = await backend.getHistory(HISTORY_PAGE_LIMIT);
        setHistory(data);
        setIsLoading(false);
    };

    useEffect(() => {
        loadHistory();
    }, []);

    const handleClear = async () => {
        if (!confirm('Tem certeza que deseja limpar todo o histórico?')) return;
        try {
            await backend.clearHistory();
            setHistory([]);
            showToast('Histórico limpo.', 'success');
        } catch (e) {
            showToast((e as Error)?.message || 'Erro ao limpar histórico.', 'error');
        }
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleString('pt-BR');
    };

    const exportCsv = async () => {
        try {
            const data = await backend.getHistory(2000);
            const headers = ['Data/Hora', 'Destinatário', 'ID', 'Conteúdo', 'Arquivos', 'Status'];
            const rows = data.map((entry) => [
                formatDate(entry.timestamp),
                `"${(entry.chatName || '').replace(/"/g, '""')}"`,
                entry.chatId,
                `"${(entry.content || 'Apenas mídia').replace(/"/g, '""')}"`,
                `"${(entry.attachments || []).join('; ').replace(/"/g, '""')}"`,
                entry.status || 'sent'
            ].join(','));
            const csv = [headers.join(','), ...rows].join('\n');
            const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `historico-envios-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('CSV exportado.', 'success');
        } catch (e) {
            showToast((e as Error)?.message || 'Erro ao exportar CSV.', 'error');
        }
    };

    return (
        <div className="space-y-4 animate-fadeIn">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-3">
                <div>
                    <h2 className="bs-page-title">Histórico de Envios</h2>
                    <p className="bs-page-desc mt-1">Registro de mensagens e arquivos enviados — auditoria e comprovante.</p>
                </div>
            </div>

            <div className="bs-table-wrap">
                <div className="bs-table-toolbar">
                    <p className="text-sm text-bs-muted">
                        {isLoading ? 'Carregando…' : `${history.length} registro(s)`}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={loadHistory} className="bs-btn-secondary flex items-center gap-2">
                            <i className={`fa-solid fa-rotate ${isLoading ? 'animate-spin' : ''}`}></i>
                            Atualizar
                        </button>
                        <button type="button" onClick={exportCsv} disabled={history.length === 0} className="bs-btn flex items-center gap-2 disabled:opacity-50">
                            <i className="fa-solid fa-file-csv"></i>
                            Exportar CSV
                        </button>
                        <button type="button" onClick={handleClear} className="bs-btn-danger flex items-center gap-2">
                            <i className="fa-solid fa-trash-can"></i>
                            Limpar
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="bs-table">
                        <thead className="bs-table-head">
                            <tr>
                                <th>Data / Hora</th>
                                <th>Destinatário</th>
                                <th>Conteúdo</th>
                                <th>Arquivos</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.length === 0 && !isLoading ? (
                                <tr>
                                    <td colSpan={5} className="bs-table-empty">
                                        Nenhum envio registrado ainda.
                                    </td>
                                </tr>
                            ) : (
                                history.map((entry) => (
                                    <tr key={entry.id} className="bs-table-row">
                                        <td className="whitespace-nowrap text-bs-muted text-xs">
                                            {formatDate(entry.timestamp)}
                                        </td>
                                        <td>
                                            <p className="font-semibold text-bs-text truncate max-w-[200px]">{entry.chatName}</p>
                                            <p className="text-[10px] text-bs-subtle font-mono truncate max-w-[200px]">{entry.chatId}</p>
                                        </td>
                                        <td>
                                            <p className="text-bs-muted truncate max-w-md">
                                                {entry.content || <span className="italic text-bs-subtle">Apenas mídia</span>}
                                            </p>
                                        </td>
                                        <td>
                                            {entry.attachments.length > 0 ? (
                                                <div className="flex flex-wrap gap-1 max-w-[180px]">
                                                    {entry.attachments.slice(0, 2).map((file, i) => (
                                                        <span key={i} className="bs-badge-success inline-flex items-center gap-1 normal-case">
                                                            <i className="fa-solid fa-paperclip text-[8px]"></i>
                                                            <span className="truncate max-w-[80px]">{file}</span>
                                                        </span>
                                                    ))}
                                                    {entry.attachments.length > 2 && (
                                                        <span className="text-xs text-bs-muted">+{entry.attachments.length - 2}</span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-bs-subtle text-xs">—</span>
                                            )}
                                        </td>
                                        <td>
                                            <span className="bs-badge-success inline-flex items-center gap-1.5 normal-case">
                                                <span className="bs-status-dot"></span>
                                                {entry.status || 'sent'}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default HistoryView;
