import React, { useState } from 'react';
import { AiAgent } from '../services/mockStore';
import { usePlatformEntities, usePlatformKv } from '../hooks/usePlatformData';
import type { AttendanceConfig } from './AttendanceSettingsView';
import { useToast } from '../contexts/ToastContext';
import Modal from './Modal';
import Toggle from './Toggle';

import { BRANDING } from '../config/branding';

const PASTORAL_PROMPT = `Você é a atendente virtual do ${BRANDING.productName} pelo WhatsApp — ambiente de testes de ministério cristão evangelístico no Brasil.

Seu papel é ACOLHER e ORIENTAR sobre o ministério. Tom: pastoral, caloroso e breve.

PODE ajudar com cultos, transmissões, células, pedidos de oração e direcionar para ${BRANDING.storeUrl} (sem inventar preços).

NÃO responda perguntas gerais fora do ministério — recuse com gentileza e ofereça digitar "humano" para a equipe.`;

const MODELS = [
  { id: 'support', title: 'Atendimento pastoral', description: 'Tom acolhedor — só ministério e cultos.', icon: 'fa-hands-praying', prompt: PASTORAL_PROMPT, type: 'Atendimento' },
  { id: 'sales', title: 'Vendas semijoias', description: 'Consultora premium — só loja.', icon: 'fa-gem', prompt: `Consultora virtual ${BRANDING.storeName} (${BRANDING.storeUrl}). Só produtos e compras — recuse culto/oração e conhecimento geral.`, type: 'Vendas' },
  { id: 'faq', title: 'FAQ cultos', description: 'Horários e links — escopo fechado.', icon: 'fa-circle-question', prompt: `FAQ de cultos ${BRANDING.productName}. Só horários, YouTube e como participar — recuse qualquer outro assunto.`, type: 'FAQ' },
];

