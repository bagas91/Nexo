/**
 * Processamento de webhooks WooCommerce e Bling — registra eventos e envia WhatsApp.
 */

import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import {
    parseBlingWebhookBody,
    enrichBlingFromApi,
    resolveBlingMessage,
    mapBlingOrder,
    buildBlingMessageContext,
    ensureValidBlingToken,
    isBlingOrderEvent,
} from './blingService.js';
import {
    parseWooOrder,
    resolveWooMessage,
    isWooEventEnabled,
    normalizeWooWebhookEvent,
    fetchWooOrder,
    getWooCredentials,
} from './wooService.js';

function normalizePhone(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('5591') && d.length === 13 && d[4] === '9') return `5511${d.slice(4)}`;
    if (d.startsWith('55') && d.length === 12) return `${d.slice(0, 4)}9${d.slice(4)}`;
    return d;
}

async function sendIntegrationWhatsApp(phone, text) {
    const digits = normalizePhone(phone);
    const message = String(text || '').trim();
    if (!digits || digits.length < 10 || !message) return { sent: false, reason: 'telefone ou mensagem inválidos' };

    const { default: whatsappClient } = await import('./whatsappClient.js');
    if (!whatsappClient.getStatus().ready) {
        return { sent: false, reason: 'WhatsApp não conectado' };
    }
    await whatsappClient.sendPrivateMessage(digits, message);
    return { sent: true, phone: digits };
}

export async function processWooWebhook(eventType, payload = {}) {
    const cfg = chatDB.getPlatformKv('woocommerce') || {};
    const normalizedType = normalizeWooWebhookEvent(eventType, payload);
    let order = parseWooOrder(payload);

    if (!order.phone && order.orderId && getWooCredentials(cfg)) {
        try {
            const full = await fetchWooOrder(order.orderId, getWooCredentials(cfg));
            if (full) order = parseWooOrder(full);
        } catch (err) {
            logger.warn('Woo: não foi possível buscar pedido completo', err?.message || err);
        }
    }

    const phone = normalizePhone(order.phone);
    const customer = order.customer;
    const preview = resolveWooMessage(normalizedType, order, cfg);
    const enabled = isWooEventEnabled(normalizedType, cfg);

    let eventStatus = phone ? 'queued' : 'failed';
    const event = chatDB.addIntegrationEvent({
        source: 'woocommerce',
        eventType: normalizedType,
        summary: `WooCommerce: ${normalizedType}${order.numero ? ` #${order.numero}` : ''}`,
        customer,
        phone,
        status: eventStatus,
        whatsappPreview: preview,
        payloadJson: payload,
    });

    logger.info('Webhook WooCommerce registrado', {
        eventType: normalizedType,
        id: event?.id,
        phone: phone ? `${phone.slice(0, 4)}…` : 'sem telefone',
        enabled,
    });

    if (enabled && phone && preview) {
        try {
            const result = await sendIntegrationWhatsApp(phone, preview);
            if (result.sent) {
                eventStatus = 'processed';
                chatDB.updateIntegrationEvent(event.id, { status: 'processed' });
                logger.info('Woo: WhatsApp enviado', { eventId: event.id, phone: result.phone?.slice(0, 6) });
            } else {
                chatDB.updateIntegrationEvent(event.id, { status: 'failed' });
                logger.warn('Woo: WhatsApp não enviado', result.reason);
            }
        } catch (err) {
            chatDB.updateIntegrationEvent(event.id, { status: 'failed' });
            logger.error('Woo: erro ao enviar WhatsApp', err?.message || err);
        }
    } else if (!enabled) {
        chatDB.updateIntegrationEvent(event.id, { status: 'skipped' });
        logger.info('Woo: evento desativado nas configurações', normalizedType);
    } else if (!phone) {
        logger.warn('Woo: evento sem telefone do cliente — preencha billing.phone no pedido');
    }

    import('./followUpEngine.js').then(({ handleIntegrationEvent }) => {
        handleIntegrationEvent({
            source: 'woocommerce',
            eventType: normalizedType,
            phone,
            customer,
            eventId: event?.id,
        });
    }).catch((err) => logger.warn('FollowUp: webhook Woo', err?.message || err));

    return chatDB.getIntegrationEvent(event.id) || event;
}

