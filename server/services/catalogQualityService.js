/**
 * Orquestra sync + auditoria do catálogo.
 */

import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import { syncBlingCatalog, syncWooCatalog, mapBlingProductToRow, loadBlingCategoryMap, resolveLocalCategoryNames, refreshBlingProductDetail } from './catalogSyncService.js';
import { runCatalogAudit, CATALOG_RULES, computePairDiffs, normSku, isSellableUnit, isInactive, isVariationParent } from './catalogAuditEngine.js';
import {
    patchBlingProduct,
    deleteBlingProduct,
    setBlingProductSituation,
    fetchBlingProductCategories,
    createBlingProductCategory,
} from './blingService.js';
import { logAudit } from '../utils/auditService.js';

let runningScanId = null;

export function getCatalogDashboard() {
    const blingCount = chatDB.countCatalogProducts('bling');
    const wooCount = chatDB.countCatalogProducts('woo');
    const reviewed = chatDB.countCatalogReviewed();
    const pendingDraftIds = new Set(chatDB.listPendingCatalogAiDraftExternalIds());
    const counts = {};
    let issueTotal = 0;
    // Contagens do painel: exclui produtos já na fila de aprovação (rascunho IA)
    const allIssues = chatDB.listCatalogIssues({ limit: 100000 })
        .filter((i) => !pendingDraftIds.has(String(i.externalId || '')));
    for (const iss of allIssues) {
        counts[iss.ruleId] = (counts[iss.ruleId] || 0) + 1;
        issueTotal += 1;
    }

    const productsWithIssues = new Set(
        allIssues.map((i) => `${i.channel}:${i.externalId}`)
    );
    const productsWithCritical = new Set(
        allIssues.filter((i) => i.priority === 'critical')
            .map((i) => `${i.channel}:${i.externalId}`)
    );
    const blingWithIssues = chatDB.listCatalogProducts('bling')
        .filter((p) => productsWithIssues.has(`bling:${p.externalId}`)).length;
    const blingWithCritical = chatDB.listCatalogProducts('bling')
        .filter((p) => productsWithCritical.has(`bling:${p.externalId}`)).length;

    const pending = Math.max(0, blingCount - reviewed);
    const progressPct = blingCount ? Math.round((reviewed / blingCount) * 100) : 0;
    const latest = chatDB.getLatestCatalogScan();
    const goiania = (() => {
        const rows = chatDB.countPhysicalChecksByStatus();
        const by = { pending: 0, answered: 0, applied: 0, cancelled: 0, returned: 0 };
        for (const r of rows) by[r.status] = r.count;
        const overdue = chatDB.countOverduePhysicalChecks();
        return {
            pending: by.pending || 0,
            answered: by.answered || 0,
            applied: by.applied || 0,
            returned: by.returned || 0,
            overdue,
            open: (by.pending || 0) + (by.answered || 0),
        };
    })();

    return {
        blingCount,
        wooCount,
        reviewed,
        pending,
        progressPct,
        /** Produtos com ≥1 problema crítico (SKU / peso inválido / preço). */
        productsWithErrors: blingWithCritical,
        /** Produtos com qualquer problema (inclui médio/baixo). */
        productsWithAnyIssue: blingWithIssues,
        issueTotal,
        goiania,
        indicators: {
            blingTotal: blingCount,
            wooTotal: wooCount,
            withErrors: blingWithCritical,
            withAnyIssue: blingWithIssues,
            reviewed,
            pending,
            goianiaPending: goiania.pending,
            goianiaAnswered: goiania.answered,
            goianiaOpen: goiania.open,
            goianiaOverdue: goiania.overdue,
            goianiaReturned: goiania.returned,
            skuMissing: counts.sku_missing || 0,
            skuDuplicate: counts.sku_duplicate || 0,
            weightInvalid: counts.weight_invalid || 0,
            weightMissing: counts.weight_missing || 0,
            orphanBling: counts.orphan_bling || 0,
            orphanWoo: counts.orphan_woo || 0,
            photosMissing: counts.photos_missing || 0,
            ncmMissing: counts.ncm_missing || 0,
            priceZero: counts.price_zero || 0,
            priceDivergent: counts.price_divergent || 0,
            stockDivergent: counts.stock_divergent || 0,
            photosAsymmetric: counts.photos_asymmetric || 0,
            photosDivergent: counts.photos_divergent || 0,
            weightDivergent: counts.weight_divergent || 0,
            dimensionsDivergent: counts.dimensions_divergent || 0,
            dimensionsMissing: counts.dimensions_missing || 0,
            categoryMissing: counts.category_missing || 0,
            brandMissing: counts.brand_missing || 0,
            descriptionMissing: counts.description_missing || 0,
            seoMissing: counts.seo_missing || 0,
            nameDivergent: counts.name_divergent || 0,
        },
        rules: CATALOG_RULES.map((r) => ({
            id: r.id,
            label: r.label,
            priority: r.priority,
            count: counts[r.id] || 0,
        })),
        latestScan: latest,
        scanRunning: Boolean(runningScanId),
        runningScanId,
    };
}

export async function startCatalogScan({ syncBling = true, syncWoo = false } = {}) {
    if (runningScanId) {
        const cur = chatDB.getCatalogScan(runningScanId);
        return { alreadyRunning: true, scan: cur };
    }

    // Woo: sync só se pedido (UI/env). Snapshot anterior NÃO é apagado ao pular ou falhar.
    const wooSyncEnabled = syncWoo === true || process.env.CATALOG_WOO_SYNC === '1';

    const scanId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    runningScanId = scanId;
    const startedAt = Date.now();

    chatDB.createCatalogScan({
        id: scanId,
        status: 'running',
        phase: 'start',
        message: 'Iniciando verificação…',
        startedAt,
    });

    (async () => {
        const bump = (patch) => {
            chatDB.updateCatalogScan(scanId, patch);
        };
        try {
            let blingCount = chatDB.countCatalogProducts('bling');

            if (syncBling) {
                bump({ phase: 'bling', message: 'Sincronizando Bling…' });
                blingCount = await syncBlingCatalog((p) => {
                    bump({ phase: p.phase, message: p.message, blingCount: p.count || 0 });
                });
            }

            let wooCount = chatDB.countCatalogProducts('woo');
            let wooSyncNote = '';
            if (wooSyncEnabled) {
                bump({ phase: 'woo', message: 'Sincronizando WooCommerce…', blingCount, wooCount });
                try {
                    wooCount = await syncWooCatalog((p) => {
                        bump({ phase: p.phase, message: p.message, wooCount: p.count || 0, blingCount });
                    });
                } catch (wooErr) {
                    logger.warn('Catalog: Woo sync falhou — mantendo snapshot anterior', wooErr?.message || wooErr);
                    wooCount = chatDB.countCatalogProducts('woo');
                    wooSyncNote = `Woo sync falhou (${wooErr?.message || wooErr}); usando snapshot anterior (${wooCount}).`;
                    bump({
                        message: wooSyncNote,
                        wooCount,
                        blingCount,
                    });
                }
            } else {
                bump({
                    phase: 'audit',
                    message: wooCount
                        ? `Woo sync desligado — usando snapshot anterior (${wooCount})…`
                        : 'Woo sync desligado — sem snapshot Woo…',
                    blingCount,
                    wooCount,
                });
            }

            bump({ phase: 'audit', message: 'Rodando regras de auditoria…', blingCount, wooCount });
            const result = runCatalogAudit(scanId);
            const finishedAt = Date.now();

            const doneMsg = (() => {
                if (wooSyncNote) return `Catálogo analisado. ${wooSyncNote}`;
                if (wooSyncEnabled) return 'Catálogo Bling + Woo analisado com sucesso.';
                if (result.wooCount > 0) return 'Catálogo Bling analisado (Woo: snapshot anterior).';
                return 'Catálogo Bling analisado (sem snapshot Woo).';
            })();

            bump({
                status: 'done',
                phase: 'done',
                message: doneMsg,
                blingCount: result.blingCount,
                wooCount: result.wooCount,
                issueCount: result.issueCount,
                okCount: result.withoutProblems,
                finishedAt,
                durationMs: finishedAt - startedAt,
                summary: {
                    analyzed: result.analyzed,
                    withProblems: result.withProblems,
                    withoutProblems: result.withoutProblems,
                    byRule: result.byRule,
                    rules: result.rules,
                    wooEnabled: result.wooEnabled,
                    wooSynced: wooSyncEnabled && !wooSyncNote,
                    wooSnapshot: result.wooCount,
                },
            });
            logger.info('Catalog scan concluído', {
                scanId,
                issues: result.issueCount,
                bling: result.blingCount,
                woo: result.wooCount,
            });
        } catch (err) {
            logger.error('Catalog scan falhou', err?.message || err);
            bump({
                status: 'failed',
                phase: 'error',
                message: err?.message || String(err),
                error: err?.message || String(err),
                finishedAt: Date.now(),
                durationMs: Date.now() - startedAt,
            });
        } finally {
            if (runningScanId === scanId) runningScanId = null;
        }
    })();

    return { alreadyRunning: false, scan: chatDB.getCatalogScan(scanId) };
}

