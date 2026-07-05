/**
 * Formatos de disparo: imagem + texto + áudio no WhatsApp.
 */

export const MEDIA_LAYOUTS = {
    CAPTION_ON_IMAGE: 'caption_on_image',
    TEXT_SEPARATE: 'text_separate',
    SHORT_CAPTION_PLUS_TEXT: 'short_caption_plus_text',
};

export const DEFAULT_MEDIA_LAYOUT = MEDIA_LAYOUTS.CAPTION_ON_IMAGE;

const VALID = new Set(Object.values(MEDIA_LAYOUTS));

export function normalizeMediaLayout(value) {
    const v = String(value || '').trim();
    return VALID.has(v) ? v : DEFAULT_MEDIA_LAYOUT;
}

export function isImageOrVideoFile(file) {
    const t = String(file?.type || '');
    const n = String(file?.name || '').toLowerCase();
    return t.startsWith('image/') || t.startsWith('video/')
        || /\.(jpe?g|png|gif|webp|bmp|heic|mp4|mov|webm)$/.test(n);
}

/** Primeiras 2 linhas (título + data) para Palavra do Dia; resto em mensagem separada. */
export function splitTextForShortCaption(text) {
    const raw = String(text || '');
    const lines = raw.split('\n');
    if (lines.length <= 2) {
        const trimmed = raw.trim();
        return { shortCaption: trimmed, remainder: '' };
    }
    const shortCaption = lines.slice(0, 2).join('\n').trim();
    const remainder = lines.slice(2).join('\n').trim();
    return { shortCaption, remainder };
}

export default {
    MEDIA_LAYOUTS,
    DEFAULT_MEDIA_LAYOUT,
    normalizeMediaLayout,
    isImageOrVideoFile,
    splitTextForShortCaption,
};
