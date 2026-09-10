/** Mock data layer — localStorage only, zero backend calls. */

import { BRANDING } from '../config/branding';

const PREFIX = 'bs_mock_';

export type FollowUpStepType = 'wait' | 'message' | 'tag' | 'condition' | 'webhook';

export interface FollowUpStep {
  id: string;
  type: FollowUpStepType;
  label: string;
  config: Record<string, string>;
}

export interface FollowUp {
  id: string;
  name: string;
  active: boolean;
  trigger: string;
  steps: FollowUpStep[];
  createdAt: number;
}

export interface AiAgent {
  id: string;
  name: string;
  description: string;
  type: string;
  active: boolean;
  prompt: string;
  audio: boolean;
  files: boolean;
  connection: string;
  createdAt: number;
}

export type FlowBlockType = 'message' | 'audio' | 'delay' | 'condition' | 'ai' | 'tag' | 'human' | 'webhook';

export interface FlowBlock {
  id: string;
  type: FlowBlockType;
  label: string;
  config: Record<string, string>;
}

export interface Flow {
  id: string;
  name: string;
  active: boolean;
  trigger: string;
  triggerConfig: Record<string, string>;
  blocks: FlowBlock[];
  nodes?: FlowCanvasNode[];
  edges?: FlowCanvasEdge[];
  createdAt: number;
}

export interface FlowCanvasNode {
  id: string;
  type: 'flowNode';
  position: { x: number; y: number };
  data: {
    blockType: FlowBlockType | 'trigger' | 'end';
    label: string;
    config: Record<string, string>;
  };
}

export interface FlowCanvasEdge {
  id: string;
  source: string;
  target: string;
}

export interface ApiToken {
  id: string;
  label: string;
  token: string;
  createdAt: number;
  prefix: string;
}

export interface WidgetConfig {
  id: string;
  name: string;
  active: boolean;
  attendant: string;
  welcome: string;
  showBubble: boolean;
  color: string;
  position: 'right' | 'left';
  instance: string;
  embedId: string;
  createdAt: number;
}

export interface CsatConfig {
  active: boolean;
  message: string;
}

export interface IntegrationConfig {
  id: string;
  connected: boolean;
  connectedAt?: number;
}

export interface WooCommerceConfig {
  connected: boolean;
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  credentialsConfigured?: boolean;
  syncOrders?: boolean;
  events: Record<string, boolean>;
  eventMessages?: Record<string, string>;
  connectedAt?: number;
}

export interface BlingConfig {
  connected: boolean;
  apiKey: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  tokenConfigured?: boolean;
  syncProducts: boolean;
  syncOrders: boolean;
  notifyNfe: boolean;
  notifyLowStock: boolean;
  statusMap: { blingStatus: string; message: string; active: boolean }[];
  connectedAt?: number;
}

export interface IntegrationEvent {
  id: string;
  source: 'woocommerce' | 'bling';
  eventType: string;
  summary: string;
  customer: string;
  phone: string;
  status: 'processed' | 'queued' | 'failed';
  whatsappPreview: string;
  ts: number;
}

export interface MockContact {
  id: string;
  name: string;
  phone: string;
  tags: string[];
  lastSeen: number;
  /** Notas da ficha do cliente (diferente da nota da conversa). */
  notes?: string;
  /** Origem digital: whatsapp | site | instagram | ads | other */
  source?: string;
  /** Cliente costuma pedir ajuda no WPP para comprar. */
  needsHelp?: boolean;
}

export interface MockConversation {
  id: string;
  contactName: string;
  phone: string;
  lastMessage: string;
  unread: number;
  status: 'open' | 'pending' | 'closed';
  updatedAt: number;
}

/** Funil e-commerce + venda assistida no WhatsApp (sem presencial). */
export type CrmDealStage =
  | 'new'
  | 'attending'
  | 'link_sent'
  | 'awaiting_payment'
  | 'paid'
  | 'lost'
  /** Legado — mapeado na UI */
  | 'lead'
  | 'qualified'
  | 'proposal'
  | 'won';

