/**
 * Valores padrão da plataforma (integrações, CSAT, etc.) — persistidos no SQLite na 1ª carga.
 */

import chatDB from '../db/database.js';
import { BRANDING } from './branding.js';

const DEFAULT_INTEGRATIONS = [
    { id: 'woocommerce', connected: false },
    { id: 'bling', connected: false },
    { id: 'calendar', connected: false },
    { id: 'meta-ads', connected: false },
    { id: 'google-ads', connected: false },
    { id: 'discord', connected: true, connectedAt: Date.now() - 86400000 * 30 },
];

const DEFAULT_WOO = {
    connected: false,
    storeUrl: BRANDING.storeUrl,
    consumerKey: '',
    consumerSecret: '',
    syncOrders: true,
    events: {
        'order.created': true,
        'order.processing': true,
        'order.completed': true,
        'order.shipped': false,
        'cart.abandoned': true,
    },
    eventMessages: {
        'order.created': 'Olá {{nome}}! Recebemos seu pedido #{{numero}}{{total}}. Obrigado pela compra! 🛍️',
        'order.processing': 'Olá {{nome}}! Pagamento do pedido #{{numero}} confirmado. Estamos preparando seu envio. ✅',
        'order.completed': 'Olá {{nome}}! Seu pedido #{{numero}} foi concluído. Qualquer dúvida, estamos aqui! 🎉',
        'order.shipped': 'Olá {{nome}}! Pedido #{{numero}} enviado{{rastreio}}. 📦',
        'cart.abandoned': 'Olá {{nome}}! Vi que você deixou itens no carrinho. Posso ajudar a finalizar? 🛒',
    },
};

const DEFAULT_BLING = {
    connected: false,
    apiKey: '',
    syncProducts: true,
    syncOrders: true,
    notifyNfe: true,
    notifyLowStock: false,
    statusMap: [
        { blingStatus: 'Em aberto', message: 'Olá {{nome}}! Pedido #{{numero}} recebido:\n{{produtos}}\nTotal: {{total}}. Estamos preparando.', active: true },
        { blingStatus: 'Atendido', message: 'Olá {{nome}}! Seu pedido #{{numero}} ({{primeiro_produto}}) foi separado e embalado.', active: true },
        { blingStatus: 'Enviado', message: 'Olá {{nome}}! Pedido #{{numero}} — {{produtos}} — enviado!\nRastreio: {{rastreio}}', active: true },
        { blingStatus: 'Entregue', message: `Olá {{nome}}! Pedido #{{numero}} ({{primeiro_produto}}) entregue! Obrigada pela compra na ${BRANDING.storeName}.`, active: true },
        { blingStatus: 'NF-e autorizada', message: 'Olá {{nome}}! NF-e emitida para o pedido #{{numero}} — {{produtos}}.', active: false },
    ],
};

const DEFAULT_CSAT = {
    active: false,
    message: 'Como foi seu atendimento? Responda de 1 a 5 ⭐',
};

const DEFAULT_ATTENDANCE = {
    enabled: true,
    defaultAgentId: 'ag_1',
    provider: null,
    replyDelayMs: 2000,
    maxHistoryMessages: 14,
    humanKeywords: ['humano', 'atendente', 'pessoa', 'falar com alguém', 'falar com alguem'],
    handoffMessage: 'Entendi! Um atendente humano vai assumir em breve. Obrigada pela paciência! 🙏',
    outsideHoursMessage: 'Olá! Nosso atendimento automático está disponível das 8h às 22h. Deixe sua mensagem que retornamos em breve. 🙏',
    businessHours: {
        enabled: false,
        start: '08:00',
        end: '22:00',
        timezone: 'America/Sao_Paulo',
    },
    /** Menu inicial estilo venda assistida (primeiro contato). */
    welcomeMenuEnabled: true,
    welcomeMenuMessage: `Olá! Aqui é a assistente virtual da loja 💍✨

Como posso te ajudar? Responda com o número ou palavra-chave:

1 — Produto de uma publicação ou do site 📱
2 — Ver semijoias e alianças 💍
3 — Meu pedido / rastreio 🛒
4 — Falar com um atendente 👤`,
    idleHumanAlertEnabled: true,
    idleHumanAlertMinutes: 5,
    idleHumanNotifyCustomer: true,
    idleHumanCustomerMessage:
        'Desculpe a demora! Já chamei um atendente humano para te ajudar. Em instantes alguém assume por aqui. 🙏',
};

export function getAttendanceConfig() {
    ensurePlatformDefaults();
    const stored = chatDB.getPlatformKv('attendance') || {};
    return {
        ...DEFAULT_ATTENDANCE,
        ...stored,
        businessHours: {
            ...DEFAULT_ATTENDANCE.businessHours,
            ...(stored.businessHours || {}),
        },
        humanKeywords: Array.isArray(stored.humanKeywords)
            ? stored.humanKeywords
            : DEFAULT_ATTENDANCE.humanKeywords,
        welcomeMenuEnabled: stored.welcomeMenuEnabled !== undefined
            ? !!stored.welcomeMenuEnabled
            : DEFAULT_ATTENDANCE.welcomeMenuEnabled,
        welcomeMenuMessage: stored.welcomeMenuMessage || DEFAULT_ATTENDANCE.welcomeMenuMessage,
    };
}

/** Garante WooCommerce de volta na lista (foi retirado quando a loja era só vitrine). */
export function restoreWooCommerceIntegration() {
    const meta = chatDB.getPlatformKv('platform_meta') || {};
    const integrations = chatDB.getPlatformKv('integrations') || [];
    const hasWoo = integrations.some((i) => i.id === 'woocommerce');
    if (!hasWoo) {
        chatDB.setPlatformKv('integrations', [{ id: 'woocommerce', connected: false }, ...integrations]);
    }

    const woo = chatDB.getPlatformKv('woocommerce');
    if (woo?.retired) {
        const { retired, ...rest } = woo;
        chatDB.setPlatformKv('woocommerce', { ...rest, retired: false });
    } else if (!woo) {
        chatDB.setPlatformKv('woocommerce', DEFAULT_WOO);
    }

    if (meta.wooRetired) {
        const { wooRetired, ...rest } = meta;
        chatDB.setPlatformKv('platform_meta', { ...rest, wooRestored: Date.now() });
    }
}

export function ensurePlatformDefaults() {
    if (!chatDB.getPlatformKv('integrations')) {
        chatDB.setPlatformKv('integrations', DEFAULT_INTEGRATIONS);
    }
    restoreWooCommerceIntegration();
    if (!chatDB.getPlatformKv('woocommerce')) {
        chatDB.setPlatformKv('woocommerce', DEFAULT_WOO);
    }
    if (!chatDB.getPlatformKv('bling')) {
        chatDB.setPlatformKv('bling', DEFAULT_BLING);
    }
    if (!chatDB.getPlatformKv('csat')) {
        chatDB.setPlatformKv('csat', DEFAULT_CSAT);
    }
    if (!chatDB.getPlatformKv('attendance')) {
        chatDB.setPlatformKv('attendance', DEFAULT_ATTENDANCE);
    }
    if (!chatDB.getPlatformKv('webhook_secret')) {
        chatDB.setPlatformKv('webhook_secret', {
            token: `nx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`,
        });
    }
}

export function getWebhookSecret() {
    ensurePlatformDefaults();
    return chatDB.getPlatformKv('webhook_secret')?.token || '';
}

export default { ensurePlatformDefaults, getWebhookSecret, getAttendanceConfig };
