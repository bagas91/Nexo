/**
 * Inbox WhatsApp — mensagens privadas recebidas/enviadas.
 */

import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import { saveInboxMediaBase64, mediaCategory, saveInboxAvatarBuffer } from './inboxMediaService.js';

function jidString(jid) {
    if (!jid) return '';
    return typeof jid === 'object' ? (jid._serialized || jid.user || '') : String(jid);
}

function digitsFromJid(jid) {
    return jidString(jid).replace(/@c\.us|@g\.us|@lid/gi, '').replace(/\D/g, '');
}

/** Telefone real (BR/internacional curto). LID do WhatsApp costuma ter 14+ dígitos. */
export function isLikelyRealPhone(digits) {
    const d = String(digits || '').replace(/\D/g, '');
    if (d.length < 10 || d.length > 13) return false;
    if (d.startsWith('55')) return d.length === 12 || d.length === 13;
    return true;
}

export function isLikelyLidDigits(digits, peerJid = '') {
    const d = String(digits || '').replace(/\D/g, '');
    if (!d) return false;
    if (d.length > 13) return true;
    const jid = jidString(peerJid);
    if (jid.endsWith('@lid') && d === digitsFromJid(jid)) return true;
    return false;
}

function isPrivateChatId(jid) {
    const s = jidString(jid);
    if (!s || s.includes('status') || s.includes('broadcast') || s.includes('newsletter')) return false;
    if (s.endsWith('@g.us')) return false;
    return s.endsWith('@c.us') || s.endsWith('@lid');
}

/** Resolve PN (número) a partir de um JID @lid via API do whatsapp-web.js. */
async function resolvePnFromClient(client, peerJid) {
    if (!client || typeof client.getContactLidAndPhone !== 'function') return '';
    const jid = jidString(peerJid);
    if (!jid) return '';
    try {
        const pairs = await client.getContactLidAndPhone([jid]);
        const pn = pairs?.[0]?.pn;
        const digits = digitsFromJid(pn);
        if (isLikelyRealPhone(digits)) return digits;
    } catch {
        /* ignore */
    }
    return '';
}

