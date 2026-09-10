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

function isUsableRefreshToken(token) {
    const t = String(token || '').trim();
    return t.length > 20 && !t.includes('•••') && !t.includes('demo');
}

/** Valida token na API; renova com refresh_token se expirado. */
export async function ensureValidBlingToken(cfg) {
    const c = cfg || chatDB.getPlatformKv('bling') || {};
    let token = getBlingAccessToken(c);
    if (!token) return '';

    try {
        await blingFetch('/pedidos/vendas?pagina=1&limite=1', token);
        return token;
    } catch (err) {
        const msg = String(err?.message || err);
        if (!/expired|expirado|invalid_token/i.test(msg)) throw err;
        if (!isUsableRefreshToken(c.refreshToken) || !c.clientId || !c.clientSecret) {
            return '';
        }
        const refreshed = await refreshBlingAccessToken({
            refreshToken: c.refreshToken,
            clientId: c.clientId,
            clientSecret: c.clientSecret,
        });
        const next = {
            ...c,
            connected: true,
            accessToken: refreshed.accessToken,
            apiKey: refreshed.accessToken,
            refreshToken: refreshed.refreshToken || c.refreshToken,
            connectedAt: Date.now(),
        };
        chatDB.setPlatformKv('bling', next);
        logger.info('Bling OAuth: access_token renovado via refresh_token');
        return refreshed.accessToken;
    }
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRateLimitError(status, message) {
    if (status === 429) return true;
    return /limite de requisi|rate.?limit|too many requests|throttl/i.test(String(message || ''));
}

async function blingFetch(path, token, { method = 'GET', body, retries = 3 } = {}) {
    const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
    const opts = { method, headers: { ...authHeaders(token) } };
    if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }

    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const res = await fetch(url, opts);
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }
        if (res.ok) return json;

        const fields = Array.isArray(json?.error?.fields)
            ? json.error.fields.map((f) => f.msg || f.message || f.code).filter(Boolean).join('; ')
            : '';
        const base = json?.error?.description || json?.error?.message || text?.slice(0, 200) || `HTTP ${res.status}`;
        const msg = fields ? `${base} (${fields})` : base;
        lastErr = new Error(msg);

        if (isRateLimitError(res.status, msg) && attempt < retries) {
            const retryAfter = Number(res.headers.get('retry-after'));
            const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
                ? Math.min(retryAfter * 1000, 12000)
                : Math.min(800 * (2 ** attempt), 8000);
            logger.warn(`Bling rate limit — aguardando ${waitMs}ms (${attempt + 1}/${retries})`, path);
            await sleep(waitMs);
            continue;
        }
        throw lastErr;
    }
    throw lastErr || new Error('Falha na API Bling');
}

