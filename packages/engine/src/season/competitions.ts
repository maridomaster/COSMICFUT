/**
 * Construtores de FormatDef (Fase 1): ligas nacionais por `formula` do ConfigLigaType,
 * Brasileirão (Série B com Playoff de Acesso, Série C formula 3, Série D formula 6),
 * Apertura/Clausura (ARG/URU), estaduais (formats.json + regras de rebaixamento da divisão),
 * Copa Nacional (Copa do Brasil real e genérica) e Supercopa.
 */
import type {
  Division, DivisionExtra, FormatDef, FormatsFile, KnockoutRoundDef, KnockoutStageDef, LeagueRules, PickRule, StageDef,
  StateDivisionExtra, TableStageDef, TieRule,
} from '@cosmicfut/shared';

export type LeagueDivision = Division & DivisionExtra;
export type StateDivision = { division: number; name: string; teams: number; legacyFormula: number; clubIds: string[] } & StateDivisionExtra;

const JU: TieRule = { legs: 1 };
const IV: TieRule = { legs: 2 };

/** Nome da rodada de mata-mata pelo nº de clubes. */
export function roundName(clubs: number): string {
  switch (clubs) {
    case 2: return 'Final';
    case 4: return 'Semifinal';
    case 8: return 'Quartas de Final';
    case 16: return 'Oitavas de Final';
    case 32: return '16-avos de Final';
    case 64: return '64-avos de Final';
    default: return `Fase de ${clubs}`;
  }
}

/** Rodadas de `size` (potência de 2) até a final. `legs(i)` dá as pernas da i-ésima rodada (0 = primeira). */
export function koRounds(size: number, legs: (i: number, clubs: number) => 1 | 2): KnockoutRoundDef[] {
  const out: KnockoutRoundDef[] = [];
  let i = 0;
  for (let n = size; n >= 2; n /= 2, i++) out.push({ name: roundName(n), tie: { legs: legs(i, n) } });
  return out;
}

/* ═════════════════════ ligas nacionais ═════════════════════ */

/** Pontos corridos simples (formula 0). */
export function leagueFormat(id: string, teams: number, doubleRound: boolean, relegated: number, promoted: number): FormatDef {
  return {
    id, teams, summary: `pontos corridos ${doubleRound ? 'em 2 turnos' : 'em turno único'}`,
    stages: [{ id: 'league', kind: 'table', name: 'Pontos Corridos', legs: doubleRound ? 2 : 1, sources: [{ entrants: 'all' }] }],
    champion: 'league',
    relegation: relegated > 0 ? [{ stage: 'league', bottom: relegated }] : [],
    promotion: promoted > 0 ? [{ stage: 'league', ranks: [1, promoted] }] : [],
  };
}

const legsAt = (arr: boolean[] | undefined, i: number, dflt: 1 | 2 = 2): 1 | 2 => (arr && arr[i] !== undefined ? (arr[i] ? 2 : 1) : dflt);

/**
 * Formato de uma divisão nacional a partir do ConfigLigaType (`cfg`, gerado pelo pipeline).
 * `promotedUp` = quantos desta divisão sobem (= rebaixados da divisão de cima).
 */
export function nationalFormat(div: LeagueDivision, promotedUp = div.promoted, opts: { serieDReal?: boolean } = {}): FormatDef {
  // (Etapa 2) regras reais 2026 / 2026-27 (leagues.json → rules)
  if (div.rules) return realLeagueFormat(div, div.rules);
  const cfg = div.cfg;
  const n = div.clubIds.length || div.teams;
  const id = div.id;
  const relegated = div.relegated;
  const f = cfg?.formula ?? div.legacyFormula ?? 0;
  const groups = cfg?.nGrupos ?? div.groups ?? 0;
  if (cfg?.aperturaClausura) return aperturaClausuraFormat(div, f, groups);
  if (f === 3 && groups === 2 && n >= 16) return serieCFormat(div, promotedUp);
  if ((f === 6 || f === 3 || f === 4) && groups >= 2) return groupsKnockoutFormat(div, promotedUp, opts);
  // formula 0 (com Playoff de Acesso, se houver)
  const fmt = leagueFormat(id, n, div.doubleRound, relegated, promotedUp);
  const vagas = cfg?.playoffAcesso ? cfg.vagasSobemPeloMataMata : 0;
  if (vagas > 0 && promotedUp > vagas) {
    const direct = promotedUp - vagas;
    fmt.stages.push({
      id: 'playoff', kind: 'knockout', name: 'Playoff de Acesso', label: 'PLAYOFF DE ACESSO',
      sources: [{ stage: 'league', ranks: [direct + 1, direct + 2 * vagas] }], seeding: 'table',
      rounds: [{ name: 'Playoff de Acesso', tie: { legs: legsAt(cfg?.duasVoltasMataMataSobe, 0, 1) } }],
    });
    fmt.promotion = [{ stage: 'league', ranks: [1, direct] }, { stage: 'playoff', winners: true }];
    fmt.summary += `; ${direct} sobem direto + ${vagas} pelo Playoff de Acesso (${direct + 1}º a ${direct + 2 * vagas}º)`;
  }
  return fmt;
}

