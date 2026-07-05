/**
 * Geração de imagens via Gemini Imagen (chave só no servidor).
 *
 * Env:
 *   GEMINI_API_KEY=
 *   AI_IMAGEN_MODEL=imagen-3.0-generate-002
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(__dirname, '..', 'uploads', 'content');
const IMAGEN_MODEL = process.env.AI_IMAGEN_MODEL || 'imagen-3.0-generate-002';

function ensureContentDir() {
    if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });
}

export async function generateImage({ prompt, aspectRatio = '1:1' }) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key === 'PLACEHOLDER_API_KEY') {
        throw new Error('GEMINI_API_KEY não configurada no servidor.');
    }
    const text = String(prompt || '').trim();
    if (!text) throw new Error('Descreva a imagem que deseja gerar.');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            instances: [{ prompt: text }],
            parameters: {
                sampleCount: 1,
                aspectRatio
            }
        })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data?.error?.message || res.statusText;
        throw new Error(`Imagen: ${msg}`);
    }

    const b64 = data?.predictions?.[0]?.bytesBase64Encoded
        || data?.generatedImages?.[0]?.image?.imageBytes
        || data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;

    if (!b64) {
        logger.warn('Imagen resposta inesperada:', JSON.stringify(data).slice(0, 500));
        throw new Error('Gemini não retornou imagem. Tente outro prompt ou verifique o modelo.');
    }

    ensureContentDir();
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const filePath = path.join(CONTENT_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));

    return {
        filename,
        relativePath: `content/${filename}`,
        url: `/api/studio/files/${filename}`
    };
}

export function getContentFilePath(filename) {
    const safe = path.basename(String(filename || ''));
    return path.join(CONTENT_DIR, safe);
}

export default { generateImage, getContentFilePath };
