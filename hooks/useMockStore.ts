import { useEffect, useState } from 'react';
import { subscribeMockStore } from '../services/mockStore';

/** Re-render when mockStore localStorage data changes. */
export function useMockStore(): void {
  const [, tick] = useState(0);
  useEffect(() => subscribeMockStore(() => tick((n) => n + 1)), []);
}