/** Série C (formula 3): 2 grupos (turno único dentro do grupo) → 2 quadrangulares I/V → final I/V. */
export function serieCFormat(div: LeagueDivision, promotedUp: number): FormatDef {
  const cfg = div.cfg;
  const n = div.clubIds.length || div.teams;
  const legs1: 1 | 2 = div.doubleRound ? 2 : 1;
  const perQuad = Math.max(0, Math.ceil(promotedUp / 2));
  const relPerGroup = Math.ceil(div.relegated / 2);
  const g = (stage: string, r: number, grp: number): PickRule => ({ stage, ranks: [r, r], group: grp });
  return {
    id: div.id, teams: n,
    summary: '2 grupos em turno único → 4 por grupo em 2 quadrangulares I/V (2 sobem de cada) → final I/V; caem os 2 últimos de cada grupo',
    stages: [
      { id: 'f1', kind: 'table', name: '1ª Fase', groups: 2, legs: legs1, sources: [{ entrants: 'all' }], grouping: 'draw' },
      {
        id: 'f2', kind: 'table', name: '2ª Fase', groupNames: ['Quadrangular A', 'Quadrangular B'], legs: 2,
        sources: [], after: ['f1'],
        groupSources: [
          [g('f1', 1, 0), g('f1', 4, 0), g('f1', 2, 1), g('f1', 3, 1)],
          [g('f1', 1, 1), g('f1', 4, 1), g('f1', 2, 0), g('f1', 3, 0)],
        ],
      },
      {
        id: 'final', kind: 'knockout', name: 'Final', seeding: 'table',
        sources: [{ stage: 'f2', ranks: [1, 1], perGroup: true }],
        rounds: [{ name: 'Final', tie: { legs: legsAt(cfg?.duasVoltasMataMata, 0) } }],
      },
    ],
    champion: 'final',
    relegation: relPerGroup > 0 ? [{ stage: 'f1', bottom: relPerGroup, perGroup: true }] : [],
    promotion: perQuad > 0 ? [{ stage: 'f2', ranks: [1, perQuad], perGroup: true }] : [],
  };
}

/** Grupos + mata-mata (formula 6: Série D; também usado para formula 3/4 genéricas). */
export function groupsKnockoutFormat(div: LeagueDivision, promotedUp: number, opts: { serieDReal?: boolean } = {}): FormatDef {
  const cfg = div.cfg;
  const n = div.clubIds.length || div.teams;
  const G = Math.max(2, cfg?.nGrupos ?? div.groups ?? 2);
  const per = Math.floor(n / G);
  // classificados por grupo: maior potência de 2 total ≤ metade+ (96/16 → 4 por grupo = 64)
  let size = 1;
  while (size * 2 <= n && (size * 2) / G <= Math.max(1, per - 1)) size *= 2;
  const perGroup = Math.max(1, Math.floor(size / G));
  const ko = koRounds(perGroup * G, (i) => legsAt(cfg?.duasVoltasMataMata, i));
  const stages: StageDef[] = [
    {
      id: 'groups', kind: 'table', name: 'Fase de Grupos', groups: G, legs: div.doubleRound ? 2 : 1,
      sources: [{ entrants: 'all' }], grouping: opts.serieDReal ? 'region' : 'draw',
    },
    { id: 'ko', kind: 'knockout', name: 'Mata-mata', sources: [{ stage: 'groups', ranks: [1, perGroup], perGroup: true }], seeding: 'table', rounds: ko },
  ];
  const promotion: PickRule[] = [];
  if (promotedUp > 0) {
    const round = ko.find((r) => r.name === roundName(promotedUp * 2));
    if (round) promotion.push({ stage: 'ko', winners: true, round: round.name });
  }
  return {
    id: div.id, teams: n,
    summary: `${G} grupos (${div.doubleRound ? 'I/V' : 'turno'}) → ${perGroup} por grupo (${perGroup * G}) → mata-mata I/V; ${promotedUp} sobem (vencedores de ${roundName(promotedUp * 2)})`,
    stages,
    champion: 'ko',
    // Série D Real: os "rebaixados" (64) são decididos na virada (remontagem pelos estaduais)
    relegation: opts.serieDReal || div.relegated <= 0 ? [] : [{ overall: true, bottom: div.relegated }],
    promotion,
  };
}

