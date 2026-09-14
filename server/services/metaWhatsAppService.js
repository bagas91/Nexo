/**
 * WhatsApp Cloud API (Meta) — canal oficial do E-commerce / CRM.
 */

import crypto from 'crypto';
import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import {
    mergeMetaWhatsAppConfig,
    maskMetaWhatsAppConfigForClient,
    hasMetaWhatsAppCredentials,
} from '../utils/metaWhatsAppConfig.js';

const KV_KEY = 'meta_whatsapp';
const DEFAULT_GRAPH = 'v21.0';

export function getRawMetaConfig() {
    return chatDB.getPlatformKv(KV_KEY) || {};
}

export function getMetaConfigForClient() {
    return maskMetaWhatsAppConfigForClient(getRawMetaConfig());
}

export function saveMetaConfig(incoming) {
    const next = mergeMetaWhatsAppConfig(getRawMetaConfig(), incoming || {});
    chatDB.setPlatformKv(KV_KEY, next);
    return maskMetaWhatsAppConfigForClient(next);
}

export function isMetaConfigured() {
    return hasMetaWhatsAppCredentials(getRawMetaConfig());
}

export function isMetaConnected() {
    const cfg = getRawMetaConfig();
    return hasMetaWhatsAppCredentials(cfg) && cfg.connected !== false;
}

export function getMetaEcommerceStatus() {
    const cfg = getRawMetaConfig();
    const ready = isMetaConnected();
    return {
        role: 'ecommerce',
        label: 'E-commerce — Cloud API Meta',
        shortLabel: 'E-commerce',
        description: 'CRM e atendimento via API oficial Meta',
        provider: 'meta_cloud',
        status: ready ? 'CONNECTED' : 'DISCONNECTED',
        ready,
        authenticated: ready,
        phoneNumberId: cfg.phoneNumberId || '',
        displayPhone: cfg.displayPhone || '',
        lastWebhookAt: cfg.lastWebhookAt || null,
        lastError: cfg.lastError || null,
    };
}

function graphBase(cfg) {
    const ver = String(cfg.graphVersion || DEFAULT_GRAPH).replace(/^\//, '') || DEFAULT_GRAPH;
    return `https://graph.facebook.com/${ver}`;
}

function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
}

function setLastError(message) {
    const cfg = getRawMetaConfig();
    chatDB.setPlatformKv(KV_KEY, {
        ...cfg,
        lastError: String(message || '').slice(0, 500),
        updatedAt: Date.now(),
    });
}

function clearLastError() {
    const cfg = getRawMetaConfig();
    if (!cfg.lastError) return;
    chatDB.setPlatformKv(KV_KEY, { ...cfg, lastError: null, updatedAt: Date.now() });
}

export function verifyMetaWebhook(query = {}) {
    const mode = String(query['hub.mode'] || query.hub_mode || '');
    const token = String(query['hub.verify_token'] || query.hub_verify_token || '');
    const challenge = query['hub.challenge'] || query.hub_challenge;
    const cfg = getRawMetaConfig();
    const expected = String(cfg.verifyToken || '').trim();
    if (mode === 'subscribe' && expected && token === expected) {
        return { ok: true, challenge: String(challenge ?? '') };
    }
    return { ok: false, error: 'Verify token inválido' };
}

export function validateMetaSignature(rawBody, signatureHeader) {
    const cfg = getRawMetaConfig();
    const secret = String(cfg.appSecret || '').trim();
    if (!secret) return true; // sem secret configurado: não bloqueia (dev)
    const header = String(signatureHeader || '');
    if (!header.startsWith('sha256=')) return false;
    const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
    const received = header.slice('sha256='.length);
    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
    } catch {
        return false;
    }
}

/**
 * Envia texto 1:1 pela Cloud API.
 * @param {string} toPhone - dígitos com DDI (ex.: 5511999999999)
 * @param {string} text
 */
