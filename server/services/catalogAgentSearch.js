/**
 * Busca produtos do snapshot Woo (e-commerce) para o agente de atendimento.
 * Usa o catálogo local já sincronizado — sem chamar a API a cada mensagem.
 */

import chatDB from '../db/database.js';
import { getWooConfig, normalizeStoreUrl } from './wooService.js';
import { BRANDING } from '../utils/branding.js';

const STOPWORDS = new Set([
    'quero', 'queria', 'comprar', 'compra', 'voces', 'vocês', 'voce', 'você', 'tem', 'têm',
    'uma', 'umas', 'uns', 'um', 'o', 'a', 'os', 'as', 'de', 'da', 'do', 'das', 'dos',
    'para', 'pra', 'por', 'com', 'sem', 'meu', 'minha', 'me', 'oi', 'ola', 'olá',
    'bom', 'boa', 'dia', 'tarde', 'noite', 'porfavor', 'favor', 'pode', 'podem',
    'enviar', 'manda', 'mandar', 'link', 'site', 'loja', 'produto', 'produtos',
    'esse', 'essa', 'isso', 'aquele', 'aquela', 'algo', 'algum', 'alguma',
    'como', 'qual', 'quais', 'onde', 'quando', 'muito', 'mais', 'menos',
    'preco', 'preço', 'valor', 'quanto', 'custa', 'disponivel', 'disponível',
    'human', 'humano', 'atendente', 'obrigado', 'obrigada', 'valeu', 'thanks',
]);

