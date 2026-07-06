/**
 * API da plataforma — configs, entidades, eventos de integração.
 */

import express from 'express';
import chatDB from '../db/database.js';
import { ensurePlatformDefaults, getWebhookSecret } from '../utils/platformDefaults.js';
import { ensurePlatformSeeds } from '../utils/platformSeeds.js';
import { ensureEcommerceFollowUps } from '../utils/ecommerceFollowUps.js';
import { processWooWebhook, processBlingWebhook } from '../services/integrationWebhookService.js';
import { testBlingConnection, buildBlingAuthorizeUrl, getBlingAccessToken } from '../services/blingService.js';
import { createOAuthState, getRedirectUri } from '../routes/blingOAuth.js';
import { testWooConnection, normalizeStoreUrl } from '../services/wooService.js';
import { mergeWooConfig, maskWooConfigForClient, hasRealWooCredentials, getWooConsumerKey, getWooConsumerSecret } from '../utils/wooConfig.js';
import { requireSuperadmin } from '../middleware/authMiddleware.js';
import logger from '../utils/logger.js';

const router = express.Router();

const ENTITY_TYPES = new Set([
    'followups',
    'agents',
    'flows',
    'contacts',
    'conversations',
    'deals',
    'campaigns',
    'widgets',
    'tokens',
]);

ensurePlatformDefaults();
ensurePlatformSeeds();

function validateWebhookToken(req) {
    const token = req.query.token || req.headers['x-webhook-token'] || req.headers['x-nexo-webhook-token'];
    return token && token === getWebhookSecret();
}

// --- Webhooks (públicos com token) — montados antes do auth global ---
export const webhookRouter = express.Router();

