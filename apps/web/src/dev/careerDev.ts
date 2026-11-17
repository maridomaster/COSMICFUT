/**
 * Ferramentas de DESENVOLVIMENTO da carreira (carregadas só com `import.meta.env.DEV`).
 * No console do navegador: `await __cf.dev.playUntil('BRA-CUP')` avança jogando os jogos do humano
 * por `quickSimulate` (sem Match Day) até um jogo da competição pedida (ou do predicado).
 */
import { MatchSimulation, quickSimulate, type Fixture } from '@cosmicfut/engine';
import { buildMatchSetup } from '@/pages/match/setup';
import { useSoloGame } from '@/store/game';
import { useMatch } from '@/store/match';
import { useSoloSeason } from '@/store/season';
import { fixtureToday } from '@/season/view';

async function playUntil(target: string | ((f: Fixture) => boolean), maxMatches = 60): Promise<Fixture | string> {
  const pred = typeof target === 'string' ? (f: Fixture) => f.competitionId === target : target;
  for (let i = 0; i < maxMatches; i++) {
    const st = useSoloSeason.getState();
    const save = st.save;
    if (!save) return 'sem carreira';
    // (Fase 3) clube humano da temporada (o técnico pode ter sido demitido ou trocado de clube)
    const hid = save.season.humanClubIds[0];
    if (!hid) return 'desempregado';
    let today = fixtureToday(save.season, hid);
    if (!today) {
      const r = await st.continueToMatch();
      if (r === 'season-over') return 'season-over';
      if (r === 'fired') return 'demitido';
      const s2 = useSoloSeason.getState().save!;
      if (!s2.season.humanClubIds[0]) return 'desempregado';
      today = fixtureToday(s2.season, s2.season.humanClubIds[0]);
      if (!today) continue;
    }
    if (pred(today)) return today;
    const cur = useSoloSeason.getState().save!;
    const { tactic, lineup } = useSoloGame.getState();
    const setup = buildMatchSetup(cur.season, today, cur.season.humanClubIds[0], tactic, lineup);
    await useSoloSeason.getState().finishMatchDay(today.id, quickSimulate(setup.config));
    if (!useSoloSeason.getState().save?.season.humanClubIds[0]) return 'demitido';
  }
  return 'limite';
}

/**
 * Demonstração visual da disputa de pênaltis: abre o Match Day de HOJE como jogo único sem prorrogação,
 * com uma seed que termina empatada (não altera a temporada — use `resetMatch()` em vez de "Continuar").
 */
function shootoutDemo(): number | string {
  const save = useSoloSeason.getState().save;
  if (!save) return 'sem carreira';
  const f = fixtureToday(save.season, save.clubId);
  if (!f) return 'sem jogo hoje';
  const { tactic, lineup } = useSoloGame.getState();
  const setup = buildMatchSetup(save.season, f, save.clubId, tactic, lineup);
  for (let i = 0; i < 300; i++) {
    const cfg = { ...setup.config, seed: `demo:${i}`, knockout: true, extraTime: false, aggregate: undefined };
    if (new MatchSimulation(cfg).runToEnd().penalties) {
      useMatch.getState().start(cfg, f.id, setup.humanSide);
      return i;
    }
  }
  return 'nenhuma seed com pênaltis';
}

export function installCareerDev(): void {
  const w = window as unknown as { __cf?: Record<string, unknown> };
  w.__cf = { ...(w.__cf ?? {}), dev: { playUntil, shootoutDemo, match: useMatch, resetMatch: () => useMatch.getState().reset() } };
}
