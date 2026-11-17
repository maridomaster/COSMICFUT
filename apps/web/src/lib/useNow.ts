import { useEffect, useState } from 'react';

/** Relógio que re-renderiza a cada `ms` (para textos relativos como "salvo há 3 min"). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
