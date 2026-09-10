/**
 * Cliente WooCommerce REST API + mensagens de webhook.
 */

import chatDB from '../db/database.js';
import { hasRealWooCredentials, getWooConsumerKey, getWooConsumerSecret } from '../utils/wooConfig.js';

const DEFAULT_MESSAGES = {
    'order.created': 'Olá {{nome}}! Recebemos seu pedido #{{numero}}{{total}}. Obrigado pela compra! 🛍️',
    'order.processing': 'Olá {{nome}}! Pagamento do pedido #{{numero}} confirmado. Estamos preparando seu envio. ✅',
    'order.completed': 'Olá {{nome}}! Seu pedido #{{numero}} foi concluído. Qualquer dúvida, estamos aqui! 🎉',
    'order.shipped': 'Olá {{nome}}! Pedido #{{numero}} enviado{{rastreio}}. 📦',
    'cart.abandoned': 'Olá {{nome}}! Vi que você deixou itens no carrinho. Posso ajudar a finalizar? 🛒',
};

export function normalizeStoreUrl(url) {
    let u = String(url || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    return u.replace(/\/$/, '');
}

export function getWooConfig() {
    return chatDB.getPlatformKv('woocommerce') || {};
}

export function getWooCredentials(cfg = getWooConfig()) {
    if (!hasRealWooCredentials(cfg)) return null;
    return {
        storeUrl: normalizeStoreUrl(cfg.storeUrl),
        consumerKey: getWooConsumerKey(cfg),
        consumerSecret: getWooConsumerSecret(cfg),
    };
}

function wooAuthHeader(key, secret) {
    return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

async function wooFetch(path, {
    storeUrl,
    consumerKey,
    consumerSecret,
    method = 'GET',
    body = undefined,
} = {}) {
    const base = normalizeStoreUrl(storeUrl);
    const key = consumerKey || getWooConsumerKey(getWooConfig());
    const secret = consumerSecret || getWooConsumerSecret(getWooConfig());
    if (!base || !key || !secret) throw new Error('URL da loja e credenciais WooCommerce são obrigatórias.');

    const url = `${base}/wp-json/wc/v3${path.startsWith('/') ? path : `/${path}`}`;
    const headers = {
        Accept: 'application/json',
        Authorization: wooAuthHeader(key, secret),
    };
    const init = { method, headers };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }
    if (!res.ok) {
        const msg = json?.message || json?.code || text?.slice(0, 300) || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return json;
}

export async function testWooConnection(overrides = {}) {
    const cfg = getWooConfig();
    const creds = {
        storeUrl: normalizeStoreUrl(overrides.storeUrl || cfg.storeUrl),
        consumerKey: String(overrides.consumerKey || getWooConsumerKey(cfg)).trim(),
        consumerSecret: String(overrides.consumerSecret || getWooConsumerSecret(cfg)).trim(),
    };
    if (!creds.storeUrl || !creds.consumerKey || !creds.consumerSecret) {
        throw new Error('Informe URL da loja, Consumer Key e Consumer Secret.');
    }
    const orders = await wooFetch('/orders?per_page=1&orderby=date&order=desc', creds);
    const count = Array.isArray(orders) ? orders.length : 0;
    const detail = count === 0 ? ' (nenhum pedido ainda)' : ` (${count} pedido(s) na API)`;
    return { ok: true, message: `WooCommerce API respondeu — credenciais válidas${detail}.` };
}

export async function fetchWooOrder(orderId, creds = getWooCredentials()) {
    const id = String(orderId || '').trim();
    if (!id || !creds) return null;
    return wooFetch(`/orders/${encodeURIComponent(id)}`, creds);
}

/** Lista produtos WooCommerce (página). */
export async function fetchWooProductsPage(page = 1, perPage = 100, creds = getWooCredentials()) {
    if (!creds) throw new Error('Credenciais WooCommerce não configuradas.');
    const rows = await wooFetch(
        `/products?per_page=${Math.min(100, perPage)}&page=${page}&status=any`,
        creds,
    );
    return Array.isArray(rows) ? rows : [];
}

/** Busca produto Woo por SKU (local snapshot primeiro, depois API). */
export async function findWooProductBySku(sku, creds = getWooCredentials()) {
    const s = String(sku || '').trim();
    if (!s) return null;

    const local = chatDB.listCatalogProducts('woo')
        .find((p) => String(p.sku || '').trim().toLowerCase() === s.toLowerCase());
    if (local?.externalId) {
        return { id: Number(local.externalId), sku: local.sku, name: local.name, from: 'snapshot' };
    }

    if (!creds) return null;
    const rows = await wooFetch(
        `/products?sku=${encodeURIComponent(s)}&per_page=5&status=any`,
        creds,
    );
    const hit = Array.isArray(rows) ? rows.find((p) => String(p.sku || '').trim().toLowerCase() === s.toLowerCase()) : null;
    if (!hit?.id) return null;
    return { id: Number(hit.id), sku: hit.sku, name: hit.name, from: 'api' };
}

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Converte texto plano (parágrafos \\n\\n ou " | ") em HTML Woo. */
export function plainTextToWooHtml(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    if (/<[a-z][\s\S]*>/i.test(raw)) return raw;
    let parts = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length <= 1 && raw.includes('|')) {
        parts = raw.split(/\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
    }
    if (!parts.length) parts = [raw];
    return parts.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
}

/**
 * Atualiza descrição + meta Rank Math no WooCommerce.
 * Meta keys oficiais Rank Math: rank_math_focus_keyword, rank_math_title, rank_math_description.
 */
export async function patchWooProductSeo(productId, patch = {}, creds = getWooCredentials()) {
    const id = Number(productId);
    if (!Number.isFinite(id) || id <= 0) throw new Error('ID Woo inválido.');
    if (!creds) throw new Error('Credenciais WooCommerce não configuradas.');

    const body = {};
    if (patch.shortDescription != null || patch.short_description != null) {
        body.short_description = String(patch.shortDescription ?? patch.short_description ?? '');
    }
    if (patch.description != null) {
        body.description = plainTextToWooHtml(patch.description);
    }

    const meta = [];
    const focus = String(patch.focusKeyword || patch.focus_keyword || '').trim();
    const seoTitle = String(patch.seoTitle || patch.seo_title || '').trim();
    const seoDesc = String(patch.seoDescription || patch.seo_description || patch.shortDescription || '').trim();
    if (focus) meta.push({ key: 'rank_math_focus_keyword', value: focus });
    if (seoTitle) meta.push({ key: 'rank_math_title', value: seoTitle });
    if (seoDesc) meta.push({ key: 'rank_math_description', value: seoDesc });
    if (meta.length) body.meta_data = meta;

    if (!Object.keys(body).length) {
        throw new Error('Nenhum campo SEO para atualizar no Woo.');
    }

    return wooFetch(`/products/${encodeURIComponent(id)}`, {
        ...creds,
        method: 'PUT',
        body,
    });
}

/**
 * Aplica SEO no Woo a partir do SKU (best-effort).
 * @returns {{ ok: boolean, skipped?: boolean, wooId?: number, error?: string }}
 */
export async function syncCatalogSeoToWooBySku(sku, patch = {}) {
    const s = String(sku || '').trim();
    if (!s) return { ok: false, skipped: true, error: 'SKU vazio' };
    if (!getWooCredentials()) return { ok: false, skipped: true, error: 'Woo não configurado' };

    const hasSeo = Boolean(
        patch.focusKeyword || patch.seoTitle || patch.seoDescription
        || patch.shortDescription || patch.description,
    );
    if (!hasSeo) return { ok: false, skipped: true, error: 'Sem campos SEO no patch' };

    const found = await findWooProductBySku(s);
    if (!found?.id) return { ok: false, skipped: true, error: `SKU ${s} não encontrado no Woo` };

    await patchWooProductSeo(found.id, patch);
    return { ok: true, wooId: found.id, sku: s };
}

function pickTracking(payload) {
    const meta = Array.isArray(payload?.meta_data) ? payload.meta_data : [];
    for (const m of meta) {
        const k = String(m?.key || '').toLowerCase();
        if (k.includes('track') || k.includes('rastre')) return String(m.value || '');
    }
    return payload?.tracking_number || payload?.rastreio || '';
}

export function parseWooOrder(payload = {}) {
    const billing = payload?.billing || {};
    const name = [billing.first_name, billing.last_name].filter(Boolean).join(' ')
        || payload?.customer_name
        || 'Cliente';
    const phone = billing.phone || payload?.phone || payload?.customer_phone || '';
    const numero = payload?.number || payload?.id || '';
    const totalRaw = payload?.total || payload?.order_total || '';
    const total = totalRaw ? ` (R$ ${totalRaw})` : '';
    const rastreio = pickTracking(payload);
    return {
        customer: name,
        nome: billing.first_name || name.split(' ')[0] || 'Cliente',
        phone,
        numero,
        total,
        rastreio: rastreio ? ` — Rastreio: ${rastreio}` : '',
        orderId: String(payload?.id || ''),
    };
}

export function normalizeWooWebhookEvent(topic, payload = {}) {
    const raw = String(topic || payload?.event || payload?.type || '').toLowerCase().replace(/_/g, '.');
    if (raw.includes('cart') && raw.includes('abandon')) return 'cart.abandoned';
    if (raw.includes('order.created')) return 'order.created';
    const status = String(payload?.status || '').toLowerCase();
    if (raw.includes('order')) {
        if (status === 'processing') return 'order.processing';
        if (status === 'completed') return 'order.completed';
        if (status === 'shipped' || pickTracking(payload)) return 'order.shipped';
        if (status === 'pending' || status === 'on-hold') return 'order.created';
        return status ? `order.${status}` : 'order.updated';
    }
    return raw || 'order.updated';
}

function applyTemplate(template, vars) {
    return String(template || '')
        .replace(/\{\{nome\}\}/g, vars.nome || vars.customer || 'Cliente')
        .replace(/\{\{numero\}\}/g, vars.numero || vars.orderId || '')
        .replace(/\{\{total\}\}/g, vars.total || '')
        .replace(/\{\{rastreio\}\}/g, vars.rastreio || '');
}

export function resolveWooMessage(eventType, vars, cfg = getWooConfig()) {
    const key = String(eventType || '');
    const custom = String(cfg?.eventMessages?.[key] || '').trim();
    const template = custom || DEFAULT_MESSAGES[key] || DEFAULT_MESSAGES['order.created'];
    return applyTemplate(template, vars);
}

export function isWooEventEnabled(eventType, cfg = getWooConfig()) {
    if (cfg?.syncOrders === false) return false;
    const events = cfg?.events || {};
    if (Object.prototype.hasOwnProperty.call(events, eventType)) {
        return events[eventType] !== false;
    }
    return true;
}

export default {
    normalizeStoreUrl,
    testWooConnection,
    fetchWooOrder,
    fetchWooProductsPage,
    findWooProductBySku,
    plainTextToWooHtml,
    patchWooProductSeo,
    syncCatalogSeoToWooBySku,
    parseWooOrder,
    normalizeWooWebhookEvent,
    resolveWooMessage,
    isWooEventEnabled,
    getWooCredentials,
};
