/**
 * Dados iniciais da plataforma (1ª carga no SQLite).
 */

import chatDB from '../db/database.js';
import { PASTORAL_AGENT_PROMPT } from './agentPrompts.js';
import { BRANDING } from './branding.js';
import { ensureEcommerceFollowUps } from './ecommerceFollowUps.js';

const SEED_FOLLOWUPS = [
    {
        id: 'fu_1',
        name: 'Boas-vindas novos membros',
        active: true,
        trigger: 'Novo membro no grupo',
        steps: [
            { id: 's1', type: 'wait', label: 'Esperar 5 min', config: { minutes: '5' } },
            { id: 's2', type: 'message', label: 'Mensagem boas-vindas', config: { text: 'Olá {{name}}! Seja bem-vindo(a) ❤️' } },
        ],
        createdAt: Date.now() - 86400000 * 3,
    },
];

const SEED_AGENTS = [
    {
        id: 'ag_1',
        name: 'Assistente Pastoral',
        description: 'Tom acolhedor para dúvidas sobre cultos e ministério.',
        type: 'Atendimento',
        active: true,
        prompt: PASTORAL_AGENT_PROMPT,
        audio: true,
        files: false,
        connection: 'WhatsApp Web',
        createdAt: Date.now() - 86400000 * 5,
    },
];

const SEED_FLOWS = [
    {
        id: 'fl_1',
        name: 'Atendimento automático',
        active: false,
        trigger: 'Qualquer mensagem',
        triggerConfig: { connection: '' },
        blocks: [{ id: 'b1', type: 'ai', label: 'Agente de IA', config: { agentId: '' } }],
        createdAt: Date.now() - 86400000 * 2,
    },
    {
        id: 'fl_woo_pos',
        name: 'Woo — Confirmação de pedido',
        active: true,
        trigger: 'Webhook WooCommerce',
        triggerConfig: { event: 'order.created' },
        blocks: [{
            id: 'b1',
            type: 'message',
            label: 'Confirmação',
            config: { text: `Olá {{nome}}! Recebemos seu pedido #{{numero}}. Obrigada pela compra na ${BRANDING.storeName}!` },
        }],
        createdAt: Date.now() - 86400000,
    },
    {
        id: 'fl_woo_cart',
        name: 'Woo — Carrinho abandonado',
        active: true,
        trigger: 'Webhook WooCommerce',
        triggerConfig: { event: 'cart.abandoned' },
        blocks: [
            { id: 'b1', type: 'delay', label: 'Esperar 1h', config: { minutes: '60' } },
            { id: 'b2', type: 'message', label: 'Recuperação', config: { text: 'Oi {{nome}}! Vi que você deixou itens no carrinho. Posso ajudar com o pedido?' } },
        ],
        createdAt: Date.now() - 86400000,
    },
    {
        id: 'fl_bling_env',
        name: 'Bling — Pedido enviado',
        active: true,
        trigger: 'Webhook Bling',
        triggerConfig: { status: 'Enviado' },
        blocks: [{ id: 'b1', type: 'message', label: 'Rastreio', config: { text: 'Pedido #{{numero}} enviado! Rastreio: {{rastreio}}' } }],
        createdAt: Date.now() - 86400000,
    },
];

const SEED_CONTACTS = [
    { id: 'c1', name: 'Maria Silva', phone: '+55 62 99999-1001', tags: ['grupo-goiania'], lastSeen: Date.now() - 3600000 },
    { id: 'c2', name: 'João Pastor', phone: '+55 62 99999-1002', tags: ['adm'], lastSeen: Date.now() - 7200000 },
    { id: 'c3', name: 'Ana Compras', phone: '+55 11 98888-2003', tags: ['loja', 'vip'], lastSeen: Date.now() - 86400000 },
];

const SEED_CONVERSATIONS = [
    { id: 'cv1', contactName: 'Maria Silva', phone: '+55 62 99999-1001', lastMessage: 'Qual horário do culto de amanhã?', unread: 2, status: 'open', updatedAt: Date.now() - 600000 },
    { id: 'cv2', contactName: 'Ana Compras', phone: '+55 11 98888-2003', lastMessage: 'Tem o colar Mezuzah disponível?', unread: 0, status: 'pending', updatedAt: Date.now() - 3600000 },
];

const SEED_DEALS = [
    { id: 'd1', title: 'Combo Florescer', contactName: 'Ana Compras', stage: 'proposal', value: 349, updatedAt: Date.now() - 3600000 },
    { id: 'd2', title: 'Pedido oração', contactName: 'Maria Silva', stage: 'lead', value: 0, updatedAt: Date.now() - 7200000 },
];

const SEED_CAMPAIGNS = [
    { id: 'cp1', name: 'Palavra do Dia — Junho', status: 'running', sent: 28, total: 33, scheduledAt: null },
    { id: 'cp2', name: 'Lançamento coleção', status: 'scheduled', sent: 0, total: 12, scheduledAt: Date.now() + 86400000 * 2 },
];

const SEED_INTEGRATION_EVENTS = [
    {
        source: 'woocommerce',
        eventType: 'order.completed',
        summary: 'Pedido #4821 — Combo Florescer R$ 349',
        customer: 'Ana Compras',
        phone: '+55 11 98888-2003',
        status: 'processed',
        whatsappPreview: 'Olá Ana! Seu pedido #4821 foi confirmado. Em breve você recebe o rastreio.',
        ts: Date.now() - 3600000,
    },
    {
        source: 'bling',
        eventType: 'pedido.enviado',
        summary: 'NF 12847 — Colar Mezuzah',
        customer: 'Patricia L.',
        phone: '+55 62 97777-3004',
        status: 'processed',
        whatsappPreview: 'Pedido enviado! Rastreio: BR123456789BR',
        ts: Date.now() - 7200000,
    },
];

function seedEntities(type, items) {
    if (chatDB.listPlatformEntities(type).length > 0) return;
    items.forEach((item) => chatDB.savePlatformEntity(type, item));
}

function upgradeWeakAgentPrompts() {
    const weakPattern = /^(assistente pastoral|você é .+, assistente|faq sobre)/i;
    chatDB.listPlatformEntities('agents').forEach((ag) => {
        const p = String(ag.prompt || '').trim();
        const weak = !p || p.length < 120 || weakPattern.test(p);
        if (!weak) return;
        const prompt = ag.type === 'Vendas'
            ? undefined
            : ag.type === 'FAQ'
                ? undefined
                : PASTORAL_AGENT_PROMPT;
        if (prompt) chatDB.savePlatformEntity('agents', { ...ag, prompt });
    });
}

export function ensurePlatformSeeds() {
    seedEntities('followups', SEED_FOLLOWUPS);
    ensureEcommerceFollowUps();
    seedEntities('agents', SEED_AGENTS);
    upgradeWeakAgentPrompts();
    seedEntities('flows', SEED_FLOWS);
    seedEntities('contacts', SEED_CONTACTS);
    seedEntities('conversations', SEED_CONVERSATIONS);
    seedEntities('deals', SEED_DEALS);
    seedEntities('campaigns', SEED_CAMPAIGNS);

    const events = chatDB.listIntegrationEvents({ limit: 1 });
    if (events.length === 0) {
        SEED_INTEGRATION_EVENTS.forEach((ev) => chatDB.addIntegrationEvent(ev));
    }
}

export default { ensurePlatformSeeds };
