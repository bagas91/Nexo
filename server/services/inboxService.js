/**
 * Inbox WhatsApp — mensagens privadas recebidas/enviadas.
 */

import chatDB from '../db/database.js';
import logger from '../utils/logger.js';

function jidString(jid) {
    if (!jid) return '';
    return typeof jid === 'object' ? (jid._serialized || jid.user || '') : String(jid);
}

function digitsFromJid(jid) {
    return jidString(jid).replace(/@c\.us|@g\.us|@lid/gi, '').replace(/\D/g, '');
}

function isPrivateChatId(jid) {
    const s = jidString(jid);
    if (!s || s.includes('status') || s.includes('broadcast') || s.includes('newsletter')) return false;
    if (s.endsWith('@g.us')) return false;
    return s.endsWith('@c.us') || s.endsWith('@lid');
}

function messageBody(msg) {
    const text = String(msg.body || '').trim();
    if (text) return text;
    if (msg.hasMedia) {
        if (msg.type === 'ptt' || msg.type === 'audio') return '[áudio]';
        if (msg.type === 'image' || msg.type === 'sticker') return '[imagem]';
        if (msg.type === 'video') return '[vídeo]';
        if (msg.type === 'document') return '[documento]';
        return '[mídia]';
    }
    return '';
}

async function resolveContactName(msg) {
    let name = msg._data?.notifyName || msg._data?.pushname || '';
    try {
        if (typeof msg.getContact === 'function') {
            const contact = await msg.getContact();
            name = contact?.pushname || contact?.name || contact?.shortName || name;
        }
    } catch {
        /* ignore */
    }
    return name || '';
}

async function resolvePhone(msg, peerJid) {
    const fromJid = digitsFromJid(peerJid);
    if (fromJid && jidString(peerJid).endsWith('@c.us')) return fromJid;

    try {
        if (typeof msg.getContact === 'function') {
            const contact = await msg.getContact();
            const n = String(contact?.number || contact?.userid || '').replace(/\D/g, '');
            if (n) return n;
        }
    } catch {
        /* ignore */
    }

    try {
        if (msg.client && typeof msg.client.getNumberId === 'function') {
            const wid = await msg.client.getNumberId(fromJid || peerJid);
            const n = digitsFromJid(wid?._serialized || wid);
            if (n) return n;
        }
    } catch {
        /* ignore */
    }

    return fromJid || jidString(peerJid).split('@')[0] || 'desconhecido';
}

export async function persistInboxMessage(msg, opts = {}) {
    if (!msg || msg.isGroupMsg || msg.isStatus) return false;

    const peerJid = jidString(typeof msg._getChatId === 'function' ? msg._getChatId() : (msg.fromMe ? msg.to : msg.from));
    if (!isPrivateChatId(peerJid)) return false;

    const body = messageBody(msg);
    if (!body) return false;

    const phone = await resolvePhone(msg, peerJid);
    const contactName = await resolveContactName(msg);
    const tsRaw = Number(msg.timestamp) || 0;
    const ts = tsRaw > 1e12 ? tsRaw : (tsRaw * 1000 || Date.now());
    const id = msg.id?._serialized || msg.id || `im_${peerJid}_${ts}`;

    const saved = chatDB.saveInboxMessage({
        id,
        chatId: peerJid,
        phone,
        contactName,
        body,
        fromMe: !!msg.fromMe,
        ts,
    }, opts);

    if (saved) {
        logger.info('Inbox: mensagem registrada', {
            from: msg.fromMe ? 'eu' : `${phone.slice(0, 6)}…`,
            preview: body.slice(0, 40),
        });

        if (!msg.fromMe && !opts.silent) {
            const isNewContact = chatDB.countInboundMessages(peerJid) === 1;

            import('./followUpEngine.js').then(({ handleInboundMessage }) => {
                handleInboundMessage({ chatId: peerJid, phone, contactName, body, isNewContact });
            }).catch((err) => {
                logger.warn('Inbox: falha ao processar follow ups', err?.message || err);
            });

            import('./attendanceService.js').then(({ scheduleAgentReply }) => {
                scheduleAgentReply({ chatId: peerJid, phone, contactName, body });
            }).catch((err) => {
                logger.warn('Inbox: falha ao agendar atendimento', err?.message || err);
            });
        }
    }
    return saved;
}

export async function syncRecentInbox(client, { chatLimit = 40, messageLimit = 25 } = {}) {
    if (!client || typeof client.getChats !== 'function') return { synced: 0 };

    let synced = 0;
    try {
        const chats = await client.getChats();
        const all = Array.isArray(chats) ? chats : [];
        const privates = all
            .filter((c) => {
                if (!c || c.isGroup) return false;
                const id = jidString(c.id?._serialized || c.id);
                return isPrivateChatId(id);
            })
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, chatLimit);

        logger.info(`Inbox: sync — ${privates.length} chat(s) privados de ${all.length} total`);

        for (const chat of privates) {
            try {
                const messages = await chat.fetchMessages({ limit: messageLimit });
                for (const msg of messages) {
                    if (await persistInboxMessage(msg, { silent: true })) synced += 1;
                }
            } catch (err) {
                logger.warn('Inbox: sync chat falhou', err?.message || err);
            }
        }
        logger.info(`Inbox: sync concluído — ${synced} mensagem(ns) importadas`);
    } catch (err) {
        logger.error('Inbox: syncRecentInbox falhou', err?.message || err);
    }
    return { synced };
}

export default { persistInboxMessage, syncRecentInbox };
