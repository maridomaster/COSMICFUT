/**
 * (Sala de Troféus) Registro central da identidade visual das competições: nome de exibição (pt-BR, sem
 * patrocinador), sigla, cores, emblema, troféu e nível de prestígio.
 *
 * Regras de PI (decisão do coordenador): NENHUM logo oficial é baixado ou copiado.
 *  - Emblemas: desenhos próprios em SVG (`CompetitionEmblem`), inspirados na cor/forma/motivo de cada competição real
 *    (ex.: leão coroado roxo/ciano na liga inglesa, bola estrelada na copa europeia, verde-amarelo-azul no Brasileirão,
 *    escudo azul-celeste e dourado com louros na Libertadores).
 *  - Troféus: primeiro as imagens extraídas do jogo original (`/assets/trophies/*.png`, já usadas pelo projeto e
 *    mapeadas em competitions.json → `trophy`); sem imagem, uma silhueta SVG própria (`TrophyArt`) inspirada na forma
 *    real (orelhudo, Libertadores com a figura no topo, prato, taça fina, taça com tampa...).
 *
 * Arquivo PURO (sem React, sem imports do app) para poder ser testado em Node (competitionIdentity.test.ts).
 */

export type CompetitionKind = 'league' | 'cup' | 'supercup' | 'continental' | 'state' | 'playoff';
/** Prateleira da sala de troféus. */
export type PrestigeTier = 'mundial' | 'continental' | 'nacional' | 'copa' | 'estadual' | 'outro';
export type Confed = 'CONMEBOL' | 'UEFA' | 'AFC' | 'FIFA';

export type EmblemMotif =
  | 'lion-crown' | 'star-ball' | 'swirl-ball' | 'ring' | 'flag-diamond' | 'sun' | 'laurel-shield' | 'southern-cross'
  | 'twin-shield' | 'globe' | 'globe-ring' | 'plate' | 'crown' | 'cup' | 'rosette' | 'scudetto' | 'hexagon'
  | 'armillary' | 'star' | 'diamond' | 'monogram' | 'state';

export type TrophyShape = 'big-ears' | 'figure' | 'plate' | 'slim' | 'classic' | 'lidded' | 'three-handle' | 'globe' | 'shield' | 'vase';
export type Metal = 'gold' | 'silver' | 'bronze';

export interface CompetitionColors {
  /** fundo do emblema (escuro) */
  primary: string;
  /** borda / faixa */
  secondary: string;
  /** motivo e brilho */
  accent: string;
}

export interface CompetitionIdentity {
  id: string;
  /** nome de exibição (pt-BR, sem patrocinador) */
  name: string;
  /** sigla curta (≤ 5 letras) para selos pequenos */
  short: string;
  kind: CompetitionKind;
  tier: PrestigeTier;
  /** 1 (menor) … 10 (maior): ordena dentro da prateleira */
  prestige: number;
  colors: CompetitionColors;
  emblem: EmblemMotif;
  trophy: { shape: TrophyShape; metal: Metal; /** caminho relativo a /assets (imagem do original) */ image: string | null };
  confed?: Confed;
  /** código do país (BRA, ING...) */
  country?: string;
  uf?: string;
  division?: number;
  /** vale troféu (playoffs de rebaixamento não valem) */
  awardable: boolean;
  /** competição conhecida do registro (false = identidade genérica deduzida) */
  known: boolean;
}

/* ═════════════════════ países em escopo ═════════════════════ */

/** id do país (índice do original) → código. */
export const COUNTRY_CODE_BY_ID: Record<number, string> = {
  3: 'ALE', 9: 'ARS', 11: 'ARG', 29: 'BRA', 42: 'CHI', 46: 'COL', 60: 'EQU', 65: 'ESP', 72: 'FRA', 85: 'HOL', 97: 'ING', 104: 'ITA', 150: 'PAR', 154: 'POR', 195: 'URU',
};

export const CONFED_OF_COUNTRY: Record<string, Confed> = {
  BRA: 'CONMEBOL', ARG: 'CONMEBOL', URU: 'CONMEBOL', COL: 'CONMEBOL', PAR: 'CONMEBOL', CHI: 'CONMEBOL', EQU: 'CONMEBOL',
  ING: 'UEFA', ESP: 'UEFA', ITA: 'UEFA', ALE: 'UEFA', FRA: 'UEFA', POR: 'UEFA', HOL: 'UEFA',
  ARS: 'AFC',
};

/** UFs da Copa do Nordeste. */
export const NORDESTE_UFS = new Set(['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE']);

/* ═════════════════════ paletas ═════════════════════ */

