import { motion } from 'motion/react';
import { MapPin, Trophy } from 'lucide-react';
import type { Club, Country, Division } from '@cosmicfut/shared';
import type { SquadSummary } from '@/data/derive';
import { fmtMoney, levelToStars } from '@/lib/format';
import { EASE_OUT } from '@/lib/motion';
import { Crest } from '@/components/game/Crest';
import { Flag, Stars } from '@/components/game/bits';
import { MoraleChip } from '@/components/game/chips';

/**
 * (Atualização 41 — visual compacto) Faixa do clube: escudo em 60px (tamanho nativo, nítido), nome, contexto e os
 * números-chave numa linha só. Antes era um "hero" de 253px de altura (escudo de 152px com anel giratório);
 * agora ≈ 92px, e a moral do time aparece aqui também (status de leitura rápida).
 */
export function ClubHero({
  club,
  country,
  league,
  leagueLabel,
  summary,
  morale,
}: {
  club: Club;
  country: Country | undefined;
  league: Division | undefined;
  /** (carreira) competição principal atual — a divisão muda com acesso/rebaixamento */
  leagueLabel?: string;
  summary: SquadSummary;
  morale?: number;
}) {
  const stats = [
    { label: 'Overall médio', value: summary.avgOverall.toFixed(1) },
    { label: 'Jogadores', value: summary.size },
    { label: 'Valor do elenco', value: fmtMoney(summary.squadValue) },
    { label: 'Reputação', value: `${club.reputation}/5` },
  ];

  return (
    <section className="cf-card relative overflow-hidden border-club-accent/20">
      {/* camadas de cor do clube */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(105deg, color-mix(in oklab, var(--club-primary) 24%, transparent) 0%, color-mix(in oklab, var(--club-primary) 6%, transparent) 40%, transparent 62%, color-mix(in oklab, var(--club-secondary) 10%, transparent) 100%)',
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: 'repeating-linear-gradient(-55deg, var(--club-secondary) 0 2px, transparent 2px 22px)',
          maskImage: 'linear-gradient(90deg, transparent 0%, #000 55%, #000 100%)',
        }}
      />
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-club-accent/70 to-transparent" />

      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-3 p-3 sm:px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="relative grid size-16 shrink-0 place-items-center"
        >
          <div
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{ background: 'radial-gradient(circle, color-mix(in oklab, var(--club-primary) 40%, transparent) 0%, transparent 70%)' }}
          />
          {/* 60px nativo (1x, nítido) */}
          <Crest path={club.crest} name={club.name} colors={club.colors} size={60} className="relative drop-shadow-[0_4px_12px_color-mix(in_oklab,var(--club-primary)_60%,transparent)]" />
        </motion.div>

        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-meta text-fg-muted">
            <span className="flex items-center gap-1">
              <Flag country={country} />
              {country?.name ?? '—'}
            </span>
            {club.state && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3" /> {club.state}
              </span>
            )}
            {(leagueLabel || league) && (
              <span className="flex min-w-0 items-center gap-1">
                <Trophy className="size-3 text-club-accent" /> <span className="truncate">{leagueLabel ?? `${league!.name} · ${league!.divisionName}`}</span>
              </span>
            )}
          </div>
          <h1 className="truncate text-2xl leading-tight font-extrabold tracking-tight sm:text-[1.75rem]">{club.name}</h1>
          <div className="flex items-center gap-2">
            <Stars value={levelToStars(club.level)} size={12} />
            <span className="text-meta text-fg-subtle">nível {club.level}</span>
            {morale !== undefined && <MoraleChip value={morale} label />}
          </div>
        </div>

        <dl className="grid w-full grid-cols-2 gap-1.5 min-[480px]:grid-cols-4 sm:w-auto">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0 rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-1.5 backdrop-blur-sm sm:min-w-[6.5rem]">
              <dt className="cf-label truncate text-fg-muted">{s.label}</dt>
              <dd className="tabular truncate text-sm font-bold tracking-tight sm:text-base">{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