function stripAccents(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

export function tokenizeProductQuery(text) {
    return stripAccents(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .split(/[\s/-]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function parseRaw(rawJson) {
    try {
        return typeof rawJson === 'string' ? JSON.parse(rawJson || '{}') : (rawJson || {});
    } catch {
        return {};
    }
}

function productUrl(row, storeBase) {
    const raw = parseRaw(row.rawJson);
    const permalink = String(raw.permalink || '').trim();
    if (permalink) return permalink;
    const slug = String(row.slug || raw.slug || '').trim();
    if (slug && storeBase) return `${storeBase}/product/${slug}/`;
    return storeBase || BRANDING.storeUrl || '';
}

function formatPrice(row) {
    const sale = Number(row.salePrice);
    const price = Number(row.price);
    const value = Number.isFinite(sale) && sale > 0 ? sale : price;
    if (!Number.isFinite(value) || value <= 0) return null;
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function stockLabel(row) {
    const q = row.stockQty;
    if (q == null || q === '') return 'disponível no site';
    const n = Number(q);
    if (!Number.isFinite(n)) return 'disponível no site';
    if (n <= 0) return 'sem estoque no site';
    return `estoque ~${n}`;
}

/** Só itens que dá para oferecer: estoque > 0 ou Woo "instock" sem controle numérico. */
function isInStockForAgent(row) {
    const raw = parseRaw(row.rawJson);
    const status = String(raw.stock_status || '').toLowerCase();
    if (status === 'outofstock') return false;
    const q = row.stockQty;
    if (q != null && q !== '') {
        const n = Number(q);
        if (Number.isFinite(n)) return n > 0;
    }
    if (status === 'instock') return true;
    // Sem stock_status claro e sem qty: não oferece (evita vender fantasma)
    return false;
}

/**
 * @param {string} userText
 * @param {{ limit?: number }} [opts]
 * @returns {Array<{ sku: string, name: string, priceLabel: string|null, url: string, stock: string, score: number }>}
 */
export function searchWooProductsForAgent(userText, opts = {}) {
    const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 8);
    const tokens = tokenizeProductQuery(userText);
    if (!tokens.length) return [];

    const wooCfg = getWooConfig();
    const storeBase = normalizeStoreUrl(wooCfg.storeUrl || BRANDING.storeUrl || '');

    const primary = [...tokens].sort((a, b) => b.length - a.length)[0];
    const like = `%${primary}%`;

    let rows = [];
    try {
        if (tokens.length >= 2) {
            rows = chatDB.searchCatalogProductsByTokens('woo', tokens, 80);
            // Se AND ficou vazio demais, afrouxa com o token mais longo
            if (!rows.length) {
                rows = chatDB.searchCatalogProductsLite('woo', `%${primary}%`, 100);
            }
        } else {
            rows = chatDB.searchCatalogProductsLite('woo', `%${primary}%`, 100);
        }
    } catch {
        return [];
    }

    const scored = [];
    for (const row of rows) {
        if (String(row.status || '').toLowerCase() !== 'publish') continue;
        if (!isInStockForAgent(row)) continue;
        const hay = stripAccents(
            `${row.name || ''} ${row.sku || ''} ${row.category || ''} ${row.slug || ''}`,
        ).toLowerCase();
        let matched = 0;
        let score = 0;
        for (const t of tokens) {
            if (hay.includes(t)) {
                matched += 1;
                score += t.length >= 5 ? 3 : 2;
            }
            if (String(row.sku || '').toLowerCase() === t) score += 10;
        }
        if (matched === 0) continue;
        if (matched === tokens.length) score += 15;
        score += matched * 2;
        const stockN = Number(row.stockQty);
        if (Number.isFinite(stockN) && stockN > 0) score += 2;

        const url = productUrl(row, storeBase);
        if (!url) continue;

        scored.push({
            sku: String(row.sku || '').trim() || String(row.externalId || ''),
            name: String(row.name || '').trim(),
            priceLabel: formatPrice(row),
            url,
            stock: stockLabel(row),
            score,
        });
    }

    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR'));
    return scored.slice(0, limit);
}

/** Extrai slug de URL de produto (Woo / lojas compatíveis). */
export function extractProductSlugFromUrl(text, storeBase = '') {
    const urls = String(text || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
    const tryUrl = (raw, requireHost) => {
        try {
            const u = new URL(raw.split('?')[0]);
            if (requireHost && storeBase) {
                const want = new URL(storeBase).hostname.replace(/^www\./, '');
                const got = u.hostname.replace(/^www\./, '');
                if (want && got !== want) return null;
            }
            const parts = u.pathname.split('/').filter(Boolean);
            if (!parts.length) return null;
            const last = parts[parts.length - 1];
            if (last === 'p' && parts.length >= 2) return parts[parts.length - 2];
            if (['product', 'produto', 'products', 'p'].includes(parts[0]) && parts[1]) return parts[1];
            return last.length >= 3 ? last : null;
        } catch {
            return null;
        }
    };
    for (const raw of urls) {
        const slug = tryUrl(raw, true);
        if (slug) return slug;
    }
    for (const raw of urls) {
        const slug = tryUrl(raw, false);
        if (slug) return slug;
    }
    return null;
}

/** Busca por texto ou por slug em link de produto. */
export function searchWooProductsFromMessage(userText, opts = {}) {
    const fromText = searchWooProductsForAgent(userText, opts);
    if (fromText.length) return fromText;
    const wooCfg = getWooConfig();
    const storeBase = normalizeStoreUrl(wooCfg.storeUrl || BRANDING.storeUrl || '');
    const slug = extractProductSlugFromUrl(userText, storeBase);
    if (!slug) return [];
    return searchWooProductsForAgent(slug.replace(/[-_/]+/g, ' '), opts);
}

/** Bloco de texto para injetar no system prompt do agente. */
export function formatCatalogContextForAgent(products, storeUrl) {
    const store = storeUrl || BRANDING.storeUrl || 'a loja';
    if (!products?.length) {
        return `CATÁLOGO DA LOJA (busca nesta mensagem): nenhum produto DISPONÍVEL (estoque) correspondente.
Se o cliente pediu um produto, diga que não achou disponível com esse nome e peça outro detalhe (tipo, cor, SKU) ou envie o link geral: ${store}
NUNCA invente link de produto.`;
    }

    const lines = products.map((p, i) => {
        const price = p.priceLabel ? ` | ${p.priceLabel}` : '';
        return `${i + 1}. ${p.name} (SKU ${p.sku})${price} | ${p.stock}\n   Link: ${p.url}`;
    });

    return `CATÁLOGO DA LOJA (somente itens disponíveis no e-commerce — use APENAS estes links):
${lines.join('\n')}

Regras:
• Ofereça 1–3 opções desta lista com o link completo (pode listar mais se o cliente pedir “todas”).
• Nunca invente URL, preço ou estoque fora desta lista.
• Se nada servir, peça mais detalhes ou envie ${store}`;
}

export default {
    tokenizeProductQuery,
    searchWooProductsForAgent,
    searchWooProductsFromMessage,
    extractProductSlugFromUrl,
    formatCatalogContextForAgent,
};
