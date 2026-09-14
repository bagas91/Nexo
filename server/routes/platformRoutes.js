/**
 * API da plataforma — configs, entidades, eventos de integração.
 */

import express from 'express';
import chatDB from '../db/database.js';
import { ensurePlatformDefaults, getAttendanceConfig, getWebhookSecret } from '../utils/platformDefaults.js';
import { ensurePlatformSeeds } from '../utils/platformSeeds.js';
import { ensureEcommerceFollowUps } from '../utils/ecommerceFollowUps.js';
import { processBlingWebhook } from '../services/integrationWebhookService.js';
import { testBlingConnection, buildBlingAuthorizeUrl, ensureValidBlingToken } from '../services/blingService.js';
import {
    CRM_STAGES,
    getCrmProfile,
    upsertCrmContact,
    getOrdersForPhone,
    listCrmDeals,
    createCrmDeal,
    updateCrmDeal,
} from '../services/crmService.js';
import { createOAuthState, getRedirectUri } from '../routes/blingOAuth.js';
import { testWooConnection, normalizeStoreUrl } from '../services/wooService.js';
import { mergeWooConfig, maskWooConfigForClient, hasRealWooCredentials, getWooConsumerKey, getWooConsumerSecret } from '../utils/wooConfig.js';
import { mergeBlingConfig, maskBlingConfigForClient } from '../utils/blingConfig.js';
import { mergeMetaWhatsAppConfig, maskMetaWhatsAppConfigForClient } from '../utils/metaWhatsAppConfig.js';
import {
    verifyMetaWebhook,
    validateMetaSignature,
    handleMetaWebhookPayload,
    saveMetaConfig,
    getMetaConfigForClient,
    sendTestMessage,
    isMetaConnected,
} from '../services/metaWhatsAppService.js';
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
    logger.info('Webhook WooCommerce ignorado — integração desativada (loja é só vitrine)');
    res.json({ success: true, status: 'skipped', reason: 'WooCommerce desativado — use Bling para pedidos.' });
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

/** Cloud API Meta — verificação (GET) e mensagens (POST). Público. */
webhookRouter.get('/meta-whatsapp', (req, res) => {
    try {
        const result = verifyMetaWebhook(req.query || {});
        if (result.ok) {
            return res.status(200).send(result.challenge);
        }
        return res.status(403).json({ error: result.error || 'Forbidden' });
    } catch (err) {
        logger.error('Webhook Meta verify', err?.message || err);
        return res.status(500).json({ error: err?.message || String(err) });
    }
});

webhookRouter.post('/meta-whatsapp', async (req, res) => {
    try {
        const signature = req.headers['x-hub-signature-256'];
        const raw = typeof req.rawBody === 'string'
            ? req.rawBody
            : Buffer.isBuffer(req.rawBody)
                ? req.rawBody.toString('utf8')
                : JSON.stringify(req.body || {});
        if (!validateMetaSignature(raw, signature)) {
            logger.warn('Webhook Meta: assinatura inválida');
            return res.status(401).json({ error: 'Assinatura inválida' });
        }

        res.status(200).json({ success: true });
        handleMetaWebhookPayload(req.body || {}).catch((err) => {
            logger.error('Webhook Meta process', err?.message || err);
        });
    } catch (err) {
        logger.error('Webhook Meta', err?.message || err);
        if (!res.headersSent) res.status(500).json({ error: err?.message || String(err) });
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
    if (req.params.key === 'meta_whatsapp') {
        return res.json(maskMetaWhatsAppConfigForClient(value || {}));
    }
    if (req.params.key === 'attendance') {
        return res.json(getAttendanceConfig());
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
    } else if (key === 'meta_whatsapp') {
        body = mergeMetaWhatsAppConfig(chatDB.getPlatformKv('meta_whatsapp'), req.body);
    }
    chatDB.setPlatformKv(key, body);
    const saved = chatDB.getPlatformKv(key);
    let responseValue = saved;
    if (key === 'bling') responseValue = maskBlingConfigForClient(saved);
    if (key === 'woocommerce') responseValue = maskWooConfigForClient(saved);
    if (key === 'meta_whatsapp') responseValue = maskMetaWhatsAppConfigForClient(saved);
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
            return res.status(410).json({ error: 'WooCommerce desativado — use Bling para simular pedidos.' });
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
        const manual = String(req.body?.accessToken || req.body?.apiKey || '').trim();
        const token = manual || await ensureValidBlingToken(cfg);
        if (!token) return res.status(400).json({ error: 'Token Bling expirado. Clique em Autorizar no Bling novamente.' });
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

// --- CRM (e-commerce + venda assistida WhatsApp) ---
router.get('/crm/stages', (_req, res) => {
    res.json({ stages: CRM_STAGES });
});

router.get('/crm/profile', (req, res) => {
    try {
        const phone = String(req.query.phone || '');
        const name = req.query.name ? String(req.query.name) : undefined;
        const profile = getCrmProfile(phone, { name });
        res.json(profile);
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.put('/crm/profile', (req, res) => {
    try {
        const contact = upsertCrmContact(req.body || {});
        res.json({ success: true, contact });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.get('/crm/orders', async (req, res) => {
    try {
        const phone = String(req.query.phone || '');
        const result = await getOrdersForPhone(phone);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err), orders: [] });
    }
});

router.get('/crm/deals', (_req, res) => {
    res.json({ deals: listCrmDeals(), stages: CRM_STAGES });
});

router.post('/crm/deals', (req, res) => {
    try {
        const deal = createCrmDeal(req.body || {});
        res.status(201).json({ success: true, deal });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.patch('/crm/deals/:id', (req, res) => {
    try {
        const deal = updateCrmDeal(req.params.id, req.body || {});
        res.json({ success: true, deal });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

// --- Meta Cloud API (e-commerce) ---
router.get('/meta-whatsapp', (_req, res) => {
    res.json(getMetaConfigForClient());
});

router.put('/meta-whatsapp', requireSuperadmin, (req, res) => {
    try {
        const value = saveMetaConfig(req.body || {});
        res.json({ success: true, value });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

router.post('/meta-whatsapp/test', requireSuperadmin, async (req, res) => {
    try {
        if (!isMetaConnected()) {
            return res.status(409).json({ error: 'Cloud API Meta não configurada/conectada.' });
        }
        const phone = String(req.body?.phone || '').replace(/\D/g, '');
        if (phone.length < 10) {
            return res.status(400).json({ error: 'Informe phone com DDI (ex.: 5511999999999).' });
        }
        const result = await sendTestMessage(phone, req.body?.text);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

export default router;