/** Testa token — lista 1 pedido. */
export async function testBlingConnection(token) {
    const cfg = chatDB.getPlatformKv('bling') || {};
    const t = String(token || '').trim() || await ensureValidBlingToken(cfg);
    if (!t) throw new Error('Token Bling expirado. Clique em Autorizar no Bling novamente.');
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

/** Lista produtos Bling (paginado). */
export async function fetchBlingProductsPage(page = 1, limit = 100, token) {
    const t = token || await ensureValidBlingToken();
    if (!t) throw new Error('Token Bling inválido ou expirado. Autorize novamente em Integrações.');
    const json = await blingFetch(
        `/produtos?pagina=${page}&limite=${Math.min(100, limit)}`,
        t,
    );
    return Array.isArray(json?.data) ? json.data : [];
}

/** Detalhe de produto Bling. */
export async function fetchBlingProduct(productId, token) {
    const id = String(productId || '').trim();
    if (!id) return null;
    const t = token || await ensureValidBlingToken();
    if (!t) return null;
    const json = await blingFetch(`/produtos/${encodeURIComponent(id)}`, t);
    return json?.data || json;
}

/**
 * Atualiza parcialmente um produto no Bling (PATCH).
 * Campos: codigo, nome, preco, peso, dimensoes, ncm, marca, categoria.
 */
export async function patchBlingProduct(productId, patch = {}) {
    const id = String(productId || '').trim();
    if (!id) throw new Error('ID do produto Bling é obrigatório.');
    const token = await ensureValidBlingToken();
    if (!token) throw new Error('Token Bling inválido ou expirado. Autorize novamente em Integrações.');

    const body = {};
    if (patch.sku !== undefined) body.codigo = String(patch.sku || '').trim();
    if (patch.name !== undefined) body.nome = String(patch.name || '').trim();
    if (patch.price !== undefined && patch.price !== null && patch.price !== '') {
        body.preco = Number(patch.price);
    }
    if (patch.weight !== undefined && patch.weight !== null && patch.weight !== '') {
        const w = Number(String(patch.weight).replace(',', '.'));
        if (Number.isFinite(w)) {
            body.pesoBruto = w;
            body.pesoLiquido = w;
            body.pesoLiq = w;
        }
    }
    const hasDim = ['height', 'width', 'length'].some((k) => patch[k] !== undefined && patch[k] !== null && patch[k] !== '');
    if (hasDim) {
        body.dimensoes = {};
        if (patch.height !== undefined && patch.height !== '') body.dimensoes.altura = Number(String(patch.height).replace(',', '.'));
        if (patch.width !== undefined && patch.width !== '') body.dimensoes.largura = Number(String(patch.width).replace(',', '.'));
        if (patch.length !== undefined && patch.length !== '') body.dimensoes.profundidade = Number(String(patch.length).replace(',', '.'));
    }
    if (patch.ncm !== undefined) {
        const ncm = String(patch.ncm || '').replace(/\D/g, '');
        body.tributacao = { ncm: ncm || String(patch.ncm || '').trim() };
    }
    if (patch.brand !== undefined || patch.marca !== undefined) {
        body.marca = String(patch.brand ?? patch.marca ?? '').trim();
    }
    if (patch.shortDescription !== undefined || patch.descricaoCurta !== undefined) {
        body.descricaoCurta = String(patch.shortDescription ?? patch.descricaoCurta ?? '');
    }
    if (patch.description !== undefined || patch.descricaoComplementar !== undefined) {
        body.descricaoComplementar = String(patch.description ?? patch.descricaoComplementar ?? '');
    }
    if (patch.categoryId !== undefined || patch.categoriaId !== undefined) {
        const catId = Number(patch.categoryId ?? patch.categoriaId);
        if (Number.isFinite(catId) && catId > 0) {
            body.categoria = { id: catId };
        }
    }
    if (patch.situacao !== undefined || patch.status !== undefined) {
        const s = String(patch.situacao || patch.status || '').trim().toUpperCase();
        if (s === 'A' || s === 'I' || s === 'ATIVO' || s === 'INATIVO') {
            body.situacao = (s === 'A' || s === 'ATIVO') ? 'A' : 'I';
        }
    }

    if (Object.keys(body).length === 0) {
        throw new Error('Nenhum campo para atualizar.');
    }

    await blingFetch(`/produtos/${encodeURIComponent(id)}`, token, { method: 'PATCH', body });
    return fetchBlingProduct(id, token);
}

/**
 * Define imagens do produto via URLs externas.
 * Envia midia.imagens.imagensURL; o Bling baixa e grava como internas.
 * ATENÇÃO: isso **adiciona** — não remove as antigas. Use replaceBlingProductImages.
 * @param {string} productId
 * @param {string[]} imageUrls
 * @param {{ expectCleared?: boolean, expectedCount?: number }} [opts]
 */
export async function setBlingProductExternalImages(productId, imageUrls = [], opts = {}) {
    const id = String(productId || '').trim();
    if (!id) throw new Error('ID do produto Bling é obrigatório.');
    const urls = (Array.isArray(imageUrls) ? imageUrls : [])
        .map((u) => String(u || '').trim())
        .filter((u) => /^https?:\/\//i.test(u));
    if (!urls.length) throw new Error('Informe ao menos uma URL de imagem válida.');

    const token = await ensureValidBlingToken();
    if (!token) throw new Error('Token Bling inválido ou expirado. Autorize novamente em Integrações.');

    const expected = Math.min(urls.length, 10);
    const expectCleared = opts.expectCleared === true;
    const expectedCount = Number(opts.expectedCount) > 0 ? Number(opts.expectedCount) : expected;

    // Com "Imagens armazenadas no Bling", o campo que grava é imagensURL
    const links = urls.slice(0, 10).map((link) => ({ link }));

    const countImages = (product) => {
        const mid = product?.midia?.imagens || {};
        return (mid.internas?.length || 0) + (mid.externas?.length || 0) + (mid.imagensURL?.length || 0);
    };

    if (expectCleared) {
        const cur = await fetchBlingProduct(id, token);
        const n = countImages(cur);
        if (n > 0) {
            throw new Error(
                `Galeria ainda tinha ${n} imagem(ns) antes de gravar as novas — limpeza incompleta.`,
            );
        }
    }

    await blingFetch(`/produtos/${encodeURIComponent(id)}`, token, {
        method: 'PATCH',
        body: { midia: { imagens: { imagensURL: links } } },
    });

    /** Espera a quantidade esperada (não só “> 0”, senão mistura com restos). */
    const started = Date.now();
    let last = null;
    while (Date.now() - started < 20000) {
        await new Promise((r) => setTimeout(r, 1500));
        last = await fetchBlingProduct(id, token);
        const n = countImages(last);
        if (n >= expectedCount) return last;
        // Se passou do esperado (não limpou), aborta para não “aceitar” galeria suja
        if (n > expectedCount + 1) {
            throw new Error(
                `Bling ficou com ${n} imagens (esperado ${expectedCount}) — possível duplicação.`,
            );
        }
    }
    const finalCount = countImages(last);
    if (finalCount > 0 && finalCount <= expectedCount) return last;
    throw new Error(
        `Bling não consolidou as imagens a tempo (tem ${finalCount}, esperado ${expectedCount}). `
        + 'Confirme "Imagens armazenadas no Bling".',
    );
}

/**
 * Remove todas as imagens do produto no Bling (internas/externas).
 * PATCH com array vazio NÃO limpa; precisa PUT com midia vazia + campos obrigatórios.
 */
export async function clearBlingProductImages(productId) {
    const id = String(productId || '').trim();
    if (!id) throw new Error('ID do produto Bling é obrigatório.');
    const token = await ensureValidBlingToken();
    if (!token) throw new Error('Token Bling inválido ou expirado. Autorize novamente em Integrações.');

    const prod = await fetchBlingProduct(id, token);
    if (!prod) throw new Error('Produto Bling não encontrado.');

    const putBody = {
        nome: prod.nome || prod.codigo || id,
        codigo: prod.codigo || undefined,
        tipo: prod.tipo || 'P',
        situacao: prod.situacao || 'A',
        formato: prod.formato || 'S',
        preco: prod.preco,
        unidade: prod.unidade || 'UN',
        midia: {
            imagens: {
                externas: [],
                imagensURL: [],
            },
        },
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
        await blingFetch(`/produtos/${encodeURIComponent(id)}`, token, {
            method: 'PUT',
            body: putBody,
        });

        const started = Date.now();
        while (Date.now() - started < 12000) {
            await new Promise((r) => setTimeout(r, 1200));
            const last = await fetchBlingProduct(id, token);
            const mid = last?.midia?.imagens || {};
            const n = (mid.internas?.length || 0) + (mid.externas?.length || 0) + (mid.imagensURL?.length || 0);
            if (n === 0) return last;
        }
        logger.warn('Bling clear images: tentativa sem zerar', { id, attempt: attempt + 1 });
        await new Promise((r) => setTimeout(r, 2000));
    }

    const still = await fetchBlingProduct(id, token);
    const mid = still?.midia?.imagens || {};
    const n = (mid.internas?.length || 0) + (mid.externas?.length || 0);
    throw new Error(`Não foi possível limpar as imagens do Bling (ainda há ${n}).`);
}

/**
 * Substitui a galeria: apaga as atuais e grava só as URLs novas (Bling baixa e armazena).
 */
export async function replaceBlingProductImages(productId, imageUrls = []) {
    const urls = (Array.isArray(imageUrls) ? imageUrls : [])
        .map((u) => String(u || '').trim())
        .filter((u) => /^https?:\/\//i.test(u));
    if (!urls.length) throw new Error('Informe ao menos uma URL de imagem válida.');

    await clearBlingProductImages(productId);
    // Pausa para o Bling consolidar o PUT vazio antes do PATCH
    await new Promise((r) => setTimeout(r, 2000));
    return setBlingProductExternalImages(productId, urls, {
        expectCleared: true,
        expectedCount: Math.min(urls.length, 10),
    });
}

function mapBlingCategoryRow(c) {
    return {
        id: Number(c?.id),
        name: String(c?.descricao || '').trim(),
        parentId: Number(c?.categoriaPai?.id || 0) || null,
    };
}

/** Lista categorias de produtos do Bling. */
export async function fetchBlingProductCategories(token) {
    const t = token || await ensureValidBlingToken();
    if (!t) throw new Error('Token Bling inválido ou expirado. Autorize novamente em Integrações.');
    const out = [];
    for (let page = 1; page <= 50; page += 1) {
        const json = await blingFetch(`/categorias/produtos?pagina=${page}&limite=100`, t);
        const rows = Array.isArray(json?.data) ? json.data : [];
        out.push(...rows.map(mapBlingCategoryRow));
        if (rows.length < 100) break;
    }
    return out.filter((c) => c.id && c.name);
}

/** Uma categoria de produto pelo ID (inclui “Categoria padrão”, que a lista omite). */
export async function fetchBlingProductCategoryById(categoryId, token) {
    const id = Number(categoryId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const t = token || await ensureValidBlingToken();
    if (!t) return null;
    try {
        const json = await blingFetch(`/categorias/produtos/${encodeURIComponent(id)}`, t);
        const mapped = mapBlingCategoryRow(json?.data || json);
        return mapped.id ? mapped : null;
    } catch (err) {
        logger.warn('Bling: categoria por ID falhou', id, err?.message || err);
        return null;
    }
}

/** Categorias de loja/canal (ex.: “Anéis” na loja) vinculadas à categoria de produto. */
export async function fetchBlingStoreCategories(token) {
    const t = token || await ensureValidBlingToken();
    if (!t) return [];
    const out = [];
    for (let page = 1; page <= 50; page += 1) {
        const json = await blingFetch(`/categorias/lojas?pagina=${page}&limite=100`, t);
        const rows = Array.isArray(json?.data) ? json.data : [];
        out.push(...rows.map((c) => ({
            id: Number(c.id),
            name: String(c.descricao || '').trim(),
            productCategoryId: Number(c.categoriaProduto?.id || 0) || null,
            storeId: Number(c.loja?.id || 0) || null,
        })));
        if (rows.length < 100) break;
    }
    return out.filter((c) => c.id && c.name);
}

/** Cria categoria de produto no Bling. */
export async function createBlingProductCategory({ name, parentId = null } = {}, token) {
    const descricao = String(name || '').trim();
    if (!descricao) throw new Error('Informe o nome da categoria.');
    const t = token || await ensureValidBlingToken();
    if (!t) throw new Error('Token Bling inválido ou expirado. Autorize novamente em Integrações.');
    const body = { descricao };
    const pid = Number(parentId);
    if (Number.isFinite(pid) && pid > 0) {
        body.categoriaPai = { id: pid };
    }
    const json = await blingFetch('/categorias/produtos', t, { method: 'POST', body });
    const created = json?.data || json;
    return {
        id: Number(created?.id),
        name: String(created?.descricao || descricao).trim(),
        parentId: Number(created?.categoriaPai?.id || pid || 0) || null,
    };
}

/** Altera situação do produto (A=ativo, I=inativo). Endpoint dedicado do Bling. */
export async function setBlingProductSituation(productId, situacao = 'I') {
    const id = String(productId || '').trim();
    if (!id) throw new Error('ID do produto Bling é obrigatório.');
    const sit = String(situacao || 'I').toUpperCase() === 'A' ? 'A' : 'I';
    const token = await ensureValidBlingToken();
    if (!token) throw new Error('Token Bling inválido ou expirado. Autorize novamente em Integrações.');
    let lastErr = null;
    try {
        await blingFetch(`/produtos/${encodeURIComponent(id)}/situacoes`, token, {
            method: 'PATCH',
            body: { situacao: sit },
        });
    } catch (err) {
        lastErr = err;
        try {
            await blingFetch(`/produtos/${encodeURIComponent(id)}`, token, {
                method: 'PATCH',
                body: { situacao: sit },
            });
            lastErr = null;
        } catch (err2) {
            lastErr = err2;
        }
    }
    if (lastErr) {
        throw new Error(lastErr?.message || String(lastErr) || 'Falha ao alterar situação no Bling.');
    }
    const updated = await fetchBlingProduct(id, token);
    const got = String(updated?.situacao || '').toUpperCase();
    if (got && got !== sit && got !== (sit === 'I' ? 'INATIVO' : 'ATIVO')) {
        // Alguns retornos usam só A/I; se veio outro valor, avisa
        if (!((sit === 'I' && (got === 'I' || got.startsWith('I'))) || (sit === 'A' && (got === 'A' || got.startsWith('A'))))) {
            throw new Error(`Bling não confirmou situação ${sit} (retornou ${updated?.situacao || 'vazio'}).`);
        }
    }
    return updated;
}

/** Remove produto no Bling (DELETE). Pode falhar se houver vínculos (pedidos, NF, etc.). */
export async function deleteBlingProduct(productId) {
    const id = String(productId || '').trim();
    if (!id) throw new Error('ID do produto Bling é obrigatório.');
    const token = await ensureValidBlingToken();
    if (!token) throw new Error('Token Bling inválido ou expirado. Autorize novamente em Integrações.');
    try {
        await blingFetch(`/produtos/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
    } catch (err) {
        const msg = err?.message || String(err);
        if (/não pode ser removido|problemas de validação|VALIDATION/i.test(msg)) {
            throw new Error(
                'O Bling não permite excluir este produto (geralmente tem pedido, NF ou vínculo com loja). '
                + 'Use Inativar — ele some das vendas sem apagar o histórico.',
            );
        }
        throw err;
    }
    return { id };
}

/** Busca pedido pelo número visível (ex.: #2828) quando o webhook não envia o ID interno. */
export async function fetchBlingOrderByNumero(numero, token) {
    const n = String(numero || '').trim();
    if (!n) return null;
    const t = token || getBlingAccessToken();
    if (!t) return null;
    const json = await blingFetch(
        `/pedidos/vendas?pagina=1&limite=1&numero=${encodeURIComponent(n)}`,
        t,
    );
    const row = Array.isArray(json?.data) ? json.data[0] : null;
    if (!row?.id) return null;
    return fetchBlingOrder(row.id, t);
}

/** Contato completo (telefone/celular) — o pedido só traz id/nome do contato. */
export async function fetchBlingContact(contactId, token) {
    const id = String(contactId || '').trim();
    if (!id) return null;
    const t = token || getBlingAccessToken();
    if (!t) return null;
    const json = await blingFetch(`/contatos/${encodeURIComponent(id)}`, t);
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

function truncateText(text, max = 42) {
    const s = String(text || '').trim();
    if (!s) return '';
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1)}…`;
}

function formatBrl(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function itemDescription(item) {
    const prod = item?.produto || {};
    return String(
        item?.descricao
        || item?.descricaoDetalhada
        || prod?.descricao
        || prod?.nome
        || item?.codigo
        || '',
    ).trim();
}

/** Resume itens do pedido para WhatsApp (nome + quantidade). */
export function parseBlingItems(order) {
    const rawItems = Array.isArray(order?.itens) ? order.itens : [];
    const items = rawItems
        .map((item) => ({
            name: itemDescription(item),
            qty: Math.max(1, Number(item?.quantidade) || 1),
        }))
        .filter((i) => i.name);

    const totalQty = items.reduce((sum, i) => sum + i.qty, 0);
    const primeiroProduto = items[0]?.name ? truncateText(items[0].name) : '';

    let produtos = '';
    if (items.length === 1) {
        produtos = `${items[0].qty}x ${truncateText(items[0].name)}`;
    } else if (items.length > 1 && items.length <= 3) {
        produtos = items.map((i) => `${i.qty}x ${truncateText(i.name, 36)}`).join(', ');
    } else if (items.length > 3) {
        produtos = `${items[0].qty}x ${truncateText(items[0].name)} e mais ${items.length - 1} item(ns)`;
    }

    return {
        items,
        produtos,
        primeiroProduto,
        quantidade: totalQty ? String(totalQty) : '',
        total: formatBrl(order?.total),
    };
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
    const itemSummary = parseBlingItems(order);
    return {
        orderId: String(orderId),
        numero: String(numero),
        customer,
        phone,
        status,
        rastreio,
        produtos: itemSummary.produtos,
        primeiroProduto: itemSummary.primeiroProduto,
        quantidade: itemSummary.quantidade,
        total: itemSummary.total,
        raw: order,
    };
}

/** Contexto pronto para templates de mensagem Bling. */
export function buildBlingMessageContext(order) {
    if (!order) return {};
    const mapped = order.customer !== undefined ? order : mapBlingOrder(order);
    if (!mapped) return {};
    return {
        customer: mapped.customer,
        numero: mapped.numero,
        orderId: mapped.orderId,
        rastreio: mapped.rastreio,
        status: mapped.status,
        produtos: mapped.produtos,
        primeiroProduto: mapped.primeiroProduto,
        quantidade: mapped.quantidade,
        total: mapped.total,
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
    const rastreio = String(ctx.rastreio || '').trim();
    const produtos = String(ctx.produtos || '').trim();
    const primeiro = String(ctx.primeiroProduto || ctx.primeiro_produto || '').trim();
    const total = String(ctx.total || '').trim();
    const status = String(ctx.status || '').trim();

    let out = String(template || '')
        .replace(/\{\{nome\}\}/gi, name)
        .replace(/\{\{pedido\}\}/gi, String(ctx.numero || ctx.orderId || ''))
        .replace(/\{\{numero\}\}/gi, String(ctx.numero || ctx.orderId || ''))
        .replace(/\{\{rastreio\}\}/gi, rastreio)
        .replace(/\{\{produtos\}\}/gi, produtos)
        .replace(/\{\{primeiro_produto\}\}/gi, primeiro)
        .replace(/\{\{quantidade\}\}/gi, String(ctx.quantidade || ''))
        .replace(/\{\{total\}\}/gi, total)
        .replace(/\{\{status\}\}/gi, status);

    if (!rastreio) {
        out = out.replace(/\s*[-—]?\s*rastreio:\s*\{\{rastreio\}\}/gi, '');
    }

    return out
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/:\s*\n\s*$/m, '.')
        .trim();
}

export function resolveBlingMessage(status, ctx, eventType = '') {
    const cfg = chatDB.getPlatformKv('bling') || {};
    const fullCtx = { ...ctx, status: status || ctx.status || '' };
    const mapped = (cfg.statusMap || []).find(
        (s) => s.active && s.blingStatus && status && s.blingStatus.toLowerCase() === String(status).toLowerCase()
    );
    if (mapped?.message) return interpolateBlingMessage(mapped.message, fullCtx);

    const evt = String(eventType || '').toLowerCase();
    if (evt.includes('created')) {
        const lines = [
            'Olá {{nome}}! Recebemos seu pedido #{{numero}}.',
            fullCtx.produtos ? '{{produtos}}' : '',
            fullCtx.total ? 'Total: {{total}}.' : '',
            'Em breve você recebe novidades por aqui.',
        ].filter(Boolean);
        return interpolateBlingMessage(lines.join('\n'), fullCtx);
    }

    const productHint = fullCtx.primeiroProduto ? ` ({{primeiro_produto}})` : '';
    return interpolateBlingMessage(
        `Olá {{nome}}! Atualização do pedido #{{numero}}${productHint}${status ? ` — ${status}` : ''}.`,
        fullCtx,
    );
}

async function attachContactPhone(mapped, token) {
    if (!mapped || mapped.phone) return mapped;
    const contactId = mapped.raw?.contato?.id;
    if (!contactId) return mapped;
    try {
        const contact = await fetchBlingContact(contactId, token);
        const phone = pickPhone(contact?.celular, contact?.telefone);
        if (phone) return { ...mapped, phone };
    } catch (err) {
        logger.warn('Bling: falha ao buscar contato na API', err?.message || err);
    }
    return mapped;
}

/** Enriquece webhook com GET pedido + contato quando há token e orderId. */
export async function enrichBlingFromApi(parsed) {
    const token = await ensureValidBlingToken().catch(() => '');
    if (!token || !parsed.orderId) return parsed.order;

    let full = null;
    try {
        full = await fetchBlingOrder(parsed.orderId, token);
    } catch (err) {
        const msg = String(err?.message || err);
        const looksLikeNumero = /^\d{1,6}$/.test(String(parsed.orderId));
        if (looksLikeNumero || /não foi encontrado|not found/i.test(msg)) {
            try {
                full = await fetchBlingOrderByNumero(parsed.orderId, token);
            } catch (err2) {
                logger.warn('Bling: falha ao buscar pedido por número', err2?.message || err2);
            }
        } else {
            logger.warn('Bling: falha ao buscar pedido na API', msg);
        }
    }

    if (full) {
        const mapped = mapBlingOrder(full);
        if (mapped) return attachContactPhone(mapped, token);
    }
    return parsed.order;
}

/** Eventos de pedido de venda (app Bling v3 ou simulação manual). */
export function isBlingOrderEvent(eventType) {
    const t = String(eventType || '').toLowerCase();
    return t.startsWith('order.') || t.startsWith('pedido.');
}

function phoneDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function phonesMatch(a, b) {
    const x = phoneDigits(a);
    const y = phoneDigits(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const sx = x.length >= 11 ? x.slice(-11) : x.slice(-10);
    const sy = y.length >= 11 ? y.slice(-11) : y.slice(-10);
    if (sx.length >= 10 && sx === sy) return true;
    // DDD + 8 dígitos (sem o 9) vs celular com 9
    if (sx.length === 11 && sy.length === 10 && sx.slice(0, 2) === sy.slice(0, 2) && sx.slice(3) === sy.slice(2)) {
        return true;
    }
    if (sy.length === 11 && sx.length === 10 && sy.slice(0, 2) === sx.slice(0, 2) && sy.slice(3) === sx.slice(2)) {
        return true;
    }
    return false;
}

/** Variantes BR para filtro telefone do Bling (pesquisa= NÃO busca fone). */
function phoneSearchVariants(phone) {
    const d = phoneDigits(phone);
    const out = [];
    const add = (v) => {
        if (v && v.length >= 8 && !out.includes(v)) out.push(v);
    };
    add(d);
    if (d.startsWith('55') && d.length >= 12) add(d.slice(2));
    if (d.length >= 11) add(d.slice(-11));
    if (d.length >= 10) add(d.slice(-10));
    const local11 = d.length >= 11 ? d.slice(-11) : '';
    if (local11.length === 11 && local11[2] === '9') {
        add(local11.slice(0, 2) + local11.slice(3)); // DDD + 8 sem o 9
    }
    // Prioriza nacional (11/10) — com 55 o filtro telefone costuma falhar
    return out.sort((a, b) => {
        const score = (v) => (v.startsWith('55') ? 3 : v.length === 11 ? 0 : v.length === 10 ? 1 : 2);
        return score(a) - score(b);
    });
}

/**
 * Busca cadastro + pedidos do contato pelo telefone (WhatsApp).
 * Usa filtro `telefone=` nos contatos e `idContato=` nos pedidos
 * (`pesquisa=` / `idsContatos[]` não filtram direito no Bling).
 * @returns {{ registered: boolean, contact: { id: string, name: string } | null, orders: object[] }}
 */
export async function fetchBlingOrdersByPhone(phone, { limit = 8 } = {}) {
    const empty = { registered: false, contact: null, orders: [] };
    const digits = phoneDigits(phone);
    if (digits.length < 10) return empty;
    const token = await ensureValidBlingToken();
    if (!token) throw new Error('Bling não conectado ou token expirado.');

    const variants = phoneSearchVariants(digits);
    /** @type {Map<string, string>} id -> nome */
    const matched = new Map();

    for (const q of variants.slice(0, 3)) {
        let contacts = [];
        try {
            const search = await blingFetch(
                `/contatos?pagina=1&limite=10&telefone=${encodeURIComponent(q)}`,
                token,
            );
            contacts = Array.isArray(search?.data) ? search.data : [];
        } catch (err) {
            logger.warn('Bling: busca contato por telefone falhou', err?.message || err);
            continue;
        }

        for (const c of contacts.slice(0, 10)) {
            if (!c?.id || matched.has(String(c.id))) continue;
            const listPhone = pickPhone(c?.celular, c?.telefone);
            if (listPhone) {
                if (!phonesMatch(listPhone, digits)) continue;
                matched.set(String(c.id), String(c.nome || c.name || '').trim());
                continue;
            }
            try {
                const detail = await fetchBlingContact(c.id, token);
                const cPhone = pickPhone(detail?.celular, detail?.telefone);
                if (cPhone && phonesMatch(cPhone, digits)) {
                    matched.set(
                        String(c.id),
                        String(detail?.nome || detail?.name || c.nome || '').trim(),
                    );
                }
            } catch {
                /* próximo */
            }
        }
        if (matched.size) break;
    }

    if (!matched.size) return empty;

    const contactIds = [...matched.keys()].slice(0, 3);
    const primaryId = contactIds[0];
    const contactName = matched.get(primaryId) || '';

    const out = [];
    const seen = new Set();

    for (const contactId of contactIds) {
        if (out.length >= limit) break;
        let rows = [];
        try {
            const ordersJson = await blingFetch(
                `/pedidos/vendas?pagina=1&limite=${Math.min(limit, 20)}&idContato=${encodeURIComponent(contactId)}`,
                token,
            );
            rows = Array.isArray(ordersJson?.data) ? ordersJson.data : [];
        } catch (err) {
            logger.warn('Bling: lista pedidos por contato falhou', err?.message || err);
            continue;
        }

        for (const row of rows) {
            if (out.length >= limit) break;
            if (!row?.id || seen.has(String(row.id))) continue;
            const rowContactId = row?.contato?.id != null ? String(row.contato.id) : '';
            if (rowContactId && rowContactId !== String(contactId)) continue;
            seen.add(String(row.id));
            const mapped = mapBlingOrder(row) || {
                orderId: String(row.id),
                numero: String(row.numero || row.id),
                customer: row?.contato?.nome || matched.get(String(contactId)) || contactName || '',
                phone: digits,
                status: situacaoLabel(row),
                rastreio: '',
                produtos: '',
                total: row?.total || '',
            };
            out.push({
                orderId: mapped.orderId,
                numero: mapped.numero,
                customer: mapped.customer,
                phone: mapped.phone || digits,
                status: mapped.status,
                rastreio: mapped.rastreio || '',
                produtos: mapped.produtos || '',
                total: mapped.total,
                date: row?.data || row?.dataCriacao || null,
            });
        }
    }

    // Listagem nem sempre traz rastreio — prioriza pedidos sem código / enviados
    await enrichOrdersWithTracking(out, token, Number(process.env.BLING_TRACKING_FETCH_MAX) || 5);

    return {
        registered: true,
        contact: { id: primaryId, name: contactName || '' },
        orders: out,
    };
}

/** Preenche rastreio/produtos via GET de detalhe (máx. N chamadas). Prioriza sem rastreio + status enviado. */
async function enrichOrdersWithTracking(orders, token, maxFetches = 5) {
    if (!Array.isArray(orders) || !orders.length || !token) return orders;
    const score = (o) => {
        let s = 0;
        if (!o.rastreio) s += 10;
        if (!o.produtos) s += 2;
        if (/envi|transit|transport|postad|despach|etiquet/i.test(String(o.status || ''))) s += 5;
        return s;
    };
    const ranked = [...orders].sort((a, b) => score(b) - score(a));
    let fetches = 0;
    for (const o of ranked) {
        if (fetches >= maxFetches) break;
        if (o.rastreio && o.produtos) continue;
        try {
            const full = await fetchBlingOrder(o.orderId, token);
            if (!full) continue;
            const mapped = mapBlingOrder(full);
            if (!mapped) continue;
            if (mapped.rastreio) o.rastreio = mapped.rastreio;
            if (mapped.produtos) o.produtos = mapped.produtos;
            if (mapped.status) o.status = mapped.status;
            if (mapped.total) o.total = mapped.total;
            fetches += 1;
        } catch (err) {
            logger.warn('Bling: detalhe pedido (rastreio) falhou', err?.message || err);
        }
    }
    return orders;
}


export default {
    getBlingAccessToken,
    ensureValidBlingToken,
    testBlingConnection,
    fetchBlingOrder,
    fetchBlingOrderByNumero,
    fetchBlingContact,
    fetchBlingOrdersByPhone,
    fetchBlingProductsPage,
    fetchBlingProduct,
    fetchBlingProductCategories,
    fetchBlingProductCategoryById,
    fetchBlingStoreCategories,
    createBlingProductCategory,
    patchBlingProduct,
    setBlingProductExternalImages,
    clearBlingProductImages,
    replaceBlingProductImages,
    setBlingProductSituation,
    deleteBlingProduct,
    mapBlingOrder,
    parseBlingItems,
    buildBlingMessageContext,
    parseBlingWebhookBody,
    interpolateBlingMessage,
    resolveBlingMessage,
    enrichBlingFromApi,
    isBlingOrderEvent,
};