/** Reaplica regras no snapshot local (sem sync) — assíncrono (pode levar minutos). */
export async function startCatalogReaudit() {
    if (runningScanId) {
        const cur = chatDB.getCatalogScan(runningScanId);
        return { alreadyRunning: true, scan: cur };
    }

    const scanId = `scan_${Date.now()}_reaudit`;
    runningScanId = scanId;
    const startedAt = Date.now();
    chatDB.createCatalogScan({
        id: scanId,
        status: 'running',
        phase: 'audit',
        message: 'Reaplicando regras no catálogo local…',
        startedAt,
        blingCount: chatDB.countCatalogProducts('bling'),
        wooCount: chatDB.countCatalogProducts('woo'),
    });

    (async () => {
        try {
            const wooCount = chatDB.countCatalogProducts('woo');
            chatDB.updateCatalogScan(scanId, {
                phase: 'audit',
                message: wooCount
                    ? `Rodando regras (Bling + snapshot Woo ${wooCount})…`
                    : 'Rodando regras de auditoria…',
                wooCount,
            });
            const result = runCatalogAudit(scanId);
            const finishedAt = Date.now();
            chatDB.updateCatalogScan(scanId, {
                status: 'done',
                phase: 'done',
                message: result.wooCount
                    ? 'Regras reaplicadas (Bling + Woo snapshot).'
                    : 'Regras reaplicadas (só Bling — sem snapshot Woo).',
                blingCount: result.blingCount,
                wooCount: result.wooCount,
                issueCount: result.issueCount,
                okCount: result.withoutProblems,
                finishedAt,
                durationMs: finishedAt - startedAt,
                summary: {
                    analyzed: result.analyzed,
                    withProblems: result.withProblems,
                    withoutProblems: result.withoutProblems,
                    byRule: result.byRule,
                    rules: result.rules,
                    wooEnabled: result.wooEnabled,
                },
            });
            logger.info('Catalog reaudit concluído', { scanId, issues: result.issueCount });
        } catch (err) {
            logger.error('Catalog reaudit falhou', err?.message || err);
            chatDB.updateCatalogScan(scanId, {
                status: 'failed',
                phase: 'error',
                message: err?.message || String(err),
                error: err?.message || String(err),
                finishedAt: Date.now(),
                durationMs: Date.now() - startedAt,
            });
        } finally {
            if (runningScanId === scanId) runningScanId = null;
        }
    })();

    return { alreadyRunning: false, scan: chatDB.getCatalogScan(scanId) };
}

/**
 * Atualiza nomes de categoria no snapshot, busca o cadastro atual dos que ainda
 * estão em “Categoria padrão”, e reaplica as regras — sem apagar o snapshot Woo.
 */
export async function startCategoryResolveJob() {
    if (runningScanId) {
        const cur = chatDB.getCatalogScan(runningScanId);
        return { alreadyRunning: true, scan: cur };
    }

    const scanId = `scan_${Date.now()}_cats`;
    runningScanId = scanId;
    const startedAt = Date.now();
    chatDB.createCatalogScan({
        id: scanId,
        status: 'running',
        phase: 'bling_categories',
        message: 'Atualizando categorias do Bling…',
        startedAt,
        blingCount: chatDB.countCatalogProducts('bling'),
        wooCount: chatDB.countCatalogProducts('woo'),
    });

    (async () => {
        try {
            const bump = (patch) => chatDB.updateCatalogScan(scanId, patch);
            const resolved = await resolveLocalCategoryNames({
                refreshStaleDetails: true,
                onProgress: (p) => bump({
                    phase: p.phase,
                    message: p.message,
                    blingCount: p.count || chatDB.countCatalogProducts('bling'),
                }),
            });
            bump({
                phase: 'audit',
                message: `Categorias: ${resolved.refreshed || 0} cadastro(s) atualizado(s), ${resolved.updated || 0} nome(s). Rodando regras…`,
            });
            const result = runCatalogAudit(scanId);
            const finishedAt = Date.now();
            bump({
                status: 'done',
                phase: 'done',
                message: `Categorias atualizadas — ${resolved.refreshed || 0} cadastro(s) do Bling · ${result.issueCount} problemas.`,
                blingCount: result.blingCount,
                wooCount: result.wooCount,
                issueCount: result.issueCount,
                okCount: result.withoutProblems,
                finishedAt,
                durationMs: finishedAt - startedAt,
                summary: {
                    analyzed: result.analyzed,
                    withProblems: result.withProblems,
                    withoutProblems: result.withoutProblems,
                    byRule: result.byRule,
                    rules: result.rules,
                    wooEnabled: result.wooEnabled,
                    categories: resolved.categories,
                    refreshed: resolved.refreshed,
                    updated: resolved.updated,
                },
            });
            logger.info('Catalog categorias resolvidas', {
                scanId,
                refreshed: resolved.refreshed,
                updated: resolved.updated,
                issues: result.issueCount,
            });
        } catch (err) {
            logger.error('Catalog resolve categorias falhou', err?.message || err);
            chatDB.updateCatalogScan(scanId, {
                status: 'failed',
                phase: 'error',
                message: err?.message || String(err),
                error: err?.message || String(err),
                finishedAt: Date.now(),
                durationMs: Date.now() - startedAt,
            });
        } finally {
            if (runningScanId === scanId) runningScanId = null;
        }
    })();

    return { alreadyRunning: false, scan: chatDB.getCatalogScan(scanId) };
}

/** Sync: reauditoria imediata (uso interno / CLI). */
export function reauditLocalCatalog() {
    const scanId = `scan_${Date.now()}_reaudit`;
    const startedAt = Date.now();
    chatDB.createCatalogScan({
        id: scanId,
        status: 'running',
        phase: 'audit',
        message: 'Reaplicando regras no catálogo local…',
        startedAt,
        blingCount: chatDB.countCatalogProducts('bling'),
        wooCount: 0,
    });
    chatDB.clearCatalogChannel('woo');
    const result = runCatalogAudit(scanId);
    const finishedAt = Date.now();
    return chatDB.updateCatalogScan(scanId, {
        status: 'done',
        phase: 'done',
        message: 'Regras reaplicadas (só Bling — Woo desativado).',
        blingCount: result.blingCount,
        wooCount: 0,
        issueCount: result.issueCount,
        okCount: result.withoutProblems,
        finishedAt,
        durationMs: finishedAt - startedAt,
        summary: {
            analyzed: result.analyzed,
            withProblems: result.withProblems,
            withoutProblems: result.withoutProblems,
            byRule: result.byRule,
            rules: result.rules,
            wooEnabled: false,
        },
    });
}

export function getCatalogScan(id) {
    return chatDB.getCatalogScan(id);
}

