/** (18/11) Estrelas: vermelha (Top Mundial, 91+) e amarela (Destaque, 88–90). */
import { describe, expect, it } from 'vitest';
import { matchOverall, starTier, starValueMult } from '../src/stars';
import { quickSimulate } from '../src/match/index';
import { config } from './helpers';

describe('estrelas', () => {
  it('faixas: 91+ vermelha, 88–90 amarela, abaixo nada', () => {
    expect(starTier({ overall: 95 })).toBe('top');
    expect(starTier({ overall: 91 })).toBe('top');
    expect(starTier({ overall: 90 })).toBe('highlight');
    expect(starTier({ overall: 88 })).toBe('highlight');
    expect(starTier({ overall: 87 })).toBeNull();
  });

  it('valor +20% / +10% e status na partida +10% / +5% (até 99)', () => {
    expect(starValueMult({ overall: 92 })).toBe(1.2);
    expect(starValueMult({ overall: 89 })).toBe(1.1);
    expect(starValueMult({ overall: 70 })).toBe(1);
    expect(matchOverall({ overall: 92 })).toBe(99);
    expect(matchOverall({ overall: 88 })).toBe(92);
    expect(matchOverall({ overall: 80 })).toBe(80);
  });

  it('um time com estrelas rende mais que o mesmo time sem elas', () => {
    let withStars = 0, without = 0;
    for (let i = 0; i < 120; i++) {
      const a = config(`st:${i}`);
      const b = config(`st:${i}`);
      // mesmo time, os 4 atacantes/meias principais em 89 (Destaque) num e 87 no outro
      const boost = (cfg: typeof a, ovr: number) => {
        const ids = new Set(cfg.home.lineup.starters.slice(7));
        cfg.home.players = cfg.home.players.map((p) => (ids.has(p.id) ? { ...p, overall: ovr } : p));
      };
      boost(a, 89);
      boost(b, 87);
      withStars += quickSimulate(a).homeGoals;
      without += quickSimulate(b).homeGoals;
    }
    expect(withStars).toBeGreaterThan(without);
  });
});
