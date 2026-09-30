import { useCallback, useEffect, useState } from 'react';
import { BackendService } from '../services/backendService';
import { BRANDING } from '../config/branding';

const BASE_TITLE = `${BRANDING.productName}`;

/**
 * Poll leve da contagem de conversas que precisam de humano.
 * Atualiza também o título da aba do browser quando count > 0.
 */
export function useInboxNeedsHumanCount(
  enabled = true,
  intervalMs = 8000,
  channel?: 'dispatch' | 'ecommerce',
) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const list = await BackendService.getInstance().getInboxConversations(channel);
      const n = list.filter((c) => (c as { needsHuman?: boolean }).needsHuman).length;
      setCount(n);
    } catch {
      /* ignore */
    }
  }, [enabled, channel]);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    refresh();
    const id = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs, refresh]);

  useEffect(() => {
    if (!enabled || channel) return; // título só no poll “geral”
    const prev = document.title;
    document.title = count > 0 ? `(${count}) CRM · ${BASE_TITLE}` : `${BASE_TITLE}`;
    return () => {
      document.title = prev;
    };
  }, [count, enabled, channel]);

  return { count, refresh };
}

export default useInboxNeedsHumanCount;
