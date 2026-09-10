/**
 * Varredura de imagens pesadas (Bling/Woo) + otimização WebP ≤1000px → Bling.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import {
    replaceBlingProductImages,
    fetchBlingProduct,
    ensureValidBlingToken,
} from './blingService.js';
import { mapBlingProductToRow } from './catalogSyncService.js';
import { isSellableUnit } from './catalogAuditEngine.js';
import { logAudit } from '../utils/auditService.js';
import { BRANDING } from '../utils/branding.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const OPTIMIZED_DIR = path.join(__dirname, '../data/catalog-optimized');

const DEFAULT_MIN_PX = 2000;
const DEFAULT_MIN_BYTES = Math.round(1.5 * 1024 * 1024);
const TARGET_MAX_PX = 1000;
const WEBP_QUALITY = 80;
const FETCH_TIMEOUT_MS = 25000;
const SCAN_DELAY_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OPTIMIZED_DIR, { recursive: true });

/** @type {null | object} */
let job = null;
/** @type {Array<object>} */
let lastCandidates = [];
let cancelRequested = false;

function publicBaseUrl() {
    return String(
        process.env.BRAND_VPS_URL
        || process.env.PUBLIC_URL
        || BRANDING.vpsUrl
        || 'https://cristian.vps-kinghost.net',
    ).replace(/\/$/, '');
}

function parseRaw(product) {
    let raw = product?.rawJson;
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            raw = null;
        }
    }
    return raw;
}

function urlFromImageEntry(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry.trim();
    return String(entry.link || entry.url || entry.src || entry.imagemURL || '').trim();
}