const C = (primary: string, secondary: string, accent: string): CompetitionColors => ({ primary, secondary, accent });

const tr = (name: string) => `trophies/${name}.png`;

type Def = Omit<CompetitionIdentity, 'id' | 'known' | 'awardable' | 'trophy'> & {
  awardable?: boolean;
  trophy: { shape: TrophyShape; metal?: Metal; image?: string | null };
};

const W = 'FIFA' as const;

/** Continentais, mundiais e regionais. */
const SPECIAL: Record<string, Def> = {
  LIBERTADORES: { name: 'Copa Libertadores', short: 'LIB', kind: 'continental', tier: 'continental', prestige: 10, confed: 'CONMEBOL', colors: C('#0c2340', '#74c0f0', '#e2b33c'), emblem: 'laurel-shield', trophy: { shape: 'figure', metal: 'silver', image: tr('tr-libertadores') } },
  SULAMERICANA: { name: 'Copa Sul-Americana', short: 'SUL', kind: 'continental', tier: 'continental', prestige: 8, confed: 'CONMEBOL', colors: C('#0f3570', '#38bdf8', '#f1f5f9'), emblem: 'southern-cross', trophy: { shape: 'globe', metal: 'silver', image: tr('tr-sulamericana') } },
  RECOPA: { name: 'Recopa Sul-Americana', short: 'REC', kind: 'continental', tier: 'continental', prestige: 7, confed: 'CONMEBOL', colors: C('#2e1760', '#a78bfa', '#e2b33c'), emblem: 'twin-shield', trophy: { shape: 'slim', metal: 'gold', image: tr('tr-recopasulamericana') } },
  UCL: { name: 'Liga dos Campeões', short: 'UCL', kind: 'continental', tier: 'continental', prestige: 10, confed: 'UEFA', colors: C('#0a1440', '#3654b3', '#e8edf7'), emblem: 'star-ball', trophy: { shape: 'big-ears', metal: 'silver', image: tr('tr-ligacampeoes') } },
  UEL: { name: 'Liga Europa', short: 'UEL', kind: 'continental', tier: 'continental', prestige: 8, confed: 'UEFA', colors: C('#1a1410', '#f26b1d', '#ffc48a'), emblem: 'swirl-ball', trophy: { shape: 'vase', metal: 'silver', image: tr('tr-ligaeuropa') } },
  UECL: { name: 'Liga Conferência', short: 'UECL', kind: 'continental', tier: 'continental', prestige: 7, confed: 'UEFA', colors: C('#06372b', '#19c37d', '#c7f9e3'), emblem: 'ring', trophy: { shape: 'slim', metal: 'silver', image: tr('tr-conference') } },
  'UEFA-SUP': { name: 'Supercopa da UEFA', short: 'SUE', kind: 'supercup', tier: 'continental', prestige: 7, confed: 'UEFA', colors: C('#0d1a3a', '#8aa0c8', '#ffffff'), emblem: 'star-ball', trophy: { shape: 'slim', metal: 'silver', image: tr('tr-recopaeuropa') } },
  ACL: { name: 'Liga dos Campeões da AFC', short: 'ACL', kind: 'continental', tier: 'continental', prestige: 8, confed: 'AFC', colors: C('#0b2a4a', '#00a3e0', '#f2c14e'), emblem: 'sun', trophy: { shape: 'vase', metal: 'silver', image: tr('tr-ligaafc') } },
  INTERCONTINENTAL: { name: 'Copa Intercontinental', short: 'INT', kind: 'continental', tier: 'mundial', prestige: 10, confed: W, colors: C('#063532', '#14b8a6', '#f4c542'), emblem: 'globe', trophy: { shape: 'globe', metal: 'gold', image: tr('tr-intercontinental') } },
  SUPERMUNDIAL: { name: 'Supermundial de Clubes', short: 'MUN', kind: 'continental', tier: 'mundial', prestige: 10, confed: W, colors: C('#141210', '#c9a227', '#f7e08a'), emblem: 'globe-ring', trophy: { shape: 'globe', metal: 'gold', image: tr('tr-supermundial') } },
  NORDESTE: { name: 'Copa do Nordeste', short: 'NE', kind: 'cup', tier: 'copa', prestige: 5, country: 'BRA', colors: C('#5a2a0c', '#e07a1f', '#ffd27a'), emblem: 'sun', trophy: { shape: 'classic', metal: 'gold', image: tr('tr-copanordeste') } },
  COPAVERDE: { name: 'Copa Verde', short: 'CV', kind: 'cup', tier: 'copa', prestige: 4, country: 'BRA', colors: C('#0b3d1f', '#22c55e', '#d9f99d'), emblem: 'cup', trophy: { shape: 'classic', metal: 'gold', image: tr('tr-copaverde') } },
  SULSUDESTE: { name: 'Copa Sul-Sudeste', short: 'CSS', kind: 'cup', tier: 'copa', prestige: 4, country: 'BRA', colors: C('#14284b', '#3b82f6', '#fde68a'), emblem: 'cup', trophy: { shape: 'classic', metal: 'gold', image: tr('tr-sulsudeste') } },
  COPAPAULISTA: { name: 'Copa Paulista', short: 'CP', kind: 'cup', tier: 'copa', prestige: 3, country: 'BRA', uf: 'SP', colors: C('#151515', '#e11d2e', '#ffffff'), emblem: 'cup', trophy: { shape: 'classic', metal: 'silver', image: tr('tr-copapaulista') } },
};

