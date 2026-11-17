/**
 * Atributos de EXIBIÇÃO do card do jogador.
 *
 * O contrato de dados (`Player`) só traz `overall` e até 2 `traits`. Para a UI mostrar um card
 * rico, derivamos 6 atributos por posição de forma 100% determinística (mesmo jogador ⇒ mesmos
 * números, sempre). Eles NÃO entram na simulação — a engine usa apenas overall/traits.
 *
 * Fórmula de cada atributo:
 *   valor = overall
 *         + peso da posição   (atributo-chave da posição soma, secundário subtrai)
 *         + variação estável  (hash de `${player.id}:${atributo}` → −3..+3)
 *         + bônus de trait    (se o jogador TEM a característica ligada ao atributo: +6..+9)
 *   limitado a 25..99.
 *
 * Exemplo: atacante overall 80 com "Finalização" ⇒ Finalização ≈ 80 + 3 (peso) ± 3 + 6..9 ≈ 89–95.
 */
import type { Player, Position } from '@cosmicfut/shared';
import { hashString, seededRandom } from './utils';

/** Ids das traits na ordem do original (ver Trait em @cosmicfut/shared). */
export const TRAIT = {
  positioning: 0,
  penaltySaving: 1,
  reflexes: 2,
  rushingOut: 3,
  playmaking: 4,
  heading: 5,
  crossing: 6,
  tackling: 7,
  dribbling: 8,
  finishing: 9,
  marking: 10,
  passing: 11,
  stamina: 12,
  pace: 13,
} as const;

interface AttrDef {
  key: string;
  label: string;
  /** abreviação de 3 letras para o card */
  short: string;
  /** deslocamento em relação ao overall por relevância na posição */
  weight: number;
  /** trait que dá bônus a este atributo (se houver) */
  trait?: number;
}

const A = (key: string, label: string, short: string, weight: number, trait?: number): AttrDef => ({ key, label, short, weight, trait });

export const ATTRIBUTES_BY_POSITION: Record<Position, AttrDef[]> = {
  GK: [
    A('reflexes', 'Reflexos', 'REF', 3, TRAIT.reflexes),
    A('positioning', 'Colocação', 'COL', 2, TRAIT.positioning),
    A('rushingOut', 'Saída do gol', 'SAI', -1, TRAIT.rushingOut),
    A('penaltySaving', 'Defesa de pênaltis', 'PEN', -3, TRAIT.penaltySaving),
    A('handling', 'Firmeza', 'FIR', 0),
    A('distribution', 'Reposição', 'REP', -6),
  ],
  FB: [
    A('pace', 'Velocidade', 'VEL', 3, TRAIT.pace),
    A('crossing', 'Cruzamento', 'CRU', 1, TRAIT.crossing),
    A('marking', 'Marcação', 'MAR', 0, TRAIT.marking),
    A('tackling', 'Desarme', 'DES', -1, TRAIT.tackling),
    A('stamina', 'Resistência', 'RES', 2, TRAIT.stamina),
    A('dribbling', 'Drible', 'DRI', -4, TRAIT.dribbling),
  ],
  CB: [
    A('marking', 'Marcação', 'MAR', 3, TRAIT.marking),
    A('tackling', 'Desarme', 'DES', 2, TRAIT.tackling),
    A('heading', 'Cabeceio', 'CAB', 1, TRAIT.heading),
    A('strength', 'Força', 'FOR', 0),
    A('passing', 'Passe', 'PAS', -6, TRAIT.passing),
    A('pace', 'Velocidade', 'VEL', -7, TRAIT.pace),
  ],
  MF: [
    A('passing', 'Passe', 'PAS', 3, TRAIT.passing),
    A('playmaking', 'Armação', 'ARM', 1, TRAIT.playmaking),
    A('stamina', 'Resistência', 'RES', 1, TRAIT.stamina),
    A('dribbling', 'Drible', 'DRI', -1, TRAIT.dribbling),
    A('tackling', 'Desarme', 'DES', -5, TRAIT.tackling),
    A('finishing', 'Finalização', 'FIN', -6, TRAIT.finishing),
  ],
  FW: [
    A('finishing', 'Finalização', 'FIN', 3, TRAIT.finishing),
    A('dribbling', 'Drible', 'DRI', 1, TRAIT.dribbling),
    A('pace', 'Velocidade', 'VEL', 1, TRAIT.pace),
    A('heading', 'Cabeceio', 'CAB', -3, TRAIT.heading),
    A('passing', 'Passe', 'PAS', -5, TRAIT.passing),
    A('playmaking', 'Armação', 'ARM', -7, TRAIT.playmaking),
  ],
};

export interface DisplayAttribute {
  key: string;
  label: string;
  short: string;
  value: number;
  /** true quando o valor recebeu bônus por uma trait do jogador */
  boosted: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Inteiro estável em [lo, hi] a partir de uma semente textual. */
function stableInt(seed: string, lo: number, hi: number): number {
  const r = seededRandom(hashString(seed))();
  return lo + Math.floor(r * (hi - lo + 1));
}

/** 6 atributos de exibição, determinísticos, para o card do jogador. */
export function displayAttributes(player: Pick<Player, 'id' | 'position' | 'overall' | 'traits'>): DisplayAttribute[] {
  return ATTRIBUTES_BY_POSITION[player.position].map((def) => {
    const boosted = def.trait !== undefined && player.traits.includes(def.trait);
    const jitter = stableInt(`${player.id}:${def.key}`, -3, 3);
    const bonus = boosted ? stableInt(`${player.id}:${def.key}:trait`, 6, 9) : 0;
    return {
      key: def.key,
      label: def.label,
      short: def.short,
      value: clamp(Math.round(player.overall + def.weight + jitter + bonus), 25, 99),
      boosted,
    };
  });
}
