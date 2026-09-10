/**
 * Usuários do sistema — superadmin e operators com módulos.
 */

import crypto from 'crypto';
import chatDB from '../db/database.js';
import { hashPassword, verifyPassword, signToken } from './auth.js';
import logger from './logger.js';
import { normalizeModules, parseModulesJson } from '../config/modules.js';
import { logAudit } from './auditService.js';

function adminConfig() {
    return {
        user: process.env.ADMIN_USER || 'va_cleber',
        pass: process.env.ADMIN_PASS || 'clebersantos',
        name: process.env.ADMIN_NAME || 'Administrador'
    };
}

export function sanitizeUser(row) {
    if (!row) return null;
    const role = row.role === 'creator' ? 'operator' : row.role;
    const modules = role === 'superadmin'
        ? ['*']
        : parseModulesJson(row.modules);
    return {
        id: row.id,
        email: row.email,
        name: row.name,
        role,
        active: !!row.active,
        createdAt: row.createdAt,
        modules,
        tokenVersion: Number(row.tokenVersion) || 0,
        lastLoginAt: row.lastLoginAt || null,
        phone: row.phone ? String(row.phone).replace(/\D/g, '') : null,
    };
}

export function initSeedSuperadmin() {
    const { user: ADMIN_USER, pass: ADMIN_PASS, name: ADMIN_NAME } = adminConfig();
    const email = ADMIN_USER.trim().toLowerCase();
    const existingByEmail = chatDB.getUserByEmail(email);
    const existingById = chatDB.getUserById('superadmin');
    const existingSuperadmin = chatDB.getAllUsers().find((u) => u.role === 'superadmin');
    const target = existingByEmail || existingById || existingSuperadmin;

    if (target) {
        chatDB.updateUser(target.id, {
            email,
            name: ADMIN_NAME,
            passwordHash: hashPassword(ADMIN_PASS),
            role: 'superadmin',
            active: 1,
            modules: null,
        });
        logger.info(`Usuários: superadmin sincronizado (${email})`);
        return;
    }

    chatDB.createUser({
        id: 'superadmin',
        email,
        passwordHash: hashPassword(ADMIN_PASS),
        name: ADMIN_NAME,
        role: 'superadmin',
        active: 1,
        modules: null,
        tokenVersion: 0,
    });
    logger.info(`Usuários: superadmin criado (${email})`);
}

export function login(email, password, { ip } = {}) {
    const user = chatDB.getUserByEmail(String(email || '').trim().toLowerCase());
    if (!user || !user.active) {
        logAudit({
            action: 'login_failed',
            summary: `Login falhou: ${String(email || '').trim().toLowerCase() || '(vazio)'}`,
            meta: { email: String(email || '').trim().toLowerCase() },
            ip,
        });
        return null;
    }
    if (!verifyPassword(password, user.passwordHash)) {
        logAudit({
            action: 'login_failed',
            summary: `Senha inválida: ${user.email}`,
            targetType: 'user',
            targetId: user.id,
            meta: { email: user.email },
            ip,
        });
        return null;
    }
    chatDB.updateUser(user.id, { lastLoginAt: Date.now() });
    const fresh = chatDB.getUserById(user.id);
    const safe = sanitizeUser(fresh);
    const token = signToken(safe);
    logAudit({
        actor: safe,
        action: 'login',
        targetType: 'user',
        targetId: safe.id,
        summary: `Login: ${safe.email}`,
        ip,
    });
    return { user: safe, token };
}

export function listUsers() {
    return chatDB.getAllUsers().map(sanitizeUser);
}

export function createUser({ email, password, name, role = 'operator', modules = [], phone = null }, actor = null, { ip } = {}) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !password || !name) {
        throw new Error('Informe nome, e-mail/login e senha.');
    }
    if (chatDB.getUserByEmail(normalizedEmail)) {
        throw new Error('Já existe um usuário com este login.');
    }
    let finalRole = role === 'creator' ? 'operator' : role;
    const validRoles = new Set(['operator', 'superadmin']);
    if (!validRoles.has(finalRole)) throw new Error('Perfil inválido.');
    if (finalRole === 'superadmin') {
        throw new Error('Não é possível criar outro superadmin por aqui.');
    }
    const mods = normalizeModules(modules);
    const phoneDigits = phone ? String(phone).replace(/\D/g, '') : '';
    if (phoneDigits && phoneDigits.length < 10) {
        throw new Error('Telefone WhatsApp inválido (use DDI+DDD+número, ex. 5562…).');
    }
    const id = crypto.randomUUID();
    chatDB.createUser({
        id,
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        name: String(name).trim(),
        role: finalRole,
        active: 1,
        modules: mods,
        tokenVersion: 0,
        phone: phoneDigits || null,
    });
    const created = sanitizeUser(chatDB.getUserById(id));
    logAudit({
        actor,
        action: 'user_created',
        targetType: 'user',
        targetId: id,
        summary: `Usuário criado: ${normalizedEmail} (${mods.length} módulo(s))`,
        meta: { modules: mods, name: created.name, phone: created.phone },
        ip,
    });
    return created;
}

