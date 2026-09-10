/**
 * Fila de conferência física — “Precisa de Goiânia”.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import { logAudit } from '../utils/auditService.js';
import { fixCatalogProduct, getCatalogDashboard } from './catalogQualityService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECKS_DIR = path.join(__dirname, '..', 'uploads', 'catalog_checks');

const ALLOWED_NEED = new Set(['weight', 'dimensions', 'photo', 'identity', 'other']);
const DIGEST_MS = 2 * 60 * 1000;

/** Buffer de digest WhatsApp: { sku, name, externalId, priority }[] */
let digestQueue = [];
let digestTimer = null;

function ensureDir() {
    if (!fs.existsSync(CHECKS_DIR)) fs.mkdirSync(CHECKS_DIR, { recursive: true });
}

function actorName(actor) {
    return String(actor?.name || actor?.email || 'Usuário').trim() || 'Usuário';
}

function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

function normalizeNeed(need) {
    const list = Array.isArray(need) ? need : [];
    const out = [];
    for (const n of list) {
        const k = String(n || '').toLowerCase();
        if (ALLOWED_NEED.has(k) && !out.includes(k)) out.push(k);
    }
    return out;
}

function normalizePriority(p) {
    return String(p || '').toLowerCase() === 'urgent' ? 'urgent' : 'normal';
}

function parseDueAt(body, priority, requestedAt) {
    if (body.dueAt != null && body.dueAt !== '') {
        const n = Number(body.dueAt);
        if (Number.isFinite(n) && n > requestedAt) return n;
    }
    if (body.dueHours != null && body.dueHours !== '') {
        const h = Number(body.dueHours);
        if (Number.isFinite(h) && h > 0) return requestedAt + h * 60 * 60 * 1000;
    }
    return requestedAt + (priority === 'urgent' ? 8 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
}

export function listPhysicalChecks(filters = {}) {
    return chatDB.listPhysicalChecks(filters);
}

export function getPhysicalCheck(id) {
    return chatDB.getPhysicalCheck(id);
}

export function getPhysicalCheckStats() {
    const rows = chatDB.countPhysicalChecksByStatus();
    const by = { pending: 0, answered: 0, applied: 0, cancelled: 0, returned: 0 };
    for (const r of rows) {
        by[r.status] = r.count;
    }
    const overdue = chatDB.countOverduePhysicalChecks();
    return {
        ...by,
        overdue,
        open: (by.pending || 0) + (by.answered || 0),
    };
}

function periodSinceMs(period) {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    if (period === 'today') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }
    if (period === '7d') return now - 7 * day;
    if (period === '30d') return now - 30 * day;
    return 0; // all
}

/** Relatório de concluídos para admin e operador. */
export function getPhysicalCheckCompletedReport(period = '7d') {
    const p = ['today', '7d', '30d', 'all'].includes(period) ? period : '7d';
    const sinceMs = periodSinceMs(p);
    const data = chatDB.getPhysicalCheckCompletedReport({ sinceMs, limit: 300 });
    return {
        period: p,
        sinceMs,
        summary: {
            completed: data.completed,
            answered: data.answered,
            applied: data.applied,
            returned: data.returned,
        },
        byResponder: data.byResponder,
        items: data.items,
    };
}

async function flushGoianiaDigest() {
    const items = digestQueue.splice(0, digestQueue.length);
    digestTimer = null;
    if (!items.length) return;

    const recipients = chatDB.listCatalogNotifyPhones();
    if (!recipients.length) {
        logger.info('Fila Goiânia: digest sem destinatários (cadastre telefone + módulo Fila Goiânia)');
        return;
    }

    const n = items.length;
    const samples = items.slice(0, 3).map((i) => i.sku || i.externalId).filter(Boolean);
    const urgent = items.some((i) => i.priority === 'urgent');
    const sampleLine = samples.length
        ? `📦 *${samples.join('*, *')}*`
        : null;
    const appUrl = (
        process.env.BRAND_VPS_URL
        || process.env.PUBLIC_URL
        || 'https://cristian.vps-kinghost.net'
    ).replace(/\/$/, '');
    const text = [
        urgent ? '🚨 *Fila Goiânia — URGENTE*' : '📍 *Fila Goiânia*',
        n === 1
            ? 'Você tem *1 produto novo* pra conferir.'
            : `Você tem *${n} produtos novos* pra conferir.`,
        sampleLine,
        `👉 Responda pelo *Nexo*: ${appUrl}`,
    ].filter(Boolean).join('\n');

    try {
        const { default: whatsappClient } = await import('./whatsappClient.js');
        for (const r of recipients) {
            try {
                await whatsappClient.sendPrivateMessage(r.phone, text);
            } catch (err) {
                logger.warn(`Fila Goiânia: falha ao notificar ${r.phone}`, err?.message || err);
            }
        }
        logger.info(`Fila Goiânia: digest enviado (${n} pedido(s) → ${recipients.length} número(s))`);
    } catch (err) {
        logger.warn('Fila Goiânia: digest WhatsApp falhou', err?.message || err);
    }
}

