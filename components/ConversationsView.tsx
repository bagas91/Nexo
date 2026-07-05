import React, { useCallback, useEffect, useState } from 'react';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';

const STATUS: Record<string, string> = { open: 'Aberta', pending: 'Pendente', closed: 'Fechada' };

type Conversation = {
  id: string;
  contactName: string;
  phone: string;
  lastMessage: string;
  unread: number;
  status: string;
  mode: 'bot' | 'human';
  updatedAt: number;
};

type InboxMessage = {
  id: string;
  body: string;
  fromMe: boolean;
  ts: number;
};

const ConversationsView: React.FC = () => {
  const { showToast } = useToast();
  const backend = BackendService.getInstance();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const active = convs.find((c) => c.id === selected) || convs[0];

  const loadConversations = useCallback(async () => {
    try {
      const list = await backend.getInboxConversations();
      setConvs(list);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao carregar conversas', 'error');
    } finally {
      setLoading(false);
    }
  }, [backend, showToast]);

  useEffect(() => {
    if (convs.length && !selected) setSelected(convs[0].id);
  }, [convs, selected]);

  const loadMessages = useCallback(async (chatId: string) => {
    try {
      const list = await backend.getInboxMessages(chatId);
      setMessages(list);
      await backend.markInboxRead(chatId);
      setConvs((prev) => prev.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)));
    } catch {
      /* ignore poll errors */
    }
  }, [backend]);

  useEffect(() => {
    loadConversations();
    const id = window.setInterval(loadConversations, 4000);
    return () => window.clearInterval(id);
  }, [loadConversations]);

  useEffect(() => {
    if (!active?.id) {
      setMessages([]);
      return;
    }
    loadMessages(active.id);
    const id = window.setInterval(() => loadMessages(active.id), 3000);
    return () => window.clearInterval(id);
  }, [active?.id, loadMessages]);

  const handleSync = async () => {
    try {
      const r = await backend.syncInbox();
      showToast(`Sincronizado — ${r.synced} mensagem(ns) importadas.`, 'success');
      await loadConversations();
      if (active?.id) await loadMessages(active.id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao sincronizar', 'error');
    }
  };

  const handleSend = async () => {
    const text = reply.trim();
    if (!text || !active) return;
    setSending(true);
    try {
      await backend.replyInbox(active.phone, text, active.id);
      setReply('');
      await loadMessages(active.id);
      await loadConversations();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao enviar', 'error');
    } finally {
      setSending(false);
    }
  };

  const toggleMode = async (mode: 'bot' | 'human') => {
    if (!active) return;
    try {
      await backend.setConversationMode(active.id, mode);
      setConvs((prev) => prev.map((c) => (c.id === active.id ? { ...c, mode } : c)));
      showToast(mode === 'bot' ? 'Agente IA reativado nesta conversa.' : 'Atendimento humano — IA pausada.', 'info');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro', 'error');
    }
  };

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando conversas…</div>;
  }

  return (
    <div className="space-y-4 animate-fadeIn h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="bs-page-title">Conversas</h2>
          <p className="bs-page-desc mt-1">Mensagens privadas recebidas no WhatsApp conectado.</p>
        </div>
        <button type="button" onClick={handleSync} className="bs-btn-secondary text-xs py-2 px-3 shrink-0">
          <i className="fa-solid fa-arrows-rotate mr-1" />Sincronizar histórico
        </button>
      </div>

      {convs.length === 0 ? (
        <div className="bs-card p-8 text-center text-sm text-bs-muted">
          Nenhuma conversa privada ainda. Envie uma mensagem para o número conectado ou clique em <strong>Sincronizar histórico</strong>.
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bs-card overflow-hidden flex flex-col md:col-span-1">
            <div className="px-3 py-2 border-b border-bs-border text-xs text-bs-muted">{convs.length} conversas</div>
            <div className="overflow-y-auto custom-scrollbar flex-1">
              {convs.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={`w-full text-left px-3 py-3 border-b border-bs-border hover:bg-bs-hover ${active?.id === c.id ? 'bg-[var(--bs-success-bg)]' : ''}`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <p className="font-semibold text-sm text-bs-text truncate">{c.contactName}</p>
                    {c.unread > 0 && <span className="bs-badge-accent normal-case text-[9px] shrink-0">{c.unread}</span>}
                  </div>
                  <p className="text-xs text-bs-muted truncate mt-0.5">{c.lastMessage}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-bs-subtle">{STATUS[c.status] || c.status}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${(c.mode || 'bot') === 'bot' ? 'bg-bs-accent/15 text-bs-accent' : 'bg-amber-500/15 text-amber-600'}`}>
                      {(c.mode || 'bot') === 'bot' ? 'IA' : 'Humano'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="bs-card md:col-span-2 flex flex-col overflow-hidden">
            {active && (
              <>
                <div className="px-4 py-3 border-b border-bs-border flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-bs-text">{active.contactName}</p>
                    <p className="text-xs text-bs-muted">{active.phone}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleMode((active.mode || 'bot') === 'bot' ? 'human' : 'bot')}
                      className="bs-btn-secondary text-[10px] py-1 px-2"
                    >
                      {(active.mode || 'bot') === 'bot' ? 'Assumir (humano)' : 'Voltar IA'}
                    </button>
                    <span className={`bs-badge normal-case ${active.status === 'open' ? 'bs-badge-success' : 'bs-badge-warning'}`}>{STATUS[active.status] || active.status}</span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-bs-elevated/50">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[80%] rounded-xl px-3 py-2 text-sm border ${
                        m.fromMe
                          ? 'ml-auto bg-[var(--bs-success-bg)] border-[var(--bs-success-border)] rounded-tr-none'
                          : 'bg-bs-shell border-bs-border rounded-tl-none'
                      }`}
                    >
                      {m.body}
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t border-bs-border flex gap-2">
                  <input
                    className="bs-input flex-1"
                    placeholder="Digite uma resposta..."
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    disabled={sending}
                  />
                  <button type="button" onClick={handleSend} disabled={sending || !reply.trim()} className="bs-btn px-4">
                    {sending ? '…' : 'Enviar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConversationsView;