/** Ligas, copas e supercopas nacionais por país. `L` = divisões (nome por divisão), `cups`, `sup`. */
interface CountryDef {
  colors: CompetitionColors;
  leagueEmblem: EmblemMotif;
  leagues: [name: string, short: string, image: string | null][];
  cups: { id: string; name: string; short: string; image: string | null; emblem?: EmblemMotif; shape?: TrophyShape; colors?: CompetitionColors }[];
  sup?: { name: string; short: string; image: string | null; shape?: TrophyShape };
  /** forma do troféu da liga (silhueta) */
  leagueShape?: TrophyShape;
  playoff?: string;
}

const COUNTRIES: Record<string, CountryDef> = {
  BRA: {
    colors: C('#08502c', '#f2c12e', '#2f6fd6'), leagueEmblem: 'flag-diamond', leagueShape: 'slim',
    leagues: [['Brasileirão Série A', 'BR-A', tr('tr-nacional-bra-d1')], ['Brasileirão Série B', 'BR-B', tr('tr-nacional-bra-d2')], ['Brasileirão Série C', 'BR-C', tr('tr-nacional-bra-d3')], ['Brasileirão Série D', 'BR-D', tr('tr-nacional-bra-d4')]],
    cups: [{ id: 'BRA-CUP', name: 'Copa do Brasil', short: 'CDB', image: tr('tr-copa-bra'), emblem: 'cup', shape: 'classic', colors: C('#0a3f27', '#ffd23f', '#5b8def') }],
    sup: { name: 'Supercopa do Brasil', short: 'SCB', image: tr('tr-supercopa-bra') },
  },
  ING: {
    colors: C('#37003c', '#04f5ff', '#e90052'), leagueEmblem: 'lion-crown', leagueShape: 'lidded',
    leagues: [['Premier League', 'PL', tr('tr-nacional-ing')], ['Championship', 'EFL', tr('tr-nacional-ing-d2')]],
    cups: [
      { id: 'ING-CUP', name: 'FA Cup', short: 'FA', image: tr('tr-copa-ing'), emblem: 'crown', shape: 'lidded', colors: C('#0b2d6b', '#c8102e', '#ffffff') },
      { id: 'ING-LCUP', name: 'Copa da Liga Inglesa', short: 'EFL', image: null, emblem: 'cup', shape: 'three-handle', colors: C('#05402e', '#3ddc84', '#ffffff') },
    ],
    sup: { name: 'Community Shield', short: 'CS', image: tr('tr-supercopa-ing'), shape: 'shield' },
  },
  ESP: {
    colors: C('#3a0d0d', '#ff4b44', '#ffd166'), leagueEmblem: 'sun', leagueShape: 'classic',
    leagues: [['LaLiga', 'LL', tr('tr-nacional-esp')], ['LaLiga 2', 'LL2', tr('tr-nacional-esp-d2')]],
    cups: [{ id: 'ESP-CUP', name: 'Copa do Rei', short: 'CDR', image: tr('tr-copa-esp'), emblem: 'crown', colors: C('#5c0a12', '#c8102e', '#f1bf00') }],
    sup: { name: 'Supercopa da Espanha', short: 'SCE', image: tr('tr-supercopa-esp') },
  },
  ITA: {
    colors: C('#0b2350', '#1fa04a', '#e63946'), leagueEmblem: 'scudetto', leagueShape: 'slim',
    leagues: [['Serie A', 'SA', tr('tr-nacional-ita')], ['Serie B', 'SB', tr('tr-nacional-ita-d2')]],
    cups: [{ id: 'ITA-CUP', name: 'Copa da Itália', short: 'CI', image: tr('tr-copa-ita'), emblem: 'rosette' }],
    sup: { name: 'Supercopa da Itália', short: 'SCI', image: tr('tr-supercopa-ita') },
  },
  ALE: {
    colors: C('#1a0507', '#d20515', '#f5f5f5'), leagueEmblem: 'plate', leagueShape: 'plate',
    leagues: [['Bundesliga', 'BL', tr('tr-nacional-ale')], ['2. Bundesliga', '2BL', tr('tr-nacional-ale-d2')]],
    cups: [{ id: 'ALE-CUP', name: 'Copa da Alemanha', short: 'DFB', image: tr('tr-copa-ale'), emblem: 'cup', colors: C('#111111', '#d4af37', '#ffffff') }],
    sup: { name: 'Supercopa da Alemanha', short: 'SCA', image: tr('tr-supercopa-ale') },
    playoff: 'Playoff de rebaixamento (Alemanha)',
  },
  FRA: {
    colors: C('#0b1440', '#3b5bdb', '#e63946'), leagueEmblem: 'hexagon', leagueShape: 'vase',
    leagues: [['Ligue 1', 'L1', tr('tr-nacional-fra')], ['Ligue 2', 'L2', tr('tr-nacional-fra-d2')]],
    cups: [{ id: 'FRA-CUP', name: 'Copa da França', short: 'CDF', image: tr('tr-copa-fra'), emblem: 'rosette' }],
    sup: { name: 'Supercopa da França', short: 'TDC', image: tr('tr-supercopa-fra') },
    playoff: 'Barrage (França)',
  },
  POR: {
    colors: C('#0b1f4d', '#00a859', '#e4002b'), leagueEmblem: 'armillary', leagueShape: 'classic',
    leagues: [['Liga Portugal', 'LP', tr('tr-nacional-por')], ['Liga Portugal 2', 'LP2', tr('tr-nacional-por-d2')]],
    cups: [{ id: 'POR-CUP', name: 'Taça de Portugal', short: 'TP', image: tr('tr-copa-por'), emblem: 'rosette' }],
    sup: { name: 'Supertaça de Portugal', short: 'ST', image: tr('tr-supercopa-por') },
    playoff: 'Playoff de permanência (Portugal)',
  },
  HOL: {
    colors: C('#1b2a5e', '#ff6b00', '#ffffff'), leagueEmblem: 'monogram', leagueShape: 'plate',
    leagues: [['Eredivisie', 'ERE', tr('tr-nacional-hol')], ['Eerste Divisie', 'ED', null]],
    cups: [{ id: 'HOL-CUP', name: 'Copa da Holanda', short: 'KNVB', image: tr('tr-copa-hol'), emblem: 'cup' }],
    sup: { name: 'Supercopa da Holanda', short: 'JCS', image: tr('tr-supercopa-hol'), shape: 'plate' },
    playoff: 'Playoff de promoção (Holanda)',
  },
  ARS: {
    colors: C('#063d27', '#1fae6a', '#e2c044'), leagueEmblem: 'diamond', leagueShape: 'slim',
    leagues: [['Saudi Pro League', 'SPL', tr('tr-nacional-ars')], ['Primeira Divisão Saudita', 'SFD', null]],
    cups: [{ id: 'ARS-CUP', name: 'Copa do Rei Saudita', short: 'KC', image: tr('tr-copa-ars'), emblem: 'crown' }],
    sup: { name: 'Supercopa Saudita', short: 'SCS', image: null },
  },
  ARG: {
    colors: C('#0e3a5c', '#6cace4', '#f6b40e'), leagueEmblem: 'sun', leagueShape: 'classic',
    leagues: [['Liga Profissional Argentina', 'LPF', tr('tr-nacional-arg')], ['Primera Nacional', 'PN', tr('tr-nacional-arg-d2')]],
    cups: [{ id: 'ARG-CUP', name: 'Copa Argentina', short: 'CA', image: tr('tr-copa-arg'), emblem: 'cup' }],
    sup: { name: 'Supercopa Argentina', short: 'SCA', image: tr('tr-supercopa-arg') },
  },
  URU: {
    colors: C('#0b2a6b', '#5cbfeb', '#fcd116'), leagueEmblem: 'sun', leagueShape: 'classic',
    leagues: [['Liga Uruguaia', 'URU', tr('tr-nacional-uru')], ['Segunda Divisão Uruguaia', 'URU2', null]],
    cups: [{ id: 'URU-CUP', name: 'Copa AUF Uruguai', short: 'CAU', image: null, emblem: 'cup' }],
    sup: { name: 'Supercopa Uruguaia', short: 'SCU', image: null },
  },
  CHI: {
    colors: C('#0a2a6b', '#d52b1e', '#ffffff'), leagueEmblem: 'star', leagueShape: 'classic',
    leagues: [['Liga Chilena', 'CHI', tr('tr-nacional-chi')], ['Primera B (Chile)', 'CHI2', null]],
    cups: [{ id: 'CHI-CUP', name: 'Copa Chile', short: 'CCH', image: tr('tr-copa-chi'), emblem: 'cup' }],
    sup: { name: 'Supercopa do Chile', short: 'SCC', image: null },
  },
  COL: {
    colors: C('#0b2a6b', '#fcd116', '#ce1126'), leagueEmblem: 'star', leagueShape: 'slim',
    leagues: [['Liga Colombiana', 'COL', tr('tr-nacional-col')], ['Torneio Colombiano (2ª div.)', 'COL2', null]],
    cups: [{ id: 'COL-CUP', name: 'Copa Colômbia', short: 'CCO', image: tr('tr-copa-col'), emblem: 'cup' }],
    sup: { name: 'Superliga Colombiana', short: 'SLC', image: null },
  },
  PAR: {
    colors: C('#0b2a6b', '#d52b1e', '#ffffff'), leagueEmblem: 'star', leagueShape: 'classic',
    leagues: [['Liga Paraguaia', 'PAR', tr('tr-nacional-par')], ['Divisão Intermediária (Paraguai)', 'PAR2', null]],
    cups: [{ id: 'PAR-CUP', name: 'Copa Paraguai', short: 'CPY', image: null, emblem: 'cup' }],
    sup: { name: 'Supercopa Paraguai', short: 'SCP', image: null },
  },
  EQU: {
    colors: C('#0b2a6b', '#ffd100', '#ce1126'), leagueEmblem: 'sun', leagueShape: 'slim',
    leagues: [['LigaPro Equador', 'EQU', tr('tr-nacional-equ')]],
    cups: [{ id: 'EQU-CUP', name: 'Copa Equador', short: 'CEQ', image: null, emblem: 'cup' }],
  },
};

