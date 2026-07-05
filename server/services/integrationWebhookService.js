/**
 * Processamento de webhooks WooCommerce e Bling — registra eventos e prepara mensagens WhatsApp.
 */

import chatDB from '../db/database.js';
import logger from '../utils/logger.js';

function normalizePhone(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('5591') && d.length === 13 && d[4] === '9') return `5511${d.slice(4)}`;
    if (d.startsWith('55') && d.length === 12) return `${d.slice(0, 4)}9${d.slice(4)}`;
    return d;
}

function wooOrderMessage(eventType, payload) {
    const name = payload?.billing?.first_name || payload?.customer_name || 'Cliente';
    const total = payload?.total || payload?.order_total || '';
    const id = payload?.id || payload?.number || '';
    switch (eventType) {
        case 'order.created':
        case 'order_created':
            return `Olá ${name}! Recebemos seu pedido #${id}${total ? ` (R$ ${total})` : ''}. Obrigado pela compra! 🛍️`;
        case 'order.completed':
        case 'order_completed':
            return `Olá ${name}! Seu pedido #${id} foi concluído. Qualquer dúvida, estamos aqui! ✅`;
        case 'cart.abandoned':
        case 'cart_abandoned':
            return `Olá ${name}! Vi que você deixou itens no carrinho. Posso ajudar a finalizar? 🛒`;
        default:
            return `Olá ${name}! Atualização do pedido #${id}.`;
    }
}

function blingOrderMessage(eventType, payload) {
    const name = payload?.contato?.nome || payload?.customer || 'Cliente';
    const id = payload?.numero || payload?.id || '';
    const status = payload?.situacao || payload?.status || '';
    const cfg = chatDB.getPlatformKv('bling') || {};
    const mapped = (cfg.statusMap || []).find((s) => s.active && s.blingStatus === status);
    if (mapped?.message) return mapped.message.replace(/\{\{nome\}\}/gi, name).replace(/\{\{pedido\}\}/gi, String(id));
    return `Olá ${name}! Atualização do pedido ${id}${status ? `: ${status}` : ''}.`;
}

export function processWooWebhook(eventType, payload = {}) {
    const phone = normalizePhone(payload?.billing?.phone || payload?.phone || payload?.customer_phone || '');
    const customer = [payload?.billing?.first_name, payload?.billing?.last_name].filter(Boolean).join(' ') || payload?.customer_name || 'Cliente';
    const preview = wooOrderMessage(eventType, payload);
    const event = chatDB.addIntegrationEvent({
        source: 'woocommerce',
        eventType,
        summary: `WooCommerce: ${eventType}${payload?.id ? ` #${payload.id}` : ''}`,
        customer,
        phone,
        status: phone ? 'queued' : 'failed',
        whatsappPreview: preview,
        payloadJson: payload,
    });
    logger.info('Webhook WooCommerce registrado', { eventType, id: event?.id, phone: phone ? `${phone.slice(0, 4)}…` : 'sem telefone' });
    return event;
}

export function processBlingWebhook(eventType, payload = {}) {
    const phone = normalizePhone(payload?.contato?.telefone || payload?.phone || payload?.customer_phone || '');
    const customer = payload?.contato?.nome || payload?.customer || 'Cliente';
    const preview = blingOrderMessage(eventType, payload);
    const event = chatDB.addIntegrationEvent({
        source: 'bling',
        eventType,
        summary: `Bling: ${eventType}${payload?.numero ? ` #${payload.numero}` : ''}`,
        customer,
        phone,
        status: phone ? 'queued' : 'failed',
        whatsappPreview: preview,
        payloadJson: payload,
    });
    logger.info('Webhook Bling registrado', { eventType, id: event?.id });
    return event;
}

export default { processWooWebhook, processBlingWebhook };
