/**
 * Motor de regras de auditoria do catálogo (extensível).
 * Cada regra: { id, label, priority, run(ctx) => issues[] }
 *
 * Variações Bling (formato V): o pai NÃO é unidade de venda — SKU/peso/etc.
 * ficam nas variações. Pais V são ignorados nas regras de item; filhos são auditados.
 */

import chatDB from '../db/database.js';

const MAX_WEIGHT_KG = 5;

function normSku(sku) {
    return String(sku || '').trim().toLowerCase();
}

function hasText(v) {
    return String(v || '').trim().length > 0;
}

function parseFullRaw(p) {
    try {
        return typeof p?.rawJson === 'string' ? JSON.parse(p.rawJson) : (p?.rawJson || {});
    } catch {
        return {};
    }
}

function productCategoryId(p) {
    const raw = parseFullRaw(p);
    return Number(raw.categoryId || raw.detail?.categoria?.id || 0) || 0;
}

function isPlaceholderCategoryName(name) {
    return /^categoria padr[aã]o$/i.test(String(name || '').trim());
}

function productHasRealCategory(p) {
    const name = String(p.category || '').trim();
    if (name && !isPlaceholderCategoryName(name)) return true;
    const rawName = String(parseFullRaw(p).categoryName || '').trim();
    if (rawName && !isPlaceholderCategoryName(rawName)) return true;
    return false;
}

function parseRaw(p) {
    try {
        const raw = typeof p.rawJson === 'string' ? JSON.parse(p.rawJson) : p.rawJson;
        return raw?.detail || raw?.list || raw || {};
    } catch {
        return {};
    }
}

/** Enriquece formato/parentId/variacoes a partir do raw (sync antigo sem coluna formato). */
function enrichProduct(p) {
    const src = parseRaw(p);
    const formato = String(p.formato || src.formato || '').trim().toUpperCase();
    const parentId = String(p.parentId || src.idProdutoPai || src.produtoPai?.id || '').trim();
    const variacoes = Array.isArray(src.variacoes) ? src.variacoes : [];
    return { ...p, formato, parentId, _variacoes: variacoes };
}

function isInactive(p) {
    const s = String(p.status || '').trim().toUpperCase();
    return s === 'I' || s === 'INATIVO' || s === 'INACTIVE';
}

/** Pai com variações (formato V no Bling). */
function isVariationParent(p) {
    if (String(p.formato || '').toUpperCase() === 'V') return true;
    return Array.isArray(p._variacoes) && p._variacoes.length > 0;
}

/** Unidade vendável: simples/filho — não pai V e não inativo. */
function isSellableUnit(p) {
    if (isInactive(p)) return false;
    if (isVariationParent(p)) return false;
    return true;
}

function variationSkus(p) {
    return (p._variacoes || [])
        .map((v) => String(v.codigo || v.sku || '').trim())
        .filter(Boolean);
}

function issue(partial) {
    return {
        priority: 'medium',
        channel: '',
        externalId: '',
        sku: '',
        name: '',
        message: '',
        meta: null,
        ...partial,
    };
}

function knownStock(v) {
    return v != null && Number.isFinite(Number(v));
}

function knownPositiveDim(v) {
    return v != null && Number.isFinite(Number(v)) && Number(v) > 0;
}

function hasFullDims(p) {
    return knownPositiveDim(p?.height) && knownPositiveDim(p?.width) && knownPositiveDim(p?.length);
}

/**
 * Diffs entre par Bling/Woo (SKU já pareado).
 * @returns {string[]} stock | photos | photos_asymmetric | price | weight | dimensions | name
 */
export function computePairDiffs(bling, woo) {
    const diffs = [];
    if (!bling || !woo) return diffs;

    if (knownStock(bling.stockQty) && knownStock(woo.stockQty)) {
        if (Number(bling.stockQty) !== Number(woo.stockQty)) diffs.push('stock');
    }

    const bi = Number(bling.imageCount) || 0;
    const wi = Number(woo.imageCount) || 0;
    if (bi === 0 && wi > 0) diffs.push('photos_asymmetric');
    else if (bi > 0 && wi > 0 && bi !== wi) diffs.push('photos');

    const bp = Number(bling.price);
    const wp = Number(woo.price ?? woo.salePrice);
    if (Number.isFinite(bp) && Number.isFinite(wp) && Math.abs(bp - wp) >= 0.01) diffs.push('price');

    const bw = Number(bling.weight);
    const ww = Number(woo.weight);
    if (Number.isFinite(bw) && bw > 0 && Number.isFinite(ww) && ww > 0 && Math.abs(bw - ww) >= 0.001) {
        diffs.push('weight');
    }

    if (hasFullDims(bling) && hasFullDims(woo)) {
        if (
            Math.abs(Number(bling.height) - Number(woo.height)) >= 0.1
            || Math.abs(Number(bling.width) - Number(woo.width)) >= 0.1
            || Math.abs(Number(bling.length) - Number(woo.length)) >= 0.1
        ) {
            diffs.push('dimensions');
        }
    }

    const bn = String(bling.name || '').trim().toLowerCase();
    const wn = String(woo.name || '').trim().toLowerCase();
    if (bn && wn && bn !== wn) diffs.push('name');

    return diffs;
}

