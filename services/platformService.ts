/**
 * API da plataforma — integrações, entidades, eventos (substitui mockStore no backend).
 */

const API = '/api/platform';
const TOKEN_KEY = 'va_token';

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...authHeaders(opts.body != null), ...(opts.headers as Record<string, string> || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Erro ${res.status}`);
  return data as T;
}

const CATALOG_API = '/api/catalog';

async function apiCatalog<T>(path: string, opts: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${CATALOG_API}${path}`, {
      ...opts,
      headers: { ...authHeaders(opts.body != null), ...(opts.headers as Record<string, string> || {}) },
    });
  } catch {
    throw new Error('Erro de requisição — servidor/rede indisponível. Tente de novo em instantes.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Erro ${res.status}`);
  return data as T;
}

export type CatalogScan = {
  id: string;
  status: string;
  phase?: string;
  message?: string;
  blingCount?: number;
  wooCount?: number;
  issueCount?: number;
  okCount?: number;
  startedAt?: number;
  finishedAt?: number | null;
  durationMs?: number | null;
  error?: string | null;
  summary?: {
    analyzed?: number;
    withProblems?: number;
    withoutProblems?: number;
    rules?: Array<{ id: string; label: string; priority: string; count: number }>;
  } | null;
};

export type CatalogIssue = {
  id: string;
  ruleId: string;
  priority: string;
  channel: string;
  externalId: string;
  sku: string;
  name: string;
  message: string;
  stockQty?: number | null;
  price?: number | null;
  status?: string | null;
  category?: string;
  meta?: Record<string, unknown> | null;
  createdAt: number;
  lock?: {
    userId: string;
    userName: string;
    lockedAt: number;
    expiresAt: number;
    isMine?: boolean;
  } | null;
  physicalCheck?: {
    id: string;
    status: string;
    requestedByName?: string;
    answeredByName?: string;
    need?: string[];
  } | null;
};

export type CatalogAiDraftSuggestion = {
  ncm?: string | null;
  weight?: number | null;
  height?: number | null;
  width?: number | null;
  length?: number | null;
  brand?: string | null;
  focusKeyword?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  rationale?: string;
};

export type CatalogAiDraft = {
  id: string;
  externalId: string;
  sku: string;
  name: string;
  status: string;
  fields: string[];
  suggested: CatalogAiDraftSuggestion;
  edited?: CatalogAiDraftSuggestion | null;
  provider?: string | null;
  rationale?: string;
  error?: string | null;
  createdAt: number;
  updatedAt: number;
  appliedAt?: number | null;
};

export type CatalogAiSuggestJob = {
  id: string;
  kind?: string;
  status: string;
  total: number;
  done: number;
  ok: number;
  failed: number;
  wave?: number;
  wavesTotal?: number;
  waveSize?: number;
  message?: string;
  currentSku?: string;
  pendingDrafts?: number;
  heuristic?: number;
  errors?: Array<{ externalId?: string; sku?: string; error: string }>;
};

export type CatalogDashboard = {
  blingCount: number;
  wooCount: number;
  reviewed: number;
  pending: number;
  progressPct: number;
  productsWithErrors: number;
  issueTotal: number;
  indicators: Record<string, number>;
  rules: Array<{ id: string; label: string; priority: string; count: number }>;
  latestScan: CatalogScan | null;
  scanRunning: boolean;
  runningScanId: string | null;
  goiania?: {
    pending: number;
    answered: number;
    applied: number;
    returned?: number;
    overdue?: number;
    open: number;
  };
};

export type CatalogPhysicalCheck = {
  id: string;
  externalId: string;
  sku: string;
  name: string;
  need: string[];
  requestNote?: string;
  status: 'pending' | 'answered' | 'applied' | 'cancelled' | 'returned' | string;
  priority?: 'normal' | 'urgent' | string;
  dueAt?: number | null;
  overdue?: boolean;
  returnReason?: string | null;
  returnedAt?: number | null;
  returnedByName?: string | null;
  requestedById?: string;
  requestedByName?: string;
  requestedAt: number;
  responseNote?: string;
  responseWeight?: number | null;
  responseHeight?: number | null;
  responseWidth?: number | null;
  responseLength?: number | null;
  photoFilename?: string | null;
  photoUrl?: string | null;
  answeredById?: string;
  answeredByName?: string;
  answeredAt?: number | null;
  appliedAt?: number | null;
};

export type CatalogPhysicalCheckComment = {
  id: string;
  checkId: string;
  body: string;
  actorId?: string;
  actorName?: string;
  createdAt: number;
};


export const platformService = {
  async getKv<T>(key: string): Promise<T> {
    return api<T>(`/kv/${key}`);
  },

  async setKv<T>(key: string, value: T): Promise<T> {
    const res = await api<{ value: T }>(`/kv/${key}`, {
      method: 'PUT',
      body: JSON.stringify(value),
    });
    return res.value;
  },

  async getWebhookToken(): Promise<string> {
    const data = await api<{ token: string }>('/kv/webhook_secret');
    return data.token;
  },

  async listEntities<T>(type: string): Promise<T[]> {
    return api<T[]>(`/entities/${type}`);
  },

  async saveEntity<T extends { id: string }>(type: string, entity: T): Promise<T> {
    return api<T>(`/entities/${type}/${entity.id}`, { method: 'PUT', body: JSON.stringify(entity) });
  },

  async deleteEntity(type: string, id: string): Promise<void> {
    await api(`/entities/${type}/${id}`, { method: 'DELETE' });
  },

  async enrollFollowUp(followUpId: string, phone: string, contactName?: string) {
    return api<{ success: boolean; run: unknown }>(`/followups/${followUpId}/enroll`, {
      method: 'POST',
      body: JSON.stringify({ phone, contactName }),
    });
  },

  async listFollowUpRuns(limit = 50) {
    return api<Array<{
      id: string;
      followupName: string;
      phone: string;
      contactName: string;
      stepIndex: number;
      status: string;
      nextRunAt: number | null;
    }>>(`/followups/runs?limit=${limit}`);
  },

  async installEcommerceFollowUps() {
    return api<{ success: boolean; added: number; message: string }>('/followups/install-ecommerce', {
      method: 'POST',
    });
  },

  async getCrmProfile(phone: string, name?: string) {
    const q = new URLSearchParams({ phone });
    if (name) q.set('name', name);
    return api<{
      contact: {
        id: string;
        name: string;
        phone: string;
        tags: string[];
        lastSeen?: number;
        notes?: string;
        source?: string;
        needsHelp?: boolean;
      } | null;
      deals: Array<{
        id: string;
        title: string;
        contactName: string;
        phone?: string;
        stage: string;
        value: number;
        source?: string;
        updatedAt: number;
      }>;
    }>(`/crm/profile?${q.toString()}`);
  },

  async saveCrmProfile(body: {
    phone: string;
    name?: string;
    tags?: string[];
    notes?: string;
    source?: string;
    needsHelp?: boolean;
  }) {
    return api<{ success: boolean; contact: Record<string, unknown> }>('/crm/profile', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  async getCrmOrders(phone: string) {
    return api<{
      registered: boolean;
      contact: { id: string; name: string } | null;
      orders: Array<{
        orderId: string;
        numero: string;
        customer: string;
        phone: string;
        status: string;
        rastreio: string;
        produtos: string;
        total: string | number;
        date?: string | null;
      }>;
      error: string | null;
    }>(`/crm/orders?phone=${encodeURIComponent(phone)}`);
  },

  async listCrmDeals() {
    return api<{
      deals: Array<{
        id: string;
        title: string;
        contactName: string;
        phone?: string;
        stage: string;
        value: number;
        source?: string;
        updatedAt: number;
      }>;
      stages: Array<{ id: string; label: string }>;
    }>('/crm/deals');
  },

  async createCrmDeal(body: {
    title?: string;
    contactName?: string;
    phone: string;
    value?: number;
    stage?: string;
    source?: string;
    conversationId?: string;
    notes?: string;
  }) {
    return api<{ success: boolean; deal: Record<string, unknown> }>('/crm/deals', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async updateCrmDeal(id: string, patch: Record<string, unknown>) {
    return api<{ success: boolean; deal: Record<string, unknown> }>(`/crm/deals/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async testBlingConnection(accessToken?: string) {
    return api<{ ok: boolean; message: string }>('/bling/test-connection', {
      method: 'POST',
      body: JSON.stringify(accessToken ? { accessToken } : {}),
    });
  },

  async testWooConnection(params?: { storeUrl?: string; consumerKey?: string; consumerSecret?: string }) {
    return api<{ ok: boolean; message: string }>('/woocommerce/test-connection', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  },

  async saveWooCredentials(storeUrl: string, consumerKey: string, consumerSecret: string) {
    return api<{ success: boolean; message: string; value: unknown }>('/woocommerce/credentials', {
      method: 'PUT',
      body: JSON.stringify({ storeUrl, consumerKey, consumerSecret }),
    });
  },

  async connectBling(accessToken: string) {
    return api<{ success: boolean; message: string }>('/bling/connect', {
      method: 'POST',
      body: JSON.stringify({ accessToken }),
    });
  },

  async saveBlingCredentials(clientId: string, clientSecret: string) {
    return api<{ success: boolean; redirectUri: string; value: import('./mockStore').BlingConfig }>('/bling/credentials', {
      method: 'PUT',
      body: JSON.stringify({ clientId, clientSecret }),
    });
  },

  async getBlingRedirectUri() {
    return api<{ redirectUri: string }>('/bling/oauth/redirect-uri');
  },

  async getBlingAuthorizeUrl() {
    return api<{ url: string; redirectUri: string }>('/bling/oauth/authorize-url');
  },

  async listIntegrationEvents(source?: 'woocommerce' | 'bling') {
    const q = source ? `?source=${source}&limit=50` : '?limit=50';
    return api<Array<{
      id: string;
      source: string;
      eventType: string;
      summary: string;
      customer: string;
      phone: string;
      status: string;
      whatsappPreview: string;
      ts: number;
    }>>(`/integration-events${q}`);
  },

  async simulateIntegrationEvent(source: 'woocommerce' | 'bling', eventType: string, payload: Record<string, unknown> = {}) {
    return api('/integration-events/simulate', {
      method: 'POST',
      body: JSON.stringify({ source, eventType, payload }),
    });
  },

  webhookUrl(path: 'woocommerce' | 'bling', token: string): string {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    return `${base}/api/webhooks/${path}?token=${encodeURIComponent(token)}`;
  },

  // --- Qualidade do Catálogo ---
  async getCatalogDashboard() {
    return apiCatalog<CatalogDashboard>('/dashboard');
  },

  async startCatalogScan(params?: { syncWoo?: boolean }) {
    return apiCatalog<{ alreadyRunning: boolean; scan: CatalogScan }>('/scan', {
      method: 'POST',
      body: JSON.stringify({ syncWoo: params?.syncWoo === true }),
    });
  },

  async getCatalogScan(id: string) {
    return apiCatalog<CatalogScan>(`/scan/${encodeURIComponent(id)}`);
  },

  async listCatalogIssues(params?: {
    ruleId?: string;
    priority?: string;
    stock?: 'in_stock' | 'out_of_stock' | 'unknown' | '';
    category?: string;
    limit?: number;
  }) {
    const q = new URLSearchParams();
    if (params?.ruleId) q.set('ruleId', params.ruleId);
    if (params?.priority) q.set('priority', params.priority);
    if (params?.stock) q.set('stock', params.stock);
    if (params?.category) q.set('category', params.category);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiCatalog<{
      issues: CatalogIssue[];
      total: number;
      truncated: boolean;
      byCategory: Array<{ name: string; count: number }>;
    }>(`/issues${qs ? `?${qs}` : ''}`);
  },

  async reauditCatalog() {
    return apiCatalog<{ success: boolean; scan: CatalogScan; dashboard: CatalogDashboard }>('/reaudit', {
      method: 'POST',
      body: '{}',
    });
  },

  async getCatalogProduct(id: string) {
    return apiCatalog<Record<string, unknown>>(`/products/${encodeURIComponent(id)}`);
  },

  async refreshCatalogProduct(id: string) {
    return apiCatalog<{
      success: boolean;
      product: Record<string, unknown>;
      remainingIssues?: number;
      dashboard?: CatalogDashboard;
    }>(`/products/${encodeURIComponent(id)}/refresh`, {
      method: 'POST',
      body: '{}',
    });
  },

  async listReviewedProducts(params?: { search?: string; limit?: number }) {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiCatalog<{
      products: Array<{
        externalId: string;
        sku?: string;
        name?: string;
        price?: number;
        weight?: number | null;
        height?: number | null;
        width?: number | null;
        length?: number | null;
        ncm?: string;
        category?: string;
        reviewStatus?: string;
        syncedAt?: number;
      }>;
      total: number;
      count: number;
    }>(`/reviewed-products${qs ? `?${qs}` : ''}`);
  },

  async markCatalogProductReviewed(id: string) {
    return apiCatalog<{
      success: boolean;
      product: Record<string, unknown>;
      dashboard: CatalogDashboard;
    }>(`/products/${encodeURIComponent(id)}/mark-reviewed`, {
      method: 'POST',
      body: '{}',
    });
  },

  async claimCatalogProduct(id: string, opts?: { force?: boolean }) {
    return apiCatalog<{
      success: boolean;
      lock: CatalogIssue['lock'];
      ttlMs: number;
    }>(`/products/${encodeURIComponent(id)}/claim`, {
      method: 'POST',
      body: JSON.stringify(opts || {}),
    });
  },

  async heartbeatCatalogProduct(id: string) {
    return apiCatalog<{
      success: boolean;
      lock: CatalogIssue['lock'];
      ttlMs: number;
    }>(`/products/${encodeURIComponent(id)}/heartbeat`, {
      method: 'POST',
      body: '{}',
    });
  },

  async releaseCatalogProduct(id: string, opts?: { force?: boolean }) {
    return apiCatalog<{
      success: boolean;
      released: boolean;
    }>(`/products/${encodeURIComponent(id)}/release`, {
      method: 'POST',
      body: JSON.stringify(opts || {}),
    });
  },

  async fixCatalogProduct(id: string, patch: {
    sku?: string;
    name?: string;
    price?: number | string;
    weight?: number | string;
    height?: number | string;
    width?: number | string;
    length?: number | string;
    ncm?: string;
    brand?: string;
    categoryId?: number | string | null;
    shortDescription?: string;
    description?: string;
    seoTitle?: string;
    seoDescription?: string;
    focusKeyword?: string;
  }) {
    return apiCatalog<{
      success: boolean;
      product: Record<string, unknown>;
      remainingIssues: number;
      dashboard: CatalogDashboard;
    }>(`/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async listCatalogCategories() {
    return apiCatalog<{
      categories: Array<{ id: number; name: string; parentId?: number | null }>;
    }>('/categories');
  },

  async createCatalogCategory(body: { name: string; parentId?: number | null }) {
    return apiCatalog<{
      success: boolean;
      category: { id: number; name: string; parentId?: number | null };
    }>('/categories', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async resolveCatalogCategoryNames() {
    return apiCatalog<{
      success: boolean;
      alreadyRunning?: boolean;
      scan?: CatalogScan;
      dashboard?: CatalogDashboard;
    }>('/categories/resolve-names', {
      method: 'POST',
      body: '{}',
    });
  },

  /** Sugestões de IA (NCM / peso / dims) — salva rascunho; não grava no Bling. */
  async suggestCatalogProduct(id: string, opts?: {
    fields?: Array<'ncm' | 'weight' | 'dimensions' | 'description'>;
    name?: string;
    sku?: string;
    provider?: 'openai' | 'gemini';
    saveDraft?: boolean;
  }) {
    return apiCatalog<{
      success: boolean;
      productId: string;
      fields: string[];
      suggestions: {
        ncm: string | null;
        weight: number | null;
        height: number | null;
        width: number | null;
        length: number | null;
        shortDescription?: string | null;
        description?: string | null;
        seoTitle?: string | null;
        seoDescription?: string | null;
        focusKeyword?: string | null;
        rationale: string;
      };
      provider?: string;
      draft?: CatalogAiDraft;
      product?: { name?: string; sku?: string };
    }>(`/products/${encodeURIComponent(id)}/suggest`, {
      method: 'POST',
      body: JSON.stringify({ ...opts }),
    });
  },

  async listCatalogAiDrafts(params?: { status?: string; limit?: number }) {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiCatalog<{
      success: boolean;
      drafts: CatalogAiDraft[];
      pending: number;
    }>(`/ai-drafts${qs ? `?${qs}` : ''}`);
  },

  async updateCatalogAiDraft(id: string, edited: Partial<CatalogAiDraftSuggestion>) {
    return apiCatalog<{ success: boolean; draft: CatalogAiDraft }>(
      `/ai-drafts/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(edited) },
    );
  },

  async discardCatalogAiDraft(id: string) {
    return apiCatalog<{ success: boolean; draft: CatalogAiDraft }>(
      `/ai-drafts/${encodeURIComponent(id)}/discard`,
      { method: 'POST', body: '{}' },
    );
  },

  async applyCatalogAiDraft(id: string, edited?: Partial<CatalogAiDraftSuggestion>) {
    return apiCatalog<{ success: boolean; draft: CatalogAiDraft; remainingIssues?: number; dashboard?: CatalogDashboard }>(
      `/ai-drafts/${encodeURIComponent(id)}/apply`,
      { method: 'POST', body: JSON.stringify(edited ? { edited } : {}) },
    );
  },

  async applyCatalogAiDraftsBulk(ids: string[]) {
    return apiCatalog<{
      success: boolean;
      total: number;
      ok: number;
      failed: number;
      errors: Array<{ id: string; error: string }>;
      pending?: number;
    }>('/ai-drafts/apply-bulk', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  },

  async discardCatalogAiDraftsBulk(ids: string[]) {
    return apiCatalog<{
      success: boolean;
      total: number;
      discarded: number;
      pending?: number;
    }>('/ai-drafts/discard-bulk', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  },

  async startBulkCatalogAiSuggest(params: {
    externalIds: string[];
    fields?: Array<'ncm' | 'weight' | 'dimensions' | 'description'>;
  }) {
    return apiCatalog<{
      alreadyRunning?: boolean;
      job: CatalogAiSuggestJob | null;
      error?: string;
    }>('/ai-drafts/suggest-bulk', {
      method: 'POST',
      body: JSON.stringify({ ...params }),
    });
  },

  async getBulkCatalogAiSuggestJob() {
    return apiCatalog<{ job: CatalogAiSuggestJob | null }>('/ai-drafts/job');
  },

  async cancelBulkCatalogAiSuggest() {
    return apiCatalog<{ ok: boolean; message?: string }>('/ai-drafts/cancel', {
      method: 'POST',
      body: '{}',
    });
  },

  async listPhysicalChecks(params?: {
    status?: string;
    limit?: number;
    externalId?: string;
    overdue?: boolean;
  }) {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.externalId) q.set('externalId', params.externalId);
    if (params?.overdue) q.set('overdue', '1');
    const qs = q.toString();
    return apiCatalog<{
      checks: CatalogPhysicalCheck[];
      stats: {
        pending: number;
        answered: number;
        applied: number;
        cancelled: number;
        returned?: number;
        overdue?: number;
        open: number;
      };
    }>(`/checks${qs ? `?${qs}` : ''}`);
  },

  async createPhysicalCheck(body: {
    externalId: string;
    need: string[];
    requestNote?: string;
    sku?: string;
    name?: string;
    priority?: 'normal' | 'urgent';
    dueHours?: number;
    dueAt?: number;
  }) {
    return apiCatalog<{ success: boolean; check: CatalogPhysicalCheck; dashboard: CatalogDashboard }>(
      '/checks',
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  async answerPhysicalCheck(id: string, body: {
    responseNote?: string;
    weight?: number | string;
    height?: number | string;
    width?: number | string;
    length?: number | string;
    photoBase64?: string;
  }) {
    return apiCatalog<{ success: boolean; check: CatalogPhysicalCheck; dashboard?: CatalogDashboard }>(
      `/checks/${encodeURIComponent(id)}/answer`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  async returnPhysicalCheck(id: string, body: { reason: string; mode?: 'reopen' | 'close' }) {
    return apiCatalog<{ success: boolean; check: CatalogPhysicalCheck; dashboard?: CatalogDashboard }>(
      `/checks/${encodeURIComponent(id)}/return`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  async listPhysicalCheckComments(id: string) {
    return apiCatalog<{ comments: CatalogPhysicalCheckComment[] }>(
      `/checks/${encodeURIComponent(id)}/comments`,
    );
  },

  async getPhysicalCheckCompletedReport(period: 'today' | '7d' | '30d' | 'all' = '7d') {
    return apiCatalog<{
      period: string;
      sinceMs: number;
      summary: {
        completed: number;
        answered: number;
        applied: number;
        returned: number;
      };
      byResponder: Array<{ name: string; count: number }>;
      items: CatalogPhysicalCheck[];
    }>(`/checks/completed-report?period=${encodeURIComponent(period)}`);
  },

  async addPhysicalCheckComment(id: string, body: string) {
    return apiCatalog<{ success: boolean; comment: CatalogPhysicalCheckComment }>(
      `/checks/${encodeURIComponent(id)}/comments`,
      { method: 'POST', body: JSON.stringify({ body }) },
    );
  },

  async cancelPhysicalCheck(id: string) {
    return apiCatalog<{ success: boolean; check: CatalogPhysicalCheck; dashboard: CatalogDashboard }>(
      `/checks/${encodeURIComponent(id)}/cancel`,
      { method: 'POST', body: '{}' },
    );
  },

  async deletePhysicalCheck(id: string) {
    return apiCatalog<{
      success: boolean;
      deleted: boolean;
      check: CatalogPhysicalCheck;
      dashboard: CatalogDashboard;
    }>(`/checks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async applyPhysicalCheck(id: string) {
    return apiCatalog<{
      success: boolean;
      check: CatalogPhysicalCheck;
      patched: boolean;
      remainingIssues?: number;
      dashboard: CatalogDashboard;
    }>(`/checks/${encodeURIComponent(id)}/apply`, {
      method: 'POST',
      body: '{}',
    });
  },

  async deleteCatalogProduct(id: string) {
    return apiCatalog<{
      success: boolean;
      deletedId: string;
      sku?: string;
      name?: string;
      dashboard: CatalogDashboard;
    }>(`/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async inactivateCatalogProduct(id: string) {
    return apiCatalog<{
      success: boolean;
      inactivated: boolean;
      sku?: string;
      name?: string;
      dashboard: CatalogDashboard;
    }>(`/products/${encodeURIComponent(id)}/inactivate`, {
      method: 'POST',
      body: '{}',
    });
  },

  async bulkCatalogProducts(params: {
    action: 'inactivate' | 'delete';
    ids: string[];
    fallbackInactivate?: boolean;
  }) {
    return apiCatalog<{
      success: boolean;
      action: string;
      ok: number;
      failed: number;
      inactivatedFallback: number;
      total: number;
      results: Array<{ id: string; status: string; error?: string }>;
      dashboard: CatalogDashboard;
    }>('/products/bulk', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async listCatalogIdsByCategory(category: string) {
    const qs = new URLSearchParams({ category }).toString();
    return apiCatalog<{
      success: boolean;
      category: string;
      matched: number;
      total: number;
      ids: string[];
    }>(`/products/ids-by-category?${qs}`);
  },

  /** Inativa todos os ativos da categoria no Bling (snapshot completo). */
  async inactivateCatalogByCategory(category: string) {
    return apiCatalog<{
      success: boolean;
      category: string;
      matched: number;
      total: number;
      ok: number;
      failed: number;
      errors: Array<{ id: string; error: string }>;
      dashboard: CatalogDashboard;
    }>('/products/inactivate-by-category', {
      method: 'POST',
      body: JSON.stringify({ category }),
    });
  },

  /** Baixa CSV de problemas (todos ou filtrado por regra). */
  async downloadCatalogExport(params?: {
    ruleId?: string;
    priority?: string;
    stock?: 'in_stock' | 'out_of_stock' | 'unknown' | '';
    category?: string;
  }) {
    const q = new URLSearchParams();
    if (params?.ruleId) q.set('ruleId', params.ruleId);
    if (params?.priority) q.set('priority', params.priority);
    if (params?.stock) q.set('stock', params.stock);
    if (params?.category) q.set('category', params.category);
    const qs = q.toString();
    const res = await fetch(`${CATALOG_API}/export${qs ? `?${qs}` : ''}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Erro ${res.status}`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || `catalogo-problemas-${new Date().toISOString().slice(0, 10)}.csv`;
    const count = Number(res.headers.get('X-Export-Count') || 0);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { filename, count };
  },

  /** Inventário completo Bling (com e sem problema) — para gerente. */
  async downloadFullCatalogInventory(params?: {
    status?: 'A' | 'I' | '';
    stock?: 'in_stock' | 'out_of_stock' | 'unknown' | '';
    scope?: 'jewelry' | 'bible' | 'other' | '';
  }) {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.stock) q.set('stock', params.stock);
    if (params?.scope) q.set('scope', params.scope);
    const qs = q.toString();
    const res = await fetch(`${CATALOG_API}/inventory.csv${qs ? `?${qs}` : ''}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Erro ${res.status}`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || `inventario-catalogo-bling-${new Date().toISOString().slice(0, 10)}.csv`;
    const count = Number(res.headers.get('X-Export-Count') || 0);
    const withProblems = Number(res.headers.get('X-With-Problems') || 0);
    const withoutProblems = Number(res.headers.get('X-Without-Problems') || 0);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { filename, count, withProblems, withoutProblems };
  },

  /** Produtos que não são semijoia nem Bíblia (candidatos a fantasma). */
  async listOutOfScopeProducts(params?: {
    search?: string;
    category?: string;
    stock?: 'in_stock' | 'out_of_stock' | 'unknown' | '';
    limit?: number;
  }) {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.category) q.set('category', params.category);
    if (params?.stock) q.set('stock', params.stock);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiCatalog<{
      products: Array<{
        externalId: string;
        sku?: string;
        name?: string;
        price?: number | null;
        category?: string;
        brand?: string;
        status?: string;
        stockQty?: number | null;
        weight?: number | null;
        ncm?: string;
        imageCount?: number;
        reviewStatus?: string;
      }>;
      total: number;
      truncated: boolean;
      counts: { jewelry: number; bible: number; other: number };
      byCategory: Array<{ name: string; count: number }>;
    }>(`/out-of-scope${qs ? `?${qs}` : ''}`);
  },

  async downloadOutOfScopeExport(params?: {
    search?: string;
    category?: string;
    stock?: 'in_stock' | 'out_of_stock' | 'unknown' | '';
  }) {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.category) q.set('category', params.category);
    if (params?.stock) q.set('stock', params.stock);
    const qs = q.toString();
    const res = await fetch(`${CATALOG_API}/out-of-scope.csv${qs ? `?${qs}` : ''}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Erro ${res.status}`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || `produtos-fora-escopo-${new Date().toISOString().slice(0, 10)}.csv`;
    const count = Number(res.headers.get('X-Export-Count') || 0);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { filename, count };
  },

  async listCatalogCompare(params?: {
    search?: string;
    diff?: string;
    stock?: 'in_stock' | 'out_of_stock' | 'unknown' | '';
    limit?: number;
  }) {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.diff) q.set('diff', params.diff);
    if (params?.stock) q.set('stock', params.stock);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiCatalog<{
      rows: Array<{
        sku: string;
        bling: {
          id: string;
          sku?: string;
          name?: string;
          stockQty?: number | null;
          imageCount?: number;
          price?: number | null;
          weight?: number | null;
          height?: number | null;
          width?: number | null;
          length?: number | null;
        } | null;
        woo: {
          id: string;
          sku?: string;
          name?: string;
          stockQty?: number | null;
          imageCount?: number;
          price?: number | null;
          salePrice?: number | null;
          weight?: number | null;
          height?: number | null;
          width?: number | null;
          length?: number | null;
        } | null;
        diffs: string[];
      }>;
      total: number;
      truncated: boolean;
      matched: number;
      blingOnly: number;
      wooOnly: number;
      withDiffs: number;
      wooCount: number;
      blingCount: number;
    }>(`/compare${qs ? `?${qs}` : ''}`);
  },

  async downloadCatalogCompare(params?: {
    search?: string;
    diff?: string;
    stock?: 'in_stock' | 'out_of_stock' | 'unknown' | '';
  }) {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.diff) q.set('diff', params.diff);
    if (params?.stock) q.set('stock', params.stock);
    const qs = q.toString();
    const res = await fetch(`${CATALOG_API}/compare.csv${qs ? `?${qs}` : ''}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Erro ${res.status}`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || `comparador-bling-woo-${new Date().toISOString().slice(0, 10)}.csv`;
    const count = Number(res.headers.get('X-Export-Count') || 0);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { filename, count };
  },

  /** Clones Woo SKU=ID × SKU real no Bling (mesmo nome). */
  async listWooIdClones(params?: {
    search?: string;
    confidence?: 'high' | 'medium' | 'low' | '';
    cloneStatus?: 'active' | 'inactive' | 'all' | '';
    limit?: number;
  }) {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.confidence) q.set('confidence', params.confidence);
    if (params?.cloneStatus) q.set('cloneStatus', params.cloneStatus);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiCatalog<{
      rows: Array<{
        name: string;
        confidence: 'high' | 'medium' | 'low' | string;
        action: string;
        woo: {
          id: string;
          sku?: string;
          status?: string;
          price?: number | null;
          stockQty?: number | null;
          imageCount?: number;
        };
        clone: {
          id: string;
          sku?: string;
          status?: string;
          price?: number | null;
          stockQty?: number | null;
          imageCount?: number;
        };
        keep: {
          id: string;
          sku?: string;
          status?: string;
          price?: number | null;
          stockQty?: number | null;
          imageCount?: number;
        } | null;
      }>;
      total: number;
      truncated: boolean;
      counts: {
        wooSkuEqId: number;
        withCloneInBling: number;
        withRealAlt: number;
        high: number;
        medium: number;
        low: number;
        listed: number;
      };
    }>(`/woo-id-clones${qs ? `?${qs}` : ''}`);
  },

  async downloadWooIdClonesExport(params?: {
    search?: string;
    confidence?: 'high' | 'medium' | 'low' | '';
    cloneStatus?: 'active' | 'inactive' | 'all' | '';
  }) {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.confidence) q.set('confidence', params.confidence);
    if (params?.cloneStatus) q.set('cloneStatus', params.cloneStatus);
    const qs = q.toString();
    const res = await fetch(`${CATALOG_API}/woo-id-clones.csv${qs ? `?${qs}` : ''}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Erro ${res.status}`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || `clones-woo-id-bling-${new Date().toISOString().slice(0, 10)}.csv`;
    const count = Number(res.headers.get('X-Export-Count') || 0);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { filename, count };
  },

  async listPhotoImportCandidates(params?: { limit?: number }) {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiCatalog<{
      candidates: Array<{
        sku: string;
        blingId: string;
        wooId: string;
        name?: string;
        wooImageCount: number;
        urls: string[];
      }>;
      total: number;
      truncated: boolean;
    }>(`/photo-import/candidates${qs ? `?${qs}` : ''}`);
  },

  async getPhotoImportJob() {
    return apiCatalog<{
      job: {
        id: string;
        status: string;
        startedAt: number;
        finishedAt?: number;
        total: number;
        done: number;
        ok: number;
        failed: number;
        skipped: number;
        dryRun?: boolean;
        message?: string;
        currentSku?: string;
        errors: Array<{ sku: string; blingId: string; error: string }>;
      } | null;
    }>('/photo-import/job');
  },

  async startPhotoImport(params?: { limit?: number; delayMs?: number; dryRun?: boolean }) {
    return apiCatalog<{
      alreadyRunning: boolean;
      job: Record<string, unknown> | null;
    }>('/photo-import/start', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  },

  async cancelPhotoImport() {
    return apiCatalog<{ ok: boolean; message?: string }>('/photo-import/cancel', {
      method: 'POST',
      body: '{}',
    });
  },

  async listImageOptimizeCandidates(params?: { source?: string; limit?: number }) {
    const q = new URLSearchParams();
    if (params?.source) q.set('source', params.source);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiCatalog<{
      candidates: Array<{
        source: 'bling' | 'woo';
        sku: string;
        externalId: string;
        blingId?: string | null;
        name?: string;
        flaggedCount: number;
        imageCount: number;
        maxWidth: number;
        maxHeight: number;
        maxBytes: number;
        canOptimize?: boolean;
        urls?: string[];
      }>;
      total: number;
      truncated: boolean;
      scannedAt?: number | null;
      minPx?: number;
      minBytes?: number;
    }>(`/image-optimize/candidates${qs ? `?${qs}` : ''}`);
  },

  async getImageOptimizeJob() {
    return apiCatalog<{
      job: {
        id: string;
        kind?: string;
        status: string;
        startedAt: number;
        finishedAt?: number;
        total: number;
        done: number;
        ok: number;
        failed: number;
        skipped: number;
        flaggedProducts?: number;
        dryRun?: boolean;
        message?: string;
        currentSku?: string;
        candidateCount?: number;
        errors: Array<{ sku: string; blingId: string; error: string }>;
      } | null;
    }>('/image-optimize/job');
  },

  async startImageOptimizeScan(params?: {
    minPx?: number;
    minBytes?: number;
    source?: string;
    limit?: number;
  }) {
    return apiCatalog<{
      alreadyRunning: boolean;
      job: Record<string, unknown> | null;
    }>('/image-optimize/scan', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  },

  async startImageOptimize(params?: {
    blingIds?: string[];
    dryRun?: boolean;
    delayMs?: number;
  }) {
    return apiCatalog<{
      alreadyRunning: boolean;
      job: Record<string, unknown> | null;
      error?: string;
    }>('/image-optimize/start', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  },

  async cancelImageOptimize() {
    return apiCatalog<{ ok: boolean; message?: string }>('/image-optimize/cancel', {
      method: 'POST',
      body: '{}',
    });
  },
};

export default platformService;
