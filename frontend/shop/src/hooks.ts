import { useEffect, useState } from 'react';
import { api, StockInfo } from './api';

/** Stock comes from a DIFFERENT service than the product data. If it fails, the page still renders. */
export function useStock(ids: string[]) {
  const [stock, setStock] = useState<Record<string, StockInfo>>({});
  const [failed, setFailed] = useState(false);
  const key = ids.join(',');
  useEffect(() => {
    if (!key) return;
    let alive = true;
    api<{ items: StockInfo[] }>('GET', `/api/inventory?productIds=${key}`)
      .then((r) => {
        if (!alive) return;
        setStock(Object.fromEntries(r.items.map((s) => [s.productId, s])));
        setFailed(false);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [key]);
  return { stock, failed };
}
