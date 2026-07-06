/**
 * Motor de Follow Ups — executa sequências (wait, message, tag, webhook).
 */

import chatDB from '../db/database.js';
import logger from '../utils/logger.js';

const ACTIVE_STATUSES = new Set(['active', 'waiting']);

function normalizeTrigger(trigger) {
    return String(trigger || '').trim().toLowerCase();
}

function isIdleTrigger(trigger) {
    const t = normalizeTrigger(trigger);
    return t.includes('reengaj') || t.includes('sem interação') || t.includes('sem interacao') || t.includes('24h');
}

function isIntegrationTrigger(trigger) {
    const t = normalizeTrigger(trigger);
    return t.includes('bling') || t.includes('woo') || t.includes('pedido');
}

function isManualTrigger(trigger) {
    return normalizeTrigger(trigger) === 'manual';
}

function interpolate(text, ctx) {
    const name = ctx.contactName || ctx.name || 'amigo(a)';
    const phone = ctx.phone || '';
    return String(text || '')
        .replace(/\{\{name\}\}/gi, name)
        .replace(/\{\{phone\}\}/gi, phone);
}

function shouldUseChatId(chatId, phone) {
    const id = String(chatId || '');
    const digits = String(phone || '').replace(/\D/g, '');
    return id.includes('@lid') || digits.length < 10;
}

async function sendFollowUpMessage(chatId, phone, text) {
    const { default: whatsappClient } = await import('./whatsappClient.js');
    const message = String(text || '').trim();
    if (!message) return;
    if (shouldUseChatId(chatId, phone)) {
        await whatsappClient.sendChatMessage(chatId, message);
        return;
    }
    await whatsappClient.sendPrivateMessage(phone, message);
}

function applyTag(phone, contactName, tagName) {
    const tag = String(tagName || '').trim();
    if (!tag) return;
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 10) return;

    const contacts = chatDB.listPlatformEntities('contacts');
    const existing = contacts.find((c) => String(c.phone || '').replace(/\D/g, '') === digits);
    if (existing) {
        const tags = Array.isArray(existing.tags) ? [...existing.tags] : [];
        if (!tags.includes(tag)) tags.push(tag);
        chatDB.savePlatformEntity('contacts', { ...existing, tags, lastSeen: Date.now() });
        return;
    }
    chatDB.savePlatformEntity('contacts', {
        id: `c_${digits}`,
        name: contactName || phone,
        phone: digits,
        tags: ['whatsapp', tag],
        lastSeen: Date.now(),
    });
}