export function listCatalogIssues(filters = {}) {
    const stockFilter = String(filters.stock || '').trim().toLowerCase();
    const catFilter = String(filters.category || '').trim().toLowerCase();
    const needStock = stockFilter && stockFilter !== 'all';
    const needCat = Boolean(catFilter);
    const rawLim = Number(filters.limit);
    const lim = Number.isFinite(rawLim) && rawLim > 0
        ? Math.min(rawLim, 100000)
        : 200;
    const rows = chatDB.listCatalogIssues({
        ruleId: filters.ruleId || undefined,
        priority: filters.priority || undefined,
        // Sempre carrega o conjunto da regra para byCategory/filtros ficarem corretos
        limit: 100000,
        viewerUserId: filters.viewerUserId,
    });

    const products = chatDB.listCatalogProducts('bling');
    const byId = new Map(products.map((p) => [String(p.externalId), p]));
    const pendingDraftIds = new Set(chatDB.listPendingCatalogAiDraftExternalIds());

    let out = rows
        .filter((row) => !pendingDraftIds.has(String(row.externalId || '')))
        .map((row) => {
        const p = byId.get(String(row.externalId || '')) || null;
        return {
            ...row,
            stockQty: p?.stockQty ?? null,
            price: p?.price ?? null,
            status: p?.status || null,
            category: p?.category || '',
        };
    });

    if (needStock) {
        out = out.filter((iss) => {
            const qty = iss.stockQty;
            const unknown = qty == null || Number.isNaN(Number(qty));
            if (stockFilter === 'unknown') return unknown;
            if (stockFilter === 'in_stock') return !unknown && Number(qty) > 0;
            if (stockFilter === 'out_of_stock') return !unknown && Number(qty) <= 0;
            return true;
        });
    }

    // Contagem por categoria do produto (antes do filtro de categoria)
    const byCategoryMap = {};
    for (const iss of out) {
        const c = String(iss.category || '').trim() || '(sem categoria)';
        byCategoryMap[c] = (byCategoryMap[c] || 0) + 1;
    }
    const byCategory = Object.entries(byCategoryMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));

    if (needCat) {
        out = out.filter((iss) => {
            const catName = String(iss.category || '').trim() || '(sem categoria)';
            if (catFilter === '(sem categoria)' || catFilter === 'sem categoria') {
                return !String(iss.category || '').trim();
            }
            return catName.toLowerCase().includes(catFilter)
                || catName.toLowerCase() === catFilter;
        });
    }

    const total = out.length;
    return {
        issues: out.slice(0, lim),
        total,
        truncated: total > lim,
        byCategory,
    };
}

const LOCK_TTL_MS = 15 * 60 * 1000;

function actorLabel(actor) {
    return String(actor?.name || actor?.email || 'Usuário').trim() || 'Usuário';
}

/** Reserva produto para edição (evita dois funcionários no mesmo item). */
export function claimCatalogProduct(externalId, opts = {}) {
    const id = String(externalId || '').trim();
    if (!id) throw new Error('Informe o ID do produto.');
    const actor = opts.actor || {};
    const userId = String(actor.id || '').trim();
    if (!userId) throw new Error('Sessão inválida.');

    const force = opts.force === true && actor.role === 'superadmin';
    if (force) {
        chatDB.releaseCatalogLock('bling', id, { force: true });
    }

    const result = chatDB.claimCatalogLock('bling', id, {
        userId,
        userName: actorLabel(actor),
        ttlMs: LOCK_TTL_MS,
    });
    if (!result.ok) {
        const err = new Error(
            `Produto em edição por ${result.lock?.userName || 'outro usuário'}. Aguarde ou peça para liberar.`,
        );
        err.status = 409;
        err.lock = result.lock;
        throw err;
    }
    return { success: true, lock: result.lock, ttlMs: LOCK_TTL_MS };
}

export function renewCatalogProductLock(externalId, opts = {}) {
    const id = String(externalId || '').trim();
    const userId = String(opts.actor?.id || '').trim();
    if (!id || !userId) throw new Error('Sessão inválida.');
    const result = chatDB.renewCatalogLock('bling', id, userId, LOCK_TTL_MS);
    if (!result.ok) {
        const err = new Error(
            result.reason === 'not_owner'
                ? 'Este produto não está reservado para você.'
                : 'Reserva expirada. Abra Corrigir de novo.',
        );
        err.status = 409;
        err.lock = result.lock || null;
        throw err;
    }
    return { success: true, lock: result.lock, ttlMs: LOCK_TTL_MS };
}

export function releaseCatalogProduct(externalId, opts = {}) {
    const id = String(externalId || '').trim();
    if (!id) throw new Error('Informe o ID do produto.');
    const actor = opts.actor || {};
    const force = opts.force === true && actor.role === 'superadmin';
    const result = chatDB.releaseCatalogLock('bling', id, {
        userId: actor.id,
        force,
    });
    if (!result.ok) {
        const err = new Error('Só quem reservou (ou o admin) pode liberar.');
        err.status = 403;
        throw err;
    }
    return { success: true, released: result.released };
}

/**
 * Corrige campos no Bling e atualiza o snapshot local.
 * patch: { sku, name, price, weight, height, width, length, ncm }
 * opts: { actor }
 */
