// Formatos dos estaduais (FMT:<n>_Times.txt, "(Tipo k)") convertidos À MÃO para FormatDef declarativo
// (ver packages/shared/src/types.ts e docs/specs/competicoes-e-temporada.md §2.2 e §7.1).
// Chave: "<nTimes>_<tipo>". O parser automático do texto seria frágil (typos como "Semi: Ida]").
//
// Convenções:
//  - fase de grupo principal: id 'g' (o rebaixamento direto usa a tabela dela);
//  - fases só de rebaixamento: relegationStage 'playoff' (perdedor cai) ou 'group' (últimos caem);
//    a engine (stateFormat) liga as fontes/contagens conforme nRebaixados/rebaixadosDireto/playoffRebaixamento
//    da divisão e remove essas fases quando a divisão não rebaixa;
//  - mata-mata de 2 grupos usa pareamento 'cross' (A1×B2...), os demais 'table' (1º×último);
//  - "Playoff-Semi": as melhores sementes pulam a 1ª rodada (`byes`).

const R = (name, legs, extra = {}) => ({ name, tie: { legs, ...extra } });
const NAMES = {
  2: ['Final'],
  4: ['Semifinal', 'Final'],
  8: ['Quartas de Final', 'Semifinal', 'Final'],
  16: ['Oitavas de Final', 'Quartas de Final', 'Semifinal', 'Final'],
};
const all = [{ entrants: 'all' }];
const perGroup = (stage, from, to) => ({ stage, ranks: [from, to], perGroup: true });
const top = (stage, k) => ({ stage, ranks: [1, k] });

/** Fase de tabela. */
function table(id, name, legs, o = {}) {
  return { id, kind: 'table', name, legs, sources: o.sources ?? all, ...omit(o, ['sources']) };
}
/** Mata-mata com k participantes e pernas por rodada (da 1ª à final). */
function ko(id, name, sources, k, legs, o = {}) {
  // `legs` mais curto que as rodadas possíveis = só as primeiras rodadas (ex.: fase só de quartas)
  const rounds = NAMES[k].slice(0, legs.length).map((nm, i) => R(nm, legs[i]));
  return { id, kind: 'knockout', name, sources, seeding: o.seeding ?? 'table', rounds, ...omit(o, ['seeding']) };
}
/** Mata-mata com "Playoff-Semi": `byes` sementes direto na semi. */
function koPS(id, name, sources, byes, legs, o = {}) {
  const rounds = [R('Playoff-Semi', legs[0]), R('Semifinal', legs[1]), R('Final', legs[2])];
  return { id, kind: 'knockout', name, sources, byes, seeding: 'table', rounds, ...o };
}
function omit(o, keys) { const r = { ...o }; for (const k of keys) delete r[k]; return r; }
const F = (teams, summary, stages, champion, extra = {}) => ({ teams, summary, stages, champion, ...extra });

/** turno (ou I/V) → k → mata-mata */
const leagueKo = (n, legsG, k, legs, o = {}) =>
  F(n, o.summary ?? `${legsG === 2 ? 'I/V' : 'turno'} → ${k} → ${legs.map((l) => (l === 2 ? 'I/V' : 'JU')).join(', ')}`,
    [table('g', o.label ?? 'Fase de Grupos', legsG, o.g ?? {}), ko('mm', 'Fase Final', [top('g', k)], k, legs, o.ko ?? {}), ...(o.extra ?? [])], 'mm');
/** G grupos (dentro ou grupo x grupo) → k por grupo → mata-mata */
const groupsKo = (n, G, legsG, k, legs, o = {}) =>
  F(n, o.summary ?? `${G} grupos${o.cross ? ' (grupo x grupo)' : ''} ${legsG === 2 ? 'I/V' : 'turno'} → ${k}/grupo → mata-mata`,
    [table('g', o.label ?? 'Fase de Grupos', legsG, { groups: G, crossGroups: !!o.cross }), ko('mm', 'Fase Final', [perGroup('g', 1, k)], k * G, legs, { seeding: G === 2 ? 'cross' : 'table' }), ...(o.extra ?? [])], 'mm');
