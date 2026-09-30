/**
 * Patch runtime do whatsapp-web.js: WA Web recente quebra envio de mídia se
 * mediaBlob/rgbaBuffer forem espalhados no modelo da mensagem (erro
 * "Data passed to getter must include an id property").
 *
 * Também cobre o rename _serialized → $1 no retorno do Msg.get.
 *
 * Chamado após o client ficar ready (reinjeta mesmo se o node_modules for
 * restaurado sem o patch em Utils.js).
 */

import logger from './logger.js';

export async function applyWwebjsMediaSanityPatch(pupPage) {
    if (!pupPage) return false;
    try {
        const ok = await pupPage.evaluate(() => {
            if (!window.WWebJS?.sendMessage) return false;
            if (window.WWebJS.__nexoMediaSanity) return true;

            const origSend = window.WWebJS.sendMessage.bind(window.WWebJS);
            window.WWebJS.sendMessage = async (chat, content, options = {}) => {
                const opts = { ...options };
                if (opts.media && typeof opts.media === 'object') {
                    // processMediaData ainda roda dentro do origSend; o sanitize
                    // principal está no Utils.js. Aqui garantimos linkPreview off.
                    if (opts.linkPreview == null) opts.linkPreview = undefined;
                }
                return origSend(chat, content, opts);
            };

            // Garante Msg.get com $1 se alguém reintroduzir _serialized-only
            const sid = (obj) => obj?._serialized || obj?.$1 || null;
            window.WWebJS.__nexoSid = sid;
            window.WWebJS.__nexoMediaSanity = true;
            return true;
        });
        if (ok) logger.info('WhatsApp: patch de mídia (mediaBlob/$1) ativo');
        return !!ok;
    } catch (err) {
        logger.warn('WhatsApp: falha ao aplicar patch de mídia', err?.message || err);
        return false;
    }
}

export default { applyWwebjsMediaSanityPatch };