export async function processBlingWebhook(eventType, payload = {}) {
    const cfg = chatDB.getPlatformKv('bling') || {};
    const parsed = parseBlingWebhookBody({ ...payload, event: eventType, tipo: eventType });

    if (!isBlingOrderEvent(parsed.eventType)) {
        const event = chatDB.addIntegrationEvent({
            source: 'bling',
            eventType: parsed.eventType,
            summary: `Bling: ${parsed.eventType} (ignorado)`,
            customer: '',
            phone: '',
            status: 'skipped',
            whatsappPreview: '',
            payloadJson: payload,
        });
        logger.info('Bling: evento ignorado (não é pedido de venda)', { eventType: parsed.eventType });
        return event;
    }

    let order = parsed.order;
    const token = await ensureValidBlingToken(cfg).catch(() => '');
    const needsEnrich = parsed.orderId && token && (!order?.phone || !order?.produtos);
    if (needsEnrich) {
        order = await enrichBlingFromApi(parsed) || order;
    }
    if (!order && payload?.contato) {
        order = mapBlingOrder(payload);
    }

    const phone = normalizePhone(order?.phone || payload?.contato?.telefone || payload?.phone || '');
    const customer = order?.customer || payload?.contato?.nome || payload?.customer || 'Cliente';
    const status = order?.status || payload?.situacao || payload?.status || '';
    const numero = order?.numero || payload?.numero || parsed.orderId || '';

    const messageCtx = {
        ...buildBlingMessageContext(order),
        customer,
        numero,
        orderId: order?.orderId || parsed.orderId,
        rastreio: order?.rastreio || payload?.rastreio || '',
        status,
    };
    const preview = resolveBlingMessage(status, messageCtx, parsed.eventType);

    const productHint = messageCtx.primeiroProduto ? ` — ${messageCtx.primeiroProduto}` : '';
    let eventStatus = phone ? 'queued' : 'failed';
    const event = chatDB.addIntegrationEvent({
        source: 'bling',
        eventType: parsed.eventType,
        summary: `Bling: ${parsed.eventType}${numero ? ` #${numero}` : ''}${productHint}${status ? ` — ${status}` : ''}`,
        customer,
        phone,
        status: eventStatus,
        whatsappPreview: preview,
        payloadJson: payload,
    });

    logger.info('Webhook Bling registrado', {
        eventType: parsed.eventType,
        id: event?.id,
        orderId: parsed.orderId,
        status,
        phone: phone ? `${phone.slice(0, 4)}…` : 'sem telefone',
    });

    const shouldSendWa = cfg.syncOrders !== false;
    if (shouldSendWa && phone && preview) {
        try {
            const result = await sendIntegrationWhatsApp(phone, preview);
            if (result.sent) {
                eventStatus = 'processed';
                chatDB.updateIntegrationEvent(event.id, { status: 'processed' });
                logger.info('Bling: WhatsApp enviado', { eventId: event.id, phone: result.phone?.slice(0, 6) });
            } else {
                chatDB.updateIntegrationEvent(event.id, { status: 'failed' });
                logger.warn('Bling: WhatsApp não enviado', result.reason);
            }
        } catch (err) {
            chatDB.updateIntegrationEvent(event.id, { status: 'failed' });
            logger.error('Bling: erro ao enviar WhatsApp', err?.message || err);
        }
    } else if (!phone) {
        logger.warn('Bling: evento sem telefone do cliente — configure contato no pedido ou token API para buscar pedido completo');
    }

    import('./followUpEngine.js').then(({ handleIntegrationEvent }) => {
        handleIntegrationEvent({
            source: 'bling',
            eventType: parsed.eventType,
            phone,
            customer,
            eventId: event?.id,
        });
    }).catch((err) => logger.warn('FollowUp: webhook Bling', err?.message || err));

    return chatDB.getIntegrationEvent(event.id) || event;
}

export default { processWooWebhook, processBlingWebhook };
