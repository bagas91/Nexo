/**
 * Motor de atendimento — agente IA responde mensagens privadas no WhatsApp.
 */

import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import { getAttendanceConfig } from '../utils/platformDefaults.js';
import { generateAgentReply } from '../utils/aiService.js';
import { buildAttendanceSystemPrompt } from '../utils/agentPrompts.js';

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
    const rows = chatDB.listInboxMessages(chatId, limit);
    return rows
        .filter((m) => m.body && !m.body.startsWith('['))
        .map((m) => ({
            role: m.fromMe ? 'assistant' : 'user',
            content: m.body,
        }));
}

function shouldUseChatId(chatId, phone) {
    const id = String(chatId || '');
    const digits = String(phone || '').replace(/\D/g, '');
    return id.includes('@lid') || digits.length < 10;
}

async function sendInboxReply(chatId, phone, text) {
    const { default: whatsappClient } = await import('./whatsappClient.js');
    if (shouldUseChatId(chatId, phone)) {
        await whatsappClient.sendChatMessage(chatId, text);
        return;
    }
    await whatsappClient.sendPrivateMessage(phone, text);
}

function syncContactFromConversation({ phone, contactName }) {
    if (!phone) return;
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length < 10) return;
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

        if (matchesHumanKeyword(body, cfg.humanKeywords)) {
            chatDB.setInboxConversationMode(chatId, 'human');
            chatDB.setInboxConversationStatus(chatId, 'pending');
            if (cfg.handoffMessage) {
                await sendInboxReply(chatId, phone, cfg.handoffMessage);
            }
            logger.info('Atendimento: encaminhado para humano', { chatId: chatId.slice(0, 16) });
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

        const history = buildChatHistory(chatId, cfg.maxHistoryMessages || 14);
        const systemPrompt = buildAttendanceSystemPrompt(agent);

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
                if (attempt < 3 && /high demand|429|503|overloaded|try again/i.test(msg)) {
                    logger.warn(`Atendimento: IA ocupada, tentativa ${attempt}/3…`);
                    await new Promise((r) => setTimeout(r, attempt * 2000));
                    continue;
                }
                throw err;
            }
        }
        if (!reply) return;

        await sendInboxReply(chatId, phone, reply);
        syncContactFromConversation({ phone, contactName });
        logger.info('Atendimento: resposta enviada', {
            agent: agent.name,
            chatId: chatId.slice(0, 16),
        });
    } catch (err) {
        logger.error('Atendimento: falha ao responder', err?.message || err);
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