/** Extrai URLs de imagem do snapshot Bling (detail preferido). */
export function extractBlingImageUrls(product) {
    const raw = parseRaw(product);
    const src = raw?.detail || raw?.list || raw || {};
    const midia = src.midia || {};
    const imagens = midia.imagens || src.imagens || {};
    const buckets = [
        ...(Array.isArray(imagens.internas) ? imagens.internas : []),
        ...(Array.isArray(imagens.externas) ? imagens.externas : []),
        ...(Array.isArray(imagens.imagensURL) ? imagens.imagensURL : []),
    ];
    const urls = buckets.map(urlFromImageEntry).filter((u) => /^https?:\/\//i.test(u));
    const single = urlFromImageEntry(src.imagemURL || midia.imagemURL);
    if (/^https?:\/\//i.test(single)) urls.push(single);
    return [...new Set(urls)];
}

export function extractWooImageUrls(product) {
    const raw = parseRaw(product) || product?.rawJson || {};
    const images = Array.isArray(raw?.images) ? raw.images : [];
    return [...new Set(
        images
            .map((img) => String(img?.src || img?.source_url || '').trim())
            .filter((u) => /^https?:\/\//i.test(u)),
    )];
}

async function fetchImageBuffer(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { 'User-Agent': 'NexoCatalogImageOptimize/1.0' },
            redirect: 'follow',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab = await res.arrayBuffer();
        const buf = Buffer.from(ab);
        const headerLen = Number(res.headers.get('content-length') || 0) || null;
        return { buffer: buf, bytes: buf.length, headerBytes: headerLen };
    } finally {
        clearTimeout(t);
    }
}

async function probeImage(url, { minPx, minBytes }) {
    try {
        const { buffer, bytes } = await fetchImageBuffer(url);
        let width = 0;
        let height = 0;
        try {
            const meta = await sharp(buffer, { failOn: 'none' }).rotate().metadata();
            width = Number(meta.width) || 0;
            height = Number(meta.height) || 0;
        } catch (err) {
            return {
                url,
                width: 0,
                height: 0,
                bytes,
                flagged: bytes >= minBytes,
                error: err?.message || 'metadata falhou',
            };
        }
        const maxEdge = Math.max(width, height);
        const flagged = maxEdge >= minPx || bytes >= minBytes;
        return { url, width, height, bytes, flagged, error: null };
    } catch (err) {
        return {
            url,
            width: 0,
            height: 0,
            bytes: 0,
            flagged: false,
            error: err?.message || String(err),
        };
    }
}

/** ≥3 fotos no Bling costuma ser lixo de rodadas antigas (pesada + cópias leves). */
const DUP_IMAGE_COUNT_MIN = 3;

function summarizeImages(images) {
    const flagged = images.filter((i) => i.flagged);
    let worst = null;
    for (const img of flagged.length ? flagged : images) {
        const edge = Math.max(img.width || 0, img.height || 0);
        const score = edge * 1000 + (img.bytes || 0);
        if (!worst || score > worst.score) {
            worst = { ...img, score };
        }
    }
    const imageCount = images.length;
    const likelyDuplicates = imageCount >= DUP_IMAGE_COUNT_MIN;
    return {
        flaggedCount: flagged.length,
        imageCount,
        likelyDuplicates,
        maxWidth: worst?.width || 0,
        maxHeight: worst?.height || 0,
        maxBytes: Math.max(0, ...images.map((i) => i.bytes || 0)),
        worstUrl: worst?.url || images[0]?.url || null,
    };
}

function buildProductEntries() {
    const entries = [];
    for (const p of chatDB.listCatalogProducts('bling')) {
        if (!isSellableUnit(p)) continue;
        const urls = extractBlingImageUrls(p);
        if (!urls.length) continue;
        entries.push({
            source: 'bling',
            sku: p.sku,
            externalId: String(p.externalId),
            blingId: String(p.externalId),
            name: p.name || '',
            urls,
        });
    }
    for (const p of chatDB.listCatalogProducts('woo')) {
        const urls = extractWooImageUrls(p);
        if (!urls.length) continue;
        entries.push({
            source: 'woo',
            sku: p.sku,
            externalId: String(p.externalId),
            blingId: null,
            name: p.name || '',
            urls,
        });
    }
    return entries;
}

export function listImageOptimizeCandidates({ source = 'all', limit = 5000 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 5000, 1), 10000);
    let list = lastCandidates.slice();
    if (source === 'bling' || source === 'woo') {
        list = list.filter((c) => c.source === source);
    }
    return {
        candidates: list.slice(0, lim),
        total: list.length,
        truncated: list.length > lim,
        scannedAt: job?.finishedAt || job?.startedAt || null,
        minPx: job?.minPx ?? DEFAULT_MIN_PX,
        minBytes: job?.minBytes ?? DEFAULT_MIN_BYTES,
    };
}

export function getImageOptimizeJob() {
    if (!job) return null;
    return {
        ...job,
        errors: (job.errors || []).slice(-80),
        candidateCount: lastCandidates.length,
    };
}

export function cancelImageOptimizeJob() {
    if (!job || job.status !== 'running') {
        return { ok: false, message: 'Nenhum job em andamento.' };
    }
    cancelRequested = true;
    job.message = 'Cancelamento solicitado…';
    return { ok: true };
}

/**
 * Inicia varredura (baixa cada URL e mede px/bytes).
 */
export function startImageOptimizeScan(opts = {}) {
    if (job?.status === 'running') {
        return { alreadyRunning: true, job: getImageOptimizeJob() };
    }

    const minPx = Math.min(Math.max(Number(opts.minPx) || DEFAULT_MIN_PX, 800), 8000);
    const minBytes = Math.min(
        Math.max(Number(opts.minBytes) || DEFAULT_MIN_BYTES, 200 * 1024),
        50 * 1024 * 1024,
    );
    const sourceFilter = ['bling', 'woo', 'all'].includes(opts.source) ? opts.source : 'all';
    const limitProducts = Math.min(Math.max(Number(opts.limit) || 5000, 1), 10000);

    let entries = buildProductEntries();
    if (sourceFilter !== 'all') entries = entries.filter((e) => e.source === sourceFilter);
    entries = entries.slice(0, limitProducts);

    const id = `img_scan_${Date.now()}`;
    cancelRequested = false;
    lastCandidates = [];
    job = {
        id,
        kind: 'scan',
        status: 'running',
        startedAt: Date.now(),
        total: entries.length,
        done: 0,
        ok: 0,
        failed: 0,
        skipped: 0,
        flaggedProducts: 0,
        minPx,
        minBytes,
        source: sourceFilter,
        message: 'Varrendo imagens…',
        currentSku: undefined,
        errors: [],
    };

    (async () => {
        try {
            let token = null;
            if (sourceFilter === 'bling' || sourceFilter === 'all') {
                try {
                    token = await ensureValidBlingToken();
                } catch (err) {
                    logger.warn('Image scan: token Bling indisponível — usará URLs do snapshot', err?.message || err);
                }
            }

            const found = [];
            for (const entry of entries) {
                if (cancelRequested) {
                    job.status = 'cancelled';
                    job.message = `Cancelado após ${job.done}/${job.total}.`;
                    job.finishedAt = Date.now();
                    break;
                }
                job.currentSku = entry.sku;
                job.message = `${entry.source} ${entry.sku} (${job.done + 1}/${job.total})…`;

                let urls = entry.urls || [];
                // S3 do Bling assina URL com expiry — refresca pelo GET do produto
                if (entry.source === 'bling' && token && entry.blingId) {
                    try {
                        const fresh = await fetchBlingProduct(entry.blingId, token);
                        const fromApi = extractBlingImageUrls({ rawJson: { detail: fresh }, imageCount: 1 });
                        if (fromApi.length) urls = fromApi;
                        await sleep(200);
                    } catch (err) {
                        logger.warn('Image scan: refresh Bling falhou', entry.sku, err?.message || err);
                    }
                }

                const images = [];
                for (const url of urls) {
                    if (cancelRequested) break;
                    const probed = await probeImage(url, { minPx, minBytes });
                    images.push(probed);
                    await sleep(SCAN_DELAY_MS);
                }

                const summary = summarizeImages(images);
                // Inclui pesadas E galerias inchadas (duplicatas de otimizações antigas)
                if (summary.flaggedCount > 0 || summary.likelyDuplicates) {
                    const reasons = [];
                    if (summary.flaggedCount > 0) reasons.push('heavy');
                    if (summary.likelyDuplicates) reasons.push('duplicates');
                    found.push({
                        ...entry,
                        urls,
                        ...summary,
                        reasons,
                        images,
                        canOptimize: entry.source === 'bling',
                    });
                    job.flaggedProducts = found.length;
                }

                const probeFails = images.filter((i) => i.error).length;
                if (probeFails === images.length && images.length) {
                    job.failed += 1;
                    job.errors.push({
                        sku: entry.sku,
                        blingId: entry.blingId || entry.externalId,
                        error: images[0]?.error || 'Falha ao baixar imagens',
                    });
                } else {
                    job.ok += 1;
                }
                job.done += 1;
            }

            found.sort((a, b) => {
                const ha = (a.flaggedCount || 0) > 0 ? 1 : 0;
                const hb = (b.flaggedCount || 0) > 0 ? 1 : 0;
                if (hb !== ha) return hb - ha;
                if ((b.imageCount || 0) !== (a.imageCount || 0)) return (b.imageCount || 0) - (a.imageCount || 0);
                const ea = Math.max(a.maxWidth, a.maxHeight);
                const eb = Math.max(b.maxWidth, b.maxHeight);
                if (eb !== ea) return eb - ea;
                return (b.maxBytes || 0) - (a.maxBytes || 0);
            });
            lastCandidates = found;

            if (job.status === 'running') {
                job.status = 'done';
                job.finishedAt = Date.now();
                const heavyN = found.filter((f) => (f.flaggedCount || 0) > 0).length;
                const dupN = found.filter((f) => f.likelyDuplicates).length;
                job.message = `Varredura: ${found.length} produto(s) — ${heavyN} pesado(s) (≥${minPx}px/≥${(minBytes / 1024 / 1024).toFixed(1)}MB), ${dupN} com ≥${DUP_IMAGE_COUNT_MIN} fotos (possível duplicata).`;
                job.currentSku = undefined;
                logAudit({
                    actor: opts.actor,
                    action: 'catalog_image_scan',
                    targetType: 'catalog',
                    targetId: id,
                    summary: job.message,
                    meta: { flagged: found.length, total: job.total, minPx, minBytes },
                });
            }
        } catch (err) {
            logger.error('Image optimize scan crashed', err?.message || err);
            job.status = 'failed';
            job.finishedAt = Date.now();
            job.message = err?.message || String(err);
        } finally {
            cancelRequested = false;
        }
    })();

    return { alreadyRunning: false, job: getImageOptimizeJob() };
}

function safeOptimizedName(blingId, index) {
    const safeId = String(blingId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'prod';
    return `${safeId}_${index}.webp`;
}

export function getOptimizedImagePath(filename) {
    const base = path.basename(String(filename || ''));
    if (!base || base !== filename || !/^[a-zA-Z0-9_-]+\.webp$/.test(base)) return null;
    const full = path.join(OPTIMIZED_DIR, base);
    if (!full.startsWith(OPTIMIZED_DIR)) return null;
    if (!fs.existsSync(full)) return null;
    return full;
}

async function optimizeBufferToWebp(buffer) {
    return sharp(buffer, { failOn: 'none' })
        .rotate()
        .resize({
            width: TARGET_MAX_PX,
            height: TARGET_MAX_PX,
            fit: 'inside',
            withoutEnlargement: true,
        })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
}

/** Average-hash 16x16 — tolerante a re-encode WebP da mesma foto. */
async function averageHashBits(buffer) {
    const raw = await sharp(buffer, { failOn: 'none' })
        .rotate()
        .resize(16, 16, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer();
    let sum = 0;
    for (let i = 0; i < raw.length; i += 1) sum += raw[i];
    const avg = sum / raw.length;
    const bits = [];
    for (let i = 0; i < raw.length; i += 1) bits.push(raw[i] >= avg ? 1 : 0);
    return bits;
}

function hammingDistance(a, b) {
    if (!a || !b || a.length !== b.length) return 999;
    let d = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
    return d;
}

/** Distância <= 12 em 256 bits ≈ mesma foto com compressão diferente. */
const DUP_HAMMING_MAX = 12;

/**
 * Otimiza candidatos Bling (selecionados ou todos do último scan).
 * Se blingIds for passado, monta targets mesmo sem varredura prévia.
 */
export function startImageOptimizeJob(opts = {}) {
    if (job?.status === 'running') {
        return { alreadyRunning: true, job: getImageOptimizeJob() };
    }

    const dryRun = opts.dryRun === true;
    const delayMs = Math.min(Math.max(Number(opts.delayMs) || 600, 200), 5000);
    const idFilter = Array.isArray(opts.blingIds)
        ? opts.blingIds.map((id) => String(id)).filter(Boolean)
        : null;

    let targets = lastCandidates.filter((c) => c.source === 'bling' && c.canOptimize !== false);
    if (idFilter?.length) {
        const want = new Set(idFilter);
        targets = targets.filter((c) => want.has(String(c.blingId || c.externalId)));
        // Sem varredura / ID fora da lista: monta a partir do snapshot
        const have = new Set(targets.map((c) => String(c.blingId || c.externalId)));
        for (const bid of idFilter) {
            if (have.has(bid)) continue;
            const p = chatDB.getCatalogProduct('bling', bid);
            if (!p) continue;
            const urls = extractBlingImageUrls(p);
            targets.push({
                source: 'bling',
                sku: p.sku,
                externalId: String(p.externalId),
                blingId: String(p.externalId),
                name: p.name || '',
                urls,
                imageCount: urls.length,
                canOptimize: true,
            });
        }
    }
    if (!targets.length) {
        return {
            alreadyRunning: false,
            job: null,
            error: 'Nenhum candidato Bling. Rode a varredura primeiro (e selecione IDs se for o caso).',
        };
    }

    const id = `img_opt_${Date.now()}`;
    cancelRequested = false;
    job = {
        id,
        kind: 'optimize',
        status: 'running',
        startedAt: Date.now(),
        total: targets.length,
        done: 0,
        ok: 0,
        failed: 0,
        skipped: 0,
        dryRun,
        message: dryRun ? 'Simulação de otimização…' : 'Otimizando e enviando ao Bling…',
        currentSku: undefined,
        errors: [],
    };

    (async () => {
        try {
            const token = dryRun ? null : await ensureValidBlingToken();
            if (!dryRun && !token) {
                throw new Error('Token Bling inválido ou expirado. Autorize novamente em Integrações.');
            }

            for (const item of targets) {
                if (cancelRequested) {
                    job.status = 'cancelled';
                    job.message = `Cancelado após ${job.done}/${job.total}.`;
                    job.finishedAt = Date.now();
                    break;
                }

                const blingId = String(item.blingId || item.externalId);
                job.currentSku = item.sku;
                job.message = `SKU ${item.sku} (${job.done + 1}/${job.total})…`;

                try {
                    // URLs frescas do Bling (S3 assinado expira)
                    let urls = item.urls || [];
                    if (!dryRun) {
                        const freshProduct = await fetchBlingProduct(blingId, token);
                        const fromApi = extractBlingImageUrls({
                            rawJson: { detail: freshProduct },
                            imageCount: 1,
                        });
                        if (fromApi.length) urls = fromApi;
                    }
                    if (!urls.length) throw new Error('Produto sem URLs de imagem');

                    // Re-probe: se nada está pesado, não mexe (evita “otimizar de novo” / duplicar)
                    const probes = [];
                    for (const url of urls) {
                        probes.push(await probeImage(url, {
                            minPx: DEFAULT_MIN_PX,
                            minBytes: DEFAULT_MIN_BYTES,
                        }));
                        await sleep(80);
                    }
                    const okProbes = probes.filter((p) => !p.error);
                    const failProbes = probes.filter((p) => p.error);
                    if (!okProbes.length) {
                        throw new Error(
                            failProbes[0]?.error
                                ? `Falha ao re-baixar imagens: ${failProbes[0].error}`
                                : 'Falha ao re-baixar imagens para otimizar',
                        );
                    }
                    // Precisa otimizar se tem foto pesada OU muitas fotos (provável duplicata de rodadas antigas)
                    const anyHeavy = okProbes.some((p) => p.flagged);
                    const likelyDupes = urls.length >= DUP_IMAGE_COUNT_MIN;
                    if (!anyHeavy && !likelyDupes) {
                        job.skipped += 1;
                        job.message = `SKU ${item.sku}: já está leve — pulado.`;
                        logger.info('Image optimize: skip já otimizado', item.sku);
                        job.done += 1;
                        if (delayMs > 0 && job.done < job.total) await sleep(delayMs);
                        continue;
                    }
                    if (!anyHeavy && likelyDupes) {
                        job.message = `SKU ${item.sku}: limpando duplicatas (${urls.length} fotos)…`;
                        logger.info('Image optimize: cleanup duplicatas leves', item.sku, urls.length);
                    }

                    if (dryRun) {
                        job.ok += 1;
                    } else {
                        // Baixa → WebP ≤1000 → dedupe perceptual → APAGA antigas → grava só as novas
                        const kept = [];
                        const hashes = [];
                        for (let i = 0; i < urls.length; i += 1) {
                            const { buffer } = await fetchImageBuffer(urls[i]);
                            const out = await optimizeBufferToWebp(buffer);
                            const hash = await averageHashBits(out);
                            const isDup = hashes.some((h) => hammingDistance(h, hash) <= DUP_HAMMING_MAX);
                            if (isDup) {
                                logger.info('Image optimize: duplicata visual ignorada', item.sku, i);
                                continue;
                            }
                            hashes.push(hash);
                            kept.push(out);
                            await sleep(100);
                        }
                        if (!kept.length) throw new Error('Nenhuma imagem válida após deduplicar');

                        const publicUrls = [];
                        for (let i = 0; i < kept.length; i += 1) {
                            const filename = safeOptimizedName(blingId, i);
                            fs.writeFileSync(path.join(OPTIMIZED_DIR, filename), kept[i]);
                            publicUrls.push(`${publicBaseUrl()}/api/catalog/optimized-images/${filename}`);
                        }

                        job.message = `SKU ${item.sku}: limpando ${urls.length} → gravando ${publicUrls.length}…`;
                        const updated = await replaceBlingProductImages(blingId, publicUrls);

                        // Confirma que não ficou resto pesado/duplicado demais
                        const mid = updated?.midia?.imagens || {};
                        const finalN = (mid.internas?.length || 0) + (mid.externas?.length || 0);
                        if (finalN > publicUrls.length + 1) {
                            throw new Error(
                                `Após replace ainda há ${finalN} imagens (enviamos ${publicUrls.length}).`,
                            );
                        }

                        try {
                            const before = chatDB.getCatalogProduct('bling', blingId);
                            const row = mapBlingProductToRow(
                                {
                                    id: blingId,
                                    codigo: updated?.codigo ?? before?.sku ?? item.sku,
                                    nome: updated?.nome ?? before?.name ?? item.name,
                                    preco: updated?.preco ?? before?.price,
                                    situacao: updated?.situacao || before?.status,
                                },
                                updated || before,
                            );
                            if (before?.reviewStatus) row.reviewStatus = before.reviewStatus;
                            chatDB.upsertCatalogProduct(row);
                        } catch (snapErr) {
                            logger.warn('Image optimize: snapshot local falhou', item.sku, snapErr?.message || snapErr);
                        }
                        job.ok += 1;
                    }
                } catch (err) {
                    job.failed += 1;
                    job.errors.push({
                        sku: item.sku,
                        blingId,
                        error: err?.message || String(err),
                    });
                    logger.warn('Image optimize falhou', item.sku, err?.message || err);
                }

                job.done += 1;
                if (delayMs > 0 && job.done < job.total) await sleep(delayMs);
            }

            if (job.status === 'running') {
                job.status = 'done';
                job.finishedAt = Date.now();
                job.message = dryRun
                    ? `Simulação: ${job.ok} seriam otimizados · ${job.skipped} já leves.`
                    : `Otimização: ${job.ok} ok · ${job.skipped} pulado(s) · ${job.failed} falha(s) de ${job.total}.`;
                job.currentSku = undefined;
                logAudit({
                    actor: opts.actor,
                    action: 'catalog_image_optimize',
                    targetType: 'catalog',
                    targetId: id,
                    summary: job.message,
                    meta: { ok: job.ok, failed: job.failed, total: job.total, dryRun },
                });
            }
        } catch (err) {
            logger.error('Image optimize job crashed', err?.message || err);
            job.status = 'failed';
            job.finishedAt = Date.now();
            job.message = err?.message || String(err);
        } finally {
            cancelRequested = false;
        }
    })();

    return { alreadyRunning: false, job: getImageOptimizeJob() };
}

export default {
    listImageOptimizeCandidates,
    startImageOptimizeScan,
    startImageOptimizeJob,
    getImageOptimizeJob,
    cancelImageOptimizeJob,
    getOptimizedImagePath,
    extractBlingImageUrls,
    OPTIMIZED_DIR,
};
