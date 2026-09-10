/** Formatação de telefone WhatsApp no front (evita mostrar LID interno). */

export function digitsOnly(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

export function isWhatsAppLid(value: string | null | undefined): boolean {
  const d = digitsOnly(value);
  return d.length > 13;
}

export function formatPhoneLabel(value: string | null | undefined): string {
  const d = digitsOnly(value);
  if (!d) return 'Número indisponível';
  if (isWhatsAppLid(d)) return 'WhatsApp (número oculto)';
  let n = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return d;
}
