import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, '../chats.db'));

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
            createdAt: row.createdAt
        }));
    }

    updateScheduleStatus(id, status, errorMessage = null) {
        db.prepare('UPDATE schedules SET status = ?, errorMessage = ? WHERE id = ?').run(status, errorMessage, id);
    }

    incrementScheduleRetryCount(id) {
        db.prepare('UPDATE schedules SET retryCount = retryCount + 1, status = ?, errorMessage = ? WHERE id = ?').run('pending', null, id);
    }

    resetStaleSendingSchedules() {
        const r = db.prepare("UPDATE schedules SET status = 'pending' WHERE status = 'sending'").run();
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
    createUser({ id, email, passwordHash, name, role = 'creator', active = 1 }) {
        const now = Date.now();
        db.prepare(`
            INSERT INTO users (id, email, passwordHash, name, role, active, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, email, passwordHash, name, role, active ? 1 : 0, now);
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
        if (!fields.length) return;
        values.push(id);
        db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
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
        const stmt = db.prepare(`
            INSERT INTO inbox_messages (id, chatId, phone, contactName, body, fromMe, ts, seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
        `);
        const result = stmt.run(
            msg.id,
            msg.chatId,
            msg.phone,
            msg.contactName || '',
            msg.body,
            msg.fromMe ? 1 : 0,
            msg.ts,
            seen
        );
        if (result.changes === 0) return false;

        const existing = db.prepare('SELECT unread FROM inbox_conversations WHERE chatId = ?').get(msg.chatId);
        let unread = existing?.unread || 0;
        if (!msg.fromMe && !silent) unread += 1;
        db.prepare(`
            INSERT INTO inbox_conversations (chatId, phone, contactName, lastMessage, lastTs, unread, status)
            VALUES (?, ?, ?, ?, ?, ?, 'open')
            ON CONFLICT(chatId) DO UPDATE SET
                phone = excluded.phone,
                contactName = CASE WHEN excluded.contactName != '' THEN excluded.contactName ELSE inbox_conversations.contactName END,
                lastMessage = excluded.lastMessage,
                lastTs = excluded.lastTs,
                unread = ?
        `).run(msg.chatId, msg.phone, msg.contactName || '', msg.body, msg.ts, unread, unread);
        return true;
    }

    listInboxConversations(limit = 100) {
        return db.prepare(`
            SELECT chatId, phone, contactName, lastMessage, lastTs AS updatedAt, unread, status, mode
            FROM inbox_conversations
            ORDER BY lastTs DESC
            LIMIT ?
        `).all(limit).map((row) => ({
            id: row.chatId,
            contactName: row.contactName || row.phone,
            phone: row.phone,
            lastMessage: row.lastMessage,
            unread: row.unread,
            status: row.status,
            mode: row.mode || 'bot',
            updatedAt: row.updatedAt,
        }));
    }

    getInboxConversation(chatId) {
        const row = db.prepare('SELECT * FROM inbox_conversations WHERE chatId = ?').get(chatId);
        if (!row) return null;
        return {
            id: row.chatId,
            phone: row.phone,
            contactName: row.contactName,
            lastMessage: row.lastMessage,
            unread: row.unread,
            status: row.status,
            mode: row.mode || 'bot',
            updatedAt: row.lastTs,
        };
    }

    setInboxConversationMode(chatId, mode) {
        const allowed = new Set(['bot', 'human']);
        if (!allowed.has(mode)) throw new Error('mode deve ser bot ou human');
        db.prepare('UPDATE inbox_conversations SET mode = ? WHERE chatId = ?').run(mode, chatId);
        return this.getInboxConversation(chatId);
    }

    setInboxConversationStatus(chatId, status) {
        db.prepare('UPDATE inbox_conversations SET status = ? WHERE chatId = ?').run(status, chatId);
    }

    listInboxMessages(chatId, limit = 100) {
        return db.prepare(`
            SELECT id, chatId, phone, contactName, body, fromMe, ts, seen
            FROM inbox_messages
            WHERE chatId = ?
            ORDER BY ts ASC
            LIMIT ?
        `).all(chatId, limit).map((row) => ({
            id: row.id,
            chatId: row.chatId,
            phone: row.phone,
            contactName: row.contactName,
            body: row.body,
            fromMe: !!row.fromMe,
            ts: row.ts,
            seen: !!row.seen,
        }));
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

    close() {
        db.close();
    }
}

export default new ChatDatabase();
