import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { competitionIdentity, type CompetitionIdentity, type EmblemMotif } from '@/data/competitionIdentity';

/**
 * (Sala de Troféus) Emblema PRÓPRIO de uma competição (SVG, não oficial): moldura + motivo inspirado na identidade real
 * (cores, forma e símbolo), sem copiar nenhuma marca. Ver `data/competitionIdentity.ts`.
 *  - continentais/mundiais/copas: medalhão redondo; ligas e estaduais: escudo.
 *  - a sigla aparece embaixo a partir de 34 px.
 */
export function CompetitionEmblem({
  compId, name, type, size = 40, className, title, identity,
}: { compId: string; name?: string; type?: string; size?: number; className?: string; title?: string; identity?: CompetitionIdentity }) {
  const idt = identity ?? competitionIdentity(compId, { name, type });
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { primary, secondary, accent } = idt.colors;
  const shield = idt.kind === 'league' || idt.kind === 'state' || idt.kind === 'playoff';
  const withText = size >= 34;
  const motifY = withText ? -4 : 0;
  const frame = shield ? 'M32 3 L57 11 V31 C57 46 46 56 32 61 C18 56 7 46 7 31 V11 Z' : null;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={title ?? idt.name}
      className={cn('shrink-0 drop-shadow-[0_3px_8px_rgb(0_0_0/0.35)]', className)}
    >
      <title>{title ?? idt.name}</title>
      <defs>
        <linearGradient id={`bg${uid}`} x1="0" x2="0.4" y1="0" y2="1">
          <stop offset="0" stopColor={`color-mix(in oklab, ${primary} 70%, ${secondary})`} />
          <stop offset="0.55" stopColor={primary} />
          <stop offset="1" stopColor={`color-mix(in oklab, ${primary} 70%, #000)`} />
        </linearGradient>
        <radialGradient id={`sh${uid}`} cx="35%" cy="20%" r="70%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {frame ? (
        <>
          <path d={frame} fill={`url(#bg${uid})`} stroke={secondary} strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M32 7.5 L53 14.2 V31 C53 43.5 44 52 32 56.5 C20 52 11 43.5 11 31 V14.2 Z" fill="none" stroke={accent} strokeOpacity="0.35" strokeWidth="0.9" />
          <path d={frame} fill={`url(#sh${uid})`} />
        </>
      ) : (
        <>
          <circle cx="32" cy="32" r="29" fill={`url(#bg${uid})`} stroke={secondary} strokeWidth="2.6" />
          <circle cx="32" cy="32" r="25" fill="none" stroke={accent} strokeOpacity="0.35" strokeWidth="0.9" strokeDasharray={idt.tier === 'mundial' ? '1.5 2' : undefined} />
          <circle cx="32" cy="32" r="29" fill={`url(#sh${uid})`} />
        </>
      )}
      <g transform={`translate(0 ${motifY})`}>{motif(idt, uid, withText)}</g>
      {withText && (
        <text
          x="32"
          y={shield ? 49 : 50.5}
          textAnchor="middle"
          fontSize={idt.short.length > 3 ? 7.4 : 8.6}
          fontWeight="900"
          letterSpacing="0.6"
          fill="#fff"
          style={{ fontFamily: 'inherit' }}
        >
          {idt.short}
        </text>
      )}
    </svg>
  );
}

/** Estrela de 5 pontas centrada em (cx, cy) com raio r. */
function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

