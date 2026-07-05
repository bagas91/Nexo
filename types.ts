
export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  QR_READY = 'QR_READY',
  PAIRING_CODE_READY = 'PAIRING_CODE_READY',
  CONNECTED = 'CONNECTED'
}

export interface User {
  id: string;
  email: string;
  name: string;
  role?: 'superadmin' | 'creator' | 'admin' | 'user';
  active?: boolean;
}

export type ContentItemStatus = 'draft' | 'review' | 'approved';

export interface ContentItem {
  id: string;
  userId: string;
  userName: string;
  type: 'copy' | 'image';
  title: string | null;
  body: string | null;
  imageFilename: string | null;
  brief: string | null;
  status: ContentItemStatus;
  metadata: { aspectRatio?: string; url?: string } | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChatEntity {
  id: string;
  name: string;
  type: 'group' | 'channel';
  members?: number;
}

export interface FileAttachment {
  name: string;
  type: string;
  size: number;
  data: string; // Base64 string para simular o MessageMedia do whatsapp-web.js
  previewUrl: string;
}

export interface BulkSendResult {
  success: boolean;
  sent: number;
  failed: number;
  errors?: { chatId: string; chatName: string; error: string }[];
}

export type SendProgressLogType = 'info' | 'success' | 'error';

export interface SendProgressLogEntry {
  ts: number;
  type: SendProgressLogType;
  message: string;
  chatName?: string;
  chatId?: string;
  index?: number;
  total?: number;
}

export interface SendProgressState {
  active: boolean;
  status: 'idle' | 'running' | 'completed' | 'failed';
  source: 'immediate' | 'schedule' | 'worker' | null;
  sourceLabel: string | null;
  scheduleId: string | null;
  total: number;
  current: number;
  sent: number;
  failed: number;
  done: number;
  percent: number;
  currentChatName: string | null;
  currentChatId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  log: SendProgressLogEntry[];
}

/** Como imagem, texto e áudio são enviados no WhatsApp. */
export type MediaLayout =
  | 'caption_on_image'
  | 'text_separate'
  | 'short_caption_plus_text';

export interface ScheduledMessage {
  id: string;
  content: string;
  targets: string[];
  scheduledAt: string;
  status: 'pending' | 'paused' | 'sending' | 'sent' | 'failed';
  repeatDaily: boolean;
  attachments?: FileAttachment[];
  mediaLayout?: MediaLayout;
  errorMessage?: string | null;
}

export interface HistoryEntry {
  id: number;
  chatId: string;
  chatName: string;
  content: string;
  attachments: string[]; // Nomes dos arquivos
  timestamp: number;
  status: string;
}

export interface Category {
  id: string;
  name: string;
  groupIds: string[];
  updatedAt: number;
}

export interface DispatchTarget {
  id: string;
  name: string;
}

export interface DispatchEntry {
  id: number;
  contentPreview: string;
  targets: DispatchTarget[];
  categoryNames: string[];
  scheduledAt: number | null;
  createdAt: number;
}

export type View = 'dashboard' | 'groups' | 'groupdispatch' | 'scheduler' | 'history' | 'settings' | 'categories' | 'library' | 'users' | 'whatsapp' | 'assistant' | 'templates' | 'calendar' | 'followups' | 'aiagents' | 'flows' | 'contacts' | 'conversations' | 'crm' | 'campaigns';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