function enqueueGoianiaDigest(item) {
    digestQueue.push(item);
    if (digestTimer) return;
    digestTimer = setTimeout(() => {
        flushGoianiaDigest().catch((err) => {
            logger.warn('Fila Goiânia: flush digest', err?.message || err);
        });
    }, DIGEST_MS);
}

/**
 * Cria pedido de conferência física.
 * body: { externalId, need[], requestNote?, sku?, name?, priority?, dueAt?, dueHours? }
 */
export function createPhysicalCheck(body = {}, opts = {}) {
    const externalId = String(body.externalId || '').trim();
    if (!externalId) throw new Error('Informe o ID do produto Bling.');

    const need = normalizeNeed(body.need);
    if (!need.length) {
        throw new Error('Marque o que Goiânia precisa conferir (peso, dimensões, foto…).');
    }

    const product = chatDB.getCatalogProduct('bling', externalId);
    const open = chatDB.countOpenPhysicalChecksForProduct(externalId);
    if (open > 0) {
        const existing = chatDB.listPhysicalChecks({ limit: 200 })
            .find((c) => String(c.externalId) === externalId && (c.status === 'pending' || c.status === 'answered'));
        const err = new Error(
            existing?.status === 'answered'
                ? 'Já existe resposta de Goiânia para este produto. Abra a aba Goiânia e clique em Aplicar no Bling.'
                : 'Já existe um pedido pendente para este produto. Abra a aba Goiânia para ver ou responder.',
        );
        err.status = 409;
        err.existingCheckId = existing?.id || null;
        throw err;
    }

    const actor = opts.actor || {};
    const requestedAt = Date.now();
    const priority = normalizePriority(body.priority);
    const dueAt = parseDueAt(body, priority, requestedAt);

    const check = chatDB.createPhysicalCheck({
        externalId,
        sku: body.sku || product?.sku || '',
        name: body.name || product?.name || '',
        need,
        requestNote: String(body.requestNote || '').trim().slice(0, 1000),
        requestedById: actor.id || '',
        requestedByName: actorName(actor),
        requestedAt,
        status: 'pending',
        priority,
        dueAt,
    });

    logAudit({
        actor,
        action: 'catalog_physical_request',
        targetType: 'catalog_physical_check',
        targetId: check.id,
        summary: `Pedido Goiânia: ${check.sku || externalId} · ${need.join(', ')}${priority === 'urgent' ? ' · urgente' : ''}`,
        meta: { externalId, need, priority, dueAt },
    });

    try {
        enqueueGoianiaDigest({
            sku: check.sku,
            name: check.name,
            externalId: check.externalId,
            priority: check.priority,
        });
    } catch (err) {
        logger.warn('Fila Goiânia: enqueue digest', err?.message || err);
    }

    return check;
}

