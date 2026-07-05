import React, { useEffect, useState } from 'react';
import { useToast } from '../contexts/ToastContext';
import { usePlatformEntities, usePlatformKv } from '../hooks/usePlatformData';
import type { AiAgent } from '../services/mockStore';
import Toggle from './Toggle';

export interface AttendanceConfig {
  enabled: boolean;
  defaultAgentId: string;
  provider: string | null;
  replyDelayMs: number;
  maxHistoryMessages: number;
  humanKeywords: string[];
  handoffMessage: string;
  outsideHoursMessage: string;
  businessHours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
}

const FALLBACK: AttendanceConfig = {
  enabled: true,
  defaultAgentId: 'ag_1',
  provider: null,
  replyDelayMs: 2000,
  maxHistoryMessages: 14,
  humanKeywords: ['humano', 'atendente', 'pessoa'],
  handoffMessage: 'Entendi! Um atendente humano vai assumir em breve. Obrigada pela paciência! 🙏',
  outsideHoursMessage: 'Olá! Nosso atendimento automático está disponível das 8h às 22h. Deixe sua mensagem que retornamos em breve. 🙏',
  businessHours: { enabled: false, start: '08:00', end: '22:00', timezone: 'America/Sao_Paulo' },
};

const AttendanceSettingsView: React.FC = () => {
  const { showToast } = useToast();
  const { value: cfg, save, loading } = usePlatformKv<AttendanceConfig>('attendance', FALLBACK);
  const { items: agents } = usePlatformEntities<AiAgent>('agents');
  const [local, setLocal] = useState(cfg);

  useEffect(() => setLocal(cfg), [cfg]);

  const persist = async (next: AttendanceConfig) => {
    setLocal(next);
    try {
      await save(next);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erro ao salvar', 'error');
    }
  };

  const handleSave = async () => {
    await persist(local);
    showToast('Configuração de atendimento salva.', 'success');
  };

  const activeAgents = agents.filter((a) => a.active);

  if (loading) {
    return <div className="text-sm text-bs-muted animate-pulse p-6">Carregando atendimento…</div>;
  }

  return (
    <div className="space-y-6 animate-fadeIn max-w-3xl">
      <div>
        <h2 className="bs-page-title">Atendimento automático</h2>
        <p className="bs-page-desc mt-1">Agente de IA responde conversas privadas no WhatsApp conectado.</p>
      </div>

      <div className="bs-section space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-bs-text">Atendimento por IA</p>
            <p className="text-xs text-bs-muted">Quando ligado, o agente responde mensagens privadas automaticamente.</p>
          </div>
          <Toggle on={local.enabled} onChange={(v) => persist({ ...local, enabled: v })} />
        </div>

        <div>
          <label className="text-xs text-bs-muted mb-1 block">Agente padrão do inbox</label>
          <select
            className="bs-input"
            value={local.defaultAgentId}
            onChange={(e) => setLocal({ ...local, defaultAgentId: e.target.value })}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.active ? '' : ' (inativo)'}
              </option>
            ))}
          </select>
        {activeAgents.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">Nenhum agente ativo — clique em &quot;Usar no inbox&quot; em Agentes de IA.</p>
          )}
          {local.enabled && activeAgents.length > 0 && !activeAgents.some((a) => a.id === local.defaultAgentId) && (
            <p className="text-xs text-amber-600 mt-1">O agente selecionado está inativo — escolha um ativo ou use &quot;Usar no inbox&quot;.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-bs-muted mb-1 block">Delay antes de responder (ms)</label>
            <input
              type="number"
              className="bs-input"
              min={500}
              max={10000}
              step={500}
              value={local.replyDelayMs}
              onChange={(e) => setLocal({ ...local, replyDelayMs: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="text-xs text-bs-muted mb-1 block">Mensagens de contexto (histórico)</label>
            <input
              type="number"
              className="bs-input"
              min={4}
              max={24}
              value={local.maxHistoryMessages}
              onChange={(e) => setLocal({ ...local, maxHistoryMessages: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      <div className="bs-section space-y-4">
        <h3 className="bs-section-title">Encaminhar para humano</h3>
        <div>
          <label className="text-xs text-bs-muted mb-1 block">Palavras-chave (separadas por vírgula)</label>
          <input
            className="bs-input"
            value={local.humanKeywords.join(', ')}
            onChange={(e) => setLocal({
              ...local,
              humanKeywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
            })}
          />
        </div>
        <div>
          <label className="text-xs text-bs-muted mb-1 block">Mensagem ao pedir humano</label>
          <textarea
            className="bs-input min-h-[70px]"
            value={local.handoffMessage}
            onChange={(e) => setLocal({ ...local, handoffMessage: e.target.value })}
          />
        </div>
      </div>

      <div className="bs-section space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-bs-text">Horário de atendimento</p>
            <p className="text-xs text-bs-muted">Fora do horário, envia mensagem automática e não chama a IA.</p>
          </div>
          <Toggle
            on={local.businessHours.enabled}
            onChange={(v) => setLocal({ ...local, businessHours: { ...local.businessHours, enabled: v } })}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-bs-muted mb-1 block">Início</label>
            <input
              type="time"
              className="bs-input"
              value={local.businessHours.start}
              onChange={(e) => setLocal({ ...local, businessHours: { ...local.businessHours, start: e.target.value } })}
              disabled={!local.businessHours.enabled}
            />
          </div>
          <div>
            <label className="text-xs text-bs-muted mb-1 block">Fim</label>
            <input
              type="time"
              className="bs-input"
              value={local.businessHours.end}
              onChange={(e) => setLocal({ ...local, businessHours: { ...local.businessHours, end: e.target.value } })}
              disabled={!local.businessHours.enabled}
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-bs-muted mb-1 block">Mensagem fora do horário</label>
          <textarea
            className="bs-input min-h-[70px]"
            value={local.outsideHoursMessage}
            onChange={(e) => setLocal({ ...local, outsideHoursMessage: e.target.value })}
            disabled={!local.businessHours.enabled}
          />
        </div>
      </div>

          <button type="button" onClick={handleSave} className="bs-btn">Salvar atendimento</button>

      <div className="bs-card p-4 border-dashed text-xs text-bs-muted space-y-2">
        <p className="font-semibold text-bs-text text-sm">Como ativar o bot</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Vá em <strong>Agentes de IA</strong> → clique <strong>Usar no inbox</strong> no agente desejado</li>
          <li>Confirme que <strong>Atendimento por IA</strong> está ligado aqui</li>
          <li>Envie uma mensagem privada para o WhatsApp conectado</li>
        </ol>
        <p className="text-amber-600">O agente precisa estar <strong>ativo</strong> — o botão &quot;Usar no inbox&quot; já ativa automaticamente.</p>
      </div>
    </div>
  );
};

export default AttendanceSettingsView;
