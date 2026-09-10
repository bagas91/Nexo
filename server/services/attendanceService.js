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

const pendingReplies = new Map();
const processing = new Set();

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

function resolveAgent(cfg) {
    const agents = chatDB.listPlatformEntities('agents');
    const preferred = agents.find((a) => a.id === cfg.defaultAgentId && a.active);
    if (preferred) return preferred;

    const fallback = agents.find((a) => a.active) || null;
    if (fallback && cfg.defaultAgentId !== fallback.id) {
        logger.warn(`Atendimento: agente padrão ${cfg.defaultAgentId} inativo — usando ${fallback.name}`);
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

async function sendInboxReply(chatId, phone, text) {
    const { default: whatsappClient } = await import('./whatsappClient.js');
    const id = String(chatId || '').trim();
    const digits = String(phone || '').replace(/\D/g, '');
    // @lid: tenta pelo chatId; se tiver telefone real (55…), manda também por número
    const looksLikeLidPhone = digits.length > 13 || (id.includes('@lid') && digits === id.replace(/\D/g, ''));
    const realPhone = digits.length >= 10 && digits.length <= 13 && !looksLikeLidPhone ? digits : '';

    if (id.includes('@lid') || !realPhone) {
        try {
            await whatsappClient.sendChatMessage(id, text);
            return;
        } catch (err) {
            if (!realPhone) throw err;
            logger.warn('Atendimento: envio @lid falhou, tentando número', err?.message || err);
        }
    }
    await whatsappClient.sendPrivateMessage(realPhone, text);
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

async function processAgentReply({ chatId, phone, contactName, body }) {
    if (processing.has(chatId)) return;
    processing.add(chatId);
    try {
        const cfg = getAttendanceConfig();
        if (!cfg.enabled) {
            logger.info('Atendimento: desligado nas configurações');
            return;
        }

        const conv = chatDB.getInboxConversation(chatId);
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
            chatDB.setInboxConversationMode(chatId, 'human');
            chatDB.setInboxConversationStatus(chatId, 'pending');
            if (cfg.handoffMessage) {
                await sendInboxReply(chatId, phone, cfg.handoffMessage);
            }
            logger.info('Atendimento: encaminhado para humano', { chatId: chatId.slice(0, 16) });
            return;
        }

        const menuIntent = parseMenuIntent(body);
        if (menuIntent?.id === 'human') {
            chatDB.setInboxConversationMode(chatId, 'human');
            chatDB.setInboxConversationStatus(chatId, 'pending');
            if (cfg.handoffMessage) {
                await sendInboxReply(chatId, phone, cfg.handoffMessage);
            }
            return;
        }

        const inboundCount = typeof chatDB.countInboundMessages === 'function'
            ? chatDB.countInboundMessages(chatId)
            : 0;
        if (
            cfg.welcomeMenuEnabled
            && cfg.welcomeMenuMessage
            && inboundCount <= 1
            && !menuIntent
            && !/https?:\/\//i.test(body || '')
        ) {
            await sendInboxReply(chatId, phone, cfg.welcomeMenuMessage);
            logger.info('Atendimento: menu inicial enviado', { chatId: chatId.slice(0, 16) });
            return;
        }

        if (!isWithinBusinessHours(cfg)) {
            if (cfg.outsideHoursMessage) {
                await sendInboxReply(chatId, phone, cfg.outsideHoursMessage);
            }
            return;
        }

        const agent = resolveAgent(cfg);
        if (!agent) {
            logger.warn('Atendimento: nenhum agente ativo — ative um em Agentes de IA');
            return;
        }

        const history = buildChatHistory(chatId, Math.min(cfg.maxHistoryMessages || 14, 10));
        let systemPrompt = buildAttendanceSystemPrompt(agent);

        const wantsOrderContext = menuIntent?.id === 'order'
            || /pedido|rastreio|rastrear|acompanhar|entrega|envio|correios|bling/i.test(body || '');

        const phoneDigits = String(phone || '').replace(/\D/g, '');
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

        await sendInboxReply(chatId, phone, reply);
        syncContactFromConversation({ phone, contactName });
        logger.info('Atendimento: resposta enviada', {
            agent: agent.name,
            chatId: chatId.slice(0, 16),
        });
    } catch (err) {
        logger.error('Atendimento: falha ao responder', err?.message || err);
        try {
            await sendInboxReply(
                chatId,
                phone,
                'Estou com instabilidade no atendimento automático neste momento. Digite *humano* para a equipe te atender, ou tente de novo em 1 minutinho.',
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