async function fireWebhook(url, payload) {
    const target = String(url || '').trim();
    if (!target.startsWith('http')) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        await fetch(target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
}

function getIdleMinutes(followUp) {
    const waitStep = (followUp.steps || []).find((s) => s.type === 'wait');
    const fromStep = Number(waitStep?.config?.minutes);
    if (Number.isFinite(fromStep) && fromStep > 0) return fromStep;
    return 24 * 60;
}

function matchesInboundTrigger(followUp, { body, isNewContact }) {
    const t = normalizeTrigger(followUp.trigger);
    if (!t || isManualTrigger(t)) return false;
    if (isIdleTrigger(t) || isIntegrationTrigger(t)) return false;

    if (t === 'novo contato' || t.includes('novo contato')) {
        return isNewContact === true;
    }

    if (t.startsWith('contém:') || t.startsWith('contem:')) {
        const kw = t.split(':').slice(1).join(':').trim();
        return kw.length > 0 && String(body || '').toLowerCase().includes(kw);
    }

    if (t.startsWith('keyword:')) {
        const kw = t.slice(8).trim();
        return kw.length > 0 && String(body || '').toLowerCase().includes(kw);
    }

    if (t.length >= 3 && body) {
        return String(body).toLowerCase().includes(t);
    }

    return false;
}

function matchesIntegrationTrigger(followUp, { source, eventType }) {
    const t = normalizeTrigger(followUp.trigger);
    if (!isIntegrationTrigger(t)) return false;
    const src = String(source || '').toLowerCase();
    const evt = String(eventType || '').toLowerCase();

    const isCart = evt.includes('cart') || evt.includes('abandon');
    const isOrder = evt.includes('order') || evt.includes('pedido') || evt.includes('created');
    const isDelivered = evt.includes('entreg') || evt.includes('completed') || evt.includes('conclu') || evt.includes('enviado');

    if (t.includes('carrinho') && src === 'woocommerce') return isCart;
    if (t.includes('pedido entregue') || t.includes('pos-entrega') || t.includes('pós-entrega')) {
        return isDelivered && (src === 'bling' || src === 'woocommerce');
    }
    if (t.includes('confirma') || (t.includes('pedido') && !t.includes('entregue') && !t.includes('carrinho'))) {
        if (src === 'woocommerce') return isOrder && !isCart;
        if (src === 'bling') return !isCart;
    }
    if (t.includes('woo') && !t.includes('carrinho')) return src === 'woocommerce' && !isCart;
    if (t.includes('bling') && !t.includes('entregue')) return src === 'bling';
    return false;
}

function resolveChatId(phone, chatId) {
    if (chatId) return chatId;
    const digits = String(phone || '').replace(/\D/g, '');
    return digits ? `${digits}@c.us` : '';
}

export function hasActiveFollowUpRun(chatId) {
    return chatDB.hasAnyActiveFollowUpRun(chatId);
}

export async function enrollFollowUp(followUp, { chatId, phone, contactName, context = {} }) {
    if (!followUp?.active || !followUp?.id) return null;
    const resolvedChatId = resolveChatId(phone, chatId);
    if (!resolvedChatId) return null;

    if (chatDB.hasActiveFollowUpRun(followUp.id, resolvedChatId)) {
        logger.debug(`FollowUp: já inscrito — ${followUp.name} (${resolvedChatId.slice(0, 16)})`);
        return null;
    }

    const run = chatDB.saveFollowUpRun({
        followupId: followUp.id,
        followupName: followUp.name || followUp.id,
        chatId: resolvedChatId,
        phone: String(phone || '').replace(/\D/g, ''),
        contactName: contactName || '',
        stepIndex: 0,
        status: 'active',
        nextRunAt: null,
        context: { ...context, contactName: contactName || context.contactName || '' },
    });

    logger.info(`FollowUp: inscrito — ${followUp.name}`, { chatId: resolvedChatId.slice(0, 16) });
    await advanceRun(run.id);
    return chatDB.getFollowUpRun(run.id);
}

async function executeStep(run, followUp, step) {
    const ctx = { ...run.context, phone: run.phone, contactName: run.contactName };

    switch (step.type) {
        case 'wait': {
            const minutes = Math.max(1, Number(step.config?.minutes) || 1);
            const nextRunAt = Date.now() + minutes * 60 * 1000;
            chatDB.saveFollowUpRun({
                ...run,
                stepIndex: run.stepIndex + 1,
                status: 'waiting',
                nextRunAt,
            });
            logger.info(`FollowUp: aguardando ${minutes}min — ${followUp.name}`, { runId: run.id });
            return 'waiting';
        }
        case 'message': {
            const text = interpolate(step.config?.text, ctx);
            await sendFollowUpMessage(run.chatId, run.phone, text);
            chatDB.saveInboxMessage({
                id: `fu_${run.id}_${run.stepIndex}_${Date.now()}`,
                chatId: run.chatId,
                phone: run.phone,
                contactName: run.contactName,
                body: text,
                fromMe: true,
                ts: Date.now(),
            }, { silent: true });
            logger.info(`FollowUp: mensagem enviada — ${followUp.name}`, { runId: run.id });
            return 'continue';
        }
        case 'tag': {
            applyTag(run.phone, run.contactName, step.config?.tag);
            logger.info(`FollowUp: tag aplicada — ${step.config?.tag}`, { runId: run.id });
            return 'continue';
        }
        case 'webhook': {
            await fireWebhook(step.config?.url, {
                followupId: followUp.id,
                followupName: followUp.name,
                runId: run.id,
                chatId: run.chatId,
                phone: run.phone,
                contactName: run.contactName,
                stepIndex: run.stepIndex,
                ts: Date.now(),
            });
            logger.info(`FollowUp: webhook disparado — ${followUp.name}`, { runId: run.id });
            return 'continue';
        }
        case 'condition':
        default:
            return 'continue';
    }
}

export async function advanceRun(runId) {
    let run = chatDB.getFollowUpRun(runId);
    if (!run || !ACTIVE_STATUSES.has(run.status)) return run;

    const followUp = chatDB.getPlatformEntity('followups', run.followupId);
    if (!followUp || !followUp.active) {
        chatDB.saveFollowUpRun({ ...run, status: 'cancelled', nextRunAt: null });
        return null;
    }

    const steps = Array.isArray(followUp.steps) ? followUp.steps : [];

    while (run.stepIndex < steps.length && ACTIVE_STATUSES.has(run.status)) {
        const step = steps[run.stepIndex];
        if (!step) break;

        const result = await executeStep(run, followUp, step);
        run = chatDB.getFollowUpRun(runId);
        if (!run) break;

        if (result === 'waiting') return run;

        chatDB.saveFollowUpRun({
            ...run,
            stepIndex: run.stepIndex + 1,
            status: 'active',
            nextRunAt: null,
        });
        run = chatDB.getFollowUpRun(runId);
    }

    if (run && run.stepIndex >= steps.length) {
        chatDB.saveFollowUpRun({ ...run, status: 'completed', nextRunAt: null });
        logger.info(`FollowUp: concluído — ${followUp.name}`, { runId: run.id });
    }

    return chatDB.getFollowUpRun(runId);
}

export async function handleInboundMessage({ chatId, phone, contactName, body, isNewContact }) {
    const followUps = chatDB.listPlatformEntities('followups').filter((f) => f.active);

    if (followUps.some((f) => isIdleTrigger(f.trigger))) {
        chatDB.cancelFollowUpRunsForChat(chatId, 'replied');
    }

    for (const fu of followUps) {
        if (!matchesInboundTrigger(fu, { body, isNewContact })) continue;
        try {
            await enrollFollowUp(fu, { chatId, phone, contactName, context: { trigger: fu.trigger } });
        } catch (err) {
            logger.error(`FollowUp: falha ao inscrever — ${fu.name}`, err?.message || err);
        }
    }
}

export async function handleIntegrationEvent({ source, eventType, phone, customer, eventId }) {
    if (!phone) return;
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length < 10) return;

    const followUps = chatDB.listPlatformEntities('followups').filter((f) => f.active);
    for (const fu of followUps) {
        if (!matchesIntegrationTrigger(fu, { source, eventType })) continue;
        try {
            await enrollFollowUp(fu, {
                phone: digits,
                contactName: customer || '',
                context: { trigger: fu.trigger, integrationEventId: eventId, source, eventType },
            });
        } catch (err) {
            logger.error(`FollowUp: falha integração — ${fu.name}`, err?.message || err);
        }
    }
}

