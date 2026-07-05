import React, { useState, useEffect, useCallback } from 'react';
import { ContentItem } from '../types';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';

const ContentLibrary: React.FC = () => {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const backend = BackendService.getInstance();
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const status = filter === 'all' ? undefined : filter;
      const list = await backend.getContentItems({ status });
      setItems(list);
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [backend, filter, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (id: string, status: 'approved' | 'draft' | 'review') => {
    try {
      await backend.updateContentItem(id, { status });
      showToast(status === 'approved' ? 'Aprovado!' : 'Status atualizado', 'success');
      load();
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Copy copiada!', 'success');
  };

  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('va_token') : '';

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div>
          <h2 className="bs-page-title">Biblioteca de Conteúdo</h2>
          <p className="bs-page-desc mt-1">Material produzido pela equipe — aprove e use nos disparos.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {['all', 'review', 'approved', 'draft'].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${filter === f ? 'bs-filter-active' : 'bs-filter-idle'}`}
            >
              {f === 'all' ? 'Todos' : f === 'review' ? 'Em revisão' : f === 'approved' ? 'Aprovados' : 'Rascunhos'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-bs-muted text-center py-12">Carregando...</p>
      ) : items.length === 0 ? (
        <p className="text-bs-muted text-center py-12">Nenhum conteúdo encontrado.</p>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <div key={item.id} className="bg-bs-surface rounded-2xl border border-bs-border shadow-card p-5 flex flex-col lg:flex-row gap-4">
              {item.type === 'image' && item.imageFilename && (
                <img
                  src={`/api/studio/files/${item.imageFilename}?token=${encodeURIComponent(token || '')}`}
                  alt={item.title || ''}
                  className="w-full lg:w-40 h-40 object-cover rounded-xl shrink-0"
                />
              )}
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-green-700 uppercase">{item.type}</span>
                  <span className="text-xs bg-bs-elevated px-2 py-0.5 rounded-full">{item.userName}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${item.status === 'approved' ? 'bg-green-50 text-green-700' : item.status === 'review' ? 'bg-amber-500/15 text-amber-700' : 'bg-bs-elevated text-bs-muted'}`}>
                    {item.status}
                  </span>
                </div>
                <h3 className="font-bold text-bs-text">{item.title || 'Sem título'}</h3>
                {item.brief && <p className="text-xs text-bs-muted">Brief: {item.brief}</p>}
                {item.type === 'copy' && item.body && (
                  <pre className="text-sm text-bs-text whitespace-pre-wrap bg-bs-elevated p-3 rounded-xl max-h-48 overflow-auto">{item.body}</pre>
                )}
                <p className="text-xs text-bs-muted">{new Date(item.updatedAt).toLocaleString('pt-BR')}</p>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                {item.type === 'copy' && item.body && (
                  <button type="button" onClick={() => copyText(item.body!)} className="bg-green-50 text-green-700 px-3 py-2 rounded-lg text-sm font-semibold">
                    Copiar texto
                  </button>
                )}
                {item.type === 'image' && item.imageFilename && (
                  <a
                    href={`/api/studio/files/${item.imageFilename}?token=${encodeURIComponent(token || '')}`}
                    download
                    className="bg-green-50 text-green-700 px-3 py-2 rounded-lg text-sm font-semibold text-center"
                  >
                    Baixar imagem
                  </a>
                )}
                {item.status !== 'approved' && (
                  <button type="button" onClick={() => setStatus(item.id, 'approved')} className="bg-bs-accent text-white px-3 py-2 rounded-lg text-sm font-semibold">
                    Aprovar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ContentLibrary;
