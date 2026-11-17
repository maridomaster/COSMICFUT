import { Link } from 'react-router';
import { motion } from 'motion/react';
import { PlayCircle } from 'lucide-react';
import type { SeasonState } from '@cosmicfut/engine';
import { EASE_OUT } from '@/lib/motion';
import { fixtureInfo } from '@/season/comps';
import { fixtureToday } from '@/season/view';
import { continentalStyle } from '@/season/continental';
import { ContinentalSeal } from '@/components/game/ContinentalSeal';
import { ClubCrest, clubLabel } from '@/components/game/status';

/**
 * (Fase 2) Destaque do dia de jogo continental: faixa com o selo próprio (não oficial) da competição,
 * fase/perna e o adversário. Só aparece quando o jogo de HOJE é de uma continental.
 */
export function ContinentalMatchBanner({ season, clubId }: { season: SeasonState; clubId: string }) {
  const f = fixtureToday(season, clubId);
  if (!f) return null;
  const info = fixtureInfo(season, f);
  if (info.comp?.type !== 'continental') return null;
  const st = continentalStyle(info.comp.id);
  const home = f.homeId === clubId;
  const opp = home ? f.awayId : f.homeId;
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className="relative overflow-hidden rounded-[var(--radius-card)] border px-3 py-2.5 sm:px-4"
      style={{
        borderColor: `color-mix(in oklab, ${st.main} 55%, transparent)`,
        background: `linear-gradient(110deg, color-mix(in oklab, ${st.main} 30%, var(--color-surface)) 0%, var(--color-surface) 55%, color-mix(in oklab, ${st.main} 14%, var(--color-surface)) 100%)`,
      }}
      aria-label={`Dia de ${info.comp.name}`}
    >
      {/* brilho e listras próprias */}
      <div aria-hidden className="pointer-events-none absolute -top-16 -left-10 size-56 rounded-full opacity-40 blur-3xl" style={{ background: st.glow }} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{ backgroundImage: `repeating-linear-gradient(-60deg, ${st.glow} 0 2px, transparent 2px 18px)`, maskImage: 'linear-gradient(90deg, transparent, #000 60%)' }}
      />
      <div className="relative flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
        <motion.div initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 14 }}>
          <ContinentalSeal compId={info.comp.id} size={48} title={info.comp.name} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black tracking-[0.22em] uppercase" style={{ color: st.glow }}>
            Noite continental
          </p>
          <h2 className="text-lg leading-tight font-extrabold tracking-tight">{info.comp.name}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            {info.phase}
            {info.legLabel ? ` · ${info.legLabel}` : ''}
            {f.neutral ? ' · campo neutro' : home ? ' · em casa' : ' · fora'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <ClubCrest id={clubId} size={30} />
            <span className="text-xs font-black text-fg-muted">x</span>
            <ClubCrest id={opp} size={30} />
            <span className="max-w-[8rem] truncate text-sm font-bold">{clubLabel(opp, true)}</span>
          </div>
          <Link
            to="/partida"
            className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
            style={{ background: st.main }}
          >
            <PlayCircle className="size-4" /> Jogar
          </Link>
        </div>
      </div>
    </motion.section>
  );
}