export async function manualEnroll(followUpId, { phone, contactName, chatId }) {
    const followUp = chatDB.getPlatformEntity('followups', followUpId);
    if (!followUp) throw new Error('Follow up não encontrado');
    if (!followUp.active) throw new Error('Follow up está inativo');
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 10) throw new Error('Informe um telefone válido (55 + DDD + número)');
    return enrollFollowUp(followUp, {
        chatId: chatId || `${digits}@c.us`,
        phone: digits,
        contactName: contactName || '',
        context: { trigger: 'manual', manual: true },
    });
}

async function processIdleTriggers() {
    const followUps = chatDB.listPlatformEntities('followups').filter((f) => f.active && isIdleTrigger(f.trigger));
    for (const fu of followUps) {
        const idleMinutes = getIdleMinutes(fu);
        const convs = chatDB.listConversationsIdleSince(idleMinutes);
        for (const conv of convs) {
            if (chatDB.hasActiveFollowUpRun(fu.id, conv.chatId)) continue;
            try {
                await enrollFollowUp(fu, {
                    chatId: conv.chatId,
                    phone: conv.phone,
                    contactName: conv.contactName,
                    context: { trigger: fu.trigger, idle: true },
                });
            } catch (err) {
                logger.warn(`FollowUp: idle falhou — ${fu.name}`, err?.message || err);
            }
        }
    }
}

let workerRunning = false;

export async function processDueFollowUpRuns() {
    if (workerRunning) return;
    workerRunning = true;
    try {
        const { default: whatsappClient } = await import('./whatsappClient.js');
        if (!whatsappClient.getStatus().ready) return;

        await processIdleTriggers();

        const due = chatDB.listFollowUpRunsDue();
        for (const run of due) {
            try {
                chatDB.saveFollowUpRun({ ...run, status: 'active', nextRunAt: null });
                await advanceRun(run.id);
            } catch (err) {
                logger.error(`FollowUp: erro no passo agendado ${run.id}`, err?.message || err);
            }
        }
    } finally {
        workerRunning = false;
    }
}

export default {
    hasActiveFollowUpRun,
    enrollFollowUp,
    advanceRun,
    handleInboundMessage,
    handleIntegrationEvent,
    manualEnroll,
    processDueFollowUpRuns,
};
