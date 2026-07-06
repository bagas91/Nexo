/**
 * Cliente Bling API v3 + parser de webhooks.
 * Auth: Bearer token OAuth (campo accessToken ou apiKey no KV bling).
 */

import logger from '../utils/logger.js';
import chatDB from '../db/database.js';

const API_BASE = 'https://www.bling.com.br/Api/v3';

export function getBlingAccessToken(cfg) {
    const c = cfg || chatDB.getPlatformKv('bling') || {};
    const token = String(c.accessToken || c.apiKey || '').trim();
    if (!token || token.includes('demo') || token.includes('•••')) return '';
    return token;
}

/** URL pública cadastrada no app Bling (Link de redirecionamento). */
export function getBlingOAuthRedirectUri() {
    const base = (
        process.env.BRAND_VPS_URL
        || process.env.PUBLIC_URL
        || 'https://cristian.vps-kinghost.net'
    ).replace(/\/$/, '');
    return `${base}/api/bling/oauth/callback`;
}

export function buildBlingAuthorizeUrl(clientId, state) {
    const id = String(clientId || '').trim();
    if (!id) throw new Error('Client ID do Bling não configurado.');
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: id,
        state: state || `nx_${Date.now()}`,
    });
    return `https://www.bling.com.br/Api/v3/oauth/authorize?${params.toString()}`;
}

export async function exchangeBlingAuthorizationCode({ code, clientId, clientSecret }) {
    const cid = String(clientId || '').trim();
    const secret = String(clientSecret || '').trim();
    const authCode = String(code || '').trim();
    if (!cid || !secret) throw new Error('Client ID e Client Secret são obrigatórios.');
    if (!authCode) throw new Error('Código de autorização ausente.');

    const basic = Buffer.from(`${cid}:${secret}`).toString('base64');
    const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            Authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: authCode,
        }).toString(),
    });

    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }
    if (!res.ok) {
        const msg = json?.error?.description || json?.error?.message || text?.slice(0, 300) || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    const data = json?.data || json;
    const accessToken = data?.access_token || data?.accessToken;
    const refreshToken = data?.refresh_token || data?.refreshToken;
    if (!accessToken) throw new Error('Bling não retornou access_token.');
    return { accessToken, refreshToken, raw: data };
}

export async function refreshBlingAccessToken({ refreshToken, clientId, clientSecret }) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            Authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: String(refreshToken || ''),
        }).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json?.error?.description || json?.error?.message || `HTTP ${res.status}`);
    }
    const data = json?.data || json;
    return {
        accessToken: data?.access_token || data?.accessToken,
        refreshToken: data?.refresh_token || data?.refreshToken || refreshToken,
    };
}

function authHeaders(token) {
    return {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
    };
}

async function blingFetch(path, token, { method = 'GET', body } = {}) {
    const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
    const opts = { method, headers: { ...authHeaders(token) } };
    if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }
    if (!res.ok) {
        const msg = json?.error?.description || json?.error?.message || text?.slice(0, 200) || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return json;
}

/** Testa token — lista 1 pedido. */
export async function testBlingConnection(token) {
    const t = String(token || '').trim();
    if (!t) throw new Error('Informe o token de acesso do Bling.');
    const json = await blingFetch('/pedidos/vendas?pagina=1&limite=1', t);
    const rows = Array.isArray(json?.data) ? json.data.length : null;
    const detail = rows === null ? '' : rows === 0 ? ' (nenhum pedido ainda na conta)' : ` (${rows} pedido(s) encontrado(s))`;
    return { ok: true, message: `API Bling respondeu — token válido${detail}.` };
}

/** Busca pedido de venda completo pelo ID interno do Bling. */
export async function fetchBlingOrder(orderId, token) {
    const id = String(orderId || '').trim();
    if (!id) return null;
    const t = token || getBlingAccessToken();
    if (!t) return null;
    const json = await blingFetch(`/pedidos/vendas/${encodeURIComponent(id)}`, t);
    return json?.data || json;
}