/** Apertura/Clausura (+ Finalíssima): URU (formula 0, turno único cada) e ARG (formula 4, 2 zonas + mata-mata). */
export function aperturaClausuraFormat(div: LeagueDivision, formula: number, groups: number): FormatDef {
  const cfg = div.cfg;
  const n = div.clubIds.length || div.teams;
  void cfg;
  const clName = 'Clausura';
  const stages: StageDef[] = [];
  const tableIds: string[] = [];
  const half = 20; // calendário: 20 datas de apertura + 20 de clausura
  for (const [k, title, start] of [['a', 'Apertura', 0], ['c', clName, half]] as const) {
    if (formula === 4 && groups >= 2) {
      const zones: TableStageDef = {
        id: `${k}-zonas`, kind: 'table', name: `${title} - Zonas`, label: title.toUpperCase(), groups, legs: 1,
        sources: [{ entrants: 'all' }], grouping: 'snake', slotStart: start,
      };
      const ko: KnockoutStageDef = {
        id: `${k}-mm`, kind: 'knockout', name: `${title} - Mata-mata`, label: title, title,
        sources: [{ stage: zones.id, ranks: [1, 8], perGroup: true }], seeding: 'cross',
        // zonas de 15 (ímpar) exigem 15 datas; com quartas/semi I/V seriam 21 > 20 datas do calendário.
        // Spec §3.4, opção A: mata-mata todo em jogo único (15 + 4 = 19 datas).
        rounds: [
          { name: 'Oitavas de Final', tie: JU }, { name: 'Quartas de Final', tie: JU },
          { name: 'Semifinal', tie: JU }, { name: 'Final', tie: { legs: 1, neutral: true } },
        ],
      };
      stages.push(zones, ko);
      tableIds.push(zones.id);
    } else {
      stages.push({
        id: `${k}-liga`, kind: 'table', name: title, label: title.toUpperCase(), legs: 1,
        sources: [{ entrants: 'all' }], slotStart: start, title,
      });
      tableIds.push(`${k}-liga`);
    }
  }
  const champA = formula === 4 && groups >= 2 ? { stage: 'a-mm', winners: true as const } : { stage: 'a-liga', ranks: [1, 1] as [number, number] };
  const champC = formula === 4 && groups >= 2 ? { stage: 'c-mm', winners: true as const } : { stage: 'c-liga', ranks: [1, 1] as [number, number] };
  const lastStages = stages.filter((s) => s.id.endsWith('mm') || s.id.endsWith('liga')).map((s) => s.id);
  stages.push({
    id: 'finalissima', kind: 'knockout', name: 'Finalíssima', label: 'FINALÍSSIMA',
    sources: [champA, champC], after: lastStages, seeding: 'order',
    rounds: [{ name: 'Finalíssima', tie: { legs: 1, neutral: true } }],
  });
  return {
    id: div.id, teams: n,
    summary: formula === 4
      ? `Apertura e Clausura: ${groups} zonas em turno único → 8 por zona → mata-mata em jogo único (oitavas a final); Finalíssima entre os campeões; rebaixamento pela tabela anual`
      : 'Apertura e Clausura em turno único; Finalíssima entre os campeões; rebaixamento pela tabela somada',
    stages,
    champion: 'finalissima',
    relegation: div.relegated > 0 ? [{ stage: tableIds, bottom: div.relegated }] : [],
    promotion: div.promoted > 0 ? [{ stage: tableIds, ranks: [1, div.promoted] }] : [],
  };
}

