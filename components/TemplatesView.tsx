import React, { useState, useEffect } from 'react';
import { View } from '../types';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';
import MockBanner from './MockBanner';
import { BRANDING } from '../config/branding';

type TemplateId =
  | 'palavra-do-dia'
  | 'legenda-wpp'
  | 'convite-culto'
  | 'post-semijoia'
  | 'story-instagram'
  | 'promo-combo'
  | 'descricao-produto';

interface TemplateDef {
  id: TemplateId;
  label: string;
  icon: string;
  description: string;
  superadminOnly?: boolean;
  studioOnly?: boolean;
}

const TEMPLATES: TemplateDef[] = [
  {
    id: 'palavra-do-dia',
    label: 'Palavra do Dia',
    icon: 'fa-book-bible',
    description: 'Referência bíblica → mensagem pastoral completa (só operação/disparos).',
    superadminOnly: true
  },
  {
    id: 'convite-culto',
    label: 'Convite de culto',
    icon: 'fa-church',
    description: 'Convite pastoral para culto online ou presencial.',
    superadminOnly: true
  },
  {
    id: 'legenda-wpp',
    label: 'Legenda WhatsApp',
    icon: 'fa-brands fa-whatsapp',
    description: 'Briefing livre → legenda para grupos e disparos.',
    superadminOnly: true
  },
  {
    id: 'post-semijoia',
    label: 'Post de semijoia',
    icon: 'fa-gem',
    description: 'Produto ou coleção → legenda elegante para Instagram/Facebook.',
    studioOnly: true
  },
  {
    id: 'story-instagram',
    label: 'Story Instagram',
    icon: 'fa-brands fa-instagram',
    description: 'Promoção ou peça em destaque → texto curto para story.',
    studioOnly: true
  },
  {
    id: 'promo-combo',
    label: 'Promoção / Combo',
    icon: 'fa-tags',
    description: 'Oferta, desconto ou combo → copy com CTA de compra.',
    studioOnly: true
  },
  {
    id: 'descricao-produto',
    label: 'Descrição de produto',
    icon: 'fa-ring',
    description: 'Nome e detalhes da peça → descrição premium para loja.',
    studioOnly: true
  }
];

interface TemplatesViewProps {
  role?: 'superadmin' | 'creator';
  onNavigate?: (view: View) => void;
  onGeneratedCopy?: (text: string) => void;
}

