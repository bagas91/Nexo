import React, { useState } from 'react';
import { FollowUp, FollowUpStep, FollowUpStepType } from '../services/mockStore';
import { usePlatformEntities } from '../hooks/usePlatformData';
import { useToast } from '../contexts/ToastContext';
import Modal from './Modal';
import Toggle from './Toggle';
import type { FeatureModel } from './FeatureShellView';

const MODELS: FeatureModel[] = [
  { id: 'welcome', title: 'Boas-vindas', description: 'Sequência para novos contatos.', icon: 'fa-hand-sparkles', tag: 'Popular' },
  { id: 'noshow', title: 'Reengajamento', description: 'Follow up após 24h sem interação.', icon: 'fa-clock-rotate-left' },
  { id: 'event', title: 'Pré-culto', description: 'Lembretes D-1 e H-1.', icon: 'fa-church' },
  { id: 'promo', title: 'Promoção loja', description: '3 mensagens para lançamentos.', icon: 'fa-tags' },
];

const STEP_TYPES: { type: FollowUpStepType; label: string; icon: string }[] = [
  { type: 'wait', label: 'Esperar', icon: 'fa-clock' },
  { type: 'message', label: 'Mensagem', icon: 'fa-message' },
  { type: 'tag', label: 'Tag', icon: 'fa-tag' },
  { type: 'condition', label: 'Condição', icon: 'fa-code-branch' },
  { type: 'webhook', label: 'Webhook', icon: 'fa-link' },
];

function newStep(type: FollowUpStepType): FollowUpStep {
  const base = { id: `st_${Date.now()}`, type, label: STEP_TYPES.find((s) => s.type === type)?.label || type, config: {} as Record<string, string> };
  if (type === 'wait') base.config = { minutes: '60' };
  if (type === 'message') base.config = { text: 'Olá {{name}}!' };
  if (type === 'tag') base.config = { tag: 'novo' };
  if (type === 'webhook') base.config = { url: 'https://...' };
  return base;
}

