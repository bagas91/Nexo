/** Utilitários de telefone WhatsApp / Bling (BR). */

export function phoneDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

/** LID do WhatsApp costuma ter 14+ dígitos; MSISDN BR fica em 10–13. */
export function isLikelyLidDigits(value, peerJid = '') {
    const d = phoneDigits(value);
    if (!d) return false;
    if (d.length > 13) return true;
    const jid = String(peerJid || '');
    if (jid.includes('@lid')) {
        const lidUser = jid.split('@')[0].replace(/\D/g, '');
        if (lidUser && d === lidUser) return true;
    }
    return false;
}

/** Telefone BR utilizável (com ou sem 55). */
export function isLikelyPhoneDigits(value) {
    const d = phoneDigits(value);
    if (d.length < 10 || d.length > 13) return false;
    if (isLikelyLidDigits(d)) return false;
    return true;
}

export function phonesMatch(a, b) {
    const x = phoneDigits(a);
    const y = phoneDigits(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const sx = x.length >= 11 ? x.slice(-11) : x.slice(-10);
    const sy = y.length >= 11 ? y.slice(-11) : y.slice(-10);
    if (sx.length >= 10 && sx === sy) return true;
    if (sx.length === 11 && sy.length === 10 && sx.slice(0, 2) === sy.slice(0, 2) && sx.slice(3) === sy.slice(2)) {
        return true;
    }
    if (sy.length === 11 && sx.length === 10 && sy.slice(0, 2) === sx.slice(0, 2) && sy.slice(3) === sx.slice(2)) {
        return true;
    }
    return false;
}

/** Formata para exibição; LIDs não são mostrados como telefone. */
export function formatPhoneDisplay(value) {
    const d = phoneDigits(value);
    if (!d) return 'Número indisponível';
    if (isLikelyLidDigits(d)) return 'WhatsApp (número oculto)';
    let n = d;
    if (n.startsWith('55') && n.length >= 12) n = n.slice(2);
    if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
    if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
    return d;
}
