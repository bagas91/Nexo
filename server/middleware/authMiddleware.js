/**
 * Middleware de autenticação — JWT de usuário ou API_KEY (legado).
 */

import { verifyToken, extractBearer } from '../utils/auth.js';

const API_KEY = process.env.API_KEY;

const PUBLIC_PATHS = new Set([
    '/api/login',
    '/api/health'
]);

const CREATOR_PATHS_PREFIX = '/api/studio';
const CREATOR_EXACT = new Set([
    '/api/me',
    '/api/ai/providers',
    '/api/ai/chat',
    '/api/ai/generate'
]);

function isCreatorAllowed(path) {
    if (CREATOR_EXACT.has(path)) return true;
    if (path.startsWith(CREATOR_PATHS_PREFIX)) return true;
    return false;
}

export function authenticate(req, res, next) {
    if (!req.path.startsWith('/api')) return next();
    if (PUBLIC_PATHS.has(req.path)) return next();

    if (API_KEY) {
        const key = req.headers['x-api-key']
            || (req.headers.authorization?.startsWith('Bearer ') && req.headers.authorization.slice(7));
        if (key === API_KEY) {
            req.user = { id: 'api-key', email: 'api', name: 'API Key', role: 'superadmin' };
            return next();
        }
    }

    const token = extractBearer(req) || (req.path.startsWith('/api/studio/files/') && req.query.token ? String(req.query.token) : null);
    if (!token) {
        return res.status(401).json({ error: 'Não autenticado. Faça login.' });
    }

    const user = verifyToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }

    req.user = user;

    if (user.role === 'superadmin') return next();

    if (user.role === 'creator' && isCreatorAllowed(req.path)) return next();

    return res.status(403).json({ error: 'Sem permissão para este recurso.' });
}

export function requireSuperadmin(req, res, next) {
    if (req.user?.role === 'superadmin') return next();
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
}

export default { authenticate, requireSuperadmin };
