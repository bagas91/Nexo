/**
 * Armazenamento de mídia e avatares do Inbox (WhatsApp).
 * Arquivos ficam em server/uploads/inbox_media e server/uploads/inbox_avatars,
 * servidos via /api/inbox/media/:file e /api/inbox/avatars/:file.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(__dirname, '..', 'uploads', 'inbox_media');
const AVATAR_DIR = path.join(__dirname, '..', 'uploads', 'inbox_avatars');

function ensureDirs() {
    if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
    if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

function sanitizeName(name) {
    return String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
}

/** image/png -> png ; audio/ogg; codecs=opus -> ogg */
function extFromMime(mimetype, fallback = 'bin') {
    const m = String(mimetype || '').split(';')[0].trim().toLowerCase();
    const map = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'audio/ogg': 'ogg',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/aac': 'aac',
        'audio/wav': 'wav',
        'video/mp4': 'mp4',
        'video/3gpp': '3gp',
        'video/quicktime': 'mov',
        'application/pdf': 'pdf',
    };
    if (map[m]) return map[m];
    const slash = m.split('/')[1];
    return slash ? slash.replace(/[^a-z0-9]/g, '') || fallback : fallback;
}

/** Categoria de exibição no frontend a partir do type/mime do WhatsApp. */
export function mediaCategory(type, mimetype) {
    const t = String(type || '').toLowerCase();
    const m = String(mimetype || '').toLowerCase();
    if (t === 'ptt' || t === 'audio' || m.startsWith('audio/')) return 'audio';
    if (t === 'image' || t === 'sticker' || m.startsWith('image/')) return 'image';
    if (t === 'video' || m.startsWith('video/')) return 'video';
    if (t === 'document' || m) return 'document';
    return 'document';
}

/**
 * Salva base64 de mídia num arquivo e devolve { mediaFile, mediaType, mimetype }.
 * @param {string} messageId
 * @param {string} type tipo do WhatsApp (ptt, image, video, document…)
 * @param {string} mimetype
 * @param {string} base64 dados (sem data: prefix)
 * @param {string} [filename] nome original (documentos)
 */
export function saveInboxMediaBase64(messageId, type, mimetype, base64, filename) {
    try {
        if (!base64) return null;
        ensureDirs();
        const category = mediaCategory(type, mimetype);
        const ext = category === 'document' && filename && filename.includes('.')
            ? sanitizeName(filename.split('.').pop())
            : extFromMime(mimetype, category === 'audio' ? 'ogg' : 'bin');
        const safeId = sanitizeName(messageId);
        const file = `${safeId}.${ext}`;
        const full = path.join(MEDIA_DIR, file);
        fs.writeFileSync(full, Buffer.from(base64, 'base64'));
        return { mediaFile: file, mediaType: category, mimetype: mimetype || null };
    } catch (err) {
        logger.warn('Inbox: falha ao salvar mídia', err?.message || String(err));
        return null;
    }
}

export function getInboxMediaFilePath(filename) {
    const safe = sanitizeName(filename);
    const full = path.join(MEDIA_DIR, safe);
    if (!full.startsWith(MEDIA_DIR)) return null;
    return full;
}

/** Salva avatar (Buffer) e devolve o filename. */
export function saveInboxAvatarBuffer(chatId, buffer, ext = 'jpg') {
    try {
        if (!buffer || !buffer.length) return null;
        ensureDirs();
        const file = `${sanitizeName(chatId)}.${sanitizeName(ext)}`;
        fs.writeFileSync(path.join(AVATAR_DIR, file), buffer);
        return file;
    } catch (err) {
        logger.warn('Inbox: falha ao salvar avatar', err?.message || String(err));
        return null;
    }
}

export function getInboxAvatarFilePath(filename) {
    const safe = sanitizeName(filename);
    const full = path.join(AVATAR_DIR, safe);
    if (!full.startsWith(AVATAR_DIR)) return null;
    return full;
}

export default {
    mediaCategory,
    saveInboxMediaBase64,
    getInboxMediaFilePath,
    saveInboxAvatarBuffer,
    getInboxAvatarFilePath,
};
