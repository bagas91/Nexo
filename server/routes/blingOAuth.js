/**
 * OAuth Bling — callback público + página de sucesso.
 */

import crypto from 'crypto';
import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import {
    exchangeBlingAuthorizationCode,
    getBlingAccessToken,
    getBlingOAuthRedirectUri,
} from '../services/blingService.js';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function oauthStateKey(state) {
    return `bling_oauth_state_${state}`;
}

function oauthCodeKey(code) {
    return `bling_oauth_code_${crypto.createHash('sha256').update(String(code)).digest('hex').slice(0, 24)}`;
}

export function saveOAuthState(state) {
    chatDB.setPlatformKv(oauthStateKey(state), { createdAt: Date.now() });
}

function readOAuthState(state) {
    if (!state) return null;
    const row = chatDB.getPlatformKv(oauthStateKey(state));
    if (!row?.createdAt) return null;
    if (Date.now() - row.createdAt > OAUTH_STATE_TTL_MS) return null;
    return row;
}

function markOAuthStateConsumed(state) {
    const row = readOAuthState(state);
    if (!row) return;
    chatDB.setPlatformKv(oauthStateKey(state), { ...row, consumedAt: Date.now() });
}

function hasValidBlingSession() {
    const cfg = chatDB.getPlatformKv('bling') || {};
    return Boolean(getBlingAccessToken(cfg));
}

function successHtml(message) {
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nexo · Bling</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.card{max-width:420px;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:32px;text-align:center}
h1{font-size:1.25rem;margin:0 0 12px;color:#4ade80}p{margin:0;font-size:.95rem;line-height:1.5;color:#94a3b8}</style></head>
<body><div class="card"><h1>✓ Bling conectado</h1><p>${message}</p><p style="margin-top:16px">Pode fechar esta aba e voltar ao painel Nexo.</p></div></body></html>`;
}

function errorHtml(message) {
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Nexo · Erro Bling</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.card{max-width:420px;background:#1e293b;border:1px solid #7f1d1d;border-radius:16px;padding:32px;text-align:center}
h1{font-size:1.25rem;margin:0 0 12px;color:#f87171}p{margin:0;font-size:.9rem;line-height:1.5;color:#94a3b8}</style></head>
<body><div class="card"><h1>Falha na conexão</h1><p>${message}</p></div></body></html>`;
}

export async function handleBlingOAuthCallback(req, res) {
    const { code, state, error, error_description: errorDescription } = req.query || {};
    const authCode = String(code || '').trim();
    const authState = String(state || '').trim();

    if (error) {
        const msg = String(errorDescription || error).replace(/</g, '');
        return res.status(400).send(errorHtml(msg));
    }

    if (!authCode || !authState) {
        return res.status(400).send(errorHtml('Código ou state ausente. Gere o link de autorização novamente no painel Nexo.'));
    }

    const codeRow = chatDB.getPlatformKv(oauthCodeKey(authCode));
    if (codeRow?.status === 'success' || hasValidBlingSession()) {
        return res.send(successHtml('Sua conta Bling já está autorizada no Nexo.'));
    }

    const stateRow = readOAuthState(authState);
    if (!stateRow) {
        if (hasValidBlingSession()) {
            return res.send(successHtml('Sua conta Bling já está autorizada no Nexo.'));
        }
        return res.status(400).send(errorHtml('State inválido ou expirado. Clique em Autorizar no Bling novamente no painel Nexo.'));
    }

    if (stateRow.consumedAt) {
        if (hasValidBlingSession()) {
            return res.send(successHtml('Sua conta Bling já está autorizada no Nexo.'));
        }
        return res.status(400).send(errorHtml('Esta autorização já foi processada. Clique em Autorizar no Bling novamente.'));
    }

    markOAuthStateConsumed(authState);
    chatDB.setPlatformKv(oauthCodeKey(authCode), { status: 'processing', at: Date.now() });

    const cfg = chatDB.getPlatformKv('bling') || {};
    const clientId = cfg.clientId || '';
    const clientSecret = cfg.clientSecret || '';

    if (!clientId || !clientSecret) {
        return res.status(400).send(errorHtml('Salve Client ID e Client Secret no painel Nexo antes de autorizar.'));
    }

    try {
        const tokens = await exchangeBlingAuthorizationCode({
            code: authCode,
            clientId,
            clientSecret,
        });

        const next = {
            ...cfg,
            connected: true,
            accessToken: tokens.accessToken,
            apiKey: tokens.accessToken,
            refreshToken: tokens.refreshToken || cfg.refreshToken || '',
            connectedAt: Date.now(),
        };
        chatDB.setPlatformKv('bling', next);
        chatDB.setPlatformKv(oauthCodeKey(authCode), { status: 'success', at: Date.now() });

        const integrations = chatDB.getPlatformKv('integrations') || [];
        if (integrations.length) {
            chatDB.setPlatformKv('integrations', integrations.map((i) =>
                i.id === 'bling' ? { ...i, connected: true, connectedAt: Date.now() } : i
            ));
        }

        logger.info('Bling OAuth: tokens salvos com sucesso');
        res.send(successHtml('Sua conta Bling foi autorizada. O Nexo já pode buscar pedidos e enviar WhatsApp.'));
    } catch (err) {
        const msg = String(err?.message || err);
        const benignDuplicate = /already been used|já foi utilizado|revoked/i.test(msg);
        if (benignDuplicate && hasValidBlingSession()) {
            chatDB.setPlatformKv(oauthCodeKey(authCode), { status: 'success', at: Date.now() });
            logger.info('Bling OAuth: callback duplicado ignorado (sessão já ativa)');
            return res.send(successHtml('Sua conta Bling já está autorizada no Nexo.'));
        }
        chatDB.setPlatformKv(oauthCodeKey(authCode), { status: 'error', message: msg, at: Date.now() });
        if (benignDuplicate) {
            logger.errorLocal('Bling OAuth callback duplicado', msg);
        } else {
            logger.error('Bling OAuth callback', msg);
        }
        res.status(500).send(errorHtml(msg.replace(/</g, '')));
    }
}

export function createOAuthState() {
    const state = crypto.randomBytes(16).toString('hex');
    saveOAuthState(state);
    return state;
}

export function getRedirectUri() {
    return getBlingOAuthRedirectUri();
}

export default { handleBlingOAuthCallback, createOAuthState, getRedirectUri };