export { normSku, isSellableUnit, isInactive, isVariationParent };

/** @type {Array<{ id: string, label: string, priority: string, run: Function }>} */
export const CATALOG_RULES = [
    {
        id: 'sku_missing',
        label: 'Sem SKU',
        priority: 'critical',
        run({ bling }) {
            const out = [];
            for (const p of bling) {
                if (isInactive(p)) continue;
                if (isVariationParent(p)) {
                    const vSkus = variationSkus(p);
                    if (vSkus.length > 0) continue;
                    if (normSku(p.sku)) continue;
                    out.push(issue({
                        ruleId: 'sku_missing',
                        priority: 'critical',
                        channel: 'bling',
                        externalId: p.externalId,
                        sku: p.sku,
                        name: p.name,
                        message: 'Produto com variação sem SKU nas variações',
                        meta: { formato: 'V', category: p.category },
                    }));
                    continue;
                }
                if (normSku(p.sku)) continue;
                out.push(issue({
                    ruleId: 'sku_missing',
                    priority: 'critical',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: p.parentId
                        ? 'Variação sem SKU no Bling'
                        : 'Produto sem SKU no Bling',
                    meta: { category: p.category, parentId: p.parentId || null },
                }));
            }
            return out;
        },
    },
    {
        id: 'sku_duplicate',
        label: 'SKU duplicado',
        priority: 'critical',
        run({ bling }) {
            const map = new Map();
            for (const p of bling) {
                if (isInactive(p) || isVariationParent(p)) continue;
                const s = normSku(p.sku);
                if (!s) continue;
                if (!map.has(s)) map.set(s, []);
                map.get(s).push(p);
            }
            const out = [];
            for (const [sku, group] of map) {
                if (group.length < 2) continue;
                for (const p of group) {
                    out.push(issue({
                        ruleId: 'sku_duplicate',
                        priority: 'critical',
                        channel: 'bling',
                        externalId: p.externalId,
                        sku: p.sku,
                        name: p.name,
                        message: `SKU duplicado (${group.length}x): ${sku}`,
                        meta: {
                            occurrences: group.length,
                            ids: group.map((g) => g.externalId),
                        },
                    }));
                }
            }
            return out;
        },
    },
    {
        id: 'weight_missing',
        label: 'Sem peso',
        priority: 'medium',
        run({ bling }) {
            return bling
                .filter((p) => isSellableUnit(p) && (p.weight === null || p.weight === undefined))
                .map((p) => issue({
                    ruleId: 'weight_missing',
                    priority: 'medium',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: 'Produto sem peso cadastrado',
                }));
        },
    },
    {
        id: 'weight_invalid',
        label: 'Peso inválido',
        priority: 'critical',
        run({ bling }) {
            return bling
                .filter((p) => {
                    if (!isSellableUnit(p)) return false;
                    const w = p.weight;
                    if (w === null || w === undefined) return false;
                    return w <= 0 || w > MAX_WEIGHT_KG;
                })
                .map((p) => {
                    const w = p.weight;
                    const reason = w <= 0 ? `peso ${w}` : `peso ${w} kg (> ${MAX_WEIGHT_KG} kg)`;
                    return issue({
                        ruleId: 'weight_invalid',
                        priority: 'critical',
                        channel: 'bling',
                        externalId: p.externalId,
                        sku: p.sku,
                        name: p.name,
                        message: `Peso inválido: ${reason}`,
                        meta: { weight: w, maxKg: MAX_WEIGHT_KG },
                    });
                });
        },
    },
    {
        id: 'price_zero',
        label: 'Preço zerado',
        priority: 'critical',
        run({ bling }) {
            return bling
                .filter((p) => isSellableUnit(p) && !(Number(p.price) > 0))
                .map((p) => issue({
                    ruleId: 'price_zero',
                    priority: 'critical',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: 'Preço zerado ou ausente',
                }));
        },
    },
    {
        id: 'ncm_missing',
        label: 'Sem NCM',
        priority: 'medium',
        run({ bling }) {
            return bling
                .filter((p) => isSellableUnit(p) && !hasText(p.ncm))
                .map((p) => issue({
                    ruleId: 'ncm_missing',
                    priority: 'medium',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: 'NCM ausente',
                    meta: { category: p.category },
                }));
        },
    },
    {
        id: 'category_missing',
        label: 'Sem categoria',
        priority: 'medium',
        run({ bling }) {
            return bling
                .filter((p) => isSellableUnit(p) && !productHasRealCategory(p))
                .map((p) => {
                    const catId = productCategoryId(p);
                    const rawName = String(parseFullRaw(p).categoryName || p.category || '').trim();
                    const isDefault = isPlaceholderCategoryName(rawName);
                    let message = 'Sem categoria no Bling';
                    if (isDefault) {
                        message = 'Categoria padrão do Bling — escolha uma categoria real (ex.: Anéis)';
                    } else if (catId) {
                        message = `Categoria sem nome no snapshot (ID ${catId}) — use Atualizar categorias`;
                    }
                    return issue({
                        ruleId: 'category_missing',
                        priority: 'medium',
                        channel: 'bling',
                        externalId: p.externalId,
                        sku: p.sku,
                        name: p.name,
                        message,
                        meta: { categoryId: catId || undefined, category: rawName || undefined },
                    });
                });
        },
    },
    {
        id: 'brand_missing',
        label: 'Sem marca',
        priority: 'low',
        run({ bling }) {
            return bling
                .filter((p) => isSellableUnit(p) && !hasText(p.brand))
                .map((p) => issue({
                    ruleId: 'brand_missing',
                    priority: 'low',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: 'Sem marca',
                }));
        },
    },
    {
        id: 'description_missing',
        label: 'Sem descrição',
        priority: 'medium',
        run({ bling }) {
            return bling
                .filter((p) => isSellableUnit(p) && !hasText(p.description) && !hasText(p.shortDescription))
                .map((p) => issue({
                    ruleId: 'description_missing',
                    priority: 'medium',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: 'Sem descrição',
                }));
        },
    },
    {
        id: 'photos_missing',
        label: 'Sem fotos',
        priority: 'medium',
        run({ bling }) {
            return bling
                .filter((p) => isSellableUnit(p) && !(Number(p.imageCount) > 0))
                .map((p) => issue({
                    ruleId: 'photos_missing',
                    priority: 'medium',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: 'Sem fotos',
                }));
        },
    },
    {
        id: 'dimensions_missing',
        label: 'Sem dimensões',
        priority: 'medium',
        run({ bling }) {
            return bling
                .filter((p) => isSellableUnit(p) && !(p.height > 0 && p.width > 0 && p.length > 0))
                .map((p) => issue({
                    ruleId: 'dimensions_missing',
                    priority: 'medium',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: 'Dimensões incompletas',
                }));
        },
    },
    {
        id: 'orphan_bling',
        label: 'Só no Bling',
        priority: 'medium',
        run({ bling, wooBySku, wooEnabled }) {
            if (!wooEnabled) return [];
            return bling
                .filter((p) => isSellableUnit(p) && normSku(p.sku) && !wooBySku.has(normSku(p.sku)))
                .map((p) => issue({
                    ruleId: 'orphan_bling',
                    priority: 'medium',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: 'SKU existe no Bling e não no Woo',
                    meta: { category: p.category, status: p.status },
                }));
        },
    },
    {
        id: 'orphan_woo',
        label: 'Só no Woo',
        priority: 'medium',
        run({ woo, blingBySku, wooEnabled }) {
            if (!wooEnabled) return [];
            return woo
                .filter((p) => normSku(p.sku) && !blingBySku.has(normSku(p.sku)))
                .map((p) => issue({
                    ruleId: 'orphan_woo',
                    priority: 'medium',
                    channel: 'woo',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: 'SKU existe no Woo e não no Bling',
                }));
        },
    },
    {
        id: 'stock_divergent',
        label: 'Estoque divergente',
        priority: 'medium',
        run({ bling, wooBySku, wooEnabled }) {
            if (!wooEnabled) return [];
            const out = [];
            for (const p of bling) {
                if (!isSellableUnit(p) || !normSku(p.sku)) continue;
                const w = wooBySku.get(normSku(p.sku));
                if (!w) continue;
                if (!knownStock(p.stockQty) || !knownStock(w.stockQty)) continue;
                if (Number(p.stockQty) === Number(w.stockQty)) continue;
                out.push(issue({
                    ruleId: 'stock_divergent',
                    priority: 'medium',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: `Estoque Bling ${p.stockQty} ≠ Woo ${w.stockQty}`,
                    meta: { blingStock: p.stockQty, wooStock: w.stockQty },
                }));
            }
            return out;
        },
    },
    {
        id: 'photos_asymmetric',
        label: 'Sem foto no Bling (tem no Woo)',
        priority: 'medium',
        run({ bling, wooBySku, wooEnabled }) {
            if (!wooEnabled) return [];
            const out = [];
            for (const p of bling) {
                if (!isSellableUnit(p) || !normSku(p.sku)) continue;
                const w = wooBySku.get(normSku(p.sku));
                if (!w) continue;
                const bi = Number(p.imageCount) || 0;
                const wi = Number(w.imageCount) || 0;
                if (!(bi === 0 && wi > 0)) continue;
                out.push(issue({
                    ruleId: 'photos_asymmetric',
                    priority: 'medium',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: `Sem fotos no Bling · Woo tem ${wi}`,
                    meta: { blingImages: bi, wooImages: wi },
                }));
            }
            return out;
        },
    },
    {
        id: 'photos_divergent',
        label: 'Qtd. fotos diverge',
        priority: 'low',
        run({ bling, wooBySku, wooEnabled }) {
            if (!wooEnabled) return [];
            const out = [];
            for (const p of bling) {
                if (!isSellableUnit(p) || !normSku(p.sku)) continue;
                const w = wooBySku.get(normSku(p.sku));
                if (!w) continue;
                const bi = Number(p.imageCount) || 0;
                const wi = Number(w.imageCount) || 0;
                if (!(bi > 0 && wi > 0 && bi !== wi)) continue;
                out.push(issue({
                    ruleId: 'photos_divergent',
                    priority: 'low',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: `Fotos Bling ${bi} ≠ Woo ${wi}`,
                    meta: { blingImages: bi, wooImages: wi },
                }));
            }
            return out;
        },
    },
    {
        id: 'weight_divergent',
        label: 'Peso divergente',
        priority: 'low',
        run({ bling, wooBySku, wooEnabled }) {
            if (!wooEnabled) return [];
            const out = [];
            for (const p of bling) {
                if (!isSellableUnit(p) || !normSku(p.sku)) continue;
                const w = wooBySku.get(normSku(p.sku));
                if (!w) continue;
                const bw = Number(p.weight);
                const ww = Number(w.weight);
                if (!(Number.isFinite(bw) && bw > 0 && Number.isFinite(ww) && ww > 0)) continue;
                if (Math.abs(bw - ww) < 0.001) continue;
                out.push(issue({
                    ruleId: 'weight_divergent',
                    priority: 'low',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: `Peso Bling ${bw} kg ≠ Woo ${ww} kg`,
                    meta: { blingWeight: bw, wooWeight: ww },
                }));
            }
            return out;
        },
    },
    {
        id: 'dimensions_divergent',
        label: 'Dimensões divergentes',
        priority: 'low',
        run({ bling, wooBySku, wooEnabled }) {
            if (!wooEnabled) return [];
            const out = [];
            for (const p of bling) {
                if (!isSellableUnit(p) || !normSku(p.sku)) continue;
                const w = wooBySku.get(normSku(p.sku));
                if (!w) continue;
                if (!hasFullDims(p) || !hasFullDims(w)) continue;
                if (
                    Math.abs(Number(p.height) - Number(w.height)) < 0.1
                    && Math.abs(Number(p.width) - Number(w.width)) < 0.1
                    && Math.abs(Number(p.length) - Number(w.length)) < 0.1
                ) continue;
                out.push(issue({
                    ruleId: 'dimensions_divergent',
                    priority: 'low',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: `Dims Bling ${p.height}×${p.width}×${p.length} ≠ Woo ${w.height}×${w.width}×${w.length}`,
                    meta: {
                        bling: { h: p.height, w: p.width, l: p.length },
                        woo: { h: w.height, w: w.width, l: w.length },
                    },
                }));
            }
            return out;
        },
    },
    {
        id: 'price_divergent',
        label: 'Preço divergente',
        priority: 'medium',
        run({ bling, wooBySku, wooEnabled }) {
            if (!wooEnabled) return [];
            const out = [];
            for (const p of bling) {
                if (!isSellableUnit(p) || !normSku(p.sku)) continue;
                const w = wooBySku.get(normSku(p.sku));
                if (!w) continue;
                const bp = Number(p.price);
                const wp = Number(w.price ?? w.salePrice);
                if (!Number.isFinite(bp) || !Number.isFinite(wp)) continue;
                if (Math.abs(bp - wp) < 0.01) continue;
                out.push(issue({
                    ruleId: 'price_divergent',
                    priority: 'medium',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: `Preço Bling ${bp} ≠ Woo ${wp}`,
                    meta: { blingPrice: bp, wooPrice: wp },
                }));
            }
            return out;
        },
    },
    {
        id: 'name_divergent',
        label: 'Nome divergente',
        priority: 'low',
        run({ bling, wooBySku, wooEnabled }) {
            if (!wooEnabled) return [];
            const out = [];
            for (const p of bling) {
                if (!isSellableUnit(p) || !normSku(p.sku)) continue;
                const w = wooBySku.get(normSku(p.sku));
                if (!w) continue;
                const bn = String(p.name || '').trim().toLowerCase();
                const wn = String(w.name || '').trim().toLowerCase();
                if (!bn || !wn || bn === wn) continue;
                out.push(issue({
                    ruleId: 'name_divergent',
                    priority: 'low',
                    channel: 'bling',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: 'Nome diferente entre Bling e Woo',
                    meta: { wooName: w.name },
                }));
            }
            return out;
        },
    },
    {
        id: 'seo_missing',
        label: 'SEO ausente (Woo)',
        priority: 'low',
        run({ woo, wooEnabled }) {
            if (!wooEnabled) return [];
            return woo
                .filter((p) => !hasText(p.shortDescription) && !hasText(p.seoDescription))
                .map((p) => issue({
                    ruleId: 'seo_missing',
                    priority: 'low',
                    channel: 'woo',
                    externalId: p.externalId,
                    sku: p.sku,
                    name: p.name,
                    message: 'SEO / descrição curta ausente no Woo',
                }));
        },
    },
];

