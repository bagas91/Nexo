import { ChatEntity, ConnectionStatus, ScheduledMessage, FileAttachment, HistoryEntry, Category, DispatchEntry, DispatchTarget, BulkSendResult, SendProgressState, User, ContentItem, ContentItemStatus, MediaLayout } from '../types';

const API_BASE = '/api';
const TOKEN_KEY = 'va_token';
const USER_KEY = 'va_user';

export class BackendService {
  private static instance: BackendService;
  private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private sendInProgress = false;
  private statusCheckInterval: number | null = null;
  private authToken: string | null = null;

  private constructor() {
    if (typeof localStorage !== 'undefined') {
      this.authToken = localStorage.getItem(TOKEN_KEY);
    }
    this.startStatusCheck();
  }

  static getInstance() {
    if (!this.instance) this.instance = new BackendService();
    return this.instance;
  }

  setToken(token: string | null) {
    this.authToken = token;
    if (typeof localStorage === 'undefined') return;
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  static saveUser(user: User | null) {
    if (typeof localStorage === 'undefined') return;
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  }

  static loadUser(): User | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h['Content-Type'] = 'application/json';
    const token = this.authToken || (typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null);
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }

  private startStatusCheck() {
    if (this.statusCheckInterval) return;

    this.statusCheckInterval = window.setInterval(async () => {
      try {
        const statusData = await this.getStatus();
        this.status = statusData.status;
        this.sendInProgress = statusData.sendInProgress;
      } catch (err) {
        console.error('Erro ao verificar status:', err);
      }
    }, 2000); // Verifica a cada 2 segundos
  }

