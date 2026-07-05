/**
 * Relatório automático ao final de cada envio em massa.
 * Destinos: Discord (webhook) e/ou WhatsApp (número configurável).
 *
 * Env:
 *   NOTIFY_BULK_REPORT=1          (default: ligado se houver Discord ou WhatsApp)
 *   BULK_REPORT_WHATSAPP_NUMBER=  (opcional; fallback: ALERT_WHATSAPP_NUMBER)
 *   DISCORD_WEBHOOK_URL=
 */

import { BRANDING } from './branding.js';

const SYSTEM_NAME = BRANDING.systemName;
const MAX_DISCORD_DESC = 1900;
const MAX_WA_CHARS = 3900;
const MAX_FAIL_LINES = 25;

export function isBulkReportEnabled() {
    if (process.env.NOTIFY_BULK_REPORT === '0' || process.env.NOTIFY_BULK_REPORT === 'false') {
        return false;
    }
    return !!(process.env.DISCORD_WEBHOOK_URL || getReportWhatsAppNumber());
}

export function getReportWhatsAppNumber() {
    const raw = process.env.BULK_REPORT_WHATSAPP_NUMBER || process.env.ALERT_WHATSAPP_NUMBER || '';
    const digits = String(raw).replace(/\D/g, '');
    return digits || null;
}

/** Remove caracteres que quebram markdown do WhatsApp em textos dinâmicos. */
function waSafe(text) {
    return String(text || '').replace(/[*_~`]/g, '').trim() || '—';
}

function summarizeError(err) {
    if (!err) return '—';
    const line = String(err).split('\n')[0];
    const safe = waSafe(line.length > 150 ? line.slice(0, 150) + '…' : line);
    return safe;
}

function formatFinishedDate(finishedAt) {
    if (!finishedAt) {
        return new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
    }
    return new Date(finishedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
}

function statusHeader(results) {
    if (results.cancelled) return '⏹️ *DISPARO CANCELADO*';
    if (results.failed === 0) return '✅ *DISPARO CONCLUÍDO*';
    if (results.sent === 0) return '❌ *DISPARO FALHOU*';
    return '⚠️ *DISPARO PARCIAL*';
}

/**
 * @param {{ sent: number, failed: number, errors?: Array<{ chatName: string, chatId: string, error: string }>, cancelled?: boolean }} results
 * @param {{ sourceLabel?: string, source?: string, scheduleId?: string }} meta
 */
export function buildBulkSendReportWhatsAppText({ results, meta = {}, startedAt, finishedAt, attachmentNames = [] }) {
    const total = results.sent + results.failed;
    const durationSec = startedAt && finishedAt
        ? ((finishedAt - startedAt) / 1000).toFixed(1)
        : '—';
    const finishedDate = formatFinishedDate(finishedAt);
    const sourceLabel = waSafe(meta.sourceLabel || 'Envio em massa');

    const lines = [
        statusHeader(results),
        '',
        `🏷 *Sistema:* ${waSafe(SYSTEM_NAME)}`,
        `📅 *Horário:* ${finishedDate}`,
        `📂 *Tipo:* ${sourceLabel}`,
        '',
        '━━━━━━━━━━━━━━━━',
        '📊 *Resumo*',
        `├ ✅ Enviados: *${results.sent}*`,
        `├ ❌ Falhas: *${results.failed}*`,
        `├ 📦 Total: *${total}*`,
        `└ ⏱ Duração: *${durationSec}s*`,
        '━━━━━━━━━━━━━━━━'
    ];

    if (attachmentNames.length > 0) {
        lines.push('', '📎 *Anexos*');
        for (const name of attachmentNames) {
            lines.push(`• ${waSafe(name)}`);
        }
    }

    if (meta.scheduleId) {
        lines.push('', `🗓 *Agendamento:* \`${waSafe(meta.scheduleId)}\``);
    }

    if (results.cancelled) {
        lines.push('', '⚠️ _Envio interrompido pelo usuário._');
    }

    if (results.failed === 0 && !results.cancelled) {
        lines.push('', '🎉 _Todos os destinos receberam o conteúdo._');
    } else if (results.failed > 0) {
        const firstError = summarizeError(results.errors?.[0]?.error);
        lines.push(
            '',
            '⚠️ *Erro principal*',
            `_${firstError}_`,
            '',
            `❌ *Grupos com falha* (${results.failed})`
        );
        const errors = results.errors || [];
        for (let i = 0; i < Math.min(errors.length, MAX_FAIL_LINES); i++) {
            const e = errors[i];
            lines.push(`• ${waSafe(e.chatName || e.chatId)}`);
        }
        if (errors.length > MAX_FAIL_LINES) {
            lines.push(`_… e mais ${errors.length - MAX_FAIL_LINES} destino(s)._`);
        }
    }

    lines.push('', `_${waSafe(SYSTEM_NAME)}_`);
    return lines.join('\n').slice(0, MAX_WA_CHARS);
}

/** Texto plano para Discord (embed). */
export function buildBulkSendReportText(params) {
    const wa = buildBulkSendReportWhatsAppText(params);
    return wa
        .replace(/\*([^*]+)\*/g, '**$1**')
        .replace(/_([^_]+)_/g, '*$1*')
        .replace(/`([^`]+)`/g, '`$1`');
}

function levelFromResults(results) {
    if (results.failed === 0) return 'info';
    if (results.sent === 0) return 'error';
    return 'warn';
}

function sendDiscordReport(text, level) {
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url) return;

    const levelUpper = level.toUpperCase();
    const color = levelUpper === 'ERROR' ? 0xff0000 : levelUpper === 'WARN' ? 0xffa500 : 0x2ecc71;
    const description = `**Sistema:** ${SYSTEM_NAME}\n\n${text}`.slice(0, MAX_DISCORD_DESC);

    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            embeds: [{
                title: `📋 Relatório de disparo — ${SYSTEM_NAME}`,
                description,
                timestamp: new Date().toISOString(),
                color,
                footer: { text: SYSTEM_NAME }
            }]
        })
    }).catch((e) => {
        console.warn('[bulkSendReport] Falha ao enviar Discord:', e?.message || e);
    });
}

let whatsAppReportSender = null;

export function setWhatsAppReportSender(fn) {
    whatsAppReportSender = fn;
}

function sendWhatsAppReport(number, text) {
    if (!number || !whatsAppReportSender) return;
    whatsAppReportSender(number, text).catch((e) => {
        console.warn('[bulkSendReport] Falha ao enviar WhatsApp:', e?.message || e);
    });
}

/**
 * Envia relatório para Discord e/ou número WhatsApp configurado.
 */
export function notifyBulkSendReport({ results, meta, startedAt, finishedAt, attachmentNames }) {
    if (!isBulkReportEnabled()) return;

    const level = levelFromResults(results);
    const payload = { results, meta, startedAt, finishedAt, attachmentNames };

    sendDiscordReport(buildBulkSendReportText(payload), level);

    const waNumber = getReportWhatsAppNumber();
    if (waNumber) {
        sendWhatsAppReport(waNumber, buildBulkSendReportWhatsAppText(payload));
    }
}

export default {
    isBulkReportEnabled,
    getReportWhatsAppNumber,
    buildBulkSendReportText,
    buildBulkSendReportWhatsAppText,
    notifyBulkSendReport,
    setWhatsAppReportSender
};
