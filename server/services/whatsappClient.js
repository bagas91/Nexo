import pkg from 'whatsapp-web.js';
import QRCode from 'qrcode';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import sessionBackup from '../utils/sessionBackup.js';
import notifier from '../utils/notifier.js';
import { persistInboxMessage, syncRecentInbox } from './inboxService.js';
import { isAudioFile, normalizeAudioForWhatsApp } from '../utils/audioNormalize.js';
import {
    normalizeMediaLayout,
    isImageOrVideoFile,
    splitTextForShortCaption,
    MEDIA_LAYOUTS,
} from '../utils/mediaLayout.js';
const { Client, LocalAuth, MessageMedia } = pkg;

const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 horas
/** Mantém lastActivityAt fresco com sessão idle (evita healthcheck-stale falso). Menor que HEALTHCHECK_STALE_MS típico (ex.: 30 min). */
const ACTIVITY_HEARTBEAT_MS = 10 * 60 * 1000;
const QR_MIN_DISPLAY_MS = 25 * 1000; // mesmo QR por 25s para dar tempo de escanear

const __dirnameServices = path.dirname(fileURLToPath(import.meta.url));
/** Mesmo caminho que LocalAuth (sessão única do Puppeteer). */
const WWWEBJS_SESSION_DIR = path.join(__dirnameServices, '..', '.wwebjs_auth', 'session');

const DELAY_BETWEEN_ATTACHMENTS_MS = 2500;
const GET_CHATS_TIMEOUT_MS = Number(process.env.GET_CHATS_TIMEOUT_MS) || 120000;
const READY_DEBOUNCE_MS = 4000;
const MEDIA_SEND_TIMEOUT_MS = Number(process.env.MEDIA_SEND_TIMEOUT_MS) || 120000;

function withOperationTimeout(promise, timeoutMs, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`Timeout (${Math.round(timeoutMs / 1000)}s): ${label}`)),
            timeoutMs
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const MEDIA_UPLOAD_RETRYABLE = /media entry was not created|upload failed|media-fault|promise was collected|protocol error \(runtime\.callfunctionon\)|timeout ao enviar mídia|não confirmou o envio/i;

function isNewsletterChatId(chatId) {
    return /@\w*newsletter\b/.test(String(chatId || ''));
}

/** Número privado (só dígitos ou JID @c.us) — não é grupo/canal. */
function isPrivateChatId(chatId) {
    const s = String(chatId || '').trim();
    if (!s) return false;
    if (/@(c\.us|s\.whatsapp\.net)$/i.test(s)) return true;
    if (s.includes('@')) return false;
    const digits = s.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
}

function normalizePrivateChatId(numberOrId) {
    const s = String(numberOrId || '').trim();
    if (!s) return null;
    if (/@s\.whatsapp\.net$/i.test(s)) return s.replace(/@s\.whatsapp\.net$/i, '@c.us');
    if (/@c\.us$/i.test(s)) return s;
    if (s.includes('@')) return s;
    const digits = s.replace(/\D/g, '');
    return digits ? `${digits}@c.us` : null;
}

function withMediaSendTimeout(promise, label, timeoutMs = MEDIA_SEND_TIMEOUT_MS) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`Timeout ao enviar mídia (${Math.round(timeoutMs / 1000)}s): ${label}`)),
            timeoutMs
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function estimateMediaTimeoutMs(file) {
    const raw = file.data || '';
    const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
    const bytes = base64 ? Math.floor((base64.length * 3) / 4) : 0;
    if (bytes > 5 * 1024 * 1024) return Math.max(MEDIA_SEND_TIMEOUT_MS, 300000);
    if (bytes > 1 * 1024 * 1024) return Math.max(MEDIA_SEND_TIMEOUT_MS, 180000);
    return MEDIA_SEND_TIMEOUT_MS;
}

function buildAudioSendStrategies() {
    // Nota de voz OGG/Opus — melhor compatibilidade Android + iPhone (evita documento).
    return [{ sendAudioAsVoice: true }];
}

function sanitizeMediaFilename(name) {
    const base = String(name || 'arquivo')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .normalize('NFD')
        .replace(/\p{M}/gu, '');
    return base.slice(0, 120) || 'arquivo';
}

function resolveAudioMimetype(file) {
    if (file.type && file.type.startsWith('audio/')) return file.type;
    const n = String(file.name || '').toLowerCase();
    if (n.endsWith('.mp3')) return 'audio/mpeg';
    if (n.endsWith('.ogg')) return 'audio/ogg';
    if (n.endsWith('.m4a') || n.endsWith('.aac')) return 'audio/mp4';
    if (n.endsWith('.wav')) return 'audio/wav';
    return file.type || 'audio/mpeg';
}

function isMediaUploadRetryable(errMsg) {
    return MEDIA_UPLOAD_RETRYABLE.test(errMsg);
}

class WhatsAppClient {
    constructor() {
        this.client = null;
        this.qrCode = null;
        this.isReady = false;
        this.backupInterval = null;
        this.activityHeartbeatInterval = null;
        this.lastQrUpdate = 0; // throttle: evita trocar QR o tempo todo
        this.isReconnecting = false;
        this.isRestarting = false;
        this.lastActivityAt = Date.now();
        this.lastRestartAt = 0;
        this.authenticatedAt = 0;
        this.lastLoadingPercent = 0;
        this.pairingCode = null;
        this.pairingPhone = null;
        this._pairingInitPhone = null;
        this._pairingCodeDeferred = null;
        this._pairingTask = null;
        this._pairingLastError = null;
        this._pairingGeneration = 0;
        /** Callback opcional chamado quando o cliente fica 'ready' (ex.: rodar worker de agendamentos) */
        this.onReadyCallback = null;
        /** Evita dois initialize() ao mesmo tempo (dois Chromes no mesmo userDataDir). */
        this._initMutex = Promise.resolve();
        /** Serializa envios — evita uploads de mídia concorrentes no mesmo Chrome. */
        this._sendChain = Promise.resolve();
        this._clientEpoch = 0;
        this._getChatsInflight = null;
        this._chatsSyncInProgress = false;
        this._lastReadyHandledAt = 0;
    }

    isChatsSyncInProgress() {
        return this._chatsSyncInProgress;
    }

    _enqueueSend(task) {
        const run = () => task();
        const next = this._sendChain.then(run, run);
        this._sendChain = next.catch(() => {});
        return next;
    }

    _killChromiumForSessionProfile() {
        const needle = WWWEBJS_SESSION_DIR;
        try {
            execSync(`pkill -f "${needle.replace(/"/g, '\\"')}" 2>/dev/null || true`, { timeout: 12000 });
        } catch (_) { /* exit 1 se não houver match */ }
        try {
            execSync('pkill -f ".wwebjs_auth/session" 2>/dev/null || true', { timeout: 8000 });
        } catch (_) {}
    }

    _removeChromiumSingletonArtifacts() {
        const names = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
        for (const n of names) {
            const p = path.join(WWWEBJS_SESSION_DIR, n);
            try {
                fs.rmSync(p, { force: true, maxRetries: 5, retryDelay: 200 });
            } catch (_) { /* arquivo pode estar bloqueado */ }
        }
    }

    /**
     * Encerra instância anterior, mata Chromes órfãos no mesmo perfil e limpa singleton (crash/restart).
     */
    async _prepareBrowserProfileForLaunch() {
        this._clearPeriodicIntervals();
        if (this.client) {
            try {
                if (typeof this.client.destroy === 'function') await this.client.destroy();
            } catch (e) {
                logger.warn('WhatsApp: Erro ao destroy() antes de novo launch', e?.message || e);
            }
            this.client = null;
        }
        this.isReady = false;
        this._killChromiumForSessionProfile();
        await new Promise((r) => setTimeout(r, 1000));
        this._removeChromiumSingletonArtifacts();
        await new Promise((r) => setTimeout(r, 500));
    }

