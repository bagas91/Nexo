/**
 * Catálogo de módulos (ACL estilo Bling).
 * IDs compartilhados com o frontend (config/modules.ts).
 */

/** @typedef {{ id: string, label: string, group: string, groupLabel: string }} ModuleDef */

/** @type {ModuleDef[]} */
export const APP_MODULES = [
    { id: 'dashboard', label: 'Dashboard', group: 'inicio', groupLabel: 'Início' },
    { id: 'contacts', label: 'Contatos', group: 'atendimento', groupLabel: 'Atendimento' },
    // 'conversations' é restrito ao superadmin (WhatsApp pessoal conectado) — não é atribuível.
    { id: 'crm', label: 'CRM', group: 'atendimento', groupLabel: 'Atendimento' },
    { id: 'campaigns', label: 'Campanhas', group: 'atendimento', groupLabel: 'Atendimento' },
    { id: 'templates', label: 'Templates', group: 'ferramentas', groupLabel: 'Ferramentas' },
    { id: 'scheduler', label: 'Agendamentos', group: 'ferramentas', groupLabel: 'Ferramentas' },
    { id: 'groupdispatch', label: 'Disparo por grupo', group: 'ferramentas', groupLabel: 'Ferramentas' },
    { id: 'followups', label: 'Follow Ups', group: 'automacao', groupLabel: 'Automação' },
    { id: 'aiagents', label: 'Agentes de IA', group: 'automacao', groupLabel: 'Automação' },
    { id: 'flows', label: 'Fluxos', group: 'automacao', groupLabel: 'Automação' },
    { id: 'catalog', label: 'Fila Goiânia (catálogo)', group: 'loja', groupLabel: 'Loja' },
    { id: 'catalog_quality', label: 'Qualidade do Catálogo', group: 'loja', groupLabel: 'Loja' },
    { id: 'settings_atendimento', label: 'Atendimento IA', group: 'config', groupLabel: 'Configurações' },
];

/** Ainda incompletos */
export const EXPERIMENTAL_MODULES = [
    { id: 'settings_csat', label: 'Pesquisa CSAT (em breve)', group: 'config', groupLabel: 'Configurações' },
    { id: 'settings_widget', label: 'Widget site (em breve)', group: 'config', groupLabel: 'Configurações' },
];

/** Sempre disponível para o próprio usuário logado (não precisa marcar). */
export const ALWAYS_MODULES = ['settings_profile'];

export const ASSIGNABLE_MODULE_IDS = APP_MODULES.map((m) => m.id);

const ASSIGNABLE_SET = new Set(ASSIGNABLE_MODULE_IDS);

/** Views liberadas pelo módulo groupdispatch (ferramentas de disparo). */
export const GROUPDISPATCH_VIEWS = [
    'groupdispatch',
    'groups',
    'categories',
    'library',
    'history',
    'calendar',
];

/** Mapa View (frontend) → moduleId */
export const VIEW_TO_MODULE = {
    dashboard: 'dashboard',
    contacts: 'contacts',
    conversations: 'conversations',
    crm: 'crm',
    campaigns: 'campaigns',
    templates: 'templates',
    scheduler: 'scheduler',
    groupdispatch: 'groupdispatch',
    groups: 'groupdispatch',
    categories: 'groupdispatch',
    library: 'groupdispatch',
    history: 'groupdispatch',
    calendar: 'groupdispatch',
    followups: 'followups',
    aiagents: 'aiagents',
    flows: 'flows',
    catalog: 'catalog',
    settings: null, // depende da aba
    whatsapp: null, // só superadmin
    users: null,
    assistant: 'templates',
};

/** Aba de Settings → moduleId (null = só superadmin) */
export const SETTINGS_TAB_TO_MODULE = {
    connections: null,
    atendimento: 'settings_atendimento',
    integrations: null,
    users: null,
    csat: 'settings_csat',
    api: null,
    widget: 'settings_widget',
    profile: 'settings_profile',
};

/** Entidade platform → moduleId */
const ENTITY_TO_MODULE = {
    contacts: 'contacts',
    conversations: null, // só superadmin
    deals: 'crm',
    campaigns: 'campaigns',
    followups: 'followups',
    agents: 'aiagents',
    flows: 'flows',
    widgets: 'settings_widget',
    tokens: null, // só superadmin
};

/**
 * Normaliza lista de módulos vindos do cliente.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeModules(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const item of raw) {
        const id = String(item || '').trim();
        if (!ASSIGNABLE_SET.has(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

/**
 * Parse modules JSON do banco.
 * @param {string|null|undefined} json
 * @returns {string[]}
 */
