/**
 * (17/11) Liga dos Amigos — ranking entre os técnicos humanos da sala (calculado pelo servidor), matriz de confrontos
 * diretos e o feed do que cada um fez. Aba do jogo online (/amigos) e resumo no fim de temporada.
 */
import { useEffect } from 'react';
import { Navigate } from 'react-router';
import { Medal, Swords, Trophy } from 'lucide-react';
import type { FriendsLeague } from '@cosmicfut/shared';
import { cn } from '@/lib/utils';
import { fmtMoneySigned } from '@/lib/format';
import { useIsOnline } from '@/store/mode';
import { useOnline } from '@/store/online';
import { IndexCrest, useClubName } from './common';

export function FriendsPage() {
  const online = useIsOnline();
  if (!online) return <Navigate to="/dashboard" replace />;
  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold tracking-[0.22em] text-brand-2 uppercase">Online</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <Medal className="size-6 text-club-accent" /> Liga dos Amigos
        </h1>
        <p className="text-sm text-fg-muted">Quem está mandando melhor na sala: liga, títulos, copas, lucro e confronto direto.</p>
      </header>
      <FriendsLeaguePanel />
    </div>
  );
}

const POINT_HELP =
  'Liga: até 20 pts pela posição (1ª divisão vale mais) · Títulos: continental 30, liga 25, copa 15, estadual 8, supercopa 6 · Copas: 2 por mata-mata vencido · Lucro: 1 pt a cada 5 mi (−15…+15) · Confronto direto: vitória 3, empate 1.';

export function FriendsLeaguePanel({ compact = false }: { compact?: boolean }) {
  const league = useOnline((s) => s.friends);
  const load = useOnline((s) => s.loadFriends);
  useEffect(() => {
    void load();
  }, [load]);
  if (!league) return <p className="cf-card p-6 text-center text-sm text-fg-muted">Carregando a Liga dos Amigos…</p>;
  return (
    <div className={cn('grid gap-4', !compact && 'xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]')}>
      <div className="space-y-4">
        <Ranking league={league} />
        {!compact && <Matrix league={league} />}
      </div>
      <Feed league={league} compact={compact} />
    </div>
  );
}

