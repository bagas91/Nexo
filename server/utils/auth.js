/**
 * Autenticação por token assinado (HMAC) — sem dependências extras.
 */

import crypto from 'crypto';

const AUTH_SECRET = process.env.AUTH_SECRET || process.env.API_KEY || 'zapflow-dev-secret-change-in-production';
const TOKEN_TTL_MS = Number(process.env.AUTH_TOKEN_TTL_MS) || 7 * 24 * 60 * 60 * 1000;

export function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
    if (!stored || !String(stored).includes(':')) return false;
    const [salt, hash] = String(stored).split(':');
    const attempt = crypto.scryptSync(String(password), salt, 64).toString('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
    } catch {
        return false;
    }
}

export function signToken(user) {
    const payload = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        modules: user.role === 'superadmin' ? ['*'] : (Array.isArray(user.modules) ? user.modules : []),
        tv: Number(user.tokenVersion) || 0,
        exp: Date.now() + TOKEN_TTL_MS
    };
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
    return `${data}.${sig}`;
}

export function verifyToken(token) {
    if (!token || !String(token).includes('.')) return null;
    const [data, sig] = String(token).split('.');
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
    try {
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    } catch {
        return null;
    }
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
        if (!payload.exp || payload.exp < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}

export function extractBearer(req) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
    return null;
}

export default { hashPassword, verifyPassword, signToken, verifyToken, extractBearer };
