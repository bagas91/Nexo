/**
 * Motor de Fluxos (MVP) — gatilho por palavra-chave / qualquer mensagem / novo contato.
 * Reusa followup_runs + advanceRun do followUpEngine (message, wait, tag, webhook, human).
 */

import chatDB from '../db/database.js';
import logger from '../utils/logger.js';
import { enrollFollowUp, hasActiveFollowUpRun } from './followUpEngine.js';

function linearizeFlow(flow) {
    const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
    const edges = Array.isArray(flow?.edges) ? flow.edges : [];
    if (!nodes.length) {
        return Array.isArray(flow?.blocks) ? flow.blocks : [];
    }
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const out = [];
    let cur = nodes.find((n) => n.data?.blockType === 'trigger') || null;
    const visited = new Set();
    while (cur && !visited.has(cur.id)) {
        visited.add(cur.id);
        const kind = cur.data?.blockType;
        if (kind && kind !== 'trigger' && kind !== 'end') {
            out.push({
                id: cur.id,
                type: kind,
                label: cur.data?.label || kind,
                config: { ...(cur.data?.config || {}) },
            });
        }
        if (kind === 'end') break;
        const edge = edges.find((e) => e.source === cur.id);
        cur = edge ? byId[edge.target] : null;
    }
    return out.length ? out : (Array.isArray(flow?.blocks) ? flow.blocks : []);
}

function blockToStep(block) {
    const type = String(block?.type || '');
    const cfg = block?.config || {};
    if (type === 'message') {
        const text = String(cfg.text || '').trim();
        if (!text) return null;
        return { type: 'message', config: { text } };
    }
    if (type === 'delay') {
        const seconds = Number(cfg.seconds);
        const minutes = Number(cfg.minutes);
        if (Number.isFinite(seconds) && seconds > 0) {
            return { type: 'wait', config: { seconds } };
        }
        return { type: 'wait', config: { minutes: Math.max(1, minutes || 1) } };
    }
    if (type === 'tag') {
        const tag = String(cfg.tag || cfg.text || '').trim();
        if (!tag) return null;
        return { type: 'tag', config: { tag } };
    }
    if (type === 'webhook') {
        const url = String(cfg.url || '').trim();
        if (!url) return null;
        return { type: 'webhook', config: { url } };
    }
    if (type === 'human') {
        return { type: 'human', config: { message: cfg.text || cfg.message || '' } };
    }
    // MVP: ignora ai / audio / condition (ainda não suportados)
    return null;
}

/** Converte fluxo do canvas em “follow-up” executável. */
export function flowToExecutable(flow) {
    const steps = linearizeFlow(flow).map(blockToStep).filter(Boolean);
    return {
        id: flow.id,
        name: flow.name || flow.id,
        active: !!flow.active,
        steps,
        _source: 'flow',
    };
}

function extractKeyword(flow) {
    const cfg = flow.triggerConfig || {};
    if (cfg.keyword) return String(cfg.keyword).trim().toLowerCase();
    const t = String(flow.trigger || '');
    const m = t.match(/palavra[- ]?chave[:\s]+(.+)/i)
        || t.match(/keyword[:\s]+(.+)/i)
        || t.match(/cont[eé]m[:\s]+(.+)/i);
    if (m) return m[1].trim().toLowerCase();
    return '';
}

export function matchesFlowTrigger(flow, { body, isNewContact }) {
    if (!flow?.active) return false;
    const t = String(flow.trigger || '').trim().toLowerCase();
    const cfgTrigger = String(flow.triggerConfig?.trigger || '').trim().toLowerCase();
    const label = t || cfgTrigger;

    if (label.includes('novo contato')) {
        return isNewContact === true;
    }

    const kw = extractKeyword(flow);
    if (label.includes('palavra') || label.includes('keyword') || label.startsWith('contém') || label.startsWith('contem') || kw) {
        if (!kw) return false;
        return String(body || '').toLowerCase().includes(kw);
    }

    if (label.includes('qualquer') || label.includes('toda mensagem') || !label) {
        return String(body || '').trim().length > 0;
    }

    // fallback: trigger literal como substring
    if (label.length >= 3) {
        return String(body || '').toLowerCase().includes(label);
    }
    return false;
}

export async function handleInboundMessageForFlows({ chatId, phone, contactName, body, isNewContact }) {
    const resolvedChatId = String(chatId || '').trim();
    if (!resolvedChatId) return;

    if (hasActiveFollowUpRun(resolvedChatId)) {
        return;
    }

    const flows = chatDB.listPlatformEntities('flows') || [];
    const active = flows.filter((f) => f?.active);
    if (!active.length) return;

    for (const flow of active) {
        if (!matchesFlowTrigger(flow, { body, isNewContact })) continue;
        const executable = flowToExecutable(flow);
        if (!executable.steps.length) {
            logger.warn(`Fluxo "${flow.name}": ativo mas sem passos executáveis (configure mensagem/espera/tag)`);
            continue;
        }
        try {
            const run = await enrollFollowUp(executable, {
                chatId: resolvedChatId,
                phone,
                contactName,
                context: { source: 'flow', flowId: flow.id },
            });
            if (run) {
                logger.info(`Fluxo: iniciado — ${flow.name}`, {
                    chatId: resolvedChatId.slice(0, 16),
                    steps: executable.steps.length,
                });
                return;
            }
        } catch (err) {
            logger.warn(`Fluxo: falha ao iniciar "${flow.name}"`, err?.message || err);
        }
    }
}

export default {
    flowToExecutable,
    matchesFlowTrigger,
    handleInboundMessageForFlows,
    linearizeFlow,
};
