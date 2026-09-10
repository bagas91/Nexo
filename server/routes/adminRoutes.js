/**
 * API Admin — controle, acessos, auditoria, saúde do sistema.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireSuperadmin } from '../middleware/authMiddleware.js';
import chatDB from '../db/database.js';
import userService from '../utils/userService.js';
import { clientIp, logAudit } from '../utils/auditService.js';
import { APP_MODULES } from '../config/modules.js';
import { getCatalogDashboard } from '../services/catalogQualityService.js';
import whatsappClient from '../services/whatsappClient.js';
import { ensureValidBlingToken } from '../services/blingService.js';
import { maskBlingConfigForClient } from '../utils/blingConfig.js';
import logger from '../utils/logger.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

router.use(requireSuperadmin);

/** Matriz de acessos: usuários × módulos */
router.get('/access', (_req, res) => {
    const users = userService.listUsers();
    res.json({
        modules: APP_MODULES,
        users: users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            active: u.active,
            modules: u.modules || [],
            lastLoginAt: u.lastLoginAt,
            createdAt: u.createdAt,
        })),
    });
});

/** Registros de auditoria */
router.get('/audit', (req, res) => {
    try {
        const action = req.query.action ? String(req.query.action) : undefined;
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const rows = chatDB.listAuditLogs({ action, limit, offset });
        const total = chatDB.countAuditLogs(action);
        res.json({ rows, total, limit, offset });
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

/** Saúde do sistema */
router.get('/health', async (_req, res) => {
    try {
        const wa = whatsappClient.getStatus?.() || {};
        let whatsapp = 'disconnected';
        if (wa.ready) whatsapp = 'connected';
        else if (wa.status === 'QR_READY' || wa.status === 'PAIRING_CODE_READY' || wa.qr) whatsapp = 'connecting';

        const blingRaw = chatDB.getPlatformKv('bling') || {};
        const blingMasked = maskBlingConfigForClient(blingRaw);
        let blingStatus = 'disconnected';
        let blingDetail = '';
        try {
            const token = await ensureValidBlingToken(blingRaw);
            if (token) {
                blingStatus = 'connected';
                blingDetail = 'Token válido';
            } else if (blingRaw.connected || blingRaw.accessToken || blingRaw.refreshToken) {
                blingStatus = 'error';
                blingDetail = 'Token expirado — reautorize';
            } else {
                blingDetail = 'Não configurado';
            }
        } catch (e) {
            blingStatus = 'error';
            blingDetail = e?.message || 'Falha ao validar Bling';
        }

        let catalog = null;
        try {
            catalog = getCatalogDashboard();
        } catch {
            catalog = null;
        }

        const users = userService.listUsers();
        const recentErrors = readRecentLogErrors(40);

        res.json({
            whatsapp: {
                status: whatsapp,
                raw: wa.status || null,
                ready: !!wa.ready,
            },
            bling: {
                status: blingStatus,
                detail: blingDetail,
                connected: !!blingMasked.connected,
                company: blingMasked.companyName || blingMasked.nome || null,
            },
            catalog: catalog
                ? {
                    blingCount: catalog.blingCount,
                    productsWithErrors: catalog.productsWithErrors,
                    issueTotal: catalog.issueTotal,
                    latestScan: catalog.latestScan
                        ? {
                            id: catalog.latestScan.id,
                            status: catalog.latestScan.status,
                            finishedAt: catalog.latestScan.finishedAt,
                            issueCount: catalog.latestScan.issueCount,
                            message: catalog.latestScan.message,
                        }
                        : null,
                }
                : null,
            users: {
                total: users.length,
                active: users.filter((u) => u.active).length,
                operators: users.filter((u) => u.role !== 'superadmin').length,
            },
            audit: {
                total: chatDB.countAuditLogs(),
            },
            recentErrors,
            serverTime: Date.now(),
        });
    } catch (err) {
        logger.error('Admin health', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

/** Forçar logout (invalida sessões) */
router.post('/users/:id/force-logout', (req, res) => {
    try {
        const user = userService.forceLogout(req.params.id, req.user, { ip: clientIp(req) });
        res.json({ success: true, user });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

/** Reset de senha */
router.post('/users/:id/reset-password', (req, res) => {
    try {
        const { password } = req.body || {};
        const user = userService.resetPassword(req.params.id, password, req.user, { ip: clientIp(req) });
        res.json({ success: true, user });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

function readRecentLogErrors(maxLines = 40) {
    try {
        const logsDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logsDir)) return [];
        const files = fs.readdirSync(logsDir)
            .filter((f) => f.startsWith('zapflow-') && f.endsWith('.log'))
            .sort()
            .reverse();
        if (!files.length) return [];
        const filePath = path.join(logsDir, files[0]);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        const errors = [];
        for (let i = lines.length - 1; i >= 0 && errors.length < maxLines; i--) {
            const line = lines[i];
            if (/\[ERROR\]|\[WARN\]/i.test(line)) {
                errors.push({
                    line: line.slice(0, 400),
                    level: /\[ERROR\]/i.test(line) ? 'error' : 'warn',
                });
            }
        }
        return errors;
    } catch {
        return [];
    }
}

export default router;
