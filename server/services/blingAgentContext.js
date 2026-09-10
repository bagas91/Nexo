/**
 * Contexto Bling para o agente de atendimento (pedidos, rastreio, cadastro).
 */

import { getBlingAccessToken } from './blingService.js';

export function parseMenuIntent(text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    if (/^[1]$|publica|publicação|publicacao|instagram|link da post/i.test(t)) {
        return { id: 'product', label: 'produto do site/publicação' };
    }
    if (/^[2]$|semijoia|aliança|alianca|ver model|catálogo|catalogo|loja virtual/i.test(t)) {
        return { id: 'catalog', label: 'ver produtos da loja' };
    }
    if (/^[3]$|pedido|rastreio|rastrear|acompanhar|entrega|envio|correios/i.test(t)) {
        return { id: 'order', label: 'pedido ou rastreio' };
    }
    if (/^[4]$|humano|atendente|pessoa|falar com/i.test(t)) {
        return { id: 'human', label: 'falar com atendente' };
    }
    return null;
}

/** Bloco de texto para injetar no system prompt do agente. */
export function formatBlingContextForAgent(result, opts = {}) {
    const maxOrders = Math.min(Number(opts.maxOrders) || 2, 4);
    const trim = (s, n = 72) => {
        const t = String(s || '').trim();
        return t.length > n ? `${t.slice(0, n - 1)}…` : t;
    };
    const blingOk = getBlingAccessToken();
    if (!blingOk) {
        return 'BLING (ERP): não conectado neste momento — não invente pedido nem rastreio.';
    }
    if (!result) {
        return 'BLING (ERP): sem dados do cliente nesta conversa.';
    }
    if (result.error) {
        return `BLING (ERP): consulta indisponível (${result.error}). Peça nº do pedido ou encaminhe com "humano".`;
    }
    if (!result.registered) {
        return 'BLING (ERP): telefone SEM cadastro de cliente. Se pedirem pedido/rastreio, peça CPF ou nº do pedido ou encaminhe humano.';
    }

    const name = result.contact?.name || 'Cliente';
    const lines = [`BLING (ERP): cliente CADASTRADO — ${name}.`];

    const orders = Array.isArray(result.orders) ? result.orders : [];
    if (!orders.length) {
        lines.push('Pedidos recentes: nenhum neste telefone.');
        lines.push('Se perguntarem de compra anterior, peça nº do pedido ou encaminhe humano.');
        return lines.join('\n');
    }

    lines.push('Pedidos recentes (use SOMENTE estes dados — não invente):');
    for (const [i, o] of orders.slice(0, maxOrders).entries()) {
        const parts = [
            `#${o.numero || o.orderId}`,
            o.status || 'status —',
            trim(o.produtos, 60),
            o.total ? `total ${o.total}` : '',
        ].filter(Boolean);
        let line = `${i + 1}. ${parts.join(' | ')}`;
        if (o.rastreio) line += `\n   Rastreio: ${o.rastreio}`;
        else if (/envi|transit|transport|postad|despach/i.test(String(o.status || ''))) {
            line += '\n   Rastreio: ainda não disponível no sistema — peça nº do pedido ou humano.';
        }
        lines.push(line);
    }

    const latest = orders[0];
    if (latest?.rastreio) {
        lines.push(`Resumo: pedido #${latest.numero} — rastreio ${latest.rastreio}. Pode informar ao cliente.`);
    }

    lines.push('Regras: cite rastreio só se estiver acima. Resposta curta (máx. 2 parágrafos). Nunca invente código de rastreio ou status.');
    return lines.join('\n');
}

export default { parseMenuIntent, formatBlingContextForAgent };
