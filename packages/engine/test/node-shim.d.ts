/**
 * Tipos mínimos das APIs do Node usadas SÓ pelos testes (o tsconfig da engine não inclui @types/node
 * de propósito: src/ não pode depender do Node).
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function existsSync(path: string): boolean;
}
declare module 'node:path' {
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
interface ImportMeta {
  readonly url: string;
}
/** (Etapa 2) tempos e log de desempenho nos testes */
declare const performance: { now(): number };
declare const console: { log(...args: unknown[]): void };
