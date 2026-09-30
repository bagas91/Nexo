import { isLikelyPhoneDigits, isLikelyLidDigits } from '../utils/phoneUtils.js';
/**
 * Motor de atendimento — agente IA responde mensagens privadas no WhatsApp.
 */

import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import { getAttendanceConfig } from '../utils/platformDefaults.js';
import { generateAgentReply } from '../utils/aiService.js';
import { buildAttendanceSystemPrompt } from '../utils/agentPrompts.js';
import {
    searchWooProductsFromMessage,
    formatCatalogContextForAgent,
    tokenizeProductQuery,
} from './catalogAgentSearch.js';
import { getWooConfig, normalizeStoreUrl } from './wooService.js';
import { getOrdersForPhone } from './crmService.js';
import { formatBlingContextForAgent, parseMenuIntent } from './blingAgentContext.js';
import { BRANDING } from '../utils/branding.js';
import { getMinistryFacts } from '../utils/ministryFacts.js';
import notifier from '../utils/notifier.js';

const pendingReplies = new Map();
const processing = new Set();

function isMediaPlaceholder(body) {
    return /^\[(imagem|documento|áudio|audio|vídeo|video|sticker)\]$/i.test(String(body || '').trim());
}

function looksLikeTitheIntent(body) {
    return /d[ií]zimo|oferta|comprovante|mantenedor|contribu/i.test(String(body || ''));
}

function parsePastoralMenuIntent(body) {
    const t = String(body || '').trim().toLowerCase();
    if (!t) return null;
    if (/^1\b|ora[cç][aã]o|orar|ore\b/.test(t)) return 'prayer';
    if (/^2\b|culto|transmiss|assistir|live|hor[aá]rio/.test(t)) return 'culto';
    if (/^3\b|rede|instagram|youtube|tiktok|concept|loja|semijoia/.test(t)) return 'redes';
    // Dízimo NÃO entra no menu — só se a pessoa pedir explicitamente
    if (/d[ií]zimo|oferta|comprovante|mantenedor|contribu/.test(t)) return 'dizimo';
    if (/^4\b|humano|atendente|falar com (a )?equipe|falar com (a )?bispa/.test(t)) return 'human';
    return null;
}

async function handoffToHuman({ chatId, phone, channel, cfg, reason, customerMsg }) {
    chatDB.setInboxConversationMode(chatId, 'human');
    chatDB.setInboxConversationStatus(chatId, 'pending');
    const msg = customerMsg || cfg.handoffMessage;
    if (msg) {
        await sendInboxReply(chatId, phone, msg, channel);
    }
    logger.info('Atendimento: encaminhado para humano', {
        chatId: chatId.slice(0, 16),
        channel,
        reason: reason || 'keyword',
    });
}