const TemplatesView: React.FC<TemplatesViewProps> = ({ role = 'superadmin', onNavigate, onGeneratedCopy }) => {
  const [selected, setSelected] = useState<TemplateId | null>(null);
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [providers, setProviders] = useState<string[]>([]);
  const [bibleReference, setBibleReference] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [brief, setBrief] = useState('');
  const [cultoData, setCultoData] = useState('');
  const [cultoHorario, setCultoHorario] = useState('');
  const [cultoTema, setCultoTema] = useState('');

  const backend = BackendService.getInstance();
  const { showToast } = useToast();
  const isStudio = role === 'creator';

  const availableTemplates = TEMPLATES.filter((t) => {
    if (isStudio) return t.studioOnly;
    return !t.studioOnly;
  });

  useEffect(() => {
    backend.getAiProviders().then(({ providers: p, defaultProvider }) => {
      setProviders(p);
      if (defaultProvider === 'gemini' || defaultProvider === 'openai') {
        setProvider(defaultProvider);
      }
    }).catch(() => setProviders([]));
  }, [backend]);

  const resetForm = () => {
    setOutput('');
    setBibleReference('');
    setBrief('');
    setCultoData('');
    setCultoHorario('');
    setCultoTema('');
  };

  const selectTemplate = (id: TemplateId) => {
    setSelected(id);
    resetForm();
  };

  const generatePalavraDoDia = async () => {
    if (!bibleReference.trim()) {
      showToast('Informe a referência bíblica (ex.: Gênesis 10:30).', 'error');
      return;
    }
    setLoading(true);
    try {
      const result = await backend.generatePalavraDoDia({
        reference: bibleReference.trim(),
        provider,
        scheduledAt: scheduledAt || undefined
      });
      setOutput(result.text);
      const corrected = result.correctedFrom ? ` (corrigido de "${result.correctedFrom}")` : '';
      showToast(`Palavra do Dia — ${result.reference}${corrected}`, 'success');
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const generateFromBrief = async (composedBrief: string) => {
    if (!composedBrief.trim()) {
      showToast('Preencha os campos do template.', 'error');
      return;
    }
    if (providers.length === 0) {
      showToast('IA não configurada no servidor.', 'error');
      return;
    }
    setLoading(true);
    try {
      let text: string;
      if (isStudio) {
        const result = await backend.studioGenerateCopy({
          brief: composedBrief.trim(),
          action: 'generate',
          save: false
        });
        text = result.text;
      } else {
        const result = await backend.generateAiText({
          action: 'generate',
          provider,
          brief: composedBrief.trim()
        });
        text = result.text;
      }
      setOutput(text);
      showToast('Texto gerado!', 'success');
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = () => {
    if (!selected) return;
    if (selected === 'palavra-do-dia') return generatePalavraDoDia();
    if (selected === 'legenda-wpp') return generateFromBrief(brief);
    if (selected === 'post-semijoia') {
      return generateFromBrief(`Post Instagram/Facebook — ${BRANDING.storeName} (${BRANDING.storeUrl.replace(/^https?:\/\//, '')}). Tom elegante e premium.\n${brief}`);
    }
    if (selected === 'story-instagram') {
      return generateFromBrief(`Story Instagram — semijoias ${BRANDING.productName}. Texto curto, elegante, CTA.\n${brief}`);
    }
    if (selected === 'promo-combo') {
      return generateFromBrief(`Promoção/combo semijoias — destaque oferta, parcelamento, frete. ${BRANDING.storeUrl.replace(/^https?:\/\//, '')}\n${brief}`);
    }
    if (selected === 'descricao-produto') {
      return generateFromBrief(`Descrição de produto para e-commerce — semijoia banhada a ouro, acabamento premium.\n${brief}`);
    }
    if (selected === 'convite-culto') {
      const parts = [
        `Convite para culto — tom pastoral ${BRANDING.productName}, WhatsApp.`,
        cultoData && `Data: ${cultoData}`,
        cultoHorario && `Horário: ${cultoHorario}`,
        cultoTema && `Tema: ${cultoTema}`,
        brief && `Detalhes: ${brief}`
      ].filter(Boolean);
      return generateFromBrief(parts.join('\n'));
    }
  };

  const copyOutput = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      showToast('Copiado!', 'success');
    } catch {
      showToast('Não foi possível copiar.', 'error');
    }
  };

  const useInScheduler = () => {
    if (!output) return;
    BackendService.savePendingScheduleContent(output);
    if (onNavigate) {
      onNavigate('scheduler');
      showToast('Texto enviado para Agendamentos.', 'success');
    }
  };

  const saveAsCopy = async () => {
    if (!output) return;
    try {
      await backend.studioSaveCopy({
        title: TEMPLATES.find((t) => t.id === selected)?.label || 'Template',
        body: output,
        brief: brief || bibleReference || undefined
      });
      showToast('Salvo em Minhas criações!', 'success');
      onGeneratedCopy?.(output);
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-5xl">
      <MockBanner />
      <div>
        <h2 className="bs-page-title">Templates</h2>
        <p className="bs-page-desc mt-1">
          {isStudio
            ? `Formatos para a loja de semijoias — ${BRANDING.storeUrl.replace(/^https?:\/\//, '')}`
            : 'Modelos prontos para operação e ministério (disparos WhatsApp).'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {availableTemplates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectTemplate(t.id)}
            className={`bs-card p-4 text-left transition-all border-2 ${
              selected === t.id
                ? 'border-bs-accent'
                : 'border-transparent hover:border-bs-border'
            }`}
            style={selected === t.id ? { background: 'var(--bs-success-bg)' } : undefined}
          >
            <i className={`fa-solid ${t.icon} text-xl mb-2 ${selected === t.id ? 'text-bs-accent' : 'text-bs-muted'}`}></i>
            <p className="font-bold text-bs-text text-sm">{t.label}</p>
            <p className="text-xs text-bs-muted mt-1 line-clamp-2">{t.description}</p>
          </button>
        ))}
      </div>

      {selected && (
        <div className="bs-card p-6 space-y-4">
          <h3 className="font-bold text-bs-text flex items-center gap-2">
            <i className={`fa-solid ${TEMPLATES.find((t) => t.id === selected)?.icon} text-bs-accent`}></i>
            {TEMPLATES.find((t) => t.id === selected)?.label}
          </h3>

          {providers.length > 0 && selected !== 'palavra-do-dia' && (
            <div className="flex gap-2 text-sm">
              {providers.includes('gemini') && (
                <button type="button" onClick={() => setProvider('gemini')} className={`px-3 py-1 rounded-lg font-semibold border ${provider === 'gemini' ? 'bg-bs-accent text-black border-bs-accent' : 'border-bs-border text-bs-muted'}`}>
                  Gemini
                </button>
              )}
              {providers.includes('openai') && (
                <button type="button" onClick={() => setProvider('openai')} className={`px-3 py-1 rounded-lg font-semibold border ${provider === 'openai' ? 'bg-bs-elevated text-bs-text border-bs-accent/40' : 'border-bs-border text-bs-muted'}`}>
                  GPT
                </button>
              )}
            </div>
          )}

          {selected === 'palavra-do-dia' && (
            <div className="space-y-3">
              <p className="text-xs text-bs-muted">Versículo ARA + oração IA. Typos corrigidos automaticamente.</p>
              <input type="text" className="bs-input" placeholder="Referência — ex.: Salmos 23:1" value={bibleReference} onChange={(e) => setBibleReference(e.target.value)} disabled={loading} />
              <div>
                <label className="text-xs font-medium text-bs-muted block mb-1">Data do agendamento (opcional)</label>
                <input type="datetime-local" className="bs-input w-full sm:w-auto" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} disabled={loading} />
              </div>
            </div>
          )}

          {(selected === 'legenda-wpp' || selected === 'post-semijoia' || selected === 'story-instagram' || selected === 'promo-combo' || selected === 'descricao-produto') && (
            <textarea
              className="bs-input min-h-[100px]"
              placeholder={
                selected === 'post-semijoia' ? 'Ex.: Colar Mezuzah com esmeraldas, combo Florescer R$349, tom elegante...'
                : selected === 'promo-combo' ? 'Ex.: Combo Nº2 Promessa, 20% off, frete grátis acima de R$299...'
                : selected === 'descricao-produto' ? 'Ex.: Brinco Flor Pétalas Vazadas, banho ouro 18k, hipoalergênico...'
                : selected === 'story-instagram' ? 'Ex.: Lançamento coleção, peça em destaque, urgência promo...'
                : 'Descreva o tema, tom e objetivo...'
              }
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              disabled={loading}
            />
          )}

          {selected === 'convite-culto' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input type="text" className="bs-input" placeholder="Data" value={cultoData} onChange={(e) => setCultoData(e.target.value)} />
              <input type="text" className="bs-input" placeholder="Horário" value={cultoHorario} onChange={(e) => setCultoHorario(e.target.value)} />
              <input type="text" className="bs-input" placeholder="Tema" value={cultoTema} onChange={(e) => setCultoTema(e.target.value)} />
              <textarea className="bs-input sm:col-span-3 min-h-[80px]" placeholder="Detalhes extras..." value={brief} onChange={(e) => setBrief(e.target.value)} />
            </div>
          )}

          <button type="button" onClick={handleGenerate} disabled={loading} className="bs-btn px-6 py-2.5 disabled:opacity-50">
            {loading ? <><i className="fa-solid fa-spinner animate-spin mr-2"></i>Gerando...</> : '✨ Gerar texto'}
          </button>

          {output && (
            <div className="space-y-3 pt-4 border-t border-bs-border">
              <label className="text-sm font-semibold text-bs-text">Resultado</label>
              <textarea className="bs-input min-h-[280px] font-mono text-sm" value={output} onChange={(e) => setOutput(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copyOutput} className="bs-btn-ghost px-4 py-2 text-sm font-semibold">
                  <i className="fa-regular fa-copy mr-1"></i>Copiar
                </button>
                {!isStudio && (
                  <button type="button" onClick={useInScheduler} className="bs-btn px-4 py-2 text-sm">
                    <i className="fa-solid fa-calendar-plus mr-1"></i>Usar em agendamento
                  </button>
                )}
                {isStudio && (
                  <button type="button" onClick={saveAsCopy} className="bs-btn px-4 py-2 text-sm">
                    <i className="fa-solid fa-floppy-disk mr-1"></i>Salvar como copy
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TemplatesView;
