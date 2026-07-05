import React, { useState, useEffect } from 'react';
import { ChatEntity } from '../types';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';

interface InvalidGroup {
  id: string;
  name: string;
  usages: { categories: { id: string; name: string }[]; schedules: { id: string; scheduledAt: number; status: string }[] };
}

interface ChatListProps {
  chats: ChatEntity[];
  onRefresh?: () => Promise<void> | void;
  backend?: BackendService | null;
}

const ChatList: React.FC<ChatListProps> = ({ chats, onRefresh, backend }) => {
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'group' | 'channel'>('all');
  const [invalidGroups, setInvalidGroups] = useState<InvalidGroup[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { showToast } = useToast();

  const loadInvalidGroups = async () => {
    if (!backend) return;
    try {
      setInvalidGroups(await backend.getInvalidGroups());
    } catch (e) {
      console.error('Erro ao carregar grupos inválidos', e);
    }
  };

  useEffect(() => {
    loadInvalidGroups();
  }, [backend]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh?.();
      await loadInvalidGroups();
    } finally {
      setRefreshing(false);
    }
  };

  const handleRemoveGroupUsages = async (chatId: string) => {
    if (!backend || !confirm('Remover este grupo de todas as categorias e agendamentos?')) return;
    setRemovingId(chatId);
    try {
      await backend.removeGroupFromUsages(chatId);
      setInvalidGroups((prev) => prev.filter((g) => g.id !== chatId));
      showToast('Grupo removido dos usos.', 'success');
    } catch (e) {
      showToast((e as Error)?.message || 'Erro ao remover.', 'error');
    } finally {
      setRemovingId(null);
    }
  };

  const filtered = chats.filter((c) => {
    const matchesText = c.name.toLowerCase().includes(filter.toLowerCase());
    const matchesType = typeFilter === 'all' || c.type === typeFilter;
    return matchesText && matchesType;
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h2 className="bs-page-title">Grupos e Canais</h2>
        <p className="bs-page-desc">Gerencie onde suas mensagens serão entregues.</p>
      </div>

      {invalidGroups.length > 0 && (
        <div className="bs-card p-4 border" style={{ borderColor: 'var(--bs-warning-border)', background: 'var(--bs-warning-bg)' }}>
          <h3 className="font-bold text-sm mb-2" style={{ color: 'var(--bs-warning-text)' }}>
            <i className="fa-solid fa-triangle-exclamation mr-2" />
            {invalidGroups.length} grupo(s) inválido(s)
          </h3>
          <ul className="space-y-2 mt-3">
            {invalidGroups.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 bg-bs-shell rounded-lg p-3 border border-bs-border text-sm">
                <span className="font-mono text-xs text-bs-text truncate">{g.id}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveGroupUsages(g.id)}
                  disabled={removingId === g.id}
                  className="bs-link-accent text-xs"
                >
                  {removingId === g.id ? 'Removendo...' : 'Remover usos'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bs-table-wrap">
        <div className="bs-table-toolbar">
          <div className="flex flex-1 flex-wrap items-center gap-3 min-w-0">
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-bs-muted text-xs" />
              <input
                type="text"
                placeholder="Pesquisar..."
                className="bs-input pl-9 py-1.5"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="flex bg-bs-elevated p-0.5 rounded-lg border border-bs-border">
              {(['all', 'group', 'channel'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                    typeFilter === t ? 'bs-filter-active' : 'bs-filter-idle'
                  }`}
                >
                  {t === 'all' ? 'Todos' : t === 'group' ? 'Grupos' : 'Canais'}
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={handleRefresh} disabled={!onRefresh || refreshing} className="bs-btn-secondary px-3 py-1.5 text-xs disabled:opacity-50">
            <i className={`fa-solid fa-arrows-rotate mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        <table className="bs-table">
          <thead className="bs-table-head">
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Membros</th>
              <th>ID</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="bs-table-empty">
                  {chats.length === 0 ? 'Nenhum grupo carregado. Conecte o WhatsApp e sincronize.' : 'Nenhum resultado para a busca.'}
                </td>
              </tr>
            ) : (
              filtered.map((chat) => (
                <tr key={chat.id} className="bs-table-row">
                  <td className="font-medium text-bs-text max-w-xs truncate">{chat.name}</td>
                  <td>
                    <span className={chat.type === 'group' ? 'bs-badge normal-case bg-bs-elevated text-bs-muted border border-bs-border' : 'bs-badge-accent normal-case'}>
                      {chat.type === 'group' ? 'Grupo' : 'Canal'}
                    </span>
                  </td>
                  <td className="text-bs-muted">{chat.type === 'channel' ? '—' : (chat.members ?? '—')}</td>
                  <td className="font-mono text-xs text-bs-subtle max-w-[140px] truncate">{chat.id}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-bs-border text-xs text-bs-muted">
          {filtered.length} de {chats.length} exibidos
        </div>
      </div>
    </div>
  );
};

export default ChatList;
