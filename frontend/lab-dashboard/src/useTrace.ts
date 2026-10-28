import { useEffect, useState } from 'react';
import { lab, TraceDetail } from './api';
import { useLab } from './store';

/** Loads one trace and re-loads it whenever new spans for it arrive (async consumers come later). */
export function useTrace(traceId: string | null | undefined) {
  const { traces } = useLab();
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const spanCount = traces.find((t) => t.traceId === traceId)?.spanCount;
  useEffect(() => {
    if (!traceId) return setDetail(null);
    let alive = true;
    lab<TraceDetail>('GET', `/traces/${traceId}`)
      .then((d) => alive && (setDetail(d), setError(null)))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [traceId, spanCount]);
  return { detail, error };
}
