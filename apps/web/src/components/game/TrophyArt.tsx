import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { assetUrl } from '@/data/source';
import { competitionIdentity, type CompetitionIdentity, type Metal, type TrophyShape } from '@/data/competitionIdentity';

/**
 * (Sala de Troféus) Arte do troféu de uma competição:
 *  1. a imagem extraída do jogo original (`/assets/trophies/*.png`), quando existe;
 *  2. senão (ou se a imagem falhar), uma silhueta SVG própria inspirada na forma real (`TrophySilhouette`).
 * `locked`: troféu ainda não conquistado → silhueta escura (mesma forma), sem brilho.
 */
export function TrophyArt({
  compId, identity, height = 96, locked, className, title,
}: { compId: string; identity?: CompetitionIdentity; height?: number; locked?: boolean; className?: string; title?: string }) {
  const idt = identity ?? competitionIdentity(compId);
  const [broken, setBroken] = useState(false);
  const src = !broken ? assetUrl(idt.trophy.image) : null;
  const label = title ?? `Troféu: ${idt.name}`;
  if (src) {
    return (
      <img
        src={src}
        alt={label}
        title={label}
        loading="lazy"
        draggable={false}
        onError={() => setBroken(true)}
        style={{ height, width: 'auto' }}
        className={cn(
          'pointer-events-none max-w-full object-contain select-none',
          locked ? 'opacity-70 [filter:brightness(0)_drop-shadow(0_0_1px_rgb(148_160_182/0.55))]' : 'drop-shadow-[0_8px_14px_rgb(0_0_0/0.55)]',
          className,
        )}
      />
    );
  }
  return <TrophySilhouette shape={idt.trophy.shape} metal={idt.trophy.metal} accent={idt.colors.secondary} height={height} locked={locked} className={className} title={label} />;
}

const METAL: Record<Metal, [string, string, string]> = {
  gold: ['#fff4c2', '#e2b33c', '#7a5510'],
  silver: ['#ffffff', '#c3cad6', '#5b6472'],
  bronze: ['#ffd8b0', '#c07a3c', '#5e3510'],
};