function Ranking({ league }: { league: FriendsLeague }) {
  const me = useOnline((s) => s.playerId);
  const name = useClubName();
  return (
    <section className="cf-card overflow-hidden" aria-label="Ranking">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Trophy className="size-4 text-club-accent" /> Classificação {league.season ? `· ${league.season}` : ''}
        </h2>
        <span className="text-[11px] text-fg-subtle" title={POINT_HELP}>
          como pontua?
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-[10px] tracking-wider text-fg-subtle uppercase">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-2 py-2 text-left">Técnico</th>
              <th className="px-2 py-2 text-right">Pts</th>
              <th className="px-2 py-2 text-right" title="Posição na liga">Liga</th>
              <th className="px-2 py-2 text-right">Títulos</th>
              <th className="px-2 py-2 text-right" title="Mata-matas vencidos">Copas</th>
              <th className="px-2 py-2 text-right">Lucro</th>
              <th className="px-3 py-2 text-right" title="Confronto direto (V-E-D)">Direto</th>
            </tr>
          </thead>
          <tbody>
            {league.rows.map((r, i) => (
              <tr key={r.playerId} className={cn('border-t border-line/60', r.playerId === me && 'bg-club-accent/8')}>
                <td className="px-3 py-2 font-black text-fg-muted">{i + 1}</td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color ?? '#64748b' }} aria-hidden />
                    <IndexCrest id={r.clubId} size={22} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{r.nickname}</span>
                      <span className="block truncate text-[11px] text-fg-muted" title={r.tenures && r.tenures.length > 1 ? `Passagens: ${r.tenures.map((t) => name(t.clubId)).join(' → ')}` : undefined}>
                        {r.clubId ? name(r.clubId) : 'sem clube'}
                        {r.league ? ` · ${r.league.pos}º de ${r.league.size}` : ''}
                        {r.tenures && r.tenures.length > 1 ? ` · ${r.tenures.length} clubes` : ''}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="tabular px-2 py-2 text-right text-base font-black">{r.points}</td>
                <td className="tabular px-2 py-2 text-right">{r.breakdown.league}</td>
                <td className="tabular px-2 py-2 text-right" title={r.titles.map((t) => `${t.name} (${t.season})`).join(', ')}>
                  {r.titles.length ? `${r.titles.length} · ${r.breakdown.trophies}` : '0'}
                </td>
                <td className="tabular px-2 py-2 text-right">{r.breakdown.cups}</td>
                <td className={cn('tabular px-2 py-2 text-right', r.profit >= 0 ? 'text-success' : 'text-danger')} title={`${r.breakdown.profit} pts`}>
                  {fmtMoneySigned(r.profit)}
                </td>
                <td className="tabular px-3 py-2 text-right">
                  {r.h2h.w}-{r.h2h.d}-{r.h2h.l}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-fg-subtle">{POINT_HELP}</p>
    </section>
  );
}

function Matrix({ league }: { league: FriendsLeague }) {
  // (carreira online) a matriz é por clube atual: técnicos sem clube ficam de fora
  const rows = league.rows.filter((r): r is typeof r & { clubId: string } => !!r.clubId);
  if (rows.length < 2) return null;
  return (
    <section className="cf-card p-4" aria-label="Confrontos diretos">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Swords className="size-4 text-club-accent" /> Confrontos diretos
      </h2>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th />
              {rows.map((r) => (
                <th key={r.clubId} className="px-2 pb-1" title={r.nickname}>
                  <IndexCrest id={r.clubId} size={20} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.clubId}>
                <th className="pr-2 text-left font-semibold whitespace-nowrap">{a.nickname}</th>
                {rows.map((b) => {
                  if (a.clubId === b.clubId) return <td key={b.clubId} className="bg-surface-3/40" />;
                  const c = league.matrix[a.clubId]?.[b.clubId];
                  return (
                    <td
                      key={b.clubId}
                      className={cn('tabular px-2 py-1 text-center', c && c.w > c.l ? 'text-success' : c && c.l > c.w ? 'text-danger' : 'text-fg-muted')}
                      title={c ? `${a.nickname} × ${b.nickname}: ${c.w}V ${c.d}E ${c.l}D · gols ${c.gf}-${c.ga}` : 'Ainda não se enfrentaram'}
                    >
                      {c ? `${c.w}-${c.d}-${c.l}` : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-fg-subtle">Linha contra coluna: vitórias-empates-derrotas.</p>
    </section>
  );
}

function Feed({ league, compact }: { league: FriendsLeague; compact: boolean }) {
  return (
    <section className="cf-card p-4" aria-label="Acontecimentos">
      <h2 className="mb-2 text-sm font-semibold">O que rolou na sala</h2>
      {league.feed.length === 0 ? (
        <p className="py-6 text-center text-xs text-fg-subtle">Nada ainda: jogos entre vocês, contratações e títulos aparecem aqui.</p>
      ) : (
        <ol className={cn('scrollbar-thin space-y-1.5 overflow-y-auto pr-1', compact ? 'max-h-64' : 'max-h-[34rem]')}>
          {league.feed.map((f, i) => (
            <li key={`${f.at}-${i}`} className="flex items-start gap-2 rounded-lg bg-surface-2/40 px-2.5 py-1.5 text-xs">
              <span aria-hidden>{f.kind === 'title' ? '🏆' : f.kind === 'win' ? '⚔️' : f.kind === 'draw' ? '🤝' : f.kind === 'signing' ? '✍️' : f.kind === 'sale' ? '💰' : '📣'}</span>
              <span className="min-w-0 flex-1">{f.text}</span>
              {f.date && <span className="shrink-0 text-[10px] text-fg-subtle">{f.date.slice(8, 10)}/{f.date.slice(5, 7)}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
