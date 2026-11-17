/**
 * (Carreira online salva) Backup do host: o snapshot da sala (mesmo formato v2 do disco) SEM tokens nem códigos de
 * vaga, em JSON+gzip. Restaurar cria uma sala nova com os mesmos técnicos e clubes; tokens novos para todos — quem
 * envia o arquivo fica com a vaga do host, os outros recuperam as vagas pelos códigos que o host gera.
 *
 * Validação estrita (o arquivo vem do usuário): tamanho (MAX_BACKUP_MB), gzip com limite de saída, JSON, versão,
 * tipos e tamanhos de cada campo; a carreira é conferida reidratando o simulador antes de a sala aparecer.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import type { RoomSnapshot } from './room.ts';
import type { ClubSetup } from './sim-core.ts';
import * as V from './validate.ts';

export const BACKUP_KIND = 'cosmicfut-online-backup';

export function makeBackup(snap: RoomSnapshot): Buffer {
  const clean: RoomSnapshot = {
    ...snap,
    players: snap.players.map((p) => ({ ...p, token: '', seatCode: null })),
  };
  return gzipSync(JSON.stringify({ kind: BACKUP_KIND, exportedAt: Date.now(), room: clean }), { level: 6 });
}

const isB64 = (s: unknown, max: number): s is string => typeof s === 'string' && s.length > 0 && s.length <= max && /^[A-Za-z0-9+/=]+$/.test(s);
const isIso = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isInt = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
const PHASES = ['lobby', 'planning', 'simulating', 'matchday', 'season-end', 'finished'];

/**
 * Lê e valida um backup (gzip ou JSON). Devolve o snapshot pronto para `Room.fromSnapshot` (tokens ainda vazios) ou
 * lança ValidationError com a mensagem para o usuário.
 */
export function parseBackup(body: Buffer, maxBytes: number): RoomSnapshot {
  if (!body.length) throw new V.ValidationError('Arquivo vazio.');
  if (body.length > maxBytes) throw new V.ValidationError(`Arquivo grande demais (máximo ${Math.round(maxBytes / 1048576)} MB).`);
  let text: string;
  try {
    const raw = body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body, { maxOutputLength: maxBytes * 8 }) : body;
    text = raw.toString('utf8');
  } catch {
    throw new V.ValidationError('Arquivo de backup corrompido (gzip inválido ou grande demais).');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new V.ValidationError('Arquivo de backup inválido (não é JSON).');
  }
  const top = V.obj(parsed, 'Backup');
  const room = V.obj(top.kind === BACKUP_KIND ? top.room : top, 'Sala do backup');
  if (room.v !== 2) throw new V.ValidationError('Versão de backup não suportada.');
  const code = typeof room.code === 'string' && /^[A-Z0-9]{6}$/.test(room.code) ? room.code : null;
  if (!code) throw new V.ValidationError('Código da sala inválido no backup.');
  if (typeof room.phase !== 'string' || !PHASES.includes(room.phase)) throw new V.ValidationError('Fase inválida no backup.');
  const settings = V.obj(room.settings, 'Configurações do backup');
  if (!Array.isArray(room.players) || room.players.length < 1 || room.players.length > 10) throw new V.ValidationError('Lista de técnicos inválida no backup.');
  const ids = new Set<string>();
  const players = room.players.map((x) => {
    const p = V.obj(x, 'Técnico do backup');
    const id = V.id(p.id, 'Id do técnico');
    if (ids.has(id)) throw new V.ValidationError('Técnicos repetidos no backup.');
    ids.add(id);
    const clubId = p.clubId === null || p.clubId === undefined ? null : V.id(p.clubId, 'Clube');
    return {
      id, token: '', nickname: V.nickname(p.nickname), clubId, ai: true,
      ...(typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? { color: p.color } : {}),
      spectator: p.spectator === true, missed: 0, afk: false, lastSeen: null, seatCode: null,
    };
  });
  const hostId = typeof room.hostId === 'string' && ids.has(room.hostId) ? room.hostId : players.find((p) => !p.spectator)?.id;
  if (!hostId) throw new V.ValidationError('Backup sem técnico.');
  let career: RoomSnapshot['career'] = null;
  if (room.career !== null && room.career !== undefined) {
    const c = V.obj(room.career, 'Carreira do backup');
    const human = Array.isArray(c.humanClubIds) ? c.humanClubIds : null;
    if (!human || human.length > 6) throw new V.ValidationError('Clubes humanos inválidos no backup.');
    if (!isInt(c.season, 1900, 3000) || !isIso(c.date) || !isInt(c.version, 0, 1e9) || !isInt(c.worldVersion, 0, 1e9)) throw new V.ValidationError('Carreira inválida no backup.');
    const max = maxBytes * 2;
    if (!isB64(c.worldGz, max) || !isB64(c.stateGz, max)) throw new V.ValidationError('Dados da carreira inválidos no backup.');
    const setups = c.setups === undefined ? {} : V.obj(c.setups, 'Escalações');
    if (Object.keys(setups).length > 6) throw new V.ValidationError('Escalações inválidas no backup.');
    career = {
      humanClubIds: human.map((h) => V.id(h, 'Clube')), season: c.season, date: c.date, version: c.version, worldVersion: c.worldVersion,
      // escalações: só a tática (validada); a escalação é remontada automaticamente
      worldGz: c.worldGz, stateGz: c.stateGz,
      setups: Object.fromEntries(Object.entries(setups).map(([k, v]): [string, ClubSetup] => [V.id(k, 'Clube'), { tactic: V.tactic(V.obj(v, 'Escalação').tactic), lineup: null }])),
      seasonEnd: c.seasonEnd && typeof c.seasonEnd === 'object' ? (c.seasonEnd as NonNullable<RoomSnapshot['career']>['seasonEnd']) : null,
      jobs: c.jobs && typeof c.jobs === 'object' ? (c.jobs as NonNullable<RoomSnapshot['career']>['jobs']) : null,
    };
  }
  return {
    v: 2, code, createdAt: isInt(room.createdAt, 0, 1e15) ? room.createdAt : Date.now(), savedAt: Date.now(), hostId,
    phase: room.phase as RoomSnapshot['phase'], settings: settings as unknown as RoomSnapshot['settings'], players,
    round: isInt(room.round, 0, 1e6) ? room.round : 0,
    draftOrder: Array.isArray(room.draftOrder) ? room.draftOrder.filter((x): x is string => typeof x === 'string' && ids.has(x)) : null,
    ...(room.friends && typeof room.friends === 'object' ? { friends: room.friends as RoomSnapshot['friends'] } : {}),
    lastActivity: Date.now(),
    career,
    lastMatches: [],
  };
}
