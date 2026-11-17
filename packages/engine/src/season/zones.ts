/**
 * (Etapa 2) Zonas de classificação de uma liga nacional ("Vagas"): posições que levam à Liga dos Campeões, Liga
 * Europa, Conferência, Libertadores, Sul-Americana e AFC Elite, e as de acesso, playoff e rebaixamento. São as zonas
 * NOMINAIS da regra (o repasse de vaga de quem já está classificado acontece na virada: qualifyUefa/qualifyAfc/
 * qualifyContinental). Pura — a UI pinta a tabela com elas.
 */
import type { CareerData } from '../contract';
import { continentalConfig } from './continental';
import { AFC_SAUDI, uefaSlotsConfig } from './confed';

export type QualZoneKind =
  | 'ucl' | 'uel' | 'uecl' | 'libertadores' | 'libpre' | 'sula' | 'acl' | 'aclpo'
  | 'promotion' | 'promoplayoff' | 'relplayoff' | 'relegation';

export interface QualZoneInfo {
  from: number;
  to: number;
  zone: QualZoneKind;
  label: string;
}

/** Zonas da divisão `leagueId` (posições 1-based) para uma tabela de `size` clubes. */
export function qualificationZones(data: CareerData, leagueId: string, size?: number): QualZoneInfo[] {
  const div = data.leagues.find((l) => l.id === leagueId);
  if (!div) return [];
  const n = size ?? div.clubIds.length;
  const code = leagueId.split('-')[0];
  const rules = div.rules;
  const out: QualZoneInfo[] = [];
  let p = 1;
  const push = (count: number, zone: QualZoneKind, label: string) => {
    if (count <= 0) return;
    const to = Math.min(n, p + count - 1);
    if (p <= to) out.push({ from: p, to, zone, label });
    p += count;
  };
  if (div.division === 1) {
    const uefa = uefaSlotsConfig(data).slots[code];
    if (uefa) {
      push(uefa.ucl, 'ucl', 'Liga dos Campeões (fase de liga)');
      push(uefa.uel, 'uel', 'Liga Europa (uma vaga é do campeão da copa)');
      push(uefa.uecl, 'uecl', code === 'ING' ? 'Liga Conferência (vaga do campeão da EFL Cup)' : 'Liga Conferência');
    } else if (code === 'ARS') {
      push(AFC_SAUDI.direct, 'acl', 'AFC Champions League Elite (uma vaga é do campeão da King\'s Cup)');
      push(AFC_SAUDI.playoff, 'aclpo', 'AFC Elite (playoff)');
    } else {
      const cfg = continentalConfig(data);
      const lib = cfg.libertadores[code];
      const sula = cfg.sulamericana[code];
      if (lib) {
        push(lib.groups - (lib.cupSlot ? 1 : 0), 'libertadores', `Libertadores (fase de grupos)${lib.cupSlot ? ' + campeão da copa' : ''}`);
        push(lib.f2, 'libpre', 'Libertadores (2ª fase)');
        push(lib.f1, 'libpre', 'Libertadores (1ª fase)');
      }
      if (sula) {
        push(sula.groups, 'sula', 'Sul-Americana (fase de grupos)');
        push(sula.prelim, 'sula', 'Sul-Americana (fase preliminar)');
      }
    }
  } else if (rules) {
    push(rules.promoted, 'promotion', 'Acesso direto');
    const po = rules.promotionPlayoff;
    if (po) out.push({ from: po.ranks[0], to: Math.min(n, po.ranks[1]), zone: 'promoplayoff', label: (po.spots ?? 1) > 0 ? 'Playoff de acesso' : 'Playoff (vaga no playoff de rebaixamento)' });
    const tp = rules.toRelegationPlayoff;
    if (tp?.from === 'rank') out.push({ from: tp.rank ?? 3, to: tp.rank ?? 3, zone: 'promoplayoff', label: 'Playoff contra a divisão de cima' });
  }
  if (rules?.relegationPlayoff) out.push({ from: rules.relegationPlayoff.rank, to: rules.relegationPlayoff.rank, zone: 'relplayoff', label: 'Playoff de rebaixamento' });
  const rel = div.division === 1 ? rules?.relegated ?? div.relegated : rules?.dropToStates ?? 0;
  if (rel > 0) out.push({ from: n - rel + 1, to: n, zone: 'relegation', label: rules?.dropToStates && div.division > 1 ? 'Rebaixamento (volta ao estadual)' : 'Rebaixamento' });
  return out.sort((a, b) => a.from - b.from);
}
