/**
 * Usuários do sistema — superadmin e criadores de conteúdo.
 */

import crypto from 'crypto';
import chatDB from '../db/database.js';
import { hashPassword, verifyPassword, signToken } from './auth.js';
import logger from './logger.js';

function adminConfig() {
    return {
        user: process.env.ADMIN_USER || 'va_cleber',
        pass: process.env.ADMIN_PASS || 'clebersantos',
        name: process.env.ADMIN_NAME || 'Administrador'
    };
}

export function sanitizeUser(row) {
    if (!row) return null;
    return {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        active: !!row.active,
        createdAt: row.createdAt
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
            active: 1
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
        active: 1
    });
    logger.info(`Usuários: superadmin criado (${email})`);
}

export function login(email, password) {
    const user = chatDB.getUserByEmail(String(email || '').trim().toLowerCase());
    if (!user || !user.active) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    const safe = sanitizeUser(user);
    const token = signToken(safe);
    return { user: safe, token };
}

export function listUsers() {
    return chatDB.getAllUsers().map(sanitizeUser);
}

export function createUser({ email, password, name, role = 'creator' }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !password || !name) {
        throw new Error('Informe nome, e-mail/login e senha.');
    }
    if (chatDB.getUserByEmail(normalizedEmail)) {
        throw new Error('Já existe um usuário com este login.');
    }
    const validRoles = new Set(['creator', 'superadmin']);
    if (!validRoles.has(role)) throw new Error('Perfil inválido.');
    const id = crypto.randomUUID();
    chatDB.createUser({
        id,
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        name: String(name).trim(),
        role,
        active: 1
    });
    return sanitizeUser(chatDB.getUserById(id));
}

export function updateUser(id, { name, password, role, active }) {
    const user = chatDB.getUserById(id);
    if (!user) throw new Error('Usuário não encontrado.');
    const patch = {};
    if (name !== undefined) patch.name = String(name).trim();
    if (role !== undefined) patch.role = role;
    if (active !== undefined) patch.active = active ? 1 : 0;
    if (password) patch.passwordHash = hashPassword(password);
    chatDB.updateUser(id, patch);
    return sanitizeUser(chatDB.getUserById(id));
}

export default { initSeedSuperadmin, login, listUsers, createUser, updateUser, sanitizeUser };
