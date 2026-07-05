/**
 * Geração de texto via Gemini e/ou OpenAI (chaves só no servidor).
 *
 * Env:
 *   GEMINI_API_KEY=
 *   OPENAI_API_KEY=
 *   AI_GEMINI_MODEL=gemini-2.0-flash
 *   AI_OPENAI_MODEL=gpt-4o-mini
 *   AI_DEFAULT_PROVIDER=gemini|openai
 */

import logger from './logger.js';
import { BRANDING } from './branding.js';
import { parseBibleReference } from './bibleBooks.js';
import { fetchVerseText } from './bibleFetch.js';
import {
    formatDateExtenso,
    resolvePalavraDate,
    renderPalavraDoDia
} from './palavraDoDia.js';

const GEMINI_MODEL = process.env.AI_GEMINI_MODEL || 'gemini-2.5-flash';
const OPENAI_MODEL = process.env.AI_OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_PROVIDER = process.env.AI_DEFAULT_PROVIDER || 'gemini';
const CHAT_MAX_MESSAGES = 24;

const { productName, storeName, storeUrl } = BRANDING;

const CHAT_SYSTEM = `Você é a Assistente ${productName} — IA de apoio ao ministério (${productName}, ambiente de desenvolvimento).

Você ajuda a equipe a criar conteúdo para WhatsApp, Instagram e devocionais diários.

Tom: acolhedor, esperançoso e pastoral.

Capacidades:
- Sugerir ideias de posts, temas bíblicos, legendas e CTAs
- Revisar, encurtar ou reescrever textos
- Orientar sobre tom e emojis para WhatsApp
- Sugerir referências bíblicas (livro capítulo:versículo) — mas avise que, para a Palavra do Dia oficial, o usuário deve usar o template "Palavra do Dia" (versículo buscado na Bíblia ARA, não inventado)

Regras:
- Português do Brasil, linguagem clara
- Emojis com moderação (2 a 6 quando fizer sentido)
- Parágrafos curtos para leitura no celular
- NÃO use markdown pesado (sem ##, listas longas com *)
- NÃO diga que é IA, a menos que perguntem diretamente
- Se pedirem a Palavra do Dia completa no formato oficial, oriente a usar Templates → Palavra do Dia
- Seja conversacional: responda perguntas, faça follow-ups, ajude a refinar ideias`;

const STUDIO_CHAT_SYSTEM = `Você é a Assistente ${storeName} — IA de apoio à loja de semijoias (${storeUrl}).

Você ajuda a equipe de marketing a criar conteúdo para Instagram, WhatsApp da loja, stories e posts de produtos.

Foco: semijoias banhadas a ouro, colares, brincos, combos, promoções, lançamentos, elegância e sofisticação.

Tom: elegante, feminino, aspiracional, acolhedor — marca premium de semijoias, mas SEM conteúdo pastoral de culto, oração ou Palavra do Dia (isso é outro setor).

Capacidades:
- Sugerir legendas para posts de produtos (Mezuzah, combos, brincos, etc.)
- Ideias de stories, promoções, CTAs para compra (link na bio, frete grátis, parcelamento)
- Revisar e melhorar copies de e-commerce
- Descrever peças com destaque para acabamento, banho a ouro, esmeraldas

Regras:
- Português do Brasil
- Emojis com moderação (1 a 4), elegantes (✨💎🤍)
- Mencione ${storeUrl} quando fizer sentido
- NÃO fale de culto, devocional ou pastora — aqui é LOJA DE SEMIJOIAS
- NÃO use markdown pesado
- Seja conversacional e prática`;

const STUDIO_JEWELRY_SYSTEM = `Você é o assistente de copy da ${storeName} — loja online ${storeUrl}.

Tom: elegante, feminino, premium, aspiracional — semijoias com acabamento impecável e significado.
Público: mulheres que compram semijoias banhadas a ouro, Instagram e WhatsApp da loja.

Regras obrigatórias:
- Escreva em português do Brasil
- Foco em produto, benefício, desejo, promoção, frete, parcelamento
- Emojis discretos (✨💎🤍) — nunca exagere
- Parágrafos curtos para Instagram/WhatsApp
- CTA de compra quando fizer sentido (link na bio, confira no site)
- NÃO escreva conteúdo de culto, oração, devocional ou Palavra do Dia
- NÃO use markdown (sem **, _, ##)
- Retorne APENAS o texto final, pronto para colar`;

