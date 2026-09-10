/**
 * Sync de catálogo Bling + WooCommerce → SQLite local.
 */

import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import {
    ensureValidBlingToken,
    fetchBlingProductsPage,
    fetchBlingProduct,
    fetchBlingProductCategories,
    fetchBlingProductCategoryById,
    fetchBlingStoreCategories,
} from './blingService.js';
import { getWooCredentials, fetchWooProductsPage } from './wooService.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLACEHOLDER_CATEGORY_RE = /^categoria padr[aã]o$/i;

export function isPlaceholderCategoryName(name) {
    return PLACEHOLDER_CATEGORY_RE.test(String(name || '').trim());
}

/** Nome utilizável na UI/auditoria — ignora vazio e “Categoria padrão”. */
export function usableCategoryName(name) {
    const n = String(name || '').trim();
    if (!n || isPlaceholderCategoryName(n)) return '';
    return n;
}

/** Cache em memória: id categoria Bling → nome */
let categoryNameById = new Map();

export async function loadBlingCategoryMap(token) {
    try {
        const cats = await fetchBlingProductCategories(token);
        categoryNameById = new Map(cats.map((c) => [Number(c.id), c.name]));
        try {
            const stores = await fetchBlingStoreCategories(token);
            for (const s of stores) {
                const pid = Number(s.productCategoryId || 0);
                if (!pid || !s.name) continue;
                const existing = categoryNameById.get(pid);
                if (!existing || isPlaceholderCategoryName(existing)) {
                    categoryNameById.set(pid, s.name);
                }
            }
        } catch (err) {
            logger.warn('Catalog: categorias de loja Bling', err?.message || err);
        }
        return categoryNameById;
    } catch (err) {
        logger.warn('Catalog: falha ao carregar categorias Bling', err?.message || err);
        return categoryNameById;
    }
}

export function getCachedCategoryName(id) {
    if (!id) return '';
    return categoryNameById.get(Number(id)) || '';
}

