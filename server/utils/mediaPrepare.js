/**
 * Prepara anexos uma vez por disparo (ffmpeg áudio → OGG/Opus).
 * Evita N conversões × N grupos competindo com Puppeteer.
 */

import logger from './logger.js';
import { isAudioFile, normalizeAudioForWhatsApp } from './audioNormalize.js';

/**
 * @param {Array<{ name?: string, type?: string, data?: string }>} attachments
 * @returns {Promise<Array<{ name?: string, type?: string, data?: string }>>}
 */
export async function prepareAttachmentsForWhatsApp(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return attachments || [];

    const out = [];
    for (const file of attachments) {
        if (!file) continue;
        if (isAudioFile(file)) {
            try {
                out.push(await normalizeAudioForWhatsApp(file));
            } catch (err) {
                logger.warn(
                    `mediaPrepare: falha ao normalizar áudio "${file.name || '?'}", mantendo original: ${err?.message || err}`,
                );
                out.push(file);
            }
        } else {
            out.push(file);
        }
    }
    return out;
}

export default { prepareAttachmentsForWhatsApp };