/* ═════════════════════ estaduais ═════════════════════ */

/** UF → [nome do estadual, maior divisão, cores (bandeira do estado)]. */
const STATES: Record<string, [string, number, CompetitionColors]> = {
  AC: ['Acreano', 2, C('#0b4d2a', '#f7d117', '#d52b1e')],
  AL: ['Alagoano', 2, C('#7a1018', '#2f6fd6', '#ffffff')],
  AM: ['Amazonense', 1, C('#0b2a6b', '#d52b1e', '#ffffff')],
  AP: ['Amapaense', 2, C('#0b4d2a', '#2f6fd6', '#f7d117')],
  BA: ['Baiano', 3, C('#0b2a6b', '#d52b1e', '#ffffff')],
  CE: ['Cearense', 3, C('#0b4d2a', '#f7d117', '#2f6fd6')],
  DF: ['Candango', 2, C('#0b4d2a', '#f7d117', '#ffffff')],
  ES: ['Capixaba', 2, C('#0b2a6b', '#ff8fb1', '#ffffff')],
  GO: ['Goiano', 3, C('#0b4d2a', '#f7d117', '#2f6fd6')],
  MA: ['Maranhense', 2, C('#7a1018', '#2f6fd6', '#ffffff')],
  MG: ['Mineiro', 3, C('#6b0f16', '#e2e8f0', '#ef4444')],
  MS: ['Sul-Mato-Grossense', 2, C('#0b4d2a', '#2f6fd6', '#f7d117')],
  MT: ['Mato-Grossense', 2, C('#0b2a6b', '#22a35a', '#f7d117')],
  PA: ['Paraense', 3, C('#7a1018', '#ffffff', '#2f6fd6')],
  PB: ['Paraibano', 3, C('#151515', '#d52b1e', '#ffffff')],
  PE: ['Pernambucano', 1, C('#0b2a6b', '#f7d117', '#d52b1e')],
  PI: ['Piauiense', 2, C('#0b4d2a', '#f7d117', '#2f6fd6')],
  PR: ['Paranaense', 3, C('#0b4d2a', '#ffffff', '#2f6fd6')],
  RJ: ['Carioca', 5, C('#0b2a6b', '#ffffff', '#e2b33c')],
  RN: ['Potiguar', 2, C('#0b4d2a', '#ffffff', '#f7d117')],
  RO: ['Rondoniense', 2, C('#0b2a6b', '#22a35a', '#f7d117')],
  RR: ['Roraimense', 1, C('#0b2a6b', '#22a35a', '#d52b1e')],
  RS: ['Gaúcho', 3, C('#0b4d2a', '#d52b1e', '#f7d117')],
  SC: ['Catarinense', 3, C('#7a1018', '#22a35a', '#ffffff')],
  SE: ['Sergipano', 3, C('#0b4d2a', '#f7d117', '#2f6fd6')],
  SP: ['Paulista', 5, C('#151515', '#ffffff', '#d52b1e')],
  TO: ['Tocantinense', 2, C('#0b2a6b', '#f7d117', '#ffffff')],
};

