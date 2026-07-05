/**
 * API da plataforma — configs, entidades, eventos de integração.
 */

import express from 'express';
import chatDB from '../db/database.js';
import { ensurePlatformDefaults, getWebhookSecret } from '../utils/platformDefaults.js';
import { ensurePlatformSeeds } from '../utils/platformSeeds.js';
import { processWooWebhook, processBlingWebhook } from '../services/integrationWebhookService.js';
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

webhookRouter.post('/woocommerce', (req, res) => {
    if (!validateWebhookToken(req)) {
        return res.status(401).json({ error: 'Token de webhook inválido.' });
    }
    const eventType = req.headers['x-wc-webhook-topic'] || req.body?.event || req.body?.type || 'order.created';
    try {
        const event = processWooWebhook(eventType, req.body || {});
        res.json({ success: true, eventId: event?.id });
    } catch (err) {
        logger.error('Webhook WooCommerce', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

webhookRouter.post('/bling', (req, res) => {
    if (!validateWebhookToken(req)) {
        return res.status(401).json({ error: 'Token de webhook inválido.' });
    }
    const eventType = req.body?.event || req.body?.tipo || 'pedido.atualizado';
    try {
        const event = processBlingWebhook(eventType, req.body || {});
        res.json({ success: true, eventId: event?.id });
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
    res.json(value);
});

router.put('/kv/:key', requireSuperadmin, (req, res) => {
    const key = req.params.key;
    if (key === 'webhook_secret') {
        return res.status(403).json({ error: 'webhook_secret é somente leitura' });
    }
    chatDB.setPlatformKv(key, req.body);
    res.json({ success: true, value: chatDB.getPlatformKv(key) });
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

router.post('/integration-events/simulate', requireSuperadmin, (req, res) => {
    const { source, eventType, payload } = req.body || {};
    if (source === 'woocommerce') {
        return res.json(processWooWebhook(eventType || 'order.created', payload || {}));
    }
    if (source === 'bling') {
        return res.json(processBlingWebhook(eventType || 'pedido.atualizado', payload || {}));
    }
    return res.status(400).json({ error: 'source deve ser woocommerce ou bling' });
});

export default router;
