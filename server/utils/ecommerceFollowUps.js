/**
 * Modelos prontos de Follow Up para e-commerce (Bling).
 */

import chatDB from '../db/database.js';
import { BRANDING } from './branding.js';

const store = BRANDING.storeName;

export const ECOMMERCE_FOLLOWUPS = [
    {
        id: 'fu_ecom_confirm',
        name: 'E-commerce — Confirmação de pedido',
        active: false,
        trigger: 'Pedido criado (Bling)',
        steps: [
            {
                id: 's1',
                type: 'message',
                label: 'Confirmação imediata',
                config: {
                    text: `Olá {{name}}! 🛍️ Recebemos seu pedido #{{numero}}:\n{{produtos}}\nTotal: {{total}}. Em breve você recebe a confirmação de pagamento por aqui.`,
                },
            },
            { id: 's2', type: 'tag', label: 'Tag cliente', config: { tag: 'cliente-loja' } },
            { id: 's3', type: 'wait', label: 'Esperar 1h', config: { minutes: '60' } },
            {
                id: 's4',
                type: 'message',
                label: 'Suporte pós-compra',
                config: {
                    text: 'Qualquer dúvida sobre pagamento, prazo ou entrega, é só responder esta mensagem. Estamos aqui para ajudar!',
                },
            },
        ],
        createdAt: Date.now(),
    },
    {
        id: 'fu_ecom_cart',
        name: 'E-commerce — Carrinho abandonado',
        active: false,
        trigger: 'Carrinho (desativado)',
        steps: [
            { id: 's1', type: 'wait', label: 'Esperar 30 min', config: { minutes: '30' } },
            {
                id: 's2',
                type: 'message',
                label: 'Recuperação suave',
                config: {
                    text: `Oi {{name}}! Vi que você deixou itens no carrinho na ${store}. Posso te ajudar a finalizar o pedido?`,
                },
            },
            { id: 's3', type: 'wait', label: 'Esperar 24h', config: { minutes: '1440' } },
            {
                id: 's4',
                type: 'message',
                label: 'Último lembrete',
                config: {
                    text: 'Ainda dá tempo de concluir sua compra! Responda *SIM* que te envio o link ou tiro suas dúvidas. 😊',
                },
            },
            { id: 's5', type: 'tag', label: 'Tag carrinho', config: { tag: 'carrinho-abandonado' } },
        ],
        createdAt: Date.now(),
    },
    {
        id: 'fu_ecom_post',
        name: 'E-commerce — Pós-entrega',
        active: false,
        trigger: 'Pedido entregue (Bling)',
        steps: [
            { id: 's1', type: 'wait', label: 'Esperar 24h', config: { minutes: '1440' } },
            {
                id: 's2',
                type: 'message',
                label: 'Feedback pós-entrega',
                config: {
                    text: `Oi {{name}}! Seu pedido da ${store} chegou bem? Conta pra gente como foi a experiência — sua opinião é muito importante! ⭐`,
                },
            },
            { id: 's3', type: 'tag', label: 'Tag pós-venda', config: { tag: 'pos-venda' } },
            { id: 's4', type: 'wait', label: 'Esperar 3 dias', config: { minutes: '4320' } },
            {
                id: 's5',
                type: 'message',
                label: 'Recompra',
                config: {
                    text: `Temos novidades na ${store}! Quer ver o que chegou de novo? Responda que te mando as opções.`,
                },
            },
        ],
        createdAt: Date.now(),
    },
];

/** Insere modelos e-commerce se ainda não existirem (por id fixo). */
export function ensureEcommerceFollowUps() {
    let added = 0;
    for (const fu of ECOMMERCE_FOLLOWUPS) {
        if (!chatDB.getPlatformEntity('followups', fu.id)) {
            chatDB.savePlatformEntity('followups', fu);
            added += 1;
        }
    }
    return added;
}

export default { ECOMMERCE_FOLLOWUPS, ensureEcommerceFollowUps };