const onlyTable = (n, legs, summary, label) => F(n, summary, [table('g', label ?? 'Fase de Grupos', legs)], 'g');
const relPlayoff = () => ({ id: 'rp', kind: 'knockout', name: 'Playoff de Rebaixamento', label: 'PLAYOFF DE REBAIXAMENTO', sources: [{ stage: 'g', ranks: [1, 2] }], seeding: 'table', rounds: [R('Playoff de Rebaixamento', 2)], relegationStage: 'playoff' });
const relQuad = (src, legs) => table('rq', 'Quadrangular do Rebaixamento', legs, { label: 'QUADRANGULAR DO REBAIXAMENTO', sources: src, relegationStage: 'group' });

export const STATE_FORMATS = {
  '2_1': F(2, 'final I/V, pênaltis', [ko('mm', 'Fase Final', all, 2, [2])], 'mm'),
  '3_1': leagueKo(3, 2, 2, [2]),
  '4_1': leagueKo(4, 2, 2, [2]),
  '4_2': leagueKo(4, 1, 2, [1]),
  '6_1': leagueKo(6, 1, 4, [2, 2]),
  '6_2': leagueKo(6, 1, 4, [2, 1]),
  '6_3': onlyTable(6, 2, 'I/V em pontos corridos, sem mata-mata'),
  '7_1': F(7, 'turno → 4 → quadrangular final em turno (1º campeão)', [
    table('g', 'Fase de Grupos', 1),
    table('qf', 'Quadrangular Final', 1, { label: 'QUADRANGULAR FINAL', sources: [top('g', 4)] }),
  ], 'qf'),
  '7_2': leagueKo(7, 2, 4, [2, 2]),
  '8_1': leagueKo(8, 1, 4, [2, 1], { ko: { thirdPlace: { legs: 1 } }, summary: 'turno → 4 → semi I/V, 3º lugar JU, final JU' }),
  '8_2': leagueKo(8, 1, 4, [2, 1]),
  '8_3': F(8, '2 turnos (2 grupos: 1º grupo x grupo, 2º dentro); 1º → semi, 2º/3º → playoff-semi JU; semi e final JU; Final Geral entre os campeões dos turnos', [
    table('t1', 'Primeiro Turno', 1, { label: 'PRIMEIRO TURNO', groups: 2, crossGroups: true }),
    koPS('t1mm', 'Primeiro Turno - Fase Final', [perGroup('t1', 1, 1), perGroup('t1', 2, 3)], 2, [1, 1, 1], { title: 'Primeiro Turno' }),
    table('t2', 'Segundo Turno', 1, { label: 'SEGUNDO TURNO', groups: 2, after: ['t1mm'] }),
    koPS('t2mm', 'Segundo Turno - Fase Final', [perGroup('t2', 1, 1), perGroup('t2', 2, 3)], 2, [1, 1, 1], { title: 'Segundo Turno' }),
    { id: 'final', kind: 'knockout', name: 'Final Geral', label: 'FINAL GERAL / CAMPEÃO', sources: [{ stage: 't1mm', winners: true }, { stage: 't2mm', winners: true }], seeding: 'order', rounds: [R('Final Geral', 1)] },
  ], 'final'),
  '8_4': onlyTable(8, 1, 'turno, pontos corridos'),
  '8_5': leagueKo(8, 1, 4, [2, 2], { extra: [relPlayoff()], summary: 'turno → 4 → semi I/V → final I/V; playoff de rebaixamento I/V' }),
  '8_6': F(8, 'turno: 2 → semi, 4 → playoff-semi I/V; semi I/V; final I/V', [table('g', 'Fase de Grupos', 1), koPS('mm', 'Fase Final', [top('g', 6)], 2, [2, 2, 2])], 'mm'),
  '8_7': leagueKo(8, 1, 4, [2, 2]),
  '9_1': leagueKo(9, 1, 4, [2, 2]),
  '9_2': F(9, 'turno: 2 → semi, 4 → playoff-semi I/V; semi I/V; final I/V', [table('g', 'Fase de Grupos', 1), koPS('mm', 'Fase Final', [top('g', 6)], 2, [2, 2, 2])], 'mm'),
  '9_3': leagueKo(9, 1, 4, [1, 1]),
  '10_1': groupsKo(10, 2, 1, 2, [1, 1]),
  '10_2': leagueKo(10, 1, 4, [1, 1]),
  '10_3': groupsKo(10, 2, 1, 2, [2, 1]),
  '10_4': leagueKo(10, 1, 8, [2, 2, 2]),
  '10_5': F(10, 'F1 2×5 (dentro): 3 → F2, 2 → quadrangular de rebaixamento; F2 2×3 grupo x grupo: 2 → semi I/V, 3º → disputa de 5º; 3º lugar JU; final I/V', [
    table('g', '1ª Fase', 1, { groups: 2 }),
    table('f2', '2ª Fase', 1, {
      sources: [], groupNames: ['Grupo C', 'Grupo D'], crossGroups: true, after: ['g'],
      groupSources: [
        [{ stage: 'g', ranks: [1, 1], group: 0 }, { stage: 'g', ranks: [2, 2], group: 1 }, { stage: 'g', ranks: [3, 3], group: 0 }],
        [{ stage: 'g', ranks: [1, 1], group: 1 }, { stage: 'g', ranks: [2, 2], group: 0 }, { stage: 'g', ranks: [3, 3], group: 1 }],
      ],
    }),
    ko('mm', 'Fase Final', [perGroup('f2', 1, 2)], 4, [2, 2], { seeding: 'cross', thirdPlace: { legs: 1 } }),
    { id: 'quinto', kind: 'knockout', name: 'Disputa de 5º Lugar', sources: [perGroup('f2', 3, 3)], seeding: 'order', rounds: [R('Disputa de 5º Lugar', 1)] },
    relQuad([perGroup('g', 4, 5)], 1),
  ], 'mm'),
  '10_6': F(10, '2×5 (dentro): 1º → semi, 2º/3º → playoff-semi JU, 4º/5º → quadrangular de rebaixamento; semi JU, final JU', [
    table('g', 'Fase de Grupos', 1, { groups: 2 }),
    koPS('mm', 'Fase Final', [perGroup('g', 1, 1), perGroup('g', 2, 3)], 2, [1, 1, 1]),
    relQuad([perGroup('g', 4, 5)], 1),
  ], 'mm'),
  '10_7': groupsKo(10, 2, 2, 2, [2, 2]),
  '10_8': onlyTable(10, 2, 'turno e returno, 1º é campeão'),
  '10_9': onlyTable(10, 1, 'turno, 1º é campeão'),
  '10_10': F(10, '2×5 (dentro): 1º → semi, 2º/3º → playoff-semi JU; semi I/V; final I/V', [
    table('g', 'Fase de Grupos', 1, { groups: 2 }),
    koPS('mm', 'Fase Final', [perGroup('g', 1, 1), perGroup('g', 2, 3)], 2, [1, 2, 2]),
  ], 'mm'),
  '10_11': leagueKo(10, 1, 4, [2, 2]),
  '10_12': F(10, 'turno: 2 → semi, 4 → playoff-semi JU; semi I/V; final JU', [table('g', 'Fase de Grupos', 1), koPS('mm', 'Fase Final', [top('g', 6)], 2, [1, 2, 1])], 'mm'),
  '10_13': groupsKo(10, 2, 2, 2, [1, 1]),
  '10_14': F(10, 'turno: 1 → semi, 6 → playoff-semi JU; semi I/V; final I/V', [table('g', 'Fase de Grupos', 1), koPS('mm', 'Fase Final', [top('g', 7)], 1, [1, 2, 2])], 'mm'),
  '10_15': F(10, 'turno: 2 → semi, 4 → playoff-semi I/V; semi I/V; 3º lugar JU; final I/V', [table('g', 'Fase de Grupos', 1), koPS('mm', 'Fase Final', [top('g', 6)], 2, [2, 2, 2], { thirdPlace: { legs: 1 } })], 'mm'),
  '10_16': groupsKo(10, 2, 1, 4, [2, 2, 2]),
  '12_1': groupsKo(12, 2, 1, 2, [2, 1]),
  '12_2': F(12, 'Taça Guanabara 2×6 grupo x grupo: 4/grupo → quartas JU, semi I/V, final JU; perdedores das quartas → Taça Rio (semi I/V, final JU); 5º/6º → quadrangular de rebaixamento I/V', [
    table('g', 'Taça Guanabara', 1, { label: 'TAÇA GUANABARA', groups: 2, crossGroups: true }),
    ko('qf', 'Taça Guanabara - Quartas', [perGroup('g', 1, 4)], 8, [1], { seeding: 'cross' }),
    { ...ko('mm', 'Taça Guanabara - Fase Final', [{ stage: 'qf', winners: true }], 4, [2, 1]) },
    { ...ko('rio', 'Taça Rio', [{ stage: 'qf', losers: true }], 4, [2, 1]), label: 'TAÇA RIO', title: 'Taça Rio' },
    relQuad([perGroup('g', 5, 6)], 2),
  ], 'mm'),
  '12_3': leagueKo(12, 1, 4, [2, 2], { label: 'Taça Santos Dumont', g: { label: 'TAÇA SANTOS DUMONT' } }),
  '12_4': leagueKo(12, 1, 4, [2, 2]),
  '12_5': F(12, '2×6 grupo x grupo: 4/grupo → quartas, semi e final I/V; perdedores das quartas → Taça Acesc (semi JU, final I/V); 5º/6º → quadrangular de rebaixamento I/V', [
    table('g', 'Fase de Grupos', 1, { groups: 2, crossGroups: true }),
    ko('qf', 'Quartas de Final', [perGroup('g', 1, 4)], 8, [2], { seeding: 'cross' }),
    ko('mm', 'Fase Final', [{ stage: 'qf', winners: true }], 4, [2, 2]),
    { ...ko('acesc', 'Taça Acesc', [{ stage: 'qf', losers: true }], 4, [1, 2]), label: 'TAÇA ACESC', title: 'Taça Acesc' },
    relQuad([perGroup('g', 5, 6)], 2),
  ], 'mm'),
  '12_6': groupsKo(12, 2, 1, 4, [2, 2, 2], { cross: true }),
  '12_7': F(12, '2×6 grupo x grupo: 4/grupo → quartas JU, semi I/V, final I/V; perdedores das quartas → Taça Farroupilha (semi I/V, final I/V); 5º/6º → quadrangular de rebaixamento I/V', [
    table('g', 'Fase de Grupos', 1, { groups: 2, crossGroups: true }),
    ko('qf', 'Quartas de Final', [perGroup('g', 1, 4)], 8, [1], { seeding: 'cross' }),
    ko('mm', 'Fase Final', [{ stage: 'qf', winners: true }], 4, [2, 2]),
    { ...ko('farroupilha', 'Taça Farroupilha', [{ stage: 'qf', losers: true }], 4, [2, 2]), label: 'TAÇA FARROUPILHA', title: 'Taça Farroupilha' },
    relQuad([perGroup('g', 5, 6)], 2),
  ], 'mm'),
  '12_8': F(12, '8 rodadas (parcial) → 8 → quartas, semi e final I/V; playoff de rebaixamento I/V', [
    table('g', 'Fase de Grupos', 1, { partialRounds: 8 }),
    ko('mm', 'Fase Final', [top('g', 8)], 8, [2, 2, 2]),
    relPlayoff(),
  ], 'mm'),
  '12_9': F(12, '3 grupos de 4 contra os outros 2 grupos (8 rodadas); 1º de cada grupo + melhor 2º → semi I/V, final JU; 4 melhores restantes → Troféu Inconfidência (semi I/V, final I/V)', [
    table('g', 'Fase de Grupos', 1, { groups: 3, crossGroups: true }),
    ko('mm', 'Fase Final', [perGroup('g', 1, 1), { stage: 'g', bestOfRank: 2, count: 1 }], 4, [2, 1]),
    { ...ko('inc', 'Troféu Inconfidência', [{ stage: 'g', bestRest: 4, exclude: ['mm'] }], 4, [2, 2]), label: 'TROFÉU INCONFIDÊNCIA', title: 'Troféu Inconfidência' },
  ], 'mm'),
  '12_10': groupsKo(12, 2, 2, 4, [2, 2, 2]),
  '12_11': F(12, '2×6 turno → 3/grupo → hexagonal em turno (1º campeão)', [
    table('g', 'Fase de Grupos', 1, { groups: 2 }),
    table('hex', 'Hexagonal', 1, { label: 'HEXAGONAL', sources: [perGroup('g', 1, 3)] }),
  ], 'hex'),
  '12_12': F(12, '6 rodadas (parcial) → 8 → quartas JU, semi JU, final I/V', [table('g', 'Fase de Grupos', 1, { partialRounds: 6 }), ko('mm', 'Fase Final', [top('g', 8)], 8, [1, 1, 2])], 'mm'),
  '12_13': groupsKo(12, 4, 2, 2, [2, 2, 1]),
  '12_14': groupsKo(12, 2, 1, 4, [2, 2, 2], { cross: true, extra: [relQuad([perGroup('g', 5, 6)], 1)] }),
  '12_15': F(12, '3×4 turno: 2/grupo + 2 melhores 3º → quartas, semi e final I/V', [
    table('g', 'Fase de Grupos', 1, { groups: 3 }),
    ko('mm', 'Fase Final', [perGroup('g', 1, 2), { stage: 'g', bestOfRank: 3, count: 2 }], 8, [2, 2, 2]),
  ], 'mm'),
  '13_1': leagueKo(13, 1, 4, [2, 2]),
  '14_1': groupsKo(14, 2, 1, 4, [2, 2, 1]),
  '16_1': leagueKo(16, 1, 8, [2, 2, 2]),
  '16_2': F(16, '8 rodadas (parcial) → 8 → quartas JU, semi JU, final I/V', [table('g', 'Fase de Grupos', 1, { partialRounds: 8 }), ko('mm', 'Fase Final', [top('g', 8)], 8, [1, 1, 2])], 'mm'),
  '16_3': F(16, 'F1 turno → 8 → F2 2×4 I/V → 2/grupo → semi I/V → final I/V', [
    table('g', '1ª Fase', 1),
    table('f2', '2ª Fase', 2, { groups: 2, groupNames: ['Grupo A', 'Grupo B'], sources: [top('g', 8)] }),
    ko('mm', 'Fase Final', [perGroup('f2', 1, 2)], 4, [2, 2], { seeding: 'cross' }),
  ], 'mm'),
  '16_4': leagueKo(16, 1, 8, [2, 2, 2]),
  // FMT:24/T1 pula as quartas (oitavas → semi): lacuna 6 da spec — implementado com quartas.
  '24_1': groupsKo(24, 4, 2, 4, [2, 2, 2, 2], { summary: '4×6 I/V → 4/grupo → oitavas, quartas, semi e final I/V (quartas incluídas: lacuna 6 da spec)' }),
  '31_1': F(31, 'Torneio Frevo (24 clubes, 4×6 dentro): 4/grupo → oitavas JU → quartas JU → quadrangular → 3 avançam; Torneio Forró (7 melhores + 3) 2×5 grupo x grupo: 1º → semi, 2º/3º → playoff-semi I/V; semi I/V; final I/V', [
    table('frevo', 'Torneio Frevo', 1, { label: 'Torneio Frevo', groups: 4, sources: [{ entrants: 'all', from: 8, to: 31 }] }),
    { ...ko('frevo-mm', 'Torneio Frevo - Mata-mata', [perGroup('frevo', 1, 4)], 16, [1, 1]), rounds: [R('Oitavas de Final', 1), R('Quartas de Final', 1)] },
    table('frevo-quad', 'Torneio Frevo - Quadrangular', 1, { label: 'QUADRANGULAR', sources: [{ stage: 'frevo-mm', winners: true }] }),
    table('forro', 'Torneio Forró', 1, { label: 'Torneio Forró', groups: 2, crossGroups: true, sources: [{ entrants: 'all', from: 1, to: 7 }, top('frevo-quad', 3)] }),
    koPS('mm', 'Fase Final', [perGroup('forro', 1, 1), perGroup('forro', 2, 3)], 2, [2, 2, 2]),
  ], 'mm'),
};

for (const [key, f] of Object.entries(STATE_FORMATS)) f.id = key;
