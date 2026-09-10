import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChatEntity, FileAttachment, MediaLayout } from '../types';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';
import { getAttachmentMaxBytes, getAttachmentLimitLabel, hasVideoAttachment, isVideoAttachment, VIDEO_DISPATCH_WARNING } from '../utils/attachmentLimits';

interface GroupDispatchViewProps {
  chats: ChatEntity[];
}

const MEDIA_LAYOUT_OPTIONS: { id: MediaLayout; label: string }[] = [
  { id: 'caption_on_image', label: 'Legenda na foto' },
  { id: 'text_separate', label: 'Texto separado' },
  { id: 'short_caption_plus_text', label: 'Legenda curta + texto' },
];

type SendStatus = 'idle' | 'sending' | 'sent' | 'failed';

const GroupDispatchView: React.FC<GroupDispatchViewProps> = ({ chats }) => {
  const backend = BackendService.getInstance();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(
    () => chats.filter((c) => c.type === 'group').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [chats]
  );

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [mediaLayout, setMediaLayout] = useState<MediaLayout>('caption_on_image');
  const [statusByGroup, setStatusByGroup] = useState<Record<string, SendStatus>>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (groups.length && !selectedId) setSelectedId(groups[0].id);
  }, [groups, selectedId]);

  const filtered = groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()));
  const selected = groups.find((g) => g.id === selectedId) || filtered[0];

  const sentCount = Object.values(statusByGroup).filter((s) => s === 'sent').length;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: FileAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const maxBytes = getAttachmentMaxBytes(file);
      if (file.size > maxBytes) {
        showToast(`"${file.name}" excede o limite (${getAttachmentLimitLabel(file)}).`, 'error');
        continue;
      }
      const reader = new FileReader();
      const filePromise = new Promise<FileAttachment>((resolve) => {
        reader.onload = (event) => {
          resolve({
            name: file.name,
            type: file.type || 'application/octet-stream',
            data: event.target?.result as string,
            previewUrl: file.type.startsWith('image/') ? (event.target?.result as string) : '',
          });
        };
        reader.readAsDataURL(file);
      });
      newAttachments.push(await filePromise);
    }
    if (newAttachments.some(isVideoAttachment)) {
      showToast(VIDEO_DISPATCH_WARNING, 'info');
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSend = async () => {
    if (!selected) return;
    if (!content.trim() && attachments.length === 0) {
      showToast('Digite uma mensagem ou anexe um arquivo.', 'error');
      return;
    }
    setSending(true);
    setStatusByGroup((prev) => ({ ...prev, [selected.id]: 'sending' }));
    try {
      await backend.sendToChat(selected.id, content, attachments, mediaLayout);
      setStatusByGroup((prev) => ({ ...prev, [selected.id]: 'sent' }));
      showToast(`Enviado para "${selected.name}".`, 'success');
      const idx = filtered.findIndex((g) => g.id === selected.id);
      const next = filtered[idx + 1];
      if (next) setSelectedId(next.id);
    } catch (e) {
      setStatusByGroup((prev) => ({ ...prev, [selected.id]: 'failed' }));
      showToast(e instanceof Error ? e.message : 'Erro ao enviar', 'error');
    } finally {
      setSending(false);
    }
  };

  const resetProgress = () => setStatusByGroup({});

  if (groups.length === 0) {
    return (
      <div className="bs-card p-8 text-center text-sm text-bs-muted animate-fadeIn">
        Nenhum grupo carregado. Conecte o WhatsApp e sincronize em <strong>Grupos e Canais</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="bs-page-title">Disparo por grupo</h2>
          <p className="bs-page-desc mt-1">
            Envie manualmente para um grupo por vez — ideal para conferir entrega antes do próximo.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-bs-muted">
          <span>{sentCount}/{groups.length} enviados nesta sessão</span>
          {sentCount > 0 && (
            <button type="button" onClick={resetProgress} className="bs-link-accent">
              Limpar marcações
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bs-card overflow-hidden flex flex-col lg:col-span-1">
          <div className="p-3 border-b border-bs-border">
            <input
              type="text"
              placeholder="Buscar grupo…"
              className="bs-input py-1.5 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="overflow-y-auto custom-scrollbar flex-1">
            {filtered.map((g) => {
              const st = statusByGroup[g.id] || 'idle';
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedId(g.id)}
                  className={`w-full text-left px-3 py-3 border-b border-bs-border hover:bg-bs-hover flex items-center gap-2 ${
                    selected?.id === g.id ? 'bg-[var(--bs-success-bg)]' : ''
                  }`}
                >
                  <span className="flex-1 truncate text-sm font-medium text-bs-text">{g.name}</span>
                  {st === 'sent' && <i className="fa-solid fa-circle-check text-green-500 text-xs" title="Enviado" />}
                  {st === 'failed' && <i className="fa-solid fa-circle-xmark text-red-500 text-xs" title="Falhou" />}
                  {st === 'sending' && <i className="fa-solid fa-spinner fa-spin text-bs-muted text-xs" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="bs-card p-4 flex flex-col lg:col-span-2 min-h-0">
          {selected ? (
            <>
              <div className="mb-3 pb-3 border-b border-bs-border">
                <p className="text-sm font-semibold text-bs-text">{selected.name}</p>
                <p className="text-xs text-bs-muted font-mono truncate">{selected.id}</p>
              </div>

              <textarea
                className="bs-input flex-1 min-h-[160px] font-mono text-sm mb-3"
                placeholder="Mensagem para este grupo…"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />

              <div className="mb-3">
                <label className="block text-xs font-semibold text-bs-muted mb-1">Formato de mídia</label>
                <select
                  className="bs-input py-1.5 text-sm"
                  value={mediaLayout}
                  onChange={(e) => setMediaLayout(e.target.value as MediaLayout)}
                >
                  {MEDIA_LAYOUT_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-bs-muted">Anexos ({attachments.length}) · Preferir imagem+áudio</span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="bs-link-accent text-xs"
                  >
                    <i className="fa-solid fa-paperclip mr-1" />Anexar
                  </button>
                  <input
                    type="file"
                    hidden
                    multiple
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/*,video/*,audio/*,application/pdf"
                  />
                </div>
                {hasVideoAttachment(attachments) && (
                  <div className="mb-2 rounded-lg border border-amber-400/50 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-900 dark:text-amber-200">
                    <strong>Vídeo anexado:</strong> pode travar a sessão. Preferir imagem + áudio + texto.
                  </div>
                )}
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((file, idx) => (
                      <div key={idx} className="relative text-xs bg-bs-elevated border border-bs-border rounded-lg px-2 py-1 pr-6 max-w-[180px] truncate">
                        {file.name}
                        <button
                          type="button"
                          onClick={() => removeAttachment(idx)}
                          className="absolute right-1 top-1/2 -translate-y-1/2 text-bs-muted hover:text-red-500"
                        >
                          <i className="fa-solid fa-xmark" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleSend}
                disabled={sending}
                className="bs-btn-primary w-full sm:w-auto disabled:opacity-50"
              >
                {sending ? (
                  <><i className="fa-solid fa-spinner fa-spin mr-2" />Enviando…</>
                ) : (
                  <><i className="fa-solid fa-paper-plane mr-2" />Enviar para este grupo</>
                )}
              </button>
            </>
          ) : (
            <p className="text-sm text-bs-muted">Selecione um grupo na lista.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default GroupDispatchView;
