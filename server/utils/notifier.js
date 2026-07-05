/**
 * Envia alertas para Discord (webhook) e/ou WhatsApp (número configurado).
 * Config: DISCORD_WEBHOOK_URL, ALERT_WHATSAPP_NUMBER (opcional).
 * Para WhatsApp, o server deve chamar setWhatsAppAlertSender(fn) com uma função (number, message) => Promise.
 */

const MAX_MESSAGE_LENGTH = 1900; // limite seguro para description de embed
import { BRANDING } from './branding.js';

/** Identifica este deploy nos alertas (útil com vários sistemas no mesmo Discord). */
const SYSTEM_NAME = BRANDING.systemName;

let whatsAppAlertSender = null;
const lastSentByKey = new Map();
let whatsAppNotifyInProgress = false;

function formatAlertBody(message) {
    const prefix = `**Sistema:** ${SYSTEM_NAME}\n\n`;
    const room = MAX_MESSAGE_LENGTH - prefix.length;
    const body = (typeof message === 'string' ? message : JSON.stringify(message, null, 2)).slice(0, Math.max(room, 200));
    return prefix + body;
}

function formatWhatsAppAlert(message, levelUpper) {
    const emoji = levelUpper === 'ERROR' ? '🔴' : levelUpper === 'WARN' ? '🟠' : '🟢';
    const body = (typeof message === 'string' ? message : JSON.stringify(message, null, 2))
        .replace(/\*\*/g, '*')
        .slice(0, 3200);
    return `${emoji} *${levelUpper}* — *${SYSTEM_NAME}*\n\n${body}`;
}

export function setWhatsAppAlertSender(fn) {
    whatsAppAlertSender = fn;
}

export function notify(message, level = 'error') {
    const text = formatAlertBody(message);
    const timestamp = new Date().toISOString();
    const levelUpper = String(level || 'info').toUpperCase();

    if (process.env.DISCORD_WEBHOOK_URL) {
        const color =
            levelUpper === 'ERROR'
                ? 0xff0000 // vermelho
                : levelUpper === 'WARN'
                ? 0xffa500 // laranja
                : 0x2ecc71; // verde

        const payload = {
            embeds: [
                {
                    title: `[${levelUpper}] ${SYSTEM_NAME} — Disparos WhatsApp`,
                    description: text,
                    timestamp,
                    color,
                    footer: { text: SYSTEM_NAME },
                },
            ],
        };

        fetch(process.env.DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
            .then((res) => {
                if (!res.ok) {
                    console.warn(`[notifier] Discord webhook HTTP ${res.status} (verifique a URL e permissões do canal).`);
                }
            })
            .catch((e) => {
                console.warn('[notifier] Falha de rede ao enviar Discord:', e?.message || e);
            });
    }

    // Opcional: alerta via WhatsApp, se configurado
    const number = process.env.ALERT_WHATSAPP_NUMBER;
    if (number && whatsAppAlertSender && !whatsAppNotifyInProgress) {
        whatsAppNotifyInProgress = true;
        Promise.resolve(whatsAppAlertSender(number, formatWhatsAppAlert(message, levelUpper)))
            .catch(() => {})
            .finally(() => {
                whatsAppNotifyInProgress = false;
            });
    }
}

/**
 * Envia notificação com cooldown por chave (evita spam).
 * Retorna true se enviou, false se foi suprimido.
 */
export function notifyOnce(key, message, level = 'error', cooldownMs = 2 * 60 * 1000) {
    const k = String(key || '').trim() || 'default';
    const now = Date.now();
    const last = lastSentByKey.get(k) || 0;
    if (now - last < cooldownMs) return false;
    lastSentByKey.set(k, now);
    notify(message, level);
    return true;
}

export async function validateDiscordWebhook() {
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url) return;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: `[${SYSTEM_NAME}] Teste de webhook`,
                    description: `**Sistema:** ${SYSTEM_NAME}\n\nConfiguração OK.`,
                    footer: { text: SYSTEM_NAME },
                    color: 0x2ecc71
                }]
            })
        });
        if (!res.ok) {
            console.warn(`[notifier] Discord webhook retornou ${res.status}; verifique DISCORD_WEBHOOK_URL.`);
        }
    } catch (e) {
        console.warn('[notifier] Falha ao validar webhook Discord:', e.message);
    }
}

export default { notify, notifyOnce, setWhatsAppAlertSender, validateDiscordWebhook };