export function updateUser(id, { name, password, role, active, modules, phone }, actor = null, { ip } = {}) {
    const user = chatDB.getUserById(id);
    if (!user) throw new Error('Usuário não encontrado.');
    const patch = {};
    const changes = [];
    let invalidate = false;

    if (name !== undefined) {
        patch.name = String(name).trim();
        if (patch.name !== user.name) changes.push('nome');
    }
    if (role !== undefined) {
        const r = role === 'creator' ? 'operator' : role;
        if (user.role === 'superadmin' && r !== 'superadmin') {
            throw new Error('Não é possível alterar o perfil do superadmin.');
        }
        if (r === 'superadmin' && user.role !== 'superadmin') {
            throw new Error('Não é possível promover a superadmin por aqui.');
        }
        patch.role = r;
        if (r !== user.role) {
            changes.push('perfil');
            invalidate = true;
        }
    }
    if (active !== undefined) {
        if (user.role === 'superadmin' && !active) {
            throw new Error('Não é possível desativar o superadmin.');
        }
        patch.active = active ? 1 : 0;
        if (!!user.active !== !!active) {
            changes.push(active ? 'ativado' : 'desativado');
            if (!active) invalidate = true;
        }
    }
    if (password) {
        patch.passwordHash = hashPassword(password);
        changes.push('senha');
        invalidate = true;
    }
    if (modules !== undefined) {
        if (user.role === 'superadmin') {
            patch.modules = null;
        } else {
            patch.modules = normalizeModules(modules);
            changes.push('módulos');
            invalidate = true;
        }
    }
    if (phone !== undefined) {
        const digits = phone == null || phone === '' ? '' : String(phone).replace(/\D/g, '');
        if (digits && digits.length < 10) {
            throw new Error('Telefone WhatsApp inválido (use DDI+DDD+número, ex. 5562…).');
        }
        patch.phone = digits || null;
        if (String(user.phone || '') !== String(patch.phone || '')) changes.push('telefone');
    }

    if (!Object.keys(patch).length) {
        return sanitizeUser(user);
    }

    chatDB.updateUser(id, patch);
    if (invalidate) {
        chatDB.bumpUserTokenVersion(id);
    }
    const updated = sanitizeUser(chatDB.getUserById(id));
    if (changes.length) {
        logAudit({
            actor,
            action: password && changes.length === 1 ? 'password_reset' : 'user_updated',
            targetType: 'user',
            targetId: id,
            summary: `Usuário ${user.email}: ${changes.join(', ')}`,
            meta: {
                changes,
                modules: updated.modules,
                active: updated.active,
                phone: updated.phone,
            },
            ip,
        });
    }
    return updated;
}

/** Invalida todas as sessões do usuário (bump tokenVersion). */
export function forceLogout(id, actor = null, { ip } = {}) {
    const user = chatDB.getUserById(id);
    if (!user) throw new Error('Usuário não encontrado.');
    chatDB.bumpUserTokenVersion(id);
    logAudit({
        actor,
        action: 'force_logout',
        targetType: 'user',
        targetId: id,
        summary: `Sessões invalidadas: ${user.email}`,
        ip,
    });
    return sanitizeUser(chatDB.getUserById(id));
}

export function deleteUser(id, actor = null, { ip } = {}) {
    const user = chatDB.getUserById(id);
    if (!user) throw new Error('Usuário não encontrado.');
    if (user.role === 'superadmin') throw new Error('Não é possível excluir o superadmin.');
    if (actor && String(actor.id) === String(id)) throw new Error('Você não pode excluir a si mesmo.');
    chatDB.deleteUser(id);
    logAudit({
        actor,
        action: 'user_delete',
        targetType: 'user',
        targetId: id,
        summary: `Usuário excluído: ${user.email}`,
        meta: { name: user.name, email: user.email },
        ip,
    });
    return true;
}

export function resetPassword(id, newPassword, actor = null, { ip } = {}) {
    if (!newPassword || String(newPassword).length < 4) {
        throw new Error('Senha deve ter ao menos 4 caracteres.');
    }
    return updateUser(id, { password: newPassword }, actor, { ip });
}

/** Recarrega usuário do banco (para /api/me com modules atualizados). */
export function getSafeUserById(id) {
    return sanitizeUser(chatDB.getUserById(id));
}

export default {
    initSeedSuperadmin,
    login,
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    forceLogout,
    resetPassword,
    sanitizeUser,
    getSafeUserById,
};
