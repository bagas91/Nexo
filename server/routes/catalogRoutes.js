/**
 * API — Qualidade do Catálogo
 */

import express from 'express';
import { requireSuperadmin, requireModule } from '../middleware/authMiddleware.js';
import {
    getCatalogDashboard,
    startCatalogScan,
    startCatalogReaudit,
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
    listCatalogCompare,
    buildCatalogCompareCsv,
    listWooIdCloneProducts,
    buildWooIdClonesCsv,
} from '../services/catalogQualityService.js';
import {
    listPhotoImportCandidates,
    startPhotoImportJob,
    getPhotoImportJob,
    cancelPhotoImportJob,
} from '../services/catalogPhotoImportService.js';
import {
    listImageOptimizeCandidates,
    startImageOptimizeScan,
    startImageOptimizeJob,
    getImageOptimizeJob,
    cancelImageOptimizeJob,
    getOptimizedImagePath,
} from '../services/catalogImageOptimizeService.js';
import {
    suggestCatalogProductFields,
    startBulkCatalogAiSuggest,
    getBulkCatalogAiSuggestJob,
    cancelBulkCatalogAiSuggest,
    listCatalogAiDrafts,
    updateCatalogAiDraftFields,
    discardCatalogAiDraft,
    discardCatalogAiDraftsBulk,
    applyCatalogAiDraft,
    applyCatalogAiDraftsBulk,
} from '../services/catalogAiSuggestService.js';
import {
    listPhysicalChecks,
    getPhysicalCheck,
    createPhysicalCheck,
    answerPhysicalCheck,
    cancelPhysicalCheck,
    applyPhysicalCheck,
    getPhysicalCheckFilePath,
    getPhysicalCheckStats,
    getPhysicalCheckCompletedReport,
    deletePhysicalCheck,
    returnPhysicalCheck,
    listPhysicalCheckComments,
    addPhysicalCheckComment,
} from '../services/catalogPhysicalCheckService.js';
import { CATALOG_RULES } from '../services/catalogAuditEngine.js';
import logger from '../utils/logger.js';
import fs from 'fs';

const router = express.Router();