/* ═════════════════════ (Etapa 2) formatos reais 2026 / 2026-27 ═════════════════════ */

/**
 * Formato real de uma divisão (`LeagueRules`): pontos corridos com playoffs de acesso (Championship, LaLiga 2,
 * Serie B, Série B...), Apertura/Clausura (ARG, URU), Apertura/Finalización com cuadrangulares (COL), Apertura e
 * Clausura em ida e volta (PAR) e LigaPro em duas fases (EQU). Rebaixados = `div.relegated` (0 na última divisão do
 * país, exceto a Série B, cujos rebaixados voltam aos estaduais); promovidos = diretos + vencedores do playoff.
 */
export function realLeagueFormat(div: LeagueDivision, rules: LeagueRules): FormatDef {
  const n = div.clubIds.length || div.teams;
  const rel = div.relegated;
  let fmt: FormatDef;
  let tables: string[] = ['league'];
  switch (rules.kind) {
    case 'ac-zones':
    case 'ac-final': {
      fmt = aperturaClausuraFormat({ ...div, relegated: rel, promoted: 0 }, rules.kind === 'ac-zones' ? 4 : 0, rules.kind === 'ac-zones' ? 2 : 0);
      if (rules.kind === 'ac-zones') {
        const f = fmt.stages.find((s) => s.id === 'finalissima')!;
        f.name = 'Trofeo de Campeones'; f.label = 'TROFEO DE CAMPEONES';
        (f as KnockoutStageDef).rounds[0].name = 'Trofeo de Campeones';
      }
      tables = fmt.stages.filter((s) => s.kind === 'table').map((s) => s.id);
      break;
    }
    case 'col': {
      const half = 27; // 19 rodadas + 6 dos cuadrangulares + 2 da final
      const stages: StageDef[] = [];
      const g = (stage: string, r: number): PickRule => ({ stage, ranks: [r, r] });
      for (const [k, title, start] of [['a', 'Apertura', 0], ['f', 'Finalización', half]] as const) {
        stages.push(
          { id: `${k}-liga`, kind: 'table', name: `${title} - Todos contra Todos`, label: title.toUpperCase(), legs: 1, sources: [{ entrants: 'all' }], slotStart: start },
          {
            id: `${k}-quad`, kind: 'table', name: `${title} - Cuadrangulares`, groupNames: ['Cuadrangular A', 'Cuadrangular B'], legs: 2, sources: [], after: [`${k}-liga`],
            groupSources: [[g(`${k}-liga`, 1), g(`${k}-liga`, 4), g(`${k}-liga`, 5), g(`${k}-liga`, 8)], [g(`${k}-liga`, 2), g(`${k}-liga`, 3), g(`${k}-liga`, 6), g(`${k}-liga`, 7)]],
          },
          {
            id: `${k}-final`, kind: 'knockout', name: `${title} - Final`, label: `${title} - Final`, ...(k === 'a' ? { title } : {}),
            sources: [{ stage: `${k}-quad`, ranks: [1, 1], perGroup: true }], seeding: 'table', rounds: [{ name: 'Final', tie: IV }],
          },
        );
      }
      fmt = {
        id: div.id, teams: n, stages, champion: 'f-final',
        summary: 'Apertura e Finalización: turno único → 8 melhores em 2 cuadrangulares I/V → final I/V; rebaixamento pela tabela somada (reclasificación)',
      };
      tables = ['a-liga', 'f-liga'];
      break;
    }
    case 'ac-tables': {
      fmt = {
        id: div.id, teams: n, champion: 'c-liga',
        summary: 'Apertura e Clausura em ida e volta (dois campeões); rebaixamento pela tabela somada',
        stages: [
          { id: 'a-liga', kind: 'table', name: 'Apertura', label: 'APERTURA', title: 'Apertura', legs: 2, sources: [{ entrants: 'all' }], slotStart: 0 },
          { id: 'c-liga', kind: 'table', name: 'Clausura', label: 'CLAUSURA', legs: 2, sources: [{ entrants: 'all' }], slotStart: 2 * (n - 1 + (n % 2)) },
        ],
      };
      tables = ['a-liga', 'c-liga'];
      break;
    }
    case 'equ': {
      const grp = (id: string, name: string, a: number, b: number): TableStageDef => ({
        id, kind: 'table', name, label: name.toUpperCase(), legs: 2, sources: [], after: ['f1'], carry: 'f1', groupSources: [[{ stage: 'f1', ranks: [a, b] }]],
      });
      fmt = {
        id: div.id, teams: n, champion: 'hex',
        summary: '1ª fase em ida e volta → hexagonal do título (1º–6º), grupo intermediário (7º–12º) e quadrangular do rebaixamento (13º–16º), com os pontos da 1ª fase',
        stages: [
          { id: 'f1', kind: 'table', name: 'Primeira Fase', label: 'PRIMEIRA FASE', legs: 2, sources: [{ entrants: 'all' }] },
          grp('hex', 'Hexagonal do Título', 1, 6), grp('mid', 'Grupo Intermediário', 7, 12), grp('low', 'Quadrangular do Rebaixamento', 13, Math.max(13, n)),
        ],
      };
      tables = ['f1'];
      if (rel > 0) fmt.relegation = [{ stage: 'low', bottom: rel }];
      break;
    }
    default:
      fmt = leagueFormat(div.id, n, div.doubleRound !== false, 0, 0);
  }
  if (rules.kind !== 'equ') fmt.relegation = rel > 0 ? [{ stage: tables.length > 1 ? tables : tables[0], bottom: rel }] : [];
  // acesso: diretos + playoff interno
  const promotion: PickRule[] = rules.promoted > 0 ? [{ stage: tables.length > 1 ? tables : tables[0], ranks: [1, rules.promoted] }] : [];
  const po = rules.promotionPlayoff;
  if (po && rules.kind === 'league') {
    fmt.stages.push({
      id: 'playoff', kind: 'knockout', name: (po.spots ?? 1) === 0 ? 'Playoff' : 'Playoff de Acesso', label: (po.spots ?? 1) === 0 ? 'PLAYOFF' : 'PLAYOFF DE ACESSO',
      sources: [{ stage: 'league', ranks: po.ranks }], seeding: 'table', ...(po.byes ? { byes: po.byes } : {}),
      rounds: po.rounds.map((r) => ({ name: r.name, tie: { legs: r.legs, ...(r.neutral ? { neutral: true } : {}) } })),
    });
    if ((po.spots ?? 1) > 0) promotion.push({ stage: 'playoff', winners: true });
  }
  fmt.promotion = promotion;
  fmt.style = rules.kind;
  return fmt;
}