export function parseModulesJson(json) {
    if (!json) return [];
    try {
        return normalizeModules(JSON.parse(json));
    } catch {
        return [];
    }
}

export function userHasModule(user, moduleId) {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    if (moduleId === 'settings_profile') return true;
    const mods = Array.isArray(user.modules) ? user.modules : [];
    if (mods.includes('*')) return true;
    return mods.includes(moduleId);
}

export function userHasAnyAppModule(user) {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    const mods = Array.isArray(user.modules) ? user.modules : [];
    if (mods.includes('*')) return true;
    return mods.some((m) => ASSIGNABLE_SET.has(m));
}

/**
 * Resolve módulo exigido para um path/método da API.
 * Retorna:
 * - 'superadmin' → só superadmin
 * - string moduleId → precisa desse módulo
 * - null → qualquer autenticado
 * - false → negar (path desconhecido para operator)
 *
 * @param {string} path
 * @param {string} [method='GET']
 * @returns {string|null|false|'superadmin'}
 */
export function resolveApiModule(path, method = 'GET') {
    const p = String(path || '').split('?')[0];
    const m = String(method || 'GET').toUpperCase();

    // Sempre ok para sessão
    if (p === '/api/me' || p === '/api/ai/providers') return null;

    // Só superadmin
    if (p.startsWith('/api/users')) return 'superadmin';
    if (p.startsWith('/api/admin')) return 'superadmin';
    if (p.startsWith('/api/platform/bling')) return 'superadmin';
    if (p.startsWith('/api/platform/woocommerce')) return 'superadmin';
    if (p === '/api/platform/kv' || p.startsWith('/api/platform/kv/')) {
        if (m === 'GET') return null; // leitura de config genérica (UI filtra)
        return 'superadmin';
    }
    if (p.startsWith('/api/disconnect') || p.startsWith('/api/reconnect')) return 'superadmin';
    if (p.startsWith('/api/pairing-code')) return 'superadmin';
    if (p.startsWith('/api/session/')) return 'superadmin';
    if (p.startsWith('/api/qr')) return 'superadmin';

    // Catálogo
    if (p.startsWith('/api/catalog')) {
        if (m === 'DELETE') return 'superadmin';
        // Fila Goiânia (operador de loja)
        if (p.startsWith('/api/catalog/checks') || p.startsWith('/api/catalog/check-files')) {
            return 'catalog';
        }
        // Qualidade do Catálogo (ver produtos, relatórios, inativar)
        return 'catalog_quality';
    }

    // Inbox / conversas WhatsApp — módulo CRM (atendimento assistido) ou superadmin
    if (p.startsWith('/api/inbox')) return 'crm';

    // CRM (ficha, pipeline, pedidos Bling)
    if (p.startsWith('/api/platform/crm')) return 'crm';

    // Platform entities
    const entMatch = p.match(/^\/api\/platform\/entities\/([^/]+)/);
    if (entMatch) {
        const mod = ENTITY_TO_MODULE[entMatch[1]];
        if (mod === null) return 'superadmin';
        if (mod) return mod;
        return 'superadmin';
    }
    if (p.startsWith('/api/platform/followups')) return 'followups';
    if (p.startsWith('/api/platform/integration-events')) return 'superadmin';

    // Disparo / grupos
    if (p.startsWith('/api/schedules') || p.startsWith('/api/dispatches')) return 'scheduler';
    if (
        p.startsWith('/api/chats')
        || p.startsWith('/api/send')
        || p.startsWith('/api/send-bulk')
        || p.startsWith('/api/categories')
        || p.startsWith('/api/history')
        || p.startsWith('/api/dispatch/')
    ) {
        return 'groupdispatch';
    }

    // Status WhatsApp — útil no shell; qualquer módulo de app
    if (p === '/api/status' || p === '/api/send-progress' || p === '/api/health') return null;

    // AI genérico (templates / agentes)
    if (p.startsWith('/api/ai/')) return null;

    // Studio legado
    if (p.startsWith('/api/studio')) return null;

    // Notifications
    if (p.startsWith('/api/notifications')) return 'superadmin';

    // Default: autenticado com qualquer módulo de app (ou superadmin)
    return null;
}

export default {
    APP_MODULES,
    ALWAYS_MODULES,
    ASSIGNABLE_MODULE_IDS,
    GROUPDISPATCH_VIEWS,
    VIEW_TO_MODULE,
    SETTINGS_TAB_TO_MODULE,
    normalizeModules,
    parseModulesJson,
    userHasModule,
    userHasAnyAppModule,
    resolveApiModule,
};
