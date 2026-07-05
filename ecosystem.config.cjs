/**
 * PM2: use "pm2 start ecosystem.config.cjs" para subir o backend.
 * O kill_timeout 30s dá tempo do graceful shutdown (backup + destroy) antes do PM2 matar o processo.
 * Assim o restart mantém a sessão do WhatsApp.
 * IMPORTANTE: instances deve ser 1. Várias instâncias causam agendamentos executados em duplicata.
 *
 * Sessão WhatsApp (opcional via env):
 *   BACKUP_RETENTION_DAYS=2     pastas session-* mais velhas que isso são removidas
 *   BACKUP_MAX_COPIES=16        teto de snapshots por pasta backup/ e backup_archive/
 *   BACKUP_MIN_INTERVAL_MS=1500000   ~25min entre cópias “automáticas” (ready/disconnect); restart/API usa force
 *   BACKUP_ARCHIVE=1            segunda cópia em backup_archive/ (dobra disco); omitir ou ≠1 para desligar
 */
module.exports = {
  apps: [
    {
      name: 'zapflow-backend',
      cwd: './server',
      script: 'server.js',
      exec_mode: 'fork',
      instances: 1,
      kill_timeout: 30000,
      wait_ready: false,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PUPPETEER_CACHE_DIR: '/root/.cache/puppeteer',
        PUPPETEER_EXECUTABLE_PATH: '/root/.cache/puppeteer/chrome/linux-145.0.7632.46/chrome-linux64/chrome',
      },
      // Prefixo data/hora em cada linha nos logs do PM2 (~/.pm2/logs e `pm2 logs`).
      // Formato moment.js: https://pm2.keymetrics.io/docs/usage/application-declaration/
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
    },
  ],
};
