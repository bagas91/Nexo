/**
 * Monitora conversas em que o cliente falou e ninguém respondeu há X minutos.
 * Marca como atendimento humano + notifica Discord/WhatsApp de alerta.
 */

import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import notifier from '../utils/notifier.js';
import { getAttendanceConfig } from '../utils/platformDefaults.js';
import { BRANDING } from '../utils/branding.js';

let running = false;

function preview(text, n = 80) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

export async function processIdleHumanAlerts() {
    if (running) return { checked: 0, alerted: 0 };
    running = true;
    try {
        const cfg = getAttendanceConfig();
        if (cfg.idleHumanAlertEnabled === false) {
            return { checked: 0, alerted: 0 };
        }

        const minutes = Math.max(1, Number(cfg.idleHumanAlertMinutes) || 5);
        const waiting = chatDB.listConversationsAwaitingReply(minutes);
        if (!waiting.length) return { checked: 0, alerted: 0 };

        let alerted = 0;
        for (const conv of waiting) {
            chatDB.markInboxHumanAlert(conv.chatId);

            const name = conv.contactName || conv.phone || 'Cliente';
            const msg = [
                `⏰ Atendimento humano necessário (~${conv.waitMinutes} min sem resposta)`,
                `Cliente: ${name}`,
                conv.phone ? `Tel/ID: ${conv.phone}` : null,
                `Última msg: ${preview(conv.lastMessage)}`,
                `Abra Conversas no ${BRANDING.productName} e assuma o chat.`,
            ].filter(Boolean).join('\n');

            notifier.notifyOnce(
                `idle-human-${conv.chatId}`,
                msg,
                'warn',
                30 * 60 * 1000,
            );

            const customerMsg = String(cfg.idleHumanCustomerMessage || cfg.handoffMessage || '').trim();
            const maxWaitForCustomerMsg = minutes + 20;
            if (
                customerMsg
                && cfg.idleHumanNotifyCustomer !== false
                && conv.waitMinutes <= maxWaitForCustomerMsg
            ) {
                try {
                    const { default: whatsappClient } = await import('./whatsappClient.js');
                    if (whatsappClient.getStatus?.().ready) {
                        await whatsappClient.sendChatMessage(conv.chatId, customerMsg);
                    }
                } catch (err) {
                    logger.warn('Idle human: falha ao avisar cliente', err?.message || err);
                }
            }

            alerted += 1;
            logger.info('Idle human: conversa marcada para humano', {
                chatId: String(conv.chatId).slice(0, 18),
                waitMinutes: conv.waitMinutes,
            });
        }

        return { checked: waiting.length, alerted };
    } finally {
        running = false;
    }
}

export default { processIdleHumanAlerts };