const FollowUpsView: React.FC = () => {
  const { showToast } = useToast();
  const { items, save: saveEntity, remove, loading } = usePlatformEntities<FollowUp>('followups');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<FollowUp | null>(null);

  const openNew = () => {
    setEditing({
      id: `fu_${Date.now()}`,
      name: '',
      active: false,
      trigger: 'Novo contato',
      steps: [newStep('message')],
      createdAt: Date.now(),
    });
    setEditorOpen(true);
  };

  const openEdit = (fu: FollowUp) => {
    setEditing({ ...fu, steps: fu.steps.map((s) => ({ ...s, config: { ...s.config } })) });
    setEditorOpen(true);
  };

  const save = async () => {
    if (!editing?.name.trim()) {
      showToast('Informe o nome.', 'error');
      return;
    }
    try {
      await saveEntity(editing);
      setEditorOpen(false);
      showToast('Follow up salvo.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao salvar', 'error');
    }
  };

  const useModel = async (m: FeatureModel) => {
    const steps: FollowUpStep[] =
      m.id === 'welcome'
        ? [newStep('wait'), newStep('message')]
        : m.id === 'event'
          ? [newStep('message'), newStep('wait'), newStep('message')]
          : [newStep('message')];
    try {
      await saveEntity({ id: `fu_${Date.now()}`, name: m.title, active: false, trigger: 'Manual', steps, createdAt: Date.now() });
      showToast(`Modelo "${m.title}" adicionado.`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro', 'error');
    }
  };

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando follow ups…</div>;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="bs-page-title">Follow Ups</h2>
          <p className="bs-page-desc mt-1">Sequências com espera, mensagem, tag e webhook.</p>
        </div>
        <button type="button" onClick={openNew} className="bs-btn px-4 py-2 text-sm shrink-0">
          <i className="fa-solid fa-plus mr-2" />Novo Follow Up
        </button>
      </div>

      <div className="bs-table-wrap">
        <div className="bs-table-toolbar">
          <span className="text-sm text-bs-muted">{items.length} sequência(s)</span>
        </div>
        <table className="bs-table">
          <thead className="bs-table-head">
            <tr>
              <th>Nome</th>
              <th>Trigger</th>
              <th>Passos</th>
              <th>Status</th>
              <th className="text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.map((fu) => (
              <tr key={fu.id} className="bs-table-row">
                <td className="font-medium text-bs-text">{fu.name}</td>
                <td className="text-bs-muted text-sm">{fu.trigger}</td>
                <td className="text-bs-muted">{fu.steps.length}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => saveEntity({ ...fu, active: !fu.active })}
                    className={fu.active ? 'bs-badge-success normal-case cursor-pointer' : 'bs-badge-warning normal-case cursor-pointer'}
                  >
                    {fu.active ? 'Ativo' : 'Inativo'}
                  </button>
                </td>
                <td className="text-right">
                  <button type="button" onClick={() => openEdit(fu)} className="bs-link-accent mr-2">Editar</button>
                  <button type="button" onClick={() => { if (confirm('Excluir?')) { remove(fu.id).then(() => showToast('Excluído.', 'success')); } }} className="text-xs font-semibold text-red-600">Excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-sm font-bold text-bs-text mb-3 uppercase tracking-wide">Modelos prontos</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {MODELS.map((m) => (
            <button key={m.id} type="button" onClick={() => useModel(m)} className="bs-card p-4 text-left hover:border-bs-accent/40 transition-colors">
              <i className={`fa-solid ${m.icon} text-bs-accent mb-2`} />
              <p className="font-semibold text-sm text-bs-text">{m.title}</p>
              <p className="text-xs text-bs-muted mt-1">{m.description}</p>
            </button>
          ))}
        </div>
      </div>

      <Modal open={editorOpen && !!editing} title={editing?.name ? 'Editar Follow Up' : 'Novo Follow Up'} onClose={() => setEditorOpen(false)} wide>
        {editing && (
          <div className="space-y-4">
            <input className="bs-input" placeholder="Nome" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <input className="bs-input" placeholder="Trigger" value={editing.trigger} onChange={(e) => setEditing({ ...editing, trigger: e.target.value })} />
            <div className="flex items-center gap-3">
              <span className="text-sm text-bs-muted">Ativo</span>
              <Toggle on={editing.active} onChange={(v) => setEditing({ ...editing, active: v })} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-bs-text">Passos</p>
              {editing.steps.map((step, idx) => (
                <div key={step.id} className="flex gap-2 items-start p-3 rounded-lg border border-bs-border bg-bs-elevated">
                  <span className="text-xs text-bs-subtle font-mono pt-2">{idx + 1}</span>
                  <div className="flex-1 space-y-2">
                    <select className="bs-input py-1.5 text-sm" value={step.type} onChange={(e) => {
                      const next = newStep(e.target.value as FollowUpStepType);
                      next.id = step.id;
                      const steps = [...editing.steps];
                      steps[idx] = next;
                      setEditing({ ...editing, steps });
                    }}>
                      {STEP_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                    </select>
                    {step.type === 'wait' && (
                      <input className="bs-input py-1.5 text-sm" placeholder="Minutos" value={step.config.minutes || ''} onChange={(e) => {
                        const steps = [...editing.steps];
                        steps[idx] = { ...step, config: { minutes: e.target.value } };
                        setEditing({ ...editing, steps });
                      }} />
                    )}
                    {step.type === 'message' && (
                      <textarea className="bs-input text-sm min-h-[60px]" value={step.config.text || ''} onChange={(e) => {
                        const steps = [...editing.steps];
                        steps[idx] = { ...step, config: { text: e.target.value } };
                        setEditing({ ...editing, steps });
                      }} />
                    )}
                    {(step.type === 'tag' || step.type === 'webhook') && (
                      <input className="bs-input py-1.5 text-sm" placeholder={step.type === 'tag' ? 'Nome da tag' : 'URL'} value={step.config[step.type === 'tag' ? 'tag' : 'url'] || ''} onChange={(e) => {
                        const steps = [...editing.steps];
                        steps[idx] = { ...step, config: step.type === 'tag' ? { tag: e.target.value } : { url: e.target.value } };
                        setEditing({ ...editing, steps });
                      }} />
                    )}
                  </div>
                  <button type="button" onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, i) => i !== idx) })} className="text-bs-muted hover:text-red-600 pt-1">
                    <i className="fa-solid fa-trash text-xs" />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                {STEP_TYPES.map((t) => (
                  <button key={t.type} type="button" onClick={() => setEditing({ ...editing, steps: [...editing.steps, newStep(t.type)] })} className="bs-btn-secondary text-xs py-1.5 px-2">
                    <i className={`fa-solid ${t.icon} mr-1`} />{t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={save} className="bs-btn">Salvar</button>
              <button type="button" onClick={() => setEditorOpen(false)} className="bs-btn-secondary">Cancelar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default FollowUpsView;
