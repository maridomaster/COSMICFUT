/**
 * (18/11) Liga dos Amigos: títulos de cada técnico (emblemas na classificação) e a Sala de Troféus da sala online
 * (uma prateleira por técnico, troféus agrupados por competição, com as temporadas e o clube de cada conquista).
 */
import { Trophy } from 'lucide-react';
import type { FriendsLeague, FriendsRow } from '@cosmicfut/shared';
import { compareIdentity, competitionIdentity, type CompetitionIdentity } from '@/data/competitionIdentity';
import { CompetitionEmblem } from '@/components/game/CompetitionEmblem';
import { TrophyArt } from '@/components/game/TrophyArt';
import { IndexCrest, useClubName } from './common';

type Title = FriendsRow['titles'][number];

interface TitleGroup {
  key: string;
  idt: CompetitionIdentity;
  name: string;
  items: Title[];
}

/** Agrupa os títulos de um técnico por competição, do mais importante ao menos. */
export function groupTitles(titles: Title[]): TitleGroup[] {
  const m = new Map<string, TitleGroup>();
  for (const t of titles) {
    const key = t.id ?? t.name;
    let g = m.get(key);
    if (!g) {
      const idt = competitionIdentity(t.id ?? t.name, { name: t.name, type: t.type });
      g = { key, idt, name: t.name, items: [] };
      m.set(key, g);
    }
    g.items.push(t);
  }
  for (const g of m.values()) g.items.sort((a, b) => a.season - b.season);
  return [...m.values()].sort((a, b) => compareIdentity(a.idt, b.idt) || b.items.length - a.items.length);
}

/** Emblemas dos títulos na linha da classificação (×N quando repetido). */
export function TitleEmblems({ titles, max = 5 }: { titles: Title[]; max?: number }) {
  if (!titles.length) return <span className="text-fg-subtle">—</span>;
  const groups = groupTitles(titles);
  const shown = groups.slice(0, max);
  const rest = groups.slice(max).reduce((s, g) => s + g.items.length, 0);
  return (
    <span className="inline-flex items-center justify-end gap-1.5" data-testid="title-emblems">
      {shown.map((g) => (
        <span key={g.key} className="relative inline-flex" title={`${g.name}: ${g.items.map((t) => t.season).join(', ')}`}>
          <CompetitionEmblem compId={g.idt.id} identity={g.idt} size={22} />
          {g.items.length > 1 && (
            <span className="absolute -right-1.5 -bottom-1 rounded-full bg-surface-3 px-1 text-[9px] leading-3.5 font-black text-fg ring-1 ring-line">
              {g.items.length}
            </span>
          )}
        </span>
      ))}
      {rest > 0 && <span className="text-[11px] font-semibold text-fg-muted">+{rest}</span>}
    </span>
  );
}

/** Sala de Troféus da sala online: uma prateleira por técnico. */
export function FriendsTrophyRoom({ league }: { league: FriendsLeague }) {
  const name = useClubName();
  const rows = league.rows
    .slice()
    .sort((a, b) => b.breakdown.trophies - a.breakdown.trophies || b.titles.length - a.titles.length || a.nickname.localeCompare(b.nickname));
  return (
    <section className="cf-card p-4" aria-label="Sala de troféus" data-testid="friends-trophy-room">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Trophy className="size-4 text-club-accent" /> Sala de troféus
      </h2>
      <div className="space-y-3">
        {rows.map((r) => {
          const groups = groupTitles(r.titles);
          return (
            <div key={r.playerId} className="rounded-xl border border-line/70 bg-surface-2/30">
              <div className="flex items-center gap-2 border-b border-line/60 px-3 py-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color ?? '#64748b' }} aria-hidden />
                <span className="font-semibold">{r.nickname}</span>
                <span className="text-xs text-fg-muted">
                  {r.titles.length ? `${r.titles.length} ${r.titles.length === 1 ? 'título' : 'títulos'} · ${r.breakdown.trophies} pts` : 'nenhum título ainda'}
                </span>
              </div>
              {groups.length ? (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 p-3">
                  {groups.map((g) => {
                    const clubs = [...new Set(g.items.map((t) => t.clubId).filter((c): c is string => !!c))];
                    return (
                      <li key={g.key} className="flex flex-col items-center gap-1.5 rounded-lg bg-surface-2/50 px-2 py-2.5 text-center">
                        <div className="relative">
                          <TrophyArt compId={g.idt.id} identity={g.idt} height={64} />
                          {g.items.length > 1 && (
                            <span className="absolute -top-1 -right-3 rounded-full bg-club-accent px-1.5 text-[11px] font-black text-club-on-accent">×{g.items.length}</span>
                          )}
                        </div>
                        <span className="line-clamp-2 text-xs leading-tight font-semibold">{g.name}</span>
                        <span className="text-[11px] text-fg-muted tabular-nums">{g.items.map((t) => t.season).join(' · ')}</span>
                        {clubs.length > 0 && (
                          <span className="flex items-center gap-1" title={clubs.map((c) => name(c)).join(', ')}>
                            {clubs.map((c) => (
                              <IndexCrest key={c} id={c} size={16} />
                            ))}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-3 py-3 text-xs text-fg-subtle">Ganhe uma liga, copa ou estadual para encher a prateleira.</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