/* ═════════════════════ estaduais ═════════════════════ */

/** Formato genérico para estaduais cujo nº de clubes não bate com o arquivo de formatos. */
export function genericStateFormat(n: number): FormatDef {
  const id = `generic_${n}`;
  if (n <= 1) return { id, teams: n, stages: [{ id: 'g', kind: 'table', name: 'Fase de Grupos', legs: 1, sources: [{ entrants: 'all' }] }], champion: 'g' };
  if (n === 2) return { id, teams: 2, summary: 'final I/V', stages: [{ id: 'mm', kind: 'knockout', name: 'Fase Final', sources: [{ entrants: 'all' }], rounds: [{ name: 'Final', tie: IV }] }], champion: 'mm' };
  const top = n >= 8 ? 4 : 2;
  return {
    id, teams: n, summary: `turno → ${top} → ${top === 4 ? 'semi I/V → ' : ''}final I/V`,
    stages: [
      { id: 'g', kind: 'table', name: 'Fase de Grupos', legs: n <= 4 ? 2 : 1, sources: [{ entrants: 'all' }] },
      { id: 'mm', kind: 'knockout', name: 'Fase Final', sources: [{ stage: 'g', ranks: [1, top] }], rounds: top === 4 ? [{ name: 'Semifinal', tie: IV }, { name: 'Final', tie: IV }] : [{ name: 'Final', tie: IV }] },
    ],
    champion: 'mm',
  };
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/**
 * Formato de uma divisão estadual: `formats[formatKey]` (ou genérico se o nº de clubes não bater)
 * + rebaixamento da divisão (total/direto/playoff/geral). Divisões que não rebaixam perdem as fases
 * que só servem para rebaixar.
 */
export function stateFormat(formats: FormatsFile | undefined, div: StateDivision): FormatDef {
  const n = div.clubIds.length;
  const key = div.formatKey ?? `${div.teams}_${div.legacyFormula}`;
  const base = formats?.[key];
  const fmt = base && base.teams === n ? clone(base) : genericStateFormat(n);
  const total = div.relegated ?? 0;
  let direct = div.relegatedDirect ?? total;
  const po = div.relegationPlayoff ?? Math.max(0, total - direct);
  const rp = fmt.stages.find((s) => s.relegationStage === 'playoff');
  const rq = fmt.stages.find((s) => s.relegationStage === 'group');
  const main = fmt.stages.find((s) => s.kind === 'table')?.id;
  const rules: PickRule[] = [];
  const drop = new Set<string>();
  if (total <= 0) {
    if (rp) drop.add(rp.id);
    if (rq) drop.add(rq.id);
  } else {
    let usedRq = false, usedRp = false;
    if (po > 0 && rq) {
      rules.push({ stage: rq.id, bottom: po });
      usedRq = true;
    } else if (po > 0 && rp && main) {
      // o(s) último(s) cai(em) direto; os dois acima disputam o playoff (o perdedor cai)
      rp.sources = [{ stage: main, ranks: [n - direct - 1, n - direct] }];
      rules.push({ stage: rp.id, losers: true });
      usedRp = true;
    } else direct += po;
    if (rq && !usedRq) drop.add(rq.id);
    if (rp && !usedRp) drop.add(rp.id);
    if (direct > 0) {
      if (div.relegationOverall) rules.push({ overall: true, bottom: direct });
      else if (main) rules.push({ stage: main, bottom: direct });
    }
  }
  fmt.stages = fmt.stages.filter((s) => !drop.has(s.id));
  for (const s of fmt.stages) if (s.after) s.after = s.after.filter((x) => !drop.has(x));
  fmt.relegation = rules;
  fmt.promotion = [];
  return fmt;
}

/* ═════════════════════ copas ═════════════════════ */

/**
 * Copa do Brasil (modo real, 13 datas de `copa_nacional`). Proposta documentada (spec §2.3, confiança
 * Média/Baixa): 1ª fase JU (80 clubes, mandante = pior ranqueado) → 2ª fase JU → 3ª fase/16-avos I/V
 * (entram os 12 do pote 1) → oitavas, quartas e semi I/V → final em jogo único, campo neutro (06/12).
 * As datas 21/11 e 29/11 ficam de reserva. Total: 92 clubes (os 126 da spec não cabem em 13 datas).
 */
export function brazilCupFormat(): FormatDef {
  // (Etapa 2) Copa do Brasil 2026: 126 clubes e 5 fases de entrada (os grandes entram depois). Proposta próxima do
  // regulamento 2026 (13 datas): 1ª fase (20 clubes estaduais) → 2ª (+54 estaduais) → 3ª (+Série B e os 12 melhores
  // estaduais) → 4ª (+8 da Série A) → 5ª fase/16-avos I/V (+12 do pote 1: Libertadores, campeões) → oitavas, quartas e
  // semi I/V → final única em campo neutro. Fases 1–4 em jogo único, mandante = pior ranqueado.
  const one = (id: string, name: string, slot: number, sources: PickRule[]): KnockoutStageDef => ({
    id, kind: 'knockout', name, label: name.toUpperCase(), sources, seeding: 'pots', rounds: [{ name, tie: { legs: 1, home: 'worse' }, slots: [slot] }],
  });
  return {
    id: 'BRA-CUP', teams: 0,
    summary: '126 clubes: 1ª a 4ª fases em jogo único (pior ranqueado manda; Série B na 3ª, Série A na 4ª) → 5ª fase/16-avos I/V (pote 1 entra) → oitavas, quartas e semi I/V → final única neutra',
    stages: [
      one('f1', '1ª Fase', 0, [{ entrants: 'f1' }]),
      one('f2', '2ª Fase', 1, [{ entrants: 'f2' }, { stage: 'f1', winners: true }]),
      one('f3', '3ª Fase', 2, [{ entrants: 'f3' }, { stage: 'f2', winners: true }]),
      one('f4', '4ª Fase', 3, [{ entrants: 'f4' }, { stage: 'f3', winners: true }]),
      {
        id: 'principal', kind: 'knockout', name: 'Copa do Brasil', seeding: 'pots',
        sources: [{ entrants: 'pot1' }, { stage: 'f4', winners: true }],
        rounds: [
          { name: '5ª Fase (16-avos)', tie: IV, slots: [4, 5] },
          { name: 'Oitavas de Final', tie: IV, slots: [6, 7] },
          { name: 'Quartas de Final', tie: IV, slots: [8, 9] },
          { name: 'Semifinal', tie: IV, slots: [10, 11] },
          { name: 'Final', tie: { legs: 1, neutral: true }, slots: [12] },
        ],
      },
    ],
    champion: 'principal',
  };
}

/**
 * (Etapa 2) Estilo de uma copa nacional real: nomes das rodadas (pelo nº de clubes), rodadas de ida e volta, final
 * neutra, prorrogação e quem manda nos jogos únicos.
 */
export interface CupStyle {
  /** nome da fase preliminar (até a potência de 2) */
  prelim?: string;
  /** nomes por nº de clubes na rodada (ex.: { 32: '4ª Rodada' }) — padrão: roundName */
  names?: Record<number, string>;
  /** rodadas (pelo nº de clubes) em ida e volta (ex.: [4] = semifinais) */
  twoLegs?: number[];
  /** final em ida e volta (padrão: jogo único em campo neutro) */
  finalLegs?: 1 | 2;
  neutralFinal?: boolean;
  extraTime?: boolean;
  /** jogos únicos antes da final: mandante = pior semente (padrão true) */
  worseHosts?: boolean;
  seeding?: 'pots' | 'draw';
}

/** Copa nacional (estilo real): mata-mata, fase preliminar até a potência de 2 (as melhores sementes folgam). */
export function nationalCupFormat(id: string, n: number, style: CupStyle = {}): FormatDef {
  let P = 1;
  while (P * 2 <= n) P *= 2;
  const prelim = n - P;
  const worse = style.worseHosts !== false;
  const single = (): TieRule => ({ legs: 1, ...(worse ? { home: 'worse' as const } : {}), ...(style.extraTime ? { extraTime: true } : {}) });
  const rounds: KnockoutRoundDef[] = [];
  if (prelim > 0) rounds.push({ name: style.prelim ?? 'Fase Preliminar', tie: single() });
  for (let k = P; k >= 2; k /= 2) {
    const name = style.names?.[k] ?? roundName(k);
    let tie: TieRule;
    if (k === 2) tie = (style.finalLegs ?? 1) === 2 ? { legs: 2 } : { legs: 1, ...(style.neutralFinal !== false ? { neutral: true } : {}), ...(style.extraTime ? { extraTime: true } : {}) };
    else tie = style.twoLegs?.includes(k) ? { legs: 2 } : single();
    rounds.push({ name, tie });
  }
  return {
    id, teams: n, summary: `mata-mata (${n} clubes)${prelim > 0 ? `, fase preliminar com ${2 * prelim}` : ''}${style.twoLegs?.length ? '; ida e volta nas fases finais' : ''}`,
    stages: [{ id: 'copa', kind: 'knockout', name: 'Copa', sources: [{ entrants: 'all' }], seeding: style.seeding ?? 'pots', byes: prelim > 0 ? n - 2 * prelim : 0, rounds }],
    champion: 'copa',
  };
}

/** (Etapa 2) Estilos reais das copas nacionais (ids de competitions.json). */
export const CUP_STYLES: Record<string, CupStyle> = {
  'ING-CUP': { prelim: '3ª Rodada', names: { 32: '4ª Rodada', 16: '5ª Rodada' }, extraTime: true, seeding: 'draw', worseHosts: false },
  'ING-LCUP': { prelim: '2ª Rodada', names: { 32: '3ª Rodada', 16: '4ª Rodada' }, twoLegs: [4], seeding: 'draw', worseHosts: false },
  'ESP-CUP': { prelim: '1ª Eliminatória', names: { 32: '16-avos de Final' }, twoLegs: [4], extraTime: true },
  'ITA-CUP': { prelim: 'Turno Preliminar', names: { 32: '32-avos (1º Turno)' }, twoLegs: [4], extraTime: true, worseHosts: false },
  'ALE-CUP': { prelim: '1ª Rodada', names: { 32: '2ª Rodada' }, extraTime: true },
  'FRA-CUP': { prelim: '32-avos de Final', extraTime: false, seeding: 'draw' },
  'POR-CUP': { prelim: '3ª Eliminatória', names: { 32: '4ª Eliminatória' }, twoLegs: [4], extraTime: true },
  'HOL-CUP': { prelim: '1ª Rodada', names: { 32: '2ª Rodada' }, extraTime: true },
  'ARS-CUP': { prelim: 'Fase Preliminar', extraTime: true },
  'ARG-CUP': { prelim: '32-avos de Final', worseHosts: false },
  'URU-CUP': {},
  'COL-CUP': { twoLegs: [16, 8, 4], finalLegs: 2 },
  'CHI-CUP': { twoLegs: [4], finalLegs: 1 },
  'PAR-CUP': {},
  'EQU-CUP': { twoLegs: [8, 4], finalLegs: 1 },
};

/** (Etapa 2) Supercopa de 4 clubes (Espanha, Itália, Arábia): semifinais e final em campo neutro. Inscritos na ordem
 * [campeão da liga, vice da copa, campeão da copa, vice da liga] ⇒ semis campeão da liga × vice da copa e campeão da
 * copa × vice da liga. */
export function supercup4Format(id: string): FormatDef {
  return {
    id, teams: 4, summary: '4 clubes (campeões e vices da liga e da copa): semifinais e final em campo neutro',
    stages: [{
      id: 'final', kind: 'knockout', name: 'Supercopa', sources: [{ entrants: 'all' }], seeding: 'order',
      rounds: [{ name: 'Semifinal', tie: { legs: 1, neutral: true }, slots: [0] }, { name: 'Final', tie: { legs: 1, neutral: true }, slots: [1] }],
    }],
    champion: 'final',
  };
}

/** (Etapa 2) Playoff de rebaixamento entre divisões (Relegation, Barrage...): ida e volta; o da divisão de cima decide em casa. */
export function relegationPlayoffFormat(id: string): FormatDef {
  return {
    id, teams: 2, summary: 'ida e volta: clube da divisão de cima × clube da divisão de baixo; o vencedor joga a elite',
    stages: [{
      id: 'po', kind: 'knockout', name: 'Playoff', label: 'PLAYOFF DE REBAIXAMENTO', sources: [{ entrants: 'upper' }, { entrants: 'lower' }], seeding: 'order',
      requires: [{ entrants: 'upper', count: 1 }, { entrants: 'lower', count: 1 }],
      rounds: [{ name: 'Playoff de Rebaixamento', tie: IV, slots: [0, 1] }],
    }],
    champion: 'po',
  };
}

/** Copa nacional genérica (outros países): mata-mata JU, potência de 2 com fase preliminar. */
export function genericCupFormat(id: string, n: number): FormatDef {
  let P = 1;
  while (P * 2 <= n) P *= 2;
  const prelim = n - P; // nº de confrontos preliminares
  const rounds: KnockoutRoundDef[] = [];
  if (prelim > 0) rounds.push({ name: 'Fase Preliminar', tie: { legs: 1, home: 'worse' } });
  for (let k = P; k >= 2; k /= 2) rounds.push({ name: roundName(k), tie: k === 2 ? { legs: 1, neutral: true } : { legs: 1, home: 'worse' } });
  return {
    id, teams: n, summary: 'mata-mata em jogo único (pênaltis), com fase preliminar até a potência de 2',
    stages: [{ id: 'copa', kind: 'knockout', name: 'Copa Nacional', sources: [{ entrants: 'all' }], seeding: 'pots', byes: prelim > 0 ? n - 2 * prelim : 0, rounds }],
    champion: 'copa',
  };
}

/** Supercopa: jogo único em campo neutro (campeão da liga × campeão da copa). (Etapa 2) `legs` 2: ida e volta (Superliga). */
export function supercupFormat(id: string, legs: 1 | 2 = 1): FormatDef {
  return {
    id, teams: 2, summary: legs === 2 ? 'ida e volta, pênaltis' : 'jogo único, campo neutro, pênaltis',
    stages: [{ id: 'final', kind: 'knockout', name: 'Supercopa', sources: [{ entrants: 'all' }], seeding: 'order', rounds: [{ name: 'Final', tie: legs === 2 ? IV : { legs: 1, neutral: true } }] }],
    champion: 'final',
  };
}
