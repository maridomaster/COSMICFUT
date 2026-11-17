/** Configuração do modo online. */

/** URL do servidor (Fastify + Socket.io). Defina VITE_SERVER_URL no build/dev para apontar para um túnel ou deploy. */
function defaultServerUrl(): string {
  // Servido pelo próprio servidor (npm run play / túnel): mesma origem. No dev do Vite (5173), servidor local.
  if (typeof window !== 'undefined' && window.location.port !== '5173' && /^https?:$/.test(window.location.protocol)) return window.location.origin;
  return 'http://localhost:8787';
}
export const SERVER_URL: string = ((import.meta.env.VITE_SERVER_URL as string | undefined) || defaultServerUrl()).replace(/\/+$/, '');

/** Mesmo alfabeto do servidor (sem 0/O, 1/I). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function normalizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((c) => ROOM_CODE_ALPHABET.includes(c))
    .join('')
    .slice(0, ROOM_CODE_LENGTH);
}

export const isRoomCode = (s: string | undefined | null): s is string => !!s && normalizeRoomCode(s) === s && s.length === ROOM_CODE_LENGTH;

/** Página aberta em localhost/127.0.0.1 (o host): o link de convite precisa da URL pública do túnel. */
export function isLocalHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

const appBase = () => import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * Base dos convites: em localhost usa a URL pública do túnel (GET /public-url) quando existe — convites nunca saem
 * como "localhost" se há túnel; quem abriu pelo túnel (ou outro endereço) usa a própria origem.
 */
export function inviteBase(publicUrl: string | null): string {
  if (isLocalHost() && publicUrl) return `${publicUrl}${appBase()}`;
  return `${window.location.origin}${appBase()}`;
}

/** Link de convite: abre o app direto na sala. */
export function inviteLink(code: string, publicUrl: string | null = null): string {
  return `${inviteBase(publicUrl)}/online/${code}`;
}

/** Velocidades oferecidas ao host (ms por minuto simulado). */
export const MATCH_SPEEDS: { ms: number; label: string; hint: string }[] = [
  { ms: 150, label: 'Rápida', hint: '≈ 15 s por partida' },
  { ms: 400, label: 'Normal', hint: '≈ 40 s por partida' },
  { ms: 800, label: 'Lenta', hint: '≈ 1,3 min por partida' },
];
