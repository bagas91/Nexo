/**
 * Normaliza áudio para OGG/Opus (formato de nota de voz do WhatsApp — melhor compat. iPhone).
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from './logger.js';

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

export function isAudioFile(file) {
    const type = String(file?.type || '');
    if (type.startsWith('audio/')) return true;
    const n = String(file?.name || '').toLowerCase();
    return /\.(mp3|ogg|opus|m4a|aac|wav|webm|mpeg|mp4)$/.test(n);
}

function stripAccentsAndSafe(name) {
    return String(name || 'audio')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 80) || 'audio';
}

export function toVoiceOggFilename(originalName) {
    const base = stripAccentsAndSafe(path.basename(originalName || 'audio', path.extname(originalName || '')));
    return `${base}.ogg`;
}

function extractBase64(file) {
    const raw = file.data || '';
    if (!raw) return null;
    return raw.includes(',') ? raw.split(',')[1] : raw;
}

function isAlreadyOggOpus(file) {
    const name = String(file.name || '').toLowerCase();
    const mime = String(file.type || '').toLowerCase();
    return name.endsWith('.ogg') || name.endsWith('.opus')
        || mime.includes('ogg') || mime.includes('opus');
}

/**
 * @returns {Promise<{ name: string, type: string, data: string }>}
 */
export async function normalizeAudioForWhatsApp(file) {
    const base64 = extractBase64(file);
    if (!base64) throw new Error('Áudio sem dados');

    const outName = toVoiceOggFilename(file.name);
    const outMime = 'audio/ogg; codecs=opus';

    if (isAlreadyOggOpus(file)) {
        return {
            name: outName,
            type: outMime,
            data: file.data.includes(',') ? file.data : `data:${outMime};base64,${base64}`
        };
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-audio-'));
    const inExt = path.extname(file.name || '') || '.bin';
    const inPath = path.join(tmpDir, `in${inExt}`);
    const outPath = path.join(tmpDir, 'out.ogg');

    try {
        fs.writeFileSync(inPath, Buffer.from(base64, 'base64'));
        await execFileAsync(FFMPEG_BIN, [
            '-y', '-i', inPath,
            '-c:a', 'libopus',
            '-b:a', '64k',
            '-ar', '48000',
            '-ac', '1',
            '-application', 'voip',
            outPath
        ], { timeout: 120000 });

        const outBuf = fs.readFileSync(outPath);
        if (!outBuf.length) throw new Error('Conversão gerou arquivo vazio');

        logger.info(`Áudio convertido para OGG/Opus: "${file.name}" → "${outName}" (${(outBuf.length / 1024).toFixed(0)} KB)`);

        return {
            name: outName,
            type: outMime,
            data: `data:${outMime};base64,${outBuf.toString('base64')}`
        };
    } catch (err) {
        logger.warn(`Áudio: conversão ffmpeg falhou para "${file.name}", enviando original: ${err.message}`);
        return {
            name: outName.replace(/\.ogg$/, path.extname(file.name || '.mp3') || '.mp3'),
            type: file.type || 'audio/mpeg',
            data: file.data.includes(',') ? file.data : `data:${file.type || 'audio/mpeg'};base64,${base64}`
        };
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
}
