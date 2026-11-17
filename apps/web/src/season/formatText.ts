/**
 * Descrição amigável (pt-BR) do formato de uma competição, gerada a partir do FormatDef.
 * Substitui o `summary` técnico dos dados (ex.: "turno → 8 → I/V, I/V, I/V") por
 * "Fase de classificação em turno único; os 8 primeiros avançam ao mata-mata em ida e volta (quartas, semi e final)."
 */
import type { FormatDef, KnockoutStageDef, PickRule, StageDef, TableStageDef } from '@cosmicfut/shared';
import { titleCase } from './comps';

const legsText = (legs: number) => (legs === 2 ? 'turno e returno' : 'turno único');
const tieText = (legs: number, neutral?: boolean) => (legs === 2 ? 'ida e volta' : neutral ? 'jogo único em campo neutro' : 'jogo único');

function roundShort(name: string): string {
  const inner = /\(([^)]+)\)/.exec(name)?.[1];
  const n = (inner && /avos|oitavas|quartas|semi|final/i.test(inner) ? inner : name).toLowerCase();
  if (n.startsWith('playoff')) return 'repescagem';
  if (n.includes('oitavas')) return 'oitavas';
  if (n.includes('quartas')) return 'quartas';
  if (n.includes('semi')) return 'semi';
  if (n.includes('final')) return n.includes('geral') ? 'final geral' : 'final';
  return n;
}

/** "às quartas", "à semi", "à final", "à disputa de 5º lugar" */
const toRound = (short: string) => (short === 'quartas' || short === 'oitavas' ? `às ${short}` : `à ${short}`);

/** artigo pelo nome: "a Taça Rio", "o Troféu Inconfidência", "o Quadrangular Final" */
const art = (name: string) => (/^(taça|copa|fase|final|disputa|repescagem|primeira|segunda|terceira|quarta|\d+ª)/i.test(name) ? 'a' : 'o');

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

/** Junta faixas contíguas da mesma fase (1º→semi + 2º/3º→repescagem = os 3 primeiros). */
function mergeRanks(sources: PickRule[]): PickRule[] {
  const out: PickRule[] = [];
  for (const r of sources) {
    const prev = out[out.length - 1];
    if (prev && 'ranks' in prev && 'ranks' in r && prev.stage === r.stage && !!prev.perGroup === !!r.perGroup && prev.group === r.group && prev.ranks[1] + 1 === r.ranks[0]) {
      out[out.length - 1] = { ...prev, ranks: [prev.ranks[0], r.ranks[1]] };
    } else out.push(r);
  }
  return out;
}

/** Quem entra numa fase. `one` = singular (concordância do verbo). */
function who(sources: PickRule[]): { text: string; one: boolean; winners: boolean } {
  const parts: string[] = [];
  let count = 0;
  let winners = sources.length > 0;
  // quem entra direto vai por último: "os vencedores e os clubes que entram nesta fase"
  const ordered = mergeRanks(sources).sort((a, b) => Number('entrants' in a) - Number('entrants' in b));
  for (const r of ordered) {
    if (!('winners' in r)) winners = false;
    if ('entrants' in r) {
      parts.push('os clubes que entram nesta fase');
      count += 2;
    } else if ('ranks' in r) {
      const [a, b] = r.ranks;
      const per = r.perGroup ? ' de cada grupo' : '';
      if (a === 1) parts.push(b === 1 ? (r.perGroup ? 'os líderes de cada grupo' : 'o 1º colocado') : `os ${b} primeiros${per}`);
      else if (a === b) parts.push(r.perGroup ? `os ${a}º colocados${per}` : `o ${a}º colocado`);
      else if (a + 1 === b) parts.push(`o ${a}º e o ${b}º colocados${per}`);
      else parts.push(`do ${a}º ao ${b}º colocados${per}`);
      count += a === b && !r.perGroup ? 1 : 2;
    } else if ('bottom' in r) {
      parts.push(r.bottom === 1 ? 'o último colocado' : `os ${r.bottom} últimos`);
      count += r.bottom;
    } else if ('bestOfRank' in r) {
      parts.push(r.count === 1 ? `o melhor ${r.bestOfRank}º colocado` : `os ${r.count} melhores ${r.bestOfRank}º colocados`);
      count += r.count;
    } else if ('bestRest' in r) {
      parts.push(r.bestRest === 1 ? 'o melhor entre os restantes' : `os ${r.bestRest} melhores restantes`);
      count += r.bestRest;
    } else if ('winners' in r) {
      parts.push('os vencedores');
      count += 2;
    } else if ('losers' in r) {
      parts.push('os eliminados');
      count += 2;
    }
  }
  return { text: list([...new Set(parts)]) || 'os classificados', one: count === 1, winners };
}

interface RoundGroup {
  legs: number;
  neutral?: boolean;
  names: string[];
}

