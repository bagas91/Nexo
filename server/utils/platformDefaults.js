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
    events: {
        'order.created': true,
        'order.processing': true,
        'order.completed': true,
        'order.shipped': false,
        'cart.abandoned': true,
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
        { blingStatus: 'Em aberto', message: 'Pedido {{numero}} recebido! Estamos preparando.', active: true },
        { blingStatus: 'Atendido', message: 'Seu pedido {{numero}} foi separado e embalado.', active: true },
        { blingStatus: 'Enviado', message: 'Pedido enviado! Rastreio: {{rastreio}}', active: true },
        { blingStatus: 'Entregue', message: `Pedido entregue! Obrigada pela compra na ${BRANDING.storeName}.`, active: true },
        { blingStatus: 'NF-e autorizada', message: 'Nota fiscal emitida para o pedido {{numero}}.', active: false },
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
};

export function getAttendanceConfig() {
    ensurePlatformDefaults();
    return chatDB.getPlatformKv('attendance') || DEFAULT_ATTENDANCE;
}

export function ensurePlatformDefaults() {
    if (!chatDB.getPlatformKv('integrations')) {
        chatDB.setPlatformKv('integrations', DEFAULT_INTEGRATIONS);
    }
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
