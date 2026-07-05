import React, { useState } from 'react';
import { mockStore, WidgetConfig } from '../services/mockStore';
import { useMockStore } from '../hooks/useMockStore';
import { useToast } from '../contexts/ToastContext';
import MockBanner from './MockBanner';
import Toggle from './Toggle';
import { BRANDING } from '../config/branding';

const WidgetSettingsView: React.FC = () => {
  useMockStore();
  const { showToast } = useToast();
  const widgets = mockStore.getWidgets();
  const [editing, setEditing] = useState<Partial<WidgetConfig> | null>(
    widgets[0] || {
      name: 'Meu Widget',
      active: true,
      attendant: 'Atendente',
      welcome: 'Olá! Como posso ajudar?',
      showBubble: true,
      color: '#16a34a',
      position: 'right',
      instance: 'WhatsApp Web',
    }
  );
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [showEmbed, setShowEmbed] = useState(false);

  const save = () => {
    if (!editing?.name) return showToast('Informe o nome.', 'error');
    const item: WidgetConfig = {
      id: editing.id || `wg_${Date.now()}`,
      name: editing.name,
      active: editing.active ?? true,
      attendant: editing.attendant || 'Atendente',
      welcome: editing.welcome || '',
      showBubble: editing.showBubble ?? true,
      color: editing.color || '#16a34a',
      position: editing.position || 'right',
      instance: editing.instance || 'WhatsApp Web',
      embedId: editing.embedId || `embed_${Math.random().toString(36).slice(2, 10)}`,
      createdAt: editing.createdAt || Date.now(),
    };
    mockStore.saveWidget(item);
    setEditing(item);
    setShowEmbed(true);
    showToast('Widget salvo (mock).', 'success');
  };

  const embedCode = editing?.embedId
    ? `<script src="https://bagstudio.app/widget/${editing.embedId}.js" async></script>`
    : '';

  return (
    <div className="space-y-6 animate-fadeIn">
      <MockBanner />
      <div>
        <h2 className="bs-page-title">Widget para site</h2>
        <p className="bs-page-desc mt-1">Configure, salve e copie o código embed (mock).</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bs-section space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-bs-text">{editing?.id ? 'Editar Widget' : 'Novo Widget'}</span>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-bs-muted">Ativo</span>
              <Toggle on={editing?.active ?? true} onChange={(v) => setEditing({ ...editing, active: v })} />
            </div>
          </div>
          <input className="bs-input" placeholder="Nome" value={editing?.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <input className="bs-input" placeholder="Nome no cabeçalho" value={editing?.attendant || ''} onChange={(e) => setEditing({ ...editing, attendant: e.target.value })} />
          <textarea className="bs-input min-h-[80px]" value={editing?.welcome || ''} onChange={(e) => setEditing({ ...editing, welcome: e.target.value })} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-bs-muted">Exibir balão</span>
            <Toggle on={editing?.showBubble ?? true} onChange={(v) => setEditing({ ...editing, showBubble: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input type="color" value={editing?.color || '#16a34a'} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="w-full h-10 rounded border border-bs-border" />
            <select className="bs-input" value={editing?.position || 'right'} onChange={(e) => setEditing({ ...editing, position: e.target.value as 'right' | 'left' })}>
              <option value="right">Direita</option>
              <option value="left">Esquerda</option>
            </select>
          </div>
          <select className="bs-input" value={editing?.instance || ''} onChange={(e) => setEditing({ ...editing, instance: e.target.value })}>
            <option value="">Selecione conexão</option>
            <option value="WhatsApp Web">WhatsApp Web ({BRANDING.tenantName})</option>
          </select>
          <button type="button" onClick={save} className="bs-btn w-full py-2.5">Salvar Widget</button>
          {showEmbed && embedCode && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-bs-text">Código embed</p>
              <pre className="text-xs bg-bs-elevated border border-bs-border rounded-lg p-3 overflow-x-auto">{embedCode}</pre>
              <button type="button" onClick={() => { navigator.clipboard.writeText(embedCode); showToast('Código copiado!', 'success'); }} className="bs-btn-secondary text-xs py-1.5 px-3">Copiar script</button>
            </div>
          )}
        </div>

        <div className="bs-card p-5">
          <div className="flex justify-between mb-4">
            <p className="text-[10px] font-bold uppercase text-bs-subtle">Pré-visualização</p>
            <div className="flex bg-bs-elevated p-0.5 rounded-lg border border-bs-border">
              {(['desktop', 'mobile'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setPreviewMode(m)} className={`px-3 py-1 rounded-md text-xs font-semibold ${previewMode === m ? 'bs-filter-active' : 'bs-filter-idle'}`}>{m === 'desktop' ? 'Desktop' : 'Mobile'}</button>
              ))}
            </div>
          </div>
          <div className={`mx-auto rounded-xl border-2 border-bs-border bg-bs-elevated overflow-hidden ${previewMode === 'mobile' ? 'max-w-[280px]' : ''}`}>
            <div className="h-6 bg-bs-border/50 flex items-center px-2"><span className="text-[9px] text-bs-subtle">www.seusite.com.br</span></div>
            <div className="relative h-48 bg-bs-shell">
              <div className={`absolute bottom-3 flex flex-col gap-2 ${editing?.position === 'left' ? 'left-3 items-start' : 'right-3 items-end'}`}>
                {editing?.showBubble && editing?.active && (
                  <div className="bg-bs-shell border border-bs-border rounded-xl px-3 py-2 text-xs max-w-[180px]">{editing.welcome}</div>
                )}
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: editing?.color || '#16a34a' }}>
                  <i className="fa-brands fa-whatsapp text-xl" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {widgets.length > 1 && (
        <div className="bs-table-wrap">
          <div className="bs-table-toolbar"><span className="text-sm text-bs-muted">{widgets.length} widgets</span></div>
          <table className="bs-table">
            <thead className="bs-table-head"><tr><th>Nome</th><th>Instância</th><th>Status</th></tr></thead>
            <tbody>
              {widgets.map((w) => (
                <tr key={w.id} className="bs-table-row cursor-pointer" onClick={() => setEditing(w)}>
                  <td className="font-medium">{w.name}</td>
                  <td className="text-bs-muted text-sm">{w.instance || '—'}</td>
                  <td><span className={w.active ? 'bs-badge-success normal-case' : 'bs-badge-warning normal-case'}>{w.active ? 'Ativo' : 'Inativo'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default WidgetSettingsView;