function roundGroups(def: KnockoutStageDef): RoundGroup[] {
  const groups: RoundGroup[] = [];
  for (const r of def.rounds) {
    const g = groups[groups.length - 1];
    const short = roundShort(r.name);
    if (g && g.legs === r.tie.legs && !!g.neutral === !!r.tie.neutral) g.names.push(short);
    else groups.push({ legs: r.tie.legs, neutral: r.tie.neutral, names: [short] });
  }
  return groups;
}

/** "em ida e volta (quartas, semi e final)" / "(semi em ida e volta; final em jogo único)" */
function roundsText(def: KnockoutStageDef): string {
  const groups = roundGroups(def);
  let out = groups.length === 1 ? `em ${tieText(groups[0].legs, groups[0].neutral)} (${list(groups[0].names)})` : `(${groups.map((g) => `${list(g.names)} em ${tieText(g.legs, g.neutral)}`).join('; ')})`;
  if (def.thirdPlace) out += ', com disputa de 3º lugar';
  if (def.byes && def.rounds.length > 1) {
    const next = roundShort(def.rounds[1].name);
    const into = next === 'quartas' || next === 'oitavas' ? `nas ${next}` : `na ${next}`;
    out += def.byes === 1 ? `; o melhor entra direto ${into}` : `; os ${def.byes} melhores entram direto ${into}`;
  }
  return out;
}

/** Mata-mata de uma rodada só: "às quartas em jogo único", "à final em ida e volta". */
const singleRound = (def: KnockoutStageDef) => def.rounds.length === 1 && !def.thirdPlace;
const singleText = (def: KnockoutStageDef) => `${toRound(roundShort(def.rounds[0].name))} em ${tieText(def.rounds[0].tie.legs, def.rounds[0].tie.neutral)}`;

