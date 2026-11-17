/**
 * Dados estáticos do jogo lidos do disco (padrão: apps/web/public/data).
 * Somente leitura e compartilhados entre as salas. Bundles de clube carregam sob demanda.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Calendar, ClubBundle, ClubIndexEntry, Division, Economy, Player, StateChampionship } from '@cosmicfut/shared';
import { playableClubs } from './career-data.ts';

const CLUB_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const EMPTY: Player[] = [];

export class GameData {
  readonly dir: string;
  private readonly bundles = new Map<string, ClubBundle | null>();
  private _leagues: Division[] | null = null;
  private _calendars: Calendar[] | null = null;
  private _economy: Economy | null = null;
  private _index: Map<string, ClubIndexEntry> | null = null;
  private _states: StateChampionship[] | null = null;
  private readonly _playable = new Map<number, Set<string>>();

  constructor(dir: string) {
    this.dir = dir;
    if (!existsSync(resolve(dir, 'clubs-index.json'))) {
      throw new Error(`Pasta de dados inválida (sem clubs-index.json): ${dir}`);
    }
  }

  private read<T>(rel: string): T {
    return JSON.parse(readFileSync(resolve(this.dir, rel), 'utf8')) as T;
  }

  leagues(): Division[] {
    return (this._leagues ??= this.read<Division[]>('leagues.json'));
  }

  states(): StateChampionship[] {
    if (!this._states) {
      try {
        this._states = this.read<StateChampionship[]>('states.json');
      } catch {
        this._states = [];
      }
    }
    return this._states;
  }

  /** Clubes jogáveis por país (regra da carreira; memorizado). */
  playable(countryId: number): Set<string> {
    let s = this._playable.get(countryId);
    if (!s) {
      s = playableClubs({ leagues: this.leagues(), states: this.states() }, countryId).all;
      this._playable.set(countryId, s);
    }
    return s;
  }

  private _playableAll: Set<string> | null = null;
  private _playableEntries: ClubIndexEntry[] | null = null;

  /**
   * (17/11) Clubes jogáveis de TODAS as regiões em escopo (Europa, América do Sul, Arábia): divisões nacionais reais
   * de qualquer país + clubes que só jogam o estadual no Brasil. Convidados nunca.
   */
  playableAll(): Set<string> {
    if (!this._playableAll) {
      const all = new Set<string>();
      for (const id of new Set(this.leagues().map((d) => d.countryId))) for (const c of this.playable(id)) all.add(c);
      for (const id of all) if (this.club(id)?.guest || !this.club(id)) all.delete(id);
      this._playableAll = all;
    }
    return this._playableAll;
  }

  playableEntries(): ClubIndexEntry[] {
    return (this._playableEntries ??= [...this.playableAll()].map((id) => this.club(id)!).filter(Boolean));
  }

  calendars(): Calendar[] {
    if (!this._calendars) {
      try {
        this._calendars = this.read<Calendar[]>('calendars.json');
      } catch {
        this._calendars = [];
      }
    }
    return this._calendars;
  }

  economy(): Economy | null {
    if (!this._economy) {
      try {
        this._economy = this.read<Economy>('economy.json');
      } catch {
        return null;
      }
    }
    return this._economy;
  }

  clubIndex(): Map<string, ClubIndexEntry> {
    if (!this._index) this._index = new Map(this.read<ClubIndexEntry[]>('clubs-index.json').map((c) => [c.id, c]));
    return this._index;
  }

  club(id: string): ClubIndexEntry | undefined {
    return this.clubIndex().get(id);
  }

  /** Bundle completo (clube + elenco) — null se não existir. */
  bundle(id: string): ClubBundle | null {
    if (!CLUB_ID_RE.test(id)) return null;
    let b = this.bundles.get(id);
    if (b === undefined) {
      try {
        b = this.read<ClubBundle>(`clubs/${id}.json`);
      } catch {
        b = null;
      }
      this.bundles.set(id, b);
    }
    return b;
  }

  /** Elenco base (referência estável) — formato `squads` da engine. */
  readonly squad = (clubId: string): Player[] => this.bundle(clubId)?.players ?? EMPTY;
}
