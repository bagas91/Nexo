import { BRANDING } from './branding.js';

/** Template fixo da Palavra do Dia — Nexo Dev. */

const SUPER_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

export function verseToSuperscript(verseNumber) {
    return String(verseNumber)
        .split('')
        .map((d) => SUPER_DIGITS[Number(d)] ?? d)
        .join('');
}

export function formatDateExtenso(date, timeZone = 'America/Sao_Paulo') {
    const parts = new Intl.DateTimeFormat('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone
    }).formatToParts(date);

    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    const weekday = capitalizeWords(get('weekday'));
    const day = get('day');
    const month = capitalize(get('month'));
    const year = get('year');
    return `${weekday} ${day} de ${month} de ${year}`;
}

function capitalize(value) {
    if (!value) return value;
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function capitalizeWords(value) {
    return value.split(/([\s-]+)/).map((chunk) => {
        if (/^[\s-]+$/.test(chunk)) return chunk;
        return capitalize(chunk);
    }).join('');
}

export function resolvePalavraDate({ scheduledAt } = {}) {
    const tz = 'America/Sao_Paulo';
    if (scheduledAt) {
        const parsed = new Date(scheduledAt);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }

    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: tz
    }).format(now));

    // Após 18h, assume preparação para o disparo da meia-noite (dia seguinte).
    if (hour >= 18) {
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        return tomorrow;
    }
    return now;
}

export function getPalavraDoDiaDefaults() {
    return {
        linkPalavra: process.env.PDD_LINK_PALAVRA || 'https://youtu.be/fAY3SsWO394',
        linkMinisterio: process.env.PDD_LINK_MINISTERIO || process.env.PDD_LINK_VIRGINIA || 'https://youtu.be/HplnvYBErP8',
        linkMusica: process.env.PDD_LINK_MUSICA || 'https://youtu.be/example',
        linkCulto: process.env.PDD_LINK_CULTO || 'https://www.youtube.com/live/Nh_8r-ZtRuk?si=i5y6f2DFKiR2fEey',
        cultoTexto: process.env.PDD_CULTO_TEXTO || ''
    };
}

/** Monta a mensagem completa no padrão Nexo. */
export function renderPalavraDoDia({
    dataExtenso,
    verseNumber,
    verseText,
    referenceFormatted,
    prayerTitle,
    prayer,
    links = getPalavraDoDiaDefaults()
}) {
    const superscript = verseToSuperscript(verseNumber);
    const cultoBlock = links.cultoTexto
        ? `📢 Não perca nosso culto online!\n🗓️ ${links.cultoTexto}\n▶️ ${links.linkCulto}`
        : `📢 Não perca nosso culto online!\n▶️ ${links.linkCulto}`;

    return [
        '✨ A PALAVRA DO DIA',
        `🗓️${dataExtenso}`,
        '',
        `${superscript} ${verseText}`,
        `📚 ${referenceFormatted}`,
        '',
        `🙌📖 ${prayerTitle} 📖🙌`,
        '',
        prayer.trim(),
        '',
        `📡 Palavra do Dia: ${links.linkPalavra}`,
        `🎶 ${BRANDING.productName}: ${links.linkMinisterio}`,
        `💿 Ouça agora: ${links.linkMusica}`,
        '',
        cultoBlock,
        '',
        '🐣 Mim ❤️ Você ❤️',
        `✍️ ${BRANDING.tenantName}`
    ].join('\n');
}

export default {
    verseToSuperscript,
    formatDateExtenso,
    resolvePalavraDate,
    getPalavraDoDiaDefaults,
    renderPalavraDoDia
};
