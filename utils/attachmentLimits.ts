export const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 32 * 1024 * 1024;

export function getAttachmentMaxBytes(file: File): number {
  if (file.type.startsWith('audio/')) return AUDIO_MAX_BYTES;
  if (file.type.startsWith('video/')) return VIDEO_MAX_BYTES;
  return IMAGE_MAX_BYTES;
}

export function getAttachmentLimitLabel(file: File): string {
  if (file.type.startsWith('audio/')) return '20 MB para áudio';
  if (file.type.startsWith('video/')) return '32 MB para vídeo (será comprimido no envio)';
  return '10 MB';
}
