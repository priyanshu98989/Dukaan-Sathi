/** Dashboard data, kept in sync with MongoDB via the API. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDashboard } from '../services/api.js';

export function useDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const payload = await fetchDashboard();
      if (!mountedRef.current) return payload;
      setData(payload);
      setError('');
      return payload;
    } catch (err) {
      if (mountedRef.current) setError(err?.userMessage || 'Dashboard load nahi ho paya.');
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    items: data?.items ?? [],
    lowStock: data?.lowStock ?? { count: 0, items: [], headline: '' },
    recentActions: data?.recentActions ?? [],
    shop: data?.shop ?? 'Sharma General Store',
    loading,
    error,
    refresh,
  };
}
