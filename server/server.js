import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import whatsappClient from './services/whatsappClient.js';
import logger from './utils/logger.js';
import sessionBackup from './utils/sessionBackup.js';
import chatDB from './db/database.js';
import notifier from './utils/notifier.js';
import bulkSendReport from './utils/bulkSendReport.js';
import aiService from './utils/aiService.js';
import { authenticate, requireSuperadmin } from './middleware/authMiddleware.js';
import userService from './utils/userService.js';
import imageService from './utils/imageService.js';
import crypto from 'crypto';
import platformRoutes, { webhookRouter } from './routes/platformRoutes.js';
import { ensurePlatformDefaults } from './utils/platformDefaults.js';
import { ensurePlatformSeeds } from './utils/platformSeeds.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const SCHEDULE_ATTACHMENTS_MAX_SIZE = 10 * 1024 * 1024; // 10 MB (imagem, PDF, etc.)
const SCHEDULE_AUDIO_MAX_SIZE = 20 * 1024 * 1024; // 20 MB para áudio
const SCHEDULE_VIDEO_MAX_SIZE = Number(process.env.SCHEDULE_VIDEO_MAX_SIZE) || 32 * 1024 * 1024; // 32 MB para vídeo

function getScheduleAttachmentMaxSize(mimeType, fileName) {
    const mime = String(mimeType || '');
    if (mime.startsWith('audio/')) return SCHEDULE_AUDIO_MAX_SIZE;
    if (mime.startsWith('video/')) return SCHEDULE_VIDEO_MAX_SIZE;
    const n = String(fileName || '').toLowerCase();
    if (/\.(mp4|mov|avi|mkv|webm|m4v|3gp|mpeg|mpg)$/.test(n)) return SCHEDULE_VIDEO_MAX_SIZE;
    return SCHEDULE_ATTACHMENTS_MAX_SIZE;
}

function formatMb(bytes) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function ensureUploadsDir() {
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function saveScheduleAttachments(scheduleId, attachments) {
    if (!attachments || attachments.length === 0) return { meta: null, skippedNames: [] };
    ensureUploadsDir();
    const dir = path.join(UPLOADS_DIR, `schedule_${scheduleId}`);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
    const meta = [];
    const skippedNames = [];
    for (let i = 0; i < attachments.length; i++) {
        const a = attachments[i];
        const base64 = (a.data && a.data.includes(',')) ? a.data.split(',')[1] : a.data;
        if (!base64) continue;
        const buf = Buffer.from(base64, 'base64');
        const maxSize = getScheduleAttachmentMaxSize(a.type, a.name);
        if (buf.length > maxSize) {
            skippedNames.push(`${a.name || `arquivo ${i + 1}`} (máx. ${formatMb(maxSize)})`);
            continue;
        }
        const ext = path.extname(a.name) || (a.type && a.type.startsWith('image/') ? '.jpg' : '.bin');
        const filePath = path.join(dir, `${i}${ext}`);
        try {
            fs.writeFileSync(filePath, buf);
        } catch (e) {
            if (e.code === 'ENOSPC') {
                notifier.notify('Disco cheio: não foi possível salvar anexo do agendamento.', 'warn');
            }
            throw e;
        }
        meta.push({ name: a.name, type: a.type || 'application/octet-stream' });
    }
    return { meta: meta.length ? meta : null, skippedNames };
}

function loadScheduleAttachments(scheduleId, attachmentsMeta) {
    if (!attachmentsMeta || attachmentsMeta.length === 0) return [];
    const dir = path.join(UPLOADS_DIR, `schedule_${scheduleId}`);
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (let i = 0; i < attachmentsMeta.length; i++) {
        const m = attachmentsMeta[i];
        const ext = path.extname(m.name) || '.bin';
        const filePath = path.join(dir, `${i}${ext}`);
        if (!fs.existsSync(filePath)) continue;
        const buf = fs.readFileSync(filePath);
        out.push({ name: m.name, type: m.type, data: `data:${m.type};base64,${buf.toString('base64')}` });
    }
    return out;
}

function removeScheduleAttachments(scheduleId) {
    const dir = path.join(UPLOADS_DIR, `schedule_${scheduleId}`);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
}

const app = express();
const PORT = 3001;
const RESTART_TIMEOUT_MS = Number(process.env.RESTART_TIMEOUT_MS) || 120000;
const RESTART_SAFE_DELAY_MS = Number(process.env.RESTART_SAFE_DELAY_MS) || 120000;
const HEALTHCHECK_INTERVAL_MS = Number(process.env.HEALTHCHECK_INTERVAL_MS) || 60000;
const HEALTHCHECK_STALE_MS = Number(process.env.HEALTHCHECK_STALE_MS) || 15 * 60 * 1000;
/** Sem nunca ficar ready (ex.: Chrome/lock após reboot) — antes o healthcheck só actuava com ready=true. */
const HEALTHCHECK_STUCK_CONNECTING_MS = Number(process.env.HEALTHCHECK_STUCK_CONNECTING_MS) || 12 * 60 * 1000;
/** Autenticou mas nunca chegou a ready (travou em 97–99%) */
const HEALTHCHECK_STUCK_AFTER_AUTH_MS = Number(process.env.HEALTHCHECK_STUCK_AFTER_AUTH_MS) || 3 * 60 * 1000;
const HEALTHCHECK_RESTART_COOLDOWN_MS = Number(process.env.HEALTHCHECK_RESTART_COOLDOWN_MS) || 30 * 60 * 1000;
const STARTUP_INIT_MAX_ATTEMPTS = Number(process.env.STARTUP_INIT_MAX_ATTEMPTS) || 6;
const STARTUP_INIT_RETRY_MS = Number(process.env.STARTUP_INIT_RETRY_MS) || 8000;
const DAILY_RESTART_TIME = process.env.DAILY_RESTART_TIME || '';
const DAILY_RESTART_TZ = process.env.DAILY_RESTART_TZ || 'America/Sao_Paulo';

// Middleware
app.use(cors());
app.use(express.json({ limit: '96mb' }));
app.use(express.urlencoded({ limit: '96mb', extended: true }));

let sendInProgressCount = 0;
let pendingRestartTimer = null;
let lastHealthRestartAt = 0;
let healthcheckFailures = 0;
let dispatchPaused = process.env.DISPATCH_PAUSED === '1' || process.env.DISPATCH_PAUSED === 'true';
let sendCancelRequested = false;

const SEND_PROGRESS_LOG_MAX = 100;
const SEND_PROGRESS_TTL_MS = 5 * 60 * 1000;
let sendProgress = createIdleSendProgress();

function createIdleSendProgress() {
    return {
        active: false,
        status: 'idle',
        source: null,
        sourceLabel: null,
        scheduleId: null,
        total: 0,
        current: 0,
        sent: 0,
        failed: 0,
        currentChatName: null,
        currentChatId: null,
        startedAt: null,
        finishedAt: null,
        log: []
    };
}

function startSendProgress({ total, source = 'immediate', sourceLabel = 'Envio em massa', scheduleId = null }) {
    sendProgress = {
        active: true,
        status: 'running',
        source,
        sourceLabel,
        scheduleId,
        total,
        current: 0,
        sent: 0,
        failed: 0,
        currentChatName: null,
        currentChatId: null,
        startedAt: Date.now(),
        finishedAt: null,
        log: [{
            ts: Date.now(),
            type: 'info',
            message: `Iniciando envio para ${total} destino(s)…`,
            index: 0,
            total
        }]
    };
}

function pushSendProgressLog(entry) {
    if (!sendProgress.active && sendProgress.status === 'idle') return;
    sendProgress.log.push({ ts: Date.now(), ...entry });
    if (sendProgress.log.length > SEND_PROGRESS_LOG_MAX) {
        sendProgress.log = sendProgress.log.slice(-SEND_PROGRESS_LOG_MAX);
    }
}

function setSendProgressCurrent(index, chatId, chatName) {
    sendProgress.current = index;
    sendProgress.currentChatId = chatId;
    sendProgress.currentChatName = chatName;
}

function finishSendProgress(finalStatus = 'completed') {
    sendProgress.active = false;
    sendProgress.status = finalStatus;
    sendProgress.finishedAt = Date.now();
    sendProgress.currentChatName = null;
    sendProgress.currentChatId = null;
    const summary = `${sendProgress.sent} enviado(s), ${sendProgress.failed} falha(s)`;
    pushSendProgressLog({
        type: finalStatus === 'failed' ? 'error' : 'success',
        message: `Envio concluído — ${summary}`,
        index: sendProgress.total,
        total: sendProgress.total
    });
    setTimeout(() => {
        if (!sendProgress.active && sendProgress.finishedAt && Date.now() - sendProgress.finishedAt >= SEND_PROGRESS_TTL_MS) {
            sendProgress = createIdleSendProgress();
        }
    }, SEND_PROGRESS_TTL_MS + 500);
}

function getSendProgressSnapshot() {
    const done = sendProgress.sent + sendProgress.failed;
    const percent = sendProgress.total > 0
        ? Math.min(100, Math.round((done / sendProgress.total) * 100))
        : 0;
    return {
        ...sendProgress,
        percent,
        done
    };
}

function withTimeout(promise, timeoutMs, message) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))
    ]);
}

