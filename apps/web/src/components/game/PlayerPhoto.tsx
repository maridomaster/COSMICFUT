import { useEffect, useState } from 'react';
import { assetUrl, dataUrl } from '@/data/source';
import { cn, hashString } from '@/lib/utils';

/** Entrada do manifesto gerado por `npm run photos:build` (Wikidata + Wikimedia Commons, licenças livres). */
export interface PhotoEntry {
  /** Caminho relativo a /assets (ex.: 'players/342229.jpg'). */
  file: string;
  author: string;
  license: string;
  /** Página do arquivo no Wikimedia Commons. */
  source: string;
  /**
   * Nomes do jogo verificados contra o item do Wikidata. Alguns tmIds herdados do original estão em jogadores
   * errados; a foto só vale para estes nomes (comparação exata).
   */
  names?: string[];
}

interface PhotoManifest {
  version: number;
  generatedAt: string;
  photos: Record<string, PhotoEntry>;
}

/* ── manifesto: carregado uma única vez, em escopo de módulo ── */
let manifest: Record<string, PhotoEntry> | null = null;
let manifestPromise: Promise<Record<string, PhotoEntry>> | null = null;

export function loadPhotoManifest(): Promise<Record<string, PhotoEntry>> {
  manifestPromise ??= fetch(dataUrl('photos.json'), { headers: { Accept: 'application/json' } })
    .then((res) => {
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('json')) throw new Error(`photos.json ${res.status}`);
      return res.json() as Promise<PhotoManifest>;
    })
    .then((m) => (manifest = m.photos ?? {}))
    .catch(() => (manifest = {}));
  return manifestPromise;
}

/**
 * Entrada do manifesto (síncrono; null se ainda não carregado ou sem foto). Com `name`, só devolve a foto se esse
 * nome foi verificado para o tmId.
 */
export function getPlayerPhoto(tmId: number | null | undefined, name?: string): PhotoEntry | null {
  if (tmId == null || !manifest) return null;
  const entry = manifest[String(tmId)];
  if (!entry) return null;
  if (name !== undefined && entry.names && !entry.names.includes(name)) return null;
  return entry;
}

/** Hook: entrada do manifesto para o jogador (carrega o manifesto na primeira chamada). */
export function usePlayerPhoto(tmId: number | null | undefined, name?: string): PhotoEntry | null {
  const [, setReady] = useState(manifest !== null);
  useEffect(() => {
    if (manifest || tmId == null) return;
    let alive = true;
    loadPhotoManifest().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [tmId]);
  return getPlayerPhoto(tmId, name);
}

/**
 * Linha de crédito: "Foto: Autor · CC BY-SA 4.0 · Wikimedia Commons" (null sem foto).
 * Aceita a entrada (de `usePlayerPhoto`) ou tmId + nome (requer o manifesto já carregado).
 */
export function photoCredit(entry: PhotoEntry | null | undefined): string | null;
export function photoCredit(tmId: number | null | undefined, name: string): string | null;
export function photoCredit(arg: PhotoEntry | number | null | undefined, name?: string): string | null {
  const entry = typeof arg === 'number' || arg == null ? getPlayerPhoto(arg as number | null, name) : arg;
  if (!entry) return null;
  return `Foto: ${entry.author} · ${entry.license} · Wikimedia Commons`;
}

/* ── componente ── */
interface PlayerPhotoProps {
  tmId: number | null;
  name: string;
  /** Tamanho exibido em px (quadrado). */
  size?: number;
  className?: string;
}

/**
 * Foto do jogador (Wikimedia Commons) recortada em círculo, enquadrada no topo (rosto).
 * Sem foto, ainda carregando ou com erro → avatar gerado com silhueta neutra e iniciais.
 */
export function PlayerPhoto({ tmId, name, size = 48, className }: PlayerPhotoProps) {
  const entry = usePlayerPhoto(tmId, name);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const url = entry ? assetUrl(entry.file) : null;

  if (!entry || !url || failedFor === url) return <PlayerAvatar name={name} size={size} className={className} />;

  return (
    <img
      key={url}
      src={url}
      alt={name}
      title={photoCredit(entry) ?? undefined}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailedFor(url)}
      className={cn('shrink-0 select-none rounded-full bg-surface-2 ring-1 ring-black/10', className)}
      style={{ width: size, height: size, objectFit: 'cover', objectPosition: 'top' }}
    />
  );
}

function playerInitials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Avatar gerado: fundo em gradiente (matiz derivado do nome), silhueta neutra e iniciais. */
export function PlayerAvatar({ name, size = 48, className }: { name: string; size?: number; className?: string }) {
  const hue = hashString(name) % 360;
  const initials = playerInitials(name);
  const id = `pa-${hashString(name).toString(36)}`;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={name}
      className={cn('shrink-0 rounded-full', className)}
      style={{ width: size, height: size }}
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 32% 42%)`} />
          <stop offset="1" stopColor={`hsl(${(hue + 40) % 360} 38% 24%)`} />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <rect width="64" height="64" fill={`url(#${id}-bg)`} />
        {/* silhueta: cabeça + ombros */}
        <circle cx="32" cy="25" r="11" fill="#fff" fillOpacity="0.16" />
        <path d="M8 66 C8 49 19 40 32 40 C45 40 56 49 56 66 Z" fill="#fff" fillOpacity="0.16" />
      </g>
      <text
        x="32"
        y="34"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="Inter Variable, Inter, system-ui, sans-serif"
        fontWeight="700"
        fontSize={initials.length > 2 ? 17 : 21}
        letterSpacing="-0.5"
        fill="#fff"
        fillOpacity="0.95"
      >
        {initials}
      </text>
      <circle cx="32" cy="32" r="31.5" fill="none" stroke="#000" strokeOpacity="0.15" />
    </svg>
  );
}