/** Nomes das divisões de baixo (os do registro, sem patrocínio). */
const STATE_LOWER_NAMES: Record<string, string> = {
  'AC-2': 'Acreano Série B', 'AL-2': 'Alagoano Série B', 'AP-2': 'Amapaense Série B', 'BA-2': 'Baiano Série B', 'BA-3': 'Baiano Série C',
  'CE-2': 'Cearense Série B', 'CE-3': 'Cearense Série C', 'DF-2': 'Candango Série B', 'ES-2': 'Capixaba Série B', 'GO-2': 'Goiano Série B',
  'GO-3': 'Goiano Série C', 'MA-2': 'Maranhense Série B', 'MG-2': 'Mineiro Módulo II', 'MG-3': 'Mineiro Segunda Divisão', 'MS-2': 'Sul-Mato-Grossense Série B',
  'MT-2': 'Mato-Grossense Série B', 'PA-2': 'Paraense B1', 'PA-3': 'Paraense B2', 'PB-2': 'Paraibano Série B', 'PB-3': 'Paraibano Série C',
  'PI-2': 'Piauiense Série B', 'PR-2': 'Paranaense A2', 'PR-3': 'Paranaense Terceira Divisão', 'RJ-2': 'Carioca A2', 'RJ-3': 'Carioca B1',
  'RJ-4': 'Carioca B2', 'RJ-5': 'Carioca Série C', 'RN-2': 'Potiguar Série B', 'RO-2': 'Rondoniense Série B', 'RS-2': 'Gaúcho A2',
  'RS-3': 'Gaúcho Série B', 'SC-2': 'Catarinense Série B', 'SC-3': 'Catarinense Série C', 'SE-2': 'Sergipano A2', 'SE-3': 'Sergipano A3',
  'SP-2': 'Paulista A2', 'SP-3': 'Paulista A3', 'SP-4': 'Paulista A4', 'SP-5': 'Paulista Segunda Divisão', 'TO-2': 'Tocantinense Série B',
};

