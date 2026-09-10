/**
 * CRM e-commerce + venda assistida no WhatsApp.
 * Contato, pedidos Bling e oportunidades (deals) ligados ao telefone.
 */

import chatDB from '../db/database.js';
import { fetchBlingOrdersByPhone } from './blingService.js';
import { isLikelyLidDigits, isLikelyPhoneDigits } from '../utils/phoneUtils.js';

export const CRM_STAGES = [
    { id: 'new', label: 'Novo contato' },
    { id: 'attending', label: 'Em atendimento' },
    { id: 'link_sent', label: 'Link enviado' },
    { id: 'awaiting_payment', label: 'Aguardando pagamento' },
    { id: 'paid', label: 'Pedido pago' },
    { id: 'lost', label: 'Perdido' },
];

const LEGACY_STAGE = {
    lead: 'new',
    qualified: 'attending',
    proposal: 'link_sent',
    won: 'paid',
    lost: 'lost',
};

export function normalizeDealStage(stage) {
    const s = String(stage || '').trim();
    if (LEGACY_STAGE[s]) return LEGACY_STAGE[s];
    if (CRM_STAGES.some((x) => x.id === s)) return s;
    return 'new';
}

export function phoneDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

/** Rejeita IDs internos @lid do WhatsApp (14+ dígitos) usados por engano como telefone. */
export function isUsableCrmPhone(value) {
    const d = phoneDigits(value);
    if (d.length < 10 || d.length > 13) return false;
    if (d.startsWith('55')) return d.length === 12 || d.length === 13;
    return true;
}

function phonesMatch(a, b) {
    const x = phoneDigits(a);
    const y = phoneDigits(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const sx = x.length >= 11 ? x.slice(-11) : x.slice(-10);
    const sy = y.length >= 11 ? y.slice(-11) : y.slice(-10);
    return sx.length >= 10 && sx === sy;
}

export function findContactByPhone(phone) {
    const digits = phoneDigits(phone);
    if (digits.length < 10) return null;
    return chatDB.listPlatformEntities('contacts').find((c) => phonesMatch(c.phone, digits)) || null;
}

export function upsertCrmContact({
    phone,
    name,
    tags,
    notes,
    source,
    needsHelp,
} = {}) {
    const digits = phoneDigits(phone);
    if (!isLikelyPhoneDigits(digits) || isLikelyLidDigits(digits)) {
        throw new Error('Telefone WhatsApp ainda não disponível (ID interno). Aguarde nova mensagem ou atualize.');
    }

    const existing = findContactByPhone(digits);
    const nextTags = Array.isArray(tags)
        ? [...new Set(tags.map((t) => String(t || '').trim()).filter(Boolean))]
        : existing?.tags || ['whatsapp'];

    if (!nextTags.includes('whatsapp')) nextTags.unshift('whatsapp');

    const contact = {
        id: existing?.id || `c_${digits}`,
        name: String(name || existing?.name || digits).trim() || digits,
        phone: digits,
        tags: nextTags,
        lastSeen: Date.now(),
        notes: notes !== undefined ? String(notes || '') : (existing?.notes || ''),
        source: source !== undefined ? String(source || '') : (existing?.source || 'whatsapp'),
        needsHelp: needsHelp !== undefined ? !!needsHelp : !!existing?.needsHelp,
    };
    return chatDB.savePlatformEntity('contacts', contact);
}

export function getCrmProfile(phone, { name } = {}) {
    const digits = phoneDigits(phone);
    const phoneOk = isLikelyPhoneDigits(digits) && !isLikelyLidDigits(digits);
    let contact = phoneOk ? findContactByPhone(digits) : null;
    if (!contact && phoneOk) {
        contact = upsertCrmContact({
            phone: digits,
            name: name || digits,
            tags: ['whatsapp'],
            source: 'whatsapp',
        });
    }
    if (!contact) {
        contact = {
            id: phoneOk ? `c_${digits}` : `c_pending`,
            name: String(name || '').trim() || (phoneOk ? digits : 'Cliente WhatsApp'),
            phone: phoneOk ? digits : '',
            tags: ['whatsapp'],
            notes: '',
            source: 'whatsapp',
            needsHelp: false,
            phoneUnresolved: !phoneOk,
        };
    }
    const deals = phoneOk ? listDealsByPhone(digits) : [];
    return { contact, deals, phoneUnresolved: !phoneOk };
}

export function listDealsByPhone(phone) {
    const digits = phoneDigits(phone);
    return chatDB.listPlatformEntities('deals')
        .map((d) => ({ ...d, stage: normalizeDealStage(d.stage) }))
        .filter((d) => phonesMatch(d.phone, digits) || (!d.phone && false))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function listCrmDeals() {
    return chatDB.listPlatformEntities('deals')
        .map((d) => ({ ...d, stage: normalizeDealStage(d.stage) }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function createCrmDeal({
    title,
    contactName,
    phone,
    value = 0,
    stage = 'attending',
    source = 'whatsapp',
    conversationId,
    notes,
} = {}) {
    const digits = phoneDigits(phone);
    if (digits.length < 10) throw new Error('Telefone do cliente é obrigatório.');
    const contact = upsertCrmContact({
        phone: digits,
        name: contactName,
        source: source || 'whatsapp',
        needsHelp: true,
    });
    const now = Date.now();
    const deal = {
        id: `deal_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        title: String(title || `Venda assistida — ${contact.name}`).trim(),
        contactName: contact.name,
        phone: digits,
        contactId: contact.id,
        conversationId: conversationId ? String(conversationId) : undefined,
        stage: normalizeDealStage(stage),
        value: Number(value) || 0,
        source: source || 'whatsapp',
        notes: String(notes || ''),
        createdAt: now,
        updatedAt: now,
    };
    return chatDB.savePlatformEntity('deals', deal);
}

export function updateCrmDeal(id, patch = {}) {
    const current = chatDB.getPlatformEntity('deals', String(id || ''));
    if (!current) throw new Error('Oportunidade não encontrada.');
    const next = {
        ...current,
        ...patch,
        id: current.id,
        stage: normalizeDealStage(patch.stage || current.stage),
        value: patch.value !== undefined ? Number(patch.value) || 0 : current.value,
        updatedAt: Date.now(),
    };
    if (patch.phone) next.phone = phoneDigits(patch.phone);
    return chatDB.savePlatformEntity('deals', next);
}

export async function getOrdersForPhone(phone) {
    const digits = phoneDigits(phone);
    if (!isLikelyPhoneDigits(digits) || isLikelyLidDigits(digits)) {
        return {
            registered: false,
            contact: null,
            orders: [],
            error: 'Número do WhatsApp ainda não resolvido (LID). O Bling precisa do celular real.',
        };
    }
    try {
        const result = await fetchBlingOrdersByPhone(digits, { limit: 8 });
        return {
            registered: !!result?.registered,
            contact: result?.contact || null,
            orders: Array.isArray(result?.orders) ? result.orders : [],
            error: null,
        };
    } catch (err) {
        return {
            registered: false,
            contact: null,
            orders: [],
            error: err?.message || String(err),
        };
    }
}

export default {
    CRM_STAGES,
    normalizeDealStage,
    getCrmProfile,
    upsertCrmContact,
    listCrmDeals,
    createCrmDeal,
    updateCrmDeal,
    getOrdersForPhone,
};
