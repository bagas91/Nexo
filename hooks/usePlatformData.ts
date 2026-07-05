import { useCallback, useEffect, useState } from 'react';
import platformService from '../services/platformService';

export function usePlatformKv<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await platformService.getKv<T>(key);
      setValue(data ?? fallback);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [key, fallback]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(async (next: T) => {
    const saved = await platformService.setKv(key, next);
    setValue(saved);
    return saved;
  }, [key]);

  return { value, setValue, save, loading, error, refresh };
}

export function usePlatformEntities<T extends { id: string }>(type: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await platformService.listEntities<T>(type);
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(async (entity: T) => {
    const saved = await platformService.saveEntity(type, entity);
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
    return saved;
  }, [type]);

  const remove = useCallback(async (id: string) => {
    await platformService.deleteEntity(type, id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, [type]);

  return { items, loading, error, refresh, save, remove };
}

export function useIntegrationEvents(source?: 'woocommerce' | 'bling') {
  const [events, setEvents] = useState<Awaited<ReturnType<typeof platformService.listIntegrationEvents>>>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await platformService.listIntegrationEvents(source));
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { events, loading, refresh };
}