/** Divisões de baixo com troféu próprio no original (as demais usam o genérico). */
const STATE_LOWER_ART = new Set(['AL-2', 'CE-2', 'CE-3', 'DF-2', 'ES-2', 'MG-2', 'MG-3', 'PA-2', 'PB-2', 'PB-3', 'PR-2', 'RJ-2', 'RJ-3', 'RJ-4', 'RN-2', 'RS-2', 'SC-2', 'SE-2', 'SP-2', 'SP-3', 'TO-2']);

/* ═════════════════════ montagem ═════════════════════ */

const REGISTRY = new Map<string, CompetitionIdentity>();

function put(id: string, d: Def) {
  REGISTRY.set(id, {
    ...d,
    id,
    known: true,
    awardable: d.awardable ?? true,
    trophy: { shape: d.trophy.shape, metal: d.trophy.metal ?? 'gold', image: d.trophy.image ?? null },
  });
}

for (const [id, d] of Object.entries(SPECIAL)) put(id, d);

for (const [code, c] of Object.entries(COUNTRIES)) {
  const confed = CONFED_OF_COUNTRY[code];
  c.leagues.forEach(([name, short, image], i) => {
    put(`${code}-${i + 1}`, {
      name, short, kind: 'league', tier: 'nacional', prestige: i === 0 ? 9 : Math.max(2, 6 - 2 * i), confed, country: code, division: i + 1,
      colors: i === 0 ? c.colors : C(c.colors.primary, c.colors.accent, c.colors.secondary),
      emblem: c.leagueEmblem, trophy: { shape: c.leagueShape ?? 'classic', metal: i === 0 ? 'gold' : 'silver', image },
    });
  });
  c.cups.forEach((cup, i) => {
    put(cup.id, {
      name: cup.name, short: cup.short, kind: 'cup', tier: 'copa', prestige: i === 0 ? 7 : 6, confed, country: code,
      colors: cup.colors ?? C(c.colors.primary, c.colors.accent, c.colors.secondary), emblem: cup.emblem ?? 'cup',
      trophy: { shape: cup.shape ?? 'classic', metal: 'gold', image: cup.image },
    });
  });
  if (c.sup) {
    put(`${code}-SUP`, {
      name: c.sup.name, short: c.sup.short, kind: 'supercup', tier: 'copa', prestige: 5, confed, country: code,
      colors: C(c.colors.primary, c.colors.secondary, '#ffffff'), emblem: 'diamond',
      trophy: { shape: c.sup.shape ?? 'slim', metal: 'silver', image: c.sup.image },
    });
  }
  if (c.playoff) {
    put(`${code}-PO`, {
      name: c.playoff, short: 'PO', kind: 'playoff', tier: 'outro', prestige: 1, confed, country: code, awardable: false,
      colors: C('#1f2937', '#64748b', '#cbd5e1'), emblem: 'monogram', trophy: { shape: 'slim', metal: 'bronze', image: null },
    });
  }
}

