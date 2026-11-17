/**
 * @cosmicfut/online-core — a sala online autoritativa (lobby, turnos, simultâneo, votações, partidas ao vivo, Liga dos
 * Amigos, Central de Empregos, backup) e o simulador da carreira, sem dependências de Node. Usado pelo servidor
 * (apps/server, Socket.io) e pelo anfitrião da simulação no navegador (online grátis: GitHub Pages + Cloudflare).
 *
 * Subcaminhos: `@cosmicfut/online-core/<arquivo>` (ex.: `/wire` é puro e é o único que o relay da Cloudflare importa).
 */
export * from './platform.ts';
export * from './options.ts';
export * from './career-data.ts';
export { GameData } from './data.ts';
export * from './sim-core.ts';
export * from './sim-runner.ts';
export * from './room.ts';
export * from './dispatch.ts';
export * from './backup.ts';
export * from './host.ts';
export * from './wire.ts';