const MINISTRY_SYSTEM = `Você é o assistente de redação do ${productName} — ministério cristão evangelístico (ambiente de testes).

Tom: acolhedor, esperançoso, próximo e pastoral — como alguém falando com a comunidade no WhatsApp.
Público: grupos de WhatsApp (Palavra do Dia, células, devocionais).

Regras obrigatórias:
- Escreva em português do Brasil, linguagem clara e calorosa.
- Use emojis com moderação (2 a 6), sempre com propósito — nunca exagere.
- Parágrafos curtos (1–3 linhas), fáceis de ler no celular.
- Inclua uma chamada para ação (CTA) no final — ex.: compartilhar, orar, responder, participar.
- NÃO use markdown (sem **, _, ##).
- NÃO use aspas envolvendo a mensagem inteira.
- NÃO mencione que é IA ou que foi gerado automaticamente.
- Retorne APENAS o texto final da mensagem, pronto para colar no WhatsApp.`;

const ACTION_INSTRUCTIONS = {
    generate: (brief) => `Crie uma legenda/mensagem completa para WhatsApp com base neste tema ou briefing:

"${brief}"

Estrutura sugerida:
1. Saudação ou gancho com emoji
2. Corpo da mensagem (reflexão, palavra, anúncio — conforme o briefing)
3. CTA claro no final`,

    shorten: (text) => `Encurte o texto abaixo mantendo o tom do ${productName}, os pontos principais e pelo menos um CTA. Máximo ~40% menor que o original.

Texto original:
"""
${text}
"""`,

    rewrite: (text, brief) => `Reescreva o texto abaixo com outras palavras, mantendo o mesmo significado e tom do ${productName}. Melhore fluidez para WhatsApp.

${brief ? `Direção extra: ${brief}\n\n` : ''}Texto original:
"""
${text}
"""`
};

export function getAvailableProviders() {
    const providers = [];
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'PLACEHOLDER_API_KEY') {
        providers.push('gemini');
    }
    if (process.env.OPENAI_API_KEY) {
        providers.push('openai');
    }
    const defaultProvider = providers.includes(DEFAULT_PROVIDER)
        ? DEFAULT_PROVIDER
        : (providers[0] || null);
    return { providers, defaultProvider };
}

function resolveProvider(requested) {
    const { providers, defaultProvider } = getAvailableProviders();
    if (providers.length === 0) {
        throw new Error('IA não configurada. Defina GEMINI_API_KEY ou OPENAI_API_KEY no servidor.');
    }
    const provider = requested && providers.includes(requested) ? requested : defaultProvider;
    if (!provider) {
        throw new Error('Provedor de IA indisponível.');
    }
    return provider;
}

async function callGemini(system, user, history = null, gen = {}) {
    const key = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    const contents = history?.length
        ? history
        : [{ role: 'user', parts: [{ text: user }] }];
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: {
                temperature: gen.temperature ?? 0.75,
                maxOutputTokens: gen.maxOutputTokens ?? 2048,
            },
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data?.error?.message || res.statusText;
        throw new Error(`Gemini: ${msg}`);
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('')?.trim();
    if (!text) throw new Error('Gemini retornou resposta vazia');
    return text;
}

async function callOpenAI(system, user, history = null, gen = {}) {
    const key = process.env.OPENAI_API_KEY;
    const messages = history?.length
        ? [{ role: 'system', content: system }, ...history]
        : [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ];
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            temperature: gen.temperature ?? 0.75,
            max_tokens: gen.maxOutputTokens ?? 2048,
            messages
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data?.error?.message || res.statusText;
        throw new Error(`OpenAI: ${msg}`);
    }
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI retornou resposta vazia');
    return text;
}