for (const [uf, [base, max, colors]] of Object.entries(STATES)) {
  for (let d = 1; d <= max; d++) {
    const k = `${uf}-${d}`;
    put(`EST-${k}`, {
      name: d === 1 ? base : STATE_LOWER_NAMES[k] ?? `${base} (${d}ª divisão)`, short: d === 1 ? uf : `${uf}${d}`, kind: 'state', tier: 'estadual',
      prestige: d === 1 ? 5 : Math.max(1, 4 - d), country: 'BRA', uf, division: d, colors, emblem: 'state',
      trophy: {
        shape: 'classic', metal: d === 1 ? 'gold' : 'silver',
        image: d === 1 ? tr(`tr-estadual-${uf.toLowerCase()}`) : STATE_LOWER_ART.has(k) ? tr(`tr-estadual-${uf.toLowerCase()}-d${d}`) : tr('tr-estadualgenerico'),
      },
    });
  }
}

/** Todos os ids conhecidos do registro. */
export const KNOWN_COMPETITION_IDS: readonly string[] = [...REGISTRY.keys()];

const GENERIC_COLORS = C('#1e293b', '#64748b', '#e2e8f0');

/**
 * Identidade de uma competição. Ids desconhecidos (ex.: competição nova da engine) recebem uma identidade genérica
 * deduzida pelo padrão do id/tipo e pelo nome (`hint`), nunca `undefined`.
 */
export function competitionIdentity(id: string, hint?: { name?: string; type?: string }): CompetitionIdentity {
  const known = REGISTRY.get(id);
  if (known) return known;
  const name = hint?.name ?? id;
  const st = /^EST-([A-Z]{2})-(\d+)$/.exec(id);
  if (st) {
    const [, uf, dv] = st;
    const colors = STATES[uf]?.[2] ?? GENERIC_COLORS;
    return { id, name, short: uf, kind: 'state', tier: 'estadual', prestige: 2, colors, emblem: 'state', trophy: { shape: 'classic', metal: 'silver', image: tr('tr-estadualgenerico') }, country: 'BRA', uf, division: Number(dv), awardable: true, known: false };
  }
  const nat = /^([A-Z]{3})-(\d+|CUP|LCUP|SUP|PO)$/.exec(id);
  const code = nat?.[1];
  const colors = (code && COUNTRIES[code]?.colors) || GENERIC_COLORS;
  const type = hint?.type;
  if (nat?.[2] === 'PO') {
    return { id, name, short: 'PO', kind: 'playoff', tier: 'outro', prestige: 1, colors: GENERIC_COLORS, emblem: 'monogram', trophy: { shape: 'slim', metal: 'bronze', image: null }, country: code, awardable: false, known: false };
  }
  const kind: CompetitionKind =
    nat && /^\d+$/.test(nat[2]) ? 'league' : nat?.[2] === 'SUP' || type === 'supercup' ? 'supercup' : type === 'continental' ? 'continental' : type === 'league' ? 'league' : type === 'state' ? 'state' : 'cup';
  const tier: PrestigeTier = kind === 'league' ? 'nacional' : kind === 'continental' ? 'continental' : kind === 'state' ? 'estadual' : 'copa';
  const short = initials(name);
  return {
    id, name, short, kind, tier, prestige: kind === 'league' ? 4 : 3, colors, emblem: kind === 'league' ? 'star' : kind === 'supercup' ? 'diamond' : 'cup',
    trophy: { shape: kind === 'league' ? 'slim' : 'classic', metal: 'silver', image: kind === 'league' ? tr('tr-nacionalgenerico') : kind === 'supercup' ? tr('tr-supercopa-generico') : tr('tr-copa') },
    ...(code ? { country: code, confed: CONFED_OF_COUNTRY[code] } : {}),
    ...(nat && /^\d+$/.test(nat[2]) ? { division: Number(nat[2]) } : {}),
    awardable: true, known: false,
  };
}