function motif(idt: CompetitionIdentity, uid: string, withText: boolean): ReactNode {
  const { primary, secondary, accent } = idt.colors;
  const m: EmblemMotif = idt.emblem;
  const cy = 30;
  switch (m) {
    case 'lion-crown':
      // coroa + cabeça de leão estilizada (juba em raios)
      return (
        <g>
          <path d="M23 19 L25.5 11 L29 16.5 L32 9.5 L35 16.5 L38.5 11 L41 19 Z" fill={accent} stroke={secondary} strokeWidth="0.8" strokeLinejoin="round" />
          <path d={Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; const r = i % 2 ? 8 : 11; return `${i ? 'L' : 'M'}${(32 + r * Math.sin(a)).toFixed(1)},${(cy + 2 - r * Math.cos(a)).toFixed(1)}`; }).join('') + 'Z'} fill={secondary} />
          <circle cx="32" cy={cy + 2} r="6.2" fill={primary} stroke={accent} strokeWidth="0.8" />
          <circle cx="29.8" cy={cy + 1} r="0.9" fill={secondary} />
          <circle cx="34.2" cy={cy + 1} r="0.9" fill={secondary} />
          <path d={`M30 ${cy + 4.5} Q32 ${cy + 6} 34 ${cy + 4.5}`} fill="none" stroke={secondary} strokeWidth="0.9" strokeLinecap="round" />
        </g>
      );
    case 'star-ball': {
      // bola formada por estrelas (motivo "europeu" genérico)
      const ring = Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return <path key={i} d={star(32 + 10 * Math.cos(a), cy + 10 * Math.sin(a), 3)} fill={accent} />;
      });
      return (
        <g>
          <circle cx="32" cy={cy} r="14" fill="none" stroke={secondary} strokeWidth="1.2" />
          {ring}
          <path d={star(32, cy, 5)} fill={accent} />
        </g>
      );
    }
    case 'swirl-ball':
      return (
        <g fill="none" strokeLinecap="round">
          <circle cx="32" cy={cy} r="13" stroke={accent} strokeWidth="1.4" />
          <path d={`M21 ${cy - 4} Q32 ${cy - 14} 43 ${cy - 4}`} stroke={secondary} strokeWidth="3" />
          <path d={`M20 ${cy + 3} Q32 ${cy - 6} 44 ${cy + 3}`} stroke={accent} strokeWidth="2.2" />
          <path d={`M22 ${cy + 9} Q32 ${cy + 1} 42 ${cy + 9}`} stroke={secondary} strokeWidth="2.2" />
        </g>
      );
    case 'ring':
      return (
        <g fill="none">
          <circle cx="32" cy={cy} r="12.5" stroke={secondary} strokeWidth="4" strokeDasharray="62 16" transform={`rotate(-50 32 ${cy})`} />
          <circle cx="32" cy={cy} r="7" stroke={accent} strokeWidth="1.6" />
          <path d={star(32, cy, 3.4)} fill={accent} />
        </g>
      );
    case 'flag-diamond':
      // losango verde-amarelo com o globo azul e estrelas (bandeira do Brasil é símbolo nacional, não marca)
      return (
        <g>
          <path d={`M32 ${cy - 14} L50 ${cy} L32 ${cy + 14} L14 ${cy} Z`} fill={secondary} />
          <circle cx="32" cy={cy} r="8" fill={accent} />
          <path d={`M24.3 ${cy - 1.5} Q32 ${cy - 4.5} 39.7 ${cy + 1.8}`} fill="none" stroke="#fff" strokeWidth="1.5" />
          {[[29, cy + 3], [34, cy + 4.2], [31.5, cy + 5.8], [36, cy + 1.5]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="0.75" fill="#fff" />
          ))}
        </g>
      );
    case 'sun': {
      const rays = Array.from({ length: 16 }, (_, i) => (
        <path key={i} d={i % 2 ? `M32 ${cy - 15} L33.4 ${cy - 9} L30.6 ${cy - 9} Z` : `M32 ${cy - 17} L34 ${cy - 9} L30 ${cy - 9} Z`} fill={i % 2 ? secondary : accent} transform={`rotate(${i * 22.5} 32 ${cy})`} />
      ));
      return (
        <g>
          {rays}
          <circle cx="32" cy={cy} r="7.5" fill={accent} stroke={secondary} strokeWidth="1" />
          <circle cx="32" cy={cy} r="4" fill={secondary} fillOpacity="0.55" />
        </g>
      );
    }
    case 'laurel-shield':
      // escudo celeste com estrela, ladeado por ramos de louro dourados
      return (
        <g>
          {[-1, 1].map((s) => (
            <g key={s} transform={s < 0 ? undefined : `translate(64 0) scale(-1 1)`}>
              <path d={`M19 ${cy + 11} Q14 ${cy} 20 ${cy - 12}`} fill="none" stroke={accent} strokeWidth="1.1" />
              {[0, 1, 2, 3, 4].map((k) => (
                <ellipse key={k} cx={17.4 + (k === 0 ? 1.4 : k === 4 ? 1.6 : 0)} cy={cy + 8 - k * 4.6} rx="1.4" ry="2.8" fill={accent} transform={`rotate(${-35 + k * 6} ${17.4} ${cy + 8 - k * 4.6})`} />
              ))}
            </g>
          ))}
          <path d={`M32 ${cy - 12} L42 ${cy - 8} V${cy + 1} C42 ${cy + 7} 37.5 ${cy + 10.5} 32 ${cy + 13} C26.5 ${cy + 10.5} 22 ${cy + 7} 22 ${cy + 1} V${cy - 8} Z`} fill={secondary} stroke={accent} strokeWidth="1.2" />
          <path d={star(32, cy, 5)} fill={accent} />
        </g>
      );
    case 'southern-cross':
      // cruzeiro do sul: 5 estrelas
      return (
        <g>
          <circle cx="32" cy={cy} r="14" fill={secondary} fillOpacity="0.25" stroke={secondary} strokeWidth="1.2" />
          {[[32, cy - 9, 3.6], [32, cy + 9, 4], [24, cy - 1, 3.2], [40, cy + 1, 3.2], [36, cy + 4, 1.9]].map(([x, y, r], i) => (
            <path key={i} d={star(x, y, r)} fill={accent} />
          ))}
        </g>
      );
    case 'twin-shield':
      return (
        <g strokeLinejoin="round">
          <path d={`M25 ${cy - 10} L33 ${cy - 7} V${cy + 1} C33 ${cy + 6} 29 ${cy + 9} 25 ${cy + 11} C21 ${cy + 9} 17 ${cy + 6} 17 ${cy + 1} V${cy - 7} Z`} fill={secondary} stroke={accent} strokeWidth="1" />
          <path d={`M39 ${cy - 10} L47 ${cy - 7} V${cy + 1} C47 ${cy + 6} 43 ${cy + 9} 39 ${cy + 11} C35 ${cy + 9} 31 ${cy + 6} 31 ${cy + 1} V${cy - 7} Z`} fill={accent} stroke={secondary} strokeWidth="1" />
          <path d={star(32, cy - 13, 3)} fill={accent} />
        </g>
      );
    case 'globe':
    case 'globe-ring':
      return (
        <g fill="none">
          <circle cx="32" cy={cy} r="12.5" fill={secondary} fillOpacity="0.3" stroke={accent} strokeWidth="1.6" />
          <ellipse cx="32" cy={cy} rx="5.5" ry="12.5" stroke={accent} strokeWidth="1" />
          <path d={`M19.5 ${cy} H44.5 M21.5 ${cy - 6.5} H42.5 M21.5 ${cy + 6.5} H42.5`} stroke={accent} strokeWidth="0.9" />
          {m === 'globe-ring' && <ellipse cx="32" cy={cy} rx="18" ry="5" stroke={secondary} strokeWidth="2" transform={`rotate(-18 32 ${cy})`} />}
          {m === 'globe' && <path d={star(32, cy - 17, 3)} fill={accent} />}
        </g>
      );
    case 'plate':
      return (
        <g fill="none">
          <circle cx="32" cy={cy} r="14" fill={secondary} fillOpacity="0.2" stroke={accent} strokeWidth="1.6" />
          <circle cx="32" cy={cy} r="10" stroke={secondary} strokeWidth="1.4" />
          <circle cx="32" cy={cy} r="5.5" fill={accent} fillOpacity="0.85" />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * Math.PI) / 6;
            return <circle key={i} cx={32 + 12 * Math.cos(a)} cy={cy + 12 * Math.sin(a)} r="0.9" fill={accent} />;
          })}
        </g>
      );
    case 'crown':
      return (
        <g strokeLinejoin="round">
          <path d={`M19 ${cy + 7} L17 ${cy - 7} L24.5 ${cy - 1} L32 ${cy - 11} L39.5 ${cy - 1} L47 ${cy - 7} L45 ${cy + 7} Z`} fill={accent} stroke={secondary} strokeWidth="1.2" />
          <rect x="19" y={cy + 8.5} width="26" height="3.6" rx="1" fill={secondary} />
          {[[17, cy - 8], [32, cy - 12], [47, cy - 8]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="1.8" fill={secondary} />
          ))}
          <circle cx="32" cy={cy + 1.5} r="2.2" fill={secondary} />
        </g>
      );
    case 'cup':
      return (
        <g strokeLinejoin="round">
          <path d={`M23 ${cy - 12} H41 V${cy - 6} C41 ${cy + 1} 37 ${cy + 4} 32 ${cy + 4} C27 ${cy + 4} 23 ${cy + 1} 23 ${cy - 6} Z`} fill={accent} stroke={secondary} strokeWidth="1" />
          <path d={`M23 ${cy - 9} C16 ${cy - 9} 16 ${cy - 1} 24 ${cy} M41 ${cy - 9} C48 ${cy - 9} 48 ${cy - 1} 40 ${cy}`} fill="none" stroke={accent} strokeWidth="2" />
          <path d={`M30 ${cy + 4} H34 V${cy + 9} H30 Z`} fill={accent} />
          <rect x="25" y={cy + 9} width="14" height="4" rx="1" fill={secondary} />
        </g>
      );
    case 'rosette':
      return (
        <g>
          {Array.from({ length: 14 }, (_, i) => (
            <circle key={i} cx={32 + 12 * Math.cos((i * Math.PI) / 7)} cy={cy + 12 * Math.sin((i * Math.PI) / 7)} r="3.2" fill={secondary} />
          ))}
          <circle cx="32" cy={cy} r="12" fill={secondary} />
          <circle cx="32" cy={cy} r="8.5" fill="#fff" />
          <circle cx="32" cy={cy} r="5" fill={accent} />
        </g>
      );
    case 'scudetto':
      return (
        <g>
          <clipPath id={`sc${uid}`}>
            <path d={`M32 ${cy - 13} L44 ${cy - 9} V${cy + 1} C44 ${cy + 8} 38.5 ${cy + 12} 32 ${cy + 14} C25.5 ${cy + 12} 20 ${cy + 8} 20 ${cy + 1} V${cy - 9} Z`} />
          </clipPath>
          <g clipPath={`url(#sc${uid})`}>
            <rect x="20" y={cy - 14} width="8" height="30" fill={secondary} />
            <rect x="28" y={cy - 14} width="8" height="30" fill="#fff" />
            <rect x="36" y={cy - 14} width="8" height="30" fill={accent} />
          </g>
          <path d={`M32 ${cy - 13} L44 ${cy - 9} V${cy + 1} C44 ${cy + 8} 38.5 ${cy + 12} 32 ${cy + 14} C25.5 ${cy + 12} 20 ${cy + 8} 20 ${cy + 1} V${cy - 9} Z`} fill="none" stroke="#fff" strokeOpacity="0.8" strokeWidth="1.2" />
        </g>
      );
    case 'hexagon':
      return (
        <g>
          <path d={`M32 ${cy - 14} L44 ${cy - 7} V${cy + 7} L32 ${cy + 14} L20 ${cy + 7} V${cy - 7} Z`} fill={secondary} fillOpacity="0.35" stroke={secondary} strokeWidth="2" strokeLinejoin="round" />
          <path d={`M32 ${cy - 9} L39.5 ${cy - 4.5} V${cy + 4.5} L32 ${cy + 9} L24.5 ${cy + 4.5} V${cy - 4.5} Z`} fill="none" stroke={accent} strokeWidth="1.2" />
          <path d={star(32, cy, 4)} fill="#fff" />
        </g>
      );
    case 'armillary':
      return (
        <g fill="none">
          <circle cx="32" cy={cy} r="12.5" stroke={accent} strokeWidth="1.6" />
          <ellipse cx="32" cy={cy} rx="12.5" ry="4.5" stroke={secondary} strokeWidth="1.4" transform={`rotate(-25 32 ${cy})`} />
          <ellipse cx="32" cy={cy} rx="4.5" ry="12.5" stroke={accent} strokeWidth="1" />
          <path d={`M22 ${cy + 8} L42 ${cy - 8}`} stroke={secondary} strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="32" cy={cy} r="2" fill={accent} />
        </g>
      );
    case 'star':
      return (
        <g>
          <circle cx="32" cy={cy} r="13" fill={secondary} fillOpacity="0.25" />
          <path d={star(32, cy + 0.5, 11)} fill={accent} stroke={secondary} strokeWidth="1" strokeLinejoin="round" />
        </g>
      );
    case 'diamond':
      return (
        <g strokeLinejoin="round">
          <path d={`M32 ${cy - 14} L44 ${cy} L32 ${cy + 14} L20 ${cy} Z`} fill={secondary} stroke={accent} strokeWidth="1.2" />
          <path d={`M32 ${cy - 8} L38.5 ${cy} L32 ${cy + 8} L25.5 ${cy} Z`} fill={accent} fillOpacity="0.9" />
        </g>
      );
    case 'state':
    case 'monogram':
    default:
      // monograma: sigla (UF) grande sobre faixa diagonal nas cores da bandeira
      return (
        <g>
          <path d={`M12 ${cy + 8} L52 ${cy - 10} L52 ${cy - 3} L12 ${cy + 15} Z`} fill={secondary} fillOpacity="0.8" />
          <path d={`M12 ${cy + 15} L52 ${cy - 3} L52 ${cy + 1} L12 ${cy + 19} Z`} fill={accent} fillOpacity="0.75" />
          {!withText || m === 'monogram' ? (
            <text x="32" y={cy + 5} textAnchor="middle" fontSize={idt.short.length > 2 ? 12 : 15} fontWeight="900" fill="#fff" stroke={primary} strokeWidth="0.6" style={{ fontFamily: 'inherit' }}>
              {m === 'state' ? (idt.uf ?? idt.short) : idt.short}
            </text>
          ) : (
            <path d={star(32, cy - 1, 7)} fill="#fff" stroke={primary} strokeWidth="0.6" />
          )}
        </g>
      );
  }
}

/**
 * Selo compacto para listas: emblema + nome (ou sigla). Use onde um nome de competição aparece.
 */
export function CompetitionBadge({
  compId, name, type, size = 18, short, className, nameClassName, suffix,
}: { compId: string; name?: string; type?: string; size?: number; short?: boolean; className?: string; nameClassName?: string; suffix?: ReactNode }) {
  const idt = competitionIdentity(compId, { name, type });
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <CompetitionEmblem compId={compId} identity={idt} size={size} />
      <span className={cn('min-w-0 truncate', nameClassName)} title={idt.name}>
        {short ? idt.short : idt.name}
      </span>
      {suffix}
    </span>
  );
}