    markActivity(source = 'unknown') {
        this.lastActivityAt = Date.now();
        logger.debug(`WhatsApp: atividade registrada (${source})`);
    }

    _clearPeriodicIntervals() {
        if (this.backupInterval) {
            clearInterval(this.backupInterval);
            this.backupInterval = null;
        }
        if (this.activityHeartbeatInterval) {
            clearInterval(this.activityHeartbeatInterval);
            this.activityHeartbeatInterval = null;
        }
    }

    getRuntimeStatus() {
        return {
            isReady: this.isReady,
            isRestarting: this.isRestarting,
            isReconnecting: this.isReconnecting,
            lastActivityAt: this.lastActivityAt,
            lastRestartAt: this.lastRestartAt,
            authenticatedAt: this.authenticatedAt,
            lastLoadingPercent: this.lastLoadingPercent,
        };
    }

    async _waitForReady(timeoutMs = 120000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (this.isReady) return true;
            await new Promise((r) => setTimeout(r, 2000));
        }
        return false;
    }

    setOnReadyCallback(fn) {
        this.onReadyCallback = typeof fn === 'function' ? fn : null;
    }

    /**
     * Dispara reconexão em background (ex.: após "detached Frame").
     * Evita ficar enviando com sessão quebrada.
     */
    requestReconnect() {
        if (this.isReconnecting || this.isRestarting) return;
        this.isReconnecting = true;
        notifier.notifyOnce(
            'wpp-reconnect-sessao-invalida',
            'Sessão WhatsApp inválida (ex.: janela crashou). Reconexão automática em curso. Agendamentos e envios em massa podem falhar por alguns minutos.',
            'warn',
            90 * 1000
        );
        (async () => {
            try {
                logger.info('WhatsApp: Reconexão automática (sessão inválida detectada)...');
                if (this.client) {
                    try {
                        await this.client.destroy();
                    } catch (_) {}
                    this.client = null;
                }
                this.isReady = false;
                this.qrCode = null;
                this._clearPeriodicIntervals();
                const restore = await sessionBackup.restore();
                if (restore.success) logger.info('WhatsApp: Backup restaurado, reinicializando...');
                await this.initialize();
            } catch (e) {
                logger.error('WhatsApp: Erro na reconexão automática', e.message);
            } finally {
                this.isReconnecting = false;
            }
        })();
    }

    /**
     * Entrada serializada: só um initialize por vez (evita dois Chromes no mesmo userDataDir).
     */
    async initialize(isRetry = false, profileLockAttempt = 0) {
        const previous = this._initMutex;
        let release;
        this._initMutex = new Promise((res) => {
            release = res;
        });
        await previous;
        try {
            return await this._initializeClient(isRetry, profileLockAttempt);
        } finally {
            release();
        }
    }

    /**
     * Destrói cliente/puppeteer anterior, mata órfãos e sobe um Client novo. Retries recursivos internos (sem novo mutex).
     */
    async _initializeClient(isRetry = false, profileLockAttempt = 0) {
        this.markActivity('initialize:start');
        logger.info('WhatsApp: Iniciando inicialização do cliente...');

        await this._prepareBrowserProfileForLaunch();

        const clientEpoch = ++this._clientEpoch;
        const pairingPhone = this._pairingInitPhone;
        const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        const clientOptions = {
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                ...(chromePath ? { executablePath: chromePath } : {}),
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ],
                protocolTimeout: Number(process.env.PUPPETEER_PROTOCOL_TIMEOUT_MS) || 180000
            }
        };
        if (pairingPhone) {
            clientOptions.pairWithPhoneNumber = {
                phoneNumber: pairingPhone,
                showNotification: true,
                intervalMs: 180000,
            };
            logger.info(`WhatsApp: Cliente em modo pareamento por código (${pairingPhone.slice(0, 4)}…)`);
        }
        this.client = new Client(clientOptions);

        this.client.on('loading_screen', (percent, message) => {
            this.lastLoadingPercent = percent;
            // Após autenticar em 95%+, eventos de loading não devem mascarar travamento no healthcheck
            if (!(this.authenticatedAt && percent >= 95)) {
                this.markActivity('loading_screen');
            }
            logger.info(`WhatsApp: Carregando... ${percent}% - ${message}`);
        });

        this.client.on('qr', async (qr) => {
            if (this.pairingCode) {
                logger.debug('WhatsApp: QR ignorado (modo código de pareamento ativo)');
                return;
            }
            const now = Date.now();
            const elapsed = now - this.lastQrUpdate;
            // Mantém o mesmo QR por pelo menos QR_MIN_DISPLAY_MS para facilitar o scan
            if (this.lastQrUpdate > 0 && elapsed < QR_MIN_DISPLAY_MS) {
                logger.debug(`WhatsApp: QR ignorado (mostrando o anterior por mais ${Math.ceil((QR_MIN_DISPLAY_MS - elapsed) / 1000)}s)`);
                return;
            }
            this.lastQrUpdate = now;
            this.markActivity('qr');
            logger.info('WhatsApp: QR Code recebido - Limpando cache de grupos antigo');
            chatDB.clearChats();
            this.qrCode = await QRCode.toDataURL(qr);
            logger.info('WhatsApp: QR Code convertido para imagem');
        });

        this.client.on('ready', async () => {
            if (clientEpoch !== this._clientEpoch) {
                logger.debug('WhatsApp: ready ignorado (cliente antigo)');
                return;
            }
            const now = Date.now();
            if (this._lastReadyHandledAt && now - this._lastReadyHandledAt < READY_DEBOUNCE_MS) {
                logger.debug('WhatsApp: ready ignorado (debounce)');
                return;
            }
            this._lastReadyHandledAt = now;

            logger.info('WhatsApp: ✅ Cliente conectado!');
            this.isReady = true;
            this.qrCode = null;
            this.lastQrUpdate = 0;
            this.pairingCode = null;
            this.pairingPhone = null;
            this._pairingInitPhone = null;
            this.authenticatedAt = 0;
            this.markActivity('ready');

            this._clearPeriodicIntervals();

            // Backup ao ficar pronto (intervalo mínimo entre cópias evita rajada em reconnect)
            try {
                const backup = await sessionBackup.backup();
                if (backup.success && !backup.skipped) {
                    logger.info('WhatsApp: Backup da sessão criado automaticamente');
                }
            } catch (err) {
                logger.warn('WhatsApp: Erro ao criar backup automático', err.message);
            }

            // Backup periódico a cada 6h para sempre ter um backup recente
            this.backupInterval = setInterval(async () => {
                if (!this.isReady || !this.client) return;
                try {
                    const backup = await sessionBackup.backup();
                    if (backup.success && !backup.skipped) logger.info('WhatsApp: Backup periódico da sessão criado');
                } catch (err) {
                    logger.warn('WhatsApp: Erro no backup periódico', err.message);
                }
            }, BACKUP_INTERVAL_MS);

            this.activityHeartbeatInterval = setInterval(() => {
                if (!this.isReady || !this.client) return;
                this.markActivity('heartbeat');
            }, ACTIVITY_HEARTBEAT_MS);

            if (this.onReadyCallback) {
                try {
                    await this.onReadyCallback();
                } catch (err) {
                    logger.warn('WhatsApp: Erro no callback onReady', err?.message || err);
                }
            }

            setTimeout(() => {
                if (this.isReady && this.client) {
                    syncRecentInbox(this.client).catch((err) => {
                        logger.warn('Inbox: sync inicial falhou', err?.message || err);
                    });
                }
            }, 8000);

            notifier.notifyOnce(
                'whatsapp-back-online',
                'WhatsApp conectado. O worker pode processar agendamentos vencidos (até ~1 min) e o envio em massa volta a funcionar.',
                'info',
                2 * 60 * 1000
            );
        });

        this.client.on('code', (code) => {
            const normalized = String(code || '').replace(/\s/g, '').toUpperCase();
            this.pairingCode = normalized;
            this.qrCode = null;
            this.markActivity('pairing_code');
            logger.info('WhatsApp: Código de pareamento disponível');
            if (this._pairingCodeDeferred) {
                this._pairingCodeDeferred.resolve(normalized);
                this._pairingCodeDeferred = null;
            }
        });

        this.client.on('authenticated', () => {
            this.authenticatedAt = Date.now();
            this.markActivity('authenticated');
            logger.info('WhatsApp: Autenticado com sucesso');
        });

        this.client.on('auth_failure', async (msg) => {
            logger.error('WhatsApp: Falha na autenticação', msg);
            if (this._pairingCodeDeferred) {
                this._pairingCodeDeferred.reject(new Error(String(msg || 'Falha na autenticação')));
                this._pairingCodeDeferred = null;
            }
            this._pairingInitPhone = null;
            try {
                const notifier = (await import('../utils/notifier.js')).default;
                notifier.notify(`WhatsApp: Falha na autenticação. Escaneie o QR Code novamente. Detalhe: ${msg}`, 'error');
            } catch (_) {}
        });

        this.client.on('disconnected', async (reason) => {
            this.markActivity('disconnected');
            logger.warn('WhatsApp: Desconectado', reason);
            let pendingTotal = 0;
            let dueLate = 0;
            try {
                dueLate = chatDB.getPendingSchedulesDue().length;
                pendingTotal = chatDB.getSchedulesPendingCount();
            } catch (_) { /* best-effort */ }
            notifier.notifyOnce(
                reason === 'LOGOUT' ? 'whatsapp-logout' : 'whatsapp-disconnected',
                `WhatsApp desconectado: ${reason}. Pendentes na fila: ${pendingTotal} total (já vencidos/esperando: ${dueLate}). Até reconectar, não há disparo automático.`,
                'warn',
                reason === 'LOGOUT' ? 5 * 60 * 1000 : 2 * 60 * 1000
            );
            this.isReady = false;
            this.qrCode = null;
            this.lastQrUpdate = 0;
            this.pairingCode = null;
            this.pairingPhone = null;
            this._pairingInitPhone = null;
            this._rejectPairingWaiter(new Error(String(reason || 'Desconectado')));
            this.authenticatedAt = 0;
            this._clearPeriodicIntervals();

            // Backup após desconexão (throttle no sessionBackup evita uma cópia por flap seguido de ready)
            try {
                const backup = await sessionBackup.backup();
                if (backup.success && !backup.skipped) logger.info('WhatsApp: Backup da sessão feito após desconexão');
            } catch (_) { /* sessão pode já estar indisponível */ }

            if (reason !== 'LOGOUT') {
                logger.info('WhatsApp: Tentando reconectar automaticamente em 5 segundos...');
                setTimeout(async () => {
                    try {
                        const restore = await sessionBackup.restore();
                        if (restore.success) logger.info('WhatsApp: Backup restaurado, tentando reconectar...');
                        await this.initialize().catch((e) => logger.error('WhatsApp: Erro na reconexão automática', e.message));
                    } catch (err) {
                        logger.error('WhatsApp: Erro na reconexão automática', err.message);
                    }
                }, 5000);
            }
        });

        this.client.on('change_state', (state) => {
            this.markActivity(`change_state:${state}`);
            logger.info(`WhatsApp: Mudança de estado - ${state}`);
            const s = String(state || '');
            const reportStates = new Set(['UNPAIRED', 'UNPAIRED_IDLE', 'CONFLICT', 'TOS_BLOCK', 'SMB_TOS_BLOCK', 'PROXYBLOCK', 'TOS', 'UNLAUNCHED', 'NAVIGATION', 'TIMEOUT']);
            if (reportStates.has(s)) {
                notifier.notifyOnce(
                    `wpp-state-${s}`,
                    `WhatsApp: estado do cliente — ${s}. Pode exigir QR, rede, ou ação; agendamentos não saem com sessão inativa.`,
                    'warn',
                    3 * 60 * 1000
                );
            }
        });

        this.client.on('message_create', async (msg) => {
            if (clientEpoch !== this._clientEpoch || !this.isReady) return;
            try {
                await persistInboxMessage(msg);
            } catch (err) {
                logger.warn('Inbox: erro ao registrar mensagem', err?.message || err);
            }
        });

        const doInitialize = async () => {
            await Promise.race([
                this.client.initialize(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout na inicialização (60s)')), 60000)
                )
            ]);
        };

        try {
            logger.info('WhatsApp: Chamando client.initialize()...');
            await doInitialize();
            this.markActivity('initialize:done');
            logger.info('WhatsApp: client.initialize() concluído');
        } catch (err) {
            const isContextDestroyed = err.message && (err.message.includes('Execution context was destroyed') || err.message.includes('Protocol error'));
            if (isContextDestroyed && !isRetry) {
                logger.warn('WhatsApp: Contexto destruído. Fechando cliente e reiniciando em 15s (1 tentativa)...');
                try {
                    await sessionBackup.backup({ force: true });
                } catch (_) { /* pode falhar se sessão já corrompida */ }
                if (this.client) {
                    try {
                        if (typeof this.client.destroy === 'function') await this.client.destroy();
                    } catch (_) { /* pode falhar se o contexto já morreu */ }
                    this.client = null;
                }
                await new Promise(r => setTimeout(r, 15000));
                return this._initializeClient(true, 0);
            }
            logger.error('WhatsApp: Erro ao inicializar cliente', err.message);
            if (err.message.includes('ERR_CONNECTION') || err.message.includes('Timeout')) {
                logger.warn('WhatsApp: Erro de conexão detectado, tentando restaurar backup...');
                try {
                    const restore = await sessionBackup.restore();
                    if (restore.success) {
                        logger.info('WhatsApp: Backup restaurado, tentando reconectar...');
                        setTimeout(() => {
                            this.initialize().catch(e => {
                                logger.error('WhatsApp: Erro na reinicialização após restore', e.message);
                            });
                        }, 3000);
                    } else {
                        // Se não conseguir restaurar, tenta novamente
                        setTimeout(() => {
                            logger.info('WhatsApp: Tentando reinicializar após erro de conexão...');
                            this.initialize().catch(e => {
                                logger.error('WhatsApp: Erro na reinicialização', e.message);
                            });
                        }, 5000);
                    }
                } catch (restoreErr) {
                    logger.error('WhatsApp: Erro ao tentar restaurar backup', restoreErr.message);
                    setTimeout(() => {
                        this.initialize().catch(e => {
                            logger.error('WhatsApp: Erro na reinicialização', e.message);
                        });
                    }, 5000);
                }
            } else if (err.message && err.message.includes('browser is already running')) {
                if (profileLockAttempt < 4) {
                    logger.warn(
                        `WhatsApp: Perfil em uso ou lock do Chrome (tentativa ${profileLockAttempt + 1}/4); limpando e relançando...`
                    );
                    if (this.client) {
                        try {
                            await this.client.destroy();
                        } catch (_) {}
                        this.client = null;
                    }
                    this._killChromiumForSessionProfile();
                    this._removeChromiumSingletonArtifacts();
                    await new Promise((r) => setTimeout(r, 2000 + profileLockAttempt * 2000));
                    return this._initializeClient(isRetry, profileLockAttempt + 1);
                }
                logger.error('WhatsApp: Não foi possível liberar o perfil do Chrome após várias tentativas');
                throw err;
            } else {
                throw err;
            }
        }
    }

    _normalizePairingPhone(phoneNumber) {
        let digits = String(phoneNumber || '').replace(/\D/g, '');

        // Brasil: 55919… (9 a mais após o 55) → 55119…
        if (digits.startsWith('5591') && digits.length === 13 && digits[4] === '9') {
            const fixed = `5511${digits.slice(4)}`;
            logger.warn(`WhatsApp: Número ajustado automaticamente ${digits} → ${fixed}`);
            digits = fixed;
        }

        // Brasil: celular sem o 9 após o DDD (12 dígitos) → insere o 9
        if (digits.startsWith('55') && digits.length === 12) {
            const ddd = digits.slice(2, 4);
            const rest = digits.slice(4);
            if (/^\d{8}$/.test(rest)) {
                const fixed = `55${ddd}9${rest}`;
                logger.info(`WhatsApp: Nono dígito inserido ${digits} → ${fixed}`);
                digits = fixed;
            }
        }

        if (digits.length < 10 || digits.length > 15) {
            throw new Error('Número inválido. Use DDI + DDD + número (ex.: 5511915266397).');
        }
        return digits;
    }

    normalizePairingPhone(phoneNumber) {
        return this._normalizePairingPhone(phoneNumber);
    }

    async _waitForPuppeteerPage(timeoutMs = 90000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (this.client?.pupPage && !this.client.pupPage.isClosed()) return true;
            await new Promise((r) => setTimeout(r, 500));
        }
        return false;
    }

    async _waitForPairingReady(timeoutMs = 90000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (!this.client?.pupPage || this.client.pupPage.isClosed()) {
                await new Promise((r) => setTimeout(r, 500));
                continue;
            }
            try {
                const ready = await this.client.pupPage.evaluate(() => {
                    const utils = window.AuthStore?.PairingCodeLinkUtils;
                    if (!utils) return false;
                    const state = window.require?.('WAWebSocketModel')?.Socket?.state;
                    return state === 'UNPAIRED' || state === 'UNPAIRED_IDLE';
                });
                if (ready) return true;
            } catch (_) { /* página ainda carregando */ }
            await new Promise((r) => setTimeout(r, 1000));
        }
        return false;
    }

    _pairingErrorMessage(err) {
        const msg = String(err?.message || err || '').trim();
        if (/invariant violation|getstorage|userprefs/i.test(msg)) {
            return 'Sessão do WhatsApp instável no servidor. Atualize a página, clique uma vez em Gerar código e aguarde ~15s. Se persistir, use a aba QR Code.';
        }
        if (!msg || msg.length <= 2) {
            return 'WhatsApp recusou gerar o código agora. Use a aba QR Code — escaneie com seu celular.';
        }
        if (/timeout|timed out/i.test(msg)) {
            return 'Demorou demais para gerar o código. Tente novamente em alguns segundos.';
        }
        return msg;
    }

    _rejectPairingWaiter(err) {
        if (!this._pairingCodeDeferred) return;
        this._pairingCodeDeferred.reject(err instanceof Error ? err : new Error(String(err)));
        this._pairingCodeDeferred = null;
    }

    _waitForPairingCodeEvent(timeoutMs = 90000) {
        if (this.pairingCode) return Promise.resolve(this.pairingCode);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pairingCodeDeferred = null;
                reject(new Error('Demorou demais para gerar o código de pareamento.'));
            }, timeoutMs);
            this._pairingCodeDeferred = {
                resolve: (code) => {
                    clearTimeout(timer);
                    resolve(code);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                },
            };
        });
    }

    /**
     * Gera código em background (cliente QR existente + evento `code`).
     */
    startPairingCodeAsync(phoneNumber) {
        const phone = this._normalizePairingPhone(phoneNumber);
        if (this.pairingCode && this.pairingPhone === phone) {
            return Promise.resolve(this.pairingCode);
        }

        if (this._pairingTask) {
            this._rejectPairingWaiter(new Error('Reiniciando geração de código'));
        }

        const generation = ++this._pairingGeneration;
        this._pairingLastError = null;
        this.pairingPhone = phone;
        this.pairingCode = null;

        this._pairingTask = (async () => {
            logger.info(`WhatsApp: Gerando código de pareamento para ${phone.slice(0, 4)}…`);

            if (!this.client) {
                await this.initialize();
            }

            const pageReady = await this._waitForPuppeteerPage(30000);
            if (!pageReady || generation !== this._pairingGeneration) {
                throw new Error('WhatsApp não ficou pronto. Use a aba QR Code.');
            }

            await new Promise((r) => setTimeout(r, 8000));
            if (generation !== this._pairingGeneration) return null;

            const codePromise = this._waitForPairingCodeEvent(40000);

            if (typeof this.client.requestPairingCode === 'function') {
                this.client.requestPairingCode(phone, true).then((code) => {
                    if (generation !== this._pairingGeneration) return;
                    const normalized = String(code || '').replace(/\s/g, '').toUpperCase();
                    if (normalized && this._pairingCodeDeferred) {
                        this.pairingCode = normalized;
                        this._pairingCodeDeferred.resolve(normalized);
                        this._pairingCodeDeferred = null;
                    }
                }).catch(async (err) => {
                    const msg = String(err?.message || err || '').trim();
                    logger.warn('WhatsApp: requestPairingCode falhou', msg || err);
                    await new Promise((r) => setTimeout(r, 5000));
                    if (generation !== this._pairingGeneration) return;
                    if (this.pairingCode) return;
                    if (this._pairingCodeDeferred) {
                        this._pairingCodeDeferred.reject(
                            new Error('WhatsApp recusou gerar o código agora. Use a aba QR Code — é mais rápido e confiável.')
                        );
                        this._pairingCodeDeferred = null;
                    }
                });
            }

            const code = await codePromise;
            if (generation !== this._pairingGeneration) return null;

            this.pairingCode = code;
            this.qrCode = null;
            this.lastQrUpdate = 0;
            this.markActivity('pairing_code');
            return code;
        })()
            .catch((err) => {
                if (generation !== this._pairingGeneration) return null;
                const message = this._pairingErrorMessage(err);
                this._pairingLastError = message;
                logger.error('WhatsApp: Falha no pareamento por código', message);
                throw new Error(message);
            })
            .finally(() => {
                if (generation === this._pairingGeneration) {
                    this._pairingTask = null;
                }
            });

        return this._pairingTask;
    }

    /**
     * Pareamento por código — retorna imediato se já existir; senão dispara geração async.
     */
    async requestPairingCode(phoneNumber) {
        const phone = this._normalizePairingPhone(phoneNumber);

        if (this.isReady) {
            throw new Error('WhatsApp já está conectado.');
        }

        if (this.pairingCode && this.pairingPhone === phone) {
            logger.info('WhatsApp: Reutilizando código de pareamento ativo');
            return this.pairingCode;
        }

        await this.startPairingCodeAsync(phone);
        return this.pairingCode;
    }

    async cancelPairingCode() {
        this.pairingCode = null;
        this.pairingPhone = null;
        this._pairingInitPhone = null;
        this._pairingLastError = null;
        this._pairingGeneration += 1;
        this._rejectPairingWaiter(new Error('Pareamento cancelado'));
        if (this.client && typeof this.client.cancelPairingCode === 'function') {
            try {
                await this.client.cancelPairingCode();
            } catch (err) {
                logger.warn('WhatsApp: Erro ao cancelar pareamento por código', err?.message || err);
            }
        }
    }

    getStatus() {
        if (this.isReady) {
            return { status: 'CONNECTED', ready: true, authenticated: true };
        }
        if (this.pairingCode) {
            return {
                status: 'PAIRING_CODE_READY',
                ready: false,
                authenticated: false,
                pairingCode: this.pairingCode,
                pairingPhone: this.pairingPhone,
            };
        }
        if (this._pairingTask && this.pairingPhone) {
            return {
                status: 'CONNECTING',
                ready: false,
                authenticated: false,
                pairingPhone: this.pairingPhone,
                pairingGenerating: true,
            };
        }
        if (this._pairingLastError) {
            return {
                status: 'QR_READY',
                ready: false,
                authenticated: false,
                qr: this.qrCode || undefined,
                pairingError: this._pairingLastError,
                pairingPhone: this.pairingPhone,
            };
        }
        if (this.qrCode) {
            return { status: 'QR_READY', ready: false, authenticated: false, qr: this.qrCode };
        }
        return { status: 'CONNECTING', ready: false, authenticated: false };
    }

    _serializedId(obj) {
        if (!obj || !obj.id) return null;
        return typeof obj.id === 'string' ? obj.id : (obj.id._serialized || null);
    }

    /**
     * Lista só grupos/canais via Store (rápido — não carrega metadados de conversas privadas).
     */
    async _fetchGroupsAndChannelsLightweight(client) {
        if (!client?.pupPage) return [];
        const raw = await client.pupPage.evaluate(() => {
            const out = [];
            const seen = new Set();
            const push = (id, name, type, members = 0) => {
                if (!id || seen.has(id)) return;
                seen.add(id);
                out.push({ id, name: name || 'Sem nome', type, members });
            };

            const isGroupId = (id) => {
                const s = String(id || '');
                return s.endsWith('@g.us') || s.includes('@g.us');
            };
            const isChannelId = (id) => String(id || '').includes('@newsletter');

            try {
                const getters = window.require('WAWebChatGetters');
                const getIsNewsletter = getters.getIsNewsletter;
                const chats = window.require('WAWebCollections').Chat.getModelsArray();
                for (const chat of chats) {
                    try {
                        const id = chat.id?._serialized || chat.id;
                        if (!id) continue;
                        const idStr = String(id);
                        if (isChannelId(idStr) || getIsNewsletter(chat)) {
                            push(idStr, chat.name || chat.formattedTitle, 'channel', 0);
                            continue;
                        }
                        const isGroup = !!(
                            chat.groupMetadata ||
                            chat.isGroup ||
                            isGroupId(idStr) ||
                            (typeof chat.id?.isGroup === 'function' && chat.id.isGroup())
                        );
                        if (!isGroup) continue;
                        let members = 0;
                        const p = chat.groupMetadata?.participants;
                        if (p) {
                            if (Array.isArray(p)) members = p.length;
                            else if (p._models) members = p._models.length;
                        }
                        push(idStr, chat.name || chat.formattedTitle || chat.groupMetadata?.subject, 'group', members);
                    } catch (_) { /* skip chat */ }
                }
            } catch (_) { /* store indisponível */ }

            try {
                const collections = window.require('WAWebCollections');
                const groupCol = collections.GroupMetadata || collections.WAWebGroupMetadataCollection;
                if (groupCol && typeof groupCol.getModelsArray === 'function') {
                    for (const gm of groupCol.getModelsArray()) {
                        const id = gm.id?._serialized || gm.id;
                        if (!id || isChannelId(id)) continue;
                        let members = 0;
                        const p = gm.participants;
                        if (p) {
                            if (Array.isArray(p)) members = p.length;
                            else if (p._models) members = p._models.length;
                        }
                        push(String(id), gm.subject || gm.name || gm.formattedTitle, 'group', members);
                    }
                }
            } catch (_) { /* metadados de grupo opcionais */ }

            try {
                const col = window.require('WAWebCollections').WAWebNewsletterCollection;
                if (col && typeof col.getModelsArray === 'function') {
                    for (const channel of col.getModelsArray()) {
                        const id = channel.id?._serialized || channel.id;
                        push(String(id), channel.name, 'channel', 0);
                    }
                }
            } catch (_) { /* canais opcionais */ }

            return out;
        });
        return Array.isArray(raw) ? raw : [];
    }

    _parseChatsFromFullList(chats) {
        if (!Array.isArray(chats) || chats.length === 0) return [];
        const isChannelId = (id) => id && String(id).toLowerCase().includes('@newsletter');
        const participantCount = (chat) => {
            const p = chat.participants;
            if (!p) return 0;
            if (Array.isArray(p)) return p.length;
            if (p._models && Array.isArray(p._models)) return p._models.length;
            return 0;
        };
        const groups = chats
            .filter(chat => chat && chat.isGroup && !isChannelId(this._serializedId(chat)))
            .map(chat => {
                const id = this._serializedId(chat);
                return id ? { id, name: chat.name || 'Sem nome', type: 'group', members: participantCount(chat) } : null;
            })
            .filter(Boolean);
        const channelsFromChats = chats
            .filter(chat => {
                if (!chat) return false;
                const id = this._serializedId(chat);
                return id && (chat.isChannel === true || isChannelId(id)) && !chat.isGroup;
            })
            .map(chat => {
                const id = this._serializedId(chat);
                return id ? { id, name: chat.name || 'Sem nome', type: 'channel', members: 0 } : null;
            })
            .filter(Boolean);
        const byId = new Map();
        for (const c of [...groups, ...channelsFromChats]) byId.set(c.id, c);
        return Array.from(byId.values());
    }

    async _fetchChatsViaFullGetChats(client) {
        if (typeof client.getChats !== 'function') return [];
        const chats = await withOperationTimeout(
            client.getChats(),
            GET_CHATS_TIMEOUT_MS,
            'getChats completo'
        );
        return this._parseChatsFromFullList(chats);
    }

    async getChats() {
        if (this._getChatsInflight) {
            logger.debug('WhatsApp: getChats já em andamento — aguardando mesma operação');
            return this._getChatsInflight;
        }
        this._getChatsInflight = this._getChatsImpl().finally(() => {
            this._getChatsInflight = null;
            this._chatsSyncInProgress = false;
        });
        return this._getChatsInflight;
    }

    async _getChatsImpl() {
        const cachedChats = chatDB.getAllChats();
        const cachedGroups = cachedChats.filter((c) => c.type === 'group').length;
        if (cachedChats.length > 0 && cachedGroups > 0) {
            logger.debug(`WhatsApp: Retornando ${cachedChats.length} chats do cache (${cachedGroups} grupos)`);
            return cachedChats;
        }
        if (cachedChats.length > 0 && cachedGroups === 0) {
            logger.warn(`WhatsApp: Cache incompleto (${cachedChats.length} canal(is), 0 grupos) — refazendo listagem`);
        }

        if (this.isRestarting || this.isReconnecting) {
            logger.warn('WhatsApp: getChats sem cache — restart/reconnect em andamento, retornando vazio');
            return cachedChats;
        }

        if (!this.isReady) return cachedChats;
        const client = this.client;
        if (!client || !client.pupPage) {
            logger.warn('WhatsApp: Cliente não disponível ao buscar chats');
            return cachedChats;
        }

        this._chatsSyncInProgress = true;
        const startedAt = Date.now();

        try {
            logger.info('WhatsApp: Buscando grupos e canais (modo rápido)...');

            let allChats = await withOperationTimeout(
                this._fetchGroupsAndChannelsLightweight(client),
                GET_CHATS_TIMEOUT_MS,
                'listagem rápida de grupos/canais'
            );

            const fastGroups = allChats.filter((c) => c.type === 'group').length;
            const fastChannels = allChats.filter((c) => c.type === 'channel').length;

            if (fastGroups === 0) {
                logger.warn(
                    `WhatsApp: Modo rápido sem grupos (${fastChannels} canal(is)) — tentando getChats completo (fallback)...`
                );
                const fullParsed = await this._fetchChatsViaFullGetChats(client);
                if (fullParsed.length > 0) {
                    const byId = new Map(fullParsed.map((c) => [c.id, c]));
                    for (const c of allChats) {
                        if (c.type === 'channel' && !byId.has(c.id)) byId.set(c.id, c);
                    }
                    allChats = Array.from(byId.values());
                }
            }

            if (allChats.length > 0) {
                chatDB.saveChats(allChats);
                const groups = allChats.filter(c => c.type === 'group').length;
                const channels = allChats.filter(c => c.type === 'channel').length;
                const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
                logger.info(`WhatsApp: ${groups} grupos e ${channels} canais salvos no cache (${sec}s)`);
            } else {
                logger.warn('WhatsApp: Nenhum grupo/canal encontrado na listagem');
            }
            return allChats;
        } catch (err) {
            const errMsg = (err && err.message) ? String(err.message) : String(err);
            const isTargetClosed = /Target closed|Protocol error|Execution context was destroyed|Timeout/i.test(errMsg);
            if (isTargetClosed) {
                logger.warn(`WhatsApp: Listagem de grupos interrompida (${errMsg}) — sessão preservada, use Atualizar grupos`);
            } else {
                logger.errorLocal('WhatsApp: Erro ao buscar chats', errMsg);
            }
            return chatDB.getAllChats();
        }
    }

    async getChatsPaginated(offset = 0, limit = 10) {
        return chatDB.getChatsPaginated(offset, limit);
    }

    getChatsCount() {
        return chatDB.getChatsCount();
    }

    getChatName(chatId) {
        const chats = chatDB.getAllChats();
        const chat = chats.find(c => c.id === chatId);
        return chat ? chat.name : null;
    }

    /**
     * Envia texto para um chat pelo ID (suporta @lid e @c.us).
     */
    async sendChatMessage(chatId, text) {
        if (!this.isReady || !this.client) return;
        const id = String(chatId || '').trim();
        const message = String(text || '').trim();
        if (!id || !message) return;

        try {
            await this._enqueueSend(async () => {
                await this.client.sendMessage(id, message, {});
                this.markActivity('sendChatMessage:success');
            });
            logger.info(`WhatsApp: mensagem enviada para chat ${id.slice(0, 20)}…`);
        } catch (err) {
            const errMsg = (err && err.message) ? String(err.message) : String(err);
            logger.errorLocal(`WhatsApp: falha ao enviar para chat ${id.slice(0, 20)}: ${errMsg}`);
            throw err;
        }
    }

    /**
     * Envia texto para um número privado (alertas/relatórios).
     * Não usa cache de grupos; normaliza para @c.us e evita loop de alertas.
     */
    async sendPrivateMessage(number, text) {
        if (!this.isReady || !this.client) return;
        const digits = String(number || '').replace(/\D/g, '');
        if (!digits) {
            logger.warn('WhatsApp: número privado inválido para alerta');
            return;
        }

        const myNumber = this.getMyNumber();
        if (myNumber && digits === myNumber) {
            logger.info(
                `WhatsApp: alerta/relatório não enviado — ${digits} é o número da conta conectada. Use outro celular ou só Discord.`
            );
            return;
        }

        let chatId = `${digits}@c.us`;
        try {
            const wid = await this.client.getNumberId(digits);
            if (!wid) {
                logger.warn(`WhatsApp: número ${digits} não encontrado no WhatsApp — alerta não enviado`);
                return;
            }
            chatId = wid._serialized || chatId;
        } catch (err) {
            logger.warn(`WhatsApp: validação do número ${digits} falhou, tentando @c.us: ${err.message}`);
        }

        try {
            await this._enqueueSend(async () => {
                await this.client.sendMessage(chatId, text, {});
                this.markActivity('sendPrivateMessage:success');
            });
            logger.info(`WhatsApp: mensagem privada enviada para ${digits}`);
        } catch (err) {
            const errMsg = (err && err.message) ? String(err.message) : String(err);
            logger.errorLocal(`WhatsApp: falha ao enviar mensagem privada para ${digits}: ${errMsg}`);
        }
    }

    /** Retorna o número da conta conectada (ex.: 5511915266397) ou null. */
    getMyNumber() {
        if (!this.client || !this.client.info || !this.client.info.wid) return null;
        const wid = this.client.info.wid;
        let user = wid.user;
        if (!user && wid._serialized) user = wid._serialized.replace(/@c\.us|@g\.us/gi, '').trim();
        return user ? String(user).replace(/\D/g, '') : null;
    }

    /**
     * Verifica em quais grupos um número participa. Útil para achar "qual grupo tem meu número".
     * @param {string} number - Número a buscar (ex.: 5511915266397), com ou sem formatação
     * @returns {{ groups: Array<{id: string, name: string}>, myNumber: string|null }}
     */
    async findGroupsContainingNumber(number) {
        if (!this.isReady || !this.client || typeof this.client.getChats !== 'function') {
            throw new Error('Cliente não está pronto');
        }
        const client = this.client;
        const numberClean = String(number).replace(/\D/g, '');
        if (!numberClean) return { groups: [], myNumber: this.getMyNumber() };
        const chats = await client.getChats();
        const list = Array.isArray(chats) ? chats : [];
        const groups = list.filter((c) => c && c.isGroup && !c.id?.includes?.('newsletter'));
        const out = [];
        for (const group of groups) {
            try {
                let participants = [];
                if (group.participants) {
                    participants = Array.isArray(group.participants) ? group.participants : (group.participants._models || []);
                } else if (group.groupMetadata && group.groupMetadata.participants) {
                    const p = group.groupMetadata.participants;
                    participants = p._models || (Array.isArray(p) ? p : []);
                }
                const hasNumber = participants.some((p) => {
                    const id = p.id ? (typeof p.id === 'string' ? p.id : (p.id._serialized || p.id.user)) : null;
                    if (!id) return false;
                    const num = String(id).replace(/@c\.us|@g\.us/gi, '').replace(/\D/g, '');
                    return num === numberClean;
                });
                if (hasNumber) {
                    out.push({ id: this._serializedId(group) || group.id, name: group.name || 'Sem nome' });
                }
            } catch (err) {
                logger.warn('WhatsApp: Erro ao listar participantes do grupo', group.name || group.id, err.message);
            }
        }
        return { groups: out, myNumber: this.getMyNumber() };
    }

    async refreshChats() {
        if (this.isRestarting || this.isReconnecting) {
            logger.warn('WhatsApp: Atualização de grupos adiada (restart/reconnect em andamento)');
            return chatDB.getAllChats();
        }
        if (!this.isReady || !this.client || !this.client.pupPage) {
            throw new Error('Cliente não está pronto');
        }
        logger.info('WhatsApp: Forçando atualização de grupos...');
        chatDB.clearChats();
        return await this.getChats();
    }

    async sendAttachment(chatId, file, caption, sendOpts) {
        let uploadFile = file;
        const isAudio = isAudioFile(file);
        if (isAudio) {
            uploadFile = await normalizeAudioForWhatsApp(file);
        }

        const raw = uploadFile.data || '';
        const base64Data = raw.includes(',') ? raw.split(',')[1] : raw;
        if (!base64Data) throw new Error('Anexo sem dados (base64 vazio)');

        const safeName = sanitizeMediaFilename(uploadFile.name);
        const mimetype = isAudio
            ? (uploadFile.type || 'audio/ogg; codecs=opus')
            : (uploadFile.type || file.type || 'application/octet-stream');
        const media = new MessageMedia(mimetype, base64Data, safeName);

        const strategies = isAudio ? buildAudioSendStrategies() : [{}];

        let lastErr;
        for (let i = 0; i < strategies.length; i++) {
            try {
                const opts = {
                    ...(caption ? { caption } : {}),
                    ...sendOpts,
                    ...strategies[i]
                };
                const strategyLabel = Object.keys(strategies[i]).length
                    ? Object.keys(strategies[i]).join(',')
                    : 'padrão';
                const timeoutMs = estimateMediaTimeoutMs(uploadFile);
                const sent = await withMediaSendTimeout(
                    this.client.sendMessage(chatId, media, opts),
                    `${safeName} [${strategyLabel}]`,
                    timeoutMs
                );
                if (!sent) {
                    throw new Error('WhatsApp não confirmou o envio do anexo (resposta vazia)');
                }
                if (i > 0) {
                    logger.info(`WhatsApp: anexo "${safeName}" enviado com fallback (${strategyLabel})`);
                }
                return;
            } catch (err) {
                lastErr = err;
                const errMsg = (err && err.message) ? String(err.message) : String(err);
                const canRetry = isMediaUploadRetryable(errMsg) && i < strategies.length - 1;
                if (!canRetry) throw err;
                logger.warn(`WhatsApp: falha no upload de "${safeName}", tentando fallback (${i + 2}/${strategies.length}): ${errMsg}`);
                await new Promise((r) => setTimeout(r, DELAY_BETWEEN_ATTACHMENTS_MS));
            }
        }
        throw lastErr;
    }

    async sendMessage(chatId, text, attachments = [], options = {}) {
        if (!this.isReady || !this.client) throw new Error('Cliente não está pronto');
        if (this.isRestarting) throw new Error('Cliente em reinicialização controlada');
        return this._enqueueSend(() => this._sendMessageImpl(chatId, text, attachments, options));
    }

    async _sendTextMessage(chatId, body, sendOpts) {
        const msg = String(body || '').trim();
        if (!msg) return;
        await this.client.sendMessage(chatId, msg, sendOpts);
    }

    async _sendMessageImpl(chatId, text, attachments = [], options = {}) {
        this.markActivity('sendMessage:start');

        const isPrivate = isPrivateChatId(chatId);
        if (isPrivate) {
            chatId = normalizePrivateChatId(chatId);
        }

        let chatName = 'Desconhecido';
        const destLabel = isPrivate ? 'contato' : 'grupo';
        try {
            // Busca nome do chat para o histórico e para os logs
            const chats = chatDB.getAllChats();
            const targetChat = chats.find(c => c.id === chatId);
            if (isPrivate) {
                chatName = chatId.replace(/@c\.us$/i, '');
            } else {
                chatName = targetChat ? targetChat.name : 'Desconhecido';
            }
            const isChannel = targetChat?.type === 'channel';
            const sendOpts = isChannel ? { sendSeen: false } : {};
            const originalText = text; // Preserva o texto original para o histórico

            const startedAt = new Date();
            const timeStr = startedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const dateStr = startedAt.toLocaleDateString('pt-BR');
            const anexos = attachments?.length || 0;
            const mediaLayout = normalizeMediaLayout(options.mediaLayout);
            logger.info(`📤 Enviando para o ${destLabel} "${chatName}" (${dateStr} ${timeStr})${anexos ? ` — ${anexos} arquivo(s)` : ''}${mediaLayout !== MEDIA_LAYOUTS.CAPTION_ON_IMAGE ? ` [formato: ${mediaLayout}]` : ''}`);

            // Ordena anexos: imagem/vídeo primeiro, áudio em seguida
            const orderPriority = (type, name) => {
                const t = type || '';
                const n = String(name || '').toLowerCase();
                if (t.startsWith('image/') || t.startsWith('video/')) return 0;
                if (t.startsWith('audio/') || isAudioFile({ type: t, name: n })) return 1;
                return 2;
            };
            const sortedAttachments = attachments && attachments.length > 0
                ? [...attachments].sort((a, b) => orderPriority(a.type, a.name) - orderPriority(b.type, b.name))
                : [];

            const failedAttachments = [];
            let messageText = String(text || '').trim();
            const hasVisual = sortedAttachments.some((f) => isImageOrVideoFile(f));

            const sendOneAttachment = async (file, caption) => {
                await this.sendAttachment(chatId, file, caption || undefined, sendOpts);
            };

            const sendAttachmentsLoop = async (files, captionForFirst) => {
                for (let ai = 0; ai < files.length; ai++) {
                    if (ai > 0) await new Promise((r) => setTimeout(r, DELAY_BETWEEN_ATTACHMENTS_MS));
                    try {
                        const caption = ai === 0 ? captionForFirst : undefined;
                        await sendOneAttachment(files[ai], caption);
                    } catch (err) {
                        const errMsg = (err && err.message) ? String(err.message) : String(err);
                        failedAttachments.push({ name: files[ai].name, error: errMsg });
                        logger.error(`WhatsApp: Erro ao enviar anexo para o ${destLabel} "${chatName}" (id: ${chatId}), arquivo "${files[ai].name}": ${errMsg}`);
                        if (errMsg.includes('detached Frame') || errMsg.includes('Target closed') || errMsg.includes('Execution context was destroyed')) {
                            notifier.notifyOnce(
                                'whatsapp-detached-frame-attachment',
                                `WhatsApp Web sessão inválida ao enviar anexo. Destino "${chatName}" (${chatId}). Erro: ${errMsg}`,
                                'warn',
                                2 * 60 * 1000
                            );
                            throw err;
                        }
                    }
                }
            };

            if (sortedAttachments.length > 0) {
                if (mediaLayout === MEDIA_LAYOUTS.TEXT_SEPARATE && hasVisual && messageText) {
                    const visuals = sortedAttachments.filter((f) => isImageOrVideoFile(f));
                    const others = sortedAttachments.filter((f) => !isImageOrVideoFile(f));
                    await sendAttachmentsLoop(visuals, undefined);
                    if (!failedAttachments.length) {
                        await this._sendTextMessage(chatId, messageText, sendOpts);
                        messageText = '';
                    }
                    await sendAttachmentsLoop(others, undefined);
                } else if (mediaLayout === MEDIA_LAYOUTS.SHORT_CAPTION_PLUS_TEXT && hasVisual && messageText) {
                    const { shortCaption, remainder } = splitTextForShortCaption(messageText);
                    const visuals = sortedAttachments.filter((f) => isImageOrVideoFile(f));
                    const others = sortedAttachments.filter((f) => !isImageOrVideoFile(f));
                    for (let vi = 0; vi < visuals.length; vi++) {
                        if (vi > 0) await new Promise((r) => setTimeout(r, DELAY_BETWEEN_ATTACHMENTS_MS));
                        try {
                            await sendOneAttachment(visuals[vi], vi === 0 ? shortCaption : undefined);
                        } catch (err) {
                            const errMsg = (err && err.message) ? String(err.message) : String(err);
                            failedAttachments.push({ name: visuals[vi].name, error: errMsg });
                            throw err;
                        }
                    }
                    if (remainder && !failedAttachments.length) {
                        await this._sendTextMessage(chatId, remainder, sendOpts);
                    }
                    messageText = '';
                    await sendAttachmentsLoop(others, undefined);
                } else {
                    // Legenda na foto (padrão) — texto na 1ª mídia, depois áudio/outros
                    for (let ai = 0; ai < sortedAttachments.length; ai++) {
                        const file = sortedAttachments[ai];
                        if (ai > 0) await new Promise((r) => setTimeout(r, DELAY_BETWEEN_ATTACHMENTS_MS));
                        try {
                            const caption = messageText || undefined;
                            await sendOneAttachment(file, caption);
                            if (caption) messageText = '';
                        } catch (err) {
                            const errMsg = (err && err.message) ? String(err.message) : String(err);
                            failedAttachments.push({ name: file.name, error: errMsg });
                            logger.error(`WhatsApp: Erro ao enviar anexo para o ${destLabel} "${chatName}" (id: ${chatId}), arquivo "${file.name}": ${errMsg}`);
                            if (errMsg.includes('detached Frame') || errMsg.includes('Target closed') || errMsg.includes('Execution context was destroyed')) {
                                notifier.notifyOnce(
                                    'whatsapp-detached-frame-attachment',
                                    `WhatsApp Web sessão inválida ao enviar anexo. Destino "${chatName}" (${chatId}). Erro: ${errMsg}`,
                                    'warn',
                                    2 * 60 * 1000
                                );
                                throw err;
                            }
                        }
                    }
                }
            }

            if (failedAttachments.length > 0) {
                const summary = failedAttachments.map((f) => `${f.name}: ${f.error}`).join('; ');
                throw new Error(`Falha em ${failedAttachments.length} anexo(s): ${summary}`);
            }

            if (messageText) {
                await this._sendTextMessage(chatId, messageText, sendOpts);
            }

            // Salva no histórico
            chatDB.saveHistoryEntry({
                chatId,
                chatName,
                content: originalText,
                attachments: attachments.map(a => a.name),
                status: 'sent'
            });

            const finishedAt = new Date();
            const endTimeStr = finishedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const durationMs = finishedAt - startedAt;
            const durationSec = (durationMs / 1000).toFixed(1);
            logger.info(`✅ Enviado para "${chatName}" às ${endTimeStr} (levou ${durationSec}s)`);
            this.markActivity('sendMessage:success');

        } catch (err) {
            const errMsg = (err && err.message) ? String(err.message) : String(err);
            const logError = isPrivate ? logger.errorLocal.bind(logger) : logger.error.bind(logger);
            logError(`❌ Erro ao enviar para o ${destLabel} "${chatName}" (id: ${chatId}): ${errMsg}`);
            if (errMsg.includes('detached Frame') || errMsg.includes('Target closed') || errMsg.includes('Execution context was destroyed')) {
                notifier.notifyOnce(
                    'whatsapp-detached-frame-send',
                    `WhatsApp Web sessão inválida ao enviar mensagem. Destino "${chatName}" (${chatId}). Erro: ${errMsg}`,
                    'warn',
                    2 * 60 * 1000
                );
            }
            throw err;
        } finally {
            this.markActivity('sendMessage:end');
        }
    }

    getHistory(limit = 50) {
        return chatDB.getHistory(limit);
    }

    clearHistory() {
        chatDB.clearHistory();
    }

    _clearWhatsAppSessionDir() {
        try {
            fs.rmSync(WWWEBJS_SESSION_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            logger.info('WhatsApp: Sessão local removida para novo login');
        } catch (err) {
            logger.warn('WhatsApp: Erro ao remover sessão local', err?.message || err);
        }
        try {
            const cacheDir = path.join(path.dirname(WWWEBJS_SESSION_DIR), '..', '.wwebjs_cache');
            if (fs.existsSync(cacheDir)) {
                fs.rmSync(cacheDir, { recursive: true, force: true });
            }
        } catch (_) { /* best-effort */ }
    }

    /**
     * @param {boolean|{ manual?: boolean, forceNewQR?: boolean }} opts
     * manual=true: logout solicitado pelo usuário — limpa sessão e exige novo QR (sem restaurar backup).
     */
    async logout(opts = false) {
        const options = typeof opts === 'boolean'
            ? { forceNewQR: opts, manual: false }
            : { forceNewQR: false, manual: false, ...opts };
        const { manual, forceNewQR } = options;
        const requireNewQR = manual || forceNewQR;

        try {
            logger.info(manual
                ? 'WhatsApp: Logout manual solicitado — preparando sistema para novo login'
                : 'WhatsApp: Iniciando logout...');

            if (!requireNewQR) {
                try {
                    const backup = await sessionBackup.backup({ force: true });
                    if (backup.success) {
                        logger.info('WhatsApp: Backup criado antes do logout');
                    }
                } catch (err) {
                    logger.warn('WhatsApp: Erro ao criar backup antes do logout', err.message);
                }
            }

            if (!manual) {
                chatDB.clearChats();
            }

            if (this.client) {
                try {
                    await this.client.logout();
                } catch (e) {
                    logger.warn('WhatsApp: Erro no logout (provavelmente já desconectado), procedendo para destroy...');
                }

                await this.client.destroy();
                this.client = null;
            }

            this.isReady = false;
            this.qrCode = null;
            this.lastQrUpdate = 0;
            this._clearPeriodicIntervals();

            if (requireNewQR) {
                this._clearWhatsAppSessionDir();
            }

            logger.info('WhatsApp: Reinicializando em 3s...');
            setTimeout(async () => {
                if (!requireNewQR) {
                    try {
                        const restore = await sessionBackup.restore();
                        if (restore.success) {
                            logger.info('WhatsApp: Backup restaurado, tentando reconectar...');
                        }
                    } catch (err) {
                        logger.warn('WhatsApp: Não foi possível restaurar backup', err.message);
                    }
                }
                await this.initialize().catch((e) => logger.error('WhatsApp: Reinicialização pós-logout falhou', e.message));
            }, 3000);

        } catch (err) {
            logger.error('WhatsApp: Erro durante o logout', err.message);
            setTimeout(() => this.initialize().catch((e) => logger.error('WhatsApp: Reinicialização após erro no logout', e.message)), 5000);
        }
    }

    /**
     * Encerramento graceful: backup da sessão e destroy SEM logout.
     * Use ao parar o servidor (SIGTERM/SIGINT) para manter a sessão válida no próximo start.
     */
    async destroyGracefully() {
        this._clearPeriodicIntervals();
        this.isReady = false;
        this.qrCode = null;
        try {
            const backup = await sessionBackup.backup({ force: true });
            if (backup.success) logger.info('WhatsApp: Backup da sessão antes de encerrar');
        } catch (e) {
            logger.warn('WhatsApp: Erro ao fazer backup antes de encerrar', e?.message);
        }
        if (this.client) {
            try {
                await this.client.destroy();
            } catch (_) { /* ignora */ }
            this.client = null;
        }
        logger.info('WhatsApp: Cliente encerrado (sessão preservada para próximo start)');
    }

    async controlledRestart(reason = 'scheduled-restart') {
        if (this.isRestarting || this.isReconnecting) {
            return { success: false, skipped: true, message: 'Restart/reconnect já em andamento' };
        }
        this.isRestarting = true;
        this.lastRestartAt = Date.now();
        this.markActivity(`controlledRestart:start:${reason}`);
        try {
            logger.warn(`WhatsApp: Reinicialização controlada iniciada (${reason})`);
            notifier.notifyOnce(
                'controlled-whatsapp-restart',
                `Reinicialização controlada do WhatsApp (${reason}). Sessão cai; agendamentos e envios aguardam reconexão.`,
                'warn',
                2 * 60 * 1000
            );

            const backup = await sessionBackup.backup({ force: true });
            if (!backup.success) {
                logger.warn(`WhatsApp: Backup pré-restart falhou (${backup.message || 'sem detalhes'})`);
            }

            this._clearPeriodicIntervals();

            this.isReady = false;
            this.qrCode = null;
            this.lastQrUpdate = 0;

            if (this.client) {
                try {
                    await this.client.destroy();
                } catch (err) {
                    logger.warn('WhatsApp: Erro ao destruir cliente no restart controlado', err?.message || err);
                } finally {
                    this.client = null;
                }
            }

            await this.initialize();
            const ready = await this._waitForReady(120000);
            if (!ready) {
                logger.warn(`WhatsApp: Reinicialização (${reason}) concluiu initialize mas não ficou ready em 120s`);
                return { success: false, message: 'Initialize OK, mas cliente não ficou ready' };
            }
            this.markActivity(`controlledRestart:done:${reason}`);
            logger.info(`WhatsApp: Reinicialização controlada concluída (${reason})`);
            return { success: true };
        } catch (err) {
            logger.error(`WhatsApp: Falha na reinicialização controlada (${reason})`, err?.message || err);
            try {
                const restore = await sessionBackup.restore();
                if (restore.success) {
                    logger.warn('WhatsApp: Sessão restaurada após falha no restart controlado, tentando inicializar novamente...');
                    await this.initialize();
                    return { success: true, restored: true };
                }
            } catch (restoreErr) {
                logger.error('WhatsApp: Falha ao restaurar sessão após restart controlado', restoreErr?.message || restoreErr);
            }
            return { success: false, message: err?.message || String(err) };
        } finally {
            this.isRestarting = false;
            this.markActivity(`controlledRestart:end:${reason}`);
        }
    }
}

export default new WhatsAppClient();
