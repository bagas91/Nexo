import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';
import CrmCustomerPanel from './CrmCustomerPanel';
import { formatPhoneLabel } from '../utils/phoneDisplay';

export type InboxConversation = {
  id: string;
  contactName: string;
  phone: string;
  lastMessage: string;
  unread: number;
  status: string;
  mode: 'bot' | 'human';
  updatedAt: number;
  avatarUrl?: string | null;
  needsHuman?: boolean;
  humanAlertAt?: number | null;
  notes?: string;
  lastFromMe?: boolean | null;
  unanswered?: boolean;
  unseen?: boolean;
  queueLabel?: string;
  tags?: string[];
};

type InboxMessage = {
  id: string;
  body: string;
  fromMe: boolean;
  ts: number;
  mediaType?: 'audio' | 'image' | 'video' | 'document' | null;
  mimetype?: string | null;
  mediaUrl?: string | null;
};

type QueueFilter = 'all' | 'unseen' | 'unanswered' | 'alert' | 'closed';

const QUEUE_FILTERS: { id: QueueFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'unseen', label: 'Não visualizado' },
  { id: 'unanswered', label: 'Não respondido' },
  { id: 'alert', label: 'Alerta +5min' },
  { id: 'closed', label: 'Finalizado' },
];

const AVATAR_COLORS = [
  'bg-rose-500', 'bg-pink-500', 'bg-fuchsia-500', 'bg-purple-500', 'bg-indigo-500',
  'bg-blue-500', 'bg-sky-500', 'bg-cyan-500', 'bg-teal-500', 'bg-emerald-500',
  'bg-green-500', 'bg-lime-600', 'bg-amber-500', 'bg-orange-500', 'bg-red-500',
];

function initials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function authToken(): string {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('va_token') || '' : '';
}

function withToken(url: string): string {
  return `${url}?token=${encodeURIComponent(authToken())}`;
}

function waitMinutesLabel(c: InboxConversation): string {
  const base = c.updatedAt || c.humanAlertAt || Date.now();
  const mins = Math.max(5, Math.round((Date.now() - base) / 60000));
  return `+${mins} min sem resposta`;
}

