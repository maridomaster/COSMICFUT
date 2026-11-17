/**
 * Utilitários de cor para o tema dinâmico do clube.
 * Garante contraste legível das cores do clube sobre o fundo dark (WCAG relative luminance).
 */

export type RGB = [number, number, number];

/** Fundo de referência (superfície dos cards). */
export const DARK_SURFACE = '#0f141e';

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [128, 128, 128];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Luminância relativa WCAG (0 = preto, 1 = branco). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mistura linear em sRGB: t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

/** Saturação HSL (0..1) — usada para escolher a cor mais "colorida" como acento. */
export function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as RGB;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

/**
 * Ajusta uma cor para ser legível sobre o fundo dark:
 *  - escura demais → clareia (mistura com branco) até atingir `minContrast`;
 *  - clara demais (quase branco) → escurece levemente para não "estourar" em gradientes e glows.
 */
export function readableOnDark(hex: string, bg = DARK_SURFACE, minContrast = 3.2, maxLuminance = 0.82): string {
  let out = hex;
  if (contrastRatio(out, bg) < minContrast) {
    for (let t = 0.05; t <= 1; t += 0.05) {
      out = mix(hex, '#ffffff', t);
      if (contrastRatio(out, bg) >= minContrast) break;
    }
  }
  if (luminance(out) > maxLuminance) {
    for (let t = 0.04; t <= 0.5; t += 0.04) {
      out = mix(hex, '#8090a8', t);
      if (luminance(out) <= maxLuminance) break;
    }
  }
  return out;
}

/** Texto preto ou branco, o que tiver mais contraste sobre `bg`. */
export function onColor(bg: string): string {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#0b0f17') ? '#ffffff' : '#0b0f17';
}

export interface ClubThemeVars {
  primary: string;
  secondary: string;
  accent: string;
  onAccent: string;
  primaryRaw: string;
  secondaryRaw: string;
}

export function computeClubTheme(colors: { primary: string; secondary: string }): ClubThemeVars {
  const primary = readableOnDark(colors.primary);
  let secondary = readableOnDark(colors.secondary);
  // Se as duas cores ajustadas ficarem praticamente iguais, deriva uma secundária mais escura/clara.
  if (contrastRatio(primary, secondary) < 1.25) {
    secondary = luminance(primary) > 0.4 ? mix(primary, DARK_SURFACE, 0.45) : mix(primary, '#ffffff', 0.4);
  }
  // Acento = a cor mais saturada (ex.: Real Madrid → azul em vez de branco).
  const accent = saturation(secondary) > saturation(primary) + 0.15 ? secondary : primary;
  return {
    primary,
    secondary,
    accent,
    onAccent: onColor(accent),
    primaryRaw: colors.primary,
    secondaryRaw: colors.secondary,
  };
}

const NEUTRAL: ClubThemeVars = {
  primary: '#8b6cff',
  secondary: '#2dd4bf',
  accent: '#8b6cff',
  onAccent: '#0b0b12',
  primaryRaw: '#8b6cff',
  secondaryRaw: '#2dd4bf',
};

/** Aplica as CSS variables --club-* no :root (ou num elemento). */
export function applyClubTheme(colors: { primary: string; secondary: string } | null, el: HTMLElement = document.documentElement) {
  const t = colors ? computeClubTheme(colors) : NEUTRAL;
  el.style.setProperty('--club-primary', t.primary);
  el.style.setProperty('--club-secondary', t.secondary);
  el.style.setProperty('--club-accent', t.accent);
  el.style.setProperty('--club-on-accent', t.onAccent);
  el.style.setProperty('--club-primary-raw', t.primaryRaw);
  el.style.setProperty('--club-secondary-raw', t.secondaryRaw);
}