const AiAgentsView: React.FC = () => {
  const { showToast } = useToast();
  const { items: agents, save: saveEntity, remove, loading } = usePlatformEntities<AiAgent>('agents');
  const { value: attendance, save: saveAttendance } = usePlatformKv<AttendanceConfig>('attendance', {
    enabled: true,
    defaultAgentId: 'ag_1',
    provider: null,
    replyDelayMs: 2000,
    maxHistoryMessages: 14,
    humanKeywords: [],
    handoffMessage: '',
    outsideHoursMessage: '',
    businessHours: { enabled: false, start: '08:00', end: '22:00', timezone: 'America/Sao_Paulo' },
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AiAgent | null>(null);

  const blank = (): AiAgent => ({
    id: `ag_${Date.now()}`,
    name: '',
    description: '',
    type: 'Atendimento',
    active: false,
    prompt: '',
    audio: false,
    files: false,
    connection: 'WhatsApp Web',
    createdAt: Date.now(),
  });

  const save = async () => {
    if (!editing?.name.trim()) return showToast('Informe o nome.', 'error');
    try {
      const toSave = { ...editing, prompt: editing.prompt?.trim() || PASTORAL_PROMPT };
      await saveEntity(toSave);
      if (attendance.defaultAgentId === toSave.id && toSave.active) {
        await saveAttendance({ ...attendance, defaultAgentId: toSave.id, enabled: true });
      }
      setOpen(false);
      showToast('Agente salvo.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro', 'error');
    }
  };

  const useInInbox = async (ag: AiAgent) => {
    try {
      const updated = { ...ag, active: true, prompt: ag.prompt?.trim() || PASTORAL_PROMPT };
      await saveEntity(updated);
      await saveAttendance({ ...attendance, defaultAgentId: ag.id, enabled: true });
      showToast(`"${ag.name}" ativo no inbox — atendimento automático ligado.`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao configurar inbox', 'error');
    }
  };

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando agentes…</div>;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:justify-between gap-4">
        <div>
          <h2 className="bs-page-title">Agentes de IA</h2>
          <p className="bs-page-desc mt-1">Configure o agente que responde no inbox — ative em Configurações → Atendimento IA.</p>
        </div>
        <button type="button" onClick={() => { setEditing(blank()); setOpen(true); }} className="bs-btn text-sm px-4 py-2 shrink-0">
          <i className="fa-solid fa-plus mr-2" />Novo Agente
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((ag) => (
          <div key={ag.id} className="bs-card p-5">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-bs-elevated border border-bs-border flex items-center justify-center text-bs-accent">
                  <i className="fa-solid fa-robot" />
                </div>
                <div>
                  <p className="font-bold text-bs-text">{ag.name}</p>
                  <p className="text-xs text-bs-muted">{ag.type} · {ag.connection}</p>
                </div>
              </div>
              <Toggle on={ag.active} onChange={async (v) => {
                try {
                  await saveEntity({ ...ag, active: v });
                  if (!v && attendance.defaultAgentId === ag.id) {
                    showToast('Agente desativado. Escolha outro para o inbox ou ative este novamente.', 'info');
                  }
                } catch (e) {
                  showToast(e instanceof Error ? e.message : 'Erro', 'error');
                }
              }} />
            </div>
            <p className="text-sm text-bs-muted mb-3 line-clamp-2">{ag.description}</p>
            <div className="flex gap-2 mb-3 flex-wrap">
              {attendance.defaultAgentId === ag.id && (
                <span className="bs-badge-accent normal-case text-[9px]">Agente do inbox</span>
              )}
              {ag.audio && <span className="bs-badge-accent normal-case text-[9px]">Áudio</span>}
              {ag.files && <span className="bs-badge-accent normal-case text-[9px]">Arquivos</span>}
              <span className={ag.active ? 'bs-badge-success normal-case text-[9px]' : 'bs-badge-warning normal-case text-[9px]'}>{ag.active ? 'Ativo' : 'Inativo'}</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => { setEditing({ ...ag }); setOpen(true); }} className="bs-link-accent text-xs">Editar</button>
              <button
                type="button"
                onClick={() => useInInbox(ag)}
                className="bs-link-accent text-xs"
              >
                Usar no inbox
              </button>
              <button type="button" onClick={() => { if (confirm('Excluir?')) remove(ag.id); }} className="text-xs text-red-600 font-semibold">Excluir</button>
            </div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-bold text-bs-text mb-3 uppercase tracking-wide">Modelos prontos</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {MODELS.map((m) => (
            <button key={m.id} type="button" onClick={() => {
              saveEntity({ ...blank(), name: m.title, description: m.description, prompt: m.prompt, type: m.type });
              showToast(`Agente "${m.title}" criado.`, 'success');
            }} className="bs-card p-4 text-left">
              <i className={`fa-solid ${m.icon} text-bs-accent mb-2`} />
              <p className="font-semibold text-sm">{m.title}</p>
              <p className="text-xs text-bs-muted">{m.description}</p>
            </button>
          ))}
        </div>
      </div>

      <Modal open={open && !!editing} title="Agente de IA" onClose={() => setOpen(false)} wide>
        {editing && (
          <div className="space-y-4">
            <input className="bs-input" placeholder="Nome" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <input className="bs-input" placeholder="Descrição" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            <select className="bs-input" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
              {['Atendimento', 'Vendas', 'FAQ', 'Operações'].map((t) => <option key={t}>{t}</option>)}
            </select>
            <textarea className="bs-input min-h-[120px] font-mono text-sm" placeholder="Instruções do prompt..." value={editing.prompt} onChange={(e) => setEditing({ ...editing, prompt: e.target.value })} />
            <div className="grid grid-cols-2 gap-4">
              <label className="flex items-center justify-between bs-card p-3 cursor-pointer">
                <span className="text-sm text-bs-text">Áudio</span>
                <Toggle on={editing.audio} onChange={(v) => setEditing({ ...editing, audio: v })} />
              </label>
              <label className="flex items-center justify-between bs-card p-3 cursor-pointer">
                <span className="text-sm text-bs-text">Arquivos</span>
                <Toggle on={editing.files} onChange={(v) => setEditing({ ...editing, files: v })} />
              </label>
            </div>
            <div className="bs-card p-4 border-dashed">
              <p className="text-sm font-semibold text-bs-text mb-2">Base de conhecimento</p>
              <p className="text-xs text-bs-muted mb-2">Mock: site, documentos e sync (sem upload real).</p>
              <button type="button" onClick={() => showToast('Upload mock — arquivo "manual.pdf" adicionado.', 'info')} className="bs-btn-secondary text-xs py-1.5 px-3">
                <i className="fa-solid fa-upload mr-1" />Enviar documento
              </button>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={save} className="bs-btn">Salvar agente</button>
              <button type="button" onClick={() => setOpen(false)} className="bs-btn-secondary">Cancelar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AiAgentsView;
