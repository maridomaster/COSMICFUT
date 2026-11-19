/**
 * (18/11) Estrela 3D dos jogadores: VERMELHA = Top Mundial (overall 91+), AMARELA = Destaque (88–90).
 * SVG com faces chanfradas (luz de cima à esquerda), brilho e sombra — fica nítida em qualquer tamanho.
 */
import { useId } from 'react';
import { STARS, starTier, type StarTier } from '@cosmicfut/engine';
import { cn } from '@/lib/utils';

const PALETTE: Record<StarTier, { light: string; mid: string; dark: string; edge: string; glow: string }> = {
  top: { light: '#ff8a8a', mid: '#e11d2e', dark: '#7f0a14', edge: '#4a050b', glow: 'rgba(225,29,46,.55)' },
  highlight: { light: '#fff3a3', mid: '#f5b301', dark: '#9a6500', edge: '#5c3a00', glow: 'rgba(245,179,1,.5)' },
};

// estrela de 5 pontas (centro 12,12): pontas externas e vales internos
const OUTER = [0, 1, 2, 3, 4].map((i) => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
  return [12 + 10.5 * Math.cos(a), 12.6 + 10.5 * Math.sin(a)] as const;
});
const INNER = [0, 1, 2, 3, 4].map((i) => {
  const a = -Math.PI / 2 + Math.PI / 5 + (i * 2 * Math.PI) / 5;
  return [12 + 4.4 * Math.cos(a), 12.6 + 4.4 * Math.sin(a)] as const;
});
const C = [12, 12.6] as const;
const pt = (p: readonly [number, number]) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
const STAR_PATH = OUTER.map((o, i) => `${i ? 'L' : 'M'}${pt(o)} L${pt(INNER[i])}`).join(' ') + ' Z';
// faces chanfradas: cada ponta tem uma metade clara e outra escura
const FACETS = OUTER.flatMap((o, i) => {
  const prev = INNER[(i + 4) % 5];
  const next = INNER[i];
  return [
    { d: `M${pt(C)} L${pt(prev)} L${pt(o)} Z`, lit: i === 0 || i === 4 || i === 3 },
    { d: `M${pt(C)} L${pt(o)} L${pt(next)} Z`, lit: i === 0 || i === 4 },
  ];
});

export function TierStarIcon({ tier, size = 16, className, title }: { tier: StarTier; size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, '');
  const c = PALETTE[tier];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      style={{ filter: `drop-shadow(0 1px 1.5px rgba(0,0,0,.55)) drop-shadow(0 0 ${Math.max(2, size / 6)}px ${c.glow})` }}
      role="img"
      aria-label={title ?? STARS.label[tier]}
      data-testid={`tier-star-${tier}`}
    >
      <title>{title ?? STARS.label[tier]}</title>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c.light} />
          <stop offset="0.55" stopColor={c.mid} />
          <stop offset="1" stopColor={c.dark} />
        </linearGradient>
        <radialGradient id={`h${id}`} cx="0.38" cy="0.3" r="0.45">
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* base com borda escura (espessura) */}
      <path d={STAR_PATH} transform="translate(0 0.9)" fill={c.edge} />
      <path d={STAR_PATH} fill={`url(#g${id})`} stroke={c.edge} strokeWidth="0.7" strokeLinejoin="round" />
      {FACETS.map((f, i) => (
        <path key={i} d={f.d} fill={f.lit ? '#fff' : '#000'} opacity={f.lit ? 0.18 : 0.16} />
      ))}
      <path d={STAR_PATH} fill={`url(#h${id})`} />
    </svg>
  );
}

/** Estrela do jogador pelo overall (nada se não tiver). */
export function PlayerTierStar({ overall, size = 14, className }: { overall: number; size?: number; className?: string }) {
  const tier = starTier({ overall });
  return tier ? <TierStarIcon tier={tier} size={size} className={className} /> : null;
}