export async function sendText(toPhone, text) {
    const cfg = getRawMetaConfig();
    if (!hasMetaWhatsAppCredentials(cfg) || cfg.connected === false) {
        throw new Error('WhatsApp E-commerce (Cloud API) não configurado. Vá em Conexões e salve Phone Number ID + Access Token.');
    }
    const to = digitsOnly(toPhone);
    const body = String(text || '').trim();
    if (!to || to.length < 10) throw new Error('Número de destino inválido para Cloud API');
    if (!body) throw new Error('Mensagem vazia');

    const url = `${graphBase(cfg)}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${cfg.accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: false, body },
        }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data?.error?.message || `Graph API HTTP ${res.status}`;
        setLastError(msg);
        logger.error('Meta WA: falha ao enviar texto', msg);
        throw new Error(msg);
    }
    clearLastError();
    const messageId = data?.messages?.[0]?.id || null;
    logger.info('Meta WA: texto enviado', { to: `${to.slice(0, 4)}…`, id: messageId });
    return { success: true, messageId, raw: data };
}

export async function sendTestMessage(toPhone, text) {
    const msg = String(text || '').trim()
        || `Teste Nexo Cloud API — ${new Date().toLocaleString('pt-BR')}`;
    return sendText(toPhone, msg);
}

function mediaLabel(type) {
    const t = String(type || '').toLowerCase();
    if (t === 'image' || t === 'sticker') return '[imagem]';
    if (t === 'audio' || t === 'voice') return '[áudio]';
    if (t === 'video') return '[vídeo]';
    if (t === 'document') return '[documento]';
    if (t === 'location') return '[localização]';
    if (t === 'contacts') return '[contato]';
    if (t === 'interactive' || t === 'button' || t === 'list') return '[interativo]';
    if (t === 'reaction') return '';
    return t && t !== 'text' ? `[${t}]` : '';
}

function extractInboundText(message) {
    if (!message) return { body: '', mediaType: null };
    const type = message.type;
    if (type === 'text') {
        return { body: String(message.text?.body || '').trim(), mediaType: null };
    }
    if (type === 'button') {
        return { body: String(message.button?.text || message.button?.payload || '').trim(), mediaType: null };
    }
    if (type === 'interactive') {
        const title = message.interactive?.button_reply?.title
            || message.interactive?.list_reply?.title
            || '';
        return { body: String(title).trim(), mediaType: null };
    }
    if (type === 'image') {
        const caption = String(message.image?.caption || '').trim();
        return { body: caption || '[imagem]', mediaType: 'image' };
    }
    if (type === 'audio' || type === 'voice') {
        return { body: '[áudio]', mediaType: 'audio' };
    }
    if (type === 'video') {
        const caption = String(message.video?.caption || '').trim();
        return { body: caption || '[vídeo]', mediaType: 'video' };
    }
    if (type === 'document') {
        const caption = String(message.document?.caption || message.document?.filename || '').trim();
        return { body: caption || '[documento]', mediaType: 'document' };
    }
    const label = mediaLabel(type);
    return { body: label, mediaType: type || null };
}

/**
 * Processa payload webhook Meta e grava no inbox.
 */
export async function handleMetaWebhookPayload(body) {
    if (!body || body.object !== 'whatsapp_business_account') {
        return { processed: 0, skipped: true };
    }

    const cfg = getRawMetaConfig();
    chatDB.setPlatformKv(KV_KEY, { ...cfg, lastWebhookAt: Date.now() });

    const { persistMetaInboxMessage } = await import('./inboxService.js');
    let processed = 0;

    for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
            const value = change.value || {};
            if (change.field && change.field !== 'messages') continue;

            const contacts = value.contacts || [];
            const contactNameByWaId = new Map(
                contacts.map((c) => [String(c.wa_id || ''), String(c.profile?.name || '')])
            );

            for (const msg of value.messages || []) {
                try {
                    const from = digitsOnly(msg.from);
                    if (!from) continue;
                    const { body: text, mediaType } = extractInboundText(msg);
                    if (!text && !mediaType) continue;
                    const tsSec = Number(msg.timestamp) || Math.floor(Date.now() / 1000);
                    const ok = await persistMetaInboxMessage({
                        id: String(msg.id || `meta_${from}_${tsSec}`),
                        phone: from,
                        contactName: contactNameByWaId.get(from) || '',
                        body: text,
                        fromMe: false,
                        ts: tsSec * 1000,
                        mediaType,
                    });
                    if (ok) processed += 1;
                } catch (err) {
                    logger.warn('Meta WA: falha ao persistir inbound', err?.message || err);
                }
            }

            // Status updates (delivered/read) — ignore for MVP
            for (const st of value.statuses || []) {
                logger.debug?.('Meta WA: status', st.status, st.id);
            }
        }
    }

    return { processed };
}

export default {
    getRawMetaConfig,
    getMetaConfigForClient,
    saveMetaConfig,
    isMetaConfigured,
    isMetaConnected,
    getMetaEcommerceStatus,
    verifyMetaWebhook,
    validateMetaSignature,
    sendText,
    sendTestMessage,
    handleMetaWebhookPayload,
};
