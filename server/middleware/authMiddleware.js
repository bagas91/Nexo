/**
 * Middleware de autenticação — JWT de usuário ou API_KEY (legado).
 * Operators: acesso por módulo (config/modules.js).
 */

import { verifyToken, extractBearer } from '../utils/auth.js';
import { resolveApiModule, userHasModule, userHasAnyAppModule } from '../config/modules.js';
import chatDB from '../db/database.js';

const API_KEY = process.env.API_KEY;

const PUBLIC_PATHS = new Set([
    '/api/login',
    '/api/health'
]);

function isPublicApiPath(pathname) {
    if (PUBLIC_PATHS.has(pathname)) return true;
    // Bling precisa baixar WebP otimizado sem JWT
    if (pathname.startsWith('/api/catalog/optimized-images/')) return true;
    return false;
}

export function authenticate(req, res, next) {
    if (!req.path.startsWith('/api')) return next();
    if (isPublicApiPath(req.path)) return next();

    if (API_KEY) {
        const key = req.headers['x-api-key']
            || (req.headers.authorization?.startsWith('Bearer ') && req.headers.authorization.slice(7));
        if (key === API_KEY) {
            req.user = { id: 'api-key', email: 'api', name: 'API Key', role: 'superadmin', modules: ['*'], tokenVersion: 0 };
            return next();
        }
    }

    const token = extractBearer(req)
        || (req.path.startsWith('/api/studio/files/') && req.query.token ? String(req.query.token) : null)
        || (req.path.startsWith('/api/catalog/check-files/') && req.query.token ? String(req.query.token) : null)
        || ((req.path.startsWith('/api/inbox/media/') || req.path.startsWith('/api/inbox/avatars/')) && req.query.token ? String(req.query.token) : null);
    if (!token) {
        return res.status(401).json({ error: 'Não autenticado. Faça login.' });
    }

    const user = verifyToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }

    // Normaliza creator legado → operator
    if (user.role === 'creator') user.role = 'operator';
    if (!Array.isArray(user.modules)) user.modules = [];

    // Valida tokenVersion + active no banco (forçar logout / desativar)
    if (user.id && user.id !== 'api-key') {
        const row = chatDB.getUserById(user.id);
        if (!row || !row.active) {
            return res.status(401).json({ error: 'Sessão inválida. Faça login novamente.' });
        }
        const dbTv = Number(row.tokenVersion) || 0;
        const tokTv = Number(user.tv) || 0;
        if (dbTv !== tokTv) {
            return res.status(401).json({ error: 'Sessão encerrada. Faça login novamente.' });
        }
        // Mantém modules frescos do token; role do banco
        if (row.role === 'superadmin') {
            user.role = 'superadmin';
            user.modules = ['*'];
        }
        user.tokenVersion = dbTv;
    }

    req.user = user;

    if (user.role === 'superadmin') return next();

    const needed = resolveApiModule(req.path, req.method);

    if (needed === 'superadmin') {
        return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
    }

    if (needed === false) {
        return res.status(403).json({ error: 'Sem permissão para este recurso.' });
    }

    if (needed === null) {
        if (req.path === '/api/me' || req.path === '/api/ai/providers' || req.path.startsWith('/api/studio')) {
            return next();
        }
        if (!userHasAnyAppModule(user) && !req.path.startsWith('/api/ai/')) {
            return res.status(403).json({ error: 'Nenhum módulo liberado para este usuário.' });
        }
        return next();
    }

    if (!userHasModule(user, needed)) {
        return res.status(403).json({ error: `Sem permissão para o módulo "${needed}".` });
    }

    return next();
}

export function requireSuperadmin(req, res, next) {
    if (req.user?.role === 'superadmin') return next();
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
}

/** Exige um módulo específico (superadmin sempre passa). */
export function requireModule(moduleId) {
    return (req, res, next) => {
        if (req.user?.role === 'superadmin') return next();
        if (userHasModule(req.user, moduleId)) return next();
        return res.status(403).json({ error: `Sem permissão para o módulo "${moduleId}".` });
    };
}

export default { authenticate, requireSuperadmin, requireModule };