function messageBody(msg) {
    let text = String(msg.body || '').trim();
    // Store às vezes devolve data URL / base64 no body de mídia
    if (text.startsWith('/9j/') || text.startsWith('data:image') || text.length > 2000) {
        text = '';
    }
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

/** better-sqlite3 trata objeto no .run() como named params — id precisa ser string. */
function resolveMessageId(msg, peerJid, ts) {
    const raw = msg?.id;
    if (typeof raw === 'string' && raw) return raw;
    if (raw && typeof raw === 'object') {
        if (raw._serialized) return String(raw._serialized);
        if (raw.id) {
            const flag = msg.fromMe ? 'true' : 'false';
            return `${flag}_${peerJid}_${raw.id}`;
        }
    }
    return `im_${peerJid}_${ts}`;
}

async function resolveContactName(msg, peerJid) {
    // Mensagens enviadas: notifyName é da conta conectada, não do cliente
    if (msg.fromMe) {
        try {
            if (typeof msg.getContact === 'function') {
                const contact = await msg.getContact();
                const n = contact?.pushname || contact?.name || contact?.shortName || '';
                if (n) return String(n).trim();
            }
        } catch {
            /* ignore */
        }
        return '';
    }
    let name = msg._data?.notifyName || msg._data?.pushname || '';
    try {
        if (typeof msg.getContact === 'function') {
            const contact = await msg.getContact();
            name = contact?.pushname || contact?.name || contact?.shortName || name;
        }
    } catch {
        /* ignore */
    }
    if (!name && peerJid) {
        name = await resolveChatNameFromStore(msg?.client, peerJid);
    }
    return String(name || '').trim();
}

/** Nome do chat no store WA (mais confiável que notifyName em sync). */
async function resolveChatNameFromStore(client, chatId) {
    const map = await fetchChatNamesFromStore(client, [chatId]);
    return map.get(String(chatId)) || '';
}

async function fetchChatNamesFromStore(client, chatIds) {
    const out = new Map();
    if (!client?.pupPage || !chatIds?.length) return out;
    try {
        const rows = await client.pupPage.evaluate((ids) => {
            const result = {};
            try {
                const Chat = window.require('WAWebCollections').Chat;
                const all = typeof Chat.getModelsArray === 'function' ? Chat.getModelsArray() : [];
                const byId = new Map();
                for (const c of all) {
                    const id = c.id?._serialized || (typeof c.id === 'string' ? c.id : '');
                    if (id) byId.set(String(id), c);
                }
                for (const chatId of ids) {
                    const chat = (typeof Chat.get === 'function' ? Chat.get(chatId) : null) || byId.get(chatId);
                    if (!chat) continue;
                    const contact = chat.contact || chat.__x_contact || null;
                    const name = String(
                        chat.formattedTitle
                        || chat.name
                        || contact?.pushname
                        || contact?.name
                        || contact?.shortName
                        || '',
                    ).trim();
                    if (name) result[chatId] = name;
                }
            } catch {
                /* store indisponível */
            }
            return result;
        }, chatIds);
        for (const [id, name] of Object.entries(rows || {})) {
            if (name) out.set(String(id), String(name));
        }
    } catch {
        /* ignore */
    }
    return out;
}

/** Corrige nomes errados (ex.: conta conectada repetida em vários chats). */
export async function backfillContactNames(client, { limit = 120 } = {}) {
    if (!client?.pupPage) return { updated: 0 };
    const convos = chatDB.listInboxConversations(250);
    const chatIds = convos.map((c) => String(c.id || '')).filter(Boolean).slice(0, limit);
    const names = await fetchChatNamesFromStore(client, chatIds);

    const nameCounts = new Map();
    for (const c of convos) {
        const n = String(c.contactName || '').trim();
        if (n) nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
    }

    let updated = 0;
    for (const c of convos.slice(0, limit)) {
        const chatId = String(c.id || '');
        const storeName = names.get(chatId);
        if (!storeName) continue;
        const current = String(c.contactName || '').trim();
        const duplicated = current && (nameCounts.get(current) || 0) >= 8;
        if (current === storeName) continue;
        if (!duplicated && current.length > 2) continue;
        chatDB.updateInboxConversationContactName(chatId, storeName);
        updated += 1;
    }
    if (updated) logger.info(`Inbox: backfill nomes — ${updated} conversa(s)`);
    return { updated };
}

/**
 * Resolve MSISDN real. Nunca persiste dígitos de @lid (IDs internos do WhatsApp).
 */
async function resolvePhone(msg, peerJid) {
    const jid = jidString(peerJid);
    const fromJid = digitsFromJid(peerJid);
    if (jid.endsWith('@c.us') && isLikelyRealPhone(fromJid)) return fromJid;

    const client = msg?.client || null;
    if (jid.endsWith('@lid') || isLikelyLidDigits(fromJid, jid)) {
        const pn = await resolvePnFromClient(client, jid);
        if (pn) return pn;
    }

    try {
        if (typeof msg.getContact === 'function') {
            const contact = await msg.getContact();
            const idSer = contact?.id?._serialized || contact?.id || '';
            if (String(idSer).endsWith('@c.us')) {
                const n = digitsFromJid(idSer);
                if (isLikelyRealPhone(n)) return n;
            }
            const pnField = contact?.phoneNumber?._serialized || contact?.phoneNumber || '';
            if (pnField) {
                const n = digitsFromJid(pnField);
                if (isLikelyRealPhone(n)) return n;
            }
            // contact.number em @lid = userid (LID) — não usar
            const n = String(contact?.number || '').replace(/\D/g, '');
            if (isLikelyRealPhone(n) && !isLikelyLidDigits(n, peerJid)) return n;
            const pn = await resolvePnFromClient(client, idSer || jid);
            if (pn) return pn;
        }
    } catch {
        /* ignore */
    }

    return '';
}

/** Corrige phones LID já gravados usando a API lid↔pn do WhatsApp. */
export async function backfillLidPhones(client, { limit = 80 } = {}) {
    if (!client || typeof client.getContactLidAndPhone !== 'function') return { updated: 0 };
    const convos = chatDB.listInboxConversations(250);
    let updated = 0;
    for (const c of convos) {
        if (updated >= limit) break;
        const chatId = String(c.id || c.chatId || '');
        if (!chatId.includes('@lid')) continue;
        const phone = String(c.phone || '');
        if (isLikelyRealPhone(phone) && !isLikelyLidDigits(phone, chatId)) continue;
        const pn = await resolvePnFromClient(client, chatId);
        if (!pn) {
            if (isLikelyLidDigits(phone, chatId)) chatDB.updateInboxConversationPhone(chatId, '');
            continue;
        }
        chatDB.updateInboxConversationPhone(chatId, pn);
        try {
            const contacts = chatDB.listPlatformEntities('contacts');
            const lidDigits = digitsFromJid(chatId);
            const byLid = contacts.find((x) => String(x.phone || '').replace(/\D/g, '') === lidDigits
                || String(x.phone || '').replace(/\D/g, '') === phone.replace(/\D/g, '')
                || String(x.id || '') === `c_${lidDigits}`);
            if (byLid) {
                chatDB.savePlatformEntity('contacts', {
                    ...byLid,
                    id: `c_${pn}`,
                    phone: pn,
                    lastSeen: Date.now(),
                });
                if (byLid.id !== `c_${pn}`) {
                    try { chatDB.deletePlatformEntity('contacts', byLid.id); } catch { /* ignore */ }
                }
            }
        } catch {
            /* ignore */
        }
        updated += 1;
    }
    if (updated) logger.info(`Inbox: backfill LID→telefone — ${updated} conversa(s)`);
    return { updated };
}

/** Baixa a mídia de uma Message real do whatsapp-web.js (se possível). */
async function downloadMediaForMessage(msg, id) {
    if (!msg?.hasMedia) return null;
    try {
        // Usa o downloader in-page (msg.downloadMedia nativo estoura "r" nesta versão)
        const client = msg.client;
        const media = client ? await downloadMediaFromStore(client, id) : null;
        if (!media || !media.data) return null;
        const filename = media.filename || msg._data?.filename || '';
        return saveInboxMediaBase64(id, msg.type, media.mimetype, media.data, filename);
    } catch (err) {
        logger.warn('Inbox: download de mídia falhou', err?.message || String(err));
        return null;
    }
}

export async function persistInboxMessage(msg, opts = {}) {
    if (!msg || msg.isGroupMsg || msg.isStatus) return false;

    const peerJid = jidString(typeof msg._getChatId === 'function' ? msg._getChatId() : (msg.fromMe ? msg.to : msg.from));
    if (!isPrivateChatId(peerJid)) return false;

    const body = messageBody(msg); // texto/caption ou rótulo [áudio]/[imagem]…
    const hasMedia = !!msg.hasMedia;
    if (!body && !hasMedia) return false;

    let phone = await resolvePhone(msg, peerJid);
    if (!isLikelyRealPhone(phone)) {
        const prev = chatDB.getInboxConversation(peerJid)?.phone || '';
        if (isLikelyRealPhone(prev)) phone = String(prev);
        else phone = '';
    }
    let contactName = await resolveContactName(msg, peerJid);
    if (!contactName && !msg.fromMe) {
        contactName = await resolveChatNameFromStore(msg?.client, peerJid);
    }
    const tsRaw = Number(msg.timestamp) || 0;
    const ts = tsRaw > 1e12 ? tsRaw : (tsRaw * 1000 || Date.now());
    const id = resolveMessageId(msg, peerJid, ts);

    let mediaInfo = null;
    if (hasMedia) {
        mediaInfo = await downloadMediaForMessage(msg, id);
    }
    // Se é mídia mas não conseguimos baixar, ao menos registra a categoria p/ mostrar rótulo
    const mediaType = mediaInfo?.mediaType || (hasMedia ? mediaCategory(msg.type, msg._data?.mimetype) : null);

    const saved = chatDB.saveInboxMessage({
        id,
        chatId: peerJid,
        phone: String(phone || ''),
        contactName: String(contactName || ''),
        body: String(body),
        fromMe: !!msg.fromMe,
        ts,
        mediaType,
        mediaFile: mediaInfo?.mediaFile || null,
        mimetype: mediaInfo?.mimetype || null,
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

            import('./flowEngine.js').then(({ handleInboundMessageForFlows }) => {
                handleInboundMessageForFlows({ chatId: peerJid, phone, contactName, body, isNewContact });
            }).catch((err) => {
                logger.warn('Inbox: falha ao processar fluxos', err?.message || err);
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

async function discoverPrivateChatIds(client, limit = 40) {
    const ids = [];
    if (client?.pupPage) {
        try {
            const fromStore = await client.pupPage.evaluate((max) => {
                try {
                    const chats = window.require('WAWebCollections').Chat.getModelsArray();
                    return chats
                        .map((c) => {
                            const id = c.id?._serialized || (typeof c.id === 'string' ? c.id : '');
                            const idStr = String(id || '');
                            const isGroup = !!(
                                c.isGroup ||
                                c.groupMetadata ||
                                idStr.includes('@g.us') ||
                                idStr.includes('@newsletter') ||
                                idStr.includes('status') ||
                                idStr.includes('broadcast')
                            );
                            const ts = Number(c.t || c.timestamp || 0) || 0;
                            return { id: idStr, isGroup, ts };
                        })
                        .filter((c) => c.id && c.id !== '0@c.us' && !c.isGroup && (c.id.endsWith('@c.us') || c.id.endsWith('@lid')))
                        .sort((a, b) => b.ts - a.ts)
                        .slice(0, max)
                        .map((c) => c.id);
                } catch {
                    return [];
                }
            }, limit);
            if (Array.isArray(fromStore)) ids.push(...fromStore);
        } catch (err) {
            logger.warn('Inbox: store de chats privados indisponível', err?.message || String(err));
        }
    }
    return [...new Set(ids)];
}

/** Lê mensagens do store (evita getChats/getChatById que têm falhado com erro "r"). */
async function fetchMessagesFromStore(client, chatIds, messageLimit) {
    if (!client?.pupPage || !chatIds.length) return [];
    return client.pupPage.evaluate((ids, limit) => {
        const out = [];
        try {
            const Chat = window.require('WAWebCollections').Chat;
            const all = typeof Chat.getModelsArray === 'function' ? Chat.getModelsArray() : [];
            const byId = new Map();
            for (const c of all) {
                const id = c.id?._serialized || (typeof c.id === 'string' ? c.id : '');
                if (id) byId.set(String(id), c);
            }
            for (const chatId of ids) {
                try {
                    const chat = (typeof Chat.get === 'function' ? Chat.get(chatId) : null) || byId.get(chatId);
                    if (!chat) continue;
                    let msgs = [];
                    if (chat.msgs && typeof chat.msgs.getModelsArray === 'function') {
                        msgs = chat.msgs.getModelsArray();
                    } else if (chat.msgs && Array.isArray(chat.msgs._models)) {
                        msgs = chat.msgs._models;
                    }
                    const slice = msgs.slice(-limit);
                    for (const m of slice) {
                        const mid = m.id?._serialized
                            || (m.id?.id ? `${m.id.fromMe ? 'true' : 'false'}_${m.id.remote || chatId}_${m.id.id}` : null);
                        if (!mid) continue;
                        out.push({
                            id: String(mid),
                            chatId,
                            body: String(m.body || m.caption || ''),
                            type: m.type || '',
                            fromMe: !!(m.id?.fromMe || m.fromMe),
                            timestamp: Number(m.t || m.timestamp || 0) || 0,
                            notifyName: String(m.notifyName || m._data?.notifyName || ''),
                            hasMedia: !!(m.isMedia || m.hasMedia || ['ptt', 'audio', 'image', 'video', 'document', 'sticker'].includes(m.type)),
                        });
                    }
                } catch {
                    /* skip chat */
                }
            }
        } catch {
            /* store indisponível */
        }
        return out;
    }, chatIds, messageLimit);
}

export async function syncRecentInbox(client, {
    chatLimit = 40,
    messageLimit = 25,
    skipMedia = false,
    skipAvatars = false,
    /** Se > 0, mensagens novas entrantes nesse intervalo (ms) disparam o agente (mesmo com silent). */
    triggerAgentForRecentMs = 0,
} = {}) {
    if (!client) return { synced: 0 };

    let synced = 0;
    const known = chatDB.listInboxConversations(200).map((c) => c.id).filter(Boolean);
    let discovered = [];
    try {
        discovered = await discoverPrivateChatIds(client, chatLimit);
    } catch (err) {
        logger.warn('Inbox: descoberta de chats falhou', err?.message || String(err));
    }

    const ordered = [];
    const seen = new Set();
    for (const id of [...discovered, ...known]) {
        if (!id || seen.has(id) || !isPrivateChatId(id) || id === '0@c.us') continue;
        seen.add(id);
        ordered.push(id);
        if (ordered.length >= chatLimit) break;
    }

    logger.info(`Inbox: sync — ${ordered.length} chat(s) privados (store/conhecidos)`);

    let rows = [];
    try {
        rows = await fetchMessagesFromStore(client, ordered, messageLimit);
    } catch (err) {
        logger.warn('Inbox: fetch via store falhou', err?.message || String(err));
    }

    logger.info(`Inbox: sync — ${rows.length} mensagem(ns) lidas do store`);

    const agentTriggers = [];
    let mediaBudget = skipMedia ? 0 : 40;
    for (const row of rows) {
        try {
            const fakeMsg = {
                isGroupMsg: false,
                isStatus: false,
                fromMe: row.fromMe,
                body: row.body,
                timestamp: row.timestamp,
                type: row.type,
                hasMedia: row.hasMedia,
                id: row.id,
                from: row.fromMe ? undefined : row.chatId,
                to: row.fromMe ? row.chatId : undefined,
                _data: { notifyName: row.notifyName },
                _getChatId: () => row.chatId,
                client, // permite resolver @lid → telefone no sync
            };
            const wasNew = await persistInboxMessage(fakeMsg, { silent: true });
            if (wasNew) synced += 1;

            if (
                wasNew
                && !row.fromMe
                && triggerAgentForRecentMs > 0
                && String(row.body || '').trim()
            ) {
                const tsRaw = Number(row.timestamp) || 0;
                const ts = tsRaw > 1e12 ? tsRaw : (tsRaw * 1000 || 0);
                const age = ts ? (Date.now() - ts) : 0;
                if (ts && age >= 0 && age <= triggerAgentForRecentMs) {
                    agentTriggers.push({
                        chatId: row.chatId,
                        phone: (() => {
                            const d = digitsFromJid(row.chatId);
                            return isLikelyRealPhone(d) ? d : '';
                        })(),
                        contactName: row.notifyName || '',
                        body: String(row.body || '').trim(),
                    });
                }
            }

            if (wasNew && row.hasMedia && mediaBudget > 0) {
                mediaBudget -= 1;
                const media = await downloadMediaFromStore(client, row.id);
                if (media?.data) {
                    const info = saveInboxMediaBase64(row.id, row.type, media.mimetype, media.data, media.filename);
                    if (info) chatDB.updateInboxMessageMedia(row.id, info);
                }
            }
        } catch (err) {
            logger.warn('Inbox: sync msg falhou', err?.message || String(err));
        }
    }

    // Uma disparada por chat (a mais recente do lote)
    if (agentTriggers.length) {
        const byChat = new Map();
        for (const t of agentTriggers) byChat.set(t.chatId, t);
        const { scheduleAgentReply } = await import('./attendanceService.js');
        for (const t of byChat.values()) {
            logger.info('Inbox: sync acionou agente', {
                chatId: String(t.chatId).slice(0, 18),
                preview: t.body.slice(0, 40),
            });
            scheduleAgentReply(t);
        }
    }

    if (!skipMedia) {
        try {
            const legacyMarked = chatDB.backfillLegacyMediaTypes();
            if (legacyMarked) logger.info(`Inbox: ${legacyMarked} mensagem(ns) antigas marcadas como mídia`);
            const pendingMedia = chatDB.listInboxMessagesNeedingMedia(150);
            let ok = 0;
            for (const row of pendingMedia) {
                const media = await downloadMediaFromStore(client, row.id);
                if (media?.data) {
                    const info = saveInboxMediaBase64(row.id, row.mediaType, media.mimetype, media.data, media.filename);
                    if (info) { chatDB.updateInboxMessageMedia(row.id, info); ok += 1; }
                }
            }
            logger.info(`Inbox: backfill de mídia — ${ok}/${pendingMedia.length} baixadas`);
        } catch (err) {
            logger.warn('Inbox: backfill de mídia falhou', err?.message || String(err));
        }
    }

    if (!skipAvatars) {
        try {
            await refreshInboxAvatars(client);
        } catch (err) {
            logger.warn('Inbox: refresh de avatares falhou', err?.message || String(err));
        }
    }

    try {
        const bf = await backfillLidPhones(client, { limit: 120 });
        if (bf.updated) logger.info(`Inbox: ${bf.updated} telefone(s) resolvidos de @lid`);
    } catch (err) {
        logger.warn('Inbox: backfill LID falhou', err?.message || String(err));
    }

    try {
        const bn = await backfillContactNames(client, { limit: 120 });
        if (bn.updated) logger.info(`Inbox: ${bn.updated} nome(s) de contato corrigidos`);
    } catch (err) {
        logger.warn('Inbox: backfill nomes falhou', err?.message || String(err));
    }

    logger.info(`Inbox: sync concluído — ${synced} mensagem(ns) importadas`);
    return { synced };
}

/**
 * Baixa mídia de uma mensagem pelo id, replicando a implementação do whatsapp-web.js,
 * mas via window.require (nesta versão window.Store/WWebJS.downloadMedia não existem).
 */
async function downloadMediaFromStore(client, messageId) {
    if (!client?.pupPage) return null;
    try {
        return await client.pupPage.evaluate(async (mid) => {
            try {
                const Collections = window.require('WAWebCollections');
                const Msg = Collections?.Msg;
                if (!Msg) return null;
                let msg = typeof Msg.get === 'function' ? Msg.get(mid) : null;
                if (!msg && typeof Msg.getMessagesById === 'function') {
                    const r = await Msg.getMessagesById([mid]);
                    msg = r?.messages?.[0] || null;
                }
                if (!msg || !msg.mediaData || msg.mediaData.mediaStage === 'REUPLOADING') return null;

                if (msg.mediaData.mediaStage !== 'RESOLVED' && typeof msg.downloadMedia === 'function') {
                    try {
                        await msg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
                    } catch { /* segue mesmo assim */ }
                }
                const stage = String(msg.mediaData.mediaStage || '');
                if (stage.includes('ERROR') || stage === 'FETCHING') return null;

                const DM = window.require('WAWebDownloadManager')?.downloadManager;
                if (!DM || typeof DM.downloadAndMaybeDecrypt !== 'function') return null;
                const mockQpl = { addAnnotations() { return this; }, addPoint() { return this; } };
                const buf = await DM.downloadAndMaybeDecrypt({
                    directPath: msg.directPath,
                    encFilehash: msg.encFilehash,
                    filehash: msg.filehash,
                    mediaKey: msg.mediaKey,
                    mediaKeyTimestamp: msg.mediaKeyTimestamp,
                    type: msg.type,
                    signal: new AbortController().signal,
                    downloadQpl: mockQpl,
                });
                const data = await window.WWebJS.arrayBufferToBase64Async(buf);
                return { data, mimetype: msg.mimetype, filename: msg.filename || '' };
            } catch {
                return null;
            }
        }, messageId);
    } catch {
        return null;
    }
}

/** Foto de perfil via store (base64) — fallback quando getProfilePicUrl falha. */
async function profilePicBase64FromStore(client, chatId) {
    if (!client?.pupPage) return null;
    try {
        return await client.pupPage.evaluate(async (id) => {
            try {
                if (window.WWebJS && typeof window.WWebJS.getProfilePicThumbToBase64 === 'function') {
                    const b64 = await window.WWebJS.getProfilePicThumbToBase64(id);
                    return b64 || null;
                }
                const Store = window.Store || {};
                const ppt = Store.ProfilePicThumb;
                const wid = Store.WidFactory ? Store.WidFactory.createWid(id) : id;
                if (ppt && typeof ppt.find === 'function') {
                    const pic = await ppt.find(wid);
                    const url = pic?.eurl || pic?.img || pic?.imgFull;
                    if (url) {
                        const resp = await fetch(url);
                        const blob = await resp.blob();
                        return await new Promise((resolve) => {
                            const r = new FileReader();
                            r.onloadend = () => resolve(String(r.result || '').split(',')[1] || null);
                            r.onerror = () => resolve(null);
                            r.readAsDataURL(blob);
                        });
                    }
                }
            } catch {
                return null;
            }
            return null;
        }, chatId);
    } catch {
        return null;
    }
}

/** Atualiza fotos de perfil (avatares) das conversas que estão sem/desatualizadas. */
export async function refreshInboxAvatars(client) {
    if (!client) return;
    const pending = chatDB.listInboxChatIdsNeedingAvatar();
    if (!pending.length) return;

    let saved = 0;
    let urlOk = 0;
    let storeOk = 0;
    for (const { chatId } of pending) {
        let file = null;
        // 1) via getProfilePicUrl + fetch
        try {
            if (typeof client.getProfilePicUrl === 'function') {
                const url = await client.getProfilePicUrl(chatId);
                if (url) {
                    const resp = await fetch(url);
                    if (resp.ok) {
                        const buf = Buffer.from(await resp.arrayBuffer());
                        const ext = (resp.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
                        file = saveInboxAvatarBuffer(chatId, buf, ext);
                        if (file) urlOk += 1;
                    }
                }
            }
        } catch {
            /* tenta fallback */
        }
        // 2) fallback via store (base64)
        if (!file) {
            const b64 = await profilePicBase64FromStore(client, chatId);
            if (b64) {
                file = saveInboxAvatarBuffer(chatId, Buffer.from(b64, 'base64'), 'jpg');
                if (file) storeOk += 1;
            }
        }
        if (file) saved += 1;
        // Grava (mesmo null) para atualizar avatarUpdatedAt e evitar re-tentar sempre
        chatDB.setInboxConversationAvatar(chatId, file);
    }
    logger.info(`Inbox: avatares — ${saved} salvos (url ${urlOk}, store ${storeOk}) de ${pending.length}`);
}

export default { persistInboxMessage, syncRecentInbox, refreshInboxAvatars, backfillLidPhones, backfillContactNames };