function queueBadge(c: InboxConversation): { text: string; className: string } {
  const label = c.queueLabel || (c.status === 'closed' ? 'finalizado' : c.needsHuman ? 'alerta' : c.unseen ? 'nao_visualizado' : c.unanswered ? 'nao_respondido' : 'em_dia');
  switch (label) {
    case 'finalizado':
      return { text: 'Finalizado', className: 'bg-bs-elevated text-bs-muted border border-bs-border' };
    case 'alerta':
      return { text: waitMinutesLabel(c), className: 'bg-rose-500 text-white' };
    case 'nao_visualizado':
      return { text: 'Não visualizado', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' };
    case 'nao_respondido':
      return { text: 'Não respondido', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' };
    default:
      return { text: (c.mode || 'bot') === 'human' ? 'Em atendimento' : 'Em dia', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' };
  }
}

function matchesFilter(c: InboxConversation, filter: QueueFilter, tagFilter: string | null): boolean {
  if (tagFilter && !(c.tags || []).includes(tagFilter)) return false;
  if (filter === 'all') return c.status !== 'closed';
  if (filter === 'closed') return c.status === 'closed';
  if (filter === 'alert') return !!c.needsHuman && c.status !== 'closed';
  if (filter === 'unseen') return !!c.unseen;
  if (filter === 'unanswered') return !!c.unanswered;
  return true;
}

function sortConversations(list: InboxConversation[]): InboxConversation[] {
  const rank = (c: InboxConversation) => {
    if (c.needsHuman) return 0;
    if (c.unseen) return 1;
    if (c.unanswered) return 2;
    if (c.status === 'closed') return 4;
    return 3;
  };
  return [...list].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

const Avatar: React.FC<{ name: string; url?: string | null; keyId: string; size?: number }> = ({ name, url, keyId, size = 40 }) => {
  const [errored, setErrored] = useState(false);
  const px = `${size}px`;
  if (url && !errored) {
    return (
      <img
        src={withToken(url)}
        alt={name}
        onError={() => setErrored(true)}
        className="rounded-full object-cover shrink-0"
        style={{ width: px, height: px }}
      />
    );
  }
  return (
    <div
      className={`rounded-full flex items-center justify-center text-white font-semibold shrink-0 ${colorFor(keyId || name)}`}
      style={{ width: px, height: px, fontSize: `${Math.round(size * 0.38)}px` }}
    >
      {initials(name)}
    </div>
  );
};

const isLabel = (body: string) => /^\[.+\]$/.test(String(body || '').trim());

const MediaBubble: React.FC<{ m: InboxMessage }> = ({ m }) => {
  const caption = m.body && !isLabel(m.body) ? m.body : '';
  if (m.mediaUrl) {
    const src = withToken(m.mediaUrl);
    if (m.mediaType === 'audio') {
      return (
        <div className="space-y-1">
          <audio controls preload="none" src={src} className="max-w-[240px]" />
          {caption && <p className="whitespace-pre-wrap break-words">{caption}</p>}
        </div>
      );
    }
    if (m.mediaType === 'image') {
      return (
        <div className="space-y-1">
          <a href={src} target="_blank" rel="noreferrer">
            <img src={src} alt="imagem" className="rounded-lg max-w-[240px] max-h-[280px] object-cover" />
          </a>
          {caption && <p className="whitespace-pre-wrap break-words">{caption}</p>}
        </div>
      );
    }
    if (m.mediaType === 'video') {
      return (
        <div className="space-y-1">
          <video controls preload="none" src={src} className="rounded-lg max-w-[240px] max-h-[280px]" />
          {caption && <p className="whitespace-pre-wrap break-words">{caption}</p>}
        </div>
      );
    }
    return (
      <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-2 underline">
        <i className="fa-solid fa-file-arrow-down" />
        {caption || 'Baixar documento'}
      </a>
    );
  }
  const label = m.mediaType === 'audio' ? '[áudio]'
    : m.mediaType === 'image' ? '[imagem]'
    : m.mediaType === 'video' ? '[vídeo]'
    : m.mediaType === 'document' ? '[documento]'
    : m.body;
  return (
    <span className="italic text-bs-muted">
      <i className="fa-solid fa-paperclip mr-1 text-[10px]" />{label}
    </span>
  );
};

type InboxPanelProps = {
  embedded?: boolean;
  className?: string;
};

const InboxPanel: React.FC<InboxPanelProps> = ({ embedded = false, className = '' }) => {
  const { showToast } = useToast();
  const backend = BackendService.getInstance();
  const [convs, setConvs] = useState<InboxConversation[]>([]);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showCustomer, setShowCustomer] = useState(true);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeUpdatedAtRef = useRef<number>(0);

  const tagTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of convs) {
      if (c.status === 'closed') continue;
      for (const t of c.tags || []) {
        if (!t || t === 'whatsapp') continue;
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
      .map(([tag, count]) => ({ tag, count }));
  }, [convs]);

  const filtered = useMemo(
    () => sortConversations(convs.filter((c) => matchesFilter(c, filter, tagFilter))),
    [convs, filter, tagFilter],
  );
  const active = filtered.find((c) => c.id === selected) || filtered[0] || null;
  const counts = useMemo(() => ({
    all: convs.filter((c) => c.status !== 'closed').length,
    unseen: convs.filter((c) => c.unseen).length,
    unanswered: convs.filter((c) => c.unanswered).length,
    alert: convs.filter((c) => c.needsHuman && c.status !== 'closed').length,
    closed: convs.filter((c) => c.status === 'closed').length,
  }), [convs]);

  const loadConversations = useCallback(async () => {
    try {
      const list = await backend.getInboxConversations();
      setConvs(list as InboxConversation[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar conversas';
      if (/403|permissão|Sem permissão/i.test(msg)) {
        showToast('Sem permissão para ver conversas WhatsApp. Peça ao admin liberar o módulo CRM.', 'error');
      } else {
        showToast(msg, 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [backend, showToast]);

  useEffect(() => {
    if (filtered.length && (!selected || !filtered.some((c) => c.id === selected))) {
      setSelected(filtered[0].id);
    }
    if (!filtered.length) setSelected(null);
  }, [filtered, selected]);

  useEffect(() => {
    setNotesDraft(active?.notes || '');
  }, [active?.id, active?.notes]);

  const loadMessages = useCallback(async (chatId: string) => {
    try {
      const res = await backend.getInboxMessages(chatId);
      setMessages(res.messages);
      setHasMoreMessages(!!res.hasMore);
      await backend.markInboxRead(chatId);
      setConvs((prev) => prev.map((c) => (
        c.id === chatId
          ? { ...c, unread: 0, unseen: false, queueLabel: c.needsHuman ? 'alerta' : c.unanswered ? 'nao_respondido' : (c.status === 'closed' ? 'finalizado' : 'em_dia') }
          : c
      )));
    } catch (err) {
      console.warn('Inbox: falha ao carregar mensagens', err);
    }
  }, [backend]);

  const loadOlderMessages = useCallback(async () => {
    if (!active?.id || !messages.length || loadingOlder) return;
    const oldest = messages[0]?.ts;
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const res = await backend.getInboxMessages(active.id, { before: oldest, limit: 100 });
      if (res.messages.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const merged = [...res.messages.filter((m) => !seen.has(m.id)), ...prev];
          return merged;
        });
      }
      setHasMoreMessages(!!res.hasMore);
    } catch (err) {
      console.warn('Inbox: falha ao carregar anteriores', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [active?.id, messages, loadingOlder, backend]);

  useEffect(() => {
    loadConversations();
    const id = window.setInterval(loadConversations, 4000);
    return () => window.clearInterval(id);
  }, [loadConversations]);

  useEffect(() => {
    if (!active?.id) {
      setMessages([]);
      activeUpdatedAtRef.current = 0;
      return;
    }
    activeUpdatedAtRef.current = active.updatedAt || 0;
    void loadMessages(active.id);
    const id = window.setInterval(() => {
      void loadMessages(active.id);
    }, 3000);
    return () => window.clearInterval(id);
  }, [active?.id, loadMessages]);

  useEffect(() => {
    if (!active?.id) return;
    const ts = active.updatedAt || 0;
    if (ts > activeUpdatedAtRef.current) {
      activeUpdatedAtRef.current = ts;
      void loadMessages(active.id);
    }
  }, [active?.id, active?.updatedAt, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, active?.id]);

  const patchConv = (id: string, patch: Partial<InboxConversation>) => {
    setConvs((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

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
      if ((active.mode || 'bot') === 'bot') {
        await backend.setConversationMode(active.id, 'human');
      }
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
      const updated = await backend.setConversationMode(active.id, mode) as InboxConversation;
      patchConv(active.id, updated);
      showToast(mode === 'bot' ? 'Agente IA reativado nesta conversa.' : 'Você assumiu — responda por aqui.', 'info');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro', 'error');
    }
  };

  const setStatus = async (status: 'open' | 'pending' | 'closed') => {
    if (!active) return;
    try {
      const updated = await backend.setConversationStatus(active.id, status) as InboxConversation;
      patchConv(active.id, updated);
      showToast(
        status === 'closed' ? 'Atendimento finalizado.' : status === 'pending' ? 'Marcado como pendente.' : 'Conversa reaberta.',
        'success',
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro', 'error');
    }
  };

  const saveNotes = async () => {
    if (!active) return;
    setSavingNotes(true);
    try {
      const updated = await backend.setConversationNotes(active.id, notesDraft) as InboxConversation;
      patchConv(active.id, { notes: updated.notes || notesDraft });
      showToast('Nota de atendimento salva.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao salvar nota', 'error');
    } finally {
      setSavingNotes(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando conversas…</div>;
  }

  return (
    <div className={`space-y-3 animate-fadeIn flex flex-col ${embedded ? 'h-[calc(100vh-12rem)]' : 'h-[calc(100vh-8rem)]'} ${className}`}>
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="min-w-0">
          {!embedded && (
            <>
              <h2 className="bs-page-title">Conversas</h2>
              <p className="bs-page-desc mt-1">Responda o cliente por aqui — este é o posto de atendimento.</p>
            </>
          )}
          {embedded && (
            <p className="text-sm text-bs-muted">
              Responda o cliente por aqui. Filtre por visualizado, respondido ou finalizado.
            </p>
          )}
        </div>
        <button type="button" onClick={handleSync} className="bs-btn-secondary text-xs py-2 px-3 shrink-0 self-start">
          <i className="fa-solid fa-arrows-rotate mr-1" />Sincronizar
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUEUE_FILTERS.map((f) => {
          const n = counts[f.id];
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-md border transition-colors ${
                on
                  ? f.id === 'alert'
                    ? 'bg-rose-500 text-white border-rose-500'
                    : 'bg-bs-text text-bs-shell border-bs-text'
                  : 'bg-bs-shell text-bs-muted border-bs-border hover:text-bs-text'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 tabular-nums ${on ? 'opacity-90' : 'opacity-70'}`}>{n}</span>
            </button>
          );
        })}
      </div>

      {tagTabs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-bs-subtle mr-1">Tags</span>
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-md border transition-colors ${
              tagFilter === null
                ? 'bg-bs-accent/15 text-bs-accent border-bs-accent/40'
                : 'bg-bs-shell text-bs-muted border-bs-border hover:text-bs-text'
            }`}
          >
            Todas
          </button>
          {tagTabs.map(({ tag, count }) => {
            const on = tagFilter === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setTagFilter(on ? null : tag)}
                className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-md border transition-colors capitalize ${
                  on
                    ? 'bg-bs-accent/15 text-bs-accent border-bs-accent/40'
                    : 'bg-bs-shell text-bs-muted border-bs-border hover:text-bs-text'
                }`}
              >
                {tag}
                <span className={`ml-1.5 tabular-nums ${on ? 'opacity-90' : 'opacity-70'}`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {convs.length === 0 ? (
        <div className="bs-card p-8 text-center text-sm text-bs-muted">
          Nenhuma conversa privada ainda. Envie uma mensagem para o número conectado ou clique em <strong>Sincronizar</strong>.
        </div>
      ) : filtered.length === 0 ? (
        <div className="bs-card p-8 text-center text-sm text-bs-muted">
          Nenhuma conversa neste filtro.
        </div>
      ) : (
        <div className={`flex-1 min-h-0 grid grid-cols-1 gap-4 ${
          showCustomer
            ? 'xl:grid-cols-[240px_minmax(0,1fr)_300px] md:grid-cols-[220px_minmax(0,1fr)]'
            : 'md:grid-cols-[240px_minmax(0,1fr)]'
        }`}>
          <div className="bs-card overflow-hidden flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-bs-border text-xs text-bs-muted">
              {filtered.length} conversa{filtered.length !== 1 ? 's' : ''}
            </div>
            <div className="overflow-y-auto custom-scrollbar flex-1">
              {filtered.map((c) => {
                const alert = !!c.needsHuman && c.status !== 'closed';
                const isActive = active?.id === c.id;
                const badge = queueBadge(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c.id)}
                    className={`w-full text-left px-3 py-3 border-b border-bs-border hover:bg-bs-hover flex gap-3 items-start ${
                      alert
                        ? 'bg-rose-50/90 dark:bg-rose-950/25 border-l-4 border-l-rose-500'
                        : c.unseen
                          ? 'bg-sky-50/80 dark:bg-sky-950/20 border-l-4 border-l-sky-500'
                          : c.unanswered
                            ? 'border-l-4 border-l-amber-400'
                            : isActive
                              ? 'bg-[var(--bs-success-bg)] border-l-4 border-l-transparent'
                              : 'border-l-4 border-l-transparent'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <Avatar name={c.contactName} url={c.avatarUrl} keyId={c.id} size={40} />
                      {(alert || c.unseen) && (
                        <span className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-bs-shell ${alert ? 'bg-rose-500 animate-pulse' : 'bg-sky-500'}`} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-start gap-2">
                        <p className={`font-semibold text-sm truncate ${alert ? 'text-rose-700 dark:text-rose-300' : 'text-bs-text'}`}>
                          {c.contactName}
                        </p>
                        {c.unread > 0 && <span className="bs-badge-accent normal-case text-[9px] shrink-0">{c.unread}</span>}
                      </div>
                      <p className="text-xs text-bs-muted truncate mt-0.5">{c.lastMessage}</p>
                      <div className="mt-1">
                        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold ${badge.className}`}>
                          {alert && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                          {badge.text}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bs-card flex flex-col overflow-hidden min-h-0">
            {active && (
              <>
                {active.needsHuman && active.status !== 'closed' && (
                  <div className="px-4 py-2.5 bg-rose-500 text-white flex items-center justify-between gap-3 text-sm shrink-0">
                    <span className="font-medium flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse shrink-0" />
                      <span className="truncate">Cliente aguardando — {waitMinutesLabel(active)}</span>
                    </span>
                    {(active.mode || 'bot') === 'bot' && (
                      <button
                        type="button"
                        onClick={() => toggleMode('human')}
                        className="shrink-0 bg-white text-rose-600 font-bold text-xs px-3 py-1.5 rounded-md hover:bg-rose-50"
                      >
                        Assumir agora
                      </button>
                    )}
                  </div>
                )}

                <div className="px-4 py-3 border-b border-bs-border flex flex-wrap items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={active.contactName} url={active.avatarUrl} keyId={active.id} size={44} />
                    <div className="min-w-0">
                      <p className="font-bold text-bs-text truncate">{active.contactName}</p>
                      <p className="text-xs text-bs-muted truncate">{formatPhoneLabel(active.phone)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${queueBadge(active).className}`}>
                      {queueBadge(active).text}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleMode((active.mode || 'bot') === 'bot' ? 'human' : 'bot')}
                      className={`text-[10px] py-1.5 px-2.5 rounded-md font-semibold ${
                        (active.mode || 'bot') === 'bot'
                          ? 'bg-rose-500 text-white hover:bg-rose-600'
                          : 'bs-btn-secondary'
                      }`}
                    >
                      {(active.mode || 'bot') === 'bot' ? 'Assumir' : 'Voltar IA'}
                    </button>
                    {active.status === 'closed' ? (
                      <button type="button" onClick={() => setStatus('open')} className="bs-btn-secondary text-[10px] py-1.5 px-2.5">
                        Reabrir
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setStatus('closed')}
                        className="text-[10px] py-1.5 px-2.5 rounded-md font-semibold bg-bs-elevated border border-bs-border text-bs-text hover:bg-bs-hover"
                      >
                        Finalizar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowNotes((v) => !v)}
                      className="bs-btn-secondary text-[10px] py-1.5 px-2.5"
                      title="Notas de atendimento"
                    >
                      <i className="fa-solid fa-sticky-note mr-1" />
                      Notas
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCustomer((v) => !v)}
                      className={`text-[10px] py-1.5 px-2.5 rounded-md font-semibold border ${
                        showCustomer
                          ? 'bg-bs-accent/15 text-bs-accent border-bs-accent/30'
                          : 'bs-btn-secondary'
                      }`}
                      title="Ficha do cliente, pedidos e oportunidades"
                    >
                      <i className="fa-solid fa-id-card mr-1" />
                      Cliente
                    </button>
                  </div>
                </div>

                {showNotes && (
                  <div className="px-4 py-3 border-b border-bs-border bg-amber-50/50 dark:bg-amber-950/15 shrink-0 space-y-2">
                    <p className="text-[11px] font-semibold text-bs-text">Nota de atendimento (só equipe)</p>
                    <textarea
                      className="bs-input text-sm min-h-[64px]"
                      placeholder="Ex.: pediu orçamento do colar X, aguardando foto do pagamento…"
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={saveNotes}
                        disabled={savingNotes || notesDraft === (active.notes || '')}
                        className="bs-btn text-[10px] py-1.5 px-3"
                      >
                        {savingNotes ? 'Salvando…' : 'Salvar nota'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-bs-elevated/50 min-h-0">
                  {hasMoreMessages && (
                    <div className="flex justify-center pb-1">
                      <button
                        type="button"
                        onClick={() => void loadOlderMessages()}
                        disabled={loadingOlder}
                        className="text-[11px] font-semibold px-3 py-1.5 rounded-md border border-bs-border text-bs-muted hover:text-bs-text hover:bg-bs-hover disabled:opacity-60"
                      >
                        {loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}
                      </button>
                    </div>
                  )}
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[80%] rounded-xl px-3 py-2 text-sm border ${
                        m.fromMe
                          ? 'ml-auto bg-[var(--bs-success-bg)] border-[var(--bs-success-border)] rounded-tr-none'
                          : 'bg-bs-shell border-bs-border rounded-tl-none'
                      }`}
                    >
                      {m.mediaType
                        ? <MediaBubble m={m} />
                        : <span className="whitespace-pre-wrap break-words">{m.body}</span>}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {active.status === 'closed' ? (
                  <div className="p-3 border-t border-bs-border text-center text-xs text-bs-muted">
                    Atendimento finalizado — <button type="button" className="underline text-bs-accent" onClick={() => setStatus('open')}>reabrir</button> para responder de novo.
                  </div>
                ) : (
                  <div className="p-3 border-t border-bs-border flex gap-2 shrink-0">
                    <input
                      className="bs-input flex-1"
                      placeholder="Digite uma resposta para o cliente…"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                      disabled={sending}
                    />
                    <button type="button" onClick={handleSend} disabled={sending || !reply.trim()} className="bs-btn px-4">
                      {sending ? '…' : 'Enviar'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {showCustomer && active && (
            <CrmCustomerPanel
              phone={active.phone}
              contactName={active.contactName}
              conversationId={active.id}
              className="max-h-[42vh] md:max-h-[50vh] xl:max-h-full"
              onProfileChange={() => void loadConversations()}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default InboxPanel;
