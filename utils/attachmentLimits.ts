export const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 32 * 1024 * 1024;

export const VIDEO_DISPATCH_WARNING =
  'Vídeo em disparo em massa pode travar a sessão do WhatsApp. Preferir imagem + áudio + texto (Palavra do Dia). Vídeo curto só em teste / poucos grupos.';

export function isVideoAttachment(file: { type?: string; name?: string }): boolean {
  if (String(file.type || '').startsWith('video/')) return true;
  return /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(String(file.name || ''));
}

export function hasVideoAttachment(files: Array<{ type?: string; name?: string }> | null | undefined): boolean {
  return (files || []).some(isVideoAttachment);
}

export function getAttachmentMaxBytes(file: File): number {
  if (file.type.startsWith('audio/')) return AUDIO_MAX_BYTES;
  if (file.type.startsWith('video/')) return VIDEO_MAX_BYTES;
  return IMAGE_MAX_BYTES;
}

export function getAttachmentLimitLabel(file: File): string {
  if (file.type.startsWith('audio/')) return '20 MB para áudio';
  if (file.type.startsWith('video/')) return '32 MB para vídeo (risco de travar a sessão)';
  return '10 MB';
}