router.get('/dashboard', requireModule('catalog_quality'), (req, res) => {
    try {
        res.json(getCatalogDashboard());
    } catch (err) {
        logger.error('Catalog dashboard', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.get('/rules', requireModule('catalog_quality'), (_req, res) => {
    res.json(CATALOG_RULES.map((r) => ({ id: r.id, label: r.label, priority: r.priority })));
});

router.get('/issues', requireModule('catalog_quality'), (req, res) => {
    try {
        const ruleId = req.query.ruleId || undefined;
        const priority = req.query.priority || undefined;
        const stock = req.query.stock ? String(req.query.stock) : undefined;
        const category = req.query.category ? String(req.query.category) : undefined;
        const hasFilter = Boolean(stock || category);
        const limit = Math.min(Number(req.query.limit) || 200, hasFilter ? 5000 : 2000);
        res.json(listCatalogIssues({
            ruleId,
            priority,
            stock,
            category,
            limit,
            viewerUserId: req.user?.id,
        }));
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

/** CSV de problemas (Excel BR). Query: ruleId, priority, stock, category */
router.get('/export', requireModule('catalog_quality'), (req, res) => {
    try {
        const ruleId = req.query.ruleId ? String(req.query.ruleId) : undefined;
        const priority = req.query.priority ? String(req.query.priority) : undefined;
        const stock = req.query.stock ? String(req.query.stock) : undefined;
        const category = req.query.category ? String(req.query.category) : undefined;
        const { csv, filename, count } = buildCatalogIssuesCsv({ ruleId, priority, stock, category });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Export-Count', String(count));
        res.send(csv);
    } catch (err) {
        logger.error('Catalog export', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

/** Inventário completo: todos os produtos Bling + coluna de problemas (ou ok). */
router.get('/inventory.csv', requireModule('catalog_quality'), (req, res) => {
    try {
        const { csv, count, filename, withProblems, withoutProblems } = buildFullCatalogInventoryCsv({
            status: req.query.status ? String(req.query.status) : '',
            stock: req.query.stock ? String(req.query.stock) : '',
            scope: req.query.scope ? String(req.query.scope) : '',
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Export-Count', String(count));
        if (withProblems != null) res.setHeader('X-With-Problems', String(withProblems));
        if (withoutProblems != null) res.setHeader('X-Without-Problems', String(withoutProblems));
        res.send(csv);
    } catch (err) {
        logger.error('Catalog inventory CSV', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

/** Produtos fora do escopo (não semijoia / não Bíblia) — conferência de fantasmas. */
router.get('/out-of-scope', requireModule('catalog_quality'), (req, res) => {
    try {
        const data = listOutOfScopeCatalogProducts({
            search: req.query.search ? String(req.query.search) : '',
            q: req.query.q ? String(req.query.q) : '',
            category: req.query.category ? String(req.query.category) : '',
            stock: req.query.stock ? String(req.query.stock) : '',
            limit: req.query.limit,
        });
        res.json(data);
    } catch (err) {
        logger.error('Catalog out-of-scope', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.get('/out-of-scope.csv', requireModule('catalog_quality'), (req, res) => {
    try {
        const { csv, count, filename } = buildOutOfScopeCatalogCsv({
            search: req.query.search ? String(req.query.search) : '',
            q: req.query.q ? String(req.query.q) : '',
            category: req.query.category ? String(req.query.category) : '',
            stock: req.query.stock ? String(req.query.stock) : '',
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Export-Count', String(count));
        res.send(csv);
    } catch (err) {
        logger.error('Catalog out-of-scope CSV', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

/** Comparador Bling × Woo por SKU. */
router.get('/compare', requireModule('catalog_quality'), (req, res) => {
    try {
        const data = listCatalogCompare({
            search: req.query.search ? String(req.query.search) : '',
            diff: req.query.diff ? String(req.query.diff) : 'any',
            stock: req.query.stock ? String(req.query.stock) : '',
            limit: req.query.limit,
        });
        res.json(data);
    } catch (err) {
        logger.error('Catalog compare', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.get('/compare.csv', requireModule('catalog_quality'), (req, res) => {
    try {
        const { csv, count, filename } = buildCatalogCompareCsv({
            search: req.query.search ? String(req.query.search) : '',
            diff: req.query.diff ? String(req.query.diff) : 'all',
            stock: req.query.stock ? String(req.query.stock) : '',
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Export-Count', String(count));
        res.send(csv);
    } catch (err) {
        logger.error('Catalog compare CSV', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

/** Clones: Woo SKU=ID + espelho no Bling × SKU real (mesmo nome). */
router.get('/woo-id-clones', requireModule('catalog_quality'), (req, res) => {
    try {
        const data = listWooIdCloneProducts({
            search: req.query.search ? String(req.query.search) : '',
            q: req.query.q ? String(req.query.q) : '',
            confidence: req.query.confidence ? String(req.query.confidence) : '',
            cloneStatus: req.query.cloneStatus ? String(req.query.cloneStatus) : 'active',
            limit: req.query.limit,
        });
        res.json(data);
    } catch (err) {
        logger.error('Catalog woo-id-clones', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.get('/woo-id-clones.csv', requireModule('catalog_quality'), (req, res) => {
    try {
        const { csv, count, filename } = buildWooIdClonesCsv({
            search: req.query.search ? String(req.query.search) : '',
            q: req.query.q ? String(req.query.q) : '',
            confidence: req.query.confidence ? String(req.query.confidence) : '',
            cloneStatus: req.query.cloneStatus ? String(req.query.cloneStatus) : 'active',
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Export-Count', String(count));
        res.send(csv);
    } catch (err) {
        logger.error('Catalog woo-id-clones CSV', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

/** Importação em massa: fotos Woo → Bling (só sem foto no Bling). */
router.get('/photo-import/candidates', requireSuperadmin, (req, res) => {
    try {
        const data = listPhotoImportCandidates({ limit: req.query.limit });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.get('/photo-import/job', requireSuperadmin, (_req, res) => {
    res.json({ job: getPhotoImportJob() });
});

router.post('/photo-import/start', requireSuperadmin, (req, res) => {
    try {
        const result = startPhotoImportJob({
            limit: req.body?.limit,
            delayMs: req.body?.delayMs,
            dryRun: req.body?.dryRun === true,
            actor: req.user,
        });
        res.json(result);
    } catch (err) {
        logger.error('Photo import start', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.post('/photo-import/cancel', requireSuperadmin, (_req, res) => {
    res.json(cancelPhotoImportJob());
});

/** Imagens públicas otimizadas (Bling baixa sem auth). */
router.get('/optimized-images/:filename', (req, res) => {
    try {
        const filePath = getOptimizedImagePath(req.params.filename);
        if (!filePath) return res.status(404).json({ error: 'Arquivo não encontrado' });
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.type('image/webp');
        res.sendFile(filePath);
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

/** Varredura / otimização de imagens pesadas (Bling → Woo). */
router.get('/image-optimize/candidates', requireSuperadmin, (req, res) => {
    try {
        const data = listImageOptimizeCandidates({
            source: req.query.source,
            limit: req.query.limit,
        });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.get('/image-optimize/job', requireSuperadmin, (_req, res) => {
    res.json({ job: getImageOptimizeJob() });
});

router.post('/image-optimize/scan', requireSuperadmin, (req, res) => {
    try {
        const result = startImageOptimizeScan({
            minPx: req.body?.minPx,
            minBytes: req.body?.minBytes,
            source: req.body?.source,
            limit: req.body?.limit,
            actor: req.user,
        });
        res.json(result);
    } catch (err) {
        logger.error('Image optimize scan start', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.post('/image-optimize/start', requireSuperadmin, (req, res) => {
    try {
        const result = startImageOptimizeJob({
            blingIds: req.body?.blingIds,
            dryRun: req.body?.dryRun === true,
            delayMs: req.body?.delayMs,
            actor: req.user,
        });
        if (result.error) return res.status(400).json(result);
        res.json(result);
    } catch (err) {
        logger.error('Image optimize start', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.post('/image-optimize/cancel', requireSuperadmin, (_req, res) => {
    res.json(cancelImageOptimizeJob());
});

router.get('/products/:id', requireModule('catalog_quality'), (req, res) => {
    const product = getCatalogProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Produto não encontrado no snapshot local. Rode Verificar Catálogo.' });
    res.json(product);
});

router.post('/products/:id/refresh', requireSuperadmin, async (req, res) => {
    try {
        const result = await refreshCatalogProductFromBling(req.params.id, { actor: req.user });
        res.json({ success: true, ...result });
    } catch (err) {
        logger.error('Catalog refresh product', err?.message || err);
        res.status(400).json({ error: err?.message || String(err) });
    }
});

/** Lista produtos já revisados (reviewStatus = done). */
router.get('/reviewed-products', requireModule('catalog_quality'), (req, res) => {
    try {
        const search = req.query.search ? String(req.query.search) : '';
        const limit = Math.min(Number(req.query.limit) || 500, 2000);
        res.json(listReviewedCatalogProducts({ search, limit }));
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.post('/products/:id/mark-reviewed', requireSuperadmin, (req, res) => {
    try {
        const result = markCatalogProductReviewed(req.params.id, { actor: req.user });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.get('/categories', requireModule('catalog_quality'), async (req, res) => {
    try {
        const categories = await listBlingCategories();
        res.json({ categories });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.post('/categories', requireSuperadmin, async (req, res) => {
    try {
        const category = await createCatalogCategory(req.body || {}, { actor: req.user });
        res.json({ success: true, category });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

/** Resolve nomes de categoria no snapshot, atualiza cadastros em “Categoria padrão” e reaudita. */
router.post('/categories/resolve-names', requireSuperadmin, async (req, res) => {
    try {
        const result = await startCategoryResolveJob();
        res.json({ success: true, ...result });
    } catch (err) {
        logger.error('Catalog resolve categories', err?.message || err);
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.post('/products/:id/claim', requireSuperadmin, (req, res) => {
    try {
        const result = claimCatalogProduct(req.params.id, {
            actor: req.user,
            force: req.body?.force === true,
        });
        res.json(result);
    } catch (err) {
        const status = err?.status || 400;
        res.status(status).json({ error: err?.message || String(err), lock: err?.lock || null });
    }
});

router.post('/products/:id/heartbeat', requireSuperadmin, (req, res) => {
    try {
        const result = renewCatalogProductLock(req.params.id, { actor: req.user });
        res.json(result);
    } catch (err) {
        const status = err?.status || 400;
        res.status(status).json({ error: err?.message || String(err), lock: err?.lock || null });
    }
});

router.post('/products/:id/release', requireSuperadmin, (req, res) => {
    try {
        const result = releaseCatalogProduct(req.params.id, {
            actor: req.user,
            force: req.body?.force === true,
        });
        res.json(result);
    } catch (err) {
        const status = err?.status || 400;
        res.status(status).json({ error: err?.message || String(err) });
    }
});

router.patch('/products/:id', requireSuperadmin, async (req, res) => {
    try {
        const result = await fixCatalogProduct(req.params.id, req.body || {}, { actor: req.user });
        res.json({ success: true, ...result });
    } catch (err) {
        logger.error('Catalog fix product', err?.message || err);
        res.status(400).json({ error: err?.message || String(err) });
    }
});

/** Sugestões de IA (NCM / peso / dims) — grava rascunho; não aplica no Bling. */
router.post('/products/:id/suggest', requireSuperadmin, async (req, res) => {
    try {
        const { fields, name, sku, provider, saveDraft } = req.body || {};
        const result = await suggestCatalogProductFields(req.params.id, {
            fields,
            name,
            sku,
            provider: provider || 'openai',
            saveDraft: saveDraft !== false,
        });
        res.json({ success: true, ...result });
    } catch (err) {
        const status = err?.status || (/não configurada/i.test(String(err?.message || '')) ? 503 : 400);
        logger.error('Catalog AI suggest', err?.message || err);
        res.status(status).json({ error: err?.message || String(err) });
    }
});

/** Rascunhos IA (pendentes de conferência). */
router.get('/ai-drafts', requireSuperadmin, (req, res) => {
    try {
        const status = req.query.status ? String(req.query.status) : 'pending';
        const limit = Number(req.query.limit) || 200;
        res.json({ success: true, ...listCatalogAiDrafts({ status, limit }) });
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.get('/ai-drafts/job', requireSuperadmin, (_req, res) => {
    res.json({ job: getBulkCatalogAiSuggestJob() });
});

router.post('/ai-drafts/cancel', requireSuperadmin, (_req, res) => {
    res.json(cancelBulkCatalogAiSuggest());
});

/** Gera rascunhos em massa (ChatGPT) — não manda ao Bling. */
router.post('/ai-drafts/suggest-bulk', requireSuperadmin, (req, res) => {
    try {
        const result = startBulkCatalogAiSuggest({
            externalIds: req.body?.externalIds || req.body?.ids || [],
            fields: req.body?.fields,
            provider: req.body?.provider || 'openai',
            actor: req.user,
        });
        if (result.error) return res.status(400).json(result);
        res.json(result);
    } catch (err) {
        logger.error('Catalog AI suggest bulk', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.post('/ai-drafts/apply-bulk', requireSuperadmin, async (req, res) => {
    try {
        const ids = req.body?.ids || [];
        const result = await applyCatalogAiDraftsBulk(ids, { actor: req.user });
        res.json({ success: true, ...result, pending: listCatalogAiDrafts({ status: 'pending' }).pending });
    } catch (err) {
        logger.error('Catalog AI draft apply bulk', err?.message || err);
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.post('/ai-drafts/discard-bulk', requireSuperadmin, (req, res) => {
    try {
        const ids = req.body?.ids || [];
        const result = discardCatalogAiDraftsBulk(ids, { actor: req.user });
        res.json({ success: true, ...result, pending: listCatalogAiDrafts({ status: 'pending' }).pending });
    } catch (err) {
        const status = err?.status || 400;
        res.status(status).json({ error: err?.message || String(err) });
    }
});

router.patch('/ai-drafts/:id', requireSuperadmin, (req, res) => {
    try {
        const draft = updateCatalogAiDraftFields(req.params.id, req.body || {});
        res.json({ success: true, draft });
    } catch (err) {
        const status = err?.status || 400;
        res.status(status).json({ error: err?.message || String(err) });
    }
});

router.post('/ai-drafts/:id/discard', requireSuperadmin, (req, res) => {
    try {
        const draft = discardCatalogAiDraft(req.params.id);
        res.json({ success: true, draft });
    } catch (err) {
        const status = err?.status || 400;
        res.status(status).json({ error: err?.message || String(err) });
    }
});

/** Aplica no Bling após conferência. */
router.post('/ai-drafts/:id/apply', requireSuperadmin, async (req, res) => {
    try {
        const result = await applyCatalogAiDraft(req.params.id, {
            actor: req.user,
            edited: req.body?.edited,
        });
        res.json({ success: true, ...result });
    } catch (err) {
        logger.error('Catalog AI draft apply', err?.message || err);
        res.status(err?.status || 400).json({ error: err?.message || String(err) });
    }
});
router.delete('/products/:id', requireSuperadmin, async (req, res) => {
    try {
        const result = await deleteCatalogProduct(req.params.id, { actor: req.user });
        res.json({ success: true, ...result });
    } catch (err) {
        logger.error('Catalog delete product', err?.message || err);
        res.status(400).json({ error: err?.message || String(err), code: 'DELETE_BLOCKED' });
    }
});

/** Inativa no Bling (alternativa quando DELETE é bloqueado). */
router.post('/products/:id/inactivate', requireModule('catalog_quality'), async (req, res) => {
    try {
        const result = await inactivateCatalogProduct(req.params.id, { actor: req.user });
        res.json({ success: true, ...result });
    } catch (err) {
        logger.error('Catalog inactivate product', err?.message || err);
        res.status(400).json({ error: err?.message || String(err) });
    }
});

/** Ação em massa: { action: 'inactivate'|'delete', ids: string[], fallbackInactivate?: boolean } */
router.post('/products/bulk', requireModule('catalog_quality'), async (req, res) => {
    try {
        const { action, ids, fallbackInactivate } = req.body || {};
        if (action !== 'inactivate' && action !== 'delete') {
            return res.status(400).json({ error: 'Informe action: inactivate ou delete.' });
        }
        if (action === 'delete' && req.user?.role !== 'superadmin') {
            return res.status(403).json({ error: 'Exclusão restrita ao administrador. Use inativar.' });
        }
        const result = await bulkCatalogProducts(action, ids || [], {
            actor: req.user,
            fallbackInactivate: fallbackInactivate !== false,
        });
        res.json({ success: true, ...result });
    } catch (err) {
        logger.error('Catalog bulk', err?.message || err);
        res.status(400).json({ error: err?.message || String(err) });
    }
});

/** Lista IDs ativos por categoria (para inativar em lotes no front). */
router.get('/products/ids-by-category', requireModule('catalog_quality'), (req, res) => {
    try {
        const category = String(req.query.category || req.query.categoria || '').trim();
        if (!category) return res.status(400).json({ error: 'Informe category.' });
        res.json({ success: true, ...listActiveCatalogIdsByCategory(category) });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

/** Inativa todos os ativos do snapshot na categoria (Bling). Preferir lotes via ids-by-category. */
router.post('/products/inactivate-by-category', requireModule('catalog_quality'), async (req, res) => {
    try {
        const category = String(req.body?.category || req.body?.categoria || '').trim();
        if (!category) return res.status(400).json({ error: 'Informe category.' });
        const result = await inactivateCatalogByCategory(category, { actor: req.user });
        res.json({ success: true, ...result });
    } catch (err) {
        logger.error('Catalog inactivate by category', err?.message || err);
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.get('/scan/latest', requireModule('catalog_quality'), (_req, res) => {
    try {
        const dash = getCatalogDashboard();
        res.json(dash.latestScan || null);
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.get('/scan/:id', requireModule('catalog_quality'), (req, res) => {
    const scan = getCatalogScan(req.params.id);
    if (!scan) return res.status(404).json({ error: 'Scan não encontrado' });
    res.json(scan);
});

router.post('/scan', requireSuperadmin, async (req, res) => {
    try {
        const syncWoo = req.body?.syncWoo === true;
        const result = await startCatalogScan({ syncBling: true, syncWoo });
        res.json(result);
    } catch (err) {
        logger.error('Catalog scan start', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

/** Reaplica regras no snapshot local (sem sync Bling) — assíncrono. */
router.post('/reaudit', requireSuperadmin, async (req, res) => {
    try {
        const result = await startCatalogReaudit();
        res.json({
            success: true,
            alreadyRunning: result.alreadyRunning,
            scan: result.scan,
            dashboard: getCatalogDashboard(),
        });
    } catch (err) {
        logger.error('Catalog reaudit', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

/** Fila Goiânia — conferência física
 * Operador (módulo catalog): listar + responder + comentar + devolver (fechar).
 * Superadmin: criar / cancelar / excluir / aplicar / devolver para refazer.
 */
router.get('/checks', requireModule('catalog'), (req, res) => {
    try {
        const status = req.query.status ? String(req.query.status) : undefined;
        const externalId = req.query.externalId ? String(req.query.externalId) : undefined;
        const overdue = req.query.overdue === '1' || req.query.overdue === 'true';
        const limit = Math.min(Number(req.query.limit) || 200, 1000);
        res.json({
            checks: listPhysicalChecks({ status, externalId, overdue: overdue || undefined, limit }),
            stats: getPhysicalCheckStats(),
        });
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

/** Relatório de concluídos — admin e operador (módulo catalog). */
router.get('/checks/completed-report', requireModule('catalog'), (req, res) => {
    try {
        const period = req.query.period ? String(req.query.period) : '7d';
        res.json(getPhysicalCheckCompletedReport(period));
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.get('/checks/:id', requireModule('catalog'), (req, res) => {
    const check = getPhysicalCheck(req.params.id);
    if (!check) return res.status(404).json({ error: 'Pedido não encontrado' });
    res.json(check);
});

router.get('/checks/:id/comments', requireModule('catalog'), (req, res) => {
    try {
        res.json({ comments: listPhysicalCheckComments(req.params.id) });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.post('/checks/:id/comments', requireModule('catalog'), (req, res) => {
    try {
        const comment = addPhysicalCheckComment(req.params.id, req.body || {}, { actor: req.user });
        res.json({ success: true, comment });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.post('/checks', requireSuperadmin, (req, res) => {
    try {
        const check = createPhysicalCheck(req.body || {}, { actor: req.user });
        res.json({ success: true, check, dashboard: getCatalogDashboard() });
    } catch (err) {
        const status = err?.status || 400;
        res.status(status).json({
            error: err?.message || String(err),
            existingCheckId: err?.existingCheckId || null,
        });
    }
});

router.post('/checks/:id/answer', requireModule('catalog'), (req, res) => {
    try {
        const check = answerPhysicalCheck(req.params.id, req.body || {}, { actor: req.user });
        const payload = { success: true, check };
        if (req.user?.role === 'superadmin') {
            payload.dashboard = getCatalogDashboard();
        }
        res.json(payload);
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.post('/checks/:id/return', requireModule('catalog'), (req, res) => {
    try {
        // Operador só pode mode=close; admin pode reopen (default) ou close
        const body = { ...(req.body || {}) };
        if (req.user?.role !== 'superadmin') {
            body.mode = 'close';
        }
        const check = returnPhysicalCheck(req.params.id, body, { actor: req.user });
        const payload = { success: true, check };
        if (req.user?.role === 'superadmin') {
            payload.dashboard = getCatalogDashboard();
        }
        res.json(payload);
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.post('/checks/:id/cancel', requireSuperadmin, (req, res) => {
    try {
        const check = cancelPhysicalCheck(req.params.id, { actor: req.user });
        res.json({ success: true, check, dashboard: getCatalogDashboard() });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.delete('/checks/:id', requireSuperadmin, (req, res) => {
    try {
        const result = deletePhysicalCheck(req.params.id, { actor: req.user });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.post('/checks/:id/apply', requireSuperadmin, async (req, res) => {
    try {
        const result = await applyPhysicalCheck(req.params.id, { actor: req.user });
        res.json({ success: true, ...result });
    } catch (err) {
        logger.error('Catalog apply physical check', err?.message || err);
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.get('/check-files/:filename', requireModule('catalog'), (req, res) => {
    try {
        const filePath = getPhysicalCheckFilePath(req.params.filename);
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Arquivo não encontrado' });
        }
        res.sendFile(filePath);
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

export default router;
