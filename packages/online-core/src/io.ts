/**
 * Transporte visto pela SALA: o subconjunto do `Server` do Socket.io que `room.ts` usa. No Node é o próprio
 * Socket.io (cast); no anfitrião do navegador é o `VirtualIO` (vio.ts), que vira mensagens para o relay.
 */
import type { ServerEvents, SocketData } from './protocol.ts';

type Emit = <E extends keyof ServerEvents>(ev: E, ...args: Parameters<ServerEvents[E]>) => unknown;

export interface CoreBroadcast {
  emit: Emit;
  compress(on: boolean): { emit: Emit };
}

export interface CoreSocket {
  readonly id: string;
  data: SocketData;
  emit: Emit;
  join(channel: string): unknown;
  leave(channel: string): unknown;
  disconnect(close?: boolean): unknown;
}

export interface CoreIO {
  to(target: string): CoreBroadcast;
  in(target: string): { socketsLeave(channel: string): unknown };
  sockets: { sockets: { get(id: string): CoreSocket | undefined } };
}