export function runCatalogAudit(scanId) {
    const bling = chatDB.listCatalogProducts('bling').map(enrichProduct);
    const woo = chatDB.listCatalogProducts('woo');
    const wooEnabled = woo.length > 0;

    const blingBySku = new Map();
    for (const p of bling) {
        if (isInactive(p) || isVariationParent(p)) continue;
        const s = normSku(p.sku);
        if (s && !blingBySku.has(s)) blingBySku.set(s, p);
    }
    const wooBySku = new Map();
    for (const p of woo) {
        const s = normSku(p.sku);
        if (s && !wooBySku.has(s)) wooBySku.set(s, p);
    }

    const ctx = { bling, woo, blingBySku, wooBySku, wooEnabled };
    chatDB.clearCatalogIssues();

    let issueCount = 0;
    const byRule = {};

    const wooOnlyRules = new Set([
        'orphan_bling',
        'orphan_woo',
        'price_divergent',
        'name_divergent',
        'seo_missing',
        'stock_divergent',
        'photos_asymmetric',
        'photos_divergent',
        'weight_divergent',
        'dimensions_divergent',
    ]);

    for (const rule of CATALOG_RULES) {
        if (!wooEnabled && wooOnlyRules.has(rule.id)) {
            byRule[rule.id] = 0;
            continue;
        }
        const found = rule.run(ctx) || [];
        byRule[rule.id] = found.length;
        for (const iss of found) {
            chatDB.insertCatalogIssue({
                ...iss,
                ruleId: rule.id,
                priority: iss.priority || rule.priority,
                scanId,
            });
            issueCount += 1;
        }
    }

    const productIdsWithIssues = new Set(
        chatDB.listCatalogIssues({ limit: 100000 }).map((i) => `${i.channel}:${i.externalId}`)
    );
    const sellable = bling.filter(isSellableUnit);
    const analyzed = sellable.length;
    const withProblems = sellable.filter((p) => productIdsWithIssues.has(`bling:${p.externalId}`)).length;

    return {
        issueCount,
        byRule,
        analyzed,
        withProblems,
        withoutProblems: Math.max(0, analyzed - withProblems),
        blingCount: bling.length,
        wooCount: woo.length,
        wooEnabled,
        rules: CATALOG_RULES.map((r) => ({
            id: r.id,
            label: r.label,
            priority: r.priority,
            count: byRule[r.id] || 0,
            skipped: !wooEnabled && wooOnlyRules.has(r.id),
        })),
    };
}

export default { CATALOG_RULES, runCatalogAudit, computePairDiffs, normSku };
