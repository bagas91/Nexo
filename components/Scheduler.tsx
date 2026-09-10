import React, { useState, useRef, useEffect } from 'react';
import { ChatEntity, ScheduledMessage, FileAttachment, Category, View, BulkSendResult, MediaLayout } from '../types';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';
import { getAttachmentMaxBytes, getAttachmentLimitLabel, hasVideoAttachment, isVideoAttachment, VIDEO_DISPATCH_WARNING } from '../utils/attachmentLimits';

interface SchedulerProps {
  chats: ChatEntity[];
  onSchedule: (msg: Omit<ScheduledMessage, 'id' | 'status'>) => Promise<void>;
  setView?: (v: View) => void;
}


type AiTemplate = 'none' | 'palavra-do-dia' | 'legenda-wpp';

const TEMPLATE_OPTIONS: { id: AiTemplate; label: string }[] = [
  { id: 'none', label: 'Digitar manualmente' },
  { id: 'palavra-do-dia', label: '📖 Palavra do Dia' },
  { id: 'legenda-wpp', label: '✍️ Legenda WhatsApp' }
];

const MEDIA_LAYOUT_OPTIONS: { id: MediaLayout; label: string; description: string }[] = [
  {
    id: 'caption_on_image',
    label: 'Legenda na foto',
    description: 'Texto inteiro como legenda da imagem (padrão atual).',
  },
  {
    id: 'text_separate',
    label: 'Texto separado',
    description: 'Imagem sem legenda → mensagem com o texto → áudio.',
  },
  {
    id: 'short_caption_plus_text',
    label: 'Legenda curta + texto',
    description: 'Título e data na foto → resto do texto em mensagem → áudio.',
  },
];