// Debug log ingest (writes to .cursor/debug.log in workspace)
const debugLogPath = path.join(__dirname, '..', '.cursor', 'debug.log');
app.post('/api/debug-log', (req, res) => {
    try {
        fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
        const line = JSON.stringify({ ...req.body, timestamp: req.body.timestamp || Date.now() }) + '\n';
        fs.appendFileSync(debugLogPath, line);
        if (req.body?.data?.hypothesisId) process.stdout.write(`[debug-log] ${req.body.location} ${req.body.data.hypothesisId}\n`);
    } catch (e) {
        logger.warn('Debug log write failed', { path: debugLogPath, err: e.message });
    }
    res.status(204).end();
});

// Webhooks de integração (token na query — antes do auth JWT)
app.use('/api/webhooks', webhookRouter);

ensurePlatformDefaults();
ensurePlatformSeeds();

// Servir arquivos estáticos do frontend (quando buildado)
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
}

// Autenticação por sessão (JWT) ou API_KEY legado
app.use(authenticate);

app.use('/api/platform', platformRoutes);

app.get('/api/inbox/conversations', (req, res) => {
    res.json(chatDB.listInboxConversations(200));
});

app.get('/api/inbox/conversations/:chatId/messages', (req, res) => {
    const chatId = decodeURIComponent(req.params.chatId);
    res.json(chatDB.listInboxMessages(chatId, 200));
});

app.post('/api/inbox/conversations/:chatId/read', (req, res) => {
    chatDB.markInboxConversationRead(decodeURIComponent(req.params.chatId));
    res.json({ success: true });
});

