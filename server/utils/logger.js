import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import notifier from './notifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '../../logs');
        this.ensureLogDirectory();
    }

    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    getLogFileName() {
        const today = new Date().toISOString().split('T')[0];
        return path.join(this.logDir, `zapflow-${today}.log`);
    }

    formatMessage(level, message, ...args) {
        const timestamp = new Date().toISOString();
        const formattedArgs = args.length > 0 ? ' ' + args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ') : '';
        return `[${timestamp}] [${level}] ${message}${formattedArgs}\n`;
    }

    writeToFile(level, message, ...args) {
        const logFile = this.getLogFileName();
        const logMessage = this.formatMessage(level, message, ...args);
        
        try {
            fs.appendFileSync(logFile, logMessage, 'utf8');
        } catch (err) {
            console.error('Erro ao escrever no arquivo de log:', err.message);
        }
    }

    log(level, message, ...args) {
        let notifyDiscord = true;
        const last = args[args.length - 1];
        if (last && typeof last === 'object' && last.__noDiscord === true) {
            notifyDiscord = false;
            args = args.slice(0, -1);
        }

        const buildFull = () =>
            args.length
                ? `${message} ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`
                : message;

        // Escreve no console
        if (level === 'ERROR') {
            console.error(`[${level}]`, message, ...args);
            if (notifyDiscord) {
                try {
                    notifier.notify(buildFull(), 'error');
                } catch (_) {}
            }
        } else if (level === 'WARN' && (process.env.DISCORD_LOG_WARN === '1' || process.env.DISCORD_LOG_WARN === 'true')) {
            console.warn(`[${level}]`, message, ...args);
            if (process.env.DISCORD_WEBHOOK_URL) {
                try {
                    notifier.notify(`[WARN] ${buildFull()}`, 'warn');
                } catch (_) {}
            }
        } else {
            if (level === 'WARN') {
                console.warn(`[${level}]`, message, ...args);
            } else {
                console.log(`[${level}]`, message, ...args);
            }
        }
        
        // Escreve no arquivo
        this.writeToFile(level, message, ...args);
    }

    info(message, ...args) {
        this.log('INFO', message, ...args);
    }

    error(message, ...args) {
        this.log('ERROR', message, ...args);
    }

    /** Erro só em arquivo/console — não dispara Discord (ex.: falha recuperável ao listar grupos). */
    errorLocal(message, ...args) {
        this.log('ERROR', message, ...args, { __noDiscord: true });
    }

    warn(message, ...args) {
        this.log('WARN', message, ...args);
    }

    debug(message, ...args) {
        this.log('DEBUG', message, ...args);
    }
}

export default new Logger();
