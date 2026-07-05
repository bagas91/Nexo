import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SessionBackup {
    constructor() {
        this.sessionDir = path.join(__dirname, '../.wwebjs_auth/session');
        this.backupDir = path.join(__dirname, '../.wwebjs_auth/backup');
        /** Segunda cópia opcional (dobra uso de disco). Ative com BACKUP_ARCHIVE=1. */
        this.archiveDir = path.join(__dirname, '../.wwebjs_auth/backup_archive');
        this.retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS ?? 2));
        /** Teto de pastas session-* por diretório (backup e archive), além do corte por idade. */
        this.maxCopies = Math.max(2, Number(process.env.BACKUP_MAX_COPIES ?? 16));
        /** Não criar cópia completa se já existe backup mais novo que este intervalo (rajadas ready/disconnect). 0 = desliga. */
        this.backupMinIntervalMs = Math.max(0, Number(process.env.BACKUP_MIN_INTERVAL_MS ?? 25 * 60 * 1000));
        this.archiveEnabled = process.env.BACKUP_ARCHIVE === '1';
        this.ensureBackupDirectory();
        // Limpeza oportunista ao iniciar (não bloqueia se falhar).
        this.cleanOldBackups().catch(() => {});
    }

    ensureBackupDirectory() {
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
        if (this.archiveEnabled && !fs.existsSync(this.archiveDir)) {
            fs.mkdirSync(this.archiveDir, { recursive: true });
        }
    }

    /** Copia o backup recém-criado para backup_archive (opcional). */
    async copyToArchive(backupPath) {
        if (!this.archiveEnabled) return;
        try {
            const name = path.basename(backupPath);
            const archivePath = path.join(this.archiveDir, name);
            if (!fs.existsSync(backupPath)) return;
            await this.copyDirectory(backupPath, archivePath);
        } catch (err) {
            // Não falha o backup principal se o archive falhar (ex.: disco cheio)
        }
    }

    _listSessionBackups(dirPath) {
        if (!fs.existsSync(dirPath)) return [];
        return fs.readdirSync(dirPath)
            .filter(f => f.startsWith('session-'))
            .map(f => {
                const fullPath = path.join(dirPath, f);
                const stat = fs.statSync(fullPath);
                if (!stat.isDirectory()) return null;
                return { path: fullPath, mtimeMs: stat.mtimeMs };
            })
            .filter(Boolean);
    }

    /** Maior mtime entre backups em backup/ (para throttle). */
    _getLatestBackupMtime() {
        const entries = this._listSessionBackups(this.backupDir);
        if (entries.length === 0) return null;
        return Math.max(...entries.map(e => e.mtimeMs));
    }

    /**
     * @param {{ force?: boolean }} [options] - force=true ignora intervalo mínimo (restart, API, encerramento)
     */
    async backup(options = {}) {
        const force = options.force === true;
        try {
            if (!fs.existsSync(this.sessionDir)) {
                return { success: false, message: 'Sessão não encontrada' };
            }

            if (!force && this.backupMinIntervalMs > 0) {
                const latest = this._getLatestBackupMtime();
                if (latest != null && Date.now() - latest < this.backupMinIntervalMs) {
                    await this.cleanOldBackups();
                    return { success: true, skipped: true, message: 'Backup ignorado: cópia recente existe' };
                }
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(this.backupDir, `session-${timestamp}`);

            // Copiar diretório completo
            await this.copyDirectory(this.sessionDir, backupPath);

            await this.copyToArchive(backupPath);

            await this.cleanOldBackups();

            return { success: true, backupPath };
        } catch (err) {
            if (err.code === 'ENOSPC') {
                try {
                    const notifier = (await import('./notifier.js')).default;
                    notifier.notify('Backup da sessão falhou: disco cheio.', 'warn');
                } catch (_) {}
            }
            return { success: false, message: err.message };
        }
    }

    async restore(latest = true) {
        try {
            if (!fs.existsSync(this.backupDir)) {
                return { success: false, message: 'Nenhum backup encontrado' };
            }

            const backups = fs.readdirSync(this.backupDir)
                .filter(f => f.startsWith('session-'))
                .map(f => ({
                    name: f,
                    path: path.join(this.backupDir, f),
                    time: fs.statSync(path.join(this.backupDir, f)).mtime
                }))
                .sort((a, b) => b.time - a.time);

            if (backups.length === 0) {
                return { success: false, message: 'Nenhum backup disponível' };
            }

            const backupToRestore = latest ? backups[0] : backups[backups.length - 1];

            // Remover sessão atual se existir
            if (fs.existsSync(this.sessionDir)) {
                fs.rmSync(this.sessionDir, { recursive: true, force: true });
            }

            // Restaurar backup
            await this.copyDirectory(backupToRestore.path, this.sessionDir);

            return { success: true, backup: backupToRestore.name };
        } catch (err) {
            return { success: false, message: err.message };
        }
    }

    /**
     * Restaura um backup específico pelo nome (ex: session-2026-03-06T21-02-17-657Z).
     * @param {string} backupName - Nome da pasta do backup
     * @returns {{ success: boolean, backup?: string, message?: string }}
     */
    async restoreByName(backupName) {
        try {
            if (!backupName || typeof backupName !== 'string') {
                return { success: false, message: 'Nome do backup é obrigatório' };
            }
            let backupPath = path.join(this.backupDir, backupName);
            if (!fs.existsSync(backupPath) || !fs.statSync(backupPath).isDirectory()) {
                backupPath = path.join(this.archiveDir, backupName);
                if (!fs.existsSync(backupPath) || !fs.statSync(backupPath).isDirectory()) {
                    return { success: false, message: `Backup não encontrado: ${backupName}` };
                }
            }

            if (fs.existsSync(this.sessionDir)) {
                fs.rmSync(this.sessionDir, { recursive: true, force: true });
            }

            await this.copyDirectory(backupPath, this.sessionDir);
            return { success: true, backup: backupName };
        } catch (err) {
            return { success: false, message: err.message };
        }
    }

    async copyDirectory(src, dest) {
        return new Promise((resolve, reject) => {
            fs.mkdirSync(dest, { recursive: true });
            
            const copyRecursive = (srcDir, destDir) => {
                const entries = fs.readdirSync(srcDir, { withFileTypes: true });

                for (const entry of entries) {
                    const srcPath = path.join(srcDir, entry.name);
                    const destPath = path.join(destDir, entry.name);

                    // Chromium: locks/socket em runtime — não copiar (symlink quebrado ou fora do backup).
                    if (entry.isSymbolicLink()) {
                        if (/^Singleton(Lock|Cookie|Socket)$/.test(entry.name)) {
                            continue;
                        }
                        try {
                            const target = fs.readlinkSync(srcPath);
                            fs.symlinkSync(target, destPath);
                        } catch (_) {
                            /* symlink quebrado: ignora */
                        }
                        continue;
                    }

                    if (entry.isDirectory()) {
                        fs.mkdirSync(destPath, { recursive: true });
                        copyRecursive(srcPath, destPath);
                    } else {
                        fs.copyFileSync(srcPath, destPath);
                    }
                }
            };
            
            try {
                copyRecursive(src, dest);
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    async cleanOldBackups() {
        try {
            const now = Date.now();
            const retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;
            const pruneDir = (dirPath) => {
                if (!fs.existsSync(dirPath)) return;
                let entries = this._listSessionBackups(dirPath);
                for (const entry of entries) {
                    const ageMs = now - entry.mtimeMs;
                    if (ageMs > retentionMs) {
                        fs.rmSync(entry.path, { recursive: true, force: true });
                    }
                }
                entries = this._listSessionBackups(dirPath).sort((a, b) => a.mtimeMs - b.mtimeMs);
                while (entries.length > this.maxCopies) {
                    const oldest = entries.shift();
                    fs.rmSync(oldest.path, { recursive: true, force: true });
                }
            };

            pruneDir(this.backupDir);
            if (this.archiveEnabled || fs.existsSync(this.archiveDir)) {
                pruneDir(this.archiveDir);
            }
        } catch (err) {
            // Ignorar erros na limpeza
        }
    }

    listBackups() {
        return this._listInDir(this.backupDir, 'backup');
    }

    /** Lista todos os backups (pasta backup + backup_archive). Útil para ver e restaurar antigos. */
    listAllBackups() {
        const fromBackup = this._listInDir(this.backupDir, 'backup');
        const fromArchive = this._listInDir(this.archiveDir, 'archive');
        const byName = new Map();
        fromBackup.forEach(b => byName.set(b.name, b));
        fromArchive.forEach(b => {
            if (!byName.has(b.name)) byName.set(b.name, b);
        });
        return Array.from(byName.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    _listInDir(dir, source) {
        try {
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir)
                .filter(f => f.startsWith('session-'))
                .map(f => {
                    const fullPath = path.join(dir, f);
                    const stat = fs.statSync(fullPath);
                    if (!stat.isDirectory()) return null;
                    return {
                        name: f,
                        size: this.formatBytes(this.getDirectorySize(fullPath)),
                        date: stat.mtime,
                        source
                    };
                })
                .filter(Boolean)
                .sort((a, b) => new Date(b.date) - new Date(a.date));
        } catch (err) {
            return [];
        }
    }

    getDirectorySize(dirPath) {
        let size = 0;
        try {
            const files = fs.readdirSync(dirPath);
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    size += this.getDirectorySize(filePath);
                } else {
                    size += stat.size;
                }
            }
        } catch (err) {
            // Ignorar erros
        }
        return size;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}

export default new SessionBackup();
