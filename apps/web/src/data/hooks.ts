import { useEffect, useMemo, useState } from 'react';
import type { ClubBundle, ClubIndexEntry, Country, Division, StateChampionship, Trait } from '@cosmicfut/shared';
import { loadClub, loadClubIndex, loadCountries, loadLeagues, loadStates, loadTraits, type Sourced } from './source';

export interface AsyncState<T> {
  data: T | undefined;
  origin: Sourced<T>['origin'] | undefined;
  error: Error | undefined;
  loading: boolean;
}

function useSourced<T>(loader: (() => Promise<Sourced<T>>) | null, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, origin: undefined, error: undefined, loading: !!loader });
  useEffect(() => {
    if (!loader) {
      setState({ data: undefined, origin: undefined, error: undefined, loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    loader()
      .then((r) => alive && setState({ data: r.data, origin: r.origin, error: undefined, loading: false }))
      .catch((e: Error) => alive && setState({ data: undefined, origin: undefined, error: e, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export const useClubIndex = () => useSourced<ClubIndexEntry[]>(loadClubIndex, []);
export const useCountries = () => useSourced<Country[]>(loadCountries, []);
export const useTraits = () => useSourced<Trait[]>(loadTraits, []);
export const useLeagues = () => useSourced<Division[]>(loadLeagues, []);
export const useStates = () => useSourced<StateChampionship[]>(loadStates, []);
export const useClubBundle = (id: string | null) => useSourced<ClubBundle>(id ? () => loadClub(id) : null, [id]);

/** Mapa id → país, para bandeiras e nomes. */
export function useCountryMap() {
  const { data } = useCountries();
  return useMemo(() => new Map((data ?? []).map((c) => [c.id, c])), [data]);
}

/** Mapa id → trait (rótulos pt-BR das características). */
export function useTraitMap() {
  const { data } = useTraits();
  return useMemo(() => new Map((data ?? []).map((t) => [t.id, t])), [data]);
}

export function useLeagueMap() {
  const { data } = useLeagues();
  return useMemo(() => new Map((data ?? []).map((d) => [d.id, d])), [data]);
}