  async login(email: string, pass: string): Promise<{ user: User; token: string }> {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error((data && data.error) || 'Usuário ou senha inválidos');
    }
    this.setToken(data.token);
    BackendService.saveUser(data.user);
    return data;
  }

  async getMe(): Promise<User> {
    const res = await fetch(`${API_BASE}/me`, { headers: this.headers() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sessão inválida');
    return data.user;
  }

  logout() {
    this.setToken(null);
    BackendService.saveUser(null);
  }

  async getStatus(): Promise<{
    status: ConnectionStatus;
    qr?: string;
    pairingCode?: string;
    pairingPhone?: string;
    sendInProgress?: boolean;
    chatsSyncInProgress?: boolean;
    dispatchPaused?: boolean;
  }> {
    try {
      const res = await fetch(`${API_BASE}/status`, { headers: this.headers() });
      const data = await res.json();
      const sendInProgress = !!(data.sendInProgress || data.scheduleWorkerRunning || (data.sendInProgressCount > 0));
      this.sendInProgress = sendInProgress;
      return {
        status: data.status as ConnectionStatus,
        qr: data.qr,
        pairingCode: data.pairingCode,
        pairingPhone: data.pairingPhone,
        sendInProgress,
        chatsSyncInProgress: !!data.chatsSyncInProgress,
        dispatchPaused: !!data.dispatchPaused,
      };
    } catch (err) {
      return { status: ConnectionStatus.DISCONNECTED, sendInProgress: false, dispatchPaused: false };
    }
  }

  isSendInProgress(): boolean {
    return this.sendInProgress;
  }

  async getSendProgress(): Promise<SendProgressState> {
    try {
      const res = await fetch(`${API_BASE}/send-progress`, { headers: this.headers() });
      if (!res.ok) {
        return this.emptySendProgress();
      }
      return await res.json();
    } catch {
      return this.emptySendProgress();
    }
  }

  async stopAllDispatches(): Promise<{ success: boolean; paused?: number; sendingStopped?: number }> {
    const res = await fetch(`${API_BASE}/dispatch/stop-all`, {
      method: 'POST',
      headers: this.headers(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || 'Erro ao parar disparos');
    return data as { success: boolean; paused?: number; sendingStopped?: number };
  }

  async resumeDispatches(opts?: { unpauseSchedules?: boolean }): Promise<{ success: boolean; unpaused?: number }> {
    const res = await fetch(`${API_BASE}/dispatch/resume`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ unpauseSchedules: !!opts?.unpauseSchedules }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || 'Erro ao reativar disparos');
    return data as { success: boolean; unpaused?: number };
  }

  private emptySendProgress(): SendProgressState {
    return {
      active: false,
      status: 'idle',
      source: null,
      sourceLabel: null,
      scheduleId: null,
      total: 0,
      current: 0,
      sent: 0,
      failed: 0,
      done: 0,
      percent: 0,
      currentChatName: null,
      currentChatId: null,
      startedAt: null,
      finishedAt: null,
      log: []
    };
  }

  async connect() {
    try {
      const res = await fetch(`${API_BASE}/qr`, { headers: this.headers() });
      if (res.ok) {
        const data = await res.json();
        if (data.qr) {
          this.status = ConnectionStatus.QR_READY;
          return data.qr;
        }
      }
      return null;
    } catch (err) {
      console.error('Erro ao buscar QR:', err);
      return null;
    }
  }

  async startPairingCode(phoneNumber: string): Promise<{ pairingCode?: string; pairingPhone?: string; generating: boolean }> {
    const res = await fetch(`${API_BASE}/pairing-code`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ phoneNumber }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Não foi possível iniciar o pareamento.');
    }
    if (data.pairingCode) {
      this.status = ConnectionStatus.PAIRING_CODE_READY;
    }
    return {
      pairingCode: data.pairingCode,
      pairingPhone: data.pairingPhone,
      generating: !!data.generating,
    };
  }

  async pollPairingCode(
    targetPhone: string,
    maxAttempts = 28,
    intervalMs = 2000
  ): Promise<{ pairingCode: string; pairingPhone?: string }> {
    const normalized = targetPhone.replace(/\D/g, '');
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const res = await fetch(`${API_BASE}/status`, { headers: this.headers() });
      const data = await res.json();
      if (data.pairingError) {
        throw new Error(String(data.pairingError));
      }
      if (data.pairingCode && String(data.pairingPhone || '').replace(/\D/g, '') === normalized) {
        this.status = ConnectionStatus.PAIRING_CODE_READY;
        return { pairingCode: data.pairingCode, pairingPhone: data.pairingPhone };
      }
      if (data.status === ConnectionStatus.CONNECTED) {
        this.status = ConnectionStatus.CONNECTED;
        throw new Error('WhatsApp conectou antes de exibir o código.');
      }
    }
    throw new Error('WhatsApp não gerou o código. Use a aba QR Code — escaneie com seu celular.');
  }

  async cancelPairingCode(): Promise<void> {
    await fetch(`${API_BASE}/pairing-code/cancel`, {
      method: 'POST',
      headers: this.headers(true),
    });
  }

  async confirmSync() {
    // Verifica se está conectado
    const { status } = await this.getStatus();
    if (status === ConnectionStatus.CONNECTED) {
      this.status = ConnectionStatus.CONNECTED;
      return;
    }

    // Aguarda conexão (polling)
    return new Promise<void>((resolve) => {
      const checkConnection = async () => {
        const { status: currentStatus } = await this.getStatus();
        if (currentStatus === ConnectionStatus.CONNECTED) {
          this.status = ConnectionStatus.CONNECTED;
          resolve();
        } else {
          setTimeout(checkConnection, 1000);
        }
      };
      checkConnection();
    });
  }

  async getChats(): Promise<ChatEntity[]> {
    try {
      const res = await fetch(`${API_BASE}/chats`, { headers: this.headers() });
      if (!res.ok) return [];
      return await res.json();
    } catch (err) {
      console.error('Erro ao buscar chats:', err);
      return [];
    }
  }

  async getChatsPaginated(offset: number = 0, limit: number = 10): Promise<{ chats: ChatEntity[], total: number }> {
    try {
      const res = await fetch(`${API_BASE}/chats/paginated?offset=${offset}&limit=${limit}`, { headers: this.headers() });
      if (!res.ok) return { chats: [], total: 0 };
      return await res.json();
    } catch (err) {
      console.error('Erro ao buscar chats paginados:', err);
      return { chats: [], total: 0 };
    }
  }

  async refreshChats(): Promise<void> {
    try {
      await fetch(`${API_BASE}/chats/refresh`, { method: 'POST', headers: this.headers() });
    } catch (err) {
      console.error('Erro ao atualizar chats:', err);
    }
  }

  async scheduleMessage(msg: Omit<ScheduledMessage, 'id' | 'status'>): Promise<ScheduledMessage> {
    const res = await fetch(`${API_BASE}/schedules`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        content: msg.content,
        targets: msg.targets,
        scheduledAt: msg.scheduledAt,
        repeatDaily: msg.repeatDaily,
        attachments: msg.attachments,
        mediaLayout: msg.mediaLayout || 'caption_on_image',
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Falha ao criar agendamento');
    }
    return await res.json();
  }

  async getSchedules(): Promise<ScheduledMessage[]> {
    try {
      const res = await fetch(`${API_BASE}/schedules`, { headers: this.headers() });
      if (!res.ok) return [];
      const list = await res.json();
      return list.map((s: { attachmentsMeta?: { name: string; type: string }[]; [k: string]: unknown }) => ({
        ...s,
        attachments: s.attachmentsMeta?.map(m => ({ name: m.name, type: m.type, data: '', previewUrl: '' })) ?? []
      }));
    } catch (err) {
      console.error('Erro ao buscar agendamentos:', err);
      return [];
    }
  }

  async sendToChat(
    chatId: string,
    content: string,
    attachments?: FileAttachment[],
    mediaLayout?: MediaLayout
  ): Promise<void> {
    const res = await fetch(`${API_BASE}/send`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        chatId,
        content,
        attachments,
        mediaLayout: mediaLayout || 'caption_on_image',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Falha ao enviar mensagem');
    }
  }

  async sendMessageImmediately(
    content: string,
    targets: string[],
    attachments?: FileAttachment[],
    mediaLayout?: MediaLayout
  ): Promise<BulkSendResult> {
    if (targets.length === 0) {
      return { success: true, sent: 0, failed: 0 };
    }

    const res = await fetch(`${API_BASE}/send-bulk`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ chatIds: targets, content, attachments, mediaLayout: mediaLayout || 'caption_on_image' })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Falha no envio em massa');
    }

    const result: BulkSendResult = {
      success: !!data.success,
      sent: data.sent ?? 0,
      failed: data.failed ?? 0,
      errors: data.errors
    };

    if (result.failed > 0) {
      console.warn(`[Backend] Envio em massa: ${result.sent} ok, ${result.failed} falha(s)`, result.errors);
    }
    return result;
  }

  async sendScheduleNow(scheduleId: string): Promise<BulkSendResult> {
    const res = await fetch(`${API_BASE}/schedules/${scheduleId}/send-now`, {
      method: 'POST',
      headers: this.headers()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Falha ao enviar agendamento agora');
    }
    return {
      success: !!data.success,
      sent: data.sent ?? 0,
      failed: data.failed ?? 0,
      errors: data.errors
    };
  }

  async getHistory(limit: number = 50): Promise<HistoryEntry[]> {
    try {
      const res = await fetch(`${API_BASE}/history?limit=${limit}`, { headers: this.headers() });
      if (!res.ok) return [];
      return await res.json();
    } catch (err) {
      console.error('Erro ao buscar histórico:', err);
      return [];
    }
  }

  async clearHistory(): Promise<void> {
    const res = await fetch(`${API_BASE}/history/clear`, { method: 'POST', headers: this.headers() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err && err.error) || 'Falha ao limpar histórico');
    }
  }

  async getHistoryTodayCount(): Promise<number> {
    try {
      const res = await fetch(`${API_BASE}/history/today-count`, { headers: this.headers() });
      if (!res.ok) return 0;
      const data = await res.json();
      return typeof data.count === 'number' ? data.count : 0;
    } catch (err) {
      console.error('Erro ao buscar contagem de mensagens hoje:', err);
      return 0;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await fetch(`${API_BASE}/disconnect`, { method: 'POST', headers: this.headers() });
    } catch (err) {
      console.error('Erro ao desconectar WhatsApp:', err);
    }
  }

  async reconnect(): Promise<void> {
    try {
      await fetch(`${API_BASE}/reconnect`, { method: 'POST', headers: this.headers() });
    } catch (err) {
      console.error('Erro ao reconectar WhatsApp:', err);
    }
  }

  async getCategories(): Promise<Category[]> {
    try {
      const res = await fetch(`${API_BASE}/categories`, { headers: this.headers() });
      if (!res.ok) return [];
      return await res.json();
    } catch (err) {
      console.error('Erro ao buscar categorias:', err);
      return [];
    }
  }

  async saveCategory(cat: { id?: string; name: string; groupIds: string[] }): Promise<Category> {
    const method = cat.id ? 'PUT' : 'POST';
    const url = cat.id ? `${API_BASE}/categories/${cat.id}` : `${API_BASE}/categories`;
    const res = await fetch(url, {
      method,
      headers: this.headers(true),
      body: JSON.stringify({ id: cat.id, name: cat.name, groupIds: cat.groupIds })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro ao salvar categoria');
    return await res.json();
  }

  async deleteCategory(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/categories/${id}`, { method: 'DELETE', headers: this.headers() });
    if (!res.ok) throw new Error('Erro ao excluir categoria');
  }

  async recordDispatch(payload: {
    contentPreview: string;
    targets: DispatchTarget[];
    categoryNames?: string[];
    scheduledAt?: string;
  }): Promise<void> {
    try {
      await fetch(`${API_BASE}/dispatches`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.error('Erro ao registrar disparo:', err);
    }
  }

  async getDispatches(limit: number = 100): Promise<DispatchEntry[]> {
    try {
      const res = await fetch(`${API_BASE}/dispatches?limit=${limit}`, { headers: this.headers() });
      if (!res.ok) return [];
      return await res.json();
    } catch (err) {
      console.error('Erro ao buscar log de disparos:', err);
      return [];
    }
  }

  async getInvalidGroups(): Promise<{ id: string; name: string; usages: { categories: { id: string; name: string }[]; schedules: { id: string; scheduledAt: number; status: string }[] } }[]> {
    try {
      const res = await fetch(`${API_BASE}/chats/invalid-groups`, { headers: this.headers() });
      if (!res.ok) return [];
      const data = await res.json();
      return data.invalidGroups || [];
    } catch (err) {
      console.error('Erro ao buscar grupos inválidos:', err);
      return [];
    }
  }

  async removeGroupFromUsages(chatId: string): Promise<{ success: boolean; categoriesUpdated: number; schedulesUpdated: number; schedulesDeleted: number }> {
    const res = await fetch(`${API_BASE}/chats/remove-group-usages`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ chatId })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Falha ao remover grupo');
    }
    return await res.json();
  }

  async updateScheduleStatus(scheduleId: string, status: 'paused' | 'pending'): Promise<ScheduledMessage> {
    const res = await fetch(`${API_BASE}/schedules/${scheduleId}`, {
      method: 'PUT',
      headers: this.headers(true),
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Falha ao atualizar agendamento');
    }
    return await res.json();
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/schedules/${scheduleId}`, { method: 'DELETE', headers: this.headers() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Falha ao excluir agendamento');
    }
  }

  async getAiProviders(): Promise<{ providers: string[]; defaultProvider: string | null }> {
    const res = await fetch(`${API_BASE}/ai/providers`, { headers: this.headers() });
    if (!res.ok) throw new Error('Falha ao carregar provedores de IA');
    return res.json();
  }

  async generateAiText(params: {
    action: 'generate' | 'shorten' | 'rewrite';
    provider?: string;
    brief?: string;
    currentText?: string;
  }): Promise<{ text: string; provider: string; action: string }> {
    const res = await fetch(`${API_BASE}/ai/generate`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(params)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao gerar texto com IA');
    return data;
  }

  async generatePalavraDoDia(params: {
    reference: string;
    provider?: string;
    scheduledAt?: string;
  }): Promise<{
    text: string;
    provider: string;
    action: string;
    reference: string;
    dataExtenso: string;
    verseSource: string;
    correctedFrom?: string | null;
  }> {
    const res = await fetch(`${API_BASE}/ai/palavra-do-dia`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(params)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao gerar Palavra do Dia');
    return data;
  }

  async sendChatMessage(params: {
    messages: { role: 'user' | 'assistant'; content: string }[];
    provider?: string;
  }): Promise<{ text: string; provider: string; message: { role: 'assistant'; content: string } }> {
    const res = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(params)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha no chat com IA');
    return data;
  }

  /** Texto gerado em Templates para colar em Agendamentos */
  static savePendingScheduleContent(text: string) {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('va_pending_schedule_content', text);
    }
  }

  static loadPendingScheduleContent(): string | null {
    if (typeof sessionStorage === 'undefined') return null;
    const v = sessionStorage.getItem('va_pending_schedule_content');
    if (v) sessionStorage.removeItem('va_pending_schedule_content');
    return v;
  }

  // --- Estúdio de Conteúdo ---
  async studioGenerateCopy(params: {
    brief: string;
    action?: 'generate' | 'shorten' | 'rewrite';
    currentText?: string;
    provider?: string;
    save?: boolean;
    title?: string;
  }): Promise<{ text: string; item?: ContentItem }> {
    const res = await fetch(`${API_BASE}/studio/copy/generate`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ ...params, save: params.save ?? true })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao gerar copy');
    return data;
  }

  async studioGenerateImage(params: {
    prompt: string;
    aspectRatio?: string;
    title?: string;
    save?: boolean;
  }): Promise<{ image: { url: string; filename: string }; item?: ContentItem }> {
    const res = await fetch(`${API_BASE}/studio/image/generate`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(params)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao gerar imagem');
    return data;
  }

  async studioSaveCopy(params: { title: string; body: string; brief?: string }): Promise<ContentItem> {
    const res = await fetch(`${API_BASE}/studio/items`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(params)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao salvar');
    return data.item;
  }

  async getContentItems(params?: { status?: string; type?: string; userId?: string }): Promise<ContentItem[]> {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.type) q.set('type', params.type);
    if (params?.userId) q.set('userId', params.userId);
    const res = await fetch(`${API_BASE}/studio/items?${q}`, { headers: this.headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao carregar conteúdos');
    return data.items || [];
  }

  async updateContentItem(id: string, patch: { status?: ContentItemStatus; body?: string; title?: string }): Promise<ContentItem> {
    const res = await fetch(`${API_BASE}/studio/items/${id}`, {
      method: 'PATCH',
      headers: this.headers(true),
      body: JSON.stringify(patch)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao atualizar');
    return data.item;
  }

  contentImageUrl(filename: string, token?: string): string {
    const t = token || this.authToken || (typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : '');
    return `${API_BASE}/studio/files/${filename}${t ? `?token=${encodeURIComponent(t)}` : ''}`;
  }

  // --- Usuários (superadmin) ---
  async getUsers(): Promise<User[]> {
    const res = await fetch(`${API_BASE}/users`, { headers: this.headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao listar usuários');
    return data.users || [];
  }

  async createUser(params: {
    email: string;
    password: string;
    name: string;
    role?: string;
    modules?: string[];
    phone?: string | null;
  }): Promise<User> {
    const res = await fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(params)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao criar usuário');
    return data.user;
  }

  async updateUser(id: string, patch: {
    name?: string;
    password?: string;
    role?: string;
    active?: boolean;
    modules?: string[];
    phone?: string | null;
  }): Promise<User> {
    const res = await fetch(`${API_BASE}/users/${id}`, {
      method: 'PATCH',
      headers: this.headers(true),
      body: JSON.stringify(patch)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao atualizar usuário');
    return data.user;
  }

  async deleteUser(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/users/${id}`, {
      method: 'DELETE',
      headers: this.headers(true)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao excluir usuário');
  }

  // --- Admin controle ---
  async getAdminHealth() {
    const res = await fetch(`${API_BASE}/admin/health`, { headers: this.headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao carregar saúde');
    return data;
  }

  async getAdminAccess() {
    const res = await fetch(`${API_BASE}/admin/access`, { headers: this.headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao carregar acessos');
    return data as { modules: Array<{ id: string; label: string; groupLabel: string }>; users: User[] };
  }

  async getAdminAudit(params?: { action?: string; limit?: number; offset?: number }) {
    const q = new URLSearchParams();
    if (params?.action) q.set('action', params.action);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    const qs = q.toString();
    const res = await fetch(`${API_BASE}/admin/audit${qs ? `?${qs}` : ''}`, { headers: this.headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao carregar auditoria');
    return data as { rows: Array<Record<string, unknown>>; total: number; limit: number; offset: number };
  }

  async adminForceLogout(id: string): Promise<User> {
    const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(id)}/force-logout`, {
      method: 'POST',
      headers: this.headers(true),
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao encerrar sessão');
    return data.user;
  }

  async adminResetPassword(id: string, password: string): Promise<User> {
    const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(id)}/reset-password`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao redefinir senha');
    return data.user;
  }

  async getInboxConversations() {
    const res = await fetch(`${API_BASE}/inbox/conversations`, { headers: this.headers() });
    const data = await res.json().catch(() => []);
    if (!res.ok) throw new Error((data as { error?: string }).error || 'Erro ao carregar conversas');
    return data as Array<{
      id: string;
      contactName: string;
      phone: string;
      lastMessage: string;
      unread: number;
      status: string;
      mode: 'bot' | 'human';
      updatedAt: number;
      avatarUrl: string | null;
      needsHuman?: boolean;
      humanAlertAt?: number | null;
      notes?: string;
      lastFromMe?: boolean | null;
      unanswered?: boolean;
      unseen?: boolean;
      queueLabel?: string;
      tags?: string[];
    }>;
  }

  async getInboxMessages(chatId: string, opts?: { before?: number; limit?: number }) {
    const q = new URLSearchParams();
    if (opts?.before) q.set('before', String(opts.before));
    if (opts?.limit) q.set('limit', String(opts.limit));
    const qs = q.toString() ? `?${q}` : '';
    const res = await fetch(
      `${API_BASE}/inbox/conversations/${encodeURIComponent(chatId)}/messages${qs}`,
      { headers: this.headers() },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || 'Erro ao carregar mensagens');
    // Compat: API nova { messages, hasMore } ou array legado
    if (Array.isArray(data)) {
      return { messages: data, hasMore: false, oldestTs: data[0]?.ts ?? null };
    }
    const payload = data as {
      messages?: Array<{
        id: string;
        body: string;
        fromMe: boolean;
        ts: number;
        mediaType: 'audio' | 'image' | 'video' | 'document' | null;
        mimetype: string | null;
        mediaUrl: string | null;
      }>;
      hasMore?: boolean;
      oldestTs?: number | null;
    };
    return {
      messages: payload.messages || [],
      hasMore: !!payload.hasMore,
      oldestTs: payload.oldestTs ?? null,
    };
  }

  async markInboxRead(chatId: string) {
    await fetch(`${API_BASE}/inbox/conversations/${encodeURIComponent(chatId)}/read`, {
      method: 'POST',
      headers: this.headers(),
    });
  }

  async syncInbox() {
    const res = await fetch(`${API_BASE}/inbox/sync`, { method: 'POST', headers: this.headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || 'Erro ao sincronizar');
    return data as { synced: number };
  }

  async replyInbox(phone: string, text: string, chatId?: string) {
    const res = await fetch(`${API_BASE}/inbox/reply`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ phone, text, chatId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || 'Erro ao enviar');
    return data;
  }

  async setConversationMode(chatId: string, mode: 'bot' | 'human') {
    const res = await fetch(`${API_BASE}/inbox/conversations/${encodeURIComponent(chatId)}/mode`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ mode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || 'Erro ao alterar modo');
    return data;
  }

  async setConversationStatus(chatId: string, status: 'open' | 'pending' | 'closed') {
    const res = await fetch(`${API_BASE}/inbox/conversations/${encodeURIComponent(chatId)}/status`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || 'Erro ao alterar status');
    return data;
  }

  async setConversationNotes(chatId: string, notes: string) {
    const res = await fetch(`${API_BASE}/inbox/conversations/${encodeURIComponent(chatId)}/notes`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ notes }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || 'Erro ao salvar nota');
    return data;
  }
}
