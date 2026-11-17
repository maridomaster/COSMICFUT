// Utilitários: texto (slug, mojibake), RNG determinístico, arredondamento.

/** Corrige mojibake típico (UTF-8 lido como Latin-1/CP1252): "SÃ£o" -> "São". */
export function fixMojibake(s) {
  if (typeof s !== 'string') return s;
  let out = s.replace(/^﻿/, '');
  if (/[ÃÂ][\u0080-¿]|Ã[¡-ÿ]|â€/.test(out)) {
    try {
      const bytes = Buffer.from([...out].map((ch) => {
        const c = ch.charCodeAt(0);
        if (c > 0xff) throw new Error('not latin1');
        return c;
      }));
      const dec = bytes.toString('utf8');
      if (!dec.includes('�')) out = dec;
    } catch { /* mantém original */ }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Slug ASCII minúsculo: remove acentos, troca qualquer separador por '-'. */
export function slugify(s) {
  return String(s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'o').replace(/[đĐ]/g, 'd').replace(/[łŁ]/g, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** FNV-1a 32 bits. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** PRNG mulberry32 com seed por string. Retorna função () => [0,1). */
export function rngFor(seedStr) {
  let a = hash32(seedStr);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Arredonda dinheiro para valores "redondos" legíveis. */
export function roundMoney(v) {
  if (v >= 10_000_000) return Math.round(v / 500_000) * 500_000;
  if (v >= 1_000_000) return Math.round(v / 100_000) * 100_000;
  if (v >= 100_000) return Math.round(v / 10_000) * 10_000;
  if (v >= 10_000) return Math.round(v / 1_000) * 1_000;
  return Math.round(v / 100) * 100;
}

/** Cor do jogo -> '#rrggbb' (aceita '#abc', '#aabbcc', 'r,g,b' ou inteiro). */
export function normColor(c, fallback = '#808080') {
  if (c == null) return fallback;
  if (typeof c === 'number') return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  const s = String(c).trim().toLowerCase();
  let m = s.match(/^#?([0-9a-f]{6})$/);
  if (m) return '#' + m[1];
  m = s.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (m) return '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
  m = s.match(/^(\d+)\D+(\d+)\D+(\d+)/);
  if (m) return '#' + [m[1], m[2], m[3]].map((x) => clamp(+x, 0, 255).toString(16).padStart(2, '0')).join('');
  return fallback;
}

/** Lê texto UTF-8 removendo BOM. */
export function stripBom(s) { return s.replace(/^﻿/, ''); }
