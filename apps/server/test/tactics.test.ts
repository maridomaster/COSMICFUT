import { describe, expect, it } from 'vitest';
import { detectRole, quickSimulate, shapeSlots, type MatchConfig } from '@cosmicfut/engine';
import * as V from '../src/validate';

const squad = new Set(Array.from({ length: 22 }, (_, i) => `c:${i}`));
const starters = Array.from({ length: 11 }, (_, i) => `c:${i}`);
const tactic = { formation: '4-3-3', mentality: 'balanced', tempo: 'normal', pressing: 'medium', passing: 'mixed' };

describe('(Táticas) validação de posições personalizadas', () => {
  it('aceita 11 posições válidas e corrige goleiro/zona do gol', () => {
    const positions: unknown[] = Array(11).fill(null);
    positions[0] = { x: 0.5, y: 0.6 }; // goleiro: ignorado (fixo)
    positions[9] = { x: 0.5, y: 0.02 }; // atacante na zona do gol: puxado para fora
    positions[5] = { x: 0.5, y: 0.66 };
    const l = V.lineup({ starters, bench: [], positions }, squad, '4-3-3');
    expect(l.positions![0]).toBeNull();
    expect(l.positions![9]!.y).toBeGreaterThanOrEqual(0.13);
    expect(detectRole(l.positions![9]!.x, l.positions![9]!.y)).not.toBe('GK');
    expect(shapeSlots('4-3-3', l.positions)[5].role).toBe('AM');
  });

  it('rejeita formatos inválidos', () => {
    expect(() => V.lineup({ starters, bench: [], positions: [{ x: 0.5, y: 0.5 }] }, squad)).toThrow(V.ValidationError);
    const bad: unknown[] = Array(11).fill(null);
    bad[3] = { x: 'a', y: 0.5 };
    expect(() => V.lineup({ starters, bench: [], positions: bad }, squad)).toThrow(V.ValidationError);
    bad[3] = { x: 1.5, y: 0.5 };
    expect(() => V.lineup({ starters, bench: [], positions: bad }, squad)).toThrow(V.ValidationError);
    bad[3] = { x: Number.NaN, y: 0.5 };
    expect(() => V.lineup({ starters, bench: [], positions: bad }, squad)).toThrow(V.ValidationError);
    expect(() => V.lineup({ starters, bench: [], positions: 'x' }, squad)).toThrow(V.ValidationError);
    // sem posições continua válido (clientes antigos)
    expect(V.lineup({ starters, bench: [] }, squad).positions).toBeUndefined();
  });

  it('comando de partida set-shape é validado', () => {
    const ok = V.matchCommand({ type: 'set-shape', side: 'away', positions: Array(11).fill(null).map((_, i) => (i === 4 ? { x: 0.3, y: 0.8 } : null)) }, 'home');
    expect(ok).toMatchObject({ type: 'set-shape', side: 'home' });
    expect(V.matchCommand({ type: 'set-shape', positions: null }, 'away')).toEqual({ type: 'set-shape', side: 'away', positions: null });
    expect(() => V.matchCommand({ type: 'set-shape', positions: [1, 2] }, 'home')).toThrow(V.ValidationError);
  });

  it('predefinições: nome limpo, tática válida, XI do elenco, no máximo 3', () => {
    const p = V.presets([{ name: ' Retranca\u0007 Copa ', tactic, starters }, null, null], squad);
    expect(p[0]).toMatchObject({ name: 'Retranca Copa', tactic, starters });
    expect(p[1]).toBeNull();
    expect(() => V.presets([null, null, null, null], squad)).toThrow(V.ValidationError);
    expect(() => V.presets([{ name: 'x', tactic: { ...tactic, formation: '1-1-8' } }], squad)).toThrow(V.ValidationError);
    expect(() => V.presets([{ name: 'x', tactic, starters: [...starters.slice(0, 10), 'outro:1'] }], squad)).toThrow(V.ValidationError);
  });

  it('as posições validadas chegam ao motor (o servidor simula com elas)', () => {
    const P = (id: string, position: 'GK' | 'FB' | 'CB' | 'MF' | 'FW') => ({
      id, name: id, position, age: 26, nationalityId: 29, side: 'R' as const, traits: [], star: false, highlight: false, worldClass: false,
      overall: 75, potential: 75, wage: 1, value: 1, youth: false, tmId: null,
    });
    const pos: ('GK' | 'FB' | 'CB' | 'MF' | 'FW')[] = ['GK', 'FB', 'CB', 'CB', 'FB', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
    const team = (c: string, home: boolean, positions?: unknown) => {
      const players = pos.map((p, i) => P(`${c}:${i}`, p));
      const ids = players.map((p) => p.id);
      const lineup = V.lineup({ starters: ids, bench: [], ...(positions ? { positions } : {}) }, new Set(ids), '4-4-2');
      return { clubId: c, name: c, players, lineup, tactic: { ...tactic, formation: '4-4-2' as const }, isHome: home, control: 'ai' as const } as MatchConfig['home'];
    };
    const attack: unknown[] = Array(11).fill(null);
    attack[1] = { x: 0.12, y: 0.8 };
    attack[4] = { x: 0.88, y: 0.8 };
    attack[5] = { x: 0.2, y: 0.68 };
    attack[8] = { x: 0.8, y: 0.68 };
    let gaPlain = 0, gaShape = 0;
    for (let i = 0; i < 120; i++) {
      gaPlain += quickSimulate({ seed: `srv:${i}`, home: team('h', true), away: team('a', false) }).awayGoals;
      gaShape += quickSimulate({ seed: `srv:${i}`, home: team('h', true, attack), away: team('a', false) }).awayGoals;
    }
    expect(gaShape).toBeGreaterThan(gaPlain);
  });
});
