/**
 * (Prêmios) Premiação do fim da temporada na tela da virada (solo e online): Bola de Ouro (pódio), Seleção do Mundo e
 * o time + craque do campeonato de cada humano. Os números vêm da engine (season/awards.ts).
 */
import { useState, type ReactNode } from 'react';
import { Crown, Globe2, Medal, Trophy } from 'lucide-react';
import type { AwardPlayer, SeasonAwards } from '@cosmicfut/engine';
import type { Position } from '@cosmicfut/shared';
import { useCountryMap } from '@/data/hooks';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Flag, PositionChip } from '@/components/game/bits';
import { ClubCrest, clubLabel } from '@/components/game/status';

const PODIUM = [
  { label: 'Bola de Ouro', cls: 'text-[#f5c542]', ring: 'ring-[#f5c542]/60 bg-[#f5c542]/10' },
  { label: '2º lugar', cls: 'text-[#c9d1d9]', ring: 'ring-[#c9d1d9]/40 bg-[#c9d1d9]/5' },
  { label: '3º lugar', cls: 'text-[#d08b4f]', ring: 'ring-[#d08b4f]/40 bg-[#d08b4f]/5' },
];

const LINES: { label: string; pos: Position[] }[] = [
  { label: 'Ataque', pos: ['FW'] },
  { label: 'Meio', pos: ['MF'] },
  { label: 'Defesa', pos: ['FB', 'CB'] },
  { label: 'Gol', pos: ['GK'] },
];

const statLine = (p: AwardPlayer) => `${p.games} j · ${p.goals} g · ${p.assists} a · nota ${p.rating.toFixed(1)}`;

export function AwardsSection({ awards, clubIds }: { awards: SeasonAwards; clubIds: string[] }) {
  const mine = new Set(clubIds);
  const [tab, setTab] = useState<string>('world');
  const leagues = awards.leagues.filter((l) => l.xi.length);
  const current = tab === 'world' ? null : leagues.find((l) => l.competitionId === tab) ?? null;
  return (
    <Card data-testid="season-awards">
      <CardHeader icon={<Trophy />} title={`Prêmios da temporada ${awards.label}`} subtitle="Bola de Ouro, Seleção do Mundo e o time do campeonato" />
      <CardContent className="space-y-4">
        {awards.ballonDor.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-3" data-testid="ballon-dor">
            {awards.ballonDor.map((p, i) => (
              <PodiumCard key={p.playerId} p={p} place={i} mine={mine.has(p.clubId)} />
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <TabButton active={tab === 'world'} onClick={() => setTab('world')}>
            <Globe2 className="size-3.5" /> Seleção do Mundo
          </TabButton>
          {leagues.map((l) => (
            <TabButton key={l.competitionId} active={tab === l.competitionId} onClick={() => setTab(l.competitionId)}>
              <Medal className="size-3.5" /> Time da {l.name}
            </TabButton>
          ))}
        </div>
        {current?.best && (
          <div className="flex items-center gap-3 rounded-xl border border-club-accent/40 bg-club-accent/10 px-3 py-2" data-testid="league-best">
            <Crown className="size-5 shrink-0 text-club-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold tracking-wide text-club-accent uppercase">Craque da {current.name}</div>
              <div className="truncate text-sm font-bold">
                {current.best.name} <span className="font-normal text-fg-muted">· {clubLabel(current.best.clubId)}</span>
              </div>
            </div>
            <span className="tabular text-xs text-fg-muted">{statLine(current.best)}</span>
          </div>
        )}
        <TeamOfSeason players={current ? current.xi : awards.world} mine={mine} />
      </CardContent>
    </Card>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors',
        active ? 'border-club-accent bg-club-accent/15 text-fg' : 'border-line/70 text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function PodiumCard({ p, place, mine }: { p: AwardPlayer; place: number; mine: boolean }) {
  const countries = useCountryMap();
  const m = PODIUM[place];
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-xl p-3 ring-1', m.ring, place === 0 && 'sm:order-2', place === 1 && 'sm:order-1', place === 2 && 'sm:order-3')}>
      <div className={cn('flex items-center gap-1.5 text-xs font-bold tracking-wide uppercase', m.cls)}>
        {place === 0 ? <Crown className="size-4" /> : <Medal className="size-4" />} {m.label}
      </div>
      <div className="flex items-center gap-2">
        <ClubCrest id={p.clubId} size={28} />
        <div className="min-w-0">
          <div className={cn('truncate font-extrabold', place === 0 ? 'text-lg' : 'text-base', mine && 'text-club-accent')}>{p.name}</div>
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Flag country={countries.get(p.nationalityId)} />
            <span className="truncate">{clubLabel(p.clubId)}</span>
          </div>
        </div>
      </div>
      <div className="tabular text-[11px] text-fg-muted">{statLine(p)}</div>
    </div>
  );
}

function TeamOfSeason({ players, mine }: { players: AwardPlayer[]; mine: Set<string> }) {
  if (!players.length) return <p className="text-sm text-fg-muted">Sem jogadores com jogos suficientes nesta temporada.</p>;
  return (
    <div className="space-y-2" data-testid="team-of-season">
      {LINES.map((line) => {
        const row = players.filter((p) => line.pos.includes(p.position));
        if (!row.length) return null;
        return (
          <div key={line.label}>
            <div className="cf-label mb-1">{line.label}</div>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {row.map((p) => (
                <div
                  key={p.playerId}
                  className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1.5', mine.has(p.clubId) ? 'border-club-accent/60 bg-club-accent/10' : 'border-line/60 bg-surface-2/35')}
                >
                  <PositionChip position={p.position} />
                  <ClubCrest id={p.clubId} size={18} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{p.name}</div>
                    <div className="tabular truncate text-[10px] text-fg-subtle">{statLine(p)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** (Histórico) vencedores da Bola de Ouro de cada temporada premiada (mais recente primeiro). */
export function BallonHistory({ awards }: { awards: SeasonAwards[] }) {
  return (
    <Card data-testid="ballon-history">
      <CardHeader icon={<Crown />} title="Bola de Ouro — vencedores" subtitle={`${awards.length} temporadas premiadas`} />
      <CardContent className="space-y-1.5">
        {awards
          .slice()
          .reverse()
          .map((a) => {
            const w = a.ballonDor[0];
            if (!w) return null;
            return (
              <div key={`${a.date}-${a.label}`} className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface-2/35 px-2.5 py-1.5">
                <span className="tabular w-16 shrink-0 text-xs font-bold text-fg-muted">{a.label}</span>
                <ClubCrest id={w.clubId} size={18} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{w.name}</span>
                <span className="tabular hidden text-[11px] text-fg-subtle sm:inline">{statLine(w)}</span>
              </div>
            );
          })}
      </CardContent>
    </Card>
  );
}
