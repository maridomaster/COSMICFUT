import type { Position } from '@cosmicfut/shared';

export type SortKey = 'name' | 'club' | 'pos' | 'age' | 'ovr' | 'pot' | 'value' | 'wage' | 'nat';
export type SortDir = 'asc' | 'desc';

export interface SearchQuery {
  name: string;
  positions: Position[];
  ovr: [number, number];
  pot: [number, number];
  age: [number, number];
  /** valor (moeda); `null` no máximo = sem teto */
  value: [number, number | null];
  /** país do clube atual */
  clubCountry: number | null;
  /** nacionalidade do jogador */
  nat: number | null;
  league: string | null;
  club: string | null;
  /** "cabe no orçamento": valor ≤ caixa */
  maxValue: number | null;
  freeOnly: boolean;
  /** (18/11) pé bom: 'R' destro, 'L' canhoto, null = todos */
  foot?: 'R' | 'L' | null;
  /** esconde os jogadores deste clube (o seu) */
  excludeClub: string | null;
  sort: SortKey;
  dir: SortDir;
}

export interface MarketRowOut {
  id: string;
  name: string;
  pos: Position;
  age: number;
  ovr: number;
  pot: number;
  value: number;
  wage: number;
  nat: number;
  /** clube atual efetivo ('' = livre) */
  clubId: string;
  youth: boolean;
  /** (18/11) pé bom ('R'/'L'); ausente = desconhecido */
  foot?: 'R' | 'L';
}

export interface Facets {
  leagues: string[];
  clubCountries: number[];
  nats: number[];
}

/**
 * Índice de mercado: delta sobre o players-market.json com o mundo ATUAL da carreira
 * (envelhecimento, evolução, juniores gerados, transferências, aposentados). Montado no
 * thread principal (ver marketIndex.ts) e aplicado no worker de busca.
 */
export interface MarketIndex {
  /** jogadores com valores atuais (sobrescrevem a base ou viram linhas novas) */
  ids: string[];
  /** por jogador de `ids`, 6 números: idade, overall, potencial, valor, salário, júnior (0|1) */
  vals: Float64Array;
  /** por jogador de `ids`: [nome, posição, nacionalidade] — obrigatório para quem não está na base; `null` = usa a base */
  info: ([string, Position, number, ('R' | 'L')?] | null)[];
  /** overall corrente (evolução mensal) de quem não está em `ids` */
  ovr: Record<string, number>;
  /** clube atual de quem mudou ('' = livre) */
  clubs: Record<string, string>;
  /** aposentados / fora do jogo */
  removed: string[];
}

export type ToWorker =
  | { t: 'init'; marketUrl: string; clubsUrl: string; feetUrl?: string }
  | { t: 'index'; index: MarketIndex }
  | { t: 'query'; id: number; q: SearchQuery; offset: number; limit: number }
  | { t: 'ids'; id: number; ids: string[] };

export type FromWorker =
  | { t: 'ready'; total: number; ms: number; facets: Facets }
  | { t: 'indexed'; rev: number; total: number; added: number; removed: number; ms: number }
  | { t: 'error'; message: string }
  | { t: 'result'; id: number; total: number; rows: MarketRowOut[]; offset: number; ms: number }
  | { t: 'ids'; id: number; rows: MarketRowOut[] };