function pickPhone(...candidates) {
    for (const raw of candidates) {
        const d = String(raw || '').replace(/\D/g, '');
        if (d.length >= 10) return d;
    }
    return '';
}

function situacaoLabel(order) {
    const s = order?.situacao;
    if (!s) return '';
    if (typeof s === 'string') return s;
    if (typeof s === 'object') return s.nome || s.descricao || s.name || '';
    return String(s);
}

function trackingCode(order) {
    const t = order?.transporte || order?.transportadora || {};
    return (
        t.codigoRastreamento
        || t.rastreamento
        || t.codigo_rastreamento
        || order?.codigoRastreamento
        || order?.rastreio
        || ''
    );
}

/** Normaliza pedido Bling → campos usados no WhatsApp. */
export function mapBlingOrder(order) {
    if (!order || typeof order !== 'object') return null;
    const contato = order.contato || {};
    const phone = pickPhone(
        contato.celular,
        contato.telefone,
        order.telefone,
        order.celular,
    );
    const customer = contato.nome || order.nomeContato || order.cliente || 'Cliente';
    const numero = order.numero || order.numeroPedido || order.id || '';
    const orderId = order.id || order.idPedido || numero;
    const status = situacaoLabel(order);
    const rastreio = trackingCode(order);
    return {
        orderId: String(orderId),
        numero: String(numero),
        customer,
        phone,
        status,
        rastreio,
        raw: order,
    };
}

/**
 * Interpreta corpo do webhook Bling (formatos v1 e simulação manual).
 */
export function parseBlingWebhookBody(body = {}) {
    const resource = body.$resource || body.resource || '';
    const action = body.$action || body.action || body.evento || '';
    const data = body.data || body.$payload || body.payload || body;

    let eventType = body.event || body.tipo || body.type || '';
    if (!eventType && resource) {
        eventType = `${resource}.${action || 'updated'}`.replace(/^\./, '');
    }
    if (!eventType) eventType = 'order.updated';

    let orderId = data?.id || data?.idPedido || body?.id || body?.idPedido || null;
    let order = null;

    if (data?.numero || data?.contato || data?.situacao) {
        order = mapBlingOrder(data);
        orderId = orderId || order?.orderId;
    }

    return {
        eventType: String(eventType),
        orderId: orderId ? String(orderId) : null,
        order,
        raw: body,
    };
}

export function interpolateBlingMessage(template, ctx) {
    const name = ctx.customer || 'Cliente';
    return String(template || '')
        .replace(/\{\{nome\}\}/gi, name)
        .replace(/\{\{pedido\}\}/gi, String(ctx.numero || ctx.orderId || ''))
        .replace(/\{\{numero\}\}/gi, String(ctx.numero || ctx.orderId || ''))
        .replace(/\{\{rastreio\}\}/gi, String(ctx.rastreio || ''));
}

export function resolveBlingMessage(status, ctx) {
    const cfg = chatDB.getPlatformKv('bling') || {};
    const mapped = (cfg.statusMap || []).find(
        (s) => s.active && s.blingStatus && status && s.blingStatus.toLowerCase() === String(status).toLowerCase()
    );
    if (mapped?.message) return interpolateBlingMessage(mapped.message, ctx);
    return interpolateBlingMessage(
        `Olá {{nome}}! Atualização do pedido {{numero}}${status ? `: ${status}` : ''}.`,
        ctx
    );
}

/** Enriquece webhook com GET pedido quando há token e orderId. */
export async function enrichBlingFromApi(parsed) {
    const token = getBlingAccessToken();
    if (!token || !parsed.orderId) return parsed.order;

    try {
        const full = await fetchBlingOrder(parsed.orderId, token);
        const mapped = mapBlingOrder(full);
        if (mapped) return mapped;
    } catch (err) {
        logger.warn('Bling: falha ao buscar pedido na API', err?.message || err);
    }
    return parsed.order;
}

export default {
    getBlingAccessToken,
    testBlingConnection,
    fetchBlingOrder,
    mapBlingOrder,
    parseBlingWebhookBody,
    resolveBlingMessage,
    enrichBlingFromApi,
};
