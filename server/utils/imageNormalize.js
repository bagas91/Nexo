/**
 * Normaliza imagens para JPEG (max ~1920px) — WA Web às vezes falha no prepRawMedia
 * de PNG/WebP com "memoize / id property undefined" (filehash vazio).
 */

import path from 'path';
import sharp from 'sharp';
import logger from './logger.js';

const MAX_PX = Number(process.env.WA_IMAGE_MAX_PX) || 1920;
const JPEG_QUALITY = Number(process.env.WA_IMAGE_JPEG_QUALITY) || 85;

export function isImageFile(file) {
    const type = String(file?.type || '').toLowerCase();
    if (type.startsWith('image/')) return true;
    const n = String(file?.name || '').toLowerCase();
    return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(n);
}

function extractBase64(file) {
    const raw = file?.data || '';
    if (!raw) return null;
    return raw.includes(',') ? raw.split(',')[1] : raw;
}

function safeBaseName(name) {
    const base = path.basename(String(name || 'imagem'), path.extname(name || ''));
    return (
        String(base || 'imagem')
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .replace(/[/\\?%*:|"<>]/g, '_')
            .replace(/\s+/g, '_')
            .slice(0, 80) || 'imagem'
    );
}

/**
 * @param {{ name?: string, type?: string, data?: string }} file
 * @returns {Promise<{ name: string, type: string, data: string }>}
 */
export async function normalizeImageForWhatsApp(file) {
    const base64 = extractBase64(file);
    if (!base64) throw new Error('Imagem sem dados');

    const input = Buffer.from(base64, 'base64');
    if (!input.length) throw new Error('Imagem base64 inválida');

    const outName = `${safeBaseName(file.name)}.jpg`;
    const outMime = 'image/jpeg';

    // Já é JPEG pequeno e sem transparência — ainda reencoda para garantir filehash estável.
    const jpeg = await sharp(input, { failOn: 'none' })
        .rotate()
        .resize({
            width: MAX_PX,
            height: MAX_PX,
            fit: 'inside',
            withoutEnlargement: true,
        })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer();

    logger.info(
        `imageNormalize: "${file.name || '?'}" → ${outName} (${input.length}→${jpeg.length} bytes)`,
    );

    return {
        name: outName,
        type: outMime,
        data: jpeg.toString('base64'),
    };
}

export default { isImageFile, normalizeImageForWhatsApp };
