import { describe, expect, it } from 'vitest';
import { normalizePrefs } from './game';

/** (Táticas) migração das prefs do slot: saves antigos sem vagas/posições continuam abrindo. */
describe('prefs do slot: predefinições e posições', () => {
  it('save antigo (sem presets/positions) ⇒ 3 vagas vazias, escalação intacta', () => {
    const old = { clubId: 'x', tactic: { formation: '4-3-3' }, lineup: { starters: ['a'], bench: [] }, shortlist: [] };
    const p = normalizePrefs(old);
    expect(p.presets).toEqual([null, null, null]);
    expect(p.lineup).toEqual({ starters: ['a'], bench: [] });
    expect(p.tactic.formation).toBe('4-3-3');
  });

  it('posições e vagas inválidas são limpas; válidas sobrevivem ao JSON', () => {
    const positions = Array(11).fill(null);
    positions[0] = { x: 0.5, y: 0.5 }; // goleiro: sempre fixo
    positions[9] = { x: 0.3, y: 0.8 };
    const raw = JSON.parse(
      JSON.stringify({
        clubId: 'x',
        tactic: { formation: '4-4-2', mentality: 'balanced', tempo: 'normal', pressing: 'medium', passing: 'mixed' },
        lineup: { starters: [], bench: [], positions },
        presets: [{ name: 'Pressão Total', tactic: { formation: '4-3-3', mentality: 'all-out' }, positions }, 'lixo'],
      }),
    );
    const p = normalizePrefs(raw);
    expect(p.lineup!.positions![0]).toBeNull();
    expect(p.lineup!.positions![9]).toEqual({ x: 0.3, y: 0.8 });
    expect(p.presets[0]!.name).toBe('Pressão Total');
    expect(p.presets[0]!.tactic.tempo).toBe('normal');
    expect(p.presets[1]).toBeNull();
    expect(p.presets).toHaveLength(3);
    // lixo nas posições ⇒ formação padrão
    expect(normalizePrefs({ lineup: { starters: [], bench: [], positions: 'x' } }).lineup!.positions).toBeUndefined();
  });
});
