import { createContext, useContext } from 'react';
import type { ClubBundle } from '@cosmicfut/shared';
import type { DataOrigin } from '@/data/source';

export interface ClubContextValue {
  bundle: ClubBundle;
  origin: DataOrigin;
}

export const ClubContext = createContext<ClubContextValue | null>(null);

export function useCurrentClub(): ClubContextValue {
  const v = useContext(ClubContext);
  if (!v) throw new Error('useCurrentClub fora do AppShell');
  return v;
}
