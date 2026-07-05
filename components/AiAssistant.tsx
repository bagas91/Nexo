import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, View } from '../types';
import { BackendService } from '../services/backendService';
import { useToast } from '../contexts/ToastContext';
import { BRANDING } from '../config/branding';

interface AiAssistantProps {
  role?: 'superadmin' | 'creator';
  onNavigate?: (view: View) => void;
  onUseText?: (text: string) => void;
}

const STUDIO_SUGGESTIONS = [
  'Legenda para colar Mezuzah banhado a ouro no Instagram',
  'Story de promoção combo semijoias com frete grátis',
  '3 ideias de post para lançamento de brincos elegantes',
  'Copy WhatsApp avisando nova coleção na loja'
];

const MINISTRY_SUGGESTIONS = [
  'Sugira 3 temas bíblicos para posts esta semana',
  'Me ajude a escrever uma legenda de convite para culto online',
  'Como deixar este texto mais pastoral e acolhedor?',
  'Quais Salmos falam sobre esperança?'
];

const AiAssistant: React.FC<AiAssistantProps> = ({ role = 'superadmin', onNavigate, onUseText }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [providers, setProviders] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const backend = BackendService.getInstance();
  const { showToast } = useToast();
  const isStudio = role === 'creator';
  const suggestions = isStudio ? STUDIO_SUGGESTIONS : MINISTRY_SUGGESTIONS;

  useEffect(() => {
    backend.getAiProviders().then(({ providers: p, defaultProvider }) => {
      setProviders(p);
      if (defaultProvider === 'gemini' || defaultProvider === 'openai') {
        setProvider(defaultProvider);
      }
    }).catch(() => setProviders([]));
  }, [backend]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    if (providers.length === 0) {
      showToast('IA não configurada no servidor.', 'error');
      return;
    }

    const userMsg: ChatMessage = { role: 'user', content };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const result = await backend.sendChatMessage({ messages: nextMessages, provider });
      setMessages([...nextMessages, { role: 'assistant', content: result.text }]);
    } catch (e) {
      showToast((e as Error).message, 'error');
      setMessages(messages);
      setInput(content);
    } finally {
      setLoading(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copiado!', 'success');
    } catch {
      showToast('Não foi possível copiar.', 'error');
    }
  };

  const useForSchedule = (text: string) => {
    BackendService.savePendingScheduleContent(text);
    if (onUseText) onUseText(text);
    else if (onNavigate) {
      onNavigate('scheduler');
      showToast('Texto enviado para Agendamentos.', 'success');
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-8rem)] min-h-[480px] max-w-4xl">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-bs-text">
            {isStudio ? 'Assistente Semijoias' : `Assistente ${BRANDING.productName}`}
          </h2>
          <p className="text-sm text-bs-muted">
            {isStudio
              ? `Copy e ideias para a loja ${BRANDING.storeUrl.replace(/^https?:\/\//, '')} — posts, stories e promoções.`
              : 'Chat para ministério e disparos. Palavra do Dia oficial: use Templates ou Agendamentos.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {providers.includes('gemini') && (
            <button type="button" onClick={() => setProvider('gemini')} className={`px-3 py-1 rounded-lg text-sm font-semibold border ${provider === 'gemini' ? 'bg-bs-accent text-black border-bs-accent' : 'border-bs-border text-bs-muted'}`}>
              Gemini
            </button>
          )}
          {providers.includes('openai') && (
            <button type="button" onClick={() => setProvider('openai')} className={`px-3 py-1 rounded-lg text-sm font-semibold border ${provider === 'openai' ? 'bg-bs-elevated text-bs-text border-bs-accent/40' : 'border-bs-border text-bs-muted'}`}>
              GPT
            </button>
          )}
          {messages.length > 0 && (
            <button type="button" onClick={() => setMessages([])} className="text-xs text-bs-muted hover:text-red-600 px-2 py-1">
              Limpar chat
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto rounded-2xl border border-bs-border bg-bs-shell p-4 space-y-4 custom-scrollbar">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center py-12 px-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 bg-bs-accent/15 border border-bs-accent/30 text-bs-accent">
              <i className={`fa-solid ${isStudio ? 'fa-gem' : 'fa-wand-magic-sparkles'} text-2xl`}></i>
            </div>
            <p className="text-bs-muted font-medium mb-6">Olá! Como posso ajudar hoje?</p>
            <div className="flex flex-wrap gap-2 justify-center max-w-xl">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => sendMessage(s)} className="text-xs sm:text-sm bg-bs-elevated hover:border-bs-accent/40 border border-bs-border text-bs-text px-3 py-2 rounded-xl text-left">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${msg.role === 'user' ? 'bg-bs-accent text-black rounded-br-md' : 'bg-bs-elevated text-bs-text border border-bs-border rounded-bl-md'}`}>
              {msg.content}
              {msg.role === 'assistant' && (
                <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t border-bs-border">
                  <button type="button" onClick={() => copyText(msg.content)} className="text-xs font-semibold text-bs-accent hover:text-bs-accent">
                    <i className="fa-regular fa-copy mr-1"></i>Copiar
                  </button>
                  {!isStudio && (
                    <button type="button" onClick={() => useForSchedule(msg.content)} className="text-xs font-semibold text-bs-accent hover:text-bs-accent">
                      <i className="fa-solid fa-calendar-plus mr-1"></i>Usar em agendamento
                    </button>
                  )}
                  {isStudio && (
                    <button type="button" onClick={() => onUseText?.(msg.content)} className="text-xs font-semibold text-bs-accent hover:text-bs-accent">
                      <i className="fa-solid fa-floppy-disk mr-1"></i>Salvar como copy
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-bs-elevated border border-bs-border rounded-2xl px-4 py-3 text-sm text-bs-muted">
              <i className="fa-solid fa-spinner animate-spin mr-2"></i>Pensando...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-4 flex gap-2">
        <textarea
          className="flex-1 bs-input resize-none min-h-[52px] max-h-32"
          placeholder="Digite sua mensagem..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          disabled={loading}
          rows={2}
        />
        <button type="button" onClick={() => sendMessage()} disabled={loading || !input.trim()} className="shrink-0 px-5 bs-btn disabled:opacity-50">
          <i className="fa-solid fa-paper-plane"></i>
        </button>
      </div>
    </div>
  );
};

export default AiAssistant;
