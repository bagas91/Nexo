/**
 * Garante patches do whatsapp-web.js (Utils.js) em disco.
 * Idempotente — seguro chamar a cada boot.
 *
 * 1) Sanitize mediaBlob/rgbaBuffer (memoize/getSender)
 * 2) Msg.get com fallback $1
 * 3) Canal: mediaMetadata via WAWebMediaMetadata (avParams removido)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UTILS = path.join(
    __dirname,
    '..',
    'node_modules',
    'whatsapp-web.js',
    'src',
    'util',
    'Injected',
    'Utils.js',
);

const MARKER_SANITIZE = '__nexoSanitizeMediaOptions';
const MARKER_AVPARAMS = '__nexoAvParamsFix';

const SANITIZE_BLOCK = `
            mediaOptions.isViewOnce = options.isViewOnce;
            delete options.media;
            delete options.sendMediaAsSticker;
            // ${MARKER_SANITIZE}
            try {
                if (typeof mediaOptions.toJSON === 'function') {
                    const clean = mediaOptions.toJSON();
                    delete clean.mediaBlob;
                    delete clean.rgbaBuffer;
                    delete clean.renderableUrl;
                    if (typeof clean.preview !== 'string') delete clean.preview;
                    mediaOptions = clean;
                } else {
                    delete mediaOptions.mediaBlob;
                    delete mediaOptions.rgbaBuffer;
                    delete mediaOptions.renderableUrl;
                }
            } catch (_e) {
                delete mediaOptions.mediaBlob;
                delete mediaOptions.rgbaBuffer;
                delete mediaOptions.renderableUrl;
            }
        }
`;

function patchSanitize(src) {
    if (src.includes(MARKER_SANITIZE)) return src;
    const needle = `            mediaOptions.isViewOnce = options.isViewOnce;
            delete options.media;
            delete options.sendMediaAsSticker;
        }`;
    if (!src.includes(needle)) {
        logger.warn('wwebjs patch: bloco sanitize não encontrado');
        return src;
    }
    let out = src.replace(needle, SANITIZE_BLOCK.trimEnd() + '\n');
    out = out.replace(
        `...mediaOptions,
            ...(mediaOptions.toJSON ? mediaOptions.toJSON() : {}),`,
        `...mediaOptions,`,
    );
    return out;
}

function patchMsgKeySerialized(src) {
    if (src.includes('sentFromPromise')) return src;
    const old = `        const [msgPromise, sendMsgResultPromise] = window
            .require('WAWebSendMsgChatAction')
            .addAndSendMsgToChat(chat, message);
        await msgPromise;

        if (options.waitUntilMsgSent) await sendMsgResultPromise;

        return window
            .require('WAWebCollections')
            .Msg.get(newMsgKey._serialized);
    };`;
    const neu = `        const [msgPromise, sendMsgResultPromise] = window
            .require('WAWebSendMsgChatAction')
            .addAndSendMsgToChat(chat, message);
        const sentFromPromise = await msgPromise;

        if (options.waitUntilMsgSent) await sendMsgResultPromise;

        const msgKey =
            newMsgKey?._serialized ||
            newMsgKey?.$1 ||
            (typeof newMsgKey?.toString === 'function' ? newMsgKey.toString() : null);
        if (!msgKey) {
            return sentFromPromise || null;
        }
        try {
            return (
                window.require('WAWebCollections').Msg.get(msgKey) ||
                sentFromPromise ||
                null
            );
        } catch (_err) {
            return sentFromPromise || null;
        }
    };`;
    if (!src.includes(old)) return src;
    return src.replace(old, neu);
}

function patchAvParams(src) {
    if (src.includes(MARKER_AVPARAMS) || src.includes("require('WAWebMediaMetadata')")) {
        // Garante marker mesmo se já estiver patched à mão
        if (!src.includes(MARKER_AVPARAMS) && src.includes("require('WAWebMediaMetadata')")) {
            return src.replace(
                "require('WAWebMediaMetadata')",
                `require('WAWebMediaMetadata') /* ${MARKER_AVPARAMS} */`,
            );
        }
        return src;
    }
    const old = `                              mediaMetadata: msg.avParams(),`;
    const neu = `                              // ${MARKER_AVPARAMS}
                              mediaMetadata: window
                                  .require('WAWebMediaMetadata')
                                  .mediaMetadata(msg),`;
    if (!src.includes(old)) {
        logger.warn('wwebjs patch: msg.avParams() não encontrado (já patched?)');
        return src;
    }
    return src.replace(old, neu);
}

export function ensureWwebjsUtilsMediaPatch() {
    try {
        if (!fs.existsSync(UTILS)) {
            logger.warn('wwebjs patch: Utils.js não encontrado', UTILS);
            return false;
        }
        const before = fs.readFileSync(UTILS, 'utf8');
        let src = before;
        src = patchSanitize(src);
        src = patchMsgKeySerialized(src);
        src = patchAvParams(src);
        if (src === before) return true;
        fs.writeFileSync(UTILS, src);
        logger.info('wwebjs patch: Utils.js atualizado (sanitize + $1 + avParams/canal)');
        return true;
    } catch (err) {
        logger.warn('wwebjs patch: falha', err?.message || err);
        return false;
    }
}

export default { ensureWwebjsUtilsMediaPatch };
