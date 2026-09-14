/**
 * Canal de envio do E-commerce: Cloud API Meta (padrão).
 * Fallback para ecommerceClient (WhatsApp Web) só com META_WA_FORCE_WEB=1.
 */

import logger from '../utils/logger.js';
import { sendText, isMetaConnected } from './metaWhatsAppService.js';
import { isEcommerceWebForced } from './whatsappHub.js';

function digitsFrom(value) {
    return String(value || '').replace(/\D/g, '');
}

function phoneFromChatId(chatId) {
    const id = String(chatId || '');
    if (id.includes('@c.us') || id.includes('@s.whatsapp.net')) {
        return digitsFrom(id);
    }
    return digitsFrom(id);
}

/**
 * Envia texto para cliente (CRM / atendimento / follow-up).
 */
export async function sendEcommerceText({ chatId, phone, text, contactName = '' } = {}) {
    const body = String(text || '').trim();
    if (!body) throw new Error('Mensagem vazia');

    const digits = digitsFrom(phone) || phoneFromChatId(chatId);
    if (!digits || digits.length < 10) {
        throw new Error('Número inválido para envio e-commerce');
    }

    if (isEcommerceWebForced()) {
        const { ecommerceClient } = await import('./whatsappHub.js');
        const id = String(chatId || '').trim();
        if (id.includes('@') && !id.includes('@c.us')) {
            await ecommerceClient.sendChatMessage(id, body);
        } else {
            await ecommerceClient.sendPrivateMessage(digits, body);
        }
        return { provider: 'web', to: digits };
    }

    if (!isMetaConnected()) {
        throw new Error('WhatsApp E-commerce (Cloud API Meta) não configurado. Vá em Configurações → Conexões.');
    }

    const result = await sendText(digits, body);

    // Espelha no inbox para o painel mostrar a resposta enviada
    try {
        const { persistMetaInboxMessage } = await import('./inboxService.js');
        await persistMetaInboxMessage({
            id: result.messageId || `out_${digits}_${Date.now()}`,
            phone: digits,
            contactName,
            body,
            fromMe: true,
            ts: Date.now(),
            silent: true,
        });
    } catch (err) {
        logger.warn('E-commerce: falha ao espelhar outbound no inbox', err?.message || err);
    }

    return { provider: 'meta_cloud', to: digits, ...result };
}

export default { sendEcommerceText };