function initials(name: string): string {
  const w = name.split(/[\s-]+/).filter((x) => x && !/^(de|da|do|dos|das|e|la|del)$/i.test(x));
  return (w.length >= 2 ? w.slice(0, 3).map((x) => x[0]).join('') : name.slice(0, 3)).toUpperCase();
}

/* ═════════════════════ prateleiras e competições ganháveis ═════════════════════ */

export type Shelf = 'mundial' | 'nacional' | 'copas' | 'estaduais';

export const SHELF_LABEL: Record<Shelf, string> = {
  mundial: 'Mundial e Continental',
  nacional: 'Nacional',
  copas: 'Copas',
  estaduais: 'Estaduais',
};
export const SHELVES: Shelf[] = ['mundial', 'nacional', 'copas', 'estaduais'];

export function shelfOf(idt: Pick<CompetitionIdentity, 'tier'>): Shelf | null {
  switch (idt.tier) {
    case 'mundial':
    case 'continental':
      return 'mundial';
    case 'nacional':
      return 'nacional';
    case 'copa':
      return 'copas';
    case 'estadual':
      return 'estaduais';
    default:
      return null;
  }
}

/** Ordem dentro da prateleira: prestígio (desc), mundial antes de continental, divisão, nome. */
export function compareIdentity(a: CompetitionIdentity, b: CompetitionIdentity): number {
  const t = (x: CompetitionIdentity) => (x.tier === 'mundial' ? 0 : 1);
  return t(a) - t(b) || b.prestige - a.prestige || (a.division ?? 0) - (b.division ?? 0) || a.name.localeCompare(b.name, 'pt-BR');
}

/**
 * Competições que um clube pode ganhar (a sala mostra todas, ganhas ou não):
 *  - liga nacional (1ª divisão) + copas + supercopa do país;
 *  - estadual da UF (1ª divisão) e copa regional (Nordeste) para brasileiros;
 *  - continentais da confederação + Intercontinental e Supermundial;
 *  - tudo o que o clube já disputou (`played`, ex.: Série B, estadual de baixo) ou ganhou (`won`).
 * Playoffs de rebaixamento e competições desligadas (Copa Verde, Sul-Sudeste, Copa Paulista) ficam de fora, salvo se
 * disputadas.
 */
export function winnableCompetitionIds(ctx: { country?: string | null; uf?: string | null; played?: Iterable<string>; won?: Iterable<string> }): string[] {
  const out = new Set<string>();
  const code = ctx.country ?? null;
  const confed = code ? CONFED_OF_COUNTRY[code] : undefined;
  if (confed === 'CONMEBOL') ['LIBERTADORES', 'SULAMERICANA', 'RECOPA'].forEach((x) => out.add(x));
  if (confed === 'UEFA') ['UCL', 'UEL', 'UECL', 'UEFA-SUP'].forEach((x) => out.add(x));
  if (confed === 'AFC') out.add('ACL');
  if (confed) ['INTERCONTINENTAL', 'SUPERMUNDIAL'].forEach((x) => out.add(x));
  if (code && COUNTRIES[code]) {
    out.add(`${code}-1`);
    for (const c of COUNTRIES[code].cups) out.add(c.id);
    if (COUNTRIES[code].sup) out.add(`${code}-SUP`);
  }
  if (code === 'BRA' && ctx.uf) {
    if (STATES[ctx.uf]) out.add(`EST-${ctx.uf}-1`);
    if (NORDESTE_UFS.has(ctx.uf)) out.add('NORDESTE');
  }
  for (const id of [...(ctx.played ?? []), ...(ctx.won ?? [])]) out.add(id);
  return [...out].filter((id) => competitionIdentity(id).awardable);
}

/**
 * (18/11) Cor de texto por tipo de competição (listas de jogos): cada tipo com a sua, sem amarelo/vermelho (que
 * competem com as cores dos clubes e dos cartões). Classes Tailwind legíveis no tema escuro.
 */
export const KIND_TEXT: Record<CompetitionKind, string> = {
  league: 'text-sky-400',
  cup: 'text-violet-400',
  continental: 'text-teal-300',
  supercup: 'text-fuchsia-400',
  state: 'text-emerald-400',
  playoff: 'text-indigo-300',
};

export function competitionTextClass(id: string, hint?: { name?: string; type?: string }): string {
  return KIND_TEXT[competitionIdentity(id, hint).kind];
}
