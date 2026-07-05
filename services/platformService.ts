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
};

export default platformService;
