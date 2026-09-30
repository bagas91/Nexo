/**
 * Envio outbound do inbox — escolhe o canal certo:
 * - dispatch → WhatsApp Web (Palavra do Dia / pastoral)
 * - ecommerce → Cloud API Meta (CRM / loja)
 */

import logger from '../utils/logger.js';
import { sendEcommerceText } from './ecommerceSend.js';

export function resolveInboxChannel(chatId, explicit) {
    if (explicit === 'ecommerce' || explicit === 'dispatch') return explicit;
    const id = String(chatId || '');
    if (id.startsWith('meta:')) return 'ecommerce';
    return 'dispatch';
}

export function phoneDigitsFromChatId(chatId) {
    return String(chatId || '')
        .replace(/^meta:/i, '')
        .replace(/@.*/g, '')
        .replace(/\D/g, '');
}

export function metaChatIdFromPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits || digits.length < 10) return '';
    return `meta:${digits}@c.us`;
}

/**
 * @param {{ chatId?: string, phone?: string, text: string, contactName?: string, channel?: 'dispatch'|'ecommerce' }} opts
 */
export async function sendInboxOutbound(opts = {}) {
    const text = String(opts.text || '').trim();
    if (!text) throw new Error('Mensagem vazia');

    const channel = resolveInboxChannel(opts.chatId, opts.channel);
    const digits = String(opts.phone || '').replace(/\D/g, '')
        || phoneDigitsFromChatId(opts.chatId);

    if (channel === 'ecommerce') {
        return sendEcommerceText({
            chatId: opts.chatId,
            phone: digits,
            text,
            contactName: opts.contactName || '',
        });
    }

    if (!digits || digits.length < 10) {
        throw new Error('Número inválido para envio no Disparo');
    }

    const { dispatchClient } = await import('./whatsappHub.js');
    const status = dispatchClient.getStatus();
    if (!status?.ready) {
        throw new Error('WhatsApp Disparo não conectado');
    }

    const id = String(opts.chatId || '').trim();
    // @lid ou JID Web nativo — envia pelo ID; senão pelo número
    if (id && !id.startsWith('meta:') && id.includes('@') && !id.endsWith('@c.us')) {
        await dispatchClient.sendChatMessage(id, text);
    } else {
        await dispatchClient.sendPrivateMessage(digits, text);
    }

    logger.info('Inbox outbound via Disparo (Web)', { to: `${digits.slice(0, 6)}…` });
    return { provider: 'web_dispatch', to: digits };
}

export default { sendInboxOutbound, resolveInboxChannel, phoneDigitsFromChatId, metaChatIdFromPhone };
