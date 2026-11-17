import { useId, useState } from 'react';
import { assetUrl } from '@/data/source';
import { onColor } from '@/lib/color';
import { clubInitials, cn } from '@/lib/utils';

interface CrestProps {
  /** Caminho(s) relativo(s) a /assets, em ordem de preferência (ex.: ['crests/x.png', 'crests-mini/x.png']). */
  path: string | null | undefined | readonly string[];
  name: string;
  colors: { primary: string; secondary: string };
  /** Tamanho exibido em px. */
  size?: number;
  className?: string;
}

/** Tamanho nativo dos PNGs do pipeline: escudo 60x60, mini 18x18. */
const nativeSizeOf = (path: string) => (path.startsWith('crests-mini/') ? 18 : 60);

/**
 * Escudo do clube. PNGs nativos são pequenos (60x60): quando exibidos em múltiplo inteiro
 * (2x = 120px) usamos `image-rendering: pixelated` (bordas nítidas, sem blur bilinear);
 * em escalas fracionárias ou reduções, `auto`. Sem escudo (ou erro em todos) → SVG gerado.
 */
export function Crest({ path, name, colors, size = 60, className }: CrestProps) {
  const paths = (Array.isArray(path) ? path : path ? [path] : []) as string[];
  const key = paths.join('|');
  const [failed, setFailed] = useState<{ key: string; count: number }>({ key, count: 0 });
  const tries = failed.key === key ? failed.count : 0;
  const current = paths[tries];
  const url = assetUrl(current);

  if (!current || !url) return <CrestFallback name={name} colors={colors} size={size} className={className} />;

  const ratio = size / nativeSizeOf(current);
  const integerUpscale = ratio >= 2 && Number.isInteger(ratio);
  return (
    <img
      key={url}
      src={url}
      alt={`Escudo ${name}`}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed({ key, count: tries + 1 })}
      className={cn('shrink-0 object-contain select-none', integerUpscale ? 'crest-pixel' : 'crest-smooth', className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Escudo gerado: brasão com as cores do clube, faixa diagonal e iniciais. */
export function CrestFallback({
  name,
  colors,
  size = 60,
  className,
}: {
  name: string;
  colors: { primary: string; secondary: string };
  size?: number;
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const initials = clubInitials(name);
  const text = onColor(colors.primary);
  const fontSize = initials.length >= 3 ? 17 : 21;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={`Escudo ${name}`}
      className={cn('shrink-0', className)}
    >
      <defs>
        <clipPath id={`clip-${uid}`}>
          <path d="M32 3 L57 11 V30 C57 46 46 55 32 61 C18 55 7 46 7 30 V11 Z" />
        </clipPath>
        <linearGradient id={`shine-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#clip-${uid})`}>
        <rect width="64" height="64" fill={colors.primary} />
        <path d="M-4 46 L68 14 V26 L-4 58 Z" fill={colors.secondary} opacity="0.9" />
        <rect width="64" height="64" fill={`url(#shine-${uid})`} />
      </g>
      <path
        d="M32 3 L57 11 V30 C57 46 46 55 32 61 C18 55 7 46 7 30 V11 Z"
        fill="none"
        stroke={colors.secondary}
        strokeWidth="2.5"
      />
      <path d="M32 3 L57 11 V30 C57 46 46 55 32 61 C18 55 7 46 7 30 V11 Z" fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="0.75" />
      <text
        x="32"
        y="35"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="Inter Variable, Inter, system-ui, sans-serif"
        fontWeight="800"
        fontSize={fontSize}
        letterSpacing="-0.5"
        fill={text}
        stroke={text === '#ffffff' ? '#000' : '#fff'}
        strokeOpacity="0.25"
        strokeWidth="0.6"
        paintOrder="stroke"
      >
        {initials}
      </text>
    </svg>
  );
}
