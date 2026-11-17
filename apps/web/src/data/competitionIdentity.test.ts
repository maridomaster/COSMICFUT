/**
 * (Sala de Troféus) Testes do registro de identidade das competições: toda competição do registro de dados
 * (competitions.json) resolve para uma identidade conhecida, com troféu existente em /assets e prateleira coerente.
 * Rodar: `npm test --workspace @cosmicfut/web` (vitest).
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_COMPETITION_IDS, competitionIdentity, compareIdentity, shelfOf, winnableCompetitionIds,
} from './competitionIdentity';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const registry = JSON.parse(fs.readFileSync(`${PUBLIC}data/competitions.json`, 'utf8')) as {
  competitions: { id: string; kind: string; name: string; disabled?: boolean }[];
};
const HEX = /^#[0-9a-f]{6}$/i;

describe('competitionIdentity', () => {
  it('toda competição do competitions.json resolve para uma identidade conhecida', () => {
    const missing = registry.competitions.filter((c) => !competitionIdentity(c.id).known).map((c) => c.id);
    expect(missing).toEqual([]);
    expect(registry.competitions.length).toBeGreaterThan(140);
  });

  it('identidades completas: nome, sigla curta, cores válidas, prateleira', () => {
    for (const id of KNOWN_COMPETITION_IDS) {
      const idt = competitionIdentity(id);
      expect(idt.name.length, id).toBeGreaterThan(1);
      expect(idt.short.length, id).toBeGreaterThan(0);
      expect(idt.short.length, id).toBeLessThanOrEqual(5);
      for (const c of Object.values(idt.colors)) expect(c, id).toMatch(HEX);
      if (idt.awardable) expect(shelfOf(idt), id).not.toBeNull();
      else expect(idt.kind, id).toBe('playoff');
    }
  });

  it('as imagens de troféu do original existem em /assets', () => {
    const missing = KNOWN_COMPETITION_IDS.map((id) => competitionIdentity(id).trophy.image).filter((p): p is string => !!p && !fs.existsSync(`${PUBLIC}assets/${p}`));
    expect(missing).toEqual([]);
  });

  it('prateleiras: continentais/mundiais, nacional, copas e estaduais', () => {
    expect(shelfOf(competitionIdentity('LIBERTADORES'))).toBe('mundial');
    expect(shelfOf(competitionIdentity('INTERCONTINENTAL'))).toBe('mundial');
    expect(shelfOf(competitionIdentity('UEFA-SUP'))).toBe('mundial');
    expect(shelfOf(competitionIdentity('BRA-1'))).toBe('nacional');
    expect(shelfOf(competitionIdentity('ING-CUP'))).toBe('copas');
    expect(shelfOf(competitionIdentity('BRA-SUP'))).toBe('copas');
    expect(shelfOf(competitionIdentity('NORDESTE'))).toBe('copas');
    expect(shelfOf(competitionIdentity('EST-SP-1'))).toBe('estaduais');
    expect(competitionIdentity('ALE-PO').awardable).toBe(false);
  });

  it('nomes de exibição sem patrocinador', () => {
    expect(competitionIdentity('EST-SP-1').name).toBe('Paulista');
    expect(competitionIdentity('EST-RJ-1').name).toBe('Carioca');
    expect(competitionIdentity('COL-1').name).not.toMatch(/BetPlay/i);
  });

  it('ids desconhecidos recebem identidade genérica (nunca undefined)', () => {
    const a = competitionIdentity('XYZ-1', { name: 'Liga Fictícia', type: 'league' });
    expect(a.known).toBe(false);
    expect(a.kind).toBe('league');
    expect(a.name).toBe('Liga Fictícia');
    const b = competitionIdentity('EST-ZZ-2', { name: 'Estadual Z' });
    expect(b.tier).toBe('estadual');
    const c = competitionIdentity('MISTERIO', { name: 'Copa Mistério', type: 'cup' });
    expect(shelfOf(c)).toBe('copas');
  });

  it('competições ganháveis por região', () => {
    const bra = winnableCompetitionIds({ country: 'BRA', uf: 'PE' });
    for (const id of ['LIBERTADORES', 'SULAMERICANA', 'RECOPA', 'INTERCONTINENTAL', 'SUPERMUNDIAL', 'BRA-1', 'BRA-CUP', 'BRA-SUP', 'EST-PE-1', 'NORDESTE']) expect(bra).toContain(id);
    expect(bra).not.toContain('UCL');
    const sp = winnableCompetitionIds({ country: 'BRA', uf: 'SP', played: ['BRA-2', 'EST-SP-2'] });
    expect(sp).toContain('EST-SP-1');
    expect(sp).toContain('BRA-2');
    expect(sp).not.toContain('NORDESTE');
    const ing = winnableCompetitionIds({ country: 'ING', played: ['ALE-PO'] });
    for (const id of ['UCL', 'UEL', 'UECL', 'UEFA-SUP', 'ING-1', 'ING-CUP', 'ING-LCUP', 'ING-SUP', 'INTERCONTINENTAL']) expect(ing).toContain(id);
    expect(ing).not.toContain('ALE-PO');
    expect(winnableCompetitionIds({ country: 'ARS' })).toContain('ACL');
    // todo ganhável de todo país em escopo é conhecido
    for (const country of ['BRA', 'ARG', 'URU', 'COL', 'PAR', 'CHI', 'EQU', 'ING', 'ESP', 'ITA', 'ALE', 'FRA', 'POR', 'HOL', 'ARS']) {
      for (const id of winnableCompetitionIds({ country, uf: country === 'BRA' ? 'RJ' : null })) expect(competitionIdentity(id).known, `${country}:${id}`).toBe(true);
    }
  });

  it('ordem: mundial antes de continental e por prestígio', () => {
    const list = ['SULAMERICANA', 'INTERCONTINENTAL', 'LIBERTADORES', 'RECOPA'].map((id) => competitionIdentity(id)).sort(compareIdentity).map((x) => x.id);
    expect(list[0]).toBe('INTERCONTINENTAL');
    expect(list.indexOf('LIBERTADORES')).toBeLessThan(list.indexOf('SULAMERICANA'));
  });
});
