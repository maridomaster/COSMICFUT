/**
 * A sala autoritativa foi movida para @cosmicfut/online-core (mesma lógica no servidor Node e no anfitrião da simulação
 * do navegador). O servidor injeta o Socket.io como `CoreIO`.
 */
import './node-platform.ts';
export * from '@cosmicfut/online-core/room';
