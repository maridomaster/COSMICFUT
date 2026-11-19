/**
 * (19/11) Ícones de premiação: BOLA DE OURO (mundial) e BOLA DE PRATA (campeonato nacional). Valem até a próxima
 * premiação e dão bônus nas partidas (HONOR na engine): +2 / +1 de overall e −20% / −10% de cansaço.
 */
import { useId } from 'react';
import { HONOR, honorsOf, type Honor } from '@cosmicfut/engine';
import { cn } from '@/lib/utils';
import { useSeason } from '@/store/season';

const PALETTE = {
  world: { light: '#fff3b0', mid: '#f5c542', dark: '#8a5a00', glow: 'rgba(245,197,66,.55)' },
  national: { light: '#ffffff', mid: '#c9d1d9', dark: '#5b6470', glow: 'rgba(201,209,217,.5)' },
};

export const honorTitle = (h: Honor) =>
  h.kind === 'world'
    ? `Bola de Ouro ${h.label}: +${HONOR.world.overall} de overall e ${Math.round((1 - HONOR.world.drain) * 100)}% menos cansaço nas partidas, até a próxima premiação`
    : `Bola de Prata ${h.label}${h.leagueName ? ` (${h.leagueName})` : ''}: +${HONOR.national.overall} de overall e ${Math.round((1 - HONOR.national.drain) * 100)}% menos cansaço nas partidas, até a próxima premiação`;

export function HonorBallIcon({ kind, size = 14, className, title }: { kind: Honor['kind']; size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, '');
  const c = PALETTE[kind];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      style={{ filter: `drop-shadow(0 1px 1px rgba(0,0,0,.5)) drop-shadow(0 0 ${Math.max(2, size / 6)}px ${c.glow})` }}
      role="img"
      aria-label={title ?? (kind === 'world' ? 'Bola de Ouro' : 'Bola de Prata')}
      data-testid={`honor-${kind}`}
    >
      <title>{title ?? (kind === 'world' ? 'Bola de Ouro' : 'Bola de Prata')}</title>
      <defs>
        <radialGradient id={`b${id}`} cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor={c.light} />
          <stop offset="0.5" stopColor={c.mid} />
          <stop offset="1" stopColor={c.dark} />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10.5" fill={`url(#b${id})`} stroke={c.dark} strokeWidth="0.8" />
      {/* gomos da bola */}
      <path d="M12 7.2 L16.4 10.4 L14.7 15.6 L9.3 15.6 L7.6 10.4 Z" fill={c.dark} opacity="0.55" />
      <path d="M12 7.2 V2.2 M16.4 10.4 L21 8.8 M14.7 15.6 L17.6 19.8 M9.3 15.6 L6.4 19.8 M7.6 10.4 L3 8.8" stroke={c.dark} strokeWidth="0.9" opacity="0.5" />
      <ellipse cx="8.6" cy="7.4" rx="3.2" ry="2" fill="#fff" opacity="0.45" />
    </svg>
  );
}

/** Ícones vigentes do jogador (nada se não tiver). */
export function PlayerHonors({ playerId, size = 14 }: { playerId: string; size?: number }) {
  const honors = useSeason((s) => s.save?.season.career?.honors);
  const list = honorsOf(honors, playerId);
  if (!list.length) return null;
  return (
    <>
      {list.map((h) => (
        <HonorBallIcon key={`${h.kind}-${h.competitionId ?? ''}`} kind={h.kind} size={size} title={honorTitle(h)} />
      ))}
    </>
  );
}
