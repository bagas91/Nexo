/**
 * Auditoria de ações sensíveis (admin).
 */

import chatDB from '../db/database.js';
import logger from './logger.js';

/**
 * @param {{
 *   actor?: { id?: string, email?: string, name?: string } | null,
 *   action: string,
 *   targetType?: string,
 *   targetId?: string,
 *   summary: string,
 *   meta?: object,
 *   ip?: string,
 * }} entry
 */
export function logAudit(entry) {
    try {
        const actor = entry.actor || {};
        return chatDB.insertAuditLog({
            actorId: actor.id || null,
            actorEmail: actor.email || null,
            actorName: actor.name || null,
            action: entry.action,
            targetType: entry.targetType || null,
            targetId: entry.targetId || null,
            summary: entry.summary || entry.action,
            meta: entry.meta || null,
            ip: entry.ip || null,
            ts: Date.now(),
        });
    } catch (err) {
        logger.warn('Audit log falhou', err?.message || err);
        return null;
    }
}

export function clientIp(req) {
    const xf = req?.headers?.['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
    return req?.ip || req?.socket?.remoteAddress || null;
}

export default { logAudit, clientIp };