function tableShape(def: TableStageDef): string {
  const legs = def.partialRounds ? `${def.partialRounds} rodadas` : legsText(def.legs);
  if ((def.groups ?? 1) > 1) return `${def.groups} grupos${def.crossGroups ? ' (cada clube enfrenta os de outro grupo)' : ''} em ${legs}`;
  return `em ${legs}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * (Fase 2) Continentais e regionais: texto escrito à mão (o gerador genérico fica confuso com várias fases de
 * entrada e troféus intermediários). Fiel a season/continental.ts da engine.
 */
const HANDWRITTEN: Record<string, string> = {
  LIBERTADORES:
    'Três fases preliminares em ida e volta (1ª, 2ª e 3ª); os 4 vencedores da 3ª fase se juntam aos 28 classificados diretos em 8 grupos de 4, em turno e returno. Os 2 primeiros de cada grupo vão às oitavas; oitavas, quartas e semi em ida e volta e final em jogo único em campo neutro.',
  SULAMERICANA:
    'Preliminar em jogo único entre clubes do mesmo país; 8 grupos de 4 em turno e returno, com 4 eliminados da 3ª fase da Libertadores. Os 2ºs colocados enfrentam os 3ºs dos grupos da Libertadores no play-off de oitavas; oitavas, quartas e semi em ida e volta e final em jogo único em campo neutro.',
  RECOPA: 'Os campeões da Libertadores e da Sul-Americana do ano anterior decidem o título em ida e volta; empate no agregado vai aos pênaltis.',
  INTERCONTINENTAL:
    'Jogos únicos em campo neutro: play-off entre os campeões da África e da Oceania; o vencedor enfrenta o campeão da Ásia na Copa África-Ásia-Pacífico; o campeão da Libertadores enfrenta o da CONCACAF no Dérbi das Américas; os dois vencedores fazem a Challenger Cup, e quem vence decide o título contra o campeão da Liga dos Campeões. Cada etapa nomeada vale troféu. CONCACAF, CAF e OFC são clubes convidados.',
  // (Etapa 2) UEFA, AFC e Copa do Brasil 2026
  UCL: 'Fase de liga com 36 clubes em tabela única: cada um faz 8 jogos contra 8 adversários diferentes, 2 de cada pote (um em casa e um fora). Os 8 primeiros vão direto às oitavas; do 9º ao 24º disputam o playoff em ida e volta; do 25º ao 36º estão eliminados. Oitavas, quartas e semi em ida e volta, em chave fixa, e final em jogo único em campo neutro.',
  UEL: 'Fase de liga com 36 clubes em tabela única: 8 jogos, 2 adversários de cada pote. Os 8 primeiros vão às oitavas; do 9º ao 24º, playoff em ida e volta. Oitavas, quartas e semi em ida e volta e final em jogo único.',
  UECL: 'Fase de liga com 36 clubes em tabela única: 6 jogos, um adversário de cada um dos 6 potes (3 em casa e 3 fora). Os 8 primeiros vão às oitavas; do 9º ao 24º, playoff em ida e volta. Oitavas, quartas e semi em ida e volta e final em jogo único.',
  'UEFA-SUP': 'Campeão da Liga dos Campeões × campeão da Liga Europa, em jogo único em campo neutro.',
  ACL: 'Playoff de entrada no Oeste; fase de liga em duas regiões (Oeste e Leste, 12 clubes cada): 8 jogos contra adversários da própria região. Os 8 primeiros de cada região fazem oitavas em ida e volta; quartas, semi e final em jogo único na sede centralizada (Jidá).',
  'BRA-CUP': '126 clubes em 5 fases de entrada: 1ª a 4ª fases em jogo único, com mando do pior ranqueado (a Série B entra na 3ª fase e a Série A na 4ª); na 5ª fase (16-avos) entram os 12 do pote 1 (Libertadores e campeões). Oitavas, quartas e semi em ida e volta e final em jogo único em campo neutro.',
  SUPERMUNDIAL: '32 clubes de todas as confederações em 8 grupos de 4, em turno único; os 2 primeiros de cada grupo seguem em mata-mata de jogo único (oitavas, quartas, semi e final).',
  NORDESTE: '16 clubes do Nordeste pelo ranking dos estaduais, em 4 grupos de 4 com turno e returno; os 2 primeiros de cada grupo fazem quartas e semi em jogo único e a final em ida e volta.',
};

/** Texto amigável do formato. `null` se não houver formato. */
export function describeFormat(format: FormatDef | undefined | null): string | null {
  if (!format?.stages.length) return null;
  if (HANDWRITTEN[format.id]) return HANDWRITTEN[format.id];
  const out: string[] = [];
  const championStage = format.stages.find((s) => s.id === format.champion);
  const nameOf = (s: StageDef) => (s.label ? titleCase(s.label) : s.name);
  format.stages.forEach((s: StageDef, i) => {
    const label = s.label ? titleCase(s.label) : null;
    const srcs = s.sources.length ? s.sources : (s.kind === 'table' ? (s.groupSources ?? []).flat() : []);
    const first = i === 0 || (srcs.length > 0 && srcs.every((r) => 'entrants' in r));
    if (s.kind === 'table') {
      if (first) {
        const many = (s.groups ?? 1) > 1;
        const base = many ? `fase de grupos com ${tableShape(s)}` : format.stages.length === 1 ? `pontos corridos ${tableShape(s)}` : `fase de classificação ${tableShape(s)}`;
        out.push(label && !/fase de grupos/i.test(label) ? `${label}: ${base}` : base);
        if (format.stages.length === 1) out.push('o 1º colocado é o campeão');
        return;
      }
      const w = who(srcs);
      if (s.relegationStage) {
        out.push(`${w.text} ${w.one ? 'disputa' : 'disputam'} ${label ? `o ${label}` : 'uma fase contra o rebaixamento'} ${tableShape(s)}`);
      } else {
        const name = nameOf(s);
        const shape = (s.groups ?? 1) > 1 ? `, com ${tableShape(s)}` : ` ${tableShape(s)}`;
        out.push(`${w.text} ${w.one ? 'avança' : 'avançam'} para ${art(name)} ${name}${shape}${championStage === s ? ', e o 1º é o campeão' : ''}`);
      }
      return;
    }
    // mata-mata
    if (first) {
      const tie0 = tieText(s.rounds[0].tie.legs, s.rounds[0].tie.neutral);
      if (label && singleRound(s)) out.push(`${label} em ${tie0}`);
      else out.push(`${label ? `${label}: ` : ''}${singleRound(s) && roundShort(s.rounds[0].name) === 'final' ? `final em ${tie0}` : `mata-mata ${roundsText(s)}`}`);
      return;
    }
    const w = who(srcs);
    const verb = w.one ? 'disputa' : 'disputam';
    if (s.relegationStage) {
      out.push(`os piores fazem um playoff contra o rebaixamento em ${tieText(s.rounds[0]?.tie.legs ?? 1)}`);
    } else if (s.title || (label && championStage !== s)) {
      const name = s.title ?? label!;
      const how = singleRound(s) ? `em ${tieText(s.rounds[0].tie.legs, s.rounds[0].tie.neutral)}` : roundsText(s);
      out.push(`${w.text} ${verb} ${art(name)} ${name} ${how}`);
    } else if (singleRound(s)) {
      out.push(`${w.text} ${w.one ? 'vai' : 'vão'} ${singleText(s)}`);
    } else if (w.winners) {
      out.push(`os vencedores seguem ${roundsText(s)}`);
    } else {
      out.push(`${w.text} ${w.one ? 'avança' : 'avançam'} ao mata-mata ${roundsText(s)}`);
    }
  });
  return cap(out.join('; ').replace(/\s+/g, ' ')) + '.';
}
