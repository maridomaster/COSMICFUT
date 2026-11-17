/**
 * FIXTURE de desenvolvimento — usada só quando /data/*.json ainda não existe (404).
 * clubs.json foi convertido de tools/extract/sample_output.json (Palmeiras, Flamengo, Real Madrid);
 * overall/potencial/salário/valor são INVENTADOS de forma plausível (gerador: ./build-fixture.mjs).
 * Os demais clubes de FIXTURE_EXTRA_INDEX existem só no índice (sem elenco), para gerar adversários.
 */
import type { ClubBundle, ClubIndexEntry, Country, Division, Economy, Trait } from '@cosmicfut/shared';
import clubsJson from './clubs.json';

export const FIXTURE_BUNDLES = clubsJson as unknown as ClubBundle[];

const extra = (
  id: string,
  name: string,
  countryId: number,
  state: string | null,
  level: number,
  leagueId: string,
  primary: string,
  secondary: string,
): ClubIndexEntry => ({ id, name, countryId, state, level, leagueId, crestMini: null, colors: { primary, secondary } });

/** Clubes só de índice (sem bundle): servem de adversários e aparecem como "sem dados" na seleção. */
export const FIXTURE_EXTRA_INDEX: ClubIndexEntry[] = [
  extra('corinthians', 'Corinthians', 29, 'SP', 19, 'BRA-1', '#111111', '#ffffff'),
  extra('sao-paulo', 'São Paulo', 29, 'SP', 19, 'BRA-1', '#ffffff', '#e30613'),
  extra('santos', 'Santos', 29, 'SP', 17, 'BRA-1', '#ffffff', '#111111'),
  extra('gremio', 'Grêmio', 29, 'RS', 18, 'BRA-1', '#0d80bf', '#111111'),
  extra('internacional', 'Internacional', 29, 'RS', 18, 'BRA-1', '#e30613', '#ffffff'),
  extra('atletico-mg', 'Atlético Mineiro', 29, 'MG', 19, 'BRA-1', '#111111', '#ffffff'),
  extra('fluminense', 'Fluminense', 29, 'RJ', 18, 'BRA-1', '#7a0e2a', '#00613c'),
  extra('cruzeiro', 'Cruzeiro', 29, 'MG', 18, 'BRA-1', '#003da5', '#ffffff'),
  extra('barcelona', 'Barcelona', 65, null, 23, 'ESP-1', '#a50044', '#004d98'),
  extra('atletico-madrid', 'Atlético de Madrid', 65, null, 22, 'ESP-1', '#cb3524', '#ffffff'),
  extra('sevilla', 'Sevilla', 65, null, 19, 'ESP-1', '#ffffff', '#d4021d'),
  extra('villarreal', 'Villarreal', 65, null, 20, 'ESP-1', '#ffe667', '#005187'),
  extra('athletic', 'Athletic Club', 65, null, 20, 'ESP-1', '#ee2523', '#ffffff'),
  extra('real-sociedad', 'Real Sociedad', 65, null, 19, 'ESP-1', '#0067b1', '#ffffff'),
];

export const FIXTURE_INDEX: ClubIndexEntry[] = [
  ...FIXTURE_BUNDLES.map(({ club }) => ({
    id: club.id,
    name: club.name,
    countryId: club.countryId,
    state: club.state,
    level: club.level,
    leagueId: club.leagueId,
    crestMini: club.crestMini,
    colors: club.colors,
  })),
  ...FIXTURE_EXTRA_INDEX,
];

const c = (id: number, code: string | null, name: string): Country => ({
  id,
  code,
  name,
  flag: `flags/${id}.png`,
  flagLarge: `flags-large/${id}.png`,
});

export const FIXTURE_COUNTRIES: Country[] = [
  c(3, 'ALE', 'Alemanha'),
  c(11, 'ARG', 'Argentina'),
  c(21, 'BEL', 'Bélgica'),
  c(29, 'BRA', 'Brasil'),
  c(42, 'CHI', 'Chile'),
  c(46, 'COL', 'Colômbia'),
  c(50, 'CMA', 'Costa do Marfim'),
  c(60, 'EQU', 'Equador'),
  c(65, 'ESP', 'Espanha'),
  c(72, 'FRA', 'França'),
  c(85, 'HOL', 'Holanda'),
  c(97, 'ING', 'Inglaterra'),
  c(104, 'ITA', 'Itália'),
  c(129, 'MAR', 'Marrocos'),
  c(150, 'PAR', 'Paraguai'),
  c(154, 'POR', 'Portugal'),
  c(192, 'TUR', 'Turquia'),
  c(193, 'UCR', 'Ucrânia'),
  c(195, 'URU', 'Uruguai'),
];

const t = (id: number, key: string, label: string): Trait => ({ id, key, label, gkOnly: id <= 3 });
export const FIXTURE_TRAITS: Trait[] = [
  t(0, 'positioning', 'Colocação'),
  t(1, 'penaltySaving', 'Defesa de Pênaltis'),
  t(2, 'reflexes', 'Reflexos'),
  t(3, 'rushingOut', 'Saída do Gol'),
  t(4, 'playmaking', 'Armação'),
  t(5, 'heading', 'Cabeceio'),
  t(6, 'crossing', 'Cruzamento'),
  t(7, 'tackling', 'Desarme'),
  t(8, 'dribbling', 'Drible'),
  t(9, 'finishing', 'Finalização'),
  t(10, 'marking', 'Marcação'),
  t(11, 'passing', 'Passe'),
  t(12, 'stamina', 'Resistência'),
  t(13, 'pace', 'Velocidade'),
];

const ids = (country: number) => FIXTURE_INDEX.filter((e) => e.countryId === country).map((e) => e.id);

export const FIXTURE_LEAGUES: Division[] = [
  {
    id: 'BRA-1',
    countryId: 29,
    division: 1,
    name: 'Campeonato Brasileiro',
    divisionName: 'Série A',
    teams: 20,
    doubleRound: true,
    relegated: 4,
    promoted: 0,
    groups: 1,
    legacyFormula: 0,
    clubIds: ids(29),
  },
  {
    id: 'ESP-1',
    countryId: 65,
    division: 1,
    name: 'Liga Espanhola',
    divisionName: 'Primeira Divisão',
    teams: 20,
    doubleRound: true,
    relegated: 3,
    promoted: 0,
    groups: 1,
    legacyFormula: 0,
    clubIds: ids(65),
  },
];

export const FIXTURE_ECONOMY: Economy = {
  initialMoneyByDivision: { '1': 50_000_000, '2': 15_000_000, '3': 5_000_000, '4': 2_000_000, default: 1_000_000 },
  sponsorByDivision: { '1': 30_000_000, '2': 8_000_000, '3': 2_500_000, '4': 800_000, default: 400_000 },
  prizes: { LIGA_A: 40_000_000, LIBERTADORES: 80_000_000 },
};