const Scheduler: React.FC<SchedulerProps> = ({ chats, onSchedule, setView }) => {
  const [content, setContent] = useState('');
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [repeatDaily, setRepeatDaily] = useState(false);
  const [aiTemplate, setAiTemplate] = useState<AiTemplate>('palavra-do-dia');
  const [bibleReference, setBibleReference] = useState('');
  const [aiBrief, setAiBrief] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiProviders, setAiProviders] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [mediaLayout, setMediaLayout] = useState<MediaLayout>('caption_on_image');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showSendNowConfirm, setShowSendNowConfirm] = useState(false);
  const [isSendingNow, setIsSendingNow] = useState(false);
  const [sendNowResult, setSendNowResult] = useState<(BulkSendResult & { attachmentCount?: number }) | null>(null);
  const [sendInProgress, setSendInProgress] = useState(false);
  const [categoryNamesForLog, setCategoryNamesForLog] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backend = BackendService.getInstance();
  const { showToast } = useToast();

  useEffect(() => {
    backend.getCategories().then(setCategories);
  }, []);

  useEffect(() => {
    backend.getAiProviders().then(({ providers }) => {
      setAiProviders(providers);
    }).catch(() => setAiProviders([]));
  }, [backend]);

  useEffect(() => {
    const poll = async () => {
      const { sendInProgress: busy } = await backend.getStatus();
      setSendInProgress(!!busy);
    };
    poll();
    const id = window.setInterval(poll, 2000);
    return () => window.clearInterval(id);
  }, [backend]);

  const handleToggleTarget = (id: string) => {
    setSelectedTargets(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const applyCategoryById = (categoryId: string) => {
    if (!categoryId) return;
    const cat = categories.find(c => c.id === categoryId);
    if (!cat) return;
    const merged = new Set([...selectedTargets, ...cat.groupIds]);
    setSelectedTargets(Array.from(merged));
    setCategoryNamesForLog(prev => (prev.includes(cat.name) ? prev : [...prev, cat.name]));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: FileAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const maxBytes = getAttachmentMaxBytes(file);
      if (file.size > maxBytes) {
        showToast(
          `"${file.name}" excede o limite (${getAttachmentLimitLabel(file)}).`,
          'error'
        );
        continue;
      }
      const reader = new FileReader();

      const filePromise = new Promise<FileAttachment>((resolve) => {
        reader.onload = (event) => {
          resolve({
            name: file.name,
            type: file.type,
            size: file.size,
            data: event.target?.result as string,
            previewUrl: URL.createObjectURL(file)
          });
        };
      });
      reader.readAsDataURL(file);
      newAttachments.push(await filePromise);
    }
    if (newAttachments.some(isVideoAttachment)) {
      showToast(VIDEO_DISPATCH_WARNING, 'info');
    }
    setAttachments(prev => [...prev, ...newAttachments]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleGenerateText = async () => {
    if (aiProviders.length === 0) {
      showToast('IA não configurada no servidor.', 'error');
      return;
    }

    setIsGenerating(true);
    try {
      if (aiTemplate === 'palavra-do-dia') {
        if (!bibleReference.trim()) {
          showToast('Informe a referência bíblica (ex.: Salmos 21:1).', 'error');
          return;
        }
        const result = await backend.generatePalavraDoDia({
          reference: bibleReference.trim(),
          scheduledAt: scheduledAt || undefined
        });
        setContent(result.text);
        const corrected = result.correctedFrom ? ` (corrigido de "${result.correctedFrom}")` : '';
        showToast(`Palavra do Dia gerada — ${result.reference}${corrected}`, 'success');
      } else if (aiTemplate === 'legenda-wpp') {
        if (!aiBrief.trim()) {
          showToast('Descreva o tema ou briefing da legenda.', 'error');
          return;
        }
        const result = await backend.generateAiText({
          action: 'generate',
          brief: aiBrief.trim()
        });
        setContent(result.text);
        showToast('Legenda gerada!', 'success');
      }
    } catch (e) {
      showToast((e as Error)?.message || 'Erro ao gerar texto.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!content && attachments.length === 0) || selectedTargets.length === 0 || !scheduledAt) {
      showToast('Preencha os campos obrigatórios e selecione ao menos um destinatário.', 'error');
      return;
    }
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    const targetsForLog = selectedTargets.map(id => ({
      id,
      name: chats.find(c => c.id === id)?.name || id
    }));
    try {
      await backend.recordDispatch({
        contentPreview: (content || '').slice(0, 200) + (attachments.length ? ` [${attachments.length} anexo(s)]` : ''),
        targets: targetsForLog,
        categoryNames: categoryNamesForLog.length ? categoryNamesForLog : undefined,
        scheduledAt: scheduledAt || undefined
      });
      await onSchedule({
        content,
        targets: selectedTargets,
        scheduledAt,
        repeatDaily,
        attachments,
        mediaLayout,
      });
      setContent('');
      setSelectedTargets([]);
      setScheduledAt('');
      setRepeatDaily(false);
      setAttachments([]);
      setCategoryNamesForLog([]);
      setShowConfirmModal(false);
      showToast('Mensagem agendada com sucesso! Acesse o Dashboard para ver a fila.', 'success');
      if (setView) setView('dashboard');
    } catch (e) {
      showToast((e as Error)?.message || 'Erro ao agendar. Tente novamente.', 'error');
    }
  };

  const handleOpenSendNowConfirm = () => {
    if ((!content && attachments.length === 0) || selectedTargets.length === 0) {
      showToast('Preencha mensagem/anexos e selecione ao menos um destinatário.', 'error');
      return;
    }
    if (sendInProgress || backend.isSendInProgress()) {
      showToast('Já existe um envio em andamento. Aguarde terminar antes de iniciar outro.', 'error');
      return;
    }
    setShowSendNowConfirm(true);
  };

  const handleConfirmSendNow = async () => {
    if (sendInProgress || backend.isSendInProgress()) {
      showToast('Já existe um envio em andamento. Aguarde terminar antes de iniciar outro.', 'error');
      setShowSendNowConfirm(false);
      return;
    }
    const targetsForLog = selectedTargets.map(id => ({
      id,
      name: chats.find(c => c.id === id)?.name || id
    }));
    setShowSendNowConfirm(false);
    setIsSendingNow(true);
    setSendNowResult(null);
    try {
      await backend.recordDispatch({
        contentPreview: (content || '').slice(0, 200) + (attachments.length ? ` [${attachments.length} anexo(s)]` : ''),
        targets: targetsForLog,
        categoryNames: categoryNamesForLog.length ? categoryNamesForLog : undefined
      });
      const attachmentCount = attachments.length;
      const result = await backend.sendMessageImmediately(content, selectedTargets, attachments, mediaLayout);
      setSendNowResult({ ...result, attachmentCount });
      if (result.failed > 0) {
        showToast(`Envio parcial: ${result.sent} enviado(s), ${result.failed} falha(s). Veja o log de envio.`, 'error');
      } else {
        showToast(`Enviado com sucesso para ${result.sent} destino(s).`, 'success');
      }
      setContent('');
      setSelectedTargets([]);
      setScheduledAt('');
      setRepeatDaily(false);
      setAttachments([]);
      setCategoryNamesForLog([]);
    } catch (e) {
      showToast((e as Error)?.message || 'Erro no envio imediato.', 'error');
    } finally {
      setIsSendingNow(false);
    }
  };

  const closeSendNowResult = () => {
    setSendNowResult(null);
    if (setView) setView('dashboard');
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-fadeIn">
      <div className="xl:col-span-2">
        <div className="bs-section">
          <h2 className="bs-page-title mb-6">Criar Agendamento</h2>

          <form onSubmit={handleOpenConfirm} className="space-y-6">
            <div className="bg-bs-elevated rounded-xl p-5 space-y-4 border border-bs-border">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-semibold text-bs-text">
                  <i className="fa-solid fa-wand-magic-sparkles mr-2 text-bs-accent"></i>
                  Assistente de IA
                </label>
                {aiProviders.length === 0 && (
                  <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                    IA não configurada no servidor
                  </span>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-bs-muted block mb-1">Template</label>
                <select
                  value={aiTemplate}
                  onChange={(e) => setAiTemplate(e.target.value as AiTemplate)}
                  className="bs-input w-full sm:max-w-xs text-sm font-medium"
                >
                  {TEMPLATE_OPTIONS.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>

              {aiTemplate === 'palavra-do-dia' && (
                <div className="space-y-2">
                  <p className="text-xs text-bs-muted">
                    Digite livro e versículo — typos são corrigidos (ex.: Jenesis → Gênesis). A data do agendamento abaixo define o dia exibido na mensagem.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      className="bs-input flex-1"
                      placeholder="Ex.: Salmos 21:1, Jeremias 32:36"
                      value={bibleReference}
                      onChange={(e) => setBibleReference(e.target.value)}
                      disabled={isGenerating}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleGenerateText();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleGenerateText}
                      disabled={isGenerating || aiProviders.length === 0}
                      className="bs-btn px-5 py-2 whitespace-nowrap disabled:opacity-50"
                    >
                      {isGenerating ? (
                        <><i className="fa-solid fa-spinner animate-spin mr-2"></i>Gerando...</>
                      ) : (
                        '📖 Gerar texto'
                      )}
                    </button>
                  </div>
                </div>
              )}

              {aiTemplate === 'legenda-wpp' && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    className="bs-input flex-1"
                    placeholder="Tema ou briefing — ex.: convite para culto domingo às 19h"
                    value={aiBrief}
                    onChange={(e) => setAiBrief(e.target.value)}
                    disabled={isGenerating}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleGenerateText();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleGenerateText}
                    disabled={isGenerating || aiProviders.length === 0}
                    className="bs-btn px-5 py-2 whitespace-nowrap disabled:opacity-50"
                  >
                    {isGenerating ? (
                      <><i className="fa-solid fa-spinner animate-spin mr-2"></i>Gerando...</>
                    ) : (
                      '✨ Gerar legenda'
                    )}
                  </button>
                </div>
              )}
            </div>

            <div className="relative">
              <label className="block text-sm font-semibold text-bs-text mb-2">Mensagem do WhatsApp</label>
              <textarea
                className="bs-input min-h-[220px] font-mono text-sm"
                placeholder={aiTemplate === 'none' ? 'Digite sua mensagem aqui...' : 'O texto gerado aparecerá aqui — você pode editar antes de agendar'}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />

              {/* Seção de Anexos */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-bs-muted">Anexos ({attachments.length})</span>
                  <span className="text-[10px] text-bs-subtle hidden sm:inline">Imagem/PDF 10 MB · Áudio 20 MB · Vídeo 32 MB (evitar em massa)</span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="bs-link-accent flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-bs-hover"
                  >
                    <i className="fa-solid fa-paperclip"></i>
                    Anexar Arquivo
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
                  <div className="mb-3 rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
                    <p className="font-semibold">
                      <i className="fa-solid fa-triangle-exclamation mr-1.5" />
                      Vídeo anexado — risco de travar a sessão
                    </p>
                    <p className="mt-1 text-bs-muted dark:text-amber-200/80">
                      Para Palavra do Dia e disparo em vários grupos, use <strong>imagem + áudio + texto</strong>.
                      Vídeo só em teste ou poucos destinos. Link do YouTube/Reels no texto é mais seguro.
                    </p>
                  </div>
                )}

                {attachments.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {attachments.map((file, idx) => (
                      <div key={idx} className="relative group aspect-square rounded-xl overflow-hidden border bg-bs-elevated flex flex-col items-center justify-center p-2">
                        {file.type.startsWith('image/') ? (
                          <img src={file.previewUrl} className="w-full h-full object-cover" />
                        ) : file.type.startsWith('video/') ? (
                          <div className="flex flex-col items-center text-blue-500">
                            <i className="fa-solid fa-circle-play text-2xl"></i>
                            <span className="text-[10px] mt-1 truncate w-full text-center">{file.name}</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center text-bs-muted">
                            <i className="fa-solid fa-file-invoice text-2xl"></i>
                            <span className="text-[10px] mt-1 truncate w-full text-center">{file.name}</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeAttachment(idx)}
                          className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <i className="fa-solid fa-times text-xs"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(attachments.length > 0 && content.trim()) && (
                <div className="mt-4 p-4 rounded-xl border border-bs-border bg-bs-elevated/50 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-bs-text">Formato do disparo</p>
                    <p className="text-xs text-bs-muted mt-0.5">
                      Teste qual formato facilita compartilhar a Palavra do Dia nos grupos.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {MEDIA_LAYOUT_OPTIONS.map((opt) => (
                      <label
                        key={opt.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          mediaLayout === opt.id
                            ? 'border-bs-accent bg-bs-accent/10'
                            : 'border-bs-border hover:border-bs-accent/40'
                        }`}
                      >
                        <input
                          type="radio"
                          name="mediaLayout"
                          className="mt-1"
                          checked={mediaLayout === opt.id}
                          onChange={() => setMediaLayout(opt.id)}
                        />
                        <span>
                          <span className="block text-sm font-semibold text-bs-text">{opt.label}</span>
                          <span className="block text-xs text-bs-muted mt-0.5">{opt.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-bs-text mb-2">Agendamento</label>
                <input
                  type="datetime-local"
                  className="bs-input py-3"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 pt-8">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={repeatDaily}
                    onChange={(e) => setRepeatDaily(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-bs-elevated rounded-full peer peer-checked:bg-bs-accent peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-bs-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                  <span className="ml-3 text-sm font-semibold text-bs-text">Repetir Diariamente</span>
                </label>
              </div>
            </div>

            {sendInProgress && (
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
                <i className="fa-solid fa-spinner animate-spin mt-0.5"></i>
                <div>
                  <p className="font-bold">Envio em andamento</p>
                  <p className="text-amber-700/90">Aguarde o disparo atual terminar antes de usar &quot;Enviar agora&quot;.</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <button
                type="submit"
                className="w-full py-3.5 bs-btn font-bold text-base flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-calendar-check"></i>
                Agendar ({selectedTargets.length})
              </button>
              <button
                type="button"
                onClick={handleOpenSendNowConfirm}
                disabled={sendInProgress || isSendingNow}
                title={sendInProgress ? 'Aguarde o envio em andamento terminar' : undefined}
                className="w-full py-3.5 bs-btn-secondary font-bold text-base flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <i className={`fa-solid ${sendInProgress || isSendingNow ? 'fa-spinner animate-spin' : 'fa-paper-plane'}`}></i>
                {sendInProgress ? 'Envio em andamento...' : `Enviar agora (${selectedTargets.length})`}
              </button>
            </div>
          </form>

          {isSendingNow && (
            <div className="mt-4 p-4 bg-bs-elevated border border-bs-border rounded-xl text-sm text-bs-muted flex items-center gap-3">
              <i className="fa-solid fa-spinner animate-spin text-bs-accent" />
              <span>Disparo iniciado — acompanhe o progresso no painel no canto inferior direito.</span>
            </div>
          )}

          {sendNowResult && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
              <div className="bg-bs-surface rounded-2xl shadow-card max-w-lg w-full p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-green-50 text-bs-accent flex items-center justify-center text-xl">
                    <i className="fa-solid fa-circle-check"></i>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-bs-text">Envio concluído</h3>
                    <p className="text-sm text-bs-muted">Confirmação do disparo imediato</p>
                  </div>
                </div>
                <div className="bg-green-50 border border-green-100 rounded-xl p-4 mb-4 space-y-2 text-sm">
                  <p><strong>Enviados:</strong> {sendNowResult.sent} de {sendNowResult.sent + sendNowResult.failed} destino(s)</p>
                  {sendNowResult.failed > 0 && (
                    <>
                      <p className="text-red-600"><strong>Falhas:</strong> {sendNowResult.failed}</p>
                      {sendNowResult.errors && sendNowResult.errors.length > 0 && (
                        <ul className="mt-2 max-h-32 overflow-y-auto text-xs text-red-600 space-y-1">
                          {sendNowResult.errors.slice(0, 8).map((e) => (
                            <li key={e.chatId}><strong>{e.chatName}:</strong> {e.error.slice(0, 80)}{e.error.length > 80 ? '…' : ''}</li>
                          ))}
                          {sendNowResult.errors.length > 8 && (
                            <li>… e mais {sendNowResult.errors.length - 8} falha(s)</li>
                          )}
                        </ul>
                      )}
                    </>
                  )}
                  {(sendNowResult.attachmentCount ?? 0) > 0 && (
                    <p className="text-bs-muted"><strong>Anexos:</strong> {sendNowResult.attachmentCount} arquivo(s)</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={closeSendNowResult}
                  className="w-full py-3 rounded-xl bg-bs-accent text-white font-semibold hover:bg-bs-accent-hover"
                >
                  Ver no Dashboard
                </button>
              </div>
            </div>
          )}

          {showSendNowConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
              <div className="bg-bs-surface rounded-2xl shadow-card max-w-lg w-full max-h-[80vh] flex flex-col p-6">
                <h3 className="text-lg font-bold text-bs-text mb-2">Confirmar envio imediato</h3>
                <p className="text-sm text-bs-muted mb-4">
                  Você vai enviar <strong>agora</strong> para <strong>{selectedTargets.length} grupo(s)/canal(is)</strong>:
                </p>
                <div className="flex-1 overflow-y-auto border border-bs-border rounded-xl p-3 mb-4 max-h-48 space-y-1">
                  {selectedTargets.slice(0, 50).map((id) => (
                    <div key={id} className="text-sm text-bs-text truncate">
                      • {chats.find(c => c.id === id)?.name || id}
                    </div>
                  ))}
                  {selectedTargets.length > 50 && (
                    <div className="text-xs text-bs-muted">... e mais {selectedTargets.length - 50}</div>
                  )}
                </div>
                {attachments.length > 0 && (
                  <p className="text-xs text-bs-muted mb-4">
                    <i className="fa-solid fa-paperclip mr-1"></i>
                    {attachments.length} anexo(s) incluído(s)
                    {content.trim() && (
                      <> · Formato: <strong>{MEDIA_LAYOUT_OPTIONS.find((o) => o.id === mediaLayout)?.label}</strong></>
                    )}
                  </p>
                )}
                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowSendNowConfirm(false)}
                    className="px-4 py-2 rounded-xl border border-bs-border text-bs-text font-semibold hover:bg-bs-elevated"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmSendNow}
                    className="px-4 py-2 rounded-full bs-btn text-sm"
                  >
                    Confirmar e enviar
                  </button>
                </div>
              </div>
            </div>
          )}

          {showConfirmModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
              <div className="bg-bs-surface rounded-2xl shadow-card max-w-lg w-full max-h-[80vh] flex flex-col p-6">
                <h3 className="text-lg font-bold text-bs-text mb-2">Confirmar agendamento</h3>
                <p className="text-sm text-bs-muted mb-4">
                  Você está enviando para <strong>{selectedTargets.length} grupo(s)/canal(is)</strong>:
                </p>
                <div className="flex-1 overflow-y-auto border border-bs-border rounded-xl p-3 mb-4 max-h-48 space-y-1">
                  {selectedTargets.slice(0, 50).map((id) => (
                    <div key={id} className="text-sm text-bs-text truncate">
                      • {chats.find(c => c.id === id)?.name || id}
                    </div>
                  ))}
                  {selectedTargets.length > 50 && (
                    <div className="text-xs text-bs-muted">... e mais {selectedTargets.length - 50}</div>
                  )}
                </div>
                {attachments.length > 0 && (
                  <p className="text-xs text-bs-muted mb-4">
                    <i className="fa-solid fa-paperclip mr-1"></i>
                    {attachments.length} anexo(s)
                    {content.trim() && (
                      <> · Formato: <strong>{MEDIA_LAYOUT_OPTIONS.find((o) => o.id === mediaLayout)?.label}</strong></>
                    )}
                  </p>
                )}
                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    className="px-4 py-2 rounded-xl border border-bs-border text-bs-text font-semibold hover:bg-bs-elevated"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmSubmit}
                    className="px-4 py-2 rounded-xl bg-bs-accent text-white font-semibold hover:bg-bs-accent-hover"
                  >
                    Confirmar envio
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="bs-card rounded-2xl overflow-hidden flex flex-col h-[700px]">
          <div className="p-5 border-b border-bs-border space-y-4 shrink-0">
            <div className="flex justify-between items-center gap-3">
              <div>
                <h3 className="bs-section-title">Canais e Grupos</h3>
                <p className="text-xs text-bs-muted">{selectedTargets.length} de {chats.length} selecionados</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedTargets(chats.map(c => c.id))}
                  className="bs-link-accent"
                >
                  Marcar todos
                </button>
                <span className="text-bs-border">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedTargets([])}
                  className="bs-link hover:text-red-600"
                >
                  Limpar
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-bs-muted">Adicionar por categoria</span>
              <select
                value={selectedCategoryId}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelectedCategoryId(value);
                  if (value) applyCategoryById(value);
                }}
                className="bs-input text-sm py-2 max-w-full"
              >
                <option value="">— Escolha uma categoria —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.groupIds.length} grupos)</option>
                ))}
              </select>
              <p className="text-[10px] text-bs-muted">Ao escolher, os grupos da categoria são adicionados aos destinatários.</p>
            </div>

            <div className="relative">
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-bs-muted text-sm"></i>
              <input
                type="text"
                placeholder="Pesquisar grupos..."
                className="bs-input pl-9 py-2 text-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
            {chats
              .filter(chat => chat.name.toLowerCase().includes(searchTerm.toLowerCase()))
              .map(chat => (
                <label
                  key={chat.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedTargets.includes(chat.id)
                    ? 'border-green-200 bg-green-50'
                    : 'border-transparent hover:bg-bs-hover'
                    }`}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={selectedTargets.includes(chat.id)}
                    onChange={() => handleToggleTarget(chat.id)}
                  />
                  <div className="w-9 h-9 rounded-lg bg-bs-elevated border border-bs-border flex items-center justify-center text-sm text-bs-muted">
                    <i className={`fa-solid ${chat.type === 'group' ? 'fa-user-group' : 'fa-bullhorn'}`}></i>
                  </div>
                  <div className="flex-1 truncate min-w-0">
                    <p className="text-sm font-medium text-bs-text truncate">{chat.name}</p>
                    <p className="text-[10px] text-bs-muted uppercase tracking-wide">{chat.type === 'group' ? 'Grupo' : 'Canal'}</p>
                  </div>
                  {selectedTargets.includes(chat.id) && (
                    <i className="fa-solid fa-check text-bs-accent text-sm"></i>
                  )}
                </label>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Scheduler;