function isWithinBusinessHours(cfg) {
    const bh = cfg.businessHours;
    if (!bh?.enabled) return true;
    const tz = bh.timezone || 'America/Sao_Paulo';
    const parts = new Intl.DateTimeFormat('pt-BR', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(new Date());
    const hour = parts.find((p) => p.type === 'hour')?.value || '00';
    const minute = parts.find((p) => p.type === 'minute')?.value || '00';
    const now = `${hour}:${minute}`;
    return now >= (bh.start || '08:00') && now <= (bh.end || '22:00');
}

function matchesHumanKeyword(text, keywords) {
    const lower = String(text || '').toLowerCase();
    return (keywords || []).some((kw) => lower.includes(String(kw).toLowerCase()));
}

function resolveAgent(cfg, channel = 'ecommerce') {
    const agents = chatDB.listPlatformEntities('agents');
    const preferredId = channel === 'dispatch'
        ? (cfg.dispatchAgentId || cfg.defaultAgentId)
        : cfg.defaultAgentId;
    const preferred = agents.find((a) => a.id === preferredId && a.active);
    if (preferred) return preferred;

    if (channel === 'dispatch') {
        const pastoral = agents.find((a) => a.active && a.type !== 'Vendas'
            && !/venda|loja|semijoia/i.test(`${a.name || ''} ${a.type || ''}`));
        if (pastoral) return pastoral;
    }

    const fallback = agents.find((a) => a.active) || null;
    if (fallback && preferredId !== fallback.id) {
        logger.warn(`Atendimento: agente padrão ${preferredId} inativo — usando ${fallback.name}`);
    }
    return fallback;
}

function buildChatHistory(chatId, limit) {
    const rows = typeof chatDB.listInboxMessagesRecent === 'function'
        ? chatDB.listInboxMessagesRecent(chatId, limit)
        : (() => {
            const r = chatDB.listInboxMessages(chatId, limit);
            return Array.isArray(r) ? r : (r?.messages || []);
        })();
    return rows
        .filter((m) => m.body && !m.body.startsWith('['))
        .map((m) => ({
            role: m.fromMe ? 'assistant' : 'user',
            content: String(m.body).slice(0, 480),
        }));
}

async function sendInboxReply(chatId, phone, text, channel) {
    const { sendInboxOutbound } = await import('./inboxOutbound.js');
    await sendInboxOutbound({ chatId, phone, text, channel });
}

function syncContactFromConversation({ phone, contactName }) {
    if (!phone) return;
    const digits = String(phone).replace(/\D/g, '');
    if (!isLikelyPhoneDigits(digits) || isLikelyLidDigits(digits)) return;
    const contacts = chatDB.listPlatformEntities('contacts');
    const existing = contacts.find((c) => String(c.phone || '').replace(/\D/g, '') === digits);
    if (existing) {
        if (contactName && contactName !== existing.name) {
            chatDB.savePlatformEntity('contacts', { ...existing, name: contactName, lastSeen: Date.now() });
        }
        return;
    }
    chatDB.savePlatformEntity('contacts', {
        id: `c_${digits}`,
        name: contactName || phone,
        phone: digits,
        tags: ['whatsapp'],
        lastSeen: Date.now(),
    });
}

async function processAgentReply({ chatId, phone, contactName, body, channel: channelHint }) {
    if (processing.has(chatId)) return;
    processing.add(chatId);
    try {
        const { resolveInboxChannel } = await import('./inboxOutbound.js');
        const conv = chatDB.getInboxConversation(chatId);
        const channel = resolveInboxChannel(chatId, channelHint || conv?.channel);
        const isDispatch = channel === 'dispatch';

        const cfg = getAttendanceConfig();
        if (!cfg.enabled) {
            logger.info('Atendimento: desligado nas configurações');
            return;
        }

        if (conv?.mode === 'human') {
            logger.info('Atendimento: conversa em modo humano — IA pausada');
            return;
        }

        const { hasActiveFollowUpRun } = await import('./followUpEngine.js');
        if (hasActiveFollowUpRun(chatId)) {
            logger.info('Atendimento: follow-up ativo — IA pausada para este chat');
            return;
        }

        if (matchesHumanKeyword(body, cfg.humanKeywords)) {
            await handoffToHuman({ chatId, phone, channel, cfg, reason: 'keyword' });
            return;
        }

        const pastoralMenu = isDispatch ? parsePastoralMenuIntent(body) : null;
        const menuIntent = isDispatch ? null : parseMenuIntent(body);
        if (menuIntent?.id === 'human' || pastoralMenu === 'human') {
            await handoffToHuman({ chatId, phone, channel, cfg, reason: 'menu-human' });
            return;
        }

        const inboundCount = typeof chatDB.countInboundMessages === 'function'
            ? chatDB.countInboundMessages(chatId)
            : 0;

        // Menu pastoral — canal Disparo / Palavra do Dia
        if (
            isDispatch
            && cfg.dispatchWelcomeMenuEnabled
            && cfg.dispatchWelcomeMenuMessage
            && inboundCount <= 1
            && !pastoralMenu
            && !isMediaPlaceholder(body)
            && !looksLikeTitheIntent(body)
            && !/https?:\/\//i.test(body || '')
            && /^(oi|ol[aá]|bom dia|boa tarde|boa noite|menu|in[ií]cio)\b/i.test(String(body || '').trim())
        ) {
            await sendInboxReply(chatId, phone, cfg.dispatchWelcomeMenuMessage, channel);
            logger.info('Atendimento: menu pastoral enviado', { chatId: chatId.slice(0, 16) });
            return;
        }

        // Menu de vendas só no e-commerce
        if (
            !isDispatch
            && cfg.welcomeMenuEnabled
            && cfg.welcomeMenuMessage
            && inboundCount <= 1
            && !menuIntent
            && !/https?:\/\//i.test(body || '')
        ) {
            await sendInboxReply(chatId, phone, cfg.welcomeMenuMessage, channel);
            logger.info('Atendimento: menu inicial enviado', { chatId: chatId.slice(0, 16) });
            return;
        }

        // Comprovante de dízimo (mídia após contexto de dízimo) → avisa equipe + e-mail + handoff
        if (isDispatch && isMediaPlaceholder(body)) {
            const facts = getMinistryFacts();
            const recent = typeof chatDB.listInboxMessagesRecent === 'function'
                ? chatDB.listInboxMessagesRecent(chatId, 10)
                : [];
            const recentText = recent.map((m) => m.body || '').join(' ');
            if (looksLikeTitheIntent(recentText)) {
                notifier.notify(
                    `Comprovante de dízimo/oferta no Disparo.\nContato: ${contactName || phone || chatId}\nTelefone: ${phone || '—'}\nEncaminhar para: ${facts.dizimoEmail}`,
                    'info',
                );
                await handoffToHuman({
                    chatId,
                    phone,
                    channel,
                    cfg,
                    reason: 'dizimo-comprovante',
                    customerMsg: `Recebi seu comprovante com muito carinho ❤️\n\nA equipe vai registrar e encaminhar para *${facts.dizimoEmail}*.\nSe puder, envie também para esse e-mail — fica mais rápido o registro.\n\nQue o Senhor multiplique a sua semente! 🙏✨`,
                });
                return;
            }
        }

        if (!isWithinBusinessHours(cfg)) {
            if (cfg.outsideHoursMessage) {
                await sendInboxReply(chatId, phone, cfg.outsideHoursMessage, channel);
            }
            return;
        }

        const agent = resolveAgent(cfg, channel);
        if (!agent) {
            logger.warn('Atendimento: nenhum agente ativo — ative um em Agentes de IA');
            return;
        }

        const history = buildChatHistory(chatId, Math.min(cfg.maxHistoryMessages || 14, 10));
        let systemPrompt = buildAttendanceSystemPrompt(agent);

        const phoneDigits = String(phone || '').replace(/\D/g, '');

        if (!isDispatch) {
            const wantsOrderContext = menuIntent?.id === 'order'
                || /pedido|rastreio|rastrear|acompanhar|entrega|envio|correios|bling/i.test(body || '');

            if (wantsOrderContext && isLikelyPhoneDigits(phoneDigits) && !isLikelyLidDigits(phoneDigits)) {
                try {
                    const blingCtx = await getOrdersForPhone(phoneDigits);
                    systemPrompt = `${systemPrompt}\n\n${formatBlingContextForAgent(blingCtx, { maxOrders: 2 })}`;
                    if (blingCtx?.orders?.length) {
                        logger.info('Atendimento: contexto Bling injetado', {
                            orders: blingCtx.orders.length,
                            rastreio: blingCtx.orders[0]?.rastreio ? 'sim' : 'não',
                        });
                    }
                } catch (err) {
                    logger.warn('Atendimento: Bling contexto falhou', err?.message || err);
                }
            }

            const wantsCatalog = menuIntent?.id === 'catalog'
                || menuIntent?.id === 'product'
                || tokenizeProductQuery(body).length > 0
                || /produto|comprar|quero|link|sku|colar|brinco|anel|pulseira|bíblia|biblia|semijoia|alianca|aliança|publica/i.test(body || '')
                || /https?:\/\//i.test(body || '');
            if (wantsCatalog) {
                const hits = searchWooProductsFromMessage(body, { limit: 5 });
                const storeBase = normalizeStoreUrl(
                    getWooConfig()?.storeUrl || BRANDING.storeUrl || '',
                );
                systemPrompt = `${systemPrompt}\n\n${formatCatalogContextForAgent(hits, storeBase)}`;
                if (hits.length) {
                    logger.info('Atendimento: catálogo Woo injetado', {
                        hits: hits.length,
                        skus: hits.map((h) => h.sku).slice(0, 5),
                    });
                }
            }

            if (menuIntent?.id === 'order') {
                systemPrompt = `${systemPrompt}\n\nINTENÇÃO DO CLIENTE: acompanhar pedido ou rastreio. Use o bloco BLING acima. Se houver rastreio, informe. Se não houver cadastro/pedido, peça nº do pedido ou encaminhe humano.`;
            }
            if (menuIntent?.id === 'product') {
                systemPrompt = `${systemPrompt}\n\nINTENÇÃO DO CLIENTE: produto de publicação ou site. Se mandou link, use CATÁLOGO. Peça print/link se faltar.`;
            }
        } else {
            const facts = getMinistryFacts();
            let intentHint = '';
            if (pastoralMenu === 'prayer') {
                intentHint = '\nINTENÇÃO: pedido de oração. Acolha com amor e ore de forma curta e profunda.';
            } else if (pastoralMenu === 'culto') {
                intentHint = '\nINTENÇÃO: cultos / onde assistir. Use só os FATOS OFICIAIS (horário, canais, endereço).';
            } else if (pastoralMenu === 'redes') {
                intentHint = '\nINTENÇÃO: redes sociais. Liste pessoal, Palavra do Dia, loja e Concept com links completos.';
            } else if (pastoralMenu === 'dizimo' || looksLikeTitheIntent(body)) {
                intentHint = `\nINTENÇÃO EXPLÍCITA DA PESSOA: dízimo/oferta/comprovante. Aí sim informe PIX ${facts.pixKey} e e-mail ${facts.dizimoEmail}. Sem pressão.`;
            } else {
                intentHint = '\nPROIBIDO nesta resposta: mencionar dízimo, oferta, PIX, conta, mantenedor ou pedir contribuição — a pessoa NÃO pediu.';
            }
            systemPrompt = `${systemPrompt}

CANAL: WhatsApp de Disparo (Palavra do Dia / ministério da Bispa Virgínia Arruda).
Foque em: cultos, Bispa, Palavra do Dia, oração, comunidade, redes oficiais.
NÃO fale de dízimo/oferta/PIX a menos que a pessoa pergunte.
NÃO faça venda de semijoias neste canal — se pedirem loja, indique ${facts.redes.ecommerceSite} / @virginiaarrudaloja ou digite "humano".${intentHint}`;
        }

        let reply = '';
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const { text } = await generateAgentReply({
                    systemPrompt,
                    messages: history,
                    latestUserText: body,
                    provider: cfg.provider || undefined,
                });
                reply = String(text || '').trim();
                break;
            } catch (err) {
                const msg = String(err?.message || err);
                if (attempt < 3 && /high demand|429|503|overloaded|try again|timeout|aborted|AbortError|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(msg)) {
                    logger.warn(`Atendimento: IA ocupada/timeout, tentativa ${attempt}/3…`, msg.slice(0, 160));
                    await new Promise((r) => setTimeout(r, attempt * 3000));
                    continue;
                }
                throw err;
            }
        }
        if (!reply) {
            reply = 'Desculpe, tive uma instabilidade agora. Pode repetir sua pergunta? Ou digite *humano* para falar com a equipe.';
        }

        await sendInboxReply(chatId, phone, reply, channel);
        syncContactFromConversation({ phone, contactName });
        logger.info('Atendimento: resposta enviada', {
            agent: agent.name,
            channel,
            chatId: chatId.slice(0, 16),
        });
    } catch (err) {
        logger.error('Atendimento: falha ao responder', err?.message || err);
        try {
            const { resolveInboxChannel } = await import('./inboxOutbound.js');
            const channel = resolveInboxChannel(chatId, channelHint);
            await sendInboxReply(
                chatId,
                phone,
                'Estou com instabilidade no atendimento automático neste momento. Digite *humano* para a equipe te atender, ou tente de novo em 1 minutinho.',
                channel,
            );
        } catch (sendErr) {
            logger.warn('Atendimento: também falhou ao avisar o cliente', sendErr?.message || sendErr);
        }
    } finally {
        processing.delete(chatId);
    }
}

export function scheduleAgentReply(payload) {
    const cfg = getAttendanceConfig();
    if (!cfg.enabled) return;

    const { chatId } = payload;
    const delay = Math.max(500, cfg.replyDelayMs || 2000);

    if (pendingReplies.has(chatId)) {
        clearTimeout(pendingReplies.get(chatId));
    }

    pendingReplies.set(chatId, setTimeout(() => {
        pendingReplies.delete(chatId);
        processAgentReply(payload).catch((err) => {
            logger.error('Atendimento: erro no agendamento', err?.message || err);
        });
    }, delay));
}

export default { scheduleAgentReply };
