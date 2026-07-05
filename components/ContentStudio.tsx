import React, { useState, useEffect, useCallback } from 'react';
import { User, ContentItem } from '../types';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';
import { BRANDING } from '../config/branding';
import StudioSidebar, { StudioTab } from './StudioSidebar';
import AiAssistant from './AiAssistant';
import TemplatesView from './TemplatesView';

interface ContentStudioProps {
  user: User;
  onLogout: () => void;
}

const ContentStudio: React.FC<ContentStudioProps> = ({ user, onLogout }) => {
  const [tab, setTab] = useState<StudioTab>('assistant');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const backend = BackendService.getInstance();
  const { showToast } = useToast();

  const loadItems = useCallback(async () => {
    try {
      setItems(await backend.getContentItems());
    } catch {
      /* ignore */
    }
  }, [backend]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleSaveCopyFromChat = async (text: string) => {
    try {
      await backend.studioSaveCopy({ title: 'Assistente IA', body: text });
      showToast('Copy salva em Minhas criações!', 'success');
      loadItems();
      setTab('mine');
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const handleGenerateImage = async () => {
    if (!imagePrompt.trim()) {
      showToast('Descreva a imagem que deseja.', 'error');
      return;
    }
    setLoading(true);
    setGeneratedImageUrl(null);
    try {
      const result = await backend.studioGenerateImage({
        prompt: imagePrompt.trim(),
        aspectRatio,
        title: imagePrompt.slice(0, 80)
      });
      const url = result.image.url;
      const token = localStorage.getItem('va_token');
      setGeneratedImageUrl(`${url}${token ? `?token=${encodeURIComponent(token)}` : ''}`);
      showToast('Imagem gerada e salva!', 'success');
      loadItems();
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const submitForReview = async (id: string) => {
    try {
      await backend.updateContentItem(id, { status: 'review' });
      showToast('Enviado para revisão!', 'success');
      loadItems();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const statusLabel: Record<string, string> = {
    draft: 'Rascunho',
    review: 'Em revisão',
    approved: 'Aprovado'
  };

  return (
    <div className="flex h-screen bg-bs-canvas overflow-hidden relative">
      <StudioSidebar
        currentTab={tab}
        setTab={(t) => { setTab(t); setIsMobileMenuOpen(false); }}
        onLogout={onLogout}
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
      />

      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-black/60 z-20 md:hidden backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      <main className="flex-1 flex flex-col h-full overflow-hidden w-full">
        <header className="h-16 bg-bs-shell border-b border-bs-border px-4 md:px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden w-10 h-10 flex items-center justify-center text-bs-muted hover:text-bs-accent rounded-xl"
            >
              <i className="fa-solid fa-bars text-xl"></i>
            </button>
            <div>
              <p className="text-sm font-bold text-bs-text">Estúdio Semijoias</p>
              <p className="text-[10px] text-bs-accent uppercase tracking-wide">{BRANDING.storeName}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold text-bs-text">{user.name}</p>
            <p className="text-[10px] text-bs-muted">Equipe de conteúdo</p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
          {tab === 'assistant' && (
            <AiAssistant role="creator" onUseText={handleSaveCopyFromChat} />
          )}

          {tab === 'templates' && (
            <TemplatesView role="creator" onGeneratedCopy={() => { loadItems(); setTab('mine'); }} />
          )}

          {tab === 'image' && (
            <div className="bs-card p-6 space-y-4 max-w-3xl">
              <h2 className="font-bold text-bs-text">Gerar imagem para a loja</h2>
              <p className="text-sm text-bs-muted">Posts de semijoias, combos, promoções — estilo elegante {BRANDING.storeName}.</p>
              <textarea
                className="bs-input min-h-[100px]"
                placeholder={`Ex.: Colar Mezuzah banhado a ouro, fundo escuro elegante, brilho premium, estilo ${BRANDING.storeUrl.replace(/^https?:\/\//, '')}...`}
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
              />
              <div className="flex gap-2 flex-wrap items-center">
                <span className="text-sm text-bs-muted font-medium">Formato:</span>
                {['1:1', '9:16', '16:9', '4:3'].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAspectRatio(r)}
                    className={`px-3 py-1 rounded-lg text-sm font-semibold ${aspectRatio === r ? 'bg-bs-accent text-black' : 'bg-bs-elevated text-bs-muted border border-bs-border'}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <button type="button" disabled={loading} onClick={handleGenerateImage} className="bs-btn px-6 py-2.5 disabled:opacity-50">
                {loading ? 'Gerando imagem...' : '🎨 Gerar imagem'}
              </button>
              {generatedImageUrl && (
                <div className="mt-4 p-4 border border-bs-border rounded-xl bg-bs-elevated">
                  <img src={generatedImageUrl} alt="Gerada" className="max-w-full rounded-lg mx-auto max-h-96" />
                  <a href={generatedImageUrl} download className="block text-center mt-3 text-bs-accent font-semibold text-sm hover:text-bs-accent">
                    Baixar imagem
                  </a>
                </div>
              )}
            </div>
          )}

          {tab === 'mine' && (
            <div className="space-y-3 max-w-4xl">
              {items.length === 0 && (
                <p className="text-bs-muted text-center py-12">Nenhuma criação ainda. Comece no Assistente, Templates ou Imagem.</p>
              )}
              {items.map((item) => (
                <div key={item.id} className="bs-card p-4 flex flex-col md:flex-row gap-4">
                  {item.type === 'image' && item.imageFilename && (
                    <img
                      src={`/api/studio/files/${item.imageFilename}?token=${encodeURIComponent(localStorage.getItem('va_token') || '')}`}
                      alt={item.title || ''}
                      className="w-24 h-24 object-cover rounded-lg shrink-0 border border-bs-border"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-bold uppercase text-bs-accent">{item.type === 'copy' ? 'Copy' : 'Imagem'}</span>
                      <span className="text-xs bg-bs-elevated text-bs-muted px-2 py-0.5 rounded-full border border-bs-border">{statusLabel[item.status] || item.status}</span>
                    </div>
                    <p className="font-semibold text-bs-text truncate">{item.title || 'Sem título'}</p>
                    {item.type === 'copy' && item.body && (
                      <p className="text-sm text-bs-muted mt-1 line-clamp-3 whitespace-pre-wrap">{item.body}</p>
                    )}
                    <p className="text-xs text-bs-muted/70 mt-2">{new Date(item.createdAt).toLocaleString('pt-BR')}</p>
                  </div>
                  {item.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => submitForReview(item.id)}
                      className="self-start bs-btn px-3 py-2 text-sm whitespace-nowrap"
                    >
                      Enviar p/ revisão
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ContentStudio;
