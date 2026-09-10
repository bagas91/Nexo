/**
 * Catálogo de módulos (ACL) — espelho do server/config/modules.js
 */

export type ModuleId =
  | 'dashboard'
  | 'contacts'
  | 'conversations'
  | 'crm'
  | 'campaigns'
  | 'templates'
  | 'scheduler'
  | 'groupdispatch'
  | 'followups'
  | 'aiagents'
  | 'flows'
  | 'catalog'
  | 'catalog_quality'
  | 'settings_atendimento'
  | 'settings_csat'
  | 'settings_widget'
  | 'settings_profile';

export type ModuleDef = {
  id: ModuleId;
  label: string;
  group: string;
  groupLabel: string;
};

/** Módulos que o superadmin pode marcar no usuário. */
export const APP_MODULES: ModuleDef[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'inicio', groupLabel: 'Início' },
  { id: 'contacts', label: 'Contatos', group: 'atendimento', groupLabel: 'Atendimento' },
  // Inbox WhatsApp compartilhado — quem tem CRM acessa o atendimento assistido.
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

/** Ainda incompletos — não atribuir. */
export const EXPERIMENTAL_MODULES: ModuleDef[] = [
  { id: 'settings_csat', label: 'Pesquisa CSAT (em breve)', group: 'config', groupLabel: 'Configurações' },
  { id: 'settings_widget', label: 'Widget site (em breve)', group: 'config', groupLabel: 'Configurações' },
];

export const ALWAYS_MODULES: ModuleId[] = ['settings_profile'];

/** Views liberadas junto com groupdispatch */
export const GROUPDISPATCH_VIEWS = [
  'groupdispatch',
  'groups',
  'categories',
  'library',
  'history',
  'calendar',
] as const;

export const VIEW_TO_MODULE: Record<string, ModuleId | null | undefined> = {
  dashboard: 'dashboard',
  contacts: 'contacts',
  conversations: null, // só superadmin (WhatsApp pessoal)
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
  // view catalog também libera com catalog_quality — ver canAccessView
  assistant: 'templates',
  admin: null, // só superadmin
  settings: undefined,
  whatsapp: null,
  users: null,
};

export const SETTINGS_TAB_TO_MODULE: Record<string, ModuleId | null> = {
  connections: null,
  atendimento: 'settings_atendimento',
  integrations: null,
  users: null,
  csat: 'settings_csat',
  api: null,
  widget: 'settings_widget',
  profile: 'settings_profile',
};

export function userHasModule(
  user: { role?: string; modules?: string[] } | null | undefined,
  moduleId: string,
): boolean {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  if (moduleId === 'settings_profile') return true;
  const mods = user.modules || [];
  if (mods.includes('*')) return true;
  return mods.includes(moduleId);
}

export function userHasAnyAppModule(user: { role?: string; modules?: string[] } | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  const mods = user.modules || [];
  if (mods.includes('*')) return true;
  const assignable = new Set(APP_MODULES.map((m) => m.id));
  return mods.some((m) => assignable.has(m as ModuleId));
}

export function canAccessView(
  user: { role?: string; modules?: string[] } | null | undefined,
  view: string,
  settingsTab?: string,
): boolean {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  if (view === 'admin') return false;
  if (view === 'catalog') {
    return userHasModule(user, 'catalog') || userHasModule(user, 'catalog_quality');
  }
  if (view === 'settings' || view === 'whatsapp') {
    const tab = settingsTab || 'profile';
    if (view === 'whatsapp') return false;
    const mod = SETTINGS_TAB_TO_MODULE[tab];
    if (mod === null) return false;
    if (mod === undefined) return false;
    return userHasModule(user, mod);
  }
  const mod = VIEW_TO_MODULE[view];
  if (mod === null) return false;
  if (!mod) return false;
  return userHasModule(user, mod);
}

export function modulesSummary(modules?: string[]): string {
  const n = (modules || []).filter((m) => m !== '*').length;
  if (n === 0) return 'Nenhum módulo';
  if (n === 1) return '1 módulo';
  return `${n} módulos`;
}

export function groupedModules(): { group: string; groupLabel: string; items: ModuleDef[] }[] {
  const map = new Map<string, { group: string; groupLabel: string; items: ModuleDef[] }>();
  for (const m of APP_MODULES) {
    if (!map.has(m.group)) {
      map.set(m.group, { group: m.group, groupLabel: m.groupLabel, items: [] });
    }
    map.get(m.group)!.items.push(m);
  }
  return [...map.values()];
}
