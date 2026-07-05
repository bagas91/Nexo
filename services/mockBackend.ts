
import { ChatEntity, ConnectionStatus, ScheduledMessage, FileAttachment } from '../types';

const MOCK_GROUPS: ChatEntity[] = Array.from({ length: 35 }, (_, i) => ({
  id: `group-${i}`,
  name: `Grupo de Vendas ${i + 1}`,
  type: 'group',
  members: Math.floor(Math.random() * 250) + 1,
}));

const MOCK_CHANNELS: ChatEntity[] = Array.from({ length: 10 }, (_, i) => ({
  id: `channel-${i}`,
  name: `Canal de Ofertas ${i + 1}`,
  type: 'channel',
  members: Math.floor(Math.random() * 5000) + 100,
}));

export class MockBackendService {
  private static instance: MockBackendService;
  private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private schedules: ScheduledMessage[] = [];

  private constructor() {}

  static getInstance() {
    if (!this.instance) this.instance = new MockBackendService();
    return this.instance;
  }

  async login(email: string, pass: string) {
    await new Promise(r => setTimeout(r, 800));
    return { id: 'u1', email, name: 'Admin User' };
  }

  async getStatus(): Promise<ConnectionStatus> {
    return this.status;
  }

  async connect() {
    this.status = ConnectionStatus.CONNECTING;
    await new Promise(r => setTimeout(r, 1500));
    this.status = ConnectionStatus.QR_READY;
    return "https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=MOCK_WHATSAPP_SESSION_ID_" + Date.now();
  }

  async confirmSync() {
    await new Promise(r => setTimeout(r, 2000));
    this.status = ConnectionStatus.CONNECTED;
  }

  async getChats(): Promise<ChatEntity[]> {
    if (this.status !== ConnectionStatus.CONNECTED) return [];
    return [...MOCK_GROUPS, ...MOCK_CHANNELS];
  }

  async scheduleMessage(msg: Omit<ScheduledMessage, 'id' | 'status'>): Promise<ScheduledMessage> {
    const newMsg: ScheduledMessage = {
      ...msg,
      id: Math.random().toString(36).substr(2, 9),
      status: 'pending'
    };
    this.schedules.push(newMsg);
    console.log(`[VPS/whatsapp-web.js] Agendado: Mensagem com ${msg.attachments?.length || 0} anexo(s).`);
    return newMsg;
  }

  async getSchedules(): Promise<ScheduledMessage[]> {
    return this.schedules;
  }

  async sendMessageImmediately(content: string, targets: string[], attachments?: FileAttachment[]) {
    await new Promise(r => setTimeout(r, 800));
    // Simulando o processo de carregar MessageMedia do whatsapp-web.js
    if (attachments && attachments.length > 0) {
      console.log(`[VPS/whatsapp-web.js] Convertendo ${attachments.length} arquivos para MessageMedia...`);
    }
    console.log(`[VPS/whatsapp-web.js] Enviando para ${targets.length} destinos: "${content.substring(0, 20)}..."`);
    return true;
  }
}