webhookRouter.post('/woocommerce', async (req, res) => {
    if (!validateWebhookToken(req)) {
        return res.status(401).json({ error: 'Token de webhook inválido.' });
    }
    const eventType = req.headers['x-wc-webhook-topic'] || req.body?.event || req.body?.type || 'order.created';
    try {
        const event = await processWooWebhook(eventType, req.body || {});
        res.json({ success: true, eventId: event?.id, status: event?.status });
    } catch (err) {
        logger.error('Webhook WooCommerce', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

webhookRouter.post('/bling', async (req, res) => {
    if (!validateWebhookToken(req)) {
        return res.status(401).json({ error: 'Token de webhook inválido.' });
    }
    const eventType = req.body?.event || req.body?.tipo || req.body?.$action || 'pedido.atualizado';
    try {
        const event = await processBlingWebhook(eventType, req.body || {});
        res.json({ success: true, eventId: event?.id, status: event?.status });
    } catch (err) {
        logger.error('Webhook Bling', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

// --- KV settings ---
router.get('/kv/:key', (req, res) => {
    ensurePlatformDefaults();
ensurePlatformSeeds();
    const value = chatDB.getPlatformKv(req.params.key);
    if (value === null && req.params.key !== 'webhook_secret') {
        return res.status(404).json({ error: 'Configuração não encontrada' });
    }
    if (req.params.key === 'webhook_secret') {
        return res.json({ token: getWebhookSecret() });
    }
    if (req.params.key === 'bling' && value) {
        return res.json(maskBlingConfigForClient(value));
    }
    if (req.params.key === 'woocommerce' && value) {
        return res.json(maskWooConfigForClient(value));
    }
    res.json(value);
});

router.put('/kv/:key', requireSuperadmin, (req, res) => {
    const key = req.params.key;
    if (key === 'webhook_secret') {
        return res.status(403).json({ error: 'webhook_secret é somente leitura' });
    }
    let body = req.body;
    if (key === 'bling') {
        body = mergeBlingConfig(chatDB.getPlatformKv('bling'), req.body);
    } else if (key === 'woocommerce') {
        const merged = mergeWooConfig(chatDB.getPlatformKv('woocommerce'), req.body);
        body = {
            ...merged,
            storeUrl: normalizeStoreUrl(merged.storeUrl || req.body?.storeUrl),
        };
    }
    chatDB.setPlatformKv(key, body);
    const saved = chatDB.getPlatformKv(key);
    let responseValue = saved;
    if (key === 'bling') responseValue = maskBlingConfigForClient(saved);
    if (key === 'woocommerce') responseValue = maskWooConfigForClient(saved);
    res.json({ success: true, value: responseValue });
});

// --- Entidades ---
router.get('/entities/:type', (req, res) => {
    const type = req.params.type;
    if (!ENTITY_TYPES.has(type)) {
        return res.status(400).json({ error: 'Tipo de entidade inválido' });
    }
    res.json(chatDB.listPlatformEntities(type));
});

router.get('/entities/:type/:id', (req, res) => {
    const { type, id } = req.params;
    if (!ENTITY_TYPES.has(type)) {
        return res.status(400).json({ error: 'Tipo de entidade inválido' });
    }
    const item = chatDB.getPlatformEntity(type, id);
    if (!item) return res.status(404).json({ error: 'Não encontrado' });
    res.json(item);
});

router.post('/entities/:type', requireSuperadmin, (req, res) => {
    const type = req.params.type;
    if (!ENTITY_TYPES.has(type)) {
        return res.status(400).json({ error: 'Tipo de entidade inválido' });
    }
    const saved = chatDB.savePlatformEntity(type, req.body);
    res.status(201).json(saved);
});

router.put('/entities/:type/:id', requireSuperadmin, (req, res) => {
    const { type, id } = req.params;
    if (!ENTITY_TYPES.has(type)) {
        return res.status(400).json({ error: 'Tipo de entidade inválido' });
    }
    const saved = chatDB.savePlatformEntity(type, { ...req.body, id });
    res.json(saved);
});

router.delete('/entities/:type/:id', requireSuperadmin, (req, res) => {
    const { type, id } = req.params;
    if (!ENTITY_TYPES.has(type)) {
        return res.status(400).json({ error: 'Tipo de entidade inválido' });
    }
    const ok = chatDB.deletePlatformEntity(type, id);
    if (!ok) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ success: true });
});

// --- Eventos de integração ---
router.get('/integration-events', (req, res) => {
    const source = req.query.source || undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json(chatDB.listIntegrationEvents({ source, limit }));
});

router.post('/integration-events/simulate', requireSuperadmin, async (req, res) => {
    const { source, eventType, payload } = req.body || {};
    try {
        if (source === 'woocommerce') {
            const event = await processWooWebhook(eventType || 'order.created', payload || {});
            return res.json(event);
        }
        if (source === 'bling') {
            const event = await processBlingWebhook(eventType || 'pedido.atualizado', payload || {});
            return res.json(event);
        }
        return res.status(400).json({ error: 'source deve ser woocommerce ou bling' });
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

router.post('/woocommerce/test-connection', requireSuperadmin, async (req, res) => {
    try {
        const cfg = chatDB.getPlatformKv('woocommerce') || {};
        const body = req.body || {};
        const overrides = {
            storeUrl: body.storeUrl || cfg.storeUrl,
            consumerKey: String(body.consumerKey || '').trim() || undefined,
            consumerSecret: String(body.consumerSecret || '').trim() || undefined,
        };
        const result = await testWooConnection(overrides);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.put('/woocommerce/credentials', requireSuperadmin, async (req, res) => {
    try {
        const { storeUrl, consumerKey, consumerSecret } = req.body || {};
        const cfg = chatDB.getPlatformKv('woocommerce') || {};
        const next = mergeWooConfig(cfg, {
            ...cfg,
            storeUrl: normalizeStoreUrl(storeUrl || cfg.storeUrl),
            consumerKey: String(consumerKey || cfg.consumerKey || '').trim(),
            consumerSecret: String(consumerSecret || cfg.consumerSecret || '').trim(),
        });
        if (!next.storeUrl) return res.status(400).json({ error: 'Informe a URL da loja.' });
        if (!hasRealWooCredentials(next) && !String(consumerKey || '').trim()) {
            return res.status(400).json({ error: 'Informe Consumer Key e Consumer Secret.' });
        }
        await testWooConnection({
            storeUrl: next.storeUrl,
            consumerKey: getWooConsumerKey(next),
            consumerSecret: getWooConsumerSecret(next),
        });
        next.connected = true;
        next.connectedAt = Date.now();
        chatDB.setPlatformKv('woocommerce', next);
        const integrations = chatDB.getPlatformKv('integrations') || [];
        if (integrations.length) {
            chatDB.setPlatformKv('integrations', integrations.map((i) =>
                i.id === 'woocommerce' ? { ...i, connected: true, connectedAt: Date.now() } : i
            ));
        }
        res.json({ success: true, message: 'WooCommerce conectado com sucesso.', value: maskWooConfigForClient(next) });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.post('/bling/test-connection', requireSuperadmin, async (req, res) => {
    try {
        const cfg = chatDB.getPlatformKv('bling') || {};
        const token = String(req.body?.accessToken || req.body?.apiKey || '').trim() || getBlingAccessToken(cfg);
        if (!token) return res.status(400).json({ error: 'Nenhum token Bling configurado. Autorize o app ou cole o token.' });
        const result = await testBlingConnection(token);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.post('/bling/connect', requireSuperadmin, async (req, res) => {
    try {
        const { accessToken, apiKey } = req.body || {};
        const token = String(accessToken || apiKey || '').trim();
        if (!token) return res.status(400).json({ error: 'Informe o token de acesso OAuth do Bling.' });
        await testBlingConnection(token);
        const cfg = chatDB.getPlatformKv('bling') || {};
        const next = {
            ...cfg,
            connected: true,
            accessToken: token,
            apiKey: token,
            connectedAt: Date.now(),
        };
        chatDB.setPlatformKv('bling', next);
        const integrations = chatDB.getPlatformKv('integrations') || [];
        if (integrations.length) {
            chatDB.setPlatformKv('integrations', integrations.map((i) =>
                i.id === 'bling' ? { ...i, connected: true, connectedAt: Date.now() } : i
            ));
        }
        res.json({ success: true, message: 'Bling conectado com sucesso.' });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.get('/bling/oauth/redirect-uri', requireSuperadmin, (req, res) => {
    res.json({ redirectUri: getRedirectUri() });
});

router.get('/bling/oauth/authorize-url', requireSuperadmin, (req, res) => {
    try {
        const cfg = chatDB.getPlatformKv('bling') || {};
        const clientId = String(cfg.clientId || '').trim();
        const clientSecret = String(cfg.clientSecret || '').trim();
        if (!clientId || !clientSecret) {
            return res.status(400).json({ error: 'Salve Client ID e Client Secret antes de autorizar.' });
        }
        const state = createOAuthState();
        const url = buildBlingAuthorizeUrl(clientId, state);
        res.json({ url, redirectUri: getRedirectUri() });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.put('/bling/credentials', requireSuperadmin, (req, res) => {
    const { clientId, clientSecret } = req.body || {};
    const cfg = chatDB.getPlatformKv('bling') || {};
    const next = mergeBlingConfig(cfg, {
        ...cfg,
        clientId: String(clientId || cfg.clientId || '').trim(),
        clientSecret: String(clientSecret || cfg.clientSecret || '').trim(),
    });
    chatDB.setPlatformKv('bling', next);
    res.json({ success: true, redirectUri: getRedirectUri(), value: maskBlingConfigForClient(next) });
});

// --- Follow Ups: execução ---
router.get('/followups/runs', requireSuperadmin, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json(chatDB.listActiveFollowUpRuns(limit));
});

router.post('/followups/install-ecommerce', requireSuperadmin, (req, res) => {
    const added = ensureEcommerceFollowUps();
    res.json({
        success: true,
        added,
        message: added > 0 ? `${added} modelo(s) e-commerce adicionado(s).` : 'Modelos e-commerce já estavam instalados.',
    });
});

router.post('/followups/:id/enroll', requireSuperadmin, async (req, res) => {
    try {
        const { phone, contactName, chatId } = req.body || {};
        const { manualEnroll } = await import('../services/followUpEngine.js');
        const run = await manualEnroll(req.params.id, { phone, contactName, chatId });
        if (!run) {
            return res.status(409).json({ error: 'Contato já inscrito neste follow up ou inscrição falhou.' });
        }
        res.json({ success: true, run });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

export default router;
