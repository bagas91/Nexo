/**
 * Hub WhatsApp:
 * - dispatch: Palavra do Dia / grupos / agendamentos (whatsapp-web.js)
 * - ecommerce: CRM via Cloud API Meta (sem segundo Chrome, por padrão)
 */
import {
    WhatsAppClient,
    WA_ROLES,
    WA_ROLE_META,
    resolveSessionDir,
} from './whatsappClient.js';
import { getMetaEcommerceStatus } from './metaWhatsAppService.js';

export { WA_ROLES, WA_ROLE_META, resolveSessionDir };

export const dispatchClient = new WhatsAppClient({
    role: WA_ROLES.DISPATCH,
    clientId: null,
    enableInbox: false,
    clearChatsOnQr: true,
    enableGroupSync: true,
});

/** Mantido só se META_WA_FORCE_WEB=1 (legado). Caso contrário o e-commerce é Cloud API. */
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

export function isEcommerceWebForced() {
    return process.env.META_WA_FORCE_WEB === '1' || process.env.META_WA_FORCE_WEB === 'true';
}

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
        ecommerce: isEcommerceWebForced()
            ? ecommerceClient.getStatus()
            : getMetaEcommerceStatus(),
    };
}

export async function initializeAllWhatsApp() {
    await dispatchClient.initialize();
    if (isEcommerceWebForced()) {
        await new Promise((r) => setTimeout(r, 2500));
        await ecommerceClient.initialize();
    }
}

export async function destroyAllWhatsAppGracefully() {
    const tasks = [dispatchClient.destroyGracefully?.() ?? Promise.resolve()];
    if (isEcommerceWebForced()) {
        tasks.push(ecommerceClient.destroyGracefully?.() ?? Promise.resolve());
    }
    await Promise.allSettled(tasks);
}

/** Compat: default = Disparo. */
export default dispatchClient;
