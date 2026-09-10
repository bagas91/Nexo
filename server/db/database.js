import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, '../chats.db'));

function parseAuditRow(row) {
    if (!row) return null;
    return {
        ...row,
        meta: row.metaJson ? JSON.parse(row.metaJson) : null,
    };
}

// Criar tabela de chats
db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        members INTEGER DEFAULT 0,
        lastUpdated INTEGER NOT NULL
    )
`);

// Criar tabela de histórico
db.exec(`
    CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chatId TEXT NOT NULL,
        chatName TEXT NOT NULL,
        content TEXT,
        attachments TEXT, -- JSON string de nomes de arquivos
        timestamp INTEGER NOT NULL,
        status TEXT NOT NULL
    )
`);

// Categorias de grupos (nome + lista de groupIds)
db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        groupIds TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
    )
`);

// Log de disparos (prova de quais grupos foram selecionados em cada envio)
db.exec(`
    CREATE TABLE IF NOT EXISTS dispatches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contentPreview TEXT NOT NULL,
        targetsJson TEXT NOT NULL,
        categoryNames TEXT,
        scheduledAt INTEGER,
        createdAt INTEGER NOT NULL
    )
`);

// Agendamentos (persistentes; executados pelo worker no backend)
db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        targetsJson TEXT NOT NULL,
        scheduledAt INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        repeatDaily INTEGER NOT NULL DEFAULT 0,
        attachmentsMeta TEXT,
        errorMessage TEXT,
        retryCount INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL
    )
`);
try {
    db.exec('ALTER TABLE schedules ADD COLUMN retryCount INTEGER NOT NULL DEFAULT 0');
} catch (e) {
    if (!e.message || !e.message.includes('duplicate column')) throw e;
}
try {
    db.exec("ALTER TABLE schedules ADD COLUMN mediaLayout TEXT NOT NULL DEFAULT 'caption_on_image'");
} catch (e) {
    if (!e.message || !e.message.includes('duplicate column')) throw e;
}
try {
    db.exec('ALTER TABLE schedules ADD COLUMN progressJson TEXT');
} catch (e) {
    if (!e.message || !e.message.includes('duplicate column')) throw e;
}

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'creator',
        active INTEGER NOT NULL DEFAULT 1,
        createdAt INTEGER NOT NULL
    )
`);

try {
    db.exec(`ALTER TABLE users ADD COLUMN modules TEXT`);
} catch {
    /* coluna já existe */
}

try {
    db.exec(`ALTER TABLE users ADD COLUMN tokenVersion INTEGER NOT NULL DEFAULT 0`);
} catch {
    /* coluna já existe */
}

try {
    db.exec(`ALTER TABLE users ADD COLUMN lastLoginAt INTEGER`);
} catch {
    /* coluna já existe */
}

try {
    db.exec(`ALTER TABLE users ADD COLUMN phone TEXT`);
} catch {
    /* coluna já existe */
}

db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        actorId TEXT,
        actorEmail TEXT,
        actorName TEXT,
        action TEXT NOT NULL,
        targetType TEXT,
        targetId TEXT,
        summary TEXT NOT NULL,
        metaJson TEXT,
        ip TEXT
    )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)`);

db.exec(`
    CREATE TABLE IF NOT EXISTS content_items (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        userName TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT,
        body TEXT,
        imageFilename TEXT,
        brief TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        metadata TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
    )
`);

// --- Plataforma (integrações, automações, atendimento) ---
db.exec(`
    CREATE TABLE IF NOT EXISTS platform_kv (
        key TEXT PRIMARY KEY,
        valueJson TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS platform_entities (
        entityType TEXT NOT NULL,
        id TEXT NOT NULL,
        dataJson TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (entityType, id)
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS integration_events (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        eventType TEXT NOT NULL,
        summary TEXT NOT NULL,
        customer TEXT,
        phone TEXT,
        status TEXT NOT NULL,
        whatsappPreview TEXT,
        payloadJson TEXT,
        ts INTEGER NOT NULL
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_products (
        channel TEXT NOT NULL,
        externalId TEXT NOT NULL,
        sku TEXT,
        name TEXT,
        price REAL,
        salePrice REAL,
        weight REAL,
        height REAL,
        width REAL,
        length REAL,
        ncm TEXT,
        category TEXT,
        brand TEXT,
        description TEXT,
        shortDescription TEXT,
        slug TEXT,
        seoTitle TEXT,
        seoDescription TEXT,
        imageCount INTEGER DEFAULT 0,
        stockQty REAL,
        status TEXT,
        gtin TEXT,
        parentId TEXT,
        reviewStatus TEXT NOT NULL DEFAULT 'not_started',
        rawJson TEXT,
        syncedAt INTEGER NOT NULL,
        PRIMARY KEY (channel, externalId)
    )
`);

try {
    db.exec(`ALTER TABLE catalog_products ADD COLUMN formato TEXT`);
} catch {
    /* coluna já existe */
}
try {
    db.exec(`ALTER TABLE catalog_products ADD COLUMN focusKeyword TEXT`);
} catch {
    /* coluna já existe */
}

db.exec(`CREATE INDEX IF NOT EXISTS idx_catalog_sku ON catalog_products(sku)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_catalog_channel ON catalog_products(channel)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_catalog_review ON catalog_products(reviewStatus)`);

db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_issues (
        id TEXT PRIMARY KEY,
        ruleId TEXT NOT NULL,
        priority TEXT NOT NULL,
        channel TEXT,
        externalId TEXT,
        sku TEXT,
        name TEXT,
        message TEXT NOT NULL,
        metaJson TEXT,
        createdAt INTEGER NOT NULL,
        scanId TEXT
    )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_catalog_issues_rule ON catalog_issues(ruleId)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_catalog_issues_scan ON catalog_issues(scanId)`);

db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_edit_locks (
        channel TEXT NOT NULL,
        externalId TEXT NOT NULL,
        userId TEXT NOT NULL,
        userName TEXT NOT NULL,
        lockedAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        PRIMARY KEY (channel, externalId)
    )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_catalog_locks_expires ON catalog_edit_locks(expiresAt)`);

db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_physical_checks (
        id TEXT PRIMARY KEY,
        externalId TEXT NOT NULL,
        sku TEXT,
        name TEXT,
        needJson TEXT NOT NULL,
        requestNote TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        requestedById TEXT,
        requestedByName TEXT,
        requestedAt INTEGER NOT NULL,
        responseNote TEXT,
        responseWeight REAL,
        responseHeight REAL,
        responseWidth REAL,
        responseLength REAL,
        photoFilename TEXT,
        answeredById TEXT,
        answeredByName TEXT,
        answeredAt INTEGER,
        appliedAt INTEGER,
        appliedById TEXT,
        appliedByName TEXT
    )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_catalog_checks_status ON catalog_physical_checks(status)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_catalog_checks_ext ON catalog_physical_checks(externalId)`);
for (const col of [
    "ALTER TABLE catalog_physical_checks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'",
    'ALTER TABLE catalog_physical_checks ADD COLUMN dueAt INTEGER',
    'ALTER TABLE catalog_physical_checks ADD COLUMN returnReason TEXT',
    'ALTER TABLE catalog_physical_checks ADD COLUMN returnedAt INTEGER',
    'ALTER TABLE catalog_physical_checks ADD COLUMN returnedById TEXT',
    'ALTER TABLE catalog_physical_checks ADD COLUMN returnedByName TEXT',
]) {
    try {
        db.exec(col);
    } catch (e) {
        if (!e.message?.includes('duplicate column')) throw e;
    }
}
try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_catalog_checks_due ON catalog_physical_checks(status, dueAt)');
} catch (e) {
    if (!e.message?.includes('already exists')) throw e;
}

db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_physical_check_comments (
        id TEXT PRIMARY KEY,
        checkId TEXT NOT NULL,
        body TEXT NOT NULL,
        actorId TEXT,
        actorName TEXT,
        createdAt INTEGER NOT NULL
    )
`);
try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_catalog_check_comments ON catalog_physical_check_comments(checkId, createdAt)');
} catch (e) {
    if (!e.message?.includes('already exists')) throw e;
}

db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_scans (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        phase TEXT,
        message TEXT,
        blingCount INTEGER DEFAULT 0,
        wooCount INTEGER DEFAULT 0,
        issueCount INTEGER DEFAULT 0,
        okCount INTEGER DEFAULT 0,
        startedAt INTEGER NOT NULL,
        finishedAt INTEGER,
        durationMs INTEGER,
        error TEXT,
        summaryJson TEXT
    )
`);

/** Rascunhos de correção via IA — só vão ao Bling após OK do usuário. */
db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_ai_drafts (
        id TEXT PRIMARY KEY,
        externalId TEXT NOT NULL,
        sku TEXT,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        fieldsJson TEXT,
        suggestedJson TEXT NOT NULL,
        editedJson TEXT,
        provider TEXT,
        rationale TEXT,
        error TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        appliedAt INTEGER
    )
`);
try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_catalog_ai_drafts_status ON catalog_ai_drafts(status, updatedAt DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_catalog_ai_drafts_ext ON catalog_ai_drafts(externalId, status)');
} catch (e) {
    if (!e.message?.includes('already exists')) throw e;
}

db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_messages (
        id TEXT PRIMARY KEY,
        chatId TEXT NOT NULL,
        phone TEXT NOT NULL,
        contactName TEXT,
        body TEXT NOT NULL,
        fromMe INTEGER NOT NULL DEFAULT 0,
        ts INTEGER NOT NULL,
        seen INTEGER NOT NULL DEFAULT 0
    )
`);
try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_inbox_chat_ts ON inbox_messages(chatId, ts DESC)');
} catch (e) {
    if (!e.message?.includes('already exists')) throw e;
}