app.post('/api/inbox/conversations/:chatId/mode', (req, res) => {
    try {
        const chatId = decodeURIComponent(req.params.chatId);
        const { mode } = req.body || {};
        const conv = chatDB.setInboxConversationMode(chatId, mode);
        if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
        res.json(conv);
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

app.post('/api/inbox/conversations/:chatId/test-agent', async (req, res) => {
    try {
        if (req.user?.role !== 'superadmin') {
            return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
        }
        const chatId = decodeURIComponent(req.params.chatId);
        const conv = chatDB.getInboxConversation(chatId);
        if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
        const status = whatsappClient.getStatus();
        if (!status.ready) return res.status(409).json({ error: 'WhatsApp não conectado' });
        const { scheduleAgentReply } = await import('./services/attendanceService.js');
        scheduleAgentReply({
            chatId,
            phone: conv.phone,
            contactName: conv.contactName,
            body: req.body?.body || conv.lastMessage,
        });
        res.json({ success: true, message: 'Agente acionado — resposta em ~2s' });
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

app.post('/api/inbox/sync', async (req, res) => {
    try {
        const status = whatsappClient.getStatus();
        if (!status.ready) {
            return res.status(409).json({ error: 'WhatsApp não conectado' });
        }
        const { syncRecentInbox } = await import('./services/inboxService.js');
        const result = await syncRecentInbox(whatsappClient.client);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

app.post('/api/inbox/reply', async (req, res) => {
    try {
        const { phone, text, chatId } = req.body || {};
        const digits = String(phone || '').replace(/\D/g, '') || String(chatId || '').replace(/@c\.us/gi, '').replace(/\D/g, '');
        const message = String(text || '').trim();
        if (!digits || !message) {
            return res.status(400).json({ error: 'Informe phone e text' });
        }
        const status = whatsappClient.getStatus();
        if (!status.ready) {
            return res.status(409).json({ error: 'WhatsApp não conectado' });
        }
        if (chatId && String(chatId).includes('@')) {
            await whatsappClient.sendChatMessage(chatId, message);
        } else {
            await whatsappClient.sendPrivateMessage(digits, message);
        }
        if (chatId) {
            chatDB.setInboxConversationMode(chatId, 'human');
            chatDB.setInboxConversationStatus(chatId, 'open');
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

userService.initSeedSuperadmin();

const sendWhatsAppAlertMessage = (number, msg) => whatsappClient.sendPrivateMessage(number, msg);
notifier.setWhatsAppAlertSender(sendWhatsAppAlertMessage);
bulkSendReport.setWhatsAppReportSender(sendWhatsAppAlertMessage);

function emitBulkSendReport(results, meta, attachments) {
    const attachmentNames = (attachments || [])
        .map((a) => a.name || a.filename)
        .filter(Boolean);
    bulkSendReport.notifyBulkSendReport({
        results,
        meta,
        startedAt: sendProgress.startedAt,
        finishedAt: Date.now(),
        attachmentNames
    });
}

// Restaura backup da sessão só se a pasta da sessão não existir (evita sobrescrever restore manual)
(async () => {
    const sessionDir = path.join(__dirname, '.wwebjs_auth', 'session');
    const sessionExists = fs.existsSync(sessionDir);
    if (!sessionExists) {
        try {
            const restore = await sessionBackup.restore();
            if (restore.success) {
                logger.info('Servidor: Sessão restaurada do backup antes da inicialização');
            }
        } catch (e) {
            logger.warn('Servidor: Nenhum backup disponível ou erro ao restaurar', e?.message || e);
        }
    }
    for (let attempt = 1; attempt <= STARTUP_INIT_MAX_ATTEMPTS; attempt++) {
        try {
            await whatsappClient.initialize();
            if (attempt > 1) logger.info(`WhatsApp: Inicialização ao subir servidor OK na tentativa ${attempt}/${STARTUP_INIT_MAX_ATTEMPTS}`);
            return;
        } catch (e) {
            logger.error(
                `WhatsApp: Falha na inicialização ao subir servidor (tentativa ${attempt}/${STARTUP_INIT_MAX_ATTEMPTS})`,
                e?.message || e
            );
            if (attempt < STARTUP_INIT_MAX_ATTEMPTS) {
                await new Promise((r) => setTimeout(r, STARTUP_INIT_RETRY_MS));
            }
        }
    }
})();

// Encerramento graceful: preserva sessão ao parar o processo (pm2 stop, Ctrl+C)
const gracefulShutdown = async () => {
    logger.info('Servidor: Encerramento graceful, preservando sessão WhatsApp...');
    await whatsappClient.destroyGracefully();
    process.exit(0);
};
process.on('SIGTERM', () => { gracefulShutdown().catch(() => process.exit(1)); });
process.on('SIGINT', () => { gracefulShutdown().catch(() => process.exit(1)); });

// API Routes
function getSendActivity() {
    const busy = sendInProgressCount > 0 || scheduleWorkerRunning;
    const progress = getSendProgressSnapshot();
    return {
        sendInProgress: busy,
        sendInProgressCount,
        scheduleWorkerRunning,
        chatsSyncInProgress: whatsappClient.isChatsSyncInProgress?.() ?? false,
        sendProgressActive: progress.active,
        sendProgressPercent: progress.percent,
        dispatchPaused
    };
}

app.get('/api/status', async (req, res) => {
    const status = whatsappClient.getStatus();
    res.json({ ...status, ...getSendActivity() });
});

app.get('/api/send-progress', (req, res) => {
    res.json(getSendProgressSnapshot());
});

app.get('/api/ai/providers', (req, res) => {
    res.json(aiService.getAvailableProviders());
});

app.post('/api/ai/palavra-do-dia', async (req, res) => {
    try {
        const { reference, provider, scheduledAt } = req.body || {};
        if (!reference || !String(reference).trim()) {
            return res.status(400).json({ error: 'Informe a referência bíblica (ex.: Gênesis 10:30).' });
        }
        const result = await aiService.generatePalavraDoDia({
            reference: String(reference).trim(),
            provider,
            scheduledAt: scheduledAt || ''
        });
        res.json({ success: true, ...result });
    } catch (err) {
        const msg = err?.message || String(err);
        const status = msg.includes('não configurada') || msg.includes('indisponível') ? 503 : 400;
        if (status >= 500) logger.error('API: Erro na Palavra do Dia', msg);
        else logger.warn('API: Palavra do Dia recusada:', msg);
        res.status(status).json({ error: msg });
    }
});

app.post('/api/ai/generate', async (req, res) => {
    try {
        const { action, provider, brief, currentText } = req.body || {};
        const validActions = new Set(['generate', 'shorten', 'rewrite']);
        if (!action || !validActions.has(action)) {
            return res.status(400).json({ error: 'action deve ser generate, shorten ou rewrite' });
        }
        const result = await aiService.generateAiText({
            action,
            provider,
            brief: brief || '',
            currentText: currentText || ''
        });
        res.json({ success: true, ...result });
    } catch (err) {
        const msg = err?.message || String(err);
        const status = msg.includes('não configurada') || msg.includes('indisponível') ? 503 : 400;
        if (status >= 500) logger.error('API: Erro na geração IA', msg);
        else logger.warn('API: Geração IA recusada:', msg);
        res.status(status).json({ error: msg });
    }
});

app.post('/api/ai/chat', async (req, res) => {
    try {
        const { messages, provider, context } = req.body || {};
        const chatContext = req.user?.role === 'creator' ? 'studio' : (context === 'studio' ? 'studio' : 'ministry');
        const result = await aiService.generateChat({ messages, provider, context: chatContext });
        res.json({ success: true, ...result });
    } catch (err) {
        const msg = err?.message || String(err);
        const status = msg.includes('não configurada') || msg.includes('indisponível') ? 503 : 400;
        if (status >= 500) logger.error('API: Erro no chat IA', msg);
        else logger.warn('API: Chat IA recusado:', msg);
        res.status(status).json({ error: msg });
    }
});

/** Envia relatório de exemplo para o número configurado (teste). */
app.post('/api/notifications/test-report', async (req, res) => {
    try {
        const status = whatsappClient.getStatus();
        if (!status.ready) {
            return res.status(409).json({ error: 'WhatsApp não conectado' });
        }
        const number = bulkSendReport.getReportWhatsAppNumber();
        if (!number) {
            return res.status(400).json({ error: 'Configure BULK_REPORT_WHATSAPP_NUMBER ou ALERT_WHATSAPP_NUMBER no .env' });
        }
        const finishedAt = Date.now();
        const text = bulkSendReport.buildBulkSendReportWhatsAppText({
            results: { sent: 33, failed: 0, errors: [] },
            meta: { sourceLabel: 'Teste de relatório' },
            startedAt: finishedAt - 45200,
            finishedAt,
            attachmentNames: ['IMAGEM_JUNHO.jpeg', 'audio.ogg']
        });
        await whatsappClient.sendPrivateMessage(number, text);
        res.json({ success: true, to: number });
    } catch (err) {
        logger.error('API: Erro no teste de relatório', err.message);
        res.status(500).json({ error: err.message });
    }
});

/** Pausa worker, cancela envio em andamento e pausa agendamentos pendentes. */
app.post('/api/dispatch/stop-all', (req, res) => {
    try {
        dispatchPaused = true;
        sendCancelRequested = true;

        const list = chatDB.getAllSchedules(500);
        let paused = 0;
        let sendingStopped = 0;
        for (const s of list) {
            if (s.status === 'pending') {
                chatDB.updateScheduleStatus(s.id, 'paused', 'Pausado pelo usuário');
                paused += 1;
            } else if (s.status === 'sending') {
                chatDB.updateScheduleStatus(s.id, 'paused', 'Envio interrompido pelo usuário');
                sendingStopped += 1;
            }
        }

        logger.warn('API: Parada de emergência — dispatch pausado', { paused, sendingStopped });
        notifier.notifyOnce(
            'dispatch-stop-all',
            `Parada de emergência: disparos pausados. ${paused} agendamento(s) pausado(s), envio em andamento será interrompido.`,
            'warn',
            60 * 1000
        );

        res.json({
            success: true,
            dispatchPaused: true,
            sendCancelRequested: true,
            pausedSchedules: paused,
            sendingSchedulesStopped: sendingStopped
        });
    } catch (err) {
        logger.error('API: Erro ao pausar disparos', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/dispatch/resume', (req, res) => {
    dispatchPaused = false;
    sendCancelRequested = false;
    logger.info('API: Disparos reativados pelo usuário');
    res.json({ success: true, dispatchPaused: false });
});

app.get('/api/health', (req, res) => {
    try {
        const status = whatsappClient.getStatus();
        const whatsapp = status.ready
            ? 'connected'
            : status.pairingCode
                ? 'connecting'
                : status.qr
                    ? 'connecting'
                    : 'disconnected';
        const schedulesPending = chatDB.getSchedulesPendingCount();
        res.json({
            ok: true,
            whatsapp,
            schedulesPending,
            ...getSendActivity()
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get('/api/qr', async (req, res) => {
    const status = whatsappClient.getStatus();
    if (status.qr) {
        res.json({ qr: status.qr });
    } else {
        res.status(404).json({ error: 'QR Code não disponível' });
    }
});

app.post('/api/pairing-code', async (req, res) => {
    try {
        const { phoneNumber } = req.body || {};
        if (!phoneNumber || !String(phoneNumber).trim()) {
            return res.status(400).json({ error: 'Informe o número do WhatsApp (DDI + DDD + número).' });
        }
        const phone = String(phoneNumber).trim();
        let normalized;
        try {
            normalized = whatsappClient.normalizePairingPhone(phone);
        } catch (err) {
            return res.status(400).json({ error: err?.message || String(err) });
        }
        const current = whatsappClient.getStatus();

        if (current.pairingCode && current.pairingPhone === normalized) {
            return res.json({
                success: true,
                pairingCode: current.pairingCode,
                pairingPhone: current.pairingPhone,
                generating: false,
            });
        }

        whatsappClient.startPairingCodeAsync(phone).catch((err) => {
            logger.error('API: Erro ao gerar código de pareamento (async)', err?.message || err);
        });

        res.json({
            success: true,
            generating: true,
            pairingPhone: normalized,
            message: 'Gerando código de pareamento…',
        });
    } catch (err) {
        logger.error('API: Erro ao gerar código de pareamento', err?.message || err);
        res.status(500).json({ error: err?.message || String(err) });
    }
});

app.post('/api/pairing-code/cancel', async (req, res) => {
    try {
        await whatsappClient.cancelPairingCode();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

app.get('/api/chats/groups-containing-number', async (req, res) => {
    try {
        const number = req.query.number || '';
        const result = await whatsappClient.findGroupsContainingNumber(number);
        logger.info(`API: Verificação "grupos com número" — número buscado: ${number}, sua conta: ${result.myNumber || '?'}, grupos encontrados: ${result.groups.length}`);
        res.json(result);
    } catch (err) {
        logger.error('API: Erro ao verificar grupos por número', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Grupos inválidos (sem nome / Desconhecido) e onde cada um está sendo usado — para poder remover
app.get('/api/chats/invalid-groups', (req, res) => {
    try {
        const invalidChats = chatDB.getChatsWithNoName();
        const result = invalidChats.map((chat) => ({
            id: chat.id,
            name: chat.name || '(sem nome)',
            usages: chatDB.getGroupUsages(chat.id)
        }));
        logger.info('API: Listagem de grupos inválidos', { count: result.length });
        res.json({ invalidGroups: result });
    } catch (err) {
        logger.error('API: Erro ao listar grupos inválidos', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Onde um grupo (por id) está sendo usado — categorias e agendamentos
app.get('/api/chats/group-usages/:chatId', (req, res) => {
    try {
        const chatId = req.params.chatId;
        if (!chatId) return res.status(400).json({ error: 'chatId é obrigatório' });
        const usages = chatDB.getGroupUsages(chatId);
        const chat = chatDB.getAllChats().find((c) => c.id === chatId);
        res.json({ chatId, name: chat ? chat.name : null, usages });
    } catch (err) {
        logger.error('API: Erro ao buscar usos do grupo', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Remover grupo de todas as categorias e agendamentos (para grupos inválidos/sem nome)
app.post('/api/chats/remove-group-usages', (req, res) => {
    try {
        const { chatId } = req.body || {};
        if (!chatId || typeof chatId !== 'string') {
            return res.status(400).json({ error: 'chatId é obrigatório' });
        }
        const result = chatDB.removeGroupFromAllUsages(chatId);
        for (const id of result.deletedScheduleIds || []) {
            removeScheduleAttachments(id);
        }
        logger.info('API: Grupo removido de usos', { chatId, ...result });
        res.json({ success: true, ...result });
    } catch (err) {
        logger.error('API: Erro ao remover grupo dos usos', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/chats', async (req, res) => {
    const chats = await whatsappClient.getChats();
    res.json(chats);
});

app.get('/api/chats/paginated', async (req, res) => {
    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || 10;
    const chats = await whatsappClient.getChatsPaginated(offset, limit);
    const total = whatsappClient.getChatsCount();
    res.json({ chats, total, offset, limit });
});

app.post('/api/chats/refresh', async (req, res) => {
    try {
        logger.info('API: Atualizando lista de chats');
        const chats = await whatsappClient.refreshChats();
        logger.info(`API: ${chats.length} chats atualizados`);
        res.json({ success: true, count: chats.length });
    } catch (err) {
        logger.error('API: Erro ao atualizar chats', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const history = whatsappClient.getHistory(limit);
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/history/clear', async (req, res) => {
    try {
        whatsappClient.clearHistory();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/history/today-count', (req, res) => {
    try {
        const count = chatDB.getHistoryCountToday();
        res.json({ count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/send', async (req, res) => {
    try {
        const runtime = whatsappClient.getRuntimeStatus?.();
        if (runtime?.isRestarting) {
            return res.status(503).json({ error: 'WhatsApp em reinicialização controlada, tente novamente em instantes' });
        }
        if (sendInProgressCount > 0 || scheduleWorkerRunning) {
            return res.status(409).json({ error: 'Já existe um envio em andamento. Aguarde terminar antes de iniciar outro.' });
        }
        const { chatId, content, attachments, mediaLayout } = req.body;

        if (!chatId || (!content && !attachments)) {
            logger.warn('API: Tentativa de envio com parâmetros inválidos', { chatId, hasContent: !!content, hasAttachments: !!attachments });
            return res.status(400).json({ error: 'chatId e content ou attachments são obrigatórios' });
        }

        const chatName = whatsappClient.getChatName(chatId) || '(grupo sem nome no cache)';
        const receivedAt = new Date();
        const timeStr = receivedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = receivedAt.toLocaleDateString('pt-BR');
        logger.info(`📨 Pedido de envio recebido — Destino: "${chatName}" — ${dateStr} ${timeStr}`);

        sendInProgressCount += 1;
        await whatsappClient.sendMessage(chatId, content, attachments, { mediaLayout });

        const finishedAt = new Date();
        const endStr = finishedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const segundos = ((finishedAt - receivedAt) / 1000).toFixed(1);
        logger.info(`✔ Mensagem entregue para "${chatName}" às ${endStr} (total: ${segundos}s)`);

        res.json({ success: true });
    } catch (err) {
        logger.error('API: Erro ao enviar mensagem', err.message, err);
        res.status(500).json({ error: err.message });
    } finally {
        sendInProgressCount = Math.max(0, sendInProgressCount - 1);
    }
});

// --- Envio em massa (um grupo por vez, com intervalo fixo para evitar atrasos/entupimento) ---
const DELAY_BETWEEN_SENDS_MS = 4000;
const DELAY_BETWEEN_SENDS_WITH_ATTACHMENTS_MS = 7000;
const RETRY_AFTER_DETACHED_MS = 18000;
const WAIT_FOR_READY_AFTER_RECONNECT_MS = Number(process.env.WAIT_FOR_READY_MS) || 120000; // 120s default; configurável via .env
const SCHEDULE_SESSION_RETRY_MAX = 3; // mantém pending e retenta no próximo ciclo até N vezes quando sessão indisponível
const isDetachedLikeError = (msg) => msg && (
    String(msg).includes('detached Frame') ||
    String(msg).includes('Target closed') ||
    String(msg).includes('Execution context was destroyed')
);

/** Aguarda o cliente WhatsApp ficar pronto (ex.: após reconexão), com timeout. Retorna true se pronto, false se deu tempo. */
function waitForClientReady(timeoutMs) {
    const stepMs = 3000;
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
        const check = () => {
            if (whatsappClient.getStatus().ready) {
                resolve(true);
                return;
            }
            if (Date.now() >= deadline) {
                resolve(false);
                return;
            }
            setTimeout(check, stepMs);
        };
        check();
    });
}

function isBusyForRestart() {
    const runtime = whatsappClient.getRuntimeStatus?.() || {};
    return sendInProgressCount > 0 || scheduleWorkerRunning || runtime.isReconnecting || runtime.isRestarting;
}

async function runControlledRestart(reason) {
    logger.warn(`Sistema: solicitando reinicialização controlada (${reason})`);
    const result = await withTimeout(
        whatsappClient.controlledRestart(reason),
        RESTART_TIMEOUT_MS,
        `Timeout na reinicialização controlada (${reason})`
    );
    if (!result?.success) {
        throw new Error(result?.message || `Reinicialização controlada falhou (${reason})`);
    }
    await runScheduleWorker();
    logger.info(`Sistema: reinicialização controlada finalizada (${reason})`);
    return result;
}

function scheduleControlledRestart(reason, delayMs = RESTART_SAFE_DELAY_MS) {
    if (pendingRestartTimer) return;
    logger.warn(`Sistema: restart adiado (${reason}) para daqui ${Math.round(delayMs / 1000)}s`);
    pendingRestartTimer = setTimeout(async () => {
        pendingRestartTimer = null;
        await maybeRunControlledRestart(reason);
    }, delayMs);
}

async function maybeRunControlledRestart(reason) {
    if (isBusyForRestart()) {
        scheduleControlledRestart(`${reason}-busy`, RESTART_SAFE_DELAY_MS);
        return { success: false, delayed: true };
    }
    return runControlledRestart(reason);
}

async function executeBulkSend(chatIds, content, attachments, meta = {}) {
    const hasAttachments = attachments && attachments.length > 0;
    const delayMs = hasAttachments ? DELAY_BETWEEN_SENDS_WITH_ATTACHMENTS_MS : DELAY_BETWEEN_SENDS_MS;
    const results = { sent: 0, failed: 0, errors: [] };
    const failedForRetry = [];
    const total = chatIds.length;
    let detachedDetected = false;
    const {
        source = 'immediate',
        sourceLabel = 'Envio em massa',
        scheduleId = null,
        mediaLayout = 'caption_on_image',
    } = meta;
    const sendOptions = { mediaLayout };

    startSendProgress({ total, source, sourceLabel, scheduleId });

    for (let i = 0; i < chatIds.length; i++) {
        if (sendCancelRequested) {
            const remaining = chatIds.slice(i);
            for (const cid of remaining) {
                const cname = whatsappClient.getChatName(cid) || cid;
                results.failed++;
                sendProgress.failed = results.failed;
                results.errors.push({ chatId: cid, chatName: cname, error: 'Envio cancelado pelo usuário' });
                pushSendProgressLog({
                    type: 'error',
                    message: `Cancelado: "${cname}"`,
                    chatName: cname,
                    chatId: cid,
                    index: i + 1,
                    total
                });
            }
            pushSendProgressLog({ type: 'error', message: 'Envio interrompido — cancelado pelo usuário', total });
            finishSendProgress('failed');
            sendCancelRequested = false;
            results.cancelled = true;
            emitBulkSendReport(results, { source, sourceLabel, scheduleId }, attachments);
            return results;
        }
        const chatId = chatIds[i];
        const chatName = whatsappClient.getChatName(chatId) || chatId;
        setSendProgressCurrent(i + 1, chatId, chatName);
        pushSendProgressLog({
            type: 'info',
            message: `Enviando para "${chatName}"…`,
            chatName,
            chatId,
            index: i + 1,
            total
        });
        try {
            await whatsappClient.sendMessage(chatId, content, attachments, sendOptions);
            results.sent++;
            sendProgress.sent = results.sent;
            pushSendProgressLog({
                type: 'success',
                message: `Entregue: "${chatName}"`,
                chatName,
                chatId,
                index: i + 1,
                total
            });
            logger.info(`✔ [${i + 1}/${total}] Entregue: "${chatName}"`);
        } catch (err) {
            results.failed++;
            sendProgress.failed = results.failed;
            const errMsg = (err && err.message) ? String(err.message) : String(err);
            results.errors.push({ chatId, chatName, error: errMsg });
            pushSendProgressLog({
                type: 'error',
                message: `Falha em "${chatName}": ${errMsg.length > 120 ? errMsg.slice(0, 120) + '…' : errMsg}`,
                chatName,
                chatId,
                index: i + 1,
                total
            });
            const errPreview = errMsg.length > 400 ? errMsg.slice(0, 400) + '...' : errMsg;
            logger.error(`❌ [${i + 1}/${total}] Falha no grupo "${chatName}" (id: ${chatId}): ${errPreview}`);
            if (errMsg.length > 400) logger.error('Erro completo:', errMsg);

            if (isDetachedLikeError(err.message)) {
                failedForRetry.push({ chatId, chatName });
                if (!detachedDetected) {
                    detachedDetected = true;
                    const remaining = total - (i + 1);
                    if (remaining > 0) {
                        logger.warn(`Sessão WhatsApp Web inválida (detached Frame). Interrompendo envio; ${remaining} grupo(s) restantes marcados como falha. Reconectando...`);
                        pushSendProgressLog({
                            type: 'error',
                            message: `Sessão instável — interrompendo envio (${remaining} destino(s) restantes)`,
                            index: i + 1,
                            total
                        });
                        notifier.notifyOnce(
                            'whatsapp-session-detached',
                            `Sessão WhatsApp Web inválida (detached Frame). Envio interrompido; ${remaining + 1} grupo(s) não enviados. Reconexão automática em andamento.`,
                            'warn',
                            2 * 60 * 1000
                        );
                        for (let j = i + 1; j < chatIds.length; j++) {
                            const cid = chatIds[j];
                            const cname = whatsappClient.getChatName(cid) || cid;
                            results.failed++;
                            sendProgress.failed = results.failed;
                            results.errors.push({ chatId: cid, chatName: cname, error: err.message });
                            failedForRetry.push({ chatId: cid, chatName: cname });
                            pushSendProgressLog({
                                type: 'error',
                                message: `Não enviado (sessão): "${cname}"`,
                                chatName: cname,
                                chatId: cid,
                                index: j + 1,
                                total
                            });
                        }
                    }
                    whatsappClient.requestReconnect();
                    break;
                }
            }
        }
        if (i < chatIds.length - 1 && !detachedDetected) {
            await new Promise(r => setTimeout(r, delayMs));
        }
    }

    if (failedForRetry.length > 0) {
        const waitMs = detachedDetected ? Math.max(RETRY_AFTER_DETACHED_MS, 25000) : RETRY_AFTER_DETACHED_MS;
        logger.info(`Envio em massa: ${failedForRetry.length} falha(s) por Frame detach; aguardando ${waitMs / 1000}s para retry`);
        pushSendProgressLog({
            type: 'info',
            message: `Aguardando reconexão para retentar ${failedForRetry.length} destino(s)…`,
            total
        });
        await new Promise(r => setTimeout(r, waitMs));

        if (detachedDetected) {
            const ready = await waitForClientReady(WAIT_FOR_READY_AFTER_RECONNECT_MS);
            if (!ready) {
                logger.warn('Cliente WhatsApp ainda não está pronto após reconexão; retry de envio em massa cancelado. Tente novamente quando estiver conectado.');
                notifier.notify('Reconexão automática feita, mas o WhatsApp ainda não está pronto. Envio em massa não reenviado; tente de novo quando estiver conectado.', 'warn');
                results.sessionUnhealthy = true;
            } else {
                logger.info('Cliente WhatsApp pronto; executando retry dos envios que falharam.');
                pushSendProgressLog({ type: 'info', message: 'WhatsApp reconectado — retentando envios…', total });
            }
        }

        if (!detachedDetected || whatsappClient.getStatus().ready) {
            for (let i = 0; i < failedForRetry.length; i++) {
                const { chatId, chatName } = failedForRetry[i];
                pushSendProgressLog({
                    type: 'info',
                    message: `Retentando "${chatName}"…`,
                    chatName,
                    chatId,
                    total
                });
                try {
                    await whatsappClient.sendMessage(chatId, content, attachments, sendOptions);
                    results.sent++;
                    results.failed--;
                    sendProgress.sent = results.sent;
                    sendProgress.failed = results.failed;
                    results.errors = results.errors.filter(e => e.chatId !== chatId);
                    pushSendProgressLog({
                        type: 'success',
                        message: `Entregue (retry): "${chatName}"`,
                        chatName,
                        chatId,
                        total
                    });
                    logger.info(`✔ [retry] Entregue: "${chatName}"`);
            } catch (err) {
                const errMsg = (err && err.message) ? String(err.message) : String(err);
                pushSendProgressLog({
                    type: 'error',
                    message: `Falha no retry "${chatName}": ${errMsg.length > 100 ? errMsg.slice(0, 100) + '…' : errMsg}`,
                    chatName,
                    chatId,
                    total
                });
                const errPreview = errMsg.length > 400 ? errMsg.slice(0, 400) + '...' : errMsg;
                logger.error(`❌ [retry] Falha no grupo "${chatName}" (id: ${chatId}): ${errPreview}`);
                if (errMsg.length > 400) logger.error('Erro completo (retry):', errMsg);
            }
                if (i < failedForRetry.length - 1) await new Promise(r => setTimeout(r, delayMs));
            }
        }
    }

    finishSendProgress(results.failed > 0 ? 'failed' : 'completed');
    emitBulkSendReport(results, { source, sourceLabel, scheduleId }, attachments);
    return results;
}

app.post('/api/send-bulk', async (req, res) => {
    try {
        const runtime = whatsappClient.getRuntimeStatus?.();
        if (runtime?.isRestarting) {
            return res.status(503).json({ error: 'WhatsApp em reinicialização controlada, tente novamente em instantes' });
        }
        if (sendInProgressCount > 0 || scheduleWorkerRunning) {
            return res.status(409).json({ error: 'Já existe um envio em andamento. Aguarde terminar antes de iniciar outro.' });
        }
        if (dispatchPaused) {
            return res.status(409).json({ error: 'Disparos pausados. Reative em Configurações ou POST /api/dispatch/resume.' });
        }
        const { chatIds, content, attachments, mediaLayout } = req.body;

        if (!Array.isArray(chatIds) || chatIds.length === 0 || (!content && !attachments)) {
            logger.warn('API: send-bulk com parâmetros inválidos', { chatIdsLength: chatIds?.length, hasContent: !!content, hasAttachments: !!attachments });
            return res.status(400).json({ error: 'chatIds (array não vazio) e content ou attachments são obrigatórios' });
        }
        const validIds = chatIds.filter((id) => typeof id === 'string' && id.trim().length > 0);
        if (validIds.length !== chatIds.length) {
            logger.warn('API: send-bulk com chatIds inválidos (ignorados)', { received: chatIds.length, valid: validIds.length });
        }
        const idsToUse = validIds.length > 0 ? validIds : chatIds;
        const total = idsToUse.length;
        const receivedAt = new Date();
        const timeStr = receivedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateStr = receivedAt.toLocaleDateString('pt-BR');
        const delaySec = (attachments && attachments.length) ? DELAY_BETWEEN_SENDS_WITH_ATTACHMENTS_MS / 1000 : DELAY_BETWEEN_SENDS_MS / 1000;
        logger.info(`📨 Envio em massa — ${total} grupo(s) — ${dateStr} ${timeStr} (intervalo ${delaySec}s entre cada)`);

        sendInProgressCount += 1;
        const results = await executeBulkSend(idsToUse, content, attachments, {
            source: 'immediate',
            sourceLabel: 'Envio imediato',
            mediaLayout,
        });

        const finishedAt = new Date();
        const totalSec = ((finishedAt - receivedAt) / 1000).toFixed(1);
        logger.info(`📨 Envio em massa concluído — ${results.sent} ok, ${results.failed} falha(s) — total ${totalSec}s`);

        res.json({ success: results.failed === 0, ...results });
    } catch (err) {
        logger.error('API: Erro no envio em massa', err.message, err);
        res.status(500).json({ error: err.message });
    } finally {
        sendInProgressCount = Math.max(0, sendInProgressCount - 1);
    }
});

// --- Categorias de grupos ---
app.get('/api/categories', (req, res) => {
    try {
        const list = chatDB.getAllCategories();
        res.json(list);
    } catch (err) {
        logger.error('API: Erro ao listar categorias', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categories', (req, res) => {
    try {
        const { id, name, groupIds } = req.body;
        if (!name || !Array.isArray(groupIds)) {
            return res.status(400).json({ error: 'name e groupIds (array) são obrigatórios' });
        }
        const catId = id || 'cat_' + Date.now();
        chatDB.saveCategory({ id: catId, name, groupIds });
        res.json(chatDB.getCategory(catId));
    } catch (err) {
        logger.error('API: Erro ao salvar categoria', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/categories/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, groupIds } = req.body;
        if (!name || !Array.isArray(groupIds)) {
            return res.status(400).json({ error: 'name e groupIds (array) são obrigatórios' });
        }
        chatDB.saveCategory({ id, name, groupIds });
        res.json(chatDB.getCategory(id));
    } catch (err) {
        logger.error('API: Erro ao atualizar categoria', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/categories/:id', (req, res) => {
    try {
        chatDB.deleteCategory(req.params.id);
        res.json({ success: true });
    } catch (err) {
        logger.error('API: Erro ao excluir categoria', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- Log de disparos (prova de grupos selecionados) ---
app.post('/api/dispatches', (req, res) => {
    try {
        const { contentPreview, targets, categoryNames, scheduledAt } = req.body;
        if (!Array.isArray(targets)) {
            return res.status(400).json({ error: 'targets (array de { id, name }) é obrigatório' });
        }
        chatDB.saveDispatch({ contentPreview: contentPreview || '', targets, categoryNames: categoryNames || [], scheduledAt });
        res.json({ success: true });
    } catch (err) {
        logger.error('API: Erro ao registrar disparo', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dispatches', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const list = chatDB.getDispatches(limit);
        res.json(list);
    } catch (err) {
        logger.error('API: Erro ao listar disparos', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- Agendamentos (persistentes no backend) ---
app.post('/api/schedules', (req, res) => {
    try {
        const { content, targets, scheduledAt, repeatDaily, attachments, mediaLayout } = req.body;
        if (!Array.isArray(targets) || targets.length === 0 || (!content && !(attachments && attachments.length))) {
            return res.status(400).json({ error: 'targets (array não vazio) e content ou attachments são obrigatórios; scheduledAt obrigatório' });
        }
        const at = scheduledAt ? new Date(scheduledAt) : null;
        if (!at || isNaN(at.getTime())) {
            return res.status(400).json({ error: 'scheduledAt inválido' });
        }

        // Dedup no backend: evita múltiplos agendamentos idênticos (mesma mensagem, horário e destinos)
        const normalizedTargets = (targets || []).slice().sort();
        const fingerprint = `${(content || '').slice(0, 300)}|${at.getTime()}|${normalizedTargets.join(',')}`;
        const existingList = chatDB.getAllSchedules(500);
        const existing = existingList.find((s) => {
            if (s.status !== 'pending') return false;
            const atMs = s.scheduledAt ? new Date(s.scheduledAt).getTime() : null;
            const sTargets = (s.targets || []).slice().sort();
            const key = `${(s.content || '').slice(0, 300)}|${atMs}|${sTargets.join(',')}`;
            return key === fingerprint;
        });
        if (existing) {
            logger.info('API: Agendamento duplicado detectado, retornando existente', { id: existing.id });
            return res.status(200).json(existing);
        }

        const id = 'sch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const { meta: attachmentsMeta, skippedNames } = saveScheduleAttachments(id, attachments || []);
        if (skippedNames.length > 0) {
            logger.warn('API: Anexos ignorados por tamanho', { names: skippedNames });
            notifier.notify(`Agendamento criado, mas ${skippedNames.length} anexo(s) ignorado(s) por exceder o limite (áudio 20 MB / vídeo 32 MB / demais 10 MB): ${skippedNames.join(', ')}`, 'warn');
        }
        chatDB.saveSchedule({
            id,
            content: content || '',
            targets,
            scheduledAt: at.toISOString(),
            status: 'pending',
            repeatDaily: !!repeatDaily,
            attachmentsMeta,
            mediaLayout: mediaLayout || 'caption_on_image',
        });
        const row = {
            id,
            content: content || '',
            targets,
            scheduledAt: at.toISOString(),
            status: 'pending',
            repeatDaily: !!repeatDaily,
            attachmentsMeta: attachmentsMeta || null,
            mediaLayout: mediaLayout || 'caption_on_image',
        };
        if (skippedNames.length > 0) row.warnings = [`Anexo(s) ignorado(s) por exceder o limite (áudio 20 MB / vídeo 32 MB / demais 10 MB): ${skippedNames.join(', ')}`];
        logger.info('API: Agendamento criado', { id, scheduledAt: at.toISOString(), targetsCount: targets.length });
        res.status(201).json(row);
    } catch (err) {
        logger.error('API: Erro ao criar agendamento', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/schedules', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 200;
        const list = chatDB.getAllSchedules(limit);
        res.json(list);
    } catch (err) {
        logger.error('API: Erro ao listar agendamentos', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Apaga todos os agendamentos (pendentes, enviados, falhos, etc.) e pastas de anexos
app.delete('/api/schedules', (req, res) => {
    try {
        const { deleted, ids } = chatDB.deleteAllSchedules();
        for (const id of ids) {
            removeScheduleAttachments(id);
        }
        logger.info('API: Todos os agendamentos removidos', { deleted });
        res.json({ success: true, deleted });
    } catch (err) {
        logger.error('API: Erro ao apagar agendamentos', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/schedules/:id', (req, res) => {
    try {
        const { id } = req.params;
        const list = chatDB.getAllSchedules(500);
        if (!list.some(s => s.id === id)) {
            return res.status(404).json({ error: 'Agendamento não encontrado' });
        }
        chatDB.deleteSchedule(id);
        removeScheduleAttachments(id);
        logger.info('API: Agendamento cancelado', { id });
        res.json({ success: true });
    } catch (err) {
        logger.error('API: Erro ao cancelar agendamento', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Pausar ou reativar agendamento (só pending <-> paused)
app.put('/api/schedules/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { status: newStatus } = req.body || {};
        if (newStatus !== 'paused' && newStatus !== 'pending') {
            return res.status(400).json({ error: 'status deve ser "paused" ou "pending"' });
        }
        const list = chatDB.getAllSchedules(500);
        const schedule = list.find(s => s.id === id);
        if (!schedule) return res.status(404).json({ error: 'Agendamento não encontrado' });
        if (schedule.status !== 'pending' && schedule.status !== 'paused') {
            return res.status(400).json({ error: 'Só é possível pausar ou reativar agendamentos pendentes ou pausados' });
        }
        chatDB.updateScheduleStatus(id, newStatus, null);
        const updated = list.map(s => s.id === id ? { ...s, status: newStatus } : s).find(s => s.id === id);
        logger.info('API: Agendamento atualizado', { id, status: newStatus });
        res.json(updated || { ...schedule, status: newStatus });
    } catch (err) {
        logger.error('API: Erro ao atualizar agendamento', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Envia um agendamento imediatamente (principalmente útil para status "failed")
app.post('/api/schedules/:id/send-now', async (req, res) => {
    try {
        const { id } = req.params;
        const list = chatDB.getAllSchedules(500);
        const schedule = list.find((s) => s.id === id);
        if (!schedule) return res.status(404).json({ error: 'Agendamento não encontrado' });
        if (schedule.status === 'sending') return res.status(409).json({ error: 'Agendamento já está sendo enviado' });
        if (sendInProgressCount > 0 || scheduleWorkerRunning) {
            return res.status(409).json({ error: 'Já existe um envio em andamento. Aguarde terminar antes de iniciar outro.' });
        }

        const status = whatsappClient.getStatus();
        if (!status.ready) return res.status(409).json({ error: 'WhatsApp não está conectado para enviar agora' });

        const attachments = loadScheduleAttachments(schedule.id, schedule.attachmentsMeta);
        chatDB.updateScheduleStatus(schedule.id, 'sending', null);
        sendInProgressCount += 1;
        let results;
        try {
            results = await executeBulkSend(schedule.targets, schedule.content, attachments, {
                source: 'schedule',
                sourceLabel: 'Reenvio de agendamento',
                scheduleId: schedule.id,
                mediaLayout: schedule.mediaLayout,
            });
        } finally {
            sendInProgressCount = Math.max(0, sendInProgressCount - 1);
        }
        const failed = results.failed > 0;
        chatDB.updateScheduleStatus(schedule.id, failed ? 'failed' : 'sent', failed ? `${results.failed} falha(s)` : null);
        if (!failed) {
            removeScheduleAttachments(schedule.id);
        }
        res.json({ success: !failed, ...results });
    } catch (err) {
        logger.error('API: Erro ao enviar agendamento agora', err.message);
        res.status(500).json({ error: err.message });
    }
});

function clearAllOperationalData() {
    const { scheduleIds } = chatDB.clearAllOperationalData();
    for (const id of scheduleIds) {
        removeScheduleAttachments(id);
    }
    logger.info('API: Dados operacionais limpos', {
        schedules: scheduleIds.length,
    });
}

app.post('/api/disconnect', async (req, res) => {
    try {
        clearAllOperationalData();
        await whatsappClient.logout({ manual: true });
        res.json({ success: true, message: 'Desconectado. Dados limpos para o próximo login.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/reconnect', async (req, res) => {
    try {
        const backup = await sessionBackup.backup({ force: true });
        if (backup.success) {
            logger.info('API: Backup criado antes da reconexão');
        }
        
        await whatsappClient.logout(false); // false = tenta preservar sessão
        setTimeout(() => whatsappClient.initialize(), 2000);
        res.json({ success: true, message: 'Reconexão iniciada (sessão preservada)' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint para fazer backup manual da sessão
app.post('/api/session/backup', async (req, res) => {
    try {
        const backup = await sessionBackup.backup({ force: true });
        if (backup.success) {
            res.json({ success: true, message: 'Backup criado com sucesso' });
        } else {
            res.status(500).json({ error: backup.message });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint para restaurar backup (body opcional: { backup: "session-2026-03-06T21-02-17-657Z" } para backup específico)
app.post('/api/session/restore', async (req, res) => {
    try {
        const backupName = req.body && req.body.backup;
        const restore = backupName
            ? await sessionBackup.restoreByName(backupName)
            : await sessionBackup.restore();
        if (restore.success) {
            // Reinicializar após restaurar
            await whatsappClient.logout(false);
            setTimeout(() => whatsappClient.initialize(), 2000);
            res.json({ success: true, message: 'Backup restaurado e reconectando...', backup: restore.backup });
        } else {
            res.status(500).json({ error: restore.message });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint para listar backups
app.get('/api/session/backups', async (req, res) => {
    try {
        const backups = sessionBackup.listAllBackups();
        res.json({ success: true, backups });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Auth & Estúdio de Conteúdo ---
app.post('/api/login', (req, res) => {
    try {
        const { email, password } = req.body || {};
        const result = userService.login(email, password);
        if (!result) {
            return res.status(401).json({ error: 'Usuário ou senha inválidos' });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err?.message || String(err) });
    }
});

app.get('/api/me', (req, res) => {
    res.json({ user: req.user });
});

app.get('/api/users', requireSuperadmin, (req, res) => {
    res.json({ users: userService.listUsers() });
});

app.post('/api/users', requireSuperadmin, (req, res) => {
    try {
        const { email, password, name, role } = req.body || {};
        const user = userService.createUser({ email, password, name, role: role || 'creator' });
        res.json({ success: true, user });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

app.patch('/api/users/:id', requireSuperadmin, (req, res) => {
    try {
        const user = userService.updateUser(req.params.id, req.body || {});
        res.json({ success: true, user });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

app.post('/api/studio/copy/generate', async (req, res) => {
    try {
        const { brief, action = 'generate', currentText, provider, save, title } = req.body || {};
        const result = await aiService.generateAiText({
            action,
            provider,
            brief: brief || '',
            currentText: currentText || '',
            context: 'studio'
        });
        let item = null;
        if (save) {
            item = chatDB.createContentItem({
                id: crypto.randomUUID(),
                userId: req.user.id,
                userName: req.user.name,
                type: 'copy',
                title: title || String(brief || 'Copy').slice(0, 80),
                body: result.text,
                brief: brief || currentText || null,
                status: 'draft'
            });
        }
        res.json({ success: true, ...result, item });
    } catch (err) {
        const msg = err?.message || String(err);
        const status = msg.includes('não configurada') ? 503 : 400;
        res.status(status).json({ error: msg });
    }
});

app.post('/api/studio/image/generate', async (req, res) => {
    try {
        const { prompt, aspectRatio, save, title } = req.body || {};
        const image = await imageService.generateImage({ prompt, aspectRatio });
        let item = null;
        if (save !== false) {
            item = chatDB.createContentItem({
                id: crypto.randomUUID(),
                userId: req.user.id,
                userName: req.user.name,
                type: 'image',
                title: title || String(prompt).slice(0, 80),
                body: prompt,
                imageFilename: image.filename,
                brief: prompt,
                status: 'draft',
                metadata: { aspectRatio: aspectRatio || '1:1', url: image.url }
            });
        }
        res.json({ success: true, image, item });
    } catch (err) {
        const msg = err?.message || String(err);
        const status = msg.includes('não configurada') ? 503 : 400;
        res.status(status).json({ error: msg });
    }
});

app.get('/api/studio/items', (req, res) => {
    const { status, type } = req.query || {};
    const userId = req.user.role === 'superadmin' ? (req.query.userId || null) : req.user.id;
    const items = chatDB.getContentItems({
        userId,
        status: status || null,
        type: type || null,
        limit: 200
    });
    res.json({ items });
});

app.post('/api/studio/items', (req, res) => {
    try {
        const { title, body, brief, type = 'copy' } = req.body || {};
        if (!String(body || '').trim()) {
            return res.status(400).json({ error: 'Corpo do conteúdo é obrigatório.' });
        }
        const item = chatDB.createContentItem({
            id: crypto.randomUUID(),
            userId: req.user.id,
            userName: req.user.name,
            type: type === 'image' ? 'image' : 'copy',
            title: String(title || 'Rascunho').slice(0, 80),
            body: String(body).trim(),
            brief: brief || null,
            status: 'draft'
        });
        res.json({ success: true, item });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

app.patch('/api/studio/items/:id', (req, res) => {
    try {
        const item = chatDB.getContentItem(req.params.id);
        if (!item) return res.status(404).json({ error: 'Item não encontrado' });
        const isOwner = item.userId === req.user.id;
        const isAdmin = req.user.role === 'superadmin';
        if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Sem permissão' });
        const { status, body, title } = req.body || {};
        const updated = chatDB.updateContentItem(item.id, { status, body, title });
        res.json({ success: true, item: updated });
    } catch (err) {
        res.status(400).json({ error: err?.message || String(err) });
    }
});

app.get('/api/studio/files/:filename', (req, res) => {
    const filePath = imageService.getContentFilePath(req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const item = chatDB.getContentItems({ limit: 500 }).find((i) => i.imageFilename === req.params.filename);
    if (item && item.userId !== req.user.id && req.user.role !== 'superadmin') {
        return res.status(403).json({ error: 'Sem permissão' });
    }
    res.sendFile(filePath);
});

// Fallback para SPA (apenas se dist existir)
app.get('*', (req, res) => {
    const distIndex = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(distIndex)) {
        res.sendFile(distIndex);
    } else {
        res.status(404).json({
            error: 'Frontend não buildado.',
            message: 'O backend (Evolution Adapter) está rodando.'
        });
    }
});

// Worker: processa agendamentos pendentes a cada 60s
const SCHEDULE_WORKER_INTERVAL_MS = 60 * 1000;

function getNextDaySameTime(ms) {
    const d = new Date(ms);
    d.setDate(d.getDate() + 1);
    return d.toISOString();
}

let scheduleWorkerRunning = false;

async function runScheduleWorker() {
    if (scheduleWorkerRunning) return;
    if (dispatchPaused) return;
    scheduleWorkerRunning = true;
    try {
        const due = chatDB.getPendingSchedulesDue();
        const runtime = whatsappClient.getRuntimeStatus?.();
        if (runtime?.isRestarting) {
            if (due.length > 0) {
                notifier.notifyOnce(
                    'worker-paused-restart',
                    `Worker pausado: reinicialização do WhatsApp em andamento. ${due.length} agendamento(s) vencido(s) aguardam — nada será enviado até concluir.`,
                    'warn',
                    2 * 60 * 1000
                );
            }
            logger.info('Worker: pausado temporariamente (reinicialização controlada em andamento)');
            return;
        }
        const status = whatsappClient.getStatus();
        if (!status.ready) {
            if (due.length > 0) {
                logger.warn(`Worker: ${due.length} agendamento(s) vencido(s) aguardando — WhatsApp ainda não conectado`);
                const nextMs = due[0] && due[0].scheduledAt;
                const nextHint = typeof nextMs === 'number' ? new Date(nextMs).toISOString() : String(nextMs || '—');
                notifier.notifyOnce(
                    'worker-whatsapp-offline',
                    `WhatsApp offline ou ainda a conectar. ${due.length} agendamento(s) já vencido(s) não serão enviados até a sessão ficar ativa. Conferir VPS / QR. (1º vencido: ${nextHint})`,
                    'warn',
                    3 * 60 * 1000
                );
            }
            return;
        }
        if (due.length === 0) return;
        for (const schedule of due) {
            chatDB.updateScheduleStatus(schedule.id, 'sending', null);
            const attachments = loadScheduleAttachments(schedule.id, schedule.attachmentsMeta);
            try {
                logger.info(`Worker: Executando agendamento ${schedule.id} (${schedule.targets.length} grupo(s))`);
                const results = await executeBulkSend(schedule.targets, schedule.content, attachments, {
                    source: 'worker',
                    sourceLabel: 'Agendamento automático',
                    scheduleId: schedule.id,
                    mediaLayout: schedule.mediaLayout,
                });
                if (results.sessionUnhealthy && (schedule.retryCount ?? 0) < SCHEDULE_SESSION_RETRY_MAX) {
                    chatDB.incrementScheduleRetryCount(schedule.id);
                    logger.info(`Worker: Agendamento ${schedule.id} mantido como pending (retry ${(schedule.retryCount ?? 0) + 1}/${SCHEDULE_SESSION_RETRY_MAX} por sessão indisponível)`);
                    continue;
                }
                chatDB.updateScheduleStatus(schedule.id, results.failed === 0 ? 'sent' : 'failed', results.failed > 0 ? `${results.failed} falha(s)` : null);
                if (results.failed === 0) {
                    removeScheduleAttachments(schedule.id);
                }
                if (results.failed === 0 && schedule.repeatDaily) {
                    const nextId = 'sch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                    const scheduledAtMs = typeof schedule.scheduledAt === 'number' ? schedule.scheduledAt : new Date(schedule.scheduledAt).getTime();
                    chatDB.saveSchedule({
                        id: nextId,
                        content: schedule.content,
                        targets: schedule.targets,
                        scheduledAt: getNextDaySameTime(scheduledAtMs),
                        status: 'pending',
                        repeatDaily: true,
                        attachmentsMeta: null,
                        mediaLayout: schedule.mediaLayout || 'caption_on_image',
                    });
                    logger.info(`Worker: repeatDaily — novo agendamento ${nextId} para ${getNextDaySameTime(scheduledAtMs)}`);
                }
            } catch (err) {
                logger.error('Worker: Erro ao executar agendamento', schedule.id, err.message);
                chatDB.updateScheduleStatus(schedule.id, 'failed', err.message);
                emitBulkSendReport(
                    {
                        sent: 0,
                        failed: schedule.targets.length,
                        errors: [{ chatId: '-', chatName: 'erro interno', error: err.message }]
                    },
                    {
                        source: 'worker',
                        sourceLabel: 'Agendamento automático (erro)',
                        scheduleId: schedule.id
                    },
                    loadScheduleAttachments(schedule.id, schedule.attachmentsMeta)
                );
            }
        }
    } finally {
        scheduleWorkerRunning = false;
    }
}

function getNowInTimeZoneParts(timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date());
    const map = {};
    for (const p of parts) {
        if (p.type !== 'literal') map[p.type] = p.value;
    }
    return map;
}

function getDelayUntilNextDaily(timeHHmm, timeZone) {
    const [hStr, mStr] = timeHHmm.split(':');
    const targetMinutes = (Number(hStr) * 60) + Number(mStr);
    const nowUtc = Date.now();
    const nowParts = getNowInTimeZoneParts(timeZone);
    const nowMinutes = (Number(nowParts.hour) * 60) + Number(nowParts.minute);
    let dayOffset = 0;
    if (nowMinutes >= targetMinutes) dayOffset = 1;

    const localeDate = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date(nowUtc + dayOffset * 24 * 60 * 60 * 1000));
    const desiredLocal = `${localeDate}T${hStr.padStart(2, '0')}:${mStr.padStart(2, '0')}:00`;

    let best = null;
    for (let mins = -14 * 60; mins <= 14 * 60; mins += 30) {
        const ts = Date.UTC(
            Number(localeDate.slice(0, 4)),
            Number(localeDate.slice(5, 7)) - 1,
            Number(localeDate.slice(8, 10)),
            Number(hStr),
            Number(mStr)
        ) - mins * 60 * 1000;
        const check = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        }).format(new Date(ts)).replace(', ', 'T');
        if (check.startsWith(desiredLocal)) {
            best = ts;
            break;
        }
    }
    if (!best) return 24 * 60 * 60 * 1000;
    return Math.max(1000, best - nowUtc);
}

function startDailyRestartScheduler() {
    if (!DAILY_RESTART_TIME || !/^\d{2}:\d{2}$/.test(DAILY_RESTART_TIME)) {
        logger.info('Scheduler: DAILY_RESTART_TIME não configurado, restart diário desativado');
        return;
    }

    const scheduleNext = () => {
        const delay = getDelayUntilNextDaily(DAILY_RESTART_TIME, DAILY_RESTART_TZ);
        logger.info(`Scheduler: próximo restart diário em ${Math.round(delay / 1000)}s (${DAILY_RESTART_TIME} ${DAILY_RESTART_TZ})`);
        setTimeout(async () => {
            try {
                await maybeRunControlledRestart('daily-scheduled');
            } catch (err) {
                logger.error('Scheduler: falha no restart diário', err?.message || err);
                notifier.notify(`Falha no restart diário do WhatsApp: ${err?.message || err}`, 'warn');
            } finally {
                scheduleNext();
            }
        }, delay);
    };
    scheduleNext();
}

function startHealthcheckMonitor() {
    setInterval(async () => {
        try {
            const status = whatsappClient.getStatus();
            const runtime = whatsappClient.getRuntimeStatus?.() || {};
            const now = Date.now();
            const staleMs = now - (runtime.lastActivityAt || 0);
            const coolingDown = (now - lastHealthRestartAt) < HEALTHCHECK_RESTART_COOLDOWN_MS;
            const busy = runtime.isRestarting || runtime.isReconnecting;

            // Já ligado mas processo “zombie” (sem eventos há muito tempo)
            const unhealthyConnected =
                status.ready && staleMs > HEALTHCHECK_STALE_MS && !busy;

            // Nunca chegou a ready (UI em “sincronizando”) e sem QR — típico após reboot/lock do Chrome
            const waitingForQr = Boolean(status.qr);
            const authAgeMs = runtime.authenticatedAt ? now - runtime.authenticatedAt : 0;
            const stuckAfterAuth =
                !status.ready &&
                !waitingForQr &&
                authAgeMs > HEALTHCHECK_STUCK_AFTER_AUTH_MS &&
                !busy;
            const stuckConnecting =
                !status.ready &&
                !waitingForQr &&
                staleMs > HEALTHCHECK_STUCK_CONNECTING_MS &&
                !busy;

            const needsRestart = unhealthyConnected || stuckConnecting || stuckAfterAuth;

            if (!needsRestart || coolingDown) return;

            healthcheckFailures += 1;
            const reason = stuckAfterAuth
                ? 'healthcheck-stuck-after-auth'
                : stuckConnecting
                    ? 'healthcheck-stuck-connecting'
                    : 'healthcheck-stale';

            if (stuckAfterAuth) {
                logger.warn(
                    `Healthcheck: autenticado há ${Math.round(authAgeMs / 1000)}s sem ready (limite ${Math.round(HEALTHCHECK_STUCK_AFTER_AUTH_MS / 1000)}s). Tentativa ${healthcheckFailures}.`
                );
                notifier.notifyOnce(
                    'healthcheck-stuck-after-auth',
                    `Healthcheck: autenticado mas sem conexão há ${Math.round(authAgeMs / 1000)}s. Reinicialização automática.`,
                    'warn',
                    12 * 60 * 1000
                );
            } else if (stuckConnecting) {
                const limiteS = Math.round(HEALTHCHECK_STUCK_CONNECTING_MS / 1000);
                logger.warn(
                    `Healthcheck: cliente sem ready há ${Math.round(staleMs / 1000)}s (limite ${limiteS}s, CONNECTING sem QR). Tentativa ${healthcheckFailures}.`
                );
                notifier.notifyOnce(
                    'healthcheck-stuck-connecting',
                    `Healthcheck: sem ready há ${Math.round(staleMs / 1000)}s (limite ${limiteS}s). Reinicialização controlada automática.`,
                    'warn',
                    12 * 60 * 1000
                );
            } else {
                const limiteStaleS = Math.round(HEALTHCHECK_STALE_MS / 1000);
                logger.warn(
                    `Healthcheck: possível travamento com sessão pronta (sem atividade há ${Math.round(staleMs / 1000)}s, limite ${limiteStaleS}s, tentativa ${healthcheckFailures})`
                );
                notifier.notifyOnce(
                    'healthcheck-stale-activity',
                    `Healthcheck: sem atividade há ${Math.round(staleMs / 1000)}s (limite ${limiteStaleS}s). Reinicialização controlada.`,
                    'warn',
                    12 * 60 * 1000
                );
            }

            await maybeRunControlledRestart(reason);
            lastHealthRestartAt = Date.now();
            healthcheckFailures = 0;
        } catch (err) {
            logger.error('Healthcheck: erro ao avaliar/reiniciar', err?.message || err);
        }
    }, HEALTHCHECK_INTERVAL_MS);
}

app.listen(PORT, () => {
    const reset = chatDB.resetStaleSendingSchedules();
    if (reset > 0) logger.info(`Servidor: ${reset} agendamento(s) em 'sending' resetado(s) para pending (reinício após crash)`);
    logger.info(`Servidor Backend ✅ Rodando na porta ${PORT}`);
    logger.info(`WhatsApp Inicializando cliente...`);
    // Quando o WhatsApp ficar pronto (ou reconectar), processa agendamentos vencidos na hora
    whatsappClient.setOnReadyCallback(() => runScheduleWorker().catch((err) => logger.error('Worker agendamentos (onReady)', err?.message || err)));
    // Executa o worker de agendamentos imediatamente e depois a cada 60s (evita esperar 1 min se o usuário agendou "para agora")
    runScheduleWorker().catch((err) => logger.error('Worker agendamentos (inicial)', err?.message || err));
    setInterval(() => runScheduleWorker().catch((err) => logger.error('Worker agendamentos', err?.message || err)), SCHEDULE_WORKER_INTERVAL_MS);
    startDailyRestartScheduler();
    startHealthcheckMonitor();
    notifier.validateDiscordWebhook?.().catch(() => {});
});