export async function fixCatalogProduct(externalId, patch = {}, opts = {}) {
    const id = String(externalId || '').trim();
    if (!id) throw new Error('Informe o ID do produto Bling.');

    const before = chatDB.getCatalogProduct('bling', id);
    const updated = await patchBlingProduct(id, patch);
    if (!updated) throw new Error('Bling não retornou o produto atualizado.');

    try {
        await loadBlingCategoryMap();
    } catch {
        /* best-effort */
    }

    const row = mapBlingProductToRow(
        { id, codigo: updated.codigo, nome: updated.nome, preco: updated.preco, situacao: updated.situacao },
        updated,
    );
    // Preserva reviewStatus
    if (before?.reviewStatus) {
        row.reviewStatus = before.reviewStatus;
    }
    // Rank Math / meta SEO não existem no Bling — mantém do patch ou do snapshot anterior
    const seoTitle = String(patch.seoTitle ?? before?.seoTitle ?? '').trim();
    const seoDescription = String(patch.seoDescription ?? before?.seoDescription ?? '').trim();
    const focusKeyword = String(patch.focusKeyword ?? before?.focusKeyword ?? '').trim();
    if (seoTitle) row.seoTitle = seoTitle.slice(0, 60);
    if (seoDescription) row.seoDescription = seoDescription.slice(0, 160);
    if (focusKeyword) row.focusKeyword = focusKeyword.slice(0, 80);
    if (patch.description != null && String(patch.description).trim()) {
        row.description = String(patch.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (patch.shortDescription != null && String(patch.shortDescription).trim()) {
        row.shortDescription = String(patch.shortDescription).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    chatDB.upsertCatalogProduct(row);
    chatDB.setCatalogProductReviewStatus('bling', id, 'done');
    chatDB.deleteCatalogIssuesForProduct('bling', id);
    try {
        chatDB.markCatalogAiDraftsAppliedByExternalId(id);
    } catch {
        /* best-effort */
    }

    // NÃO envia ao Woo daqui — sync Woo é pelo Bling (evitar duplicata no ERP).
    // seoTitle / seoDescription / focusKeyword ficam no snapshot local + textos vão ao Bling
    // (descricaoCurta / descricaoComplementar) para o Bling propagar à loja.

    // Reavalia só este produto nas regras Bling-only (rápido)
    const allBling = chatDB.listCatalogProducts('bling');
    const product = chatDB.getCatalogProduct('bling', id);
    const fauxScanId = chatDB.getLatestCatalogScan()?.id || `fix_${Date.now()}`;
    const singleCtx = {
        bling: product ? [product] : [],
        woo: [],
        blingBySku: new Map(),
        wooBySku: new Map(),
        wooEnabled: false,
    };
    if (product?.sku) singleCtx.blingBySku.set(String(product.sku).trim().toLowerCase(), product);

    const wooOnly = new Set([
        'orphan_bling', 'orphan_woo', 'price_divergent', 'name_divergent', 'seo_missing',
        'stock_divergent', 'photos_asymmetric', 'photos_divergent', 'weight_divergent', 'dimensions_divergent',
    ]);
    let newIssues = 0;
    for (const rule of CATALOG_RULES) {
        if (wooOnly.has(rule.id)) continue;
        const found = (rule.run(singleCtx) || []).filter((i) => String(i.externalId) === id);
        for (const iss of found) {
            chatDB.insertCatalogIssue({
                ...iss,
                ruleId: rule.id,
                priority: iss.priority || rule.priority,
                scanId: fauxScanId,
            });
            newIssues += 1;
        }
    }

    logAudit({
        actor: opts.actor,
        action: 'catalog_fix',
        targetType: 'catalog_product',
        targetId: id,
        summary: `Catálogo corrigido: ${product?.sku || id} · ${product?.name || ''}`,
        meta: { patch, sku: product?.sku, name: product?.name },
    });

    if (opts.actor?.id) {
        chatDB.releaseCatalogLock('bling', id, { userId: opts.actor.id, force: opts.actor.role === 'superadmin' });
    } else {
        chatDB.deleteCatalogLock('bling', id);
    }

    return {
        product: chatDB.getCatalogProduct('bling', id),
        remainingIssues: newIssues,
        totalBling: allBling.length,
        dashboard: getCatalogDashboard(),
    };
}

/**
 * Exclui produto no Bling e remove do snapshot local + issues.
 */
export async function deleteCatalogProduct(externalId, opts = {}) {
    const id = String(externalId || '').trim();
    if (!id) throw new Error('Informe o ID do produto Bling.');

    const before = chatDB.getCatalogProduct('bling', id);
    await deleteBlingProduct(id);
    const removed = chatDB.deleteCatalogProduct('bling', id);

    logAudit({
        actor: opts.actor,
        action: 'catalog_delete',
        targetType: 'catalog_product',
        targetId: id,
        summary: `Produto excluído no Bling: ${before?.sku || id} · ${before?.name || ''}`,
        meta: { sku: before?.sku, name: before?.name },
    });

    return {
        deletedId: id,
        sku: before?.sku || '',
        name: before?.name || '',
        removed,
        dashboard: getCatalogDashboard(),
    };
}

export function getCatalogProduct(externalId) {
    return chatDB.getCatalogProduct('bling', String(externalId));
}

/** Produtos já revisados (reviewStatus done/published). */
export function listReviewedCatalogProducts({ search = '', limit = 500 } = {}) {
    const products = chatDB.listCatalogProductsByReview({
        reviewStatus: 'done',
        search,
        limit,
    });
    return {
        products,
        total: chatDB.countCatalogReviewed(),
        count: products.length,
    };
}

/** Marca produto como revisado sem alterar o Bling (conferência visual OK). */
export function markCatalogProductReviewed(externalId, opts = {}) {
    const id = String(externalId || '').trim();
    if (!id) throw new Error('Informe o ID do produto Bling.');
    const product = chatDB.getCatalogProduct('bling', id);
    if (!product) throw new Error('Produto não encontrado no snapshot local. Rode Verificar Catálogo.');
    chatDB.setCatalogProductReviewStatus('bling', id, 'done');
    logAudit({
        actor: opts.actor,
        action: 'catalog_mark_reviewed',
        targetType: 'catalog_product',
        targetId: id,
        summary: `Marcou como revisado: ${product.sku || id} · ${product.name || ''}`,
        meta: { sku: product.sku, name: product.name },
    });
    return {
        product: chatDB.getCatalogProduct('bling', id),
        dashboard: getCatalogDashboard(),
    };
}

export async function listBlingCategories() {
    return fetchBlingProductCategories();
}

export async function createCatalogCategory({ name, parentId } = {}, opts = {}) {
    const created = await createBlingProductCategory({ name, parentId });
    try {
        await loadBlingCategoryMap();
    } catch {
        /* ignore */
    }
    logAudit({
        actor: opts.actor,
        action: 'catalog_category_create',
        targetType: 'bling_category',
        targetId: String(created.id),
        summary: `Criou categoria Bling: ${created.name}`,
        meta: { parentId: created.parentId },
    });
    return created;
}

export async function refreshCategoryNamesAndReaudit() {
    const resolved = await resolveLocalCategoryNames({ refreshStaleDetails: false });
    const scanId = `scan_${Date.now()}_cats`;
    const result = runCatalogAudit(scanId);
    return { ...resolved, dashboard: getCatalogDashboard(), audit: result };
}

function reauditOneBlingProduct(id) {
    chatDB.deleteCatalogIssuesForProduct('bling', id);
    const product = chatDB.getCatalogProduct('bling', id);
    const fauxScanId = chatDB.getLatestCatalogScan()?.id || `fix_${Date.now()}`;
    const singleCtx = {
        bling: product ? [product] : [],
        woo: [],
        blingBySku: new Map(),
        wooBySku: new Map(),
        wooEnabled: false,
    };
    if (product?.sku) singleCtx.blingBySku.set(String(product.sku).trim().toLowerCase(), product);
    const wooOnly = new Set([
        'orphan_bling', 'orphan_woo', 'price_divergent', 'name_divergent', 'seo_missing',
        'stock_divergent', 'photos_asymmetric', 'photos_divergent', 'weight_divergent', 'dimensions_divergent',
    ]);
    let newIssues = 0;
    for (const rule of CATALOG_RULES) {
        if (wooOnly.has(rule.id)) continue;
        const found = (rule.run(singleCtx) || []).filter((i) => String(i.externalId) === id);
        for (const iss of found) {
            chatDB.insertCatalogIssue({
                ...iss,
                ruleId: rule.id,
                priority: iss.priority || rule.priority,
                scanId: fauxScanId,
            });
            newIssues += 1;
        }
    }
    return { product, remainingIssues: newIssues };
}

/** Busca o cadastro ao vivo no Bling e atualiza o snapshot + issues daquele produto. */
export async function refreshCatalogProductFromBling(externalId, opts = {}) {
    const id = String(externalId || '').trim();
    if (!id) throw new Error('Informe o ID do produto Bling.');
    const before = chatDB.getCatalogProduct('bling', id);
    if (!before) throw new Error('Produto não encontrado no snapshot local. Rode Verificar Catálogo.');
    const product = await refreshBlingProductDetail(id);
    const { remainingIssues } = reauditOneBlingProduct(id);
    logAudit({
        actor: opts.actor,
        action: 'catalog_refresh_bling',
        targetType: 'catalog_product',
        targetId: id,
        summary: `Atualizou cadastro do Bling: ${product?.sku || before.sku || id}`,
        meta: { sku: product?.sku || before.sku, category: product?.category || '' },
    });
    return {
        product: chatDB.getCatalogProduct('bling', id),
        remainingIssues,
        dashboard: getCatalogDashboard(),
    };
}

/** Categorias / nomes típicos de semijoia. */
const JEWELRY_CAT = /brincos?|colares?|pulseiras?|aneis|an[eé]is|pratas?|chokers?|riviera|mezuzah|semi.?j[oó]ia|joias?/i;
const BIBLE_CAT = /b[ií]blias?/i;
const JEWELRY_NAME = /\b(brinco|colares?|colar|pulseira|anel|an[eé]is|argola|piercing|pingente|choker|alian[cç]a|berloque|corrente|prata|ouro|semi.?j[oó]ia)\b/i;
const BIBLE_NAME = /\bb[ií]blia(s)?\b|\bbible\b/i;

/**
 * Classifica produto: jewelry | bible | other (candidato a fantasma / fora do escopo).
 */
export function classifyCatalogProductScope(p) {
    const cat = String(p?.category || '').trim();
    const name = String(p?.name || '').trim();
    const hay = `${cat} ${name}`;

    if (BIBLE_CAT.test(cat) || BIBLE_NAME.test(name)) return 'bible';
    if (JEWELRY_CAT.test(cat) || JEWELRY_NAME.test(name)) return 'jewelry';
    // "Livro" sem "Bíblia" no nome = outros (pode ser fantasma ou editorial)
    return 'other';
}

/**
 * Lista produtos que NÃO são semijoia nem Bíblia — para conferência de fantasmas.
 * @param {{ search?: string, q?: string, category?: string, stock?: string, limit?: number }} opts
 * stock: '' | 'all' | 'in_stock' | 'out_of_stock' | 'unknown'
 */
export function listOutOfScopeCatalogProducts({
    search = '',
    q = '',
    category = '',
    stock = '',
    limit = 2000,
} = {}) {
    const query = String(search || q || '').trim().toLowerCase();
    const catFilter = String(category || '').trim().toLowerCase();
    const stockFilter = String(stock || '').trim().toLowerCase();
    const lim = Math.min(Math.max(Number(limit) || 2000, 1), 5000);
    const all = chatDB.listCatalogProducts('bling');

    const counts = { jewelry: 0, bible: 0, other: 0 };
    const others = [];

    for (const p of all) {
        // Só unidade vendável simples (evita pai de variação)
        const formato = String(p.formato || '').toUpperCase();
        if (formato === 'V') continue;

        const scope = classifyCatalogProductScope(p);
        counts[scope] = (counts[scope] || 0) + 1;
        if (scope !== 'other') continue;

        others.push({
            externalId: p.externalId,
            sku: p.sku || '',
            name: p.name || '',
            price: p.price ?? null,
            category: p.category || '',
            brand: p.brand || '',
            status: p.status || '',
            stockQty: p.stockQty ?? null,
            weight: p.weight ?? null,
            ncm: p.ncm || '',
            imageCount: p.imageCount ?? 0,
            reviewStatus: p.reviewStatus || 'not_started',
        });
    }

    const byCategoryMap = {};
    for (const p of others) {
        const c = p.category || '(sem categoria)';
        byCategoryMap[c] = (byCategoryMap[c] || 0) + 1;
    }
    const byCategory = Object.entries(byCategoryMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

    let filtered = others;
    if (catFilter) {
        filtered = filtered.filter((p) => {
            const catName = p.category || '(sem categoria)';
            if (catFilter === '(sem categoria)' || catFilter === 'sem categoria') {
                return !String(p.category || '').trim();
            }
            return String(catName).toLowerCase().includes(catFilter);
        });
    }
    if (stockFilter && stockFilter !== 'all') {
        filtered = filtered.filter((p) => {
            const qty = p.stockQty;
            const unknown = qty == null || Number.isNaN(Number(qty));
            if (stockFilter === 'unknown') return unknown;
            if (stockFilter === 'in_stock') return !unknown && Number(qty) > 0;
            if (stockFilter === 'out_of_stock') return !unknown && Number(qty) <= 0;
            return true;
        });
    }
    if (query) {
        filtered = filtered.filter((p) => {
            const hay = `${p.sku || ''} ${p.name || ''} ${p.externalId || ''} ${p.category || ''} ${p.brand || ''}`.toLowerCase();
            return hay.includes(query);
        });
    }

    filtered.sort((a, b) => String(a.category || 'zzz').localeCompare(String(b.category || 'zzz'))
        || String(a.name || '').localeCompare(String(b.name || '')));

    return {
        products: filtered.slice(0, lim),
        total: filtered.length,
        totalUnfiltered: others.length,
        truncated: filtered.length > lim,
        counts,
        byCategory,
    };
}

/** CSV para enviar ao responsável conferir produtos fora do escopo. */
export function buildOutOfScopeCatalogCsv(filters = {}) {
    const { products, total, counts, byCategory } = listOutOfScopeCatalogProducts({
        ...filters,
        limit: 5000,
    });
    const stockLabel = ({
        in_stock: 'com estoque',
        out_of_stock: 'sem estoque',
        unknown: 'estoque desconhecido',
    })[String(filters.stock || '')] || 'todos';
    const header = [
        'SKU', 'Nome', 'ID Bling', 'Categoria', 'Marca', 'Preço', 'Estoque', 'Situação', 'Peso', 'NCM', 'Fotos', 'Revisão',
    ].join(';');
    const lines = [header];
    for (const p of products) {
        lines.push([
            csvCell(p.sku),
            csvCell(p.name),
            csvCell(p.externalId),
            csvCell(p.category || '(sem categoria)'),
            csvCell(p.brand),
            csvCell(p.price ?? ''),
            csvCell(p.stockQty ?? ''),
            csvCell(p.status === 'I' ? 'Inativo' : (p.status === 'A' ? 'Ativo' : p.status)),
            csvCell(p.weight ?? ''),
            csvCell(p.ncm),
            csvCell(p.imageCount ?? ''),
            csvCell(p.reviewStatus === 'done' || p.reviewStatus === 'published' ? 'Revisado' : 'Pendente'),
        ].join(';'));
    }
    const note = [
        `# Relatório: produtos que NÃO são semijoia nem Bíblia`,
        `# Total nesta lista: ${total}`,
        `# Filtros — estoque: ${stockLabel}${filters.category ? ` · categoria: ${filters.category}` : ''}${filters.search || filters.q ? ` · busca: ${filters.search || filters.q}` : ''}`,
        `# Catálogo — semijoia: ${counts.jewelry} · Bíblia: ${counts.bible} · outros: ${counts.other}`,
        `# Por categoria: ${byCategory.map((c) => `${c.name}=${c.count}`).join(' | ')}`,
        `# Gerado em ${new Date().toLocaleString('pt-BR')}`,
    ].join('\n');

    return {
        csv: `\ufeff${note}\n${lines.join('\n')}`,
        count: products.length,
        total,
        counts,
        byCategory,
        filename: `produtos-fora-escopo-${new Date().toISOString().slice(0, 10)}.csv`,
    };
}

function normProductName(n) {
    return String(n || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/** SKU curto numérico típico de ID Woo / clone. */
function isShortNumericSku(sku) {
    return /^\d{3,6}$/.test(String(sku || ''));
}

/**
 * Clones: Woo com SKU = ID do Woo + cadastro espelho no Bling, enquanto o SKU real
 * (outro código, mesmo nome) também existe no Bling.
 * Ação sugerida: inativar o clone no Bling e corrigir o SKU do Woo para o real.
 */
export function listWooIdCloneProducts({
    search = '',
    q = '',
    confidence = '',
    cloneStatus = 'active',
    limit = 2000,
} = {}) {
    const query = String(search || q || '').trim().toLowerCase();
    const confFilter = String(confidence || '').trim().toLowerCase();
    const statusFilter = String(cloneStatus || 'active').trim().toLowerCase();
    const lim = Math.min(Math.max(Number(limit) || 2000, 1), 5000);

    const blingAll = chatDB.listCatalogProducts('bling');
    const wooAll = chatDB.listCatalogProducts('woo');

    const blingBySku = new Map();
    const blingByName = new Map();
    for (const p of blingAll) {
        if (isVariationParent(p)) continue;
        const s = normSku(p.sku);
        if (s && !blingBySku.has(s)) blingBySku.set(s, p);
        const n = normProductName(p.name);
        if (!n || n.length < 6) continue;
        if (!blingByName.has(n)) blingByName.set(n, []);
        blingByName.get(n).push(p);
    }

    const rows = [];
    let wooSkuEqId = 0;
    let withCloneInBling = 0;
    let withRealAlt = 0;

    for (const w of wooAll) {
        const wooSku = normSku(w.sku);
        const wooId = String(w.externalId || '').trim();
        if (!wooSku || !wooId || wooSku !== wooId) continue;
        wooSkuEqId += 1;

        const clone = blingBySku.get(wooSku);
        if (!clone) continue;
        withCloneInBling += 1;

        if (statusFilter === 'active' && isInactive(clone)) continue;
        if (statusFilter === 'inactive' && !isInactive(clone)) continue;

        const nameKey = normProductName(w.name || clone.name);
        const sameName = (blingByName.get(nameKey) || []).filter((p) => {
            const s = normSku(p.sku);
            if (!s || s === wooSku) return false;
            if (String(p.externalId) === String(clone.externalId)) return false;
            return true;
        });

        // Preferir SKU “real”: não parece ID Woo; depois mais fotos; depois ativo
        const scored = sameName.map((p) => {
            const s = normSku(p.sku);
            let score = 0;
            if (!isShortNumericSku(s)) score += 40;
            if (!isInactive(p)) score += 20;
            score += Math.min(Number(p.imageCount) || 0, 15);
            if (Number(p.stockQty) > 0) score += 5;
            return { p, s, score };
        }).sort((a, b) => b.score - a.score || String(a.s).localeCompare(String(b.s)));

        const keep = scored[0]?.p || null;
        if (keep) withRealAlt += 1;

        let conf = 'low';
        if (keep) {
            const keepImgs = Number(keep.imageCount) || 0;
            const cloneImgs = Number(clone.imageCount) || 0;
            conf = keepImgs > cloneImgs || (!isShortNumericSku(normSku(keep.sku)) && cloneImgs === 0)
                ? 'high'
                : 'medium';
        }

        rows.push({
            name: w.name || clone.name || '',
            confidence: conf,
            action: keep
                ? 'Inativar clone no Bling; no Woo trocar SKU para o código real'
                : 'Revisar — clone Woo-ID no Bling sem par de nome óbvio',
            woo: {
                id: wooId,
                sku: wooSku,
                status: w.status || '',
                price: w.price ?? null,
                stockQty: w.stockQty ?? null,
                imageCount: w.imageCount ?? 0,
            },
            clone: {
                id: String(clone.externalId),
                sku: clone.sku || wooSku,
                status: clone.status || '',
                price: clone.price ?? null,
                stockQty: clone.stockQty ?? null,
                imageCount: clone.imageCount ?? 0,
            },
            keep: keep ? {
                id: String(keep.externalId),
                sku: keep.sku || '',
                status: keep.status || '',
                price: keep.price ?? null,
                stockQty: keep.stockQty ?? null,
                imageCount: keep.imageCount ?? 0,
            } : null,
        });
    }

    let filtered = rows;
    if (confFilter && confFilter !== 'all') {
        filtered = filtered.filter((r) => r.confidence === confFilter);
    }
    if (query) {
        filtered = filtered.filter((r) => {
            const hay = [
                r.name, r.woo?.sku, r.woo?.id, r.clone?.sku, r.clone?.id,
                r.keep?.sku, r.keep?.id, r.action,
            ].join(' ').toLowerCase();
            return hay.includes(query);
        });
    }

    filtered.sort((a, b) => {
        const rank = { high: 0, medium: 1, low: 2 };
        return (rank[a.confidence] ?? 9) - (rank[b.confidence] ?? 9)
            || String(a.name || '').localeCompare(String(b.name || ''));
    });

    return {
        rows: filtered.slice(0, lim),
        total: filtered.length,
        truncated: filtered.length > lim,
        counts: {
            wooSkuEqId,
            withCloneInBling,
            withRealAlt,
            high: rows.filter((r) => r.confidence === 'high').length,
            medium: rows.filter((r) => r.confidence === 'medium').length,
            low: rows.filter((r) => r.confidence === 'low').length,
            listed: rows.length,
        },
    };
}

export function buildWooIdClonesCsv(filters = {}) {
    const { rows, total, counts } = listWooIdCloneProducts({ ...filters, limit: 5000 });
    const header = [
        'Confiança',
        'Nome',
        'SKU clone (Woo ID)',
        'ID Bling clone',
        'Fotos clone',
        'Situação clone',
        'SKU real sugerido',
        'ID Bling real',
        'Fotos real',
        'Situação real',
        'Woo ID',
        'Woo status',
        'Fotos Woo',
        'Ação sugerida',
    ].join(';');
    const lines = [header];
    for (const r of rows) {
        lines.push([
            csvCell(r.confidence),
            csvCell(r.name),
            csvCell(r.clone?.sku),
            csvCell(r.clone?.id),
            csvCell(r.clone?.imageCount ?? ''),
            csvCell(r.clone?.status === 'I' ? 'Inativo' : (r.clone?.status === 'A' ? 'Ativo' : r.clone?.status)),
            csvCell(r.keep?.sku || ''),
            csvCell(r.keep?.id || ''),
            csvCell(r.keep?.imageCount ?? ''),
            csvCell(r.keep ? (r.keep.status === 'I' ? 'Inativo' : (r.keep.status === 'A' ? 'Ativo' : r.keep.status)) : ''),
            csvCell(r.woo?.id),
            csvCell(r.woo?.status),
            csvCell(r.woo?.imageCount ?? ''),
            csvCell(r.action),
        ].join(';'));
    }
    const note = [
        `# Relatório: clones Woo-ID × SKU real Bling`,
        `# Total nesta lista: ${total}`,
        `# Woo com SKU=ID: ${counts.wooSkuEqId} · clone no Bling: ${counts.withCloneInBling} · com SKU real (mesmo nome): ${counts.withRealAlt}`,
        `# Confiança — alta: ${counts.high} · média: ${counts.medium} · baixa: ${counts.low}`,
        `# Ação típica: inativar o clone no Bling; no Woo trocar o SKU para o código real`,
        `# Gerado em ${new Date().toLocaleString('pt-BR')}`,
    ].join('\n');

    return {
        csv: `\ufeff${note}\n${lines.join('\n')}`,
        count: rows.length,
        total,
        counts,
        filename: `clones-woo-id-bling-${new Date().toISOString().slice(0, 10)}.csv`,
    };
}

/**
 * Inativa produto no Bling (quando exclusão é bloqueada por histórico).
 */
export async function inactivateCatalogProduct(externalId, opts = {}) {
    const id = String(externalId || '').trim();
    if (!id) throw new Error('Informe o ID do produto Bling.');

    const before = chatDB.getCatalogProduct('bling', id);
    const updated = await setBlingProductSituation(id, 'I');
    const row = mapBlingProductToRow(
        {
            id,
            codigo: updated?.codigo ?? before?.sku,
            nome: updated?.nome ?? before?.name,
            preco: updated?.preco ?? before?.price,
            situacao: updated?.situacao || 'I',
        },
        updated || before,
    );
    if (before?.reviewStatus) row.reviewStatus = before.reviewStatus;
    row.status = 'I';
    chatDB.upsertCatalogProduct(row);
    chatDB.setCatalogProductReviewStatus('bling', id, 'done');
    chatDB.deleteCatalogIssuesForProduct('bling', id);

    logAudit({
        actor: opts.actor,
        action: 'catalog_inactivate',
        targetType: 'catalog_product',
        targetId: id,
        summary: `Produto inativado no Bling: ${before?.sku || id} · ${before?.name || ''}`,
        meta: { sku: before?.sku, name: before?.name },
    });

    chatDB.deleteCatalogLock('bling', id);

    return {
        product: chatDB.getCatalogProduct('bling', id),
        inactivated: true,
        sku: before?.sku || '',
        name: before?.name || '',
        dashboard: getCatalogDashboard(),
    };
}

/**
 * Ação em massa: inactivate | delete
 * delete: tenta excluir; se fallbackInactivate, inativa quando Bling bloquear.
 */
export async function bulkCatalogProducts(action, ids = [], opts = {}) {
    const list = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!list.length) throw new Error('Selecione ao menos um produto.');
    if (list.length > 100) throw new Error('Máximo 100 produtos por vez.');

    const results = [];
    let ok = 0;
    let failed = 0;
    let inactivatedFallback = 0;

    for (const id of list) {
        try {
            if (action === 'inactivate') {
                await inactivateCatalogProduct(id, { actor: opts.actor });
                results.push({ id, status: 'inactivated' });
                ok += 1;
            } else if (action === 'delete') {
                try {
                    await deleteCatalogProduct(id, { actor: opts.actor });
                    results.push({ id, status: 'deleted' });
                    ok += 1;
                } catch (err) {
                    if (opts.fallbackInactivate !== false) {
                        await inactivateCatalogProduct(id, { actor: opts.actor });
                        results.push({ id, status: 'inactivated_fallback', error: err?.message });
                        ok += 1;
                        inactivatedFallback += 1;
                    } else {
                        throw err;
                    }
                }
            } else {
                throw new Error(`Ação inválida: ${action}`);
            }
        } catch (err) {
            failed += 1;
            results.push({ id, status: 'error', error: err?.message || String(err) });
        }
        // leve pausa para rate limit Bling
        await new Promise((r) => setTimeout(r, 120));
    }

    logAudit({
        actor: opts.actor,
        action: `catalog_bulk_${action}`,
        targetType: 'catalog_product',
        targetId: list.join(','),
        summary: `Bulk ${action}: ${ok} ok · ${failed} erro(s) · ${list.length} selecionado(s)`,
        meta: { ok, failed, inactivatedFallback, count: list.length },
    });

    return {
        action,
        ok,
        failed,
        inactivatedFallback,
        total: list.length,
        results,
        dashboard: getCatalogDashboard(),
    };
}

/**
 * Lista IDs Bling ativos de uma categoria (para inativar em lotes no front).
 */
export function listActiveCatalogIdsByCategory(category) {
    const cat = String(category || '').trim();
    if (!cat) throw new Error('Informe a categoria.');

    const all = chatDB.listCatalogProducts('bling');
    const catKey = cat.toLowerCase();
    const isSemCategoria = catKey === '(sem categoria)' || catKey === 'sem categoria';

    const catOf = (p) => String(p.category || '').trim() || '(sem categoria)';
    const exact = [];
    const partial = [];
    for (const p of all) {
        if (isInactive(p)) continue;
        const c = catOf(p);
        if (isSemCategoria) {
            if (!String(p.category || '').trim()) exact.push(p);
            continue;
        }
        if (c.toLowerCase() === catKey) exact.push(p);
        else if (c.toLowerCase().includes(catKey)) partial.push(p);
    }
    const matched = exact.length ? exact : partial;
    const idSet = new Set(matched.map((p) => String(p.externalId)));
    for (const p of all) {
        const parent = String(p.parentId || '').trim();
        if (parent && idSet.has(parent) && !isInactive(p)) {
            idSet.add(String(p.externalId));
        }
    }
    const ids = [...idSet];
    return {
        category: cat,
        matched: matched.length,
        total: ids.length,
        ids,
    };
}

/**
 * Inativa TODOS os produtos ativos do snapshot Bling na categoria (não só a lista de problemas).
 * Inclui filhos de variação quando o pai entra na seleção.
 * Prefira listActiveCatalogIdsByCategory + bulk em lotes para categorias grandes (evita timeout HTTP).
 */
export async function inactivateCatalogByCategory(category, opts = {}) {
    const listed = listActiveCatalogIdsByCategory(category);
    if (!listed.ids.length) {
        throw new Error(`Nenhum produto ativo encontrado na categoria "${category}" no snapshot. Rode Verificar Catálogo.`);
    }

    const ids = listed.ids;
    const out = {
        category: listed.category,
        matched: listed.matched,
        total: ids.length,
        ok: 0,
        failed: 0,
        skippedInactive: 0,
        errors: [],
        results: [],
    };

    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i];
        try {
            await inactivateCatalogProduct(id, { actor: opts.actor });
            out.ok += 1;
            out.results.push({ id, status: 'inactivated' });
        } catch (err) {
            out.failed += 1;
            const error = err?.message || String(err);
            out.errors.push({ id, error });
            out.results.push({ id, status: 'error', error });
            logger.warn('Inativar por categoria falhou', id, error);
        }
        await new Promise((r) => setTimeout(r, 120));
        if ((i + 1) % CHUNK === 0) {
            logger.info('Inativar categoria progresso', {
                category: listed.category,
                done: i + 1,
                total: ids.length,
                ok: out.ok,
                failed: out.failed,
            });
        }
    }

    logAudit({
        actor: opts.actor,
        action: 'catalog_inactivate_by_category',
        targetType: 'catalog',
        targetId: listed.category,
        summary: `Inativou categoria "${listed.category}": ${out.ok}/${out.total} ok · ${out.failed} erro(s)`,
        meta: { ok: out.ok, failed: out.failed, total: out.total, matched: out.matched },
    });

    return {
        ...out,
        dashboard: getCatalogDashboard(),
    };
}

function csvCell(value) {
    const s = value == null ? '' : String(value);
    if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

/**
 * CSV de problemas (com campos do snapshot Bling) — Excel BR (BOM + ;).
 * @param {{ ruleId?: string, priority?: string, stock?: string }} filters
 */
export function buildCatalogIssuesCsv(filters = {}) {
    const ruleLabel = Object.fromEntries(CATALOG_RULES.map((r) => [r.id, r.label]));
    const { issues } = listCatalogIssues({
        ruleId: filters.ruleId || undefined,
        priority: filters.priority || undefined,
        stock: filters.stock || undefined,
        category: filters.category || undefined,
        limit: 100000,
    });

    const headers = [
        'Prioridade',
        'Regra',
        'Regra ID',
        'SKU',
        'Nome',
        'ID Bling',
        'Mensagem',
        'Preço',
        'Estoque',
        'Peso kg',
        'Altura',
        'Largura',
        'Comprimento',
        'NCM',
        'Categoria',
        'Fotos',
        'Status produto',
        'Canal',
    ];

    const products = chatDB.listCatalogProducts('bling');
    const byId = new Map(products.map((p) => [String(p.externalId), p]));

    const lines = [headers.join(';')];
    for (const iss of issues) {
        const p = byId.get(String(iss.externalId || '')) || {};
        lines.push([
            csvCell(iss.priority),
            csvCell(ruleLabel[iss.ruleId] || iss.ruleId),
            csvCell(iss.ruleId),
            csvCell(iss.sku || p.sku || ''),
            csvCell(iss.name || p.name || ''),
            csvCell(iss.externalId || ''),
            csvCell(iss.message || ''),
            csvCell(p.price ?? iss.price ?? ''),
            csvCell(iss.stockQty ?? p.stockQty ?? ''),
            csvCell(p.weight ?? ''),
            csvCell(p.height ?? ''),
            csvCell(p.width ?? ''),
            csvCell(p.length ?? ''),
            csvCell(p.ncm || ''),
            csvCell(iss.category || p.category || ''),
            csvCell(p.imageCount ?? ''),
            csvCell(p.status || iss.status || ''),
            csvCell(iss.channel || ''),
        ].join(';'));
    }

    return {
        csv: `\ufeff${lines.join('\n')}`,
        count: issues.length,
        filename: `catalogo-problemas-${filters.ruleId || 'todos'}-${new Date().toISOString().slice(0, 10)}.csv`,
    };
}

/**
 * Inventário completo Bling para a gerente: TODOS os produtos, com ou sem erro.
 * Colunas de status + lista de problemas (rótulos) quando houver.
 * @param {{ status?: string, stock?: string, scope?: string }} filters
 * status: '' | 'all' | 'A' | 'I'
 * scope: '' | 'all' | 'jewelry' | 'bible' | 'other'
 */
export function buildFullCatalogInventoryCsv(filters = {}) {
    const ruleLabel = Object.fromEntries(CATALOG_RULES.map((r) => [r.id, r.label]));
    const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
    const statusFilter = String(filters.status || '').trim().toUpperCase();
    const stockFilter = String(filters.stock || '').trim().toLowerCase();
    const scopeFilter = String(filters.scope || '').trim().toLowerCase();

    const products = chatDB.listCatalogProducts('bling');
    const allIssues = chatDB.listCatalogIssues({ limit: 100000 });
    /** @type {Map<string, Array<{ ruleId: string, priority: string, message: string }>>} */
    const issuesById = new Map();
    for (const iss of allIssues) {
        if (String(iss.channel || '') !== 'bling') continue;
        const id = String(iss.externalId || '');
        if (!id) continue;
        if (!issuesById.has(id)) issuesById.set(id, []);
        issuesById.get(id).push({
            ruleId: iss.ruleId,
            priority: iss.priority,
            message: iss.message || '',
        });
    }

    const scopeLabel = { jewelry: 'Semijoia', bible: 'Bíblia', other: 'Fora do escopo' };
    const header = [
        'SKU',
        'Nome',
        'ID Bling',
        'Situação',
        'Escopo',
        'Categoria',
        'Marca',
        'Preço',
        'Estoque',
        'Peso kg',
        'Altura',
        'Largura',
        'Comprimento',
        'NCM',
        'Fotos',
        'Revisão',
        'Tem problema?',
        'Qtd problemas',
        'Pior prioridade',
        'Problemas (tipos)',
        'Problemas (detalhe)',
    ].join(';');

    const lines = [header];
    let withProblems = 0;
    let withoutProblems = 0;
    let skipped = 0;

    const sorted = [...products].sort((a, b) => String(a.sku || '').localeCompare(String(b.sku || ''))
        || String(a.name || '').localeCompare(String(b.name || '')));

    for (const p of sorted) {
        if (isVariationParent(p)) {
            skipped += 1;
            continue;
        }
        const situacao = String(p.status || '').toUpperCase() === 'I' ? 'I' : 'A';
        if (statusFilter === 'A' && situacao !== 'A') continue;
        if (statusFilter === 'I' && situacao !== 'I') continue;

        const scope = classifyCatalogProductScope(p);
        if (scopeFilter && scopeFilter !== 'all' && scope !== scopeFilter) continue;

        const qty = p.stockQty;
        const unknown = qty == null || Number.isNaN(Number(qty));
        if (stockFilter && stockFilter !== 'all') {
            if (stockFilter === 'unknown' && !unknown) continue;
            if (stockFilter === 'in_stock' && (unknown || Number(qty) <= 0)) continue;
            if (stockFilter === 'out_of_stock' && (unknown || Number(qty) > 0)) continue;
        }

        const issList = (issuesById.get(String(p.externalId)) || [])
            .slice()
            .sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9));
        const hasProblem = issList.length > 0;
        if (hasProblem) withProblems += 1;
        else withoutProblems += 1;

        const types = [...new Set(issList.map((i) => ruleLabel[i.ruleId] || i.ruleId))];
        const worst = issList[0]?.priority || '';
        const detail = issList.map((i) => {
            const lab = ruleLabel[i.ruleId] || i.ruleId;
            return i.message ? `${lab}: ${i.message}` : lab;
        }).join(' | ');

        const review = (p.reviewStatus === 'done' || p.reviewStatus === 'published') ? 'Revisado' : 'Pendente';

        lines.push([
            csvCell(p.sku),
            csvCell(p.name),
            csvCell(p.externalId),
            csvCell(situacao === 'I' ? 'Inativo' : 'Ativo'),
            csvCell(scopeLabel[scope] || scope),
            csvCell(p.category || '(sem categoria)'),
            csvCell(p.brand),
            csvCell(p.price ?? ''),
            csvCell(p.stockQty ?? ''),
            csvCell(p.weight ?? ''),
            csvCell(p.height ?? ''),
            csvCell(p.width ?? ''),
            csvCell(p.length ?? ''),
            csvCell(p.ncm),
            csvCell(p.imageCount ?? 0),
            csvCell(review),
            csvCell(hasProblem ? 'Sim' : 'Não'),
            csvCell(issList.length),
            csvCell(worst === 'critical' ? 'Crítica'
                : worst === 'high' ? 'Alta'
                    : worst === 'medium' ? 'Média'
                        : worst === 'low' ? 'Baixa' : ''),
            csvCell(types.join(' · ')),
            csvCell(detail),
        ].join(';'));
    }

    const note = [
        `# Inventário completo do catálogo Bling (com e sem problemas)`,
        `# Linhas de produto: ${lines.length - 1} · Com problema: ${withProblems} · Sem problema: ${withoutProblems}`,
        `# Pais de variação omitidos: ${skipped}`,
        `# Filtros — situação: ${statusFilter || 'todos'} · estoque: ${stockFilter || 'todos'} · escopo: ${scopeFilter || 'todos'}`,
        `# Problemas vêm da última análise (Verificar Catálogo). Se estiver desatualizado, rode a verificação antes.`,
        `# Separador ; — abrir no Excel BR. Gerado em ${new Date().toLocaleString('pt-BR')}`,
    ].join('\n');

    return {
        csv: `\ufeff${note}\n${lines.join('\n')}`,
        count: lines.length - 1,
        withProblems,
        withoutProblems,
        filename: `inventario-catalogo-bling-${new Date().toISOString().slice(0, 10)}.csv`,
    };
}

function sideSnapshot(p) {
    if (!p) return null;
    return {
        id: p.externalId,
        sku: p.sku || '',
        name: p.name || '',
        stockQty: p.stockQty ?? null,
        imageCount: p.imageCount ?? 0,
        price: p.price ?? null,
        salePrice: p.salePrice ?? null,
        weight: p.weight ?? null,
        height: p.height ?? null,
        width: p.width ?? null,
        length: p.length ?? null,
        status: p.status || '',
    };
}

/**
 * Comparador Bling × Woo por SKU.
 * @param {{ search?: string, diff?: string, stock?: string, limit?: number }} opts
 * diff: all | any | stock | photos | price | weight | dimensions | name
 */
export function listCatalogCompare({ search = '', diff = 'any', stock = '', limit = 500 } = {}) {
    const q = String(search || '').trim().toLowerCase();
    const diffFilter = String(diff || 'any').trim().toLowerCase() || 'any';
    const stockFilter = String(stock || '').trim().toLowerCase();
    const lim = Math.min(Math.max(Number(limit) || 500, 1), 5000);

    const blingAll = chatDB.listCatalogProducts('bling');
    const wooAll = chatDB.listCatalogProducts('woo');

    const wooBySku = new Map();
    for (const p of wooAll) {
        const s = normSku(p.sku);
        if (s && !wooBySku.has(s)) wooBySku.set(s, p);
    }
    const blingBySku = new Map();
    for (const p of blingAll) {
        if (!isSellableUnit(p)) continue;
        const s = normSku(p.sku);
        if (s && !blingBySku.has(s)) blingBySku.set(s, p);
    }

    let matched = 0;
    let blingOnly = 0;
    let withDiffs = 0;
    const rows = [];

    for (const [skuKey, b] of blingBySku) {
        const w = wooBySku.get(skuKey) || null;
        if (!w) {
            blingOnly += 1;
            continue;
        }
        matched += 1;
        const diffs = computePairDiffs(b, w);
        if (diffs.length) withDiffs += 1;

        if (diffFilter === 'any' || diffFilter === 'with_diffs') {
            if (!diffs.length) continue;
        } else if (diffFilter === 'all' || diffFilter === '') {
            // include all matched
        } else if (diffFilter === 'photos') {
            if (!diffs.includes('photos') && !diffs.includes('photos_asymmetric')) continue;
        } else if (!diffs.includes(diffFilter)) {
            continue;
        }

        if (stockFilter && stockFilter !== 'all') {
            const qty = b.stockQty;
            const unknown = qty == null || Number.isNaN(Number(qty));
            if (stockFilter === 'unknown' && !unknown) continue;
            if (stockFilter === 'in_stock' && (unknown || Number(qty) <= 0)) continue;
            if (stockFilter === 'out_of_stock' && (unknown || Number(qty) > 0)) continue;
        }

        if (q) {
            const hay = `${b.sku || ''} ${b.name || ''} ${b.externalId || ''} ${w.sku || ''} ${w.name || ''} ${w.externalId || ''}`.toLowerCase();
            if (!hay.includes(q)) continue;
        }

        rows.push({
            sku: b.sku || w.sku || skuKey,
            bling: sideSnapshot(b),
            woo: sideSnapshot(w),
            diffs,
        });
    }

    let wooOnly = 0;
    for (const [skuKey] of wooBySku) {
        if (!blingBySku.has(skuKey)) wooOnly += 1;
    }

    rows.sort((a, b) => (b.diffs.length - a.diffs.length)
        || String(a.sku).localeCompare(String(b.sku)));

    return {
        rows: rows.slice(0, lim),
        total: rows.length,
        truncated: rows.length > lim,
        matched,
        blingOnly,
        wooOnly,
        withDiffs,
        wooCount: wooAll.length,
        blingCount: blingAll.length,
    };
}

export function buildCatalogCompareCsv(filters = {}) {
    const { rows, total, matched, blingOnly, wooOnly, withDiffs } = listCatalogCompare({
        ...filters,
        limit: 5000,
        diff: filters.diff || 'all',
    });
    const header = [
        'SKU',
        'Nome Bling', 'Nome Woo',
        'Estoque Bling', 'Estoque Woo',
        'Fotos Bling', 'Fotos Woo',
        'Preço Bling', 'Preço Woo',
        'Peso Bling', 'Peso Woo',
        'Dims Bling', 'Dims Woo',
        'ID Bling', 'ID Woo',
        'Diffs',
    ].join(';');
    const lines = [header];
    for (const r of rows) {
        const b = r.bling || {};
        const w = r.woo || {};
        const dimsB = (b.height != null && b.width != null && b.length != null)
            ? `${b.height}x${b.width}x${b.length}` : '';
        const dimsW = (w.height != null && w.width != null && w.length != null)
            ? `${w.height}x${w.width}x${w.length}` : '';
        lines.push([
            csvCell(r.sku),
            csvCell(b.name), csvCell(w.name),
            csvCell(b.stockQty ?? ''), csvCell(w.stockQty ?? ''),
            csvCell(b.imageCount ?? ''), csvCell(w.imageCount ?? ''),
            csvCell(b.price ?? ''), csvCell(w.price ?? w.salePrice ?? ''),
            csvCell(b.weight ?? ''), csvCell(w.weight ?? ''),
            csvCell(dimsB), csvCell(dimsW),
            csvCell(b.id), csvCell(w.id),
            csvCell((r.diffs || []).join(',')),
        ].join(';'));
    }
    const note = [
        `# Comparador Bling × Woo`,
        `# Linhas: ${total} · matched: ${matched} · só Bling: ${blingOnly} · só Woo: ${wooOnly} · com diff: ${withDiffs}`,
        `# Gerado em ${new Date().toLocaleString('pt-BR')}`,
    ].join('\n');
    return {
        csv: `\ufeff${note}\n${lines.join('\n')}`,
        count: rows.length,
        filename: `comparador-bling-woo-${new Date().toISOString().slice(0, 10)}.csv`,
    };
}

export default {
    getCatalogDashboard,
    startCatalogScan,
    startCatalogReaudit,
    reauditLocalCatalog,
    getCatalogScan,
    listCatalogIssues,
    claimCatalogProduct,
    renewCatalogProductLock,
    releaseCatalogProduct,
    fixCatalogProduct,
    getCatalogProduct,
    listReviewedCatalogProducts,
    markCatalogProductReviewed,
    listBlingCategories,
    createCatalogCategory,
    refreshCategoryNamesAndReaudit,
    startCategoryResolveJob,
    refreshCatalogProductFromBling,
    deleteCatalogProduct,
    inactivateCatalogProduct,
    inactivateCatalogByCategory,
    listActiveCatalogIdsByCategory,
    bulkCatalogProducts,
    buildCatalogIssuesCsv,
    buildFullCatalogInventoryCsv,
    listOutOfScopeCatalogProducts,
    buildOutOfScopeCatalogCsv,
    classifyCatalogProductScope,
    listCatalogCompare,
    buildCatalogCompareCsv,
    listWooIdCloneProducts,
    buildWooIdClonesCsv,
};