export async function ensureCategoryIdsInMap(ids, token) {
    const t = token || await ensureValidBlingToken();
    const unique = [...new Set((ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
    let fetched = 0;
    for (const id of unique) {
        if (categoryNameById.has(id)) continue;
        const cat = await fetchBlingProductCategoryById(id, t);
        if (cat?.id && cat.name) {
            categoryNameById.set(cat.id, cat.name);
            fetched += 1;
        }
        await sleep(80);
    }
    return fetched;
}

function extractCategoryId(raw, fallback = 0) {
    return Number(raw?.categoryId || raw?.detail?.categoria?.id || raw?.list?.categoria?.id || fallback || 0) || 0;
}

function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

function stripHtml(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function mapBlingProductToRow(p, detail = null, extras = {}) {
    const src = detail || p || {};
    const midia = src.midia || {};
    const imagens = midia.imagens || src.imagens || {};
    const ext = Array.isArray(imagens.externas) ? imagens.externas : [];
    const int = Array.isArray(imagens.internas) ? imagens.internas : [];
    const imageCount = ext.length + int.length + (src.imagemURL || midia.imagemURL ? 1 : 0);

    const dim = src.dimensoes || {};
    const estoque = src.estoque || {};
    const trib = src.tributacao || {};
    const catId = Number(src.categoria?.id || extras.categoryId || 0) || 0;
    const rawCategoryName = String(
        src.categoria?.descricao
        || src.categoria?.nome
        || getCachedCategoryName(catId)
        || extras.category
        || '',
    ).trim();
    const categoria = usableCategoryName(rawCategoryName);
    const marca = src.marca?.nome || (typeof src.marca === 'string' ? src.marca : '');
    const formato = String(src.formato || p.formato || extras.formato || '').trim().toUpperCase();
    const parentId = String(
        extras.parentId
        || src.idProdutoPai
        || src.produtoPai?.id
        || src.parentId
        || '',
    ).trim();

    return {
        channel: 'bling',
        externalId: String(src.id || p.id),
        sku: String(src.codigo || p.codigo || '').trim(),
        name: String(src.nome || p.nome || '').trim(),
        price: num(src.preco ?? p.preco),
        salePrice: null,
        weight: num(src.pesoBruto ?? src.pesoLiquido ?? src.pesoLiq ?? src.peso),
        height: num(dim.altura ?? src.altura),
        width: num(dim.largura ?? src.largura),
        length: num(dim.profundidade ?? dim.comprimento ?? src.comprimento),
        ncm: String(trib.ncm || src.ncm || '').replace(/\D/g, '').length === 8
            ? String(trib.ncm || src.ncm || '').replace(/\D/g, '')
            : String(trib.ncm || src.ncm || '').trim(),
        category: String(categoria).trim(),
        brand: String(marca).trim(),
        description: stripHtml(src.descricaoCurta || src.descricaoComplementar || src.descricao || ''),
        shortDescription: stripHtml(src.descricaoCurta || ''),
        slug: '',
        seoTitle: '',
        seoDescription: '',
        imageCount,
        stockQty: num(estoque.saldoVirtualTotal ?? estoque.saldo ?? src.estoqueAtual),
        status: String(src.situacao || p.situacao || ''),
        gtin: String(src.gtin || src.gtinEmbalagem || '').trim(),
        parentId,
        formato,
        rawJson: {
            list: p,
            detail: detail || undefined,
            categoryId: catId || undefined,
            categoryName: rawCategoryName || undefined,
        },
        syncedAt: Date.now(),
    };
}

export function mapWooProductToRow(p) {
    const images = Array.isArray(p.images) ? p.images : [];
    const cats = Array.isArray(p.categories) ? p.categories.map((c) => c.name).filter(Boolean) : [];
    const brands = Array.isArray(p.brands) ? p.brands.map((b) => b.name).filter(Boolean) : [];
    const dims = p.dimensions || {};

    return {
        channel: 'woo',
        externalId: String(p.id),
        sku: String(p.sku || '').trim(),
        name: String(p.name || '').trim(),
        price: num(p.regular_price || p.price),
        salePrice: num(p.sale_price),
        weight: num(p.weight),
        height: num(dims.height),
        width: num(dims.width),
        length: num(dims.length),
        ncm: '',
        category: cats.join(', '),
        brand: brands.join(', ') || String(p.attributes?.find?.((a) => /marca/i.test(a.name))?.options?.[0] || ''),
        description: stripHtml(p.description),
        shortDescription: stripHtml(p.short_description),
        slug: String(p.slug || ''),
        seoTitle: '',
        seoDescription: '',
        imageCount: images.length,
        stockQty: num(p.stock_quantity),
        status: String(p.status || ''),
        gtin: String(p.global_unique_id || '').trim(),
        parentId: p.parent_id ? String(p.parent_id) : '',
        rawJson: p,
        syncedAt: Date.now(),
    };
}

function parseProductRaw(p) {
    try {
        return typeof p?.rawJson === 'string' ? JSON.parse(p.rawJson) : (p?.rawJson || {});
    } catch {
        return {};
    }
}

/** Atualiza pela lista sem apagar detalhe já baixado. */
function upsertBlingFromList(listItem) {
    const id = String(listItem.id);
    const existing = chatDB.getCatalogProduct('bling', id);
    const prevDetail = parseProductRaw(existing).detail || null;

    if (prevDetail) {
        const row = mapBlingProductToRow(
            { ...listItem, formato: listItem.formato || prevDetail.formato },
            prevDetail,
        );
        row.sku = String(listItem.codigo ?? row.sku ?? '').trim();
        row.name = String(listItem.nome ?? row.name ?? '').trim();
        row.price = num(listItem.preco ?? row.price);
        row.status = String(listItem.situacao ?? row.status ?? '');
        if (existing?.parentId && !row.parentId) row.parentId = existing.parentId;
        const prevRaw = parseProductRaw(existing);
        row.rawJson = {
            list: listItem,
            detail: prevDetail,
            categoryId: row.rawJson?.categoryId || prevRaw.categoryId || Number(prevDetail.categoria?.id || 0) || undefined,
            categoryName: row.rawJson?.categoryName || prevRaw.categoryName || undefined,
        };
        chatDB.upsertCatalogProduct(row);
        return row;
    }

    const row = mapBlingProductToRow(listItem);
    chatDB.upsertCatalogProduct(row);
    return row;
}

function applyBlingDetail(id, detail) {
    const listStub = {
        id,
        codigo: detail.codigo,
        nome: detail.nome,
        preco: detail.preco,
        situacao: detail.situacao,
        formato: detail.formato,
    };
    const existing = chatDB.getCatalogProduct('bling', String(id));
    const row = mapBlingProductToRow(listStub, detail);
    if (existing?.seoTitle) row.seoTitle = existing.seoTitle;
    if (existing?.seoDescription) row.seoDescription = existing.seoDescription;
    if (existing?.focusKeyword) row.focusKeyword = existing.focusKeyword;
    chatDB.upsertCatalogProduct(row);

    const parentCatId = Number(detail.categoria?.id || 0) || 0;
    const vars = Array.isArray(detail.variacoes) ? detail.variacoes : [];
    for (const v of vars) {
        if (!v?.id) continue;
        chatDB.upsertCatalogProduct(
            mapBlingProductToRow(v, v, {
                parentId: String(id),
                formato: v.formato || 'S',
                categoryId: Number(v.categoria?.id || parentCatId || 0) || 0,
            }),
        );
    }
}

/**
 * Sync lista Bling + detalhes sob demanda (incremental).
 * Não zera o snapshot a cada vez — só busca detalhe de novos, sem detail, ou formato V.
 * CATALOG_BLING_DEEP=0 desliga detalhes; CATALOG_BLING_FULL_DEEP=1 força todos.
 */
export async function syncBlingCatalog(onProgress = () => {}) {
    const token = await ensureValidBlingToken();
    if (!token) throw new Error('Token Bling inválido ou expirado. Autorize novamente em Integrações → Bling.');

    onProgress({ phase: 'bling_categories', message: 'Bling: carregando categorias…', count: 0 });
    await loadBlingCategoryMap(token);

    const ids = [];
    const listById = new Map();
    let page = 1;

    while (page <= 200) {
        onProgress({ phase: 'bling_list', message: `Bling: listando página ${page}…`, count: ids.length });
        let rows = [];
        try {
            rows = await fetchBlingProductsPage(page, 100, token);
        } catch (err) {
            if (/limite|rate/i.test(String(err?.message || ''))) {
                await sleep(2000);
                rows = await fetchBlingProductsPage(page, 100, token);
            } else {
                throw err;
            }
        }
        if (!rows.length) break;
        for (const p of rows) {
            const row = upsertBlingFromList(p);
            ids.push(row.externalId);
            listById.set(row.externalId, p);
        }
        if (rows.length < 100) break;
        page += 1;
        await sleep(200);
    }

    // Remove órfãos (mantém variações cujo pai ainda existe na lista)
    const keepTop = new Set(ids);
    const existing = chatDB.listCatalogProducts('bling');
    let removed = 0;
    for (const p of existing) {
        if (keepTop.has(p.externalId)) continue;
        if (p.parentId && keepTop.has(p.parentId)) continue;
        chatDB.deleteCatalogProduct('bling', p.externalId);
        removed += 1;
    }
    if (removed) logger.info('Catalog: removidos órfãos Bling', removed);

    const deep = process.env.CATALOG_BLING_DEEP !== '0';
    const fullDeep = process.env.CATALOG_BLING_FULL_DEEP === '1';
    const detailConcurrency = Math.max(1, Math.min(Number(process.env.CATALOG_BLING_DETAIL_CONCURRENCY) || 5, 8));
    const detailPauseMs = Math.max(100, Number(process.env.CATALOG_BLING_DETAIL_PAUSE_MS) || 280);

    if (deep && ids.length) {
        const needDetail = [];
        for (const id of ids) {
            const p = chatDB.getCatalogProduct('bling', id);
            const list = listById.get(id) || {};
            const formato = String(p?.formato || list.formato || '').trim().toUpperCase();
            const raw = parseProductRaw(p);
            const hasDetail = Boolean(raw.detail);
            // Sem detalhe = lista só tem nome/SKU/preço; peso/NCM/dims ficam vazios e geram falso positivo
            if (fullDeep || !hasDetail || formato === 'V') needDetail.push(id);
        }

        const total = needDetail.length;
        onProgress({
            phase: 'bling_detail',
            message: total
                ? `Bling: detalhes ${total} produto(s) (incremental)…`
                : 'Bling: detalhes já atualizados — pulando…',
            count: ids.length,
        });

        const failedIds = [];
        for (let i = 0; i < needDetail.length; i += detailConcurrency) {
            const batch = needDetail.slice(i, i + detailConcurrency);
            onProgress({
                phase: 'bling_detail',
                message: `Bling: detalhes ${Math.min(i + detailConcurrency, total)}/${total}…`,
                count: ids.length,
            });
            await Promise.all(batch.map(async (id) => {
                try {
                    const detail = await fetchBlingProduct(id, token);
                    if (detail) applyBlingDetail(id, detail);
                } catch (err) {
                    failedIds.push(id);
                    logger.warn('Catalog: falha detalhe Bling', id, err?.message || err);
                }
            }));
            await sleep(detailPauseMs);
        }

        if (failedIds.length) {
            onProgress({
                phase: 'bling_detail_retry',
                message: `Bling: retentando ${failedIds.length} detalhes…`,
                count: ids.length,
            });
            await sleep(1500);
            for (const id of failedIds) {
                try {
                    const detail = await fetchBlingProduct(id, token);
                    if (detail) applyBlingDetail(id, detail);
                } catch (err) {
                    logger.warn('Catalog: retry detalhe Bling falhou', id, err?.message || err);
                }
                await sleep(detailPauseMs);
            }
        }
    }

    onProgress({ phase: 'bling_categories', message: 'Bling: preenchendo nomes de categoria…', count: ids.length });
    await resolveLocalCategoryNames({ refreshStaleDetails: false });

    return chatDB.countCatalogProducts('bling');
}

/** Força atualizar o detalhe de um produto Bling no snapshot local. */
export async function refreshBlingProductDetail(externalId) {
    const id = String(externalId || '').trim();
    if (!id) throw new Error('Informe o ID do produto.');
    const token = await ensureValidBlingToken();
    if (!token) throw new Error('Token Bling inválido ou expirado.');
    if (!categoryNameById.size) await loadBlingCategoryMap(token);
    const detail = await fetchBlingProduct(id, token);
    if (!detail) throw new Error('Bling não retornou o produto.');
    const catId = Number(detail.categoria?.id || 0) || 0;
    if (catId && !getCachedCategoryName(catId)) {
        await ensureCategoryIdsInMap([catId], token);
    }
    applyBlingDetail(id, detail);
    return chatDB.getCatalogProduct('bling', id);
}

function isInactiveCatalogRow(p) {
    const s = String(p?.status || '').trim().toUpperCase();
    return s === 'I' || s === 'INATIVO' || s === 'INACTIVE';
}

/** Preenche nomes de categoria no snapshot a partir dos IDs já salvos no rawJson. */
export async function resolveLocalCategoryNames({ refreshStaleDetails = false, onProgress = () => {} } = {}) {
    const token = await ensureValidBlingToken();
    if (!token) throw new Error('Token Bling inválido ou expirado.');
    onProgress({ phase: 'bling_categories', message: 'Bling: carregando mapa de categorias…' });
    await loadBlingCategoryMap(token);

    let products = chatDB.listCatalogProducts('bling');
    const catIds = products.map((p) => extractCategoryId(parseProductRaw(p))).filter(Boolean);
    onProgress({ phase: 'bling_categories', message: 'Bling: resolvendo nomes de categoria por ID…' });
    const fetchedIds = await ensureCategoryIdsInMap(catIds, token);

    let refreshed = 0;
    if (refreshStaleDetails) {
        const stale = products.filter((p) => {
            if (isInactiveCatalogRow(p)) return false;
            if (String(p.formato || '').toUpperCase() === 'V') return false;
            const raw = parseProductRaw(p);
            const catId = extractCategoryId(raw);
            const name = usableCategoryName(p.category) || usableCategoryName(getCachedCategoryName(catId));
            return !name;
        });
        const total = stale.length;
        onProgress({
            phase: 'bling_detail',
            message: total
                ? `Bling: buscando cadastro atual de ${total} produto(s) sem categoria real…`
                : 'Bling: nenhum produto pendente de categoria.',
            count: total,
        });
        const concurrency = Math.max(1, Math.min(Number(process.env.CATALOG_BLING_DETAIL_CONCURRENCY) || 5, 8));
        const pauseMs = Math.max(100, Number(process.env.CATALOG_BLING_DETAIL_PAUSE_MS) || 280);
        for (let i = 0; i < stale.length; i += concurrency) {
            const batch = stale.slice(i, i + concurrency);
            onProgress({
                phase: 'bling_detail',
                message: `Bling: cadastro atual ${Math.min(i + concurrency, total)}/${total}…`,
                count: total,
            });
            await Promise.all(batch.map(async (p) => {
                try {
                    const detail = await fetchBlingProduct(p.externalId, token);
                    if (!detail) return;
                    const catId = Number(detail.categoria?.id || 0) || 0;
                    if (catId && !getCachedCategoryName(catId)) {
                        await ensureCategoryIdsInMap([catId], token);
                    }
                    applyBlingDetail(p.externalId, detail);
                    refreshed += 1;
                } catch (err) {
                    logger.warn('Catalog: refresh categoria falhou', p.externalId, err?.message || err);
                }
            }));
            await sleep(pauseMs);
        }
        products = chatDB.listCatalogProducts('bling');
    }

    let updated = 0;
    for (const p of products) {
        const raw = parseProductRaw(p);
        const catId = extractCategoryId(raw);
        const name = usableCategoryName(getCachedCategoryName(catId)) || usableCategoryName(p.category);
        const nextName = name || '';
        const nextRawName = getCachedCategoryName(catId) || raw.categoryName || nextName;
        if (String(p.category || '').trim() === nextName && Number(raw.categoryId || 0) === Number(catId || 0)) {
            continue;
        }
        chatDB.upsertCatalogProduct({
            ...p,
            category: nextName,
            rawJson: { ...raw, categoryId: catId || undefined, categoryName: nextRawName || undefined },
        });
        updated += 1;
    }

    const afterNames = chatDB.listCatalogProducts('bling');
    const byExt = new Map(afterNames.map((p) => [String(p.externalId), p]));
    let inherited = 0;
    for (const p of afterNames) {
        if (usableCategoryName(p.category)) continue;
        if (!p.parentId) continue;
        const parent = byExt.get(String(p.parentId));
        if (!parent || !usableCategoryName(parent.category)) continue;
        const raw = parseProductRaw(p);
        const praw = parseProductRaw(parent);
        const catId = extractCategoryId(praw) || extractCategoryId(raw);
        chatDB.upsertCatalogProduct({
            ...p,
            category: parent.category,
            rawJson: {
                ...raw,
                categoryId: catId || undefined,
                categoryName: praw.categoryName || parent.category,
            },
        });
        inherited += 1;
    }

    return {
        updated: updated + inherited,
        refreshed,
        fetchedIds,
        inherited,
        categories: categoryNameById.size,
    };
}

export async function syncWooCatalog(onProgress = () => {}) {
    const creds = getWooCredentials();
    if (!creds) throw new Error('WooCommerce sem credenciais. Configure em Integrações (ou salve Consumer Key/Secret).');

    chatDB.clearCatalogChannel('woo');
    let page = 1;
    let total = 0;

    while (page <= 200) {
        onProgress({ phase: 'woo_list', message: `WooCommerce: página ${page}…`, count: total });
        let rows = [];
        try {
            rows = await fetchWooProductsPage(page, 100, creds);
        } catch (err) {
            if (/limite|rate|too many/i.test(String(err?.message || ''))) {
                await sleep(2000);
                rows = await fetchWooProductsPage(page, 100, creds);
            } else {
                throw err;
            }
        }
        if (!rows.length) break;
        for (const p of rows) {
            chatDB.upsertCatalogProduct(mapWooProductToRow(p));
            total += 1;
        }
        if (rows.length < 100) break;
        page += 1;
        await sleep(200);
    }

    return chatDB.countCatalogProducts('woo');
}

export default {
    syncBlingCatalog,
    syncWooCatalog,
    mapBlingProductToRow,
    mapWooProductToRow,
    refreshBlingProductDetail,
    resolveLocalCategoryNames,
    loadBlingCategoryMap,
    getCachedCategoryName,
    usableCategoryName,
    isPlaceholderCategoryName,
};
