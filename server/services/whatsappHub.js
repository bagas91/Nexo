/**
 * Hub de duas sessões WhatsApp:
 * - dispatch: Palavra do Dia, grupos, agendamentos, disparos
 * - ecommerce: CRM, inbox, atendimento IA, follow-ups, pedidos
 */
import {
    WhatsAppClient,
    WA_ROLES,
    WA_ROLE_META,
    resolveSessionDir,
} from './whatsappClient.js';

export { WA_ROLES, WA_ROLE_META, resolveSessionDir };

export const dispatchClient = new WhatsAppClient({
    role: WA_ROLES.DISPATCH,
    clientId: null,
    enableInbox: false,
    clearChatsOnQr: true,
    enableGroupSync: true,
});

export const ecommerceClient = new WhatsAppClient({
    role: WA_ROLES.ECOMMERCE,
    clientId: 'ecommerce',
    enableInbox: true,
    clearChatsOnQr: false,
    enableGroupSync: false,
});

const BY_ROLE = {
    [WA_ROLES.DISPATCH]: dispatchClient,
    [WA_ROLES.ECOMMERCE]: ecommerceClient,
};

export function normalizeWaRole(value, fallback = WA_ROLES.DISPATCH) {
    const v = String(value || '').trim().toLowerCase();
    if (v === WA_ROLES.ECOMMERCE || v === 'crm' || v === 'inbox' || v === 'shop') {
        return WA_ROLES.ECOMMERCE;
    }
    if (v === WA_ROLES.DISPATCH || v === 'broadcast' || v === 'groups' || v === 'palavra') {
        return WA_ROLES.DISPATCH;
    }
    return fallback;
}

export function getWa(role, fallback = WA_ROLES.DISPATCH) {
    return BY_ROLE[normalizeWaRole(role, fallback)] || BY_ROLE[fallback];
}

export function getWaFromRequest(req, fallback = WA_ROLES.DISPATCH) {
    const q = req?.query?.role ?? req?.query?.wa;
    const b = req?.body?.role ?? req?.body?.wa;
    return getWa(q || b, fallback);
}

export function getAllWaStatuses() {
    return {
        dispatch: dispatchClient.getStatus(),
        ecommerce: ecommerceClient.getStatus(),
    };
}

export async function initializeAllWhatsApp() {
    // Disparo primeiro (sessão legada); e-commerce em seguida para não competir pelo CPU no boot.
    await dispatchClient.initialize();
    await new Promise((r) => setTimeout(r, 2500));
    await ecommerceClient.initialize();
}

export async function destroyAllWhatsAppGracefully() {
    await Promise.allSettled([
        dispatchClient.destroyGracefully?.() ?? Promise.resolve(),
        ecommerceClient.destroyGracefully?.() ?? Promise.resolve(),
    ]);
}

/** Compat: default = Disparo (comportamento antigo para quem importava o singleton). */
export default dispatchClient;
