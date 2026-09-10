import React, { useState } from 'react';
import { Flow } from '../services/mockStore';
import { usePlatformEntities } from '../hooks/usePlatformData';
import { useToast } from '../contexts/ToastContext';
import FlowBuilder, { createEmptyFlow } from './FlowBuilder';

const FlowsView: React.FC = () => {
  const { showToast } = useToast();
  const { items: flows, save: saveEntity, remove, loading } = usePlatformEntities<Flow>('flows');
  const [editing, setEditing] = useState<Flow | null>(null);

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando fluxos…</div>;
  }

  if (editing) {
    return (
      <FlowBuilder
        flow={editing}
        onSave={async (f) => {
          try {
            await saveEntity(f);
            setEditing(null);
            showToast('Fluxo salvo.', 'success');
          } catch (e) {
            showToast(e instanceof Error ? e.message : 'Erro', 'error');
          }
        }}
        onClose={() => setEditing(null)}
        onDelete={() => {
          if (confirm('Excluir este fluxo?')) {
            remove(editing.id).then(() => {
              setEditing(null);
              showToast('Fluxo excluído.', 'success');
            });
          }
        }}
      />
    );
  }

  const blockCount = (f: Flow) =>
    (f.nodes || []).filter((n) => n.data.blockType !== 'trigger' && n.data.blockType !== 'end').length || f.blocks.length;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:justify-between gap-4">
        <div>
          <h2 className="bs-page-title">Fluxos</h2>
          <p className="bs-page-desc mt-1">
            Automação por palavra-chave — mensagem, espera, tag e transferir humano. Ative o fluxo e teste no WhatsApp.
          </p>
        </div>
        <button type="button" onClick={() => setEditing(createEmptyFlow())} className="bs-btn text-sm px-4 py-2 shrink-0">
          <i className="fa-solid fa-plus mr-2" />Novo Fluxo
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {flows.map((f) => (
          <div key={f.id} className="bs-card p-5 flex flex-col">
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="font-bold text-bs-text">{f.name}</p>
              <span className={f.active ? 'bs-badge-success normal-case text-[9px]' : 'bs-badge-warning normal-case text-[9px]'}>
                {f.active ? 'Ativo' : 'Inativo'}
              </span>
            </div>
            <p className="text-xs text-bs-muted mb-1">Gatilho: {f.trigger}</p>
            <p className="text-xs text-bs-subtle mb-4">{blockCount(f)} bloco(s)</p>
            <button type="button" onClick={() => setEditing(f)} className="bs-btn-secondary text-xs py-2 mt-auto">
              Abrir editor →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FlowsView;