function saveCheckPhoto(dataUrlOrBase64, checkId) {
    ensureDir();
    let b64 = String(dataUrlOrBase64 || '');
    let ext = 'jpg';
    const m = b64.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    if (m) {
        ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
        b64 = m[2];
    } else {
        b64 = b64.replace(/^data:[^;]+;base64,/, '');
    }
    if (!b64 || b64.length < 32) throw new Error('Foto inválida.');
    if (b64.length > 5_500_000) throw new Error('Foto muito grande (máx. ~4 MB).');

    const filename = `${checkId}_${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`;
    const filePath = path.join(CHECKS_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
    return filename;
}

export function getPhysicalCheckFilePath(filename) {
    const name = path.basename(String(filename || ''));
    if (!name || name.includes('..')) return null;
    const full = path.join(CHECKS_DIR, name);
    if (!full.startsWith(CHECKS_DIR)) return null;
    return full;
}

/**
 * Goiânia responde: peso/dims/foto/nota.
 * body: { responseNote?, weight?, height?, width?, length?, photoBase64? }
 */
export function answerPhysicalCheck(id, body = {}, opts = {}) {
    const check = chatDB.getPhysicalCheck(id);
    if (!check) throw new Error('Pedido não encontrado.');
    if (check.status !== 'pending') {
        throw new Error('Só é possível responder pedidos pendentes.');
    }

    const needsPhoto = (check.need || []).includes('photo');
    let photoFilename = null;
    if (body.photoBase64) {
        photoFilename = saveCheckPhoto(body.photoBase64, check.id);
    } else if (needsPhoto && !check.photoFilename) {
        throw new Error('Este pedido exige foto. Envie a foto da peça/etiqueta.');
    }

    const needsWeight = (check.need || []).includes('weight');
    const needsDims = (check.need || []).includes('dimensions');
    const w = numOrNull(body.weight ?? body.responseWeight);
    const h = numOrNull(body.height ?? body.responseHeight);
    const wi = numOrNull(body.width ?? body.responseWidth);
    const le = numOrNull(body.length ?? body.responseLength);

    if (needsWeight && w == null) {
        throw new Error('Informe o peso (kg).');
    }
    if (needsDims && (h == null || wi == null || le == null)) {
        throw new Error('Informe altura, largura e comprimento (cm).');
    }

    const actor = opts.actor || {};
    const updated = chatDB.answerPhysicalCheck(id, {
        responseNote: String(body.responseNote || '').trim().slice(0, 2000),
        responseWeight: w,
        responseHeight: h,
        responseWidth: wi,
        responseLength: le,
        photoFilename,
        answeredById: actor.id || '',
        answeredByName: actorName(actor),
        answeredAt: Date.now(),
    });

    logAudit({
        actor,
        action: 'catalog_physical_answer',
        targetType: 'catalog_physical_check',
        targetId: id,
        summary: `Resposta Goiânia: ${check.sku || check.externalId}`,
        meta: { externalId: check.externalId, hasPhoto: Boolean(photoFilename || check.photoFilename) },
    });

    return updated;
}

/**
 * Devolver:
 * - mode reopen (default, admin): answered → pending com motivo (refazer)
 * - mode close (operador): pending → returned (não conseguiu)
 */
export function returnPhysicalCheck(id, body = {}, opts = {}) {
    const check = chatDB.getPhysicalCheck(id);
    if (!check) throw new Error('Pedido não encontrado.');

    const reason = String(body.reason || body.returnReason || '').trim();
    if (!reason) throw new Error('Informe o motivo da devolução.');

    const isAdmin = opts.actor?.role === 'superadmin';
    let mode = body.mode === 'close' ? 'close' : 'reopen';

    if (mode === 'reopen') {
        if (!isAdmin) throw new Error('Só o administrador pode devolver para refazer.');
        if (check.status !== 'answered') {
            throw new Error('Só é possível devolver pedidos já respondidos para refazer.');
        }
    } else {
        if (check.status !== 'pending') {
            throw new Error('Só é possível fechar pedidos pendentes como devolvidos.');
        }
    }

    const updated = chatDB.returnPhysicalCheck(id, {
        reason,
        actorId: opts.actor?.id || '',
        actorName: actorName(opts.actor),
        mode,
    });

    logAudit({
        actor: opts.actor,
        action: mode === 'close' ? 'catalog_physical_return_close' : 'catalog_physical_return_reopen',
        targetType: 'catalog_physical_check',
        targetId: id,
        summary: `Devolveu pedido Goiânia (${mode}): ${check.sku || check.externalId}`,
        meta: { reason, mode, externalId: check.externalId },
    });

    return updated;
}

export function cancelPhysicalCheck(id, opts = {}) {
    const check = chatDB.getPhysicalCheck(id);
    if (!check) throw new Error('Pedido não encontrado.');
    if (check.status !== 'pending') throw new Error('Só é possível cancelar pedidos pendentes.');
    const updated = chatDB.cancelPhysicalCheck(id);
    logAudit({
        actor: opts.actor,
        action: 'catalog_physical_cancel',
        targetType: 'catalog_physical_check',
        targetId: id,
        summary: `Cancelou pedido Goiânia: ${check.sku || check.externalId}`,
    });
    return updated;
}

/** Remove o pedido (preenchimento errado / limpar fila). Libera o produto para novo pedido. */
export function deletePhysicalCheck(id, opts = {}) {
    const check = chatDB.getPhysicalCheck(id);
    if (!check) throw new Error('Pedido não encontrado.');
    if (check.status === 'applied') {
        throw new Error('Pedido já aplicado no Bling. Não exclua — corrija o produto em Problemas se precisar.');
    }

    const removed = chatDB.deletePhysicalCheck(id);
    if (check.photoFilename) {
        try {
            const filePath = getPhysicalCheckFilePath(check.photoFilename);
            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (err) {
            logger.warn('Catalog: falha ao apagar foto do pedido', err?.message || err);
        }
    }

    logAudit({
        actor: opts.actor,
        action: 'catalog_physical_delete',
        targetType: 'catalog_physical_check',
        targetId: id,
        summary: `Excluiu pedido Goiânia: ${check.sku || check.externalId} (${check.status})`,
        meta: { externalId: check.externalId, status: check.status },
    });

    return { deleted: true, check: removed, dashboard: getCatalogDashboard() };
}

/**
 * Aplica peso/dims respondidos no Bling e marca como applied.
 */
export async function applyPhysicalCheck(id, opts = {}) {
    const check = chatDB.getPhysicalCheck(id);
    if (!check) throw new Error('Pedido não encontrado.');
    if (check.status !== 'answered') {
        throw new Error('Só é possível aplicar pedidos já respondidos por Goiânia.');
    }

    const patch = {};
    if (check.responseWeight != null) patch.weight = check.responseWeight;
    if (check.responseHeight != null) patch.height = check.responseHeight;
    if (check.responseWidth != null) patch.width = check.responseWidth;
    if (check.responseLength != null) patch.length = check.responseLength;

    if (!Object.keys(patch).length) {
        const updated = chatDB.markPhysicalCheckApplied(id, {
            id: opts.actor?.id,
            name: actorName(opts.actor),
        });
        // Mesmo sem peso/dims, conta como revisado no catálogo
        try {
            chatDB.setCatalogProductReviewStatus('bling', check.externalId, 'done');
        } catch {
            /* ignore */
        }
        return { check: updated, patched: false, dashboard: getCatalogDashboard() };
    }

    const fix = await fixCatalogProduct(check.externalId, patch, { actor: opts.actor });
    const updated = chatDB.markPhysicalCheckApplied(id, {
        id: opts.actor?.id,
        name: actorName(opts.actor),
    });

    logger.info('Catalog physical check applied', { id, externalId: check.externalId, patch });
    return {
        check: updated,
        patched: true,
        product: fix.product,
        remainingIssues: fix.remainingIssues,
        dashboard: fix.dashboard,
    };
}

export function listPhysicalCheckComments(checkId) {
    const check = chatDB.getPhysicalCheck(checkId);
    if (!check) throw new Error('Pedido não encontrado.');
    return chatDB.listPhysicalCheckComments(checkId);
}

export function addPhysicalCheckComment(checkId, body = {}, opts = {}) {
    const check = chatDB.getPhysicalCheck(checkId);
    if (!check) throw new Error('Pedido não encontrado.');
    const text = String(body.body || body.text || '').trim();
    if (!text) throw new Error('Escreva um comentário.');
    const comment = chatDB.addPhysicalCheckComment({
        checkId,
        body: text,
        actorId: opts.actor?.id || '',
        actorName: actorName(opts.actor),
    });
    logAudit({
        actor: opts.actor,
        action: 'catalog_physical_comment',
        targetType: 'catalog_physical_check',
        targetId: checkId,
        summary: `Comentário Goiânia: ${check.sku || check.externalId}`,
        meta: { externalId: check.externalId },
    });
    return comment;
}

export default {
    listPhysicalChecks,
    getPhysicalCheck,
    getPhysicalCheckStats,
    getPhysicalCheckCompletedReport,
    createPhysicalCheck,
    answerPhysicalCheck,
    returnPhysicalCheck,
    cancelPhysicalCheck,
    deletePhysicalCheck,
    applyPhysicalCheck,
    getPhysicalCheckFilePath,
    listPhysicalCheckComments,
    addPhysicalCheckComment,
};