db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_conversations (
        chatId TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        contactName TEXT,
        lastMessage TEXT NOT NULL,
        lastTs INTEGER NOT NULL,
        unread INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        mode TEXT NOT NULL DEFAULT 'bot'
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS followup_runs (
        id TEXT PRIMARY KEY,
        followupId TEXT NOT NULL,
        followupName TEXT NOT NULL,
        chatId TEXT NOT NULL,
        phone TEXT NOT NULL,
        contactName TEXT,
        stepIndex INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        nextRunAt INTEGER,
        contextJson TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
    )
`);
try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_followup_runs_due ON followup_runs(status, nextRunAt)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_followup_runs_chat ON followup_runs(chatId, status)');
} catch (e) {
    if (!e.message?.includes('already exists')) throw e;
}
try {
    db.exec("ALTER TABLE inbox_conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'bot'");
} catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
}
try {
    db.exec('ALTER TABLE inbox_conversations ADD COLUMN humanAlertAt INTEGER');
} catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
}
try {
    db.exec('ALTER TABLE inbox_conversations ADD COLUMN notes TEXT');
} catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
}
for (const col of [
    'ALTER TABLE inbox_conversations ADD COLUMN avatarFile TEXT',
    'ALTER TABLE inbox_conversations ADD COLUMN avatarUpdatedAt INTEGER',
    'ALTER TABLE inbox_messages ADD COLUMN mediaType TEXT',
    'ALTER TABLE inbox_messages ADD COLUMN mediaFile TEXT',
    'ALTER TABLE inbox_messages ADD COLUMN mimetype TEXT',
]) {
    try {
        db.exec(col);
    } catch (e) {
        if (!e.message?.includes('duplicate column')) throw e;
    }
}

class ChatDatabase {
    saveChat(chat) {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO chats (id, name, type, members, lastUpdated)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(chat.id, chat.name, chat.type, chat.members, Date.now());
    }

    saveChats(chats) {
        const insert = db.prepare(`
            INSERT OR REPLACE INTO chats (id, name, type, members, lastUpdated)
            VALUES (?, ?, ?, ?, ?)
        `);

        const insertMany = db.transaction((chats) => {
            for (const chat of chats) {
                insert.run(chat.id, chat.name, chat.type, chat.members, Date.now());
            }
        });

        insertMany(chats);
    }

    getAllChats() {
        const stmt = db.prepare('SELECT * FROM chats ORDER BY name');
        return stmt.all();
    }

    getChatsPaginated(offset = 0, limit = 10) {
        const stmt = db.prepare('SELECT * FROM chats ORDER BY name LIMIT ? OFFSET ?');
        return stmt.all(limit, offset);
    }

    getChatsCount() {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM chats');
        return stmt.get().count;
    }

    clearChats() {
        db.prepare('DELETE FROM chats').run();
    }

    clearAllDispatches() {
        db.prepare('DELETE FROM dispatches').run();
    }

    clearAllCategories() {
        db.prepare('DELETE FROM categories').run();
    }

    /** Limpa dados operacionais (grupos, histórico, categorias, disparos, agendamentos). */
    clearAllOperationalData() {
        const { ids } = this.deleteAllSchedules();
        this.clearChats();
        this.clearHistory();
        this.clearAllDispatches();
        this.clearAllCategories();
        return { scheduleIds: ids };
    }

    saveHistoryEntry(entry) {
        const stmt = db.prepare(`
            INSERT INTO history (chatId, chatName, content, attachments, timestamp, status)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            entry.chatId,
            entry.chatName,
            entry.content || '',
            JSON.stringify(entry.attachments || []),
            Date.now(),
            entry.status || 'sent'
        );
    }

    getHistory(limit = 50) {
        const stmt = db.prepare('SELECT * FROM history ORDER BY timestamp DESC LIMIT ?');
        return stmt.all(limit).map(row => ({
            ...row,
            attachments: JSON.parse(row.attachments)
        }));
    }

    clearHistory() {
        db.prepare('DELETE FROM history').run();
    }

    getHistoryCountToday() {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;
        const row = db.prepare('SELECT COUNT(*) as c FROM history WHERE timestamp >= ? AND timestamp <= ?').get(startOfDay, endOfDay);
        return row?.c ?? 0;
    }

    // --- Categorias ---
    getAllCategories() {
        const stmt = db.prepare('SELECT * FROM categories ORDER BY name');
        return stmt.all().map(row => ({
            id: row.id,
            name: row.name,
            groupIds: JSON.parse(row.groupIds || '[]'),
            updatedAt: row.updatedAt
        }));
    }

    getCategory(id) {
        const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
        if (!row) return null;
        return { id: row.id, name: row.name, groupIds: JSON.parse(row.groupIds || '[]'), updatedAt: row.updatedAt };
    }

    saveCategory({ id, name, groupIds }) {
        const now = Date.now();
        db.prepare(`
            INSERT OR REPLACE INTO categories (id, name, groupIds, updatedAt)
            VALUES (?, ?, ?, ?)
        `).run(id, name, JSON.stringify(groupIds || []), now);
    }

    deleteCategory(id) {
        db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    }

    // --- Log de disparos ---
    saveDispatch({ contentPreview, targets, categoryNames, scheduledAt }) {
        const now = Date.now();
        db.prepare(`
            INSERT INTO dispatches (contentPreview, targetsJson, categoryNames, scheduledAt, createdAt)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            contentPreview || '',
            JSON.stringify(targets || []),
            categoryNames ? JSON.stringify(categoryNames) : null,
            scheduledAt ? new Date(scheduledAt).getTime() : null,
            now
        );
    }

    getDispatches(limit = 100) {
        const stmt = db.prepare('SELECT * FROM dispatches ORDER BY createdAt DESC LIMIT ?');
        return stmt.all(limit).map(row => ({
            id: row.id,
            contentPreview: row.contentPreview,
            targets: JSON.parse(row.targetsJson || '[]'),
            categoryNames: row.categoryNames ? JSON.parse(row.categoryNames) : [],
            scheduledAt: row.scheduledAt,
            createdAt: row.createdAt
        }));
    }

    // --- Agendamentos ---
    saveSchedule({ id, content, targets, scheduledAt, status = 'pending', repeatDaily = false, attachmentsMeta = null, retryCount = 0, mediaLayout = 'caption_on_image' }) {
        const now = Date.now();
        db.prepare(`
            INSERT OR REPLACE INTO schedules (id, content, targetsJson, scheduledAt, status, repeatDaily, attachmentsMeta, retryCount, mediaLayout, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            content || '',
            JSON.stringify(targets || []),
            new Date(scheduledAt).getTime(),
            status,
            repeatDaily ? 1 : 0,
            attachmentsMeta ? JSON.stringify(attachmentsMeta) : null,
            retryCount ?? 0,
            mediaLayout || 'caption_on_image',
            now
        );
    }

    getAllSchedules(limit = 200) {
        const stmt = db.prepare('SELECT * FROM schedules ORDER BY scheduledAt DESC, createdAt DESC LIMIT ?');
        return stmt.all(limit).map(row => ({
            id: row.id,
            content: row.content,
            targets: JSON.parse(row.targetsJson || '[]'),
            scheduledAt: new Date(row.scheduledAt).toISOString(),
            status: row.status,
            repeatDaily: !!row.repeatDaily,
            attachmentsMeta: row.attachmentsMeta ? JSON.parse(row.attachmentsMeta) : null,
            mediaLayout: row.mediaLayout || 'caption_on_image',
            errorMessage: row.errorMessage,
            retryCount: row.retryCount ?? 0,
            progress: row.progressJson ? (() => { try { return JSON.parse(row.progressJson); } catch { return null; } })() : null,
            createdAt: row.createdAt
        }));
    }

    getPendingSchedulesDue(nowMs = Date.now()) {
        const stmt = db.prepare('SELECT * FROM schedules WHERE status = ? AND scheduledAt <= ? ORDER BY scheduledAt ASC');
        return stmt.all('pending', nowMs).map(row => ({
            id: row.id,
            content: row.content,
            targets: JSON.parse(row.targetsJson || '[]'),
            scheduledAt: row.scheduledAt,
            status: row.status,
            repeatDaily: !!row.repeatDaily,
            attachmentsMeta: row.attachmentsMeta ? JSON.parse(row.attachmentsMeta) : null,
            mediaLayout: row.mediaLayout || 'caption_on_image',
            retryCount: row.retryCount ?? 0,
            progress: row.progressJson ? (() => { try { return JSON.parse(row.progressJson); } catch { return null; } })() : null,
            createdAt: row.createdAt
        }));
    }

    updateScheduleStatus(id, status, errorMessage = null) {
        db.prepare('UPDATE schedules SET status = ?, errorMessage = ? WHERE id = ?').run(status, errorMessage, id);
    }

    /**
     * Checkpoint de disparo: quais destinos já foram enviados.
     * @param {string} id
     * @param {{ sentIds?: string[], nextIndex?: number, updatedAt?: number }|null} progress
     */
    updateScheduleProgress(id, progress) {
        if (!progress) {
            db.prepare('UPDATE schedules SET progressJson = NULL WHERE id = ?').run(id);
            return;
        }
        const payload = {
            sentIds: Array.isArray(progress.sentIds) ? progress.sentIds : [],
            nextIndex: Number(progress.nextIndex) || 0,
            updatedAt: progress.updatedAt || Date.now(),
        };
        db.prepare('UPDATE schedules SET progressJson = ? WHERE id = ?').run(JSON.stringify(payload), id);
    }

    clearScheduleProgress(id) {
        db.prepare('UPDATE schedules SET progressJson = NULL WHERE id = ?').run(id);
    }

    incrementScheduleRetryCount(id) {
        db.prepare('UPDATE schedules SET retryCount = retryCount + 1, status = ?, errorMessage = ? WHERE id = ?').run('pending', null, id);
    }

    /** Após crash: sending → pending, mantém progressJson para retomar do grupo N. */
    resetStaleSendingSchedules() {
        const r = db.prepare("UPDATE schedules SET status = 'pending' WHERE status = 'sending'").run();
        return r.changes;
    }

    /** Reativa todos os agendamentos pausados → pending. */
    unpauseAllSchedules() {
        const r = db.prepare("UPDATE schedules SET status = 'pending', errorMessage = NULL WHERE status = 'paused'").run();
        return r.changes;
    }

    deleteSchedule(id) {
        db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    }

    /** Remove todas as linhas de agendamentos (qualquer status). Retorna ids para limpeza de anexos. */
    deleteAllSchedules() {
        const ids = db.prepare('SELECT id FROM schedules').all().map((r) => r.id);
        const r = db.prepare('DELETE FROM schedules').run();
        return { deleted: r.changes, ids };
    }

    getSchedulesPendingCount() {
        const row = db.prepare('SELECT COUNT(*) as c FROM schedules WHERE status = ?').get('pending');
        return row?.c ?? 0;
    }

    /** Chats que aparecem sem nome (inválidos/suspeitos para remover). */
    getChatsWithNoName() {
        const stmt = db.prepare("SELECT id, name, type FROM chats WHERE TRIM(COALESCE(name, '')) = '' OR LOWER(TRIM(name)) = 'desconhecido' ORDER BY id");
        return stmt.all();
    }

    /** Onde um groupId está sendo usado: categorias e agendamentos. */
    getGroupUsages(chatId) {
        if (!chatId || typeof chatId !== 'string') return { categories: [], schedules: [] };
        const categories = [];
        for (const row of db.prepare('SELECT id, name, groupIds FROM categories').all()) {
            const ids = JSON.parse(row.groupIds || '[]');
            if (ids.includes(chatId)) categories.push({ id: row.id, name: row.name });
        }
        const schedules = [];
        for (const row of db.prepare('SELECT id, targetsJson, scheduledAt, status FROM schedules').all()) {
            const targets = JSON.parse(row.targetsJson || '[]');
            const hasId = targets.some((t) => (typeof t === 'string' ? t === chatId : t && t.id === chatId));
            if (hasId) schedules.push({ id: row.id, scheduledAt: row.scheduledAt, status: row.status });
        }
        return { categories, schedules };
    }

    /** Remove um grupo de todas as categorias e dos agendamentos (pending/paused). Retorna contagens e ids de agendamentos excluídos. */
    removeGroupFromAllUsages(chatId) {
        if (!chatId || typeof chatId !== 'string') return { categoriesUpdated: 0, schedulesUpdated: 0, schedulesDeleted: 0, deletedScheduleIds: [] };
        let categoriesUpdated = 0;
        for (const row of db.prepare('SELECT id, name, groupIds FROM categories').all()) {
            const groupIds = JSON.parse(row.groupIds || '[]');
            if (!groupIds.includes(chatId)) continue;
            const next = groupIds.filter((id) => id !== chatId);
            db.prepare('UPDATE categories SET groupIds = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(next), Date.now(), row.id);
            categoriesUpdated++;
        }
        let schedulesUpdated = 0;
        const deletedScheduleIds = [];
        for (const row of db.prepare("SELECT id, targetsJson, status FROM schedules WHERE status IN ('pending', 'paused')").all()) {
            const targets = JSON.parse(row.targetsJson || '[]');
            const next = targets.filter((t) => (typeof t === 'string' ? t !== chatId : t && t.id !== chatId));
            if (next.length === targets.length) continue;
            if (next.length === 0) {
                db.prepare('DELETE FROM schedules WHERE id = ?').run(row.id);
                deletedScheduleIds.push(row.id);
            } else {
                db.prepare('UPDATE schedules SET targetsJson = ? WHERE id = ?').run(JSON.stringify(next), row.id);
                schedulesUpdated++;
            }
        }
        return { categoriesUpdated, schedulesUpdated, schedulesDeleted: deletedScheduleIds.length, deletedScheduleIds };
    }

    // --- Usuários ---
    createUser({ id, email, passwordHash, name, role = 'creator', active = 1, modules = null, tokenVersion = 0, phone = null }) {
        const now = Date.now();
        const modulesJson = modules == null
            ? null
            : (typeof modules === 'string' ? modules : JSON.stringify(modules));
        const phoneDigits = phone ? String(phone).replace(/\D/g, '') : null;
        db.prepare(`
            INSERT INTO users (id, email, passwordHash, name, role, active, createdAt, modules, tokenVersion, phone)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, email, passwordHash, name, role, active ? 1 : 0, now, modulesJson, tokenVersion || 0, phoneDigits || null);
    }

    getUserById(id) {
        return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
    }

    getUserByEmail(email) {
        return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase()) || null;
    }

    getAllUsers() {
        return db.prepare('SELECT * FROM users ORDER BY name').all();
    }

    updateUser(id, patch) {
        const fields = [];
        const values = [];
        if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
        if (patch.email !== undefined) { fields.push('email = ?'); values.push(patch.email); }
        if (patch.passwordHash !== undefined) { fields.push('passwordHash = ?'); values.push(patch.passwordHash); }
        if (patch.role !== undefined) { fields.push('role = ?'); values.push(patch.role); }
        if (patch.active !== undefined) { fields.push('active = ?'); values.push(patch.active ? 1 : 0); }
        if (patch.modules !== undefined) {
            fields.push('modules = ?');
            values.push(
                patch.modules == null
                    ? null
                    : (typeof patch.modules === 'string' ? patch.modules : JSON.stringify(patch.modules)),
            );
        }
        if (patch.tokenVersion !== undefined) {
            fields.push('tokenVersion = ?');
            values.push(Number(patch.tokenVersion) || 0);
        }
        if (patch.lastLoginAt !== undefined) {
            fields.push('lastLoginAt = ?');
            values.push(patch.lastLoginAt);
        }
        if (patch.phone !== undefined) {
            fields.push('phone = ?');
            const digits = patch.phone == null || patch.phone === ''
                ? null
                : String(patch.phone).replace(/\D/g, '');
            values.push(digits || null);
        }
        if (!fields.length) return;
        values.push(id);
        db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    /** Usuários ativos com módulo catalog e telefone (notificação Goiânia). */
    listCatalogNotifyPhones() {
        const rows = this.getAllUsers().filter((u) => {
            if (!u.active) return false;
            if (u.role === 'superadmin') return false;
            const phone = String(u.phone || '').replace(/\D/g, '');
            if (!phone || phone.length < 10) return false;
            let mods = [];
            try {
                mods = u.modules ? JSON.parse(u.modules) : [];
            } catch {
                mods = [];
            }
            return Array.isArray(mods) && (mods.includes('catalog') || mods.includes('*'));
        });
        return rows.map((u) => ({
            id: u.id,
            name: u.name,
            phone: String(u.phone).replace(/\D/g, ''),
        }));
    }

    bumpUserTokenVersion(id) {
        db.prepare(`UPDATE users SET tokenVersion = COALESCE(tokenVersion, 0) + 1 WHERE id = ?`).run(id);
        return this.getUserById(id);
    }

    deleteUser(id) {
        return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
    }

    // --- Auditoria admin ---
    insertAuditLog(entry) {
        const id = entry.id || crypto.randomUUID();
        db.prepare(`
            INSERT INTO audit_logs (id, ts, actorId, actorEmail, actorName, action, targetType, targetId, summary, metaJson, ip)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            entry.ts || Date.now(),
            entry.actorId || null,
            entry.actorEmail || null,
            entry.actorName || null,
            entry.action,
            entry.targetType || null,
            entry.targetId || null,
            entry.summary || '',
            entry.meta ? JSON.stringify(entry.meta) : null,
            entry.ip || null,
        );
        return id;
    }

    listAuditLogs({ action, limit = 100, offset = 0 } = {}) {
        const lim = Math.min(Number(limit) || 100, 500);
        const off = Math.max(Number(offset) || 0, 0);
        if (action) {
            return db.prepare(`
                SELECT * FROM audit_logs WHERE action = ? ORDER BY ts DESC LIMIT ? OFFSET ?
            `).all(action, lim, off).map(parseAuditRow);
        }
        return db.prepare(`
            SELECT * FROM audit_logs ORDER BY ts DESC LIMIT ? OFFSET ?
        `).all(lim, off).map(parseAuditRow);
    }

    countAuditLogs(action) {
        if (action) {
            return db.prepare('SELECT COUNT(*) AS c FROM audit_logs WHERE action = ?').get(action)?.c || 0;
        }
        return db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get()?.c || 0;
    }

    // --- Biblioteca de conteúdo (Estúdio) ---
    createContentItem(item) {
        const now = Date.now();
        db.prepare(`
            INSERT INTO content_items (id, userId, userName, type, title, body, imageFilename, brief, status, metadata, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            item.id,
            item.userId,
            item.userName,
            item.type,
            item.title || null,
            item.body || null,
            item.imageFilename || null,
            item.brief || null,
            item.status || 'draft',
            item.metadata ? JSON.stringify(item.metadata) : null,
            now,
            now
        );
        return this.getContentItem(item.id);
    }

    getContentItem(id) {
        const row = db.prepare('SELECT * FROM content_items WHERE id = ?').get(id);
        return row ? this.mapContentRow(row) : null;
    }

    mapContentRow(row) {
        return {
            id: row.id,
            userId: row.userId,
            userName: row.userName,
            type: row.type,
            title: row.title,
            body: row.body,
            imageFilename: row.imageFilename,
            brief: row.brief,
            status: row.status,
            metadata: row.metadata ? JSON.parse(row.metadata) : null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt
        };
    }

    getContentItems({ userId, status, type, limit = 100 } = {}) {
        let sql = 'SELECT * FROM content_items WHERE 1=1';
        const params = [];
        if (userId) { sql += ' AND userId = ?'; params.push(userId); }
        if (status) { sql += ' AND status = ?'; params.push(status); }
        if (type) { sql += ' AND type = ?'; params.push(type); }
        sql += ' ORDER BY updatedAt DESC LIMIT ?';
        params.push(limit);
        return db.prepare(sql).all(...params).map((row) => this.mapContentRow(row));
    }

    updateContentItem(id, patch) {
        const fields = ['updatedAt = ?'];
        const values = [Date.now()];
        if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title); }
        if (patch.body !== undefined) { fields.push('body = ?'); values.push(patch.body); }
        if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
        if (patch.imageFilename !== undefined) { fields.push('imageFilename = ?'); values.push(patch.imageFilename); }
        if (patch.metadata !== undefined) { fields.push('metadata = ?'); values.push(JSON.stringify(patch.metadata)); }
        values.push(id);
        db.prepare(`UPDATE content_items SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getContentItem(id);
    }

    // --- Plataforma: key-value (woocommerce, bling, csat, integrations…) ---
    getPlatformKv(key) {
        const row = db.prepare('SELECT valueJson FROM platform_kv WHERE key = ?').get(key);
        if (!row) return null;
        try {
            return JSON.parse(row.valueJson);
        } catch {
            return null;
        }
    }

    setPlatformKv(key, value) {
        const now = Date.now();
        db.prepare(`
            INSERT INTO platform_kv (key, valueJson, updatedAt) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET valueJson = excluded.valueJson, updatedAt = excluded.updatedAt
        `).run(key, JSON.stringify(value), now);
        return value;
    }

    // --- Plataforma: entidades (followups, agents, flows, contacts…) ---
    listPlatformEntities(entityType, limit = 500) {
        return db.prepare(`
            SELECT id, dataJson, createdAt, updatedAt FROM platform_entities
            WHERE entityType = ? ORDER BY updatedAt DESC LIMIT ?
        `).all(entityType, limit).map((row) => ({
            ...JSON.parse(row.dataJson || '{}'),
            id: row.id,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        }));
    }

    getPlatformEntity(entityType, id) {
        const row = db.prepare('SELECT dataJson FROM platform_entities WHERE entityType = ? AND id = ?').get(entityType, id);
        if (!row) return null;
        try {
            return JSON.parse(row.dataJson);
        } catch {
            return null;
        }
    }

    savePlatformEntity(entityType, entity) {
        if (!entity?.id) throw new Error('Entidade precisa de id');
        const now = Date.now();
        const existing = db.prepare('SELECT createdAt FROM platform_entities WHERE entityType = ? AND id = ?').get(entityType, entity.id);
        const createdAt = existing?.createdAt || entity.createdAt || now;
        const { id, ...rest } = entity;
        const dataJson = JSON.stringify({ id, ...rest });
        db.prepare(`
            INSERT INTO platform_entities (entityType, id, dataJson, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(entityType, id) DO UPDATE SET dataJson = excluded.dataJson, updatedAt = excluded.updatedAt
        `).run(entityType, id, dataJson, createdAt, now);
        return this.getPlatformEntity(entityType, id);
    }

    deletePlatformEntity(entityType, id) {
        return db.prepare('DELETE FROM platform_entities WHERE entityType = ? AND id = ?').run(entityType, id).changes > 0;
    }

    addIntegrationEvent(event) {
        const id = event.id || `iev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        db.prepare(`
            INSERT INTO integration_events (id, source, eventType, summary, customer, phone, status, whatsappPreview, payloadJson, ts)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            event.source,
            event.eventType,
            event.summary,
            event.customer || '',
            event.phone || '',
            event.status || 'queued',
            event.whatsappPreview || '',
            event.payloadJson ? JSON.stringify(event.payloadJson) : null,
            event.ts || Date.now()
        );
        return this.getIntegrationEvent(id);
    }

    updateIntegrationEvent(id, patch) {
        const fields = [];
        const values = [];
        if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
        if (patch.whatsappPreview !== undefined) { fields.push('whatsappPreview = ?'); values.push(patch.whatsappPreview); }
        if (patch.phone !== undefined) { fields.push('phone = ?'); values.push(patch.phone); }
        if (patch.customer !== undefined) { fields.push('customer = ?'); values.push(patch.customer); }
        if (fields.length === 0) return this.getIntegrationEvent(id);
        values.push(id);
        db.prepare(`UPDATE integration_events SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.getIntegrationEvent(id);
    }

    getIntegrationEvent(id) {
        const row = db.prepare('SELECT * FROM integration_events WHERE id = ?').get(id);
        if (!row) return null;
        return {
            id: row.id,
            source: row.source,
            eventType: row.eventType,
            summary: row.summary,
            customer: row.customer,
            phone: row.phone,
            status: row.status,
            whatsappPreview: row.whatsappPreview,
            payload: row.payloadJson ? JSON.parse(row.payloadJson) : null,
            ts: row.ts,
        };
    }

    listIntegrationEvents({ source, limit = 100 } = {}) {
        let sql = 'SELECT * FROM integration_events';
        const params = [];
        if (source) {
            sql += ' WHERE source = ?';
            params.push(source);
        }
        sql += ' ORDER BY ts DESC LIMIT ?';
        params.push(limit);
        return db.prepare(sql).all(...params).map((row) => ({
            id: row.id,
            source: row.source,
            eventType: row.eventType,
            summary: row.summary,
            customer: row.customer,
            phone: row.phone,
            status: row.status,
            whatsappPreview: row.whatsappPreview,
            ts: row.ts,
        }));
    }

    saveInboxMessage(msg, { silent = false } = {}) {
        const seen = msg.fromMe || silent ? 1 : 0;
        // better-sqlite3: se o 1º arg de .run() for objeto, ele vira named-params e ignora o resto
        const id = typeof msg.id === 'string' ? msg.id : String(msg.id?._serialized || msg.id?.id || msg.id || '');
        if (!id) return false;
        const chatId = String(msg.chatId || '');
        const phone = String(msg.phone || '');
        const contactName = String(msg.contactName || '');
        const body = String(msg.body ?? '');
        const ts = Number(msg.ts) || Date.now();
        const mediaType = msg.mediaType ? String(msg.mediaType) : null;
        const mediaFile = msg.mediaFile ? String(msg.mediaFile) : null;
        const mimetype = msg.mimetype ? String(msg.mimetype) : null;

        const stmt = db.prepare(`
            INSERT INTO inbox_messages (id, chatId, phone, contactName, body, fromMe, ts, seen, mediaType, mediaFile, mimetype)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
        `);
        const result = stmt.run(
            id,
            chatId,
            phone,
            contactName,
            body,
            msg.fromMe ? 1 : 0,
            ts,
            seen,
            mediaType,
            mediaFile,
            mimetype
        );
        if (result.changes === 0) return false;

        const existing = db.prepare('SELECT unread FROM inbox_conversations WHERE chatId = ?').get(chatId);
        let unread = existing?.unread || 0;
        if (!msg.fromMe && !silent) unread += 1;
        db.prepare(`
            INSERT INTO inbox_conversations (chatId, phone, contactName, lastMessage, lastTs, unread, status)
            VALUES (?, ?, ?, ?, ?, ?, 'open')
            ON CONFLICT(chatId) DO UPDATE SET
                phone = CASE
                    WHEN length(excluded.phone) BETWEEN 10 AND 13 THEN excluded.phone
                    WHEN length(inbox_conversations.phone) BETWEEN 10 AND 13 THEN inbox_conversations.phone
                    ELSE excluded.phone
                END,
                contactName = CASE
                    WHEN ? = 1 THEN inbox_conversations.contactName
                    WHEN excluded.contactName != '' THEN excluded.contactName
                    ELSE inbox_conversations.contactName
                END,
                lastMessage = excluded.lastMessage,
                lastTs = excluded.lastTs,
                unread = excluded.unread,
                humanAlertAt = CASE WHEN ? = 1 THEN NULL ELSE inbox_conversations.humanAlertAt END,
                status = CASE
                    WHEN ? = 0 AND inbox_conversations.status = 'closed' THEN 'open'
                    ELSE inbox_conversations.status
                END
        `).run(chatId, phone, contactName, body, ts, unread, msg.fromMe ? 1 : 0, msg.fromMe ? 1 : 0, msg.fromMe ? 1 : 0);
        return true;
    }

    updateInboxConversationContactName(chatId, contactName) {
        const id = String(chatId || '');
        const name = String(contactName || '').trim();
        if (!id || !name) return false;
        const r = db.prepare('UPDATE inbox_conversations SET contactName = ? WHERE chatId = ?').run(name, id);
        return r.changes > 0;
    }

    /** Cruza telefone da conversa com contatos CRM (tags). */
    _tagsForInboxPhone(phone, contacts) {
        const digits = String(phone || '').replace(/\D/g, '');
        if (!digits || digits.length < 10) return [];
        const match = (contacts || []).find((c) => {
            const p = String(c.phone || '').replace(/\D/g, '');
            if (!p) return false;
            if (p === digits) return true;
            const a = digits.length >= 11 ? digits.slice(-11) : digits.slice(-10);
            const b = p.length >= 11 ? p.slice(-11) : p.slice(-10);
            return a.length >= 10 && a === b;
        });
        return Array.isArray(match?.tags) ? match.tags.filter(Boolean) : [];
    }

    listInboxConversations(limit = 100) {
        const contacts = this.listPlatformEntities('contacts');
        return db.prepare(`
            SELECT chatId, phone, contactName, lastMessage, lastTs AS updatedAt, unread, status, mode,
                avatarFile, humanAlertAt, notes,
                (SELECT fromMe FROM inbox_messages m WHERE m.chatId = inbox_conversations.chatId ORDER BY ts DESC LIMIT 1) AS lastFromMe
            FROM inbox_conversations
            ORDER BY lastTs DESC
            LIMIT ?
        `).all(limit).map((row) => {
            const conv = this.mapInboxConversation(row);
            if (conv) conv.tags = this._tagsForInboxPhone(conv.phone, contacts);
            return conv;
        });
    }

    mapInboxConversation(row) {
        if (!row) return null;
        const lastFromMe = row.lastFromMe == null ? null : !!Number(row.lastFromMe);
        const status = row.status || 'open';
        const unread = Number(row.unread) || 0;
        const humanAlertAt = row.humanAlertAt || null;
        const unanswered = status !== 'closed' && lastFromMe === false;
        const rawName = String(row.contactName || '').trim();
        const phoneDigits = String(row.phone || '').replace(/\D/g, '');
        let displayName = rawName;
        if (!displayName || (phoneDigits && displayName.replace(/\D/g, '') === phoneDigits)) {
            displayName = phoneDigits || rawName || 'Cliente';
        }
        return {
            id: row.chatId || row.id,
            contactName: displayName,
            phone: row.phone,
            lastMessage: row.lastMessage,
            unread,
            status,
            mode: row.mode || 'bot',
            updatedAt: row.updatedAt || row.lastTs,
            avatarUrl: row.avatarFile ? `/api/inbox/avatars/${encodeURIComponent(row.avatarFile)}` : null,
            humanAlertAt,
            notes: row.notes || '',
            lastFromMe,
            /** Alerta idle (+5 min) — prioridade vermelha */
            needsHuman: !!humanAlertAt,
            /** Cliente falou por último e chat não finalizado */
            unanswered,
            /** Atendente ainda não abriu (unread) */
            unseen: unread > 0 && status !== 'closed',
            /** Fila amigável para o CRM */
            queueLabel: status === 'closed'
                ? 'finalizado'
                : humanAlertAt
                    ? 'alerta'
                    : unread > 0
                        ? 'nao_visualizado'
                        : unanswered
                            ? 'nao_respondido'
                            : 'em_dia',
        };
    }

    listInboxChatIdsNeedingAvatar(maxAgeMs = 24 * 60 * 60 * 1000, limit = 60) {
        const cutoff = Date.now() - maxAgeMs;
        return db.prepare(`
            SELECT chatId, phone FROM inbox_conversations
            WHERE avatarFile IS NULL OR avatarUpdatedAt IS NULL OR avatarUpdatedAt < ?
            ORDER BY lastTs DESC
            LIMIT ?
        `).all(cutoff, limit).map((r) => ({ chatId: r.chatId, phone: r.phone }));
    }

    getInboxConversation(chatId) {
        const row = db.prepare(`
            SELECT *, lastTs AS updatedAt,
                (SELECT fromMe FROM inbox_messages m WHERE m.chatId = inbox_conversations.chatId ORDER BY ts DESC LIMIT 1) AS lastFromMe
            FROM inbox_conversations WHERE chatId = ?
        `).get(chatId);
        return this.mapInboxConversation(row);
    }

    updateInboxConversationPhone(chatId, phone) {
        const id = String(chatId || '');
        if (!id) return false;
        const digits = String(phone || '').replace(/\D/g, '');
        // vazio = limpa LID inválido da UI/CRM
        const r = db.prepare('UPDATE inbox_conversations SET phone = ? WHERE chatId = ?').run(digits, id);
        db.prepare('UPDATE inbox_messages SET phone = ? WHERE chatId = ?').run(digits, id);
        return r.changes > 0;
    }

    setInboxConversationMode(chatId, mode) {
        const allowed = new Set(['bot', 'human']);
        if (!allowed.has(mode)) throw new Error('mode deve ser bot ou human');
        db.prepare('UPDATE inbox_conversations SET mode = ? WHERE chatId = ?').run(mode, chatId);
        if (mode === 'bot') {
            db.prepare('UPDATE inbox_conversations SET humanAlertAt = NULL WHERE chatId = ?').run(chatId);
        } else {
            // Atendente assumiu — tira o alerta vermelho, mantém pending até finalizar
            db.prepare(`
                UPDATE inbox_conversations
                SET humanAlertAt = NULL, status = CASE WHEN status = 'closed' THEN 'open' ELSE status END
                WHERE chatId = ?
            `).run(chatId);
            const cur = db.prepare('SELECT status FROM inbox_conversations WHERE chatId = ?').get(chatId);
            if (cur && cur.status === 'open') {
                db.prepare("UPDATE inbox_conversations SET status = 'pending' WHERE chatId = ?").run(chatId);
            }
        }
        return this.getInboxConversation(chatId);
    }

    setInboxConversationStatus(chatId, status) {
        const allowed = new Set(['open', 'pending', 'closed']);
        if (!allowed.has(status)) throw new Error('status deve ser open, pending ou closed');
        if (status === 'closed') {
            db.prepare(`
                UPDATE inbox_conversations SET status = ?, humanAlertAt = NULL WHERE chatId = ?
            `).run(status, chatId);
        } else {
            db.prepare('UPDATE inbox_conversations SET status = ? WHERE chatId = ?').run(status, chatId);
        }
        return this.getInboxConversation(chatId);
    }

    setInboxConversationNotes(chatId, notes) {
        db.prepare('UPDATE inbox_conversations SET notes = ? WHERE chatId = ?').run(String(notes || ''), chatId);
        return this.getInboxConversation(chatId);
    }

    markInboxHumanAlert(chatId, at = Date.now()) {
        db.prepare('UPDATE inbox_conversations SET humanAlertAt = ?, mode = ?, status = ? WHERE chatId = ?')
            .run(at, 'human', 'pending', chatId);
        return this.getInboxConversation(chatId);
    }

    clearInboxHumanAlert(chatId) {
        db.prepare('UPDATE inbox_conversations SET humanAlertAt = NULL WHERE chatId = ?').run(chatId);
    }

    /**
     * Cliente falou por último e ninguém respondeu há idleMinutes.
     * Só mode=bot, sem alerta prévio, e só quem *acabou* de cruzar o limiar
     * (janela lookMinutes) — evita flood em conversas velhas no 1º ciclo.
     */
    listConversationsAwaitingReply(idleMinutes = 5, lookMinutes = 15) {
        const idleMs = Math.max(1, Number(idleMinutes) || 5) * 60 * 1000;
        const lookMs = Math.max(1, Number(lookMinutes) || 15) * 60 * 1000;
        const olderThan = Date.now() - idleMs;
        const newerThan = olderThan - lookMs;
        const rows = db.prepare(`
            SELECT c.chatId, c.phone, c.contactName, c.lastMessage, c.lastTs, c.mode, c.status, c.humanAlertAt,
                (SELECT fromMe FROM inbox_messages m WHERE m.chatId = c.chatId ORDER BY ts DESC LIMIT 1) AS lastFromMe
            FROM inbox_conversations c
            WHERE c.lastTs <= ?
              AND c.lastTs > ?
              AND IFNULL(c.mode, 'bot') = 'bot'
              AND c.humanAlertAt IS NULL
              AND IFNULL(c.status, 'open') != 'closed'
              AND c.chatId NOT LIKE '%@g.us'
            ORDER BY c.lastTs ASC
            LIMIT 30
        `).all(olderThan, newerThan);
        return rows.filter((r) => Number(r.lastFromMe) === 0).map((r) => ({
            chatId: r.chatId,
            phone: r.phone,
            contactName: r.contactName,
            lastMessage: r.lastMessage,
            lastTs: r.lastTs,
            waitMinutes: Math.round((Date.now() - r.lastTs) / 60000),
        }));
    }

    listInboxMessages(chatId, limit = 100, opts = {}) {
        const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
        const beforeTs = opts.beforeTs != null ? Number(opts.beforeTs) : null;
        let rows;
        if (beforeTs && Number.isFinite(beforeTs)) {
            rows = db.prepare(`
                SELECT id, chatId, phone, contactName, body, fromMe, ts, seen, mediaType, mediaFile, mimetype
                FROM inbox_messages
                WHERE chatId = ? AND ts < ?
                ORDER BY ts DESC
                LIMIT ?
            `).all(chatId, beforeTs, lim);
        } else {
            rows = db.prepare(`
                SELECT id, chatId, phone, contactName, body, fromMe, ts, seen, mediaType, mediaFile, mimetype
                FROM inbox_messages
                WHERE chatId = ?
                ORDER BY ts DESC
                LIMIT ?
            `).all(chatId, lim);
        }
        rows.reverse();
        const mapped = rows.map((row) => ({
            id: row.id,
            chatId: row.chatId,
            phone: row.phone,
            contactName: row.contactName,
            body: row.body,
            fromMe: !!row.fromMe,
            ts: row.ts,
            seen: !!row.seen,
            mediaType: row.mediaType || null,
            mimetype: row.mimetype || null,
            mediaUrl: row.mediaFile ? `/api/inbox/media/${encodeURIComponent(row.mediaFile)}` : null,
        }));
        const oldestTs = mapped.length ? mapped[0].ts : null;
        let hasMore = false;
        if (oldestTs != null) {
            const older = db.prepare(
                'SELECT 1 AS x FROM inbox_messages WHERE chatId = ? AND ts < ? LIMIT 1',
            ).get(chatId, oldestTs);
            hasMore = !!older;
        }
        return { messages: mapped, hasMore, oldestTs };
    }

    /** Últimas N mensagens do chat (ordem cronológica) — uso do agente de atendimento. */
    listInboxMessagesRecent(chatId, limit = 20) {
        const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const rows = db.prepare(`
            SELECT id, chatId, phone, contactName, body, fromMe, ts, seen, mediaType, mediaFile, mimetype
            FROM inbox_messages
            WHERE chatId = ?
            ORDER BY ts DESC
            LIMIT ?
        `).all(chatId, lim);
        rows.reverse();
        return rows.map((row) => ({
            id: row.id,
            chatId: row.chatId,
            phone: row.phone,
            contactName: row.contactName,
            body: row.body,
            fromMe: !!row.fromMe,
            ts: row.ts,
            seen: !!row.seen,
            mediaType: row.mediaType || null,
            mimetype: row.mimetype || null,
            mediaUrl: row.mediaFile ? `/api/inbox/media/${encodeURIComponent(row.mediaFile)}` : null,
        }));
    }

    updateInboxMessageMedia(id, { mediaType, mediaFile, mimetype }) {
        db.prepare(`
            UPDATE inbox_messages SET mediaType = ?, mediaFile = ?, mimetype = ? WHERE id = ?
        `).run(mediaType || null, mediaFile || null, mimetype || null, id);
    }

    /** Marca mediaType em mensagens antigas (rótulos [áudio]/[imagem]…) sem tipo. */
    backfillLegacyMediaTypes() {
        const map = {
            '[áudio]': 'audio',
            '[imagem]': 'image',
            '[vídeo]': 'video',
            '[documento]': 'document',
            '[mídia]': 'document',
        };
        const stmt = db.prepare('UPDATE inbox_messages SET mediaType = ? WHERE mediaType IS NULL AND body = ?');
        let total = 0;
        for (const [label, type] of Object.entries(map)) {
            total += stmt.run(type, label).changes;
        }
        return total;
    }

    /** Mensagens que têm tipo de mídia mas ainda não têm arquivo baixado. */
    listInboxMessagesNeedingMedia(limit = 60) {
        return db.prepare(`
            SELECT id, chatId, mediaType FROM inbox_messages
            WHERE mediaType IS NOT NULL AND mediaFile IS NULL
            ORDER BY ts DESC
            LIMIT ?
        `).all(limit);
    }

    setInboxConversationAvatar(chatId, avatarFile) {
        db.prepare(`
            UPDATE inbox_conversations SET avatarFile = ?, avatarUpdatedAt = ? WHERE chatId = ?
        `).run(avatarFile || null, Date.now(), String(chatId));
    }

    markInboxConversationRead(chatId) {
        db.prepare('UPDATE inbox_messages SET seen = 1 WHERE chatId = ? AND fromMe = 0').run(chatId);
        db.prepare('UPDATE inbox_conversations SET unread = 0 WHERE chatId = ?').run(chatId);
    }

    countInboundMessages(chatId) {
        const row = db.prepare('SELECT COUNT(*) as c FROM inbox_messages WHERE chatId = ? AND fromMe = 0').get(chatId);
        return row?.c ?? 0;
    }

    mapFollowUpRun(row) {
        if (!row) return null;
        let context = {};
        try {
            context = row.contextJson ? JSON.parse(row.contextJson) : {};
        } catch {
            context = {};
        }
        return {
            id: row.id,
            followupId: row.followupId,
            followupName: row.followupName,
            chatId: row.chatId,
            phone: row.phone,
            contactName: row.contactName || '',
            stepIndex: row.stepIndex,
            status: row.status,
            nextRunAt: row.nextRunAt,
            context,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    saveFollowUpRun(run) {
        const now = Date.now();
        const id = run.id || `fur_${now}_${Math.random().toString(36).slice(2, 8)}`;
        const createdAt = run.createdAt || now;
        const contextJson = JSON.stringify(run.context || {});
        db.prepare(`
            INSERT INTO followup_runs (
                id, followupId, followupName, chatId, phone, contactName,
                stepIndex, status, nextRunAt, contextJson, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                stepIndex = excluded.stepIndex,
                status = excluded.status,
                nextRunAt = excluded.nextRunAt,
                contextJson = excluded.contextJson,
                contactName = excluded.contactName,
                updatedAt = excluded.updatedAt
        `).run(
            id,
            run.followupId,
            run.followupName || '',
            run.chatId,
            run.phone,
            run.contactName || '',
            run.stepIndex ?? 0,
            run.status || 'active',
            run.nextRunAt ?? null,
            contextJson,
            createdAt,
            now
        );
        return this.getFollowUpRun(id);
    }

    getFollowUpRun(id) {
        const row = db.prepare('SELECT * FROM followup_runs WHERE id = ?').get(id);
        return this.mapFollowUpRun(row);
    }

    hasActiveFollowUpRun(followupId, chatId) {
        const row = db.prepare(`
            SELECT id FROM followup_runs
            WHERE followupId = ? AND chatId = ? AND status IN ('active', 'waiting')
            LIMIT 1
        `).get(followupId, chatId);
        return !!row;
    }

    hasAnyActiveFollowUpRun(chatId) {
        const row = db.prepare(`
            SELECT id FROM followup_runs
            WHERE chatId = ? AND status IN ('active', 'waiting')
            LIMIT 1
        `).get(chatId);
        return !!row;
    }

    listFollowUpRunsDue(now = Date.now()) {
        return db.prepare(`
            SELECT * FROM followup_runs
            WHERE status = 'waiting' AND nextRunAt IS NOT NULL AND nextRunAt <= ?
            ORDER BY nextRunAt ASC
            LIMIT 50
        `).all(now).map((row) => this.mapFollowUpRun(row));
    }

    listActiveFollowUpRuns(limit = 100) {
        return db.prepare(`
            SELECT * FROM followup_runs
            WHERE status IN ('active', 'waiting')
            ORDER BY updatedAt DESC
            LIMIT ?
        `).all(limit).map((row) => this.mapFollowUpRun(row));
    }

    cancelFollowUpRunsForChat(chatId, reason = 'cancelled') {
        const now = Date.now();
        const result = db.prepare(`
            UPDATE followup_runs
            SET status = ?, nextRunAt = NULL, updatedAt = ?
            WHERE chatId = ? AND status IN ('active', 'waiting')
        `).run(reason, now, chatId);
        return result.changes;
    }

    listConversationsIdleSince(idleMinutes) {
        const cutoff = Date.now() - Math.max(1, idleMinutes) * 60 * 1000;
        const rows = db.prepare(`
            SELECT c.chatId, c.phone, c.contactName, c.lastTs,
                (SELECT fromMe FROM inbox_messages m WHERE m.chatId = c.chatId ORDER BY ts DESC LIMIT 1) AS lastFromMe
            FROM inbox_conversations c
            WHERE c.lastTs <= ?
        `).all(cutoff);
        return rows.filter((r) => r.lastFromMe === 1);
    }

    // --- Catálogo / Qualidade ---
    upsertCatalogProduct(row) {
        const now = row.syncedAt || Date.now();
        db.prepare(`
            INSERT INTO catalog_products (
                channel, externalId, sku, name, price, salePrice, weight, height, width, length,
                ncm, category, brand, description, shortDescription, slug, seoTitle, seoDescription,
                focusKeyword, imageCount, stockQty, status, gtin, parentId, formato, reviewStatus, rawJson, syncedAt
            ) VALUES (
                @channel, @externalId, @sku, @name, @price, @salePrice, @weight, @height, @width, @length,
                @ncm, @category, @brand, @description, @shortDescription, @slug, @seoTitle, @seoDescription,
                @focusKeyword, @imageCount, @stockQty, @status, @gtin, @parentId, @formato,
                COALESCE((SELECT reviewStatus FROM catalog_products WHERE channel = @channel AND externalId = @externalId), 'not_started'),
                @rawJson, @syncedAt
            )
            ON CONFLICT(channel, externalId) DO UPDATE SET
                sku = excluded.sku,
                name = excluded.name,
                price = excluded.price,
                salePrice = excluded.salePrice,
                weight = excluded.weight,
                height = excluded.height,
                width = excluded.width,
                length = excluded.length,
                ncm = excluded.ncm,
                category = excluded.category,
                brand = excluded.brand,
                description = excluded.description,
                shortDescription = excluded.shortDescription,
                slug = excluded.slug,
                seoTitle = excluded.seoTitle,
                seoDescription = excluded.seoDescription,
                focusKeyword = CASE
                    WHEN excluded.focusKeyword IS NOT NULL AND excluded.focusKeyword != ''
                    THEN excluded.focusKeyword
                    ELSE catalog_products.focusKeyword
                END,
                imageCount = excluded.imageCount,
                stockQty = excluded.stockQty,
                status = excluded.status,
                gtin = excluded.gtin,
                parentId = excluded.parentId,
                formato = excluded.formato,
                rawJson = excluded.rawJson,
                syncedAt = excluded.syncedAt
        `).run({
            channel: row.channel,
            externalId: String(row.externalId),
            sku: row.sku || '',
            name: row.name || '',
            price: row.price ?? null,
            salePrice: row.salePrice ?? null,
            weight: row.weight ?? null,
            height: row.height ?? null,
            width: row.width ?? null,
            length: row.length ?? null,
            ncm: row.ncm || '',
            category: row.category || '',
            brand: row.brand || '',
            description: row.description || '',
            shortDescription: row.shortDescription || '',
            slug: row.slug || '',
            seoTitle: row.seoTitle || '',
            seoDescription: row.seoDescription || '',
            focusKeyword: row.focusKeyword || '',
            imageCount: row.imageCount ?? 0,
            stockQty: row.stockQty ?? null,
            status: row.status || '',
            gtin: row.gtin || '',
            parentId: row.parentId || '',
            formato: row.formato || '',
            rawJson: row.rawJson ? JSON.stringify(row.rawJson) : null,
            syncedAt: now,
        });
    }

    clearCatalogChannel(channel) {
        return db.prepare('DELETE FROM catalog_products WHERE channel = ?').run(channel).changes;
    }

    listCatalogProducts(channel) {
        return db.prepare('SELECT * FROM catalog_products WHERE channel = ?').all(channel);
    }

    getCatalogProduct(channel, externalId) {
        return db.prepare('SELECT * FROM catalog_products WHERE channel = ? AND externalId = ?')
            .get(channel, String(externalId)) || null;
    }

    setCatalogProductReviewStatus(channel, externalId, reviewStatus) {
        db.prepare(`
            UPDATE catalog_products SET reviewStatus = ? WHERE channel = ? AND externalId = ?
        `).run(reviewStatus, channel, String(externalId));
        return this.getCatalogProduct(channel, externalId);
    }

    deleteCatalogIssuesForProduct(channel, externalId) {
        return db.prepare(
            'DELETE FROM catalog_issues WHERE channel = ? AND externalId = ?'
        ).run(channel, String(externalId)).changes;
    }

    deleteCatalogProduct(channel, externalId) {
        const id = String(externalId);
        const issues = this.deleteCatalogIssuesForProduct(channel, id);
        this.deleteCatalogLock(channel, id);
        const product = db.prepare(
            'DELETE FROM catalog_products WHERE channel = ? AND externalId = ?'
        ).run(channel, id).changes;
        return { product, issues };
    }

    countCatalogProducts(channel) {
        const row = db.prepare('SELECT COUNT(*) AS c FROM catalog_products WHERE channel = ?').get(channel);
        return row?.c || 0;
    }

    /**
     * Busca leve no snapshot (agente WhatsApp / catálogo).
     * @param {string} channel
     * @param {string} likePattern ex. %colar%
     * @param {number} limit
     */
    searchCatalogProductsLite(channel, likePattern, limit = 100) {
        const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
        const like = String(likePattern || '').trim();
        if (!like || like === '%%') return [];
        return db.prepare(`
            SELECT externalId, sku, name, price, salePrice, stockQty, slug, status, category, rawJson
            FROM catalog_products
            WHERE channel = ?
              AND (
                lower(name) LIKE lower(?)
                OR lower(sku) LIKE lower(?)
                OR lower(IFNULL(category, '')) LIKE lower(?)
                OR lower(IFNULL(slug, '')) LIKE lower(?)
              )
            LIMIT ?
        `).all(channel, like, like, like, like, lim);
    }

    /**
     * Busca por vários tokens (AND) — mais preciso para o agente.
     * @param {string} channel
     * @param {string[]} tokens
     * @param {number} limit
     */
    searchCatalogProductsByTokens(channel, tokens, limit = 80) {
        const terms = (tokens || [])
            .map((t) => String(t || '').trim().toLowerCase())
            .filter((t) => t.length >= 3)
            .slice(0, 6);
        if (!terms.length) return [];
        const lim = Math.min(Math.max(Number(limit) || 80, 1), 200);
        const params = [channel];
        let sql = `
            SELECT externalId, sku, name, price, salePrice, stockQty, slug, status, category, rawJson
            FROM catalog_products
            WHERE channel = ?
        `;
        for (const t of terms) {
            const like = `%${t}%`;
            sql += ` AND (
                lower(name) LIKE ?
                OR lower(sku) LIKE ?
                OR lower(IFNULL(category, '')) LIKE ?
                OR lower(IFNULL(slug, '')) LIKE ?
            )`;
            params.push(like, like, like, like);
        }
        sql += ' LIMIT ?';
        params.push(lim);
        return db.prepare(sql).all(...params);
    }

    countCatalogReviewed() {
        const row = db.prepare(`
            SELECT COUNT(*) AS c FROM catalog_products
            WHERE channel = 'bling' AND reviewStatus IN ('done', 'published')
        `).get();
        return row?.c || 0;
    }

    /**
     * Lista produtos revisados (ou por reviewStatus).
     * @param {{ reviewStatus?: string, search?: string, limit?: number }} opts
     */
    listCatalogProductsByReview({ reviewStatus = 'done', search = '', limit = 500 } = {}) {
        const lim = Math.min(Math.max(Number(limit) || 500, 1), 2000);
        const q = String(search || '').trim().toLowerCase();
        let sql = `
            SELECT externalId, sku, name, price, weight, height, width, length, ncm,
                   category, brand, imageCount, stockQty, status, reviewStatus, syncedAt
            FROM catalog_products
            WHERE channel = 'bling'
        `;
        const params = [];
        if (reviewStatus === 'done' || reviewStatus === 'reviewed') {
            sql += ` AND reviewStatus IN ('done', 'published')`;
        } else if (reviewStatus === 'pending' || reviewStatus === 'not_started') {
            sql += ` AND (reviewStatus IS NULL OR reviewStatus = '' OR reviewStatus = 'not_started')`;
        } else if (reviewStatus && reviewStatus !== 'all') {
            sql += ` AND reviewStatus = ?`;
            params.push(String(reviewStatus));
        }
        if (q) {
            sql += ` AND (
                LOWER(COALESCE(sku,'')) LIKE ?
                OR LOWER(COALESCE(name,'')) LIKE ?
                OR LOWER(COALESCE(externalId,'')) LIKE ?
            )`;
            const like = `%${q}%`;
            params.push(like, like, like);
        }
        sql += ` ORDER BY syncedAt DESC, name ASC LIMIT ?`;
        params.push(lim);
        return db.prepare(sql).all(...params);
    }

    clearCatalogIssues(scanId = null) {
        if (scanId) {
            return db.prepare('DELETE FROM catalog_issues WHERE scanId = ?').run(scanId).changes;
        }
        return db.prepare('DELETE FROM catalog_issues').run().changes;
    }

    insertCatalogIssue(issue) {
        const id = issue.id || `iss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        db.prepare(`
            INSERT INTO catalog_issues (id, ruleId, priority, channel, externalId, sku, name, message, metaJson, createdAt, scanId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            issue.ruleId,
            issue.priority || 'medium',
            issue.channel || '',
            issue.externalId || '',
            issue.sku || '',
            issue.name || '',
            issue.message || '',
            issue.meta ? JSON.stringify(issue.meta) : null,
            issue.createdAt || Date.now(),
            issue.scanId || null,
        );
        return id;
    }

    listCatalogIssues({ ruleId, priority, limit = 200, viewerUserId = null } = {}) {
        this.purgeExpiredCatalogLocks();
        let sql = 'SELECT * FROM catalog_issues WHERE 1=1';
        const params = [];
        if (ruleId) { sql += ' AND ruleId = ?'; params.push(ruleId); }
        if (priority) { sql += ' AND priority = ?'; params.push(priority); }
        sql += ' ORDER BY CASE priority WHEN \'critical\' THEN 0 WHEN \'medium\' THEN 1 ELSE 2 END, name';
        if (limit != null && Number(limit) > 0) {
            sql += ' LIMIT ?';
            params.push(Math.min(Number(limit), 100000));
        }
        const locks = this.getActiveCatalogLocksMap();
        const openChecks = this.getOpenPhysicalChecksMap();
        const viewer = viewerUserId != null ? String(viewerUserId) : '';
        return db.prepare(sql).all(...params).map((row) => {
            const key = `${row.channel || 'bling'}:${row.externalId}`;
            const lockRow = locks.get(key) || null;
            const checkRow = openChecks.get(String(row.externalId)) || null;
            return {
                ...row,
                meta: row.metaJson ? JSON.parse(row.metaJson) : null,
                lock: lockRow
                    ? {
                        userId: lockRow.userId,
                        userName: lockRow.userName,
                        lockedAt: lockRow.lockedAt,
                        expiresAt: lockRow.expiresAt,
                        isMine: viewer && String(lockRow.userId) === viewer,
                    }
                    : null,
                physicalCheck: checkRow
                    ? {
                        id: checkRow.id,
                        status: checkRow.status,
                        requestedByName: checkRow.requestedByName,
                        answeredByName: checkRow.answeredByName,
                        need: (() => {
                            try {
                                return checkRow.needJson ? JSON.parse(checkRow.needJson) : [];
                            } catch {
                                return [];
                            }
                        })(),
                    }
                    : null,
            };
        });
    }

    /** Mapa externalId → pedido aberto (pending|answered). */
    getOpenPhysicalChecksMap() {
        const rows = db.prepare(`
            SELECT * FROM catalog_physical_checks
            WHERE status IN ('pending', 'answered')
            ORDER BY requestedAt DESC
        `).all();
        const map = new Map();
        for (const r of rows) {
            const id = String(r.externalId);
            if (!map.has(id)) map.set(id, r);
        }
        return map;
    }

    purgeExpiredCatalogLocks() {
        return db.prepare('DELETE FROM catalog_edit_locks WHERE expiresAt <= ?').run(Date.now()).changes;
    }

    getCatalogLock(channel, externalId) {
        this.purgeExpiredCatalogLocks();
        return db.prepare(
            'SELECT * FROM catalog_edit_locks WHERE channel = ? AND externalId = ? AND expiresAt > ?',
        ).get(channel, String(externalId), Date.now()) || null;
    }

    getActiveCatalogLocksMap() {
        this.purgeExpiredCatalogLocks();
        const rows = db.prepare(
            'SELECT * FROM catalog_edit_locks WHERE expiresAt > ?',
        ).all(Date.now());
        const map = new Map();
        for (const r of rows) {
            map.set(`${r.channel}:${r.externalId}`, r);
        }
        return map;
    }

    /**
     * Reserva produto para edição.
     * @returns {{ ok: true, lock } | { ok: false, conflict: true, lock }}
     */
    claimCatalogLock(channel, externalId, { userId, userName, ttlMs = 15 * 60 * 1000 } = {}) {
        const id = String(externalId);
        const uid = String(userId || '');
        const uname = String(userName || 'Usuário').trim() || 'Usuário';
        if (!uid) throw new Error('Usuário obrigatório para reservar o produto.');

        this.purgeExpiredCatalogLocks();
        const now = Date.now();
        const expiresAt = now + Math.max(60_000, Number(ttlMs) || 15 * 60 * 1000);
        const cur = db.prepare(
            'SELECT * FROM catalog_edit_locks WHERE channel = ? AND externalId = ?',
        ).get(channel, id);

        if (cur && cur.expiresAt > now && String(cur.userId) !== uid) {
            return {
                ok: false,
                conflict: true,
                lock: {
                    userId: cur.userId,
                    userName: cur.userName,
                    lockedAt: cur.lockedAt,
                    expiresAt: cur.expiresAt,
                    isMine: false,
                },
            };
        }

        db.prepare(`
            INSERT INTO catalog_edit_locks (channel, externalId, userId, userName, lockedAt, expiresAt)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(channel, externalId) DO UPDATE SET
                userId = excluded.userId,
                userName = excluded.userName,
                lockedAt = excluded.lockedAt,
                expiresAt = excluded.expiresAt
        `).run(channel, id, uid, uname, now, expiresAt);

        return {
            ok: true,
            lock: {
                userId: uid,
                userName: uname,
                lockedAt: now,
                expiresAt,
                isMine: true,
            },
        };
    }

    renewCatalogLock(channel, externalId, userId, ttlMs = 15 * 60 * 1000) {
        this.purgeExpiredCatalogLocks();
        const id = String(externalId);
        const uid = String(userId);
        const cur = this.getCatalogLock(channel, id);
        if (!cur) return { ok: false, reason: 'not_locked' };
        if (String(cur.userId) !== uid) return { ok: false, reason: 'not_owner', lock: cur };
        const expiresAt = Date.now() + Math.max(60_000, Number(ttlMs) || 15 * 60 * 1000);
        db.prepare(`
            UPDATE catalog_edit_locks SET expiresAt = ? WHERE channel = ? AND externalId = ? AND userId = ?
        `).run(expiresAt, channel, id, uid);
        return {
            ok: true,
            lock: { ...cur, expiresAt, isMine: true },
        };
    }

    releaseCatalogLock(channel, externalId, { userId, force = false } = {}) {
        const id = String(externalId);
        const cur = db.prepare(
            'SELECT * FROM catalog_edit_locks WHERE channel = ? AND externalId = ?',
        ).get(channel, id);
        if (!cur) return { ok: true, released: false };
        if (!force && userId && String(cur.userId) !== String(userId)) {
            return { ok: false, reason: 'not_owner', lock: cur };
        }
        db.prepare('DELETE FROM catalog_edit_locks WHERE channel = ? AND externalId = ?').run(channel, id);
        return { ok: true, released: true };
    }

    deleteCatalogLock(channel, externalId) {
        return db.prepare(
            'DELETE FROM catalog_edit_locks WHERE channel = ? AND externalId = ?',
        ).run(channel, String(externalId)).changes;
    }

    countCatalogIssuesByRule() {
        return db.prepare(`
            SELECT ruleId, priority, COUNT(*) AS count FROM catalog_issues
            GROUP BY ruleId, priority
        `).all();
    }

    createCatalogScan(scan) {
        db.prepare(`
            INSERT INTO catalog_scans (id, status, phase, message, blingCount, wooCount, issueCount, okCount, startedAt, finishedAt, durationMs, error, summaryJson)
            VALUES (@id, @status, @phase, @message, @blingCount, @wooCount, @issueCount, @okCount, @startedAt, @finishedAt, @durationMs, @error, @summaryJson)
        `).run({
            id: scan.id,
            status: scan.status || 'running',
            phase: scan.phase || 'start',
            message: scan.message || '',
            blingCount: scan.blingCount || 0,
            wooCount: scan.wooCount || 0,
            issueCount: scan.issueCount || 0,
            okCount: scan.okCount || 0,
            startedAt: scan.startedAt || Date.now(),
            finishedAt: scan.finishedAt || null,
            durationMs: scan.durationMs || null,
            error: scan.error || null,
            summaryJson: scan.summary ? JSON.stringify(scan.summary) : null,
        });
        return this.getCatalogScan(scan.id);
    }

    updateCatalogScan(id, patch) {
        const cur = this.getCatalogScan(id);
        if (!cur) return null;
        const next = { ...cur, ...patch };
        if (patch.summary !== undefined) {
            next.summaryJson = JSON.stringify(patch.summary);
        }
        db.prepare(`
            UPDATE catalog_scans SET
                status = ?, phase = ?, message = ?, blingCount = ?, wooCount = ?,
                issueCount = ?, okCount = ?, finishedAt = ?, durationMs = ?, error = ?, summaryJson = ?
            WHERE id = ?
        `).run(
            next.status,
            next.phase,
            next.message || '',
            next.blingCount || 0,
            next.wooCount || 0,
            next.issueCount || 0,
            next.okCount || 0,
            next.finishedAt || null,
            next.durationMs || null,
            next.error || null,
            next.summaryJson || null,
            id,
        );
        return this.getCatalogScan(id);
    }

    getCatalogScan(id) {
        const row = db.prepare('SELECT * FROM catalog_scans WHERE id = ?').get(id);
        if (!row) return null;
        return {
            ...row,
            summary: row.summaryJson ? JSON.parse(row.summaryJson) : null,
        };
    }

    getLatestCatalogScan() {
        const row = db.prepare('SELECT * FROM catalog_scans ORDER BY startedAt DESC LIMIT 1').get();
        if (!row) return null;
        return {
            ...row,
            summary: row.summaryJson ? JSON.parse(row.summaryJson) : null,
        };
    }

    // --- Conferência física (Goiânia) ---
    _mapPhysicalCheck(row) {
        if (!row) return null;
        let need = [];
        try {
            need = row.needJson ? JSON.parse(row.needJson) : [];
        } catch {
            need = [];
        }
        const dueAt = row.dueAt || null;
        const status = row.status || 'pending';
        const overdue = Boolean(
            dueAt
            && dueAt < Date.now()
            && (status === 'pending' || status === 'answered'),
        );
        return {
            ...row,
            need: Array.isArray(need) ? need : [],
            priority: row.priority === 'urgent' ? 'urgent' : 'normal',
            dueAt,
            overdue,
            photoUrl: row.photoFilename
                ? `/api/catalog/check-files/${encodeURIComponent(row.photoFilename)}`
                : null,
        };
    }

    createPhysicalCheck(row) {
        const id = row.id || `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const requestedAt = row.requestedAt || Date.now();
        const priority = row.priority === 'urgent' ? 'urgent' : 'normal';
        const dueAt = row.dueAt != null
            ? Number(row.dueAt)
            : requestedAt + (priority === 'urgent' ? 8 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
        db.prepare(`
            INSERT INTO catalog_physical_checks (
                id, externalId, sku, name, needJson, requestNote, status,
                requestedById, requestedByName, requestedAt,
                priority, dueAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            String(row.externalId),
            row.sku || '',
            row.name || '',
            JSON.stringify(row.need || []),
            row.requestNote || '',
            row.status || 'pending',
            row.requestedById || '',
            row.requestedByName || '',
            requestedAt,
            priority,
            dueAt,
        );
        return this.getPhysicalCheck(id);
    }

    getPhysicalCheck(id) {
        return this._mapPhysicalCheck(
            db.prepare('SELECT * FROM catalog_physical_checks WHERE id = ?').get(id),
        );
    }

    listPhysicalChecks({ status, externalId, overdue, limit = 200 } = {}) {
        let sql = 'SELECT * FROM catalog_physical_checks WHERE 1=1';
        const params = [];
        if (status) {
            sql += ' AND status = ?';
            params.push(String(status));
        }
        if (externalId) {
            sql += ' AND externalId = ?';
            params.push(String(externalId));
        }
        if (overdue === true) {
            sql += ` AND dueAt IS NOT NULL AND dueAt < ? AND status IN ('pending', 'answered')`;
            params.push(Date.now());
        }
        sql += ` ORDER BY
            CASE priority WHEN 'urgent' THEN 0 ELSE 1 END,
            CASE status WHEN 'pending' THEN 0 WHEN 'answered' THEN 1 WHEN 'returned' THEN 2 WHEN 'applied' THEN 3 ELSE 4 END,
            CASE WHEN dueAt IS NOT NULL AND dueAt < ? AND status IN ('pending','answered') THEN 0 ELSE 1 END,
            requestedAt DESC`;
        params.push(Date.now());
        if (limit != null && Number(limit) > 0) {
            sql += ' LIMIT ?';
            params.push(Math.min(Number(limit), 5000));
        }
        return db.prepare(sql).all(...params).map((r) => this._mapPhysicalCheck(r));
    }

    countPhysicalChecksByStatus() {
        return db.prepare(`
            SELECT status, COUNT(*) AS count FROM catalog_physical_checks GROUP BY status
        `).all();
    }

    countOverduePhysicalChecks() {
        return db.prepare(`
            SELECT COUNT(*) AS c FROM catalog_physical_checks
            WHERE dueAt IS NOT NULL AND dueAt < ? AND status IN ('pending', 'answered')
        `).get(Date.now())?.c || 0;
    }

    /**
     * Relatório de concluídos (respondidos + aplicados) no período.
     * sinceMs: timestamp mínimo (answeredAt ou appliedAt).
     */
    getPhysicalCheckCompletedReport({ sinceMs = 0, limit = 200 } = {}) {
        const since = Number(sinceMs) || 0;
        const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);

        const answered = db.prepare(`
            SELECT COUNT(*) AS c FROM catalog_physical_checks
            WHERE status = 'answered' AND answeredAt IS NOT NULL AND answeredAt >= ?
        `).get(since)?.c || 0;

        const applied = db.prepare(`
            SELECT COUNT(*) AS c FROM catalog_physical_checks
            WHERE status = 'applied' AND COALESCE(appliedAt, answeredAt, 0) >= ?
        `).get(since)?.c || 0;

        const returned = db.prepare(`
            SELECT COUNT(*) AS c FROM catalog_physical_checks
            WHERE status = 'returned' AND COALESCE(returnedAt, 0) >= ?
        `).get(since)?.c || 0;

        const byResponder = db.prepare(`
            SELECT
                COALESCE(NULLIF(answeredByName, ''), '—') AS name,
                COUNT(*) AS count
            FROM catalog_physical_checks
            WHERE status IN ('answered', 'applied')
              AND answeredAt IS NOT NULL
              AND answeredAt >= ?
            GROUP BY COALESCE(NULLIF(answeredByName, ''), '—')
            ORDER BY count DESC
        `).all(since);

        const items = db.prepare(`
            SELECT * FROM catalog_physical_checks
            WHERE (
                (status = 'answered' AND answeredAt IS NOT NULL AND answeredAt >= ?)
                OR (status = 'applied' AND COALESCE(appliedAt, answeredAt, 0) >= ?)
            )
            ORDER BY COALESCE(appliedAt, answeredAt, requestedAt) DESC
            LIMIT ?
        `).all(since, since, lim).map((r) => this._mapPhysicalCheck(r));

        return {
            answered,
            applied,
            returned,
            completed: answered + applied,
            byResponder,
            items,
        };
    }

    countOpenPhysicalChecksForProduct(externalId) {
        return db.prepare(`
            SELECT COUNT(*) AS c FROM catalog_physical_checks
            WHERE externalId = ? AND status IN ('pending', 'answered')
        `).get(String(externalId))?.c || 0;
    }

    answerPhysicalCheck(id, patch) {
        const cur = this.getPhysicalCheck(id);
        if (!cur) return null;
        db.prepare(`
            UPDATE catalog_physical_checks SET
                status = 'answered',
                responseNote = ?,
                responseWeight = ?,
                responseHeight = ?,
                responseWidth = ?,
                responseLength = ?,
                photoFilename = COALESCE(?, photoFilename),
                answeredById = ?,
                answeredByName = ?,
                answeredAt = ?,
                returnReason = NULL
            WHERE id = ?
        `).run(
            patch.responseNote || '',
            patch.responseWeight ?? null,
            patch.responseHeight ?? null,
            patch.responseWidth ?? null,
            patch.responseLength ?? null,
            patch.photoFilename || null,
            patch.answeredById || '',
            patch.answeredByName || '',
            patch.answeredAt || Date.now(),
            id,
        );
        return this.getPhysicalCheck(id);
    }

    /** Admin devolve resposta para refazer (answered → pending) ou operador fecha sem conseguir (pending → returned). */
    returnPhysicalCheck(id, { reason, actorId, actorName, mode = 'reopen' } = {}) {
        const cur = this.getPhysicalCheck(id);
        if (!cur) return null;
        const note = String(reason || '').trim().slice(0, 2000);
        const now = Date.now();
        if (mode === 'close') {
            // operador não conseguiu — fecha como returned
            db.prepare(`
                UPDATE catalog_physical_checks SET
                    status = 'returned',
                    returnReason = ?,
                    returnedAt = ?,
                    returnedById = ?,
                    returnedByName = ?
                WHERE id = ?
            `).run(note, now, actorId || '', actorName || '', id);
        } else {
            // admin pede refazer — volta a pending, limpa resposta
            db.prepare(`
                UPDATE catalog_physical_checks SET
                    status = 'pending',
                    returnReason = ?,
                    returnedAt = ?,
                    returnedById = ?,
                    returnedByName = ?,
                    responseNote = '',
                    responseWeight = NULL,
                    responseHeight = NULL,
                    responseWidth = NULL,
                    responseLength = NULL,
                    photoFilename = NULL,
                    answeredById = NULL,
                    answeredByName = NULL,
                    answeredAt = NULL
                WHERE id = ?
            `).run(note, now, actorId || '', actorName || '', id);
        }
        return this.getPhysicalCheck(id);
    }

    markPhysicalCheckApplied(id, actor = {}) {
        db.prepare(`
            UPDATE catalog_physical_checks SET
                status = 'applied',
                appliedAt = ?,
                appliedById = ?,
                appliedByName = ?
            WHERE id = ?
        `).run(
            Date.now(),
            actor.id || '',
            actor.name || actor.email || '',
            id,
        );
        return this.getPhysicalCheck(id);
    }

    cancelPhysicalCheck(id) {
        db.prepare(`
            UPDATE catalog_physical_checks SET status = 'cancelled' WHERE id = ? AND status = 'pending'
        `).run(id);
        return this.getPhysicalCheck(id);
    }

    deletePhysicalCheck(id) {
        const row = db.prepare('SELECT * FROM catalog_physical_checks WHERE id = ?').get(id);
        if (!row) return null;
        db.prepare('DELETE FROM catalog_physical_check_comments WHERE checkId = ?').run(id);
        db.prepare('DELETE FROM catalog_physical_checks WHERE id = ?').run(id);
        return this._mapPhysicalCheck(row);
    }

    listPhysicalCheckComments(checkId, limit = 100) {
        return db.prepare(`
            SELECT * FROM catalog_physical_check_comments
            WHERE checkId = ?
            ORDER BY createdAt ASC
            LIMIT ?
        `).all(String(checkId), Math.min(Number(limit) || 100, 500));
    }

    addPhysicalCheckComment({ checkId, body, actorId, actorName }) {
        const id = `cmc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const createdAt = Date.now();
        db.prepare(`
            INSERT INTO catalog_physical_check_comments (id, checkId, body, actorId, actorName, createdAt)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            id,
            String(checkId),
            String(body || '').trim().slice(0, 2000),
            actorId || '',
            actorName || '',
            createdAt,
        );
        return db.prepare('SELECT * FROM catalog_physical_check_comments WHERE id = ?').get(id);
    }

    _mapCatalogAiDraft(row) {
        if (!row) return null;
        const parse = (v) => {
            if (!v) return null;
            if (typeof v === 'object') return v;
            try { return JSON.parse(v); } catch { return null; }
        };
        return {
            id: row.id,
            externalId: row.externalId,
            sku: row.sku || '',
            name: row.name || '',
            status: row.status,
            fields: parse(row.fieldsJson) || [],
            suggested: parse(row.suggestedJson) || {},
            edited: parse(row.editedJson),
            provider: row.provider || null,
            rationale: row.rationale || '',
            error: row.error || null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            appliedAt: row.appliedAt || null,
        };
    }

    upsertCatalogAiDraft({
        externalId,
        sku,
        name,
        fields,
        suggested,
        provider,
        rationale,
        status = 'pending',
    }) {
        const ext = String(externalId || '').trim();
        if (!ext) throw new Error('externalId obrigatório');
        const now = Date.now();
        const existing = db.prepare(`
            SELECT id FROM catalog_ai_drafts
            WHERE externalId = ? AND status = 'pending'
            ORDER BY updatedAt DESC LIMIT 1
        `).get(ext);

        const suggestedJson = JSON.stringify(suggested || {});
        const fieldsJson = JSON.stringify(Array.isArray(fields) ? fields : []);
        const rationaleStr = String(rationale || suggested?.rationale || '').slice(0, 400);

        if (existing?.id) {
            db.prepare(`
                UPDATE catalog_ai_drafts SET
                    sku = ?, name = ?, fieldsJson = ?, suggestedJson = ?,
                    editedJson = NULL, provider = ?, rationale = ?, error = NULL,
                    status = ?, updatedAt = ?
                WHERE id = ?
            `).run(
                sku || '',
                name || '',
                fieldsJson,
                suggestedJson,
                provider || null,
                rationaleStr,
                status,
                now,
                existing.id,
            );
            return this.getCatalogAiDraft(existing.id);
        }

        const id = `aid_${now}_${Math.random().toString(36).slice(2, 8)}`;
        db.prepare(`
            INSERT INTO catalog_ai_drafts (
                id, externalId, sku, name, status, fieldsJson, suggestedJson,
                editedJson, provider, rationale, error, createdAt, updatedAt, appliedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, NULL)
        `).run(
            id, ext, sku || '', name || '', status, fieldsJson, suggestedJson,
            provider || null, rationaleStr, now, now,
        );
        return this.getCatalogAiDraft(id);
    }

    getCatalogAiDraft(id) {
        const row = db.prepare('SELECT * FROM catalog_ai_drafts WHERE id = ?').get(String(id || ''));
        return this._mapCatalogAiDraft(row);
    }

    getPendingCatalogAiDraftByExternalId(externalId) {
        const row = db.prepare(`
            SELECT * FROM catalog_ai_drafts
            WHERE externalId = ? AND status = 'pending'
            ORDER BY updatedAt DESC LIMIT 1
        `).get(String(externalId || ''));
        return this._mapCatalogAiDraft(row);
    }

    listCatalogAiDrafts({ status = 'pending', limit = 200 } = {}) {
        const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
        let rows;
        if (status && status !== 'all') {
            rows = db.prepare(`
                SELECT * FROM catalog_ai_drafts WHERE status = ?
                ORDER BY updatedAt DESC LIMIT ?
            `).all(String(status), lim);
        } else {
            rows = db.prepare(`
                SELECT * FROM catalog_ai_drafts
                ORDER BY updatedAt DESC LIMIT ?
            `).all(lim);
        }
        return rows.map((r) => this._mapCatalogAiDraft(r));
    }

    countCatalogAiDrafts(status = 'pending') {
        const row = db.prepare(`
            SELECT COUNT(*) AS c FROM catalog_ai_drafts WHERE status = ?
        `).get(String(status || 'pending'));
        return Number(row?.c || 0);
    }

    /** IDs externos com rascunho IA pendente (fora da fila de Problemas). */
    listPendingCatalogAiDraftExternalIds() {
        return db.prepare(`
            SELECT DISTINCT externalId FROM catalog_ai_drafts WHERE status = 'pending'
        `).all().map((r) => String(r.externalId || '')).filter(Boolean);
    }

    updateCatalogAiDraft(id, { edited, status, error } = {}) {
        const draft = this.getCatalogAiDraft(id);
        if (!draft) return null;
        const now = Date.now();
        const editedJson = edited !== undefined
            ? JSON.stringify(edited || {})
            : (draft.edited ? JSON.stringify(draft.edited) : null);
        const nextStatus = status || draft.status;
        db.prepare(`
            UPDATE catalog_ai_drafts SET
                editedJson = ?, status = ?, error = ?, updatedAt = ?,
                appliedAt = CASE WHEN ? = 'applied' THEN ? ELSE appliedAt END
            WHERE id = ?
        `).run(
            editedJson,
            nextStatus,
            error !== undefined ? (error || null) : draft.error,
            now,
            nextStatus,
            now,
            String(id),
        );
        return this.getCatalogAiDraft(id);
    }

    discardCatalogAiDraft(id) {
        return this.updateCatalogAiDraft(id, { status: 'discarded' });
    }

    discardCatalogAiDraftsBulk(ids = []) {
        const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
        let discarded = 0;
        for (const id of list) {
            const d = this.getCatalogAiDraft(id);
            if (!d || d.status !== 'pending') continue;
            this.updateCatalogAiDraft(id, { status: 'discarded' });
            discarded += 1;
        }
        return { total: list.length, discarded };
    }

    markCatalogAiDraftsAppliedByExternalId(externalId) {
        const ext = String(externalId || '').trim();
        if (!ext) return 0;
        const now = Date.now();
        return db.prepare(`
            UPDATE catalog_ai_drafts
            SET status = 'applied', appliedAt = ?, updatedAt = ?
            WHERE externalId = ? AND status = 'pending'
        `).run(now, now, ext).changes;
    }

    close() {
        db.close();
    }
}

export default new ChatDatabase();