export interface CrmDeal {
  id: string;
  title: string;
  contactName: string;
  phone?: string;
  contactId?: string;
  conversationId?: string;
  stage: CrmDealStage;
  value: number;
  /** whatsapp | site | instagram | ads | other */
  source?: string;
  notes?: string;
  updatedAt: number;
  createdAt?: number;
}

export interface MockCampaign {
  id: string;
  name: string;
  status: 'draft' | 'scheduled' | 'running' | 'done';
  sent: number;
  total: number;
  scheduledAt: number | null;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function load<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
  listeners.forEach((fn) => fn());
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeMockStore(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const SEED_FOLLOWUPS: FollowUp[] = [
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

const SEED_AGENTS: AiAgent[] = [
  {
    id: 'ag_1',
    name: 'Assistente Pastoral',
    description: 'Tom acolhedor para dúvidas sobre cultos e ministério.',
    type: 'Atendimento',
    active: true,
    prompt: `Você é um assistente pastoral do ${BRANDING.productName}. Responda com empatia.`,
    audio: true,
    files: false,
    connection: 'WhatsApp Web',
    createdAt: Date.now() - 86400000 * 5,
  },
];

function normalizeFlow(f: Flow): Flow {
  if (f.nodes && f.nodes.length > 0) return f;
  const nodes: FlowCanvasNode[] = [
    {
      id: 'trigger',
      type: 'flowNode',
      position: { x: 320, y: 40 },
      data: {
        blockType: 'trigger',
        label: 'Gatilho inicial',
        config: { trigger: f.trigger, ...f.triggerConfig },
      },
    },
  ];
  const edges: FlowCanvasEdge[] = [];
  let prevId = 'trigger';
  f.blocks.forEach((b, i) => {
    nodes.push({
      id: b.id,
      type: 'flowNode',
      position: { x: 320, y: 200 + i * 170 },
      data: { blockType: b.type, label: b.label, config: { ...b.config } },
    });
    edges.push({ id: `e_${prevId}_${b.id}`, source: prevId, target: b.id });
    prevId = b.id;
  });
  const endId = 'end';
  nodes.push({
    id: endId,
    type: 'flowNode',
    position: { x: 320, y: 200 + f.blocks.length * 170 },
    data: { blockType: 'end', label: 'Encerrar fluxo', config: {} },
  });
  edges.push({ id: `e_${prevId}_${endId}`, source: prevId, target: endId });
  return { ...f, nodes, edges };
}

const SEED_FLOWS: Flow[] = [
  {
    id: 'fl_1',
    name: 'Atendimento automático',
    active: false,
    trigger: 'Qualquer mensagem',
    triggerConfig: { connection: '' },
    blocks: [
      { id: 'b1', type: 'ai', label: 'Agente de IA', config: { agentId: '' } },
    ],
    createdAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'fl_2',
    name: 'Palavra-chave ORAÇÃO',
    active: false,
    trigger: 'Palavra-chave',
    triggerConfig: { keyword: 'ORAÇÃO' },
    blocks: [
      { id: 'b1', type: 'message', label: 'Resposta automática', config: { text: 'Recebemos seu pedido de oração 🙏' } },
      { id: 'b2', type: 'tag', label: 'Tag oração', config: { tag: 'pedido-oracao' } },
      { id: 'b3', type: 'human', label: 'Encaminhar humano', config: {} },
    ],
    createdAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'fl_woo_pos',
    name: 'Woo — Confirmação de pedido',
    active: true,
    trigger: 'Webhook WooCommerce',
    triggerConfig: { event: 'order.created' },
    blocks: [
      { id: 'b1', type: 'message', label: 'Confirmação', config: { text: `Olá {{nome}}! Recebemos seu pedido #{{numero}}. Obrigada pela compra na ${BRANDING.storeName}!` } },
    ],
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
      { id: 'b3', type: 'delay', label: 'Esperar 24h', config: { minutes: '1440' } },
      { id: 'b4', type: 'message', label: 'Último lembrete', config: { text: 'Última chance! Seu carrinho ainda está reservado por pouco tempo.' } },
    ],
    createdAt: Date.now() - 86400000,
  },
  {
    id: 'fl_bling_env',
    name: 'Bling — Pedido enviado',
    active: true,
    trigger: 'Webhook Bling',
    triggerConfig: { status: 'Enviado' },
    blocks: [
      { id: 'b1', type: 'message', label: 'Rastreio', config: { text: 'Pedido #{{numero}} enviado! Rastreio: {{rastreio}}' } },
    ],
    createdAt: Date.now() - 86400000,
  },
];

const SEED_CONTACTS: MockContact[] = [
  { id: 'c1', name: 'Maria Silva', phone: '+55 62 99999-1001', tags: ['grupo-goiania'], lastSeen: Date.now() - 3600000 },
  { id: 'c2', name: 'João Pastor', phone: '+55 62 99999-1002', tags: ['adm'], lastSeen: Date.now() - 7200000 },
  { id: 'c3', name: 'Ana Compras', phone: '+55 11 98888-2003', tags: ['loja', 'vip'], lastSeen: Date.now() - 86400000 },
];

const SEED_CONVERSATIONS: MockConversation[] = [
  { id: 'cv1', contactName: 'Maria Silva', phone: '+55 62 99999-1001', lastMessage: 'Qual horário do culto de amanhã?', unread: 2, status: 'open', updatedAt: Date.now() - 600000 },
  { id: 'cv2', contactName: 'Ana Compras', phone: '+55 11 98888-2003', lastMessage: 'Tem o colar Mezuzah disponível?', unread: 0, status: 'pending', updatedAt: Date.now() - 3600000 },
  { id: 'cv3', contactName: 'Carlos', phone: '+55 62 97777-3004', lastMessage: 'Amém! Obrigado pela palavra.', unread: 0, status: 'closed', updatedAt: Date.now() - 86400000 },
];

const SEED_DEALS: CrmDeal[] = [
  {
    id: 'd1',
    title: 'Combo Florescer',
    contactName: 'Ana Compras',
    phone: '5511988882003',
    stage: 'link_sent',
    value: 349,
    source: 'whatsapp',
    updatedAt: Date.now() - 3600000,
  },
  {
    id: 'd2',
    title: 'Ajuda no checkout — Colar',
    contactName: 'Maria Silva',
    phone: '5562999991001',
    stage: 'attending',
    value: 0,
    source: 'whatsapp',
    updatedAt: Date.now() - 7200000,
  },
  {
    id: 'd3',
    title: 'Colar Mezuzah',
    contactName: 'Patricia L.',
    phone: '5562977773004',
    stage: 'paid',
    value: 189,
    source: 'site',
    updatedAt: Date.now() - 86400000 * 2,
  },
];

const SEED_CAMPAIGNS: MockCampaign[] = [
  { id: 'cp1', name: 'Palavra do Dia — Junho', status: 'running', sent: 28, total: 33, scheduledAt: null },
  { id: 'cp2', name: 'Lançamento coleção', status: 'scheduled', sent: 0, total: 12, scheduledAt: Date.now() + 86400000 * 2 },
];

const SEED_INTEGRATION_EVENTS: IntegrationEvent[] = [
  {
    id: 'ev_seed_1',
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
    id: 'ev_seed_2',
    source: 'bling',
    eventType: 'pedido.enviado',
    summary: 'NF 12847 — Colar Mezuzah',
    customer: 'Patricia L.',
    phone: '+55 62 97777-3004',
    status: 'processed',
    whatsappPreview: 'Pedido enviado! Rastreio: BR123456789BR',
    ts: Date.now() - 7200000,
  },
  {
    id: 'ev_seed_3',
    source: 'woocommerce',
    eventType: 'cart.abandoned',
    summary: 'Carrinho abandonado — Brinco Flor',
    customer: 'Mariana S.',
    phone: '+55 11 99999-8822',
    status: 'queued',
    whatsappPreview: 'Oi Mariana! Vi que você deixou o Brinco Flor no carrinho. Posso ajudar?',
    ts: Date.now() - 1800000,
  },
];

function loadOrSeed<T>(key: string, seed: T): T {
  if (typeof localStorage === 'undefined') return seed;
  const raw = localStorage.getItem(PREFIX + key);
  if (raw === null) {
    save(key, seed);
    return seed;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return seed;
  }
}

function seedEcommerceAutomations() {
  const flows = mockStore.getFlows();
  const ecommerceIds = ['fl_woo_pos', 'fl_woo_cart', 'fl_bling_env'];
  ecommerceIds.forEach((id) => {
    const seed = SEED_FLOWS.find((f) => f.id === id);
    if (seed && !flows.some((f) => f.id === id)) {
      mockStore.saveFlow(seed);
    }
  });
  const followups = mockStore.getFollowUps();
  if (!followups.some((f) => f.name.includes('CSAT pós-entrega'))) {
    mockStore.saveFollowUp({
      id: uid(),
      name: 'CSAT pós-entrega (e-commerce)',
      active: true,
      trigger: 'Pedido entregue (Bling)',
      steps: [
        { id: uid(), type: 'wait', label: 'Esperar 2 dias', config: { minutes: '2880' } },
        { id: uid(), type: 'message', label: 'Pesquisa CSAT', config: { text: `Como foi sua experiência com ${BRANDING.productName}? Responda de 1 a 5 ⭐` } },
      ],
      createdAt: Date.now(),
    });
  }
}

export const mockStore = {
  // Follow Ups
  getFollowUps: (): FollowUp[] => loadOrSeed('followups', SEED_FOLLOWUPS),
  saveFollowUp: (item: FollowUp) => {
    const list = mockStore.getFollowUps();
    const idx = list.findIndex((x) => x.id === item.id);
    if (idx >= 0) list[idx] = item;
    else list.unshift(item);
    save('followups', list);
  },
  deleteFollowUp: (id: string) => save('followups', mockStore.getFollowUps().filter((x) => x.id !== id)),
  createFollowUpFromModel: (name: string, steps: FollowUpStep[]) =>
    mockStore.saveFollowUp({ id: uid(), name, active: false, trigger: 'Manual', steps, createdAt: Date.now() }),

  // AI Agents
  getAgents: (): AiAgent[] => loadOrSeed('agents', SEED_AGENTS),
  saveAgent: (item: AiAgent) => {
    const list = mockStore.getAgents();
    const idx = list.findIndex((x) => x.id === item.id);
    if (idx >= 0) list[idx] = item;
    else list.unshift(item);
    save('agents', list);
  },
  deleteAgent: (id: string) => save('agents', mockStore.getAgents().filter((x) => x.id !== id)),

  // Flows
  getFlows: (): Flow[] => loadOrSeed('flows', SEED_FLOWS).map(normalizeFlow),
  saveFlow: (item: Flow) => {
    const normalized = normalizeFlow(item);
    const blockNodes = (normalized.nodes || []).filter(
      (n) => n.data.blockType !== 'trigger' && n.data.blockType !== 'end'
    );
    normalized.blocks = blockNodes.map((n) => ({
      id: n.id,
      type: n.data.blockType as FlowBlockType,
      label: n.data.label,
      config: n.data.config,
    }));
    const raw = load<Flow[]>('flows', []);
    const list = raw.map(normalizeFlow);
    const idx = list.findIndex((x) => x.id === normalized.id);
    if (idx >= 0) list[idx] = normalized;
    else list.unshift(normalized);
    save('flows', list);
  },
  deleteFlow: (id: string) => save('flows', mockStore.getFlows().filter((x) => x.id !== id)),

  // API Tokens
  getTokens: (): ApiToken[] => load('tokens', []),
  createToken: (label: string): ApiToken => {
    const token = `bs_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    const item: ApiToken = { id: uid(), label, token, prefix: token.slice(0, 12), createdAt: Date.now() };
    save('tokens', [item, ...mockStore.getTokens()]);
    return item;
  },
  deleteToken: (id: string) => save('tokens', mockStore.getTokens().filter((x) => x.id !== id)),

  // Widget
  getWidgets: (): WidgetConfig[] => load('widgets', []),
  saveWidget: (item: WidgetConfig) => {
    const list = mockStore.getWidgets();
    const idx = list.findIndex((x) => x.id === item.id);
    if (idx >= 0) list[idx] = item;
    else list.unshift(item);
    save('widgets', list);
    return item;
  },
  deleteWidget: (id: string) => save('widgets', mockStore.getWidgets().filter((x) => x.id !== id)),

  // CSAT
  getCsat: (): CsatConfig => load('csat', { active: false, message: 'Como foi seu atendimento? Responda de 1 a 5 ⭐' }),
  saveCsat: (cfg: CsatConfig) => save('csat', cfg),

  // Integrations
  getIntegrations: (): IntegrationConfig[] =>
    load('integrations', [
      { id: 'woocommerce', connected: false },
      { id: 'bling', connected: false },
      { id: 'calendar', connected: false },
      { id: 'meta-ads', connected: false },
      { id: 'google-ads', connected: false },
      { id: 'discord', connected: true, connectedAt: Date.now() - 86400000 * 30 },
    ]),
  toggleIntegration: (id: string) => {
    const list = mockStore.getIntegrations().map((i) =>
      i.id === id ? { ...i, connected: !i.connected, connectedAt: !i.connected ? Date.now() : undefined } : i
    );
    save('integrations', list);
  },

  getWooCommerce: (): WooCommerceConfig =>
    load('woocommerce', {
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
    }),
  saveWooCommerce: (cfg: WooCommerceConfig) => save('woocommerce', cfg),

  getBling: (): BlingConfig =>
    load('bling', {
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
    }),
  saveBling: (cfg: BlingConfig) => save('bling', cfg),

  getIntegrationEvents: (): IntegrationEvent[] =>
    loadOrSeed('integration_events', SEED_INTEGRATION_EVENTS),
  addIntegrationEvent: (ev: Omit<IntegrationEvent, 'id' | 'ts'>) => {
    const item: IntegrationEvent = { ...ev, id: `ev_${Date.now()}`, ts: Date.now() };
    save('integration_events', [item, ...mockStore.getIntegrationEvents()]);
    return item;
  },

  connectWooCommerceDemo: () => {
    mockStore.saveWooCommerce({
      ...mockStore.getWooCommerce(),
      connected: true,
      consumerKey: 'ck_demo_••••••••',
      consumerSecret: 'cs_demo_••••••••',
      connectedAt: Date.now(),
    });
    save(
      'integrations',
      mockStore.getIntegrations().map((i) =>
        i.id === 'woocommerce' ? { ...i, connected: true, connectedAt: Date.now() } : i
      )
    );
    seedEcommerceAutomations();
  },

  connectBlingDemo: () => {
    mockStore.saveBling({
      ...mockStore.getBling(),
      connected: true,
      apiKey: 'bling_••••••••demo',
      connectedAt: Date.now(),
    });
    save(
      'integrations',
      mockStore.getIntegrations().map((i) =>
        i.id === 'bling' ? { ...i, connected: true, connectedAt: Date.now() } : i
      )
    );
    seedEcommerceAutomations();
  },

  // Atendimento
  getContacts: (): MockContact[] => loadOrSeed('contacts', SEED_CONTACTS),
  getConversations: (): MockConversation[] => loadOrSeed('conversations', SEED_CONVERSATIONS),
  getDeals: (): CrmDeal[] => loadOrSeed('deals', SEED_DEALS),
  getCampaigns: (): MockCampaign[] => loadOrSeed('campaigns', SEED_CAMPAIGNS),
  saveDeal: (deal: CrmDeal) => {
    const list = mockStore.getDeals();
    const idx = list.findIndex((d) => d.id === deal.id);
    if (idx >= 0) list[idx] = deal;
    else list.unshift(deal);
    save('deals', list);
  },

  resetDemo: () => {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
    notify();
  },
};
