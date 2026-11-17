/**
 * Plataforma injetável do núcleo online (roda em Node E no navegador — nada de `node:*` aqui).
 *
 *  - gzip/gunzip síncronos: padrão `fflate` (JS puro); o servidor Node troca por `node:zlib` (mais rápido) com
 *    `setCodec` em `apps/server/src/node-platform.ts`.
 *  - bytes aleatórios: `crypto.getRandomValues` (Node ≥ 19 e navegadores).
 *  - base64/utf8 sem `Buffer`.
 *  - `defer`: `setImmediate` quando existe (Node), senão `setTimeout(0)` (navegador / Web Worker).
 */
import { gunzipSync as ffGunzip, gzipSync as ffGzip } from 'fflate';

export interface Codec {
  gzip(data: Uint8Array, level?: number): Uint8Array;
  gunzip(data: Uint8Array, maxOutput?: number): Uint8Array;
}

const fflateCodec: Codec = {
  gzip: (d, level = 6) => ffGzip(d, { level: Math.max(0, Math.min(9, level)) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }),
  gunzip: (d, maxOutput) => {
    const out = ffGunzip(d);
    if (maxOutput !== undefined && out.byteLength > maxOutput) throw new Error('gzip: saída grande demais');
    return out;
  },
};

let codec: Codec = fflateCodec;

/** Troca o gzip (Node: node:zlib). */
export function setCodec(c: Codec): void {
  codec = c;
}

export const gzip = (d: Uint8Array, level?: number): Uint8Array => codec.gzip(d, level);
export const gunzip = (d: Uint8Array, maxOutput?: number): Uint8Array => codec.gunzip(d, maxOutput);

const enc = new TextEncoder();
const dec = new TextDecoder();
export const utf8 = (s: string): Uint8Array => enc.encode(s);
export const fromUtf8 = (b: Uint8Array): string => dec.decode(b);
export const utf8Length = (s: string): number => enc.encode(s).byteLength;

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function toBase64(b: Uint8Array): string {
  const g = globalThis as unknown as { Buffer?: { from(a: ArrayBufferLike, o: number, l: number): { toString(e: string): string } } };
  if (g.Buffer) return g.Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64');
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH) as unknown as number[]);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const g = globalThis as unknown as { Buffer?: { from(s: string, e: string): Uint8Array } };
  if (g.Buffer) {
    const b = g.Buffer.from(s, 'base64');
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const toBase64Url = (b: Uint8Array): string => toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** `setImmediate` (Node) ou `setTimeout(0)`. */
export function defer(fn: () => void): void {
  const si = (globalThis as unknown as { setImmediate?: (f: () => void) => unknown }).setImmediate;
  if (si) si(fn);
  else setTimeout(fn, 0);
}

/** Inteiro aleatório em [0, max). */
export function randomInt(max: number): number {
  const b = randomBytes(4);
  return (((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0) % max;
}