/** Silhuetas próprias (viewBox 64×96) inspiradas nas formas reais dos troféus. */
const SHAPES: Record<TrophyShape, { body: string; detail?: string }> = {
  // orelhas grandes: taça larga com alças enormes até a base
  'big-ears': {
    body: 'M22 10 H42 C42 30 40 40 35 46 V62 H39 L42 74 H22 L25 62 H29 V46 C24 40 22 30 22 10 Z M22 13 C6 12 4 34 14 44 C18 48 24 48 27 44 L25 41 C21 44 16 42 13 37 C9 29 12 18 22 18 Z M42 13 C58 12 60 34 50 44 C46 48 40 48 37 44 L39 41 C43 44 48 42 51 37 C55 29 52 18 42 18 Z M18 74 H46 L48 84 H16 Z',
    detail: 'M24 14 H40',
  },
  // estilo Libertadores: base em degraus, haste e taça pequena com a figura do jogador no topo
  figure: {
    body: 'M32 4 A3.2 3.2 0 1 1 31.99 4 Z M29 10 H35 L37 18 L35 19 L34 15 V22 H30 V15 L29 19 L27 18 Z M24 23 H40 C40 31 37 35 34 37 V50 H30 V37 C27 35 24 31 24 23 Z M27 50 H37 L39 58 H25 Z M22 58 H42 L44 68 H20 Z M18 68 H46 L48 80 H16 Z M14 80 H50 L52 88 H12 Z',
  },
  // prato (salva de campeão)
  plate: {
    body: 'M32 14 A26 26 0 1 1 31.99 14 Z M30 66 H34 V76 H30 Z M20 76 H44 L46 84 H18 Z',
    detail: 'M32 22 A18 18 0 1 1 31.99 22 Z M32 30 A10 10 0 1 1 31.99 30 Z',
  },
  // taça fina e alta
  slim: {
    body: 'M24 6 H40 L37 40 C36 46 34 48 34 50 V66 H38 L40 74 H24 L26 66 H30 V50 C30 48 28 46 27 40 Z M20 74 H44 L46 86 H18 Z',
    detail: 'M26 10 H38',
  },
  // taça clássica de duas alças
  classic: {
    body: 'M18 10 H46 C46 30 42 40 35 44 V56 H40 L42 64 H22 L24 56 H29 V44 C22 40 18 30 18 10 Z M18 14 C8 14 8 32 20 34 L21 30 C14 28 13 19 19 18 Z M46 14 C56 14 56 32 44 34 L43 30 C50 28 51 19 45 18 Z M18 64 H46 L48 76 H16 Z',
    detail: 'M20 14 H44',
  },
  // taça com tampa (estilo copa inglesa)
  lidded: {
    body: 'M30 2 H34 V6 H30 Z M24 6 H40 C40 9 38 11 32 11 C26 11 24 9 24 6 Z M20 12 H44 C44 30 40 38 35 42 V56 H39 L41 64 H23 L25 56 H29 V42 C24 38 20 30 20 12 Z M20 16 C10 16 10 32 21 34 L22 30 C16 28 15 21 21 20 Z M44 16 C54 16 54 32 43 34 L42 30 C48 28 49 21 43 20 Z M18 64 H46 L48 76 H16 Z',
  },
  // três alças (copa da liga inglesa)
  'three-handle': {
    body: 'M20 10 H44 C44 30 40 40 35 44 V56 H40 L42 64 H22 L24 56 H29 V44 C24 40 20 30 20 10 Z M20 14 C10 14 10 32 21 34 L22 30 C16 28 15 21 21 19 Z M44 14 C54 14 54 32 43 34 L42 30 C48 28 49 21 43 19 Z M29 22 C27 14 37 14 35 22 L33 30 H31 Z M18 64 H46 L48 76 H16 Z',
  },
  // bola/globo no topo de uma haste espiralada
  globe: {
    body: 'M32 4 A12 12 0 1 1 31.99 4 Z M26 27 C24 34 30 36 30 44 C30 50 26 52 26 58 H38 C38 52 34 50 34 44 C34 36 40 34 38 27 Z M22 58 H42 L44 68 H20 Z M17 68 H47 L49 80 H15 Z',
    detail: 'M24 12 C30 18 34 18 40 12 M23 20 C29 14 35 14 41 20',
  },
  // escudo/placa
  shield: {
    body: 'M32 6 L54 14 V40 C54 56 44 66 32 72 C20 66 10 56 10 40 V14 Z M24 72 H40 L42 82 H22 Z',
    detail: 'M32 14 L46 19 V40 C46 50 40 57 32 61 C24 57 18 50 18 40 V19 Z',
  },
  // vaso alto de bojo largo
  vase: {
    body: 'M20 6 H44 C44 12 38 16 38 24 C38 34 46 38 42 46 C40 50 35 52 34 54 V64 H38 L40 72 H24 L26 64 H30 V54 C29 52 24 50 22 46 C18 38 26 34 26 24 C26 16 20 12 20 6 Z M18 72 H46 L48 84 H16 Z',
    detail: 'M22 8 H42',
  },
};

export function TrophySilhouette({
  shape, metal = 'gold', accent, height = 96, locked, className, title,
}: { shape: TrophyShape; metal?: Metal; accent?: string; height?: number; locked?: boolean; className?: string; title?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const s = SHAPES[shape] ?? SHAPES.classic;
  const [hi, mid, lo] = METAL[metal];
  return (
    <svg
      viewBox="0 0 64 92"
      height={height}
      width={(height * 64) / 92}
      role="img"
      aria-label={title}
      className={cn('shrink-0', locked ? 'opacity-80' : 'drop-shadow-[0_8px_14px_rgb(0_0_0/0.55)]', className)}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={`m${uid}`} x1="0" x2="1" y1="0" y2="0.3">
          <stop offset="0" stopColor={lo} />
          <stop offset="0.35" stopColor={hi} />
          <stop offset="0.6" stopColor={mid} />
          <stop offset="1" stopColor={lo} />
        </linearGradient>
      </defs>
      <path d={s.body} fillRule="nonzero" fill={locked ? '#05070c' : `url(#m${uid})`} stroke={locked ? 'rgb(148 160 182 / 0.45)' : lo} strokeWidth={locked ? 0.8 : 0.6} strokeLinejoin="round" />
      {s.detail && !locked && <path d={s.detail} fill="none" stroke={hi} strokeOpacity="0.7" strokeWidth="1" />}
      {/* faixa colorida na base (identidade da competição) */}
      {!locked && accent && shape !== 'plate' && <rect x="20" y="84" width="24" height="2.2" rx="1" fill={accent} opacity="0.9" />}
    </svg>
  );
}