/**
 * @param {{ action: 'generate'|'shorten'|'rewrite', provider?: string, brief?: string, currentText?: string, context?: 'ministry'|'studio' }} params
 */
export async function generateAiText({ action, provider: requestedProvider, brief = '', currentText = '', context = 'ministry' }) {
    const provider = resolveProvider(requestedProvider);
    const system = context === 'studio' ? STUDIO_JEWELRY_SYSTEM : MINISTRY_SYSTEM;

    if (action === 'generate') {
        const topic = String(brief || '').trim();
        if (!topic) throw new Error('Descreva o tema ou briefing para gerar a legenda.');
    } else {
        const text = String(currentText || '').trim();
        if (!text) throw new Error('Escreva ou gere um texto antes de encurtar ou reescrever.');
    }

    const userPrompt = ACTION_INSTRUCTIONS[action](
        action === 'generate' ? brief.trim() : currentText.trim(),
        brief.trim()
    );

    logger.info(`IA: ${action} via ${provider} (${provider === 'gemini' ? GEMINI_MODEL : OPENAI_MODEL})`);

    const text = provider === 'openai'
        ? await callOpenAI(system, userPrompt)
        : await callGemini(system, userPrompt);

    return { text, provider, action };
}

const PALAVRA_PRAYER_SYSTEM = `Você é o assistente de redação do ${productName} — ministério cristão evangelístico (ambiente de testes).

Tom: acolhedor, esperançoso, pastoral — como uma bispa orando com sua comunidade.
Público: devocional diário no WhatsApp (Palavra do Dia).

Regras obrigatórias:
- Escreva em português do Brasil.
- Crie uma oração em primeira pessoa dirigida a Deus (Senhor..., Ajuda-me..., Fortalece...).
- 4 a 6 frases curtas, conectadas ao versículo fornecido.
- Termine exatamente com: Em nome de Jesus, amém! 🙏
- NÃO use markdown, títulos, aspas envolvendo o texto, nem mencione que é IA.
- Retorne APENAS o texto da oração.`;

function buildPalavraPrayerPrompt({ referenceFormatted, verseText, prayerTitle }) {
    return `Com base neste versículo bíblico, escreva a oração da Palavra do Dia.

Referência: ${referenceFormatted}
Versículo: "${verseText}"
Título da seção (não inclua no texto): ${prayerTitle}

A oração deve refletir o tema do versículo e encorajar a fé da comunidade.`;
}

async function generatePrayer({ provider, referenceFormatted, verseText, prayerTitle }) {
    const userPrompt = buildPalavraPrayerPrompt({ referenceFormatted, verseText, prayerTitle });
    return provider === 'openai'
        ? await callOpenAI(PALAVRA_PRAYER_SYSTEM, userPrompt)
        : await callGemini(PALAVRA_PRAYER_SYSTEM, userPrompt);
}

/**
 * Gera a Palavra do Dia completa a partir de uma referência (ex.: "Gênesis 10:30").
 * @param {{ reference: string, provider?: string, scheduledAt?: string }} params
 */
export async function generatePalavraDoDia({ reference, provider: requestedProvider, scheduledAt }) {
    const provider = resolveProvider(requestedProvider);
    const parsed = parseBibleReference(reference);
    const { text: verseText, source: verseSource } = await fetchVerseText(parsed);

    logger.info(`Palavra do Dia: ${parsed.referenceFormatted} via ${provider} (versículo: ${verseSource})${parsed.correctedFrom ? ` [corrigido de: ${parsed.correctedFrom}]` : ''}`);

    const prayer = await generatePrayer({
        provider,
        referenceFormatted: parsed.referenceFormatted,
        verseText,
        prayerTitle: parsed.prayerTitle
    });

    const date = resolvePalavraDate({ scheduledAt });
    const dataExtenso = formatDateExtenso(date);
    const text = renderPalavraDoDia({
        dataExtenso,
        verseNumber: parsed.verse,
        verseText,
        referenceFormatted: parsed.referenceFormatted,
        prayerTitle: parsed.prayerTitle,
        prayer
    });

    return {
        text,
        provider,
        action: 'palavra_do_dia',
        reference: parsed.referenceFormatted,
        correctedFrom: parsed.correctedFrom || null,
        dataExtenso,
        verseSource
    };
}

function normalizeChatMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
        .slice(-CHAT_MAX_MESSAGES)
        .map((m) => ({
            role: m.role,
            content: String(m.content).trim().slice(0, 12000)
        }));
}

function toGeminiContents(messages) {
    return messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
    }));
}

function toOpenAiHistory(messages) {
    return messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
    }));
}

/**
 * Chat conversacional com histórico.
 * @param {{ messages: { role: 'user'|'assistant', content: string }[], provider?: string, context?: 'ministry'|'studio' }} params
 */
export async function generateChat({ messages, provider: requestedProvider, context = 'ministry' }) {
    const provider = resolveProvider(requestedProvider);
    const system = context === 'studio' ? STUDIO_CHAT_SYSTEM : CHAT_SYSTEM;
    const normalized = normalizeChatMessages(messages);
    if (normalized.length === 0 || normalized[normalized.length - 1].role !== 'user') {
        throw new Error('Envie pelo menos uma mensagem do usuário.');
    }

    logger.info(`IA chat: ${normalized.length} msgs via ${provider}`);

    const text = provider === 'openai'
        ? await callOpenAI(system, '', toOpenAiHistory(normalized))
        : await callGemini(system, '', toGeminiContents(normalized));

    return {
        text,
        provider,
        action: 'chat',
        message: { role: 'assistant', content: text }
    };
}

const AGENT_WHATSAPP_RULES = `
REGRAS OBRIGATÓRIAS (WhatsApp — atendimento ${productName}):
- Você NÃO é um assistente de conhecimento geral. Não responda como ChatGPT.
- Escopo fechado: só ministério ${productName}, cultos, comunidade e (se for o caso) loja ${storeUrl}.
- Se a pergunta for fora do escopo (curiosidades, tarefas, código, receitas, política, etc.), RECUSE educadamente e ofereça ajuda no escopo ou diga para digitar "humano".
- Português do Brasil, 1 a 3 parágrafos curtos, máximo ~500 caracteres quando possível
- Emojis: 0 a 2, só se combinar com o tom pastoral
- Sem markdown (sem **, _, ##)
- Não diga que é IA, salvo se perguntarem diretamente — aí diga que é a atendente virtual da equipe
- Nunca invente horários, preços, links ou fatos — prefira "vou confirmar com a equipe"`;

/**
 * Resposta de agente de atendimento com prompt customizado.
 */
export async function generateAgentReply({ systemPrompt, messages, provider: requestedProvider, latestUserText }) {
    const provider = resolveProvider(requestedProvider);
    const system = `${String(systemPrompt || '').trim()}\n\n${AGENT_WHATSAPP_RULES}`;
    let normalized = normalizeChatMessages(messages);

    if (latestUserText && (!normalized.length || normalized[normalized.length - 1].role !== 'user')) {
        normalized.push({ role: 'user', content: String(latestUserText).trim() });
    }

    while (normalized.length && normalized[normalized.length - 1].role !== 'user') {
        normalized.pop();
    }

    if (!normalized.length || normalized[normalized.length - 1].role !== 'user') {
        throw new Error('Mensagem do contato ausente.');
    }

    logger.info(`IA agente atendimento: ${normalized.length} msgs via ${provider}`);

    const gen = { temperature: 0.45, maxOutputTokens: 480 };

    const text = provider === 'openai'
        ? await callOpenAI(system, '', toOpenAiHistory(normalized), gen)
        : await callGemini(system, '', toGeminiContents(normalized), gen);

    return { text, provider };
}

export default { getAvailableProviders, generateAiText, generatePalavraDoDia, generateChat, generateAgentReply };
