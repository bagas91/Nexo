/**
 * Importa fotos do WooCommerce → Bling em lote (SKU pareado).
 * Só produtos sem foto no Bling e com foto no Woo (photos_asymmetric).
 */

import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import { setBlingProductExternalImages } from './blingService.js';
import { mapBlingProductToRow } from './catalogSyncService.js';
import { computePairDiffs, normSku, isSellableUnit } from './catalogAuditEngine.js';
import { logAudit } from '../utils/auditService.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @type {null | {
 *   id: string,
 *   status: 'running'|'done'|'failed'|'cancelled',
 *   startedAt: number,
 *   finishedAt?: number,
 *   total: number,
 *   done: number,
 *   ok: number,
 *   failed: number,
 *   skipped: number,
 *   currentSku?: string,
 *   message?: string,
 *   errors: Array<{ sku: string, blingId: string, error: string }>,
 *   limit?: number,
 * }} */
let job = null;
let cancelRequested = false;

function extractWooImageUrls(wooProduct) {
    let raw = wooProduct?.rawJson;
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            raw = null;
        }
    }
    const images = Array.isArray(raw?.images) ? raw.images : [];
    const urls = images
        .map((img) => String(img?.src || img?.source_url || '').trim())
        .filter((u) => /^https?:\/\//i.test(u));
    return [...new Set(urls)];
}

/** Lista candidatos (Bling sem foto + Woo com foto), ordenados por SKU. */
export function listPhotoImportCandidates({ limit = 5000 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 5000, 1), 10000);
    const blingAll = chatDB.listCatalogProducts('bling');
    const wooAll = chatDB.listCatalogProducts('woo');

    const wooBySku = new Map();
    for (const p of wooAll) {
        const s = normSku(p.sku);
        if (s && !wooBySku.has(s)) wooBySku.set(s, p);
    }

    const candidates = [];
    for (const b of blingAll) {
        if (!isSellableUnit(b)) continue;
        const s = normSku(b.sku);
        if (!s) continue;
        const w = wooBySku.get(s);
        if (!w) continue;
        const diffs = computePairDiffs(b, w);
        if (!diffs.includes('photos_asymmetric')) continue;
        const urls = extractWooImageUrls(w);
        if (!urls.length) continue;
        candidates.push({
            sku: b.sku,
            blingId: String(b.externalId),
            wooId: String(w.externalId),
            name: b.name || w.name || '',
            wooImageCount: urls.length,
            urls,
        });
    }

    candidates.sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
    return {
        candidates: candidates.slice(0, lim),
        total: candidates.length,
        truncated: candidates.length > lim,
    };
}

export function getPhotoImportJob() {
    return job ? { ...job, errors: (job.errors || []).slice(-50) } : null;
}

export function cancelPhotoImportJob() {
    if (!job || job.status !== 'running') {
        return { ok: false, message: 'Nenhum import em andamento.' };
    }
    cancelRequested = true;
    job.message = 'Cancelamento solicitado…';
    return { ok: true };
}

/**
 * Inicia importação em background.
 * @param {{ limit?: number, delayMs?: number, dryRun?: boolean, actor?: object }} opts
 */
export function startPhotoImportJob(opts = {}) {
    if (job?.status === 'running') {
        return { alreadyRunning: true, job: getPhotoImportJob() };
    }

    const limit = Math.min(Math.max(Number(opts.limit) || 5000, 1), 10000);
    // Extra delay between SKUs — cada PATCH já espera ~2.5s no Bling para o download S3.
    const delayMs = Math.min(Math.max(Number(opts.delayMs) || 800, 200), 5000);
    const dryRun = opts.dryRun === true;
    const { candidates, total } = listPhotoImportCandidates({ limit });

    const id = `photo_import_${Date.now()}`;
    cancelRequested = false;
    job = {
        id,
        status: 'running',
        startedAt: Date.now(),
        total: candidates.length,
        candidatesTotal: total,
        done: 0,
        ok: 0,
        failed: 0,
        skipped: 0,
        dryRun,
        message: dryRun ? 'Simulação…' : 'Importando fotos Woo → Bling…',
        errors: [],
        limit,
    };

    (async () => {
        try {
            for (const item of candidates) {
                if (cancelRequested) {
                    job.status = 'cancelled';
                    job.message = `Cancelado após ${job.done}/${job.total}.`;
                    job.finishedAt = Date.now();
                    break;
                }

                job.currentSku = item.sku;
                job.message = `SKU ${item.sku} (${job.done + 1}/${job.total})…`;

                try {
                    if (dryRun) {
                        job.ok += 1;
                    } else {
                        const updated = await setBlingProductExternalImages(item.blingId, item.urls);
                        try {
                            const before = chatDB.getCatalogProduct('bling', item.blingId);
                            const row = mapBlingProductToRow(
                                {
                                    id: item.blingId,
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
                            logger.warn('Photo import: snapshot local falhou', item.sku, snapErr?.message || snapErr);
                        }
                        job.ok += 1;
                    }
                } catch (err) {
                    job.failed += 1;
                    job.errors.push({
                        sku: item.sku,
                        blingId: item.blingId,
                        error: err?.message || String(err),
                    });
                    logger.warn('Photo import falhou', item.sku, err?.message || err);
                }

                job.done += 1;
                if (delayMs > 0 && job.done < job.total) await sleep(delayMs);
            }

            if (job.status === 'running') {
                job.status = 'done';
                job.finishedAt = Date.now();
                job.message = dryRun
                    ? `Simulação: ${job.ok} produto(s) seriam atualizados.`
                    : `Concluído: ${job.ok} ok · ${job.failed} falha(s) de ${job.total}.`;
                job.currentSku = undefined;

                logAudit({
                    actor: opts.actor,
                    action: 'catalog_photo_import',
                    targetType: 'catalog',
                    targetId: id,
                    summary: job.message,
                    meta: {
                        ok: job.ok,
                        failed: job.failed,
                        total: job.total,
                        dryRun,
                    },
                });
            }
        } catch (err) {
            logger.error('Photo import job crashed', err?.message || err);
            job.status = 'failed';
            job.finishedAt = Date.now();
            job.message = err?.message || String(err);
        } finally {
            cancelRequested = false;
        }
    })();

    return { alreadyRunning: false, job: getPhotoImportJob() };
}

export default {
    listPhotoImportCandidates,
    startPhotoImportJob,
    getPhotoImportJob,
    cancelPhotoImportJob,
};
